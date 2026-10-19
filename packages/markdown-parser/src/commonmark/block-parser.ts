// ================================
// @code-reader/markdown-parser - 块级解析
// 按 CommonMark 规范的块级算法实现（与参考实现 commonmark.js 相同）：逐行处理，维护“打开的块”树——
// 先让每个打开的容器块（引用、列表项）尝试匹配本行的前缀，再尝试新块的开头，剩余部分作为文本加入
// 最深的叶子块；未匹配的块关闭（段落可以“惰性续行”）。制表符按 4 列制表位计算。
// GFM：表格、任务列表项、脚注定义。全文块级结构完成后统一解析行内内容（链接引用定义可以出现在使用之后）
// ================================

import {
  BlockType,
  InlineType,
  type BlockNode,
  type CommonMarkOptions,
  type InlineNode,
  type ParseWarning,
  type Position,
  type TableAlignment,
  type TableCellNode,
  type TableNode,
  type TableRowNode,
} from './commonmark-parser';
import { InlineParser, unescapeString, type ReferenceMap } from './inline-parser';

const CODE_INDENT = 4;

/** HTML 块第 6 类的标签名（CommonMark 0.31.2） */
const HTML_BLOCK_TAGS = new Set(
  (
    'address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt ' +
    'fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link ' +
    'main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead ' +
    'title tr track ul'
  ).split(' ')
);
const TAG_NAME = '[A-Za-z][A-Za-z0-9-]*';
const ATTRIBUTE = `(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?)`;

/** HTML 块 7 种开始条件；1～5 有各自的结束条件，6、7 到空行为止。第 7 类不能打断段落 */
const HTML_BLOCK_OPEN: ReadonlyArray<RegExp> = [
  /^<(?:pre|script|style|textarea)(?:\s|>|$)/i,
  /^<!--/,
  /^<[?]/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|\/?>|$)/,
  new RegExp(`^(?:<${TAG_NAME}${ATTRIBUTE}*\\s*/?>|</${TAG_NAME}\\s*>)\\s*$`),
];
const HTML_BLOCK_CLOSE: ReadonlyArray<RegExp> = [/<\/(?:pre|script|style|textarea)>/i, /-->/, /\?>/, />/, /\]\]>/];

const ATX_HEADING = /^#{1,6}(?:[ \t]+|$)/;
const CODE_FENCE = /^`{3,}(?!.*`)|^~{3,}/;
const CLOSING_CODE_FENCE = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const BULLET_MARKER = /^[*+-]/;
const ORDERED_MARKER = /^(\d{1,9})([.)])/;
const MAYBE_SPECIAL = /^[#`~*+_=<>0-9-[|:]/;
const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]?/;
/** 能结束 GFM 表格的块开头：引用、ATX 标题、围栏、主题分隔线、列表项 */
const TABLE_INTERRUPT = /^(?:>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[*_-][ \t]*){3,}$|[*+-](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;

type BlockKind =
  | 'document'
  | 'block_quote'
  | 'list'
  | 'item'
  | 'heading'
  | 'thematic_break'
  | 'code_block'
  | 'html_block'
  | 'paragraph'
  | 'table'
  | 'footnote_definition';

interface ListData {
  type: 'bullet' | 'ordered';
  bulletChar: string | null;
  start: number;
  delimiter: string | null;
  padding: number;
  markerOffset: number;
  tight: boolean;
}

/** 解析过程中的块 */
class Block {
  parent: Block | null = null;
  children: Block[] = [];
  open = true;
  content = '';
  /** 起止行（1 起）与列（1 起） */
  startLine: number;
  startColumn: number;
  endLine = 0;
  endColumn = 0;
  level = 0;
  fenced = false;
  fenceChar = '';
  fenceLength = 0;
  fenceOffset = 0;
  info = '';
  htmlBlockType = 0;
  listData: ListData | null = null;
  footnoteId = '';
  alignments: TableAlignment[] = [];

  constructor(
    public kind: BlockKind,
    line: number,
    column: number
  ) {
    this.startLine = line;
    this.startColumn = column;
  }

  get last(): Block | undefined {
    return this.children[this.children.length - 1];
  }

  /** 后一个兄弟块 */
  nextSibling(): Block | undefined {
    if (!this.parent) return undefined;
    const siblings = this.parent.children;
    return siblings[siblings.indexOf(this) + 1];
  }

  remove(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
}

const CONTAINERS: ReadonlySet<BlockKind> = new Set(['document', 'block_quote', 'item', 'footnote_definition']);
const ACCEPTS_LINES: ReadonlySet<BlockKind> = new Set(['paragraph', 'code_block', 'html_block', 'table']);

function canContain(parent: BlockKind, child: BlockKind): boolean {
  if (parent === 'list') return child === 'item';
  return CONTAINERS.has(parent) && child !== 'item';
}

const isSpaceOrTab = (char: string | undefined) => char === ' ' || char === '\t';

/** 块级结束于空行：与下一个兄弟块之间隔着空行（列表松紧判断） */
function endsWithBlankLine(block: Block): boolean {
  const next = block.nextSibling();
  return next !== undefined && block.endLine !== next.startLine - 1;
}

// ================================
// GFM 表格
// ================================

function splitTableRow(line: string): string[] {
  let content = line.trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|') && !content.endsWith('\\|')) content = content.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    if (char === '\\' && content[i + 1] === '|') {
      current += '|';
      i++;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseDelimiterRow(line: string): TableAlignment[] | null {
  if (!/^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line.trim()) || !line.includes('-')) return null;
  if (!line.includes('|') && !/^[ \t]*:?-+:?[ \t]*$/.test(line)) return null;
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
}

// ================================
// 块级解析器
// ================================

export class BlockParser {
  private document!: Block;
  private tip!: Block;
  private oldTip!: Block;
  private lastMatchedContainer!: Block;
  private allClosed = true;

  private currentLine = '';
  private lineNumber = 0;
  private offset = 0;
  private column = 0;
  private nextNonspace = 0;
  private nextNonspaceColumn = 0;
  private indent = 0;
  private indented = false;
  private blank = false;
  private partiallyConsumedTab = false;
  private lastLineLength = 0;

  private references: ReferenceMap = new Map();
  private warnings: ParseWarning[] = [];

  constructor(private readonly options: Required<CommonMarkOptions>) {}

  parse(input: string): { document: BlockNode; warnings: ParseWarning[] } {
    this.document = new Block('document', 1, 1);
    this.tip = this.document;
    this.oldTip = this.document;
    this.lastMatchedContainer = this.document;
    this.lineNumber = 0;
    this.lastLineLength = 0;
    this.references = new Map();
    this.warnings = [];

    const lines = input.split(/\r\n|\n|\r/);
    let count = lines.length;
    if (/[\r\n]$/.test(input)) count -= 1;
    for (let i = 0; i < count; i++) this.incorporateLine(lines[i]!);
    while (this.tip !== this.document) this.finalize(this.tip, count);
    this.finalize(this.document, count);

    const lineStarts = [0];
    for (const match of input.matchAll(/\r\n|\n|\r/g)) lineStarts.push(match.index! + match[0].length);
    return { document: this.convert(this.document, input, lineStarts), warnings: this.warnings };
  }

  // ---------- 行内位置 ----------

  private findNextNonspace(): void {
    const line = this.currentLine;
    let i = this.offset;
    let columns = this.column;
    let char: string | undefined;
    while ((char = line[i]) !== undefined) {
      if (char === ' ') {
        i++;
        columns++;
      } else if (char === '\t') {
        i++;
        columns += 4 - (columns % 4);
      } else {
        break;
      }
    }
    this.blank = char === undefined;
    this.nextNonspace = i;
    this.nextNonspaceColumn = columns;
    this.indent = this.nextNonspaceColumn - this.column;
    this.indented = this.indent >= CODE_INDENT;
  }

  private advanceNextNonspace(): void {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
    this.partiallyConsumedTab = false;
  }

  /** 前进 count 个字符或（columns 为真时）列；制表符可能只消耗一部分 */
  private advanceOffset(count: number, columns: boolean): void {
    const line = this.currentLine;
    let char: string | undefined;
    while (count > 0 && (char = line[this.offset]) !== undefined) {
      if (char === '\t') {
        const toTab = 4 - (this.column % 4);
        if (columns) {
          this.partiallyConsumedTab = toTab > count;
          const advance = toTab > count ? count : toTab;
          this.column += advance;
          this.offset += this.partiallyConsumedTab ? 0 : 1;
          count -= advance;
        } else {
          this.partiallyConsumedTab = false;
          this.column += toTab;
          this.offset++;
          count--;
        }
      } else {
        this.partiallyConsumedTab = false;
        this.offset++;
        this.column++;
        count--;
      }
    }
  }

  private addLine(): void {
    if (this.partiallyConsumedTab) {
      this.offset++;
      this.tip.content += ' '.repeat(4 - (this.column % 4));
    }
    this.tip.content += this.currentLine.slice(this.offset) + '\n';
  }

  private addChild(kind: BlockKind, offset: number): Block {
    while (!canContain(this.tip.kind, kind)) this.finalize(this.tip, this.lineNumber - 1);
    const block = new Block(kind, this.lineNumber, offset + 1);
    block.parent = this.tip;
    this.tip.children.push(block);
    this.tip = block;
    return block;
  }

  private closeUnmatchedBlocks(): void {
    if (this.allClosed) return;
    while (this.oldTip !== this.lastMatchedContainer) {
      const parent = this.oldTip.parent!;
      this.finalize(this.oldTip, this.lineNumber - 1);
      this.oldTip = parent;
    }
    this.allClosed = true;
  }

  /** 容器嵌套深度（document 为 0） */
  private depth(block: Block): number {
    let depth = 0;
    for (let current = block.parent; current; current = current.parent) depth++;
    return depth;
  }

  /** 新开容器会超过最大嵌套深度时记一条警告，并按普通文本处理 */
  private tooDeep(container: Block): boolean {
    if (this.depth(container) + 1 < this.options.maxNestingDepth) return false;
    this.warnings.push({
      message: `嵌套超过 ${this.options.maxNestingDepth} 层，其余部分按文本处理`,
      line: this.lineNumber,
      column: this.nextNonspace + 1,
    });
    return true;
  }

  // ---------- 逐行处理 ----------

  private incorporateLine(line: string): void {
    let container = this.document;
    this.oldTip = this.tip;
    this.offset = 0;
    this.column = 0;
    this.blank = false;
    this.partiallyConsumedTab = false;
    this.lineNumber++;
    this.currentLine = line.includes('\u0000') ? line.replace(/\0/g, '\uFFFD') : line;

    // 1. 已打开的块依次匹配本行前缀
    let lastChild: Block | undefined;
    while ((lastChild = container.last) && lastChild.open) {
      container = lastChild;
      this.findNextNonspace();
      const result = this.continueBlock(container);
      if (result === 2) return;
      if (result === 1) {
        container = container.parent!;
        break;
      }
    }
    this.allClosed = container === this.oldTip;
    this.lastMatchedContainer = container;

    // 2. 新块的开头
    let matchedLeaf = container.kind !== 'paragraph' && ACCEPTS_LINES.has(container.kind);
    while (!matchedLeaf) {
      this.findNextNonspace();
      if (!this.indented && !MAYBE_SPECIAL.test(this.currentLine.slice(this.nextNonspace))) {
        this.advanceNextNonspace();
        break;
      }
      const result = this.tryBlockStarts(container);
      if (result === 0) {
        this.advanceNextNonspace();
        break;
      }
      container = this.tip;
      if (result === 2) matchedLeaf = true;
    }

    // 3. 剩余文本：段落惰性续行，或加入叶子块，或开始新段落
    if (!this.allClosed && !this.blank && this.tip.kind === 'paragraph') {
      this.addLine();
    } else {
      this.closeUnmatchedBlocks();
      const kind = container.kind;
      if (ACCEPTS_LINES.has(kind)) {
        // 表格的分隔行在开表时已整行消耗，不作为数据行
        if (kind !== 'table' || this.offset < line.length) this.addLine();
        if (
          kind === 'html_block' &&
          container.htmlBlockType >= 1 &&
          container.htmlBlockType <= 5 &&
          HTML_BLOCK_CLOSE[container.htmlBlockType - 1]!.test(this.currentLine.slice(this.offset))
        ) {
          this.lastLineLength = line.length;
          this.finalize(container, this.lineNumber);
        }
      } else if (this.offset < line.length && !this.blank) {
        this.addChild('paragraph', this.offset);
        this.advanceNextNonspace();
        this.addLine();
      }
    }
    this.lastLineLength = line.length;
  }

  /** 已打开的块能否继续：0 继续，1 不能，2 本行已处理完（如围栏结束） */
  private continueBlock(block: Block): 0 | 1 | 2 {
    const line = this.currentLine;
    switch (block.kind) {
      case 'document':
      case 'list':
        return 0;
      case 'block_quote':
        if (!this.indented && line[this.nextNonspace] === '>') {
          this.advanceNextNonspace();
          this.advanceOffset(1, false);
          if (isSpaceOrTab(line[this.offset])) this.advanceOffset(1, true);
          return 0;
        }
        return 1;
      case 'item':
      case 'footnote_definition': {
        const width = block.kind === 'item' ? block.listData!.markerOffset + block.listData!.padding : 4;
        if (this.blank) {
          if (block.children.length === 0) return 1;
          this.advanceNextNonspace();
        } else if (this.indent >= width) {
          this.advanceOffset(width, true);
        } else {
          return 1;
        }
        return 0;
      }
      case 'heading':
      case 'thematic_break':
        return 1;
      case 'code_block':
        if (block.fenced) {
          const match =
            this.indent <= 3 && line[this.nextNonspace] === block.fenceChar
              ? CLOSING_CODE_FENCE.exec(line.slice(this.nextNonspace))
              : null;
          if (match && match[0].length >= block.fenceLength) {
            this.lastLineLength = this.offset + this.indent + match[0].length;
            this.finalize(block, this.lineNumber);
            return 2;
          }
          let skip = block.fenceOffset;
          while (skip > 0 && isSpaceOrTab(line[this.offset])) {
            this.advanceOffset(1, true);
            skip--;
          }
          return 0;
        }
        if (this.indent >= CODE_INDENT) {
          this.advanceOffset(CODE_INDENT, true);
          return 0;
        }
        if (this.blank) {
          this.advanceNextNonspace();
          return 0;
        }
        return 1;
      case 'html_block':
        return this.blank && (block.htmlBlockType === 6 || block.htmlBlockType === 7) ? 1 : 0;
      case 'paragraph':
        return this.blank ? 1 : 0;
      case 'table':
        // GFM：表格在空行或另一个块的开头处结束
        return this.blank || (!this.indented && TABLE_INTERRUPT.test(line.slice(this.nextNonspace))) ? 1 : 0;
    }
  }

  /** 依次尝试各种块的开头：0 都不是，1 开启了容器，2 开启了叶子块 */
  private tryBlockStarts(container: Block): 0 | 1 | 2 {
    const line = this.currentLine;
    const rest = line.slice(this.nextNonspace);

    // 引用块
    if (!this.indented && line[this.nextNonspace] === '>' && !this.tooDeep(container)) {
      this.advanceNextNonspace();
      this.advanceOffset(1, false);
      if (isSpaceOrTab(line[this.offset])) this.advanceOffset(1, true);
      this.closeUnmatchedBlocks();
      this.addChild('block_quote', this.nextNonspace);
      return 1;
    }

    // ATX 标题
    let match: RegExpExecArray | null;
    if (!this.indented && (match = ATX_HEADING.exec(rest))) {
      this.advanceNextNonspace();
      this.advanceOffset(match[0].length, false);
      this.closeUnmatchedBlocks();
      const heading = this.addChild('heading', this.nextNonspace);
      heading.level = match[0].trim().length;
      heading.content = line
        .slice(this.offset)
        .replace(/^[ \t]*#+[ \t]*$/, '')
        .replace(/[ \t]+#+[ \t]*$/, '');
      this.advanceOffset(line.length - this.offset, false);
      return 2;
    }

    // 围栏代码块
    if (!this.indented && (match = CODE_FENCE.exec(rest))) {
      this.closeUnmatchedBlocks();
      const code = this.addChild('code_block', this.nextNonspace);
      code.fenced = true;
      code.fenceLength = match[0].length;
      code.fenceChar = match[0][0]!;
      code.fenceOffset = this.indent;
      this.advanceNextNonspace();
      this.advanceOffset(match[0].length, false);
      return 2;
    }

    // HTML 块
    if (this.options.html && !this.indented && line[this.nextNonspace] === '<') {
      for (let type = 1; type <= 7; type++) {
        const open = HTML_BLOCK_OPEN[type - 1]!.exec(rest);
        if (!open) continue;
        if (type === 6 && !HTML_BLOCK_TAGS.has(open[1]!.toLowerCase())) continue;
        if (type === 7 && (container.kind === 'paragraph' || (!this.allClosed && !this.blank && this.tip.kind === 'paragraph'))) {
          continue;
        }
        this.closeUnmatchedBlocks();
        const html = this.addChild('html_block', this.offset);
        html.htmlBlockType = type;
        return 2;
      }
    }

    // Setext 标题（段落之后的 === / ---）
    if (!this.indented && container.kind === 'paragraph' && (match = SETEXT_UNDERLINE.exec(rest))) {
      this.closeUnmatchedBlocks();
      this.consumeReferenceDefinitions(container);
      if (container.content.length > 0) {
        const heading = new Block('heading', container.startLine, container.startColumn);
        heading.level = match[0][0] === '=' ? 1 : 2;
        heading.content = container.content;
        heading.parent = container.parent;
        const siblings = container.parent!.children;
        siblings[siblings.indexOf(container)] = heading;
        this.tip = heading;
        this.advanceOffset(line.length - this.offset, false);
        return 2;
      }
      return 0;
    }

    // GFM 表格：只有一行的段落 + 分隔行，列数一致
    if (
      this.options.gfm &&
      !this.indented &&
      container.kind === 'paragraph' &&
      container.content.indexOf('\n') === container.content.length - 1
    ) {
      const alignments = parseDelimiterRow(rest);
      const header = splitTableRow(container.content.slice(0, -1));
      if (alignments && header.length === alignments.length && container.content.includes('|')) {
        this.closeUnmatchedBlocks();
        const table = new Block('table', container.startLine, container.startColumn);
        table.alignments = alignments;
        table.content = container.content;
        table.parent = container.parent;
        const siblings = container.parent!.children;
        siblings[siblings.indexOf(container)] = table;
        this.tip = table;
        this.advanceOffset(line.length - this.offset, false);
        return 2;
      }
    }

    // 主题分隔线
    if (!this.indented && THEMATIC_BREAK.test(rest)) {
      this.closeUnmatchedBlocks();
      this.addChild('thematic_break', this.nextNonspace);
      this.advanceOffset(line.length - this.offset, false);
      return 2;
    }

    // GFM 脚注定义
    if (this.options.gfm && !this.indented && container.kind !== 'paragraph' && (match = FOOTNOTE_DEFINITION.exec(rest))) {
      if (!this.tooDeep(container)) {
        this.closeUnmatchedBlocks();
        const footnote = this.addChild('footnote_definition', this.nextNonspace);
        footnote.footnoteId = match[1]!;
        this.advanceNextNonspace();
        this.advanceOffset(match[0].length, false);
        return 1;
      }
    }

    // 列表项
    if (!this.indented || container.kind === 'list') {
      const data = this.parseListMarker(container);
      if (data && !this.tooDeep(container)) {
        this.closeUnmatchedBlocks();
        const previous = this.tip.kind === 'list' ? this.tip.listData! : null;
        if (
          !previous ||
          previous.type !== data.type ||
          previous.delimiter !== data.delimiter ||
          previous.bulletChar !== data.bulletChar
        ) {
          this.addChild('list', this.nextNonspace).listData = { ...data };
        }
        this.addChild('item', this.nextNonspace).listData = data;
        return 1;
      }
    }

    // 缩进代码块
    if (this.indented && this.tip.kind !== 'paragraph' && !this.blank) {
      this.advanceOffset(CODE_INDENT, true);
      this.closeUnmatchedBlocks();
      this.addChild('code_block', this.offset);
      return 2;
    }

    return 0;
  }

  private parseListMarker(container: Block): ListData | null {
    if (this.indent >= 4) return null;
    const line = this.currentLine;
    const rest = line.slice(this.nextNonspace);
    const data: ListData = {
      type: 'bullet',
      bulletChar: null,
      start: 1,
      delimiter: null,
      padding: 0,
      markerOffset: this.indent,
      tight: true,
    };
    let match: RegExpExecArray | null;
    if ((match = BULLET_MARKER.exec(rest))) {
      data.bulletChar = match[0];
    } else if ((match = ORDERED_MARKER.exec(rest)) && (container.kind !== 'paragraph' || match[1] === '1')) {
      data.type = 'ordered';
      data.start = parseInt(match[1]!, 10);
      data.delimiter = match[2]!;
    } else {
      return null;
    }
    const markerLength = match[0].length;
    const after = line[this.nextNonspace + markerLength];
    if (!(after === undefined || after === '\t' || after === ' ')) return null;
    // 打断段落的列表项第一行不能为空
    if (container.kind === 'paragraph' && !/\S/.test(line.slice(this.nextNonspace + markerLength))) return null;

    this.advanceNextNonspace();
    this.advanceOffset(markerLength, true);
    const spacesStartColumn = this.column;
    const spacesStartOffset = this.offset;
    do {
      this.advanceOffset(1, true);
    } while (this.column - spacesStartColumn < 5 && isSpaceOrTab(line[this.offset]));
    const blankItem = line[this.offset] === undefined;
    const spacesAfterMarker = this.column - spacesStartColumn;
    if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
      data.padding = markerLength + 1;
      this.column = spacesStartColumn;
      this.offset = spacesStartOffset;
      if (isSpaceOrTab(line[this.offset])) this.advanceOffset(1, true);
    } else {
      data.padding = markerLength + spacesAfterMarker;
    }
    return data;
  }

  // ---------- 关闭块 ----------

  /** 段落开头的链接引用定义：登记并从内容中去掉 */
  private consumeReferenceDefinitions(paragraph: Block): boolean {
    let found = false;
    const parser = new InlineParser(this.options);
    while (paragraph.content.startsWith('[')) {
      const definition = parser.parseReference(paragraph.content);
      if (!definition) break;
      if (!this.references.has(definition.label)) {
        this.references.set(definition.label, { url: definition.url, title: definition.title });
      }
      paragraph.content = paragraph.content.slice(definition.length);
      found = true;
    }
    return found;
  }

  private finalize(block: Block, lineNumber: number): void {
    const parent = block.parent;
    block.open = false;
    block.endLine = lineNumber;
    block.endColumn = this.lastLineLength;

    switch (block.kind) {
      case 'paragraph':
        if (this.consumeReferenceDefinitions(block) && !/\S/.test(block.content)) block.remove();
        break;
      case 'code_block':
        if (block.fenced) {
          const newline = block.content.indexOf('\n');
          block.info = unescapeString(block.content.slice(0, newline).trim());
          block.content = block.content.slice(newline + 1);
        } else {
          block.content = block.content.replace(/(\n *)+$/, '\n');
        }
        break;
      case 'html_block':
        block.content = block.content.replace(/(\n *)+$/, '');
        break;
      case 'item':
      case 'footnote_definition':
        if (block.last) {
          block.endLine = block.last.endLine;
          block.endColumn = block.last.endColumn;
        } else if (block.listData) {
          block.endLine = block.startLine;
          block.endColumn = block.listData.markerOffset + block.listData.padding;
        }
        break;
      case 'list': {
        const data = block.listData!;
        for (const item of block.children) {
          if (item.nextSibling() && endsWithBlankLine(item)) data.tight = false;
          for (const child of item.children) {
            if (child.nextSibling() && endsWithBlankLine(child)) data.tight = false;
          }
          if (!data.tight) break;
        }
        if (block.last) {
          block.endLine = block.last.endLine;
          block.endColumn = block.last.endColumn;
        }
        break;
      }
      default:
        break;
    }
    if (parent) this.tip = parent;
  }

  // ---------- 输出 ----------

  private convert(root: Block, input: string, lineStarts: number[]): BlockNode {
    const inline = new InlineParser(this.options, this.references);
    const footnotes = new Map<string, number>();

    const position = (block: Block): Position => {
      const startLine = block.startLine;
      const endLine = Math.max(block.endLine, startLine);
      const start = Math.min(input.length, (lineStarts[startLine - 1] ?? input.length) + block.startColumn - 1);
      const lineStart = lineStarts[endLine - 1] ?? input.length;
      const lineEnd = endLine < lineStarts.length ? lineStarts[endLine]! : input.length;
      const end = Math.max(start, Math.min(lineStart + block.endColumn, lineEnd, input.length));
      return {
        start,
        end,
        startLine,
        startColumn: block.startColumn,
        endLine,
        endColumn: Math.max(1, end - lineStart + 1),
      };
    };

    const inlineOf = (text: string, line: number): InlineNode[] => inline.parse(text.trim(), line);

    const visit = (block: Block, tight: boolean): BlockNode => {
      const pos = position(block);
      const base = { position: pos, raw: input.slice(pos.start, pos.end) };
      switch (block.kind) {
        case 'document':
          return { type: BlockType.Document, ...base, raw: input, children: block.children.map((child) => visit(child, false)) };
        case 'paragraph':
          return { type: BlockType.Paragraph, ...base, content: block.content.trim(), inline: inlineOf(block.content, block.startLine) };
        case 'heading':
          return {
            type: BlockType.Heading,
            ...base,
            level: block.level,
            content: block.content.trim(),
            inline: inlineOf(block.content, block.startLine),
          };
        case 'thematic_break':
          return { type: BlockType.ThematicBreak, ...base };
        case 'code_block': {
          const node: BlockNode = { type: block.fenced ? BlockType.FencedCode : BlockType.CodeBlock, ...base, content: block.content };
          const language = block.info.split(/\s+/)[0];
          if (language) node.language = language;
          return node;
        }
        case 'html_block':
          return { type: BlockType.HtmlBlock, ...base, content: block.content };
        case 'block_quote':
          return { type: BlockType.Blockquote, ...base, children: block.children.map((child) => visit(child, false)) };
        case 'list': {
          const data = block.listData!;
          return {
            type: BlockType.List,
            ...base,
            ordered: data.type === 'ordered',
            ...(data.type === 'ordered' ? { start: data.start } : {}),
            marker: data.bulletChar ?? data.delimiter ?? '',
            tight: data.tight,
            children: block.children.map((item) => visit(item, data.tight)),
          };
        }
        case 'item': {
          const task = this.options.gfm ? this.taskMarker(block) : null;
          return {
            type: task ? BlockType.TaskListItem : BlockType.ListItem,
            ...base,
            ...(task ? { checked: task.checked } : {}),
            children: block.children.map((child) => visit(child, tight)),
          };
        }
        case 'table':
          return this.convertTable(block, base, inline);
        case 'footnote_definition': {
          if (!footnotes.has(block.footnoteId)) footnotes.set(block.footnoteId, footnotes.size + 1);
          return {
            type: BlockType.FootnoteDefinition,
            ...base,
            footnoteId: block.footnoteId,
            footnoteIndex: footnotes.get(block.footnoteId)!,
            children: block.children.map((child) => visit(child, false)),
          };
        }
      }
    };

    const document = visit(root, false);
    if (footnotes.size > 0) assignFootnoteIndexes(document, footnotes);
    return document;
  }

  /** GFM 任务列表项：首个段落以 [ ] / [x] 加空白开头；去掉标记并返回是否已完成 */
  private taskMarker(item: Block): { checked: boolean } | null {
    const first = item.children[0];
    if (!first || first.kind !== 'paragraph') return null;
    const match = /^\[([ xX])\](?:[ \t]+|\n)/.exec(first.content);
    if (!match) return null;
    first.content = first.content.slice(match[0].length);
    return { checked: match[1] !== ' ' };
  }

  private convertTable(block: Block, base: { position: Position; raw: string }, inline: InlineParser): TableNode {
    const lines = block.content.replace(/\n$/, '').split('\n');
    const columns = block.alignments.length;
    const row = (text: string, index: number, isHeader: boolean): TableRowNode => {
      const cells = splitTableRow(text);
      const line = block.startLine + (isHeader ? 0 : index + 2);
      return {
        type: BlockType.TableRow,
        position: base.position,
        raw: text,
        isHeader,
        cells: Array.from({ length: columns }, (_, column): TableCellNode => {
          const content = cells[column] ?? '';
          return {
            type: BlockType.TableCell,
            position: base.position,
            raw: content,
            content,
            isHeader,
            alignment: block.alignments[column] ?? null,
            inline: inline.parse(content, line),
          };
        }),
      };
    };
    const header = row(lines[0]!, 0, true);
    const rows = lines.slice(1).map((text, index) => row(text, index, false));
    return {
      type: BlockType.Table,
      ...base,
      alignments: block.alignments,
      header,
      rows,
    };
  }
}

/** 行内脚注引用按定义顺序编号 */
function assignFootnoteIndexes(node: BlockNode, footnotes: ReadonlyMap<string, number>): void {
  const visitInline = (nodes: InlineNode[] | undefined) => {
    for (const inlineNode of nodes ?? []) {
      if (inlineNode.type === InlineType.FootnoteRef && inlineNode.footnoteId) {
        const index = footnotes.get(inlineNode.footnoteId);
        if (index !== undefined) inlineNode.footnoteIndex = index;
      }
      visitInline(inlineNode.children);
    }
  };
  visitInline(node.inline);
  for (const child of node.children ?? []) assignFootnoteIndexes(child, footnotes);
  if (node.type === BlockType.Table) {
    const table = node as TableNode;
    for (const row of [table.header, ...table.rows]) for (const cell of row.cells) visitInline(cell.inline);
  }
}
