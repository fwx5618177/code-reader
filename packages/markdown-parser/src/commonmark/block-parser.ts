// ================================
// @code-reader/markdown-parser - 块级解析
// 按 CommonMark 规范的块级算法实现（与参考实现 commonmark.js 相同）：逐行处理，维护“打开的块”树——
// 先让每个打开的容器块（引用、列表项）尝试匹配本行的前缀，再尝试新块的开头，剩余部分作为文本加入
// 最深的叶子块；未匹配的块关闭（段落可以“惰性续行”）。制表符按 4 列制表位计算。
// GFM：表格、任务列表项、脚注定义。全文块级结构完成后统一解析行内内容（链接引用定义可以出现在使用之后）
// ================================

import {
  BlockType,
  type BlockExtension,
  type BlockExtensionLine,
  type BlockNode,
  type InlineNode,
  type LinkReference,
  type ParseWarning,
  type Position,
  type ResolvedOptions,
  type TableAlignment,
  type TableCellNode,
  type TableNode,
  type TableRowNode,
} from './types';
import { blockAttributes, placeBlockAttributes, THEMATIC_BREAK_WITH_ATTRIBUTES, trailingAttributes, type Attributes } from './attributes';
import { numberFootnotes } from './footnotes';
import { InlineParser, unescapeString, type InlineOrigin, type ReferenceMap } from './inline-parser';

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
/** 缩写定义 *[缩写]: 全称（缩写中不能有未转义的方括号） */
const ABBREVIATION_DEFINITION = /^\*\[((?:[^[\]\\]|\\.)+)\]:(.*)$/;
/** 自定义容器的开始 ::: 名称 参数 */
const CONTAINER_OPEN = /^(:{3,})(.*)$/;
const FRONT_MATTER_OPEN = /^---[ \t]*$/;
const FRONT_MATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
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
  | 'footnote_definition'
  | 'extension'
  | 'front_matter'
  | 'container'
  | 'deflist'
  | 'dt'
  | 'dd'
  /** 缩写定义行 */
  | 'abbr_def';

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
  /** content 各行在源码中的起始偏移与列（0 起），用于行内节点的绝对位置 */
  sources: number[] = [];
  columns: number[] = [];
  /** 块级扩展（kind 为 extension）及其数据、是否已在某行结束 */
  extension: BlockExtension | null = null;
  data: Record<string, unknown> | undefined = undefined;
  extensionClosed = false;
  /** 自定义容器的名称 */
  containerName = '';
  /** 围栏代码块信息串末尾的 {…} 属性 */
  attributes: Attributes | undefined = undefined;
  /** 缩写定义的缩写与全称 */
  abbreviation: { label: string; title: string } | null = null;

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

  remove(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.lastIndexOf(this), 1);
    this.parent = null;
  }
}

const CONTAINERS: ReadonlySet<BlockKind> = new Set(['document', 'block_quote', 'item', 'footnote_definition', 'container', 'dd']);
const ACCEPTS_LINES: ReadonlySet<BlockKind> = new Set(['paragraph', 'code_block', 'html_block', 'table']);

function canContain(parent: BlockKind, child: BlockKind): boolean {
  if (parent === 'list') return child === 'item';
  if (parent === 'deflist') return child === 'dd';
  return CONTAINERS.has(parent) && child !== 'item' && child !== 'dd';
}

const isSpaceOrTab = (char: string | undefined) => char === ' ' || char === '\t';

/** 块与下一个兄弟块之间隔着空行（列表松紧判断） */
function blankLineBetween(block: Block, next: Block | undefined): boolean {
  return next !== undefined && block.endLine !== next.startLine - 1;
}

// ================================
// GFM 表格
// ================================

/** 表格的一个单元格：内容（\| 已还原为 |）、在行内的起止偏移，以及被去掉的反斜杠在内容中的位置 */
interface TableCellSource {
  text: string;
  start: number;
  end: number;
  gaps: number[];
}

function splitTableRow(line: string): TableCellSource[] {
  let from = 0;
  let to = line.length;
  while (from < to && isSpaceOrTab(line[from])) from++;
  while (to > from && isSpaceOrTab(line[to - 1])) to--;
  if (line[from] === '|') from++;
  if (to > from && line[to - 1] === '|' && line[to - 2] !== '\\') to--;

  const cells: TableCellSource[] = [];
  const pushCell = (start: number, end: number) => {
    while (start < end && isSpaceOrTab(line[start])) start++;
    while (end > start && isSpaceOrTab(line[end - 1])) end--;
    let text = '';
    const gaps: number[] = [];
    let copied = start;
    for (let i = start; i < end; i++) {
      if (line.charCodeAt(i) === 92 /* \ */ && line.charCodeAt(i + 1) === 124 /* | */) {
        text += line.slice(copied, i);
        gaps.push(text.length);
        copied = i + 1;
        i++;
      }
    }
    cells.push({ text: text + line.slice(copied, end), start, end, gaps });
  };
  let cellStart = from;
  for (let i = from; i < to; i++) {
    const char = line.charCodeAt(i);
    if (char === 92 && line.charCodeAt(i + 1) === 124) {
      i++;
    } else if (char === 124) {
      pushCell(cellStart, i);
      cellStart = i + 1;
    }
  }
  pushCell(cellStart, to);
  return cells;
}

function parseDelimiterRow(line: string): TableAlignment[] | null {
  if (!/^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line.trim()) || !line.includes('-')) return null;
  if (!line.includes('|') && !/^[ \t]*:?-+:?[ \t]*$/.test(line)) return null;
  return splitTableRow(line).map(({ text }) => {
    const left = text.startsWith(':');
    const right = text.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
}

/** 块级解析的输出 */
export interface BlockParseOutput {
  document: BlockNode;
  warnings: ParseWarning[];
  references: Map<string, LinkReference>;
  abbreviations: Map<string, string>;
  footnotes: Set<string>;
  /** 出现引用定义、缩写定义、脚注定义的行（1 起）：增量解析据此判断全文定义是否可能变化 */
  definitionLines: number[];
  /** 是否出现过脚注引用（增量解析据此决定是否重新编号） */
  footnoteRefs: boolean;
}

/** 只解析文档一部分时（增量解析）沿用的全文定义 */
export interface BlockParseContext {
  references?: ReadonlyMap<string, LinkReference>;
  abbreviations?: ReadonlyMap<string, string>;
  footnotes?: ReadonlySet<string>;
  /** 输入是否从文档开头开始（只有文档开头才有 YAML 头部），默认是 */
  documentStart?: boolean;
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
  /** 当前行在源码中的起始偏移 */
  private lineStart = 0;

  private references: ReferenceMap = new Map();
  private abbreviations = new Map<string, string>();
  private footnoteLabels = new Set<string>();
  private definitionLines: number[] = [];
  private footnoteRefs = false;
  private warnings: ParseWarning[] = [];
  /** 最近一个空行的行号（定义列表的术语与说明之间可以隔一个空行） */
  private lastBlankLine = 0;
  /** 解析链接引用定义用的行内解析器（只在遇到以 [ 开头的段落时创建） */
  private referenceParser: InlineParser | null = null;
  /** 可能开始特殊块的行首字符（含块级扩展的触发字符） */
  private readonly maybeSpecial: RegExp;

  constructor(private readonly options: ResolvedOptions) {
    const triggers = options.blockExtensions.map((extension) => extension.trigger.replace(/[\\\]^-]/g, '\\$&')).join('');
    this.maybeSpecial = triggers ? new RegExp(`^[#\`~*+_=<>0-9-[|:${triggers}]`) : MAYBE_SPECIAL;
  }

  parse(input: string, context: BlockParseContext = {}): BlockParseOutput {
    this.document = new Block('document', 1, 1);
    this.tip = this.document;
    this.oldTip = this.document;
    this.lastMatchedContainer = this.document;
    this.lineNumber = 0;
    this.lastLineLength = 0;
    this.lastBlankLine = 0;
    this.references = new Map(context.references);
    this.abbreviations = new Map(context.abbreviations);
    this.footnoteLabels = new Set(context.footnotes);
    this.definitionLines = [];
    this.warnings = [];

    const lineStarts = lineStartsOf(input);
    // 按需切出每一行（不预先建立整篇的行数组，减少大文档的内存与垃圾回收）
    const lineAt = (index: number): string => {
      const start = lineStarts[index]!;
      const next = lineStarts[index + 1];
      if (next === undefined) return input.slice(start);
      return input.slice(start, next - (input.charCodeAt(next - 1) === 10 && input.charCodeAt(next - 2) === 13 ? 2 : 1));
    };
    let count = lineStarts.length;
    if (lineStarts[count - 1] === input.length && count > 1) count -= 1;
    const first = this.options.frontMatter && context.documentStart !== false ? this.frontMatter(lineAt, count) : 0;
    for (let i = first; i < count; i++) {
      this.lineStart = lineStarts[i]!;
      this.incorporateLine(lineAt(i));
    }
    while (this.tip !== this.document) this.finalize(this.tip, count);
    this.finalize(this.document, count);

    return {
      document: this.convert(this.document, input, lineStarts),
      warnings: this.warnings,
      references: this.references,
      abbreviations: this.abbreviations,
      footnotes: this.footnoteLabels,
      definitionLines: this.definitionLines,
      footnoteRefs: this.footnoteRefs,
    };
  }

  /** 文档开头的 YAML 头部：第一行为 ---，之后第一个 --- 或 ... 行结束；没有结束行时不是头部。返回正文的第一行 */
  private frontMatter(lineAt: (index: number) => string, count: number): number {
    if (count < 2 || !FRONT_MATTER_OPEN.test(lineAt(0))) return 0;
    let close = 1;
    while (close < count && !FRONT_MATTER_CLOSE.test(lineAt(close))) close++;
    if (close >= count) return 0;
    const block = new Block('front_matter', 1, 1);
    block.content = Array.from({ length: close - 1 }, (_, index) => lineAt(index + 1)).join('\n');
    block.open = false;
    block.endLine = close + 1;
    block.endColumn = lineAt(close).length;
    block.parent = this.document;
    this.document.children.push(block);
    this.lineNumber = close + 1;
    this.lastLineLength = block.endColumn;
    return close + 1;
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
    this.tip.sources.push(this.lineStart + this.offset);
    this.tip.columns.push(this.offset);
    if (this.tip.columns.length === 1 && this.tip.kind === 'paragraph') this.tip.startColumn = this.offset + 1;
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
      if (!this.indented && !this.maybeSpecial.test(this.currentLine.charAt(this.nextNonspace))) {
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
    if (this.blank) this.lastBlankLine = this.lineNumber;
  }

  /** 已打开的块能否继续：0 继续，1 不能，2 本行已处理完（如围栏结束） */
  private continueBlock(block: Block): 0 | 1 | 2 {
    const line = this.currentLine;
    switch (block.kind) {
      case 'document':
      case 'list':
      case 'deflist':
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
      case 'dd':
      case 'footnote_definition': {
        const width = block.listData ? block.listData.markerOffset + block.listData.padding : 4;
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
      case 'front_matter':
      case 'dt':
      case 'abbr_def':
        return 1;
      case 'container':
        return this.continueContainer(block);
      case 'extension':
        return this.continueExtension(block);
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
    // 按首字符筛选，只在可能匹配时才切出本行剩余部分
    const first = this.indented ? '' : line.charAt(this.nextNonspace);
    let restCache: string | null = null;
    const rest = () => (restCache ??= line.slice(this.nextNonspace));
    /** 本行会是引用中段落的惰性续行：与 markdown-it 一致，脚注与缩写定义不打断引用里的惰性续行（列表、脚注里的会打断） */
    const lazyInQuote = () =>
      container.kind !== 'paragraph' && !this.allClosed && !this.blank && this.tip.kind === 'paragraph' && this.unmatchedQuote();

    // 引用块
    if (first === '>' && !this.tooDeep(container)) {
      this.advanceNextNonspace();
      this.advanceOffset(1, false);
      if (isSpaceOrTab(line[this.offset])) this.advanceOffset(1, true);
      this.closeUnmatchedBlocks();
      this.addChild('block_quote', this.nextNonspace);
      return 1;
    }

    // ATX 标题
    let match: RegExpExecArray | null;
    if (first === '#' && (match = ATX_HEADING.exec(rest()))) {
      this.advanceNextNonspace();
      this.advanceOffset(match[0].length, false);
      this.closeUnmatchedBlocks();
      const heading = this.addChild('heading', this.nextNonspace);
      heading.level = match[0].trim().length;
      heading.content = line
        .slice(this.offset)
        .replace(/^[ \t]*#+[ \t]*$/, '')
        .replace(/[ \t]+#+[ \t]*$/, '');
      heading.sources = [this.lineStart + this.offset];
      heading.columns = [this.offset];
      this.advanceOffset(line.length - this.offset, false);
      return 2;
    }

    // 块级扩展
    if (!this.indented && this.options.blockExtensions.length > 0 && this.tryExtensionStart(container)) {
      return 2;
    }

    // 自定义容器 ::: 名称（与 markdown-it-container 一致，可以打断段落）
    if (this.options.containers && first === ':' && (match = CONTAINER_OPEN.exec(rest()))) {
      const name = match[2]!.trim().split(/\s+/)[0] ?? '';
      const allowed = this.options.containers === true || this.options.containers.includes(name);
      if (name && allowed && !this.tooDeep(container)) {
        this.closeUnmatchedBlocks();
        const block = this.addChild('container', this.nextNonspace);
        block.fenceLength = match[1]!.length;
        block.info = match[2]!;
        block.containerName = name;
        this.advanceOffset(line.length - this.offset, false);
        return 2;
      }
    }

    // 围栏代码块
    if ((first === '`' || first === '~') && (match = CODE_FENCE.exec(rest()))) {
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
    if (this.options.html && first === '<') {
      for (let type = 1; type <= 7; type++) {
        const open = HTML_BLOCK_OPEN[type - 1]!.exec(rest());
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
    if ((first === '=' || first === '-') && container.kind === 'paragraph' && (match = SETEXT_UNDERLINE.exec(rest()))) {
      this.closeUnmatchedBlocks();
      this.consumeReferenceDefinitions(container);
      if (container.content.length > 0) {
        const heading = new Block('heading', container.startLine, container.startColumn);
        heading.level = match[0][0] === '=' ? 1 : 2;
        heading.content = container.content;
        heading.sources = container.sources;
        heading.columns = container.columns;
        heading.fenceChar = match[0][0]!;
        heading.parent = container.parent;
        const siblings = container.parent!.children;
        siblings[siblings.lastIndexOf(container)] = heading;
        this.tip = heading;
        this.advanceOffset(line.length - this.offset, false);
        return 2;
      }
      return 0;
    }

    // GFM 表格：只有一行的段落 + 分隔行，列数一致
    if (
      this.options.gfm &&
      (first === '|' || first === ':' || first === '-') &&
      container.kind === 'paragraph' &&
      container.content.indexOf('\n') === container.content.length - 1
    ) {
      const alignments = parseDelimiterRow(rest());
      const header = splitTableRow(container.content.slice(0, -1));
      if (alignments && header.length === alignments.length && container.content.includes('|')) {
        this.closeUnmatchedBlocks();
        const table = new Block('table', container.startLine, container.startColumn);
        table.alignments = alignments;
        table.content = container.content;
        table.sources = container.sources;
        table.columns = container.columns;
        table.parent = container.parent;
        const siblings = container.parent!.children;
        siblings[siblings.lastIndexOf(container)] = table;
        this.tip = table;
        this.advanceOffset(line.length - this.offset, false);
        return 2;
      }
    }

    // 主题分隔线
    if ((first === '*' || first === '_' || first === '-') && THEMATIC_BREAK.test(rest())) {
      this.closeUnmatchedBlocks();
      this.addChild('thematic_break', this.nextNonspace);
      this.advanceOffset(line.length - this.offset, false);
      return 2;
    }

    // GFM 脚注定义（可以打断段落，但不打断惰性续行）
    if (this.options.footnotes && first === '[' && !lazyInQuote() && (match = FOOTNOTE_DEFINITION.exec(rest()))) {
      if (!this.tooDeep(container)) {
        this.closeUnmatchedBlocks();
        const footnote = this.addChild('footnote_definition', this.nextNonspace);
        footnote.footnoteId = match[1]!;
        this.footnoteLabels.add(footnote.footnoteId);
        this.definitionLines.push(this.lineNumber);
        this.advanceNextNonspace();
        this.advanceOffset(match[0].length, false);
        return 1;
      }
    }

    // 缩写定义 *[缩写]: 全称（一行；可以打断段落）
    if (this.options.abbreviations && first === '*' && line[this.nextNonspace + 1] === '[' && !lazyInQuote() && (match = ABBREVIATION_DEFINITION.exec(rest()))) {
      const label = match[1]!.replace(/\\(.)/g, '$1');
      const title = match[2]!.trim();
      if (title) {
        this.closeUnmatchedBlocks();
        this.addChild('abbr_def', this.nextNonspace).abbreviation = { label, title };
        if (!this.abbreviations.has(label)) this.abbreviations.set(label, title);
        this.definitionLines.push(this.lineNumber);
        this.advanceOffset(line.length - this.offset, false);
        return 2;
      }
    }

    // 定义列表的说明 : / ~（术语是之前的单行段落）
    if (this.options.definitionLists && (first === ':' || first === '~') && this.tryDefinitionStart(container)) {
      return 1;
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

  // ---------- 块级扩展 ----------

  /** 本行没有匹配上的打开的块中是否有引用（此时本行是引用里段落的惰性续行） */
  private unmatchedQuote(): boolean {
    for (let block: Block | null = this.tip; block && block !== this.lastMatchedContainer; block = block.parent) {
      if (block.kind === 'block_quote') return true;
    }
    return false;
  }

  /** 在本行尝试开始块级扩展；成功时整行由扩展消耗 */
  private tryExtensionStart(container: Block): boolean {
    const line = this.currentLine;
    const rest = line.slice(this.nextNonspace);
    const lazyParagraph = container.kind === 'paragraph' || (!this.allClosed && !this.blank && this.tip.kind === 'paragraph');
    const firstInListItem = container.kind === 'item' && container.children.length === 0;
    for (const extension of this.options.blockExtensions) {
      if (!rest.startsWith(extension.trigger)) continue;
      if (lazyParagraph && !extension.interruptsParagraph) continue;
      const result = extension.open(rest, { firstInListItem });
      if (!result) continue;
      this.closeUnmatchedBlocks();
      const block = this.addChild('extension', this.nextNonspace);
      block.extension = extension;
      this.addExtensionLine(block, result);
      // 没有续行处理的扩展只有一行
      if (!extension.next) block.extensionClosed = true;
      this.advanceOffset(line.length - this.offset, false);
      return true;
    }
    return false;
  }

  /** 已打开的扩展块处理后续一行：已结束则不再匹配；否则整行交给扩展 */
  private continueExtension(block: Block): 1 | 2 {
    if (block.extensionClosed) return 1;
    this.addExtensionLine(block, block.extension!.next!(this.currentLine.slice(this.offset)));
    this.lastLineLength = this.currentLine.length;
    return 2;
  }

  private addExtensionLine(block: Block, result: BlockExtensionLine): void {
    if (result.content !== undefined) {
      block.content += (block.sources.length > 0 ? '\n' : '') + result.content;
      block.sources.push(this.lineStart + this.offset);
      block.columns.push(this.offset);
    }
    if (result.data) block.data = { ...block.data, ...result.data };
    if (result.closed) block.extensionClosed = true;
  }

  // ---------- 自定义容器与定义列表 ----------

  /** 容器在不少于开头冒号数、之后只有空白的 ::: 行结束（先关闭内部打开的块）；其余行继续属于容器 */
  private continueContainer(block: Block): 0 | 2 {
    const line = this.currentLine;
    if (this.indented || line[this.nextNonspace] !== ':') return 0;
    const fence = /^:+/.exec(line.slice(this.nextNonspace))![0];
    if (fence.length < block.fenceLength || /\S/.test(line.slice(this.nextNonspace + fence.length))) return 0;
    while (this.tip !== block) this.finalize(this.tip, this.lineNumber - 1);
    this.lastLineLength = line.length;
    this.finalize(block, this.lineNumber);
    return 2;
  }

  /**
   * 定义列表的说明行（: 或 ~ 后跟空白或行尾）。与 markdown-it-deflist 一致，术语是紧邻的单行段落（紧凑），
   * 或隔一个空行的单行段落（松散）；紧跟在定义列表后的术语并入同一个列表，一个术语可以有多条说明。
   * 说明的续行需要缩进到标记之后两列
   */
  private tryDefinitionStart(container: Block): boolean {
    const line = this.currentLine;
    const marker = line[this.nextNonspace];
    if (marker !== ':' && marker !== '~') return false;
    if (!(line[this.nextNonspace + 1] === undefined || isSpaceOrTab(line[this.nextNonspace + 1]))) return false;

    let list: Block;
    let tight: boolean;
    if (container.kind === 'deflist') {
      // 同一术语的另一条说明
      const previous = container.last;
      if (!previous || previous.kind !== 'dd') return false;
      this.closeUnmatchedBlocks();
      list = container;
      tight = previous.listData!.tight;
    } else {
      const singleLine = (block: Block | undefined): block is Block =>
        block !== undefined && block.kind === 'paragraph' && block.content.indexOf('\n') === block.content.length - 1;
      if (container.kind === 'paragraph' && singleLine(container)) {
        tight = true;
        container.endLine = container.startLine;
        container.endColumn = this.lastLineLength;
        this.tip = container.parent!;
        this.oldTip = this.tip;
        this.lastMatchedContainer = this.tip;
        this.allClosed = true;
        list = this.makeTerm(container);
      } else if (
        container.kind !== 'paragraph' &&
        (this.allClosed || this.tip === container) &&
        singleLine(container.last) &&
        !container.last.open &&
        container.last.endLine === this.lineNumber - 2 &&
        this.lastBlankLine === this.lineNumber - 1
      ) {
        tight = false;
        this.closeUnmatchedBlocks();
        list = this.makeTerm(container.last);
      } else {
        return false;
      }
      this.tip = list;
    }

    const description = this.addChild('dd', this.nextNonspace);
    description.listData = {
      type: 'bullet',
      bulletChar: marker,
      start: 1,
      delimiter: null,
      padding: 2,
      markerOffset: this.indent,
      tight,
    };
    this.advanceNextNonspace();
    this.advanceOffset(1, true);
    // 标记后的空白全部属于标记；超过 4 列时只算一列，其余是缩进代码
    const spacesStart = this.column;
    this.findNextNonspace();
    if (this.blank || this.nextNonspaceColumn - spacesStart < 5) this.advanceNextNonspace();
    else this.advanceOffset(1, true);
    return true;
  }

  /** 单行段落变为术语：紧跟在定义列表之后时并入该列表（重新打开），否则在原位置新建列表 */
  private makeTerm(paragraph: Block): Block {
    const parent = paragraph.parent!;
    const siblings = parent.children;
    const index = siblings.lastIndexOf(paragraph);
    const previous = siblings[index - 1];
    let list: Block;
    if (previous && previous.kind === 'deflist') {
      list = previous;
      list.open = true;
      siblings.splice(index, 1);
    } else {
      list = new Block('deflist', paragraph.startLine, paragraph.startColumn);
      list.parent = parent;
      siblings[index] = list;
    }
    paragraph.kind = 'dt';
    paragraph.open = false;
    paragraph.parent = list;
    list.children.push(paragraph);
    return list;
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

  /** 段落开头的链接引用定义：登记并从内容中去掉（连同对应行的源码位置） */
  private consumeReferenceDefinitions(paragraph: Block): boolean {
    let found = false;
    while (paragraph.content.startsWith('[')) {
      this.referenceParser ??= new InlineParser(this.options);
      const definition = this.referenceParser.parseReference(paragraph.content);
      if (!definition) break;
      if (!this.references.has(definition.label)) {
        this.references.set(definition.label, { url: definition.url, title: definition.title });
      }
      this.definitionLines.push(paragraph.startLine);
      const consumedLines = paragraph.content.slice(0, definition.length).split('\n').length - 1;
      paragraph.sources = paragraph.sources.slice(consumedLines);
      paragraph.columns = paragraph.columns.slice(consumedLines);
      paragraph.content = paragraph.content.slice(definition.length);
      // 段落（或由它变成的 Setext 标题）从定义之后开始；定义占满已有的行时，列在下一行加入时确定
      if (consumedLines > 0) {
        paragraph.startLine += consumedLines;
        if (paragraph.columns.length > 0) paragraph.startColumn = paragraph.columns[0]! + 1;
      }
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
          let info = block.content.slice(0, newline).trimStart();
          // ```py {.cls data-x=1}：末尾的 {…} 是代码块的属性（与 markdown-it-attrs 一致，} 之后不能再有字符）
          const found = this.options.attributes ? trailingAttributes(info) : null;
          if (found) {
            block.attributes = found.attributes;
            info = info.slice(0, info.length - found.length);
          }
          block.info = unescapeString(info.trim());
          block.content = block.content.slice(newline + 1);
        } else {
          block.content = block.content.replace(/(\n *)+$/, '\n');
        }
        break;
      case 'html_block':
        block.content = block.content.replace(/(\n *)+$/, '');
        break;
      case 'item':
      case 'dd':
      case 'footnote_definition':
        if (block.last) {
          block.endLine = block.last.endLine;
          block.endColumn = block.last.endColumn;
        } else if (block.listData) {
          block.endLine = block.startLine;
          block.endColumn = block.listData.markerOffset + block.listData.padding;
        }
        break;
      case 'deflist':
        if (block.last) {
          block.endLine = block.last.endLine;
          block.endColumn = block.last.endColumn;
        }
        break;
      case 'list': {
        const data = block.listData!;
        const items = block.children;
        for (let i = 0; i < items.length && data.tight; i++) {
          const item = items[i]!;
          if (blankLineBetween(item, items[i + 1])) data.tight = false;
          for (let j = 0; j < item.children.length - 1; j++) {
            if (blankLineBetween(item.children[j]!, item.children[j + 1])) data.tight = false;
          }
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
    const inline = new InlineParser(this.options, {
      references: this.references,
      footnotes: this.footnoteLabels,
      abbreviations: this.abbreviations,
    });

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

    const inlineOf = (block: Block, content: string): InlineNode[] => {
      // 开头的空白（可能跨行）不在行内内容里：换算到对应行的起始位置
      const raw = block.content;
      let lead = 0;
      let leadLines = 0;
      let leadColumns = 0;
      while (lead < raw.length && /\s/.test(raw[lead]!)) {
        if (raw[lead] === '\n') {
          leadLines++;
          leadColumns = 0;
        } else {
          leadColumns++;
        }
        lead++;
      }
      if (block.sources.length === 0) return inline.parse(content, block.startLine);
      const starts = leadLines === 0 && leadColumns === 0 ? block.sources : block.sources.slice(leadLines);
      const columns = leadLines === 0 && leadColumns === 0 ? block.columns : block.columns.slice(leadLines);
      if (leadColumns > 0 && starts.length > 0) {
        starts[0]! += leadColumns;
        columns[0]! += leadColumns;
      }
      const origin: InlineOrigin = { startLine: block.startLine + leadLines, starts, columns };
      return inline.parse(content, starts.length > 0 ? origin : block.startLine);
    };

    /** {…} 单独占一行的段落（属性可能属于外层的块，见 placeBlockAttributes） */
    const ownLine = new Set<BlockNode>();

    /** 段落、标题、术语：行内内容，末尾的 {…} 作为块的属性 */
    const textual = (node: BlockNode, block: Block): BlockNode => {
      const content = block.content.trim();
      const nodes = inlineOf(block, content);
      const found = this.options.attributes ? blockAttributes(nodes) : null;
      if (found && node.type === BlockType.Paragraph && THEMATIC_BREAK_WITH_ATTRIBUTES.test(content)) {
        node.type = BlockType.ThematicBreak;
        node.attributes = found.attributes;
        return node;
      }
      node.content = found ? content.slice(0, content.length - found.length).trimEnd() : content;
      node.inline = nodes;
      if (found) {
        node.attributes = found.attributes;
        if (found.ownLine) ownLine.add(node);
      }
      return node;
    };

    const visitAll = (blocks: readonly Block[], tight = false): BlockNode[] => {
      const result = new Array<BlockNode>(blocks.length);
      for (let i = 0; i < blocks.length; i++) result[i] = visit(blocks[i]!, tight);
      return result;
    };

    const visit = (block: Block, tight: boolean): BlockNode => {
      if (block.kind === 'document') {
        return { type: BlockType.Document, position: documentPosition(input, lineStarts), raw: input, children: visitAll(block.children) };
      }
      const pos = position(block);
      const create = (type: BlockType): BlockNode => ({ type, position: pos, raw: input.slice(pos.start, pos.end) });
      switch (block.kind) {
        case 'paragraph':
          return textual(create(BlockType.Paragraph), block);
        case 'heading': {
          const node = create(BlockType.Heading);
          node.level = block.level;
          node.marker = block.fenceChar || '#'.repeat(block.level);
          return textual(node, block);
        }
        case 'dt':
          return textual(create(BlockType.DefinitionTerm), block);
        case 'deflist': {
          const node = create(BlockType.DefinitionList);
          node.children = visitAll(block.children);
          return node;
        }
        case 'dd': {
          const node = create(BlockType.DefinitionDescription);
          const children = visitAll(block.children);
          node.marker = block.listData!.bulletChar!;
          // 与 markdown-it-deflist 一致：术语与说明之间没有空行、说明只有一个段落时不加 <p>
          node.tight = block.listData!.tight && children.length === 1 && children[0]!.type === BlockType.Paragraph;
          node.children = children;
          return node;
        }
        case 'front_matter': {
          const node = create(BlockType.FrontMatter);
          node.marker = '---';
          node.content = block.content;
          return node;
        }
        case 'container': {
          const node = create(BlockType.Container);
          node.name = block.containerName;
          node.info = block.info;
          node.marker = ':'.repeat(block.fenceLength);
          node.children = visitAll(block.children);
          return node;
        }
        case 'abbr_def': {
          const node = create(BlockType.AbbreviationDefinition);
          node.label = block.abbreviation!.label;
          node.content = block.abbreviation!.title;
          return node;
        }
        case 'thematic_break':
          return create(BlockType.ThematicBreak);
        case 'code_block': {
          const node = create(block.fenced ? BlockType.FencedCode : BlockType.CodeBlock);
          node.content = block.content;
          if (block.fenced) {
            node.marker = block.fenceChar.repeat(block.fenceLength);
            node.info = block.info;
          }
          const language = block.info.split(/\s+/)[0];
          if (language) node.language = language;
          if (block.attributes) node.attributes = block.attributes;
          return node;
        }
        case 'extension': {
          const node = create(BlockType.Extension);
          node.name = block.extension!.name;
          node.content = block.content;
          if (block.data) node.data = block.data;
          return node;
        }
        case 'html_block': {
          const node = create(BlockType.HtmlBlock);
          node.content = block.content;
          return node;
        }
        case 'block_quote': {
          const node = create(BlockType.Blockquote);
          node.children = visitAll(block.children);
          return node;
        }
        case 'list': {
          const data = block.listData!;
          const node = create(BlockType.List);
          node.ordered = data.type === 'ordered';
          if (data.type === 'ordered') node.start = data.start;
          node.marker = data.bulletChar ?? data.delimiter ?? '';
          node.tight = data.tight;
          node.children = visitAll(block.children, data.tight);
          return node;
        }
        case 'item': {
          const task = this.options.taskLists ? this.taskMarker(block) : null;
          const data = block.listData!;
          const node = create(task ? BlockType.TaskListItem : BlockType.ListItem);
          node.marker = data.bulletChar ?? data.delimiter ?? '';
          if (data.type === 'ordered') node.start = data.start;
          if (task) node.checked = task.checked;
          node.children = visitAll(block.children, tight);
          return node;
        }
        case 'table':
          return this.convertTable(block, { position: pos, raw: input.slice(pos.start, pos.end) }, inline);
        case 'footnote_definition': {
          const node = create(BlockType.FootnoteDefinition);
          node.footnoteId = block.footnoteId;
          node.children = visitAll(block.children);
          return node;
        }
      }
    };

    const document = visit(root, false);
    if (this.options.attributes) placeBlockAttributes(document, ownLine);
    this.footnoteRefs = inline.sawFootnotes;
    if (this.options.footnotes && this.footnoteRefs) numberFootnotes(document);
    return document;
  }

  /** GFM 任务列表项：首个段落以 [ ] / [x] 加空白开头；去掉标记（连同源码位置）并返回是否已完成 */
  private taskMarker(item: Block): { checked: boolean } | null {
    const first = item.children[0];
    if (!first || first.kind !== 'paragraph') return null;
    const match = /^\[([ xX])\](?:[ \t]+|\n)/.exec(first.content);
    if (!match) return null;
    first.content = first.content.slice(match[0].length);
    if (match[0].endsWith('\n')) {
      first.sources = first.sources.slice(1);
      first.columns = first.columns.slice(1);
    } else if (first.sources.length > 0) {
      first.sources[0]! += match[0].length;
      first.columns[0]! += match[0].length;
    }
    return { checked: match[1] !== ' ' };
  }

  private convertTable(block: Block, base: { position: Position; raw: string }, inline: InlineParser): TableNode {
    const lines = block.content.replace(/\n$/, '').split('\n');
    const columns = block.alignments.length;
    const row = (text: string, index: number, isHeader: boolean): TableRowNode => {
      // content 与 sources 不含分隔行（开表时已整行消耗），数据行在源码中的行号要跳过它
      const sourceIndex = isHeader ? 0 : index + 1;
      const line = block.startLine + (isHeader ? 0 : index + 2);
      const source = block.sources[sourceIndex] ?? base.position.start;
      const column = (block.columns[sourceIndex] ?? 0) + 1;
      const span = (from: number, to: number): Position => ({
        start: source + from,
        end: source + to,
        startLine: line,
        startColumn: column + from,
        endLine: line,
        endColumn: column + to,
      });
      const cells = splitTableRow(text);
      return {
        type: BlockType.TableRow,
        position: span(0, text.length),
        raw: text,
        isHeader,
        cells: Array.from({ length: columns }, (_, cellIndex): TableCellNode => {
          const cell = cells[cellIndex] ?? { text: '', start: text.length, end: text.length, gaps: [] };
          const origin: InlineOrigin = { startLine: line, starts: [source + cell.start], columns: [column - 1 + cell.start], gaps: cell.gaps };
          const nodes = inline.parse(cell.text, origin);
          const found = this.options.attributes ? blockAttributes(nodes) : null;
          const node: TableCellNode = {
            type: BlockType.TableCell,
            position: span(cell.start, cell.end),
            raw: text.slice(cell.start, cell.end),
            content: found ? cell.text.slice(0, cell.text.length - found.length) : cell.text,
            isHeader,
            alignment: block.alignments[cellIndex] ?? null,
            inline: nodes,
          };
          if (found) node.attributes = found.attributes;
          return node;
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

/** 各行在源码中的起始偏移（换行为 \r\n、\n 或 \r） */
export function lineStartsOf(input: string): number[] {
  const starts = [0];
  // 常见情况只有 \n：用原生的 indexOf 跳过整行，比逐字符判断快数倍
  if (input.indexOf('\r') === -1) {
    for (let at = input.indexOf('\n'); at !== -1; at = input.indexOf('\n', at + 1)) starts.push(at + 1);
    return starts;
  }
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 10 /* \n */) {
      starts.push(i + 1);
    } else if (code === 13 /* \r */) {
      if (input.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

/** 文档节点的位置：覆盖整个输入；末尾换行之后的空行不算一行 */
export function documentPosition(input: string, lineStarts: readonly number[]): Position {
  const trailingEmpty = lineStarts.length > 1 && lineStarts[lineStarts.length - 1] === input.length;
  const endLine = Math.max(1, lineStarts.length - (trailingEmpty ? 1 : 0));
  return {
    start: 0,
    end: input.length,
    startLine: 1,
    startColumn: 1,
    endLine,
    endColumn: input.length - lineStarts[endLine - 1]! + 1,
  };
}
