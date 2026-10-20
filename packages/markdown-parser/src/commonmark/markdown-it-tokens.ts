// ================================
// @code-reader/markdown-parser - markdown-it 兼容的 token 流
// 把语法树转成与 markdown-it 相同结构的扁平 token 序列（*_open / *_close 成对、inline 带 children、
// map 为 0 起的 [起始行, 结束行)），可以直接交给 prosemirror-markdown 等基于 markdown-it token 的工具。
// 比 markdown-it 多出的信息：每个 token 的 position 是源码中的绝对位置（行内 token 也有）。
// ================================

import { lineStartsOf } from './block-parser';
import { CommonMarkParser } from './commonmark-parser';
import { collectFootnotes } from './footnotes';
import { isSafeUrl, normalizeUrl } from './html-renderer';
import {
  BlockType,
  InlineType,
  type BlockNode,
  type CommonMarkOptions,
  type InlineNode,
  type Position,
  type TableAlignment,
  type TableCellNode,
  type TableNode,
} from './types';

/** 与 markdown-it 的 Token 字段一致 */
export class Token {
  attrs: Array<[string, string]> | null = null;
  /** 0 起的 [起始行, 结束行)；表格单元格的 inline token 为 null（与 markdown-it 一致） */
  map: [number, number] | null = null;
  level = 0;
  children: Token[] | null = null;
  content = '';
  markup = '';
  info = '';
  /** 附加数据：结构由产生该 token 的语法（任务列表项、脚注、扩展）决定，与 markdown-it 一样不限定类型 */
  meta: any = null;
  block = false;
  hidden = false;
  /** 源码中的绝对位置（markdown-it 没有） */
  position: Position | null = null;

  constructor(
    public type: string,
    public tag: string,
    public nesting: 1 | 0 | -1
  ) {}

  attrIndex(name: string): number {
    return this.attrs ? this.attrs.findIndex(([key]) => key === name) : -1;
  }

  attrGet(name: string): string | null {
    const index = this.attrIndex(name);
    return index === -1 ? null : this.attrs![index]![1];
  }

  attrSet(name: string, value: string): void {
    const index = this.attrIndex(name);
    if (index === -1) (this.attrs ??= []).push([name, value]);
    else this.attrs![index] = [name, value];
  }

  attrPush(attr: [string, string]): void {
    (this.attrs ??= []).push(attr);
  }
}

/** {…} 属性写入 token（与 markdown-it-attrs 相同，作为 attrs） */
function applyAttributes(token: Token, attributes: Record<string, string> | undefined): void {
  if (!attributes) return;
  for (const [name, value] of Object.entries(attributes)) token.attrSet(name, value);
}

/** 行内元素对应的 markdown-it token：类型前缀、标签、默认标记 */
const WRAPPED_INLINE: Partial<Record<InlineType, [string, string, string]>> = {
  [InlineType.Bold]: ['strong', 'strong', '**'],
  [InlineType.Italic]: ['em', 'em', '*'],
  [InlineType.Strikethrough]: ['s', 's', '~~'],
  [InlineType.Mark]: ['mark', 'mark', '=='],
  [InlineType.Insert]: ['ins', 'ins', '++'],
  [InlineType.Subscript]: ['sub', 'sub', '~'],
  [InlineType.Superscript]: ['sup', 'sup', '^'],
};

function alignStyle(alignment: TableAlignment): Array<[string, string]> | null {
  return alignment ? [['style', `text-align:${alignment}`]] : null;
}

/** 块的 0 起行范围 */
function blockMap(node: BlockNode): [number, number] {
  return [node.position.startLine - 1, node.position.endLine];
}

class TokenWriter {
  readonly tokens: Token[] = [];
  private level = 0;
  /** 各行起始偏移（只在列表需要判断空行时计算） */
  private lineStarts: number[] | null = null;

  constructor(private readonly source: string) {}

  /** 第 line 行（0 起）是否为空行；引用内只有 > 的行也是空行 */
  private isBlankLine(line: number, inQuote: boolean): boolean {
    const starts = (this.lineStarts ??= lineStartsOf(this.source));
    for (let i = starts[line] ?? this.source.length; i < this.source.length; i++) {
      const char = this.source[i];
      if (char === '\n' || char === '\r') return true;
      if (char !== ' ' && char !== '\t' && !(inQuote && char === '>')) return false;
    }
    return true;
  }

  /**
   * markdown-it 的列表项（与列表）一直延伸到其后第一个非空行之前：项之间、列表末尾的空行算在项内。
   * from 为 0 起的行号，limit 为所在容器的结束行
   */
  private skipBlankLines(from: number, limit: number, inQuote: boolean): number {
    let line = from;
    while (line < limit && this.isBlankLine(line, inQuote)) line++;
    return line;
  }

  push(type: string, tag: string, nesting: 1 | 0 | -1, node?: BlockNode): Token {
    const token = new Token(type, tag, nesting);
    token.block = true;
    if (nesting < 0) this.level--;
    token.level = this.level;
    if (nesting > 0) this.level++;
    if (node) {
      token.map = blockMap(node);
      token.position = node.position;
    }
    this.tokens.push(token);
    return token;
  }

  /** limit 为所在容器的结束行（0 起、不含），inQuote 表示在引用之内 */
  blocks(nodes: readonly BlockNode[], limit: number, inQuote = false, tightList = false): void {
    for (const node of nodes) this.block(node, limit, inQuote, tightList);
  }

  private block(node: BlockNode, limit: number, inQuote: boolean, tightList: boolean): void {
    switch (node.type) {
      case BlockType.Paragraph: {
        const open = this.push('paragraph_open', 'p', 1, node);
        open.hidden = tightList;
        applyAttributes(open, node.attributes);
        this.inline(node, node.content ?? '', node.inline ?? []);
        this.push('paragraph_close', 'p', -1).hidden = tightList;
        return;
      }
      case BlockType.Heading: {
        const tag = `h${node.level}`;
        const open = this.push('heading_open', tag, 1, node);
        open.markup = node.marker ?? '';
        applyAttributes(open, node.attributes);
        const inline = this.inline(node, node.content ?? '', node.inline ?? []);
        // Setext 标题的行内内容不含下划线那一行
        if (node.marker === '=' || node.marker === '-') inline.map = [inline.map![0], inline.map![1] - 1];
        this.push('heading_close', tag, -1).markup = node.marker ?? '';
        return;
      }
      case BlockType.ThematicBreak: {
        const token = this.push('hr', 'hr', 0, node);
        const raw = node.raw.replace(/[ \t]/g, '');
        token.markup = raw.trimEnd();
        return;
      }
      case BlockType.CodeBlock: {
        const token = this.push('code_block', 'code', 0, node);
        token.content = node.content ?? '';
        // 末尾的空行不属于代码块
        const lines = Math.max(1, token.content.split('\n').length - 1);
        token.map = [node.position.startLine - 1, node.position.startLine - 1 + lines];
        return;
      }
      case BlockType.FencedCode: {
        const token = this.push('fence', 'code', 0, node);
        token.content = node.content ?? '';
        token.markup = node.marker ?? '```';
        // 与 markdown-it 一致：信息串保留原样（未去转义、未去首尾空白）
        token.info = node.raw.split(/\r\n|\n|\r/, 1)[0]!.trimStart().slice(token.markup.length);
        return;
      }
      case BlockType.HtmlBlock: {
        this.push('html_block', '', 0, node).content = `${node.content ?? ''}\n`;
        return;
      }
      case BlockType.Blockquote:
        this.push('blockquote_open', 'blockquote', 1, node).markup = '>';
        this.blocks(node.children ?? [], node.position.endLine, true);
        this.push('blockquote_close', 'blockquote', -1).markup = '>';
        return;
      case BlockType.List: {
        const ordered = node.ordered === true;
        const type = ordered ? 'ordered_list' : 'bullet_list';
        const tag = ordered ? 'ol' : 'ul';
        const open = this.push(`${type}_open`, tag, 1, node);
        open.markup = node.marker ?? '';
        if (ordered && node.start !== undefined && node.start !== 1) open.attrSet('start', String(node.start));
        const items = node.children ?? [];
        let end = open.map![1];
        items.forEach((item, index) => {
          const itemOpen = this.push('list_item_open', 'li', 1, item);
          const next = items[index + 1];
          end = next ? next.position.startLine - 1 : this.skipBlankLines(item.position.endLine, limit, inQuote);
          itemOpen.map = [itemOpen.map![0], Math.max(itemOpen.map![1], end)];
          itemOpen.markup = item.marker ?? '';
          if (ordered) itemOpen.info = /^[ \t]*(\d+)/.exec(item.raw)?.[1] ?? String(item.start ?? '');
          if (item.type === BlockType.TaskListItem) itemOpen.meta = { checked: item.checked === true };
          this.blocks(item.children ?? [], limit, inQuote, node.tight === true);
          this.push('list_item_close', 'li', -1).markup = item.marker ?? '';
        });
        open.map = [open.map![0], Math.max(open.map![1], end)];
        this.push(`${type}_close`, tag, -1).markup = node.marker ?? '';
        return;
      }
      case BlockType.Table:
        this.table(node as TableNode);
        return;
      case BlockType.FootnoteDefinition:
        // 与 markdown-it-footnote 一致：定义的内容收集到文末（见 footnotes）
        return;
      case BlockType.FrontMatter: {
        // 与 markdown-it-front-matter 一致：meta 为 YAML 文本，渲染时隐藏
        const token = this.push('front_matter', '', 0, node);
        token.hidden = true;
        token.markup = node.raw;
        token.meta = node.content ?? '';
        return;
      }
      case BlockType.Container: {
        const name = node.name ?? '';
        const open = this.push(`container_${name}_open`, 'div', 1, node);
        open.markup = node.marker ?? ':::';
        open.info = node.info ?? '';
        // markdown-it-container 的 map 结束于闭合行之前（未闭合时到容器末尾）
        const lines = node.raw.split(/\r\n|\n|\r/);
        const closing = lines.length > 1 && new RegExp(`^[ \\t]*:{${open.markup.length},}[ \\t]*$`).test(lines[lines.length - 1]!);
        if (closing) open.map = [open.map![0], open.map![1] - 1];
        this.blocks(node.children ?? [], limit, inQuote);
        this.push(`container_${name}_close`, 'div', -1).markup = closing ? open.markup : '';
        return;
      }
      case BlockType.DefinitionList:
        this.definitionList(node, limit, inQuote);
        return;
      case BlockType.Extension: {
        const token = this.push(node.name ?? 'extension', 'div', 0, node);
        token.content = node.content ?? '';
        token.meta = node.data ?? null;
        return;
      }
      default:
        return;
    }
  }

  /**
   * 定义列表（与 markdown-it-deflist 的 token 与 map 相同）：术语的 map 为 [行, 行]；说明延伸到其后第一个非空行，
   * 新术语之后第一条说明的 map 从术语所在行开始
   */
  private definitionList(node: BlockNode, limit: number, inQuote: boolean): void {
    const open = this.push('dl_open', 'dl', 1, node);
    const children = node.children ?? [];
    let end = open.map![1];
    children.forEach((child, index) => {
      if (child.type === BlockType.DefinitionTerm) {
        const line = child.position.startLine - 1;
        const term = this.push('dt_open', 'dt', 1, child);
        term.map = [line, line];
        applyAttributes(term, child.attributes);
        this.inline(child, child.content ?? '', child.inline ?? []).map = [line, line];
        this.push('dt_close', 'dt', -1);
        return;
      }
      const previous = children[index - 1];
      const description = this.push('dd_open', 'dd', 1, child);
      const start = previous && previous.type === BlockType.DefinitionTerm && index > 1 ? previous.position.startLine - 1 : child.position.startLine - 1;
      const next = children[index + 1];
      end = next ? next.position.startLine - 1 : this.skipBlankLines(child.position.endLine, limit, inQuote);
      description.map = [start, end];
      this.blocks(child.children ?? [], limit, inQuote, child.tight === true);
      this.push('dd_close', 'dd', -1);
    });
    open.map = [open.map![0], end];
    this.push('dl_close', 'dl', -1);
  }

  /** 文末的脚注（与 markdown-it-footnote 的 token 相同）：回链 footnote_anchor 放在最后一个段落的 paragraph_close 之前 */
  footnotes(document: BlockNode): void {
    const entries = collectFootnotes(document);
    if (entries.length === 0) return;
    const plain = (type: string, nesting: 1 | 0 | -1, meta: unknown = null) => {
      const token = new Token(type, '', nesting);
      token.meta = meta;
      this.tokens.push(token);
    };
    plain('footnote_block_open', 1);
    for (const entry of entries) {
      const id = entry.index - 1;
      plain('footnote_open', 1, { id, label: entry.label });
      if (entry.inline) {
        // 行内脚注的段落由 markdown-it-footnote 用 new Token 创建：level 为 0，content 为原始内容
        const open = new Token('paragraph_open', 'p', 1);
        const inline = new Token('inline', '', 0);
        const close = new Token('paragraph_close', 'p', -1);
        open.block = close.block = true;
        inline.content = entry.text ?? '';
        inline.children = new InlineWriter(this.source).write(entry.inline);
        this.tokens.push(open, inline, close);
      } else {
        this.level = 1;
        this.blocks(entry.definition?.children ?? [], entry.definition?.position.endLine ?? 0);
        this.level = 0;
      }
      const last = this.tokens[this.tokens.length - 1];
      const paragraphClose = last && last.type === 'paragraph_close' ? this.tokens.pop() : undefined;
      for (let subId = 0; subId < entry.references; subId++) plain('footnote_anchor', 0, { id, subId, label: entry.label });
      if (paragraphClose) this.tokens.push(paragraphClose);
      plain('footnote_close', -1);
    }
    plain('footnote_block_close', -1);
  }

  private table(node: TableNode): void {
    const startLine = node.position.startLine - 1;
    this.push('table_open', 'table', 1, node);
    const row = (cells: TableCellNode[], line: number, header: boolean) => {
      const tr = this.push('tr_open', 'tr', 1);
      tr.map = [line, line + 1];
      for (const cell of cells) {
        const tag = header ? 'th' : 'td';
        this.push(`${tag}_open`, tag, 1).attrs = alignStyle(cell.alignment);
        const inline = this.inline(null, cell.content ?? '', cell.inline ?? []);
        inline.map = null;
        this.push(`${tag}_close`, tag, -1);
      }
      this.push('tr_close', 'tr', -1);
    };
    const thead = this.push('thead_open', 'thead', 1);
    thead.map = [startLine, startLine + 1];
    row(node.header.cells, startLine, true);
    this.push('thead_close', 'thead', -1);
    if (node.rows.length > 0) {
      const tbody = this.push('tbody_open', 'tbody', 1);
      tbody.map = [startLine + 2, node.position.endLine];
      node.rows.forEach((data, index) => row(data.cells, startLine + 2 + index, false));
      this.push('tbody_close', 'tbody', -1);
    }
    this.push('table_close', 'table', -1);
  }

  private inline(node: BlockNode | null, content: string, children: readonly InlineNode[]): Token {
    const token = this.push('inline', '', 0, node ?? undefined);
    token.content = content;
    token.children = new InlineWriter(this.source).write(children);
    return token;
  }
}

class InlineWriter {
  private readonly tokens: Token[] = [];
  private level = 0;

  constructor(private readonly source: string) {}

  write(nodes: readonly InlineNode[]): Token[] {
    for (const node of nodes) this.node(node);
    return this.tokens;
  }

  private push(type: string, tag: string, nesting: 1 | 0 | -1, node: InlineNode | null): Token {
    const token = new Token(type, tag, nesting);
    if (nesting < 0) this.level--;
    token.level = this.level;
    if (nesting > 0) this.level++;
    if (node) token.position = node.position;
    this.tokens.push(token);
    return token;
  }

  private text(content: string, node: InlineNode | null): void {
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.type === 'text') {
      last.content += content;
      return;
    }
    this.push('text', '', 0, node).content = content;
  }

  private wrap(node: InlineNode): void {
    const [type, tag, markup] = WRAPPED_INLINE[node.type]!;
    const open = this.push(`${type}_open`, tag, 1, node);
    open.markup = node.type === InlineType.Strikethrough ? markup : (node.marker ?? markup);
    applyAttributes(open, node.attributes);
    for (const child of node.children ?? []) this.node(child);
    this.push(`${type}_close`, tag, -1, null).markup = open.markup;
  }

  private node(node: InlineNode): void {
    if (WRAPPED_INLINE[node.type]) {
      this.wrap(node);
      return;
    }
    switch (node.type) {
      case InlineType.Text:
      case InlineType.Escape:
        this.text(node.content, node);
        return;
      case InlineType.SoftBreak:
        this.push('softbreak', 'br', 0, node);
        return;
      case InlineType.LineBreak:
        this.push('hardbreak', 'br', 0, node);
        return;
      case InlineType.Code: {
        const token = this.push('code_inline', 'code', 0, node);
        token.content = node.content;
        token.markup = node.marker ?? '`';
        applyAttributes(token, node.attributes);
        return;
      }
      case InlineType.BoldItalic:
        this.push('em_open', 'em', 1, node).markup = '*';
        this.wrap({ ...node, type: InlineType.Bold, marker: '**' });
        this.push('em_close', 'em', -1, null).markup = '*';
        return;
      case InlineType.Link: {
        const url = node.url ?? '';
        if (!isSafeUrl(url)) {
          this.text(this.source.slice(node.position.start, node.position.end), node);
          return;
        }
        const open = this.push('link_open', 'a', 1, node);
        open.attrSet('href', normalizeUrl(url));
        if (node.title) open.attrSet('title', node.title);
        applyAttributes(open, node.attributes);
        for (const child of node.children ?? []) this.node(child);
        this.push('link_close', 'a', -1, null);
        return;
      }
      case InlineType.AutoLink: {
        const url = node.url ?? node.content;
        if (!isSafeUrl(url)) {
          this.text(this.source.slice(node.position.start, node.position.end), node);
          return;
        }
        // 尖括号自动链接的 markup 为 autolink，裸网址为 linkify（与 markdown-it 一致）
        const markup = node.marker === 'linkify' ? 'linkify' : 'autolink';
        const open = this.push('link_open', 'a', 1, node);
        open.attrSet('href', normalizeUrl(url));
        open.markup = markup;
        open.info = 'auto';
        applyAttributes(open, node.attributes);
        const text = this.push('text', '', 0, node);
        text.content = node.content;
        const close = this.push('link_close', 'a', -1, null);
        close.markup = markup;
        close.info = 'auto';
        return;
      }
      case InlineType.Image: {
        const url = node.url ?? '';
        if (!isSafeUrl(url)) {
          this.text(this.source.slice(node.position.start, node.position.end), node);
          return;
        }
        const token = this.push('image', 'img', 0, node);
        token.attrs = [
          ['src', normalizeUrl(url)],
          ['alt', ''],
        ];
        if (node.title) token.attrSet('title', node.title);
        applyAttributes(token, node.attributes);
        const children = node.children ?? [];
        token.children = new InlineWriter(this.source).write(children);
        // 与 markdown-it 一致：content 为方括号内的原始文本
        const labelStart = node.position.start + 2;
        const labelEnd = children.length > 0 ? children[children.length - 1]!.position.end : labelStart;
        token.content = this.source.slice(labelStart, labelEnd);
        return;
      }
      case InlineType.Abbreviation: {
        // markdown-it-abbr 用 new Token 创建这三个 token，level 都是 0
        const tokens = [this.push('abbr_open', 'abbr', 1, node), this.push('text', '', 0, node), this.push('abbr_close', 'abbr', -1, null)];
        tokens[0]!.attrs = [['title', node.title ?? '']];
        tokens[1]!.content = node.content;
        for (const token of tokens) token.level = 0;
        return;
      }
      case InlineType.HtmlTag:
        this.push('html_inline', '', 0, node).content = node.content;
        return;
      case InlineType.FootnoteRef: {
        // 与 markdown-it-footnote 一致：id 从 0 开始；行内脚注只有 id
        const token = this.push('footnote_ref', '', 0, node);
        const id = (node.footnoteIndex ?? 1) - 1;
        token.meta = node.footnoteId === undefined ? { id } : { id, subId: node.footnoteSubId ?? 0, label: node.footnoteId };
        return;
      }
      case InlineType.Extension: {
        const token = this.push(node.name ?? 'extension', '', 0, node);
        token.content = node.content;
        token.meta = node.data ?? null;
        return;
      }
    }
  }
}

/**
 * 语法树 → markdown-it 兼容的 token 序列。
 * footnotes 为 false 时（解析时未开启脚注）跳过文末脚注的收集
 */
export function toMarkdownItTokens(source: string, document: BlockNode, { footnotes = true }: { footnotes?: boolean } = {}): Token[] {
  const writer = new TokenWriter(source);
  writer.blocks(document.children ?? [], document.position.endLine);
  if (footnotes) writer.footnotes(document);
  return writer.tokens;
}

/**
 * markdown-it 兼容的分词器：parse(src) 返回与 markdown-it 结构相同的 token 序列，
 * 可直接作为 prosemirror-markdown 的 MarkdownParser 的 tokenizer
 */
export class MarkdownItCompatTokenizer {
  private readonly parser: CommonMarkParser;

  constructor(options?: CommonMarkOptions) {
    this.parser = new CommonMarkParser(options);
  }

  parse(source: string, _env?: unknown): Token[] {
    const footnotes = this.parser.getOptions().footnotes !== false;
    return toMarkdownItTokens(source, this.parser.parse(source).document, { footnotes });
  }
}
