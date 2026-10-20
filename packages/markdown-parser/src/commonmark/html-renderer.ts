// ================================
// @code-reader/markdown-parser - HTML 渲染
// 按 CommonMark 参考实现（commonmark.js）的 HTML 约定输出：块级元素各占一行，
// 紧凑列表中的段落不加 <p>，URL 做百分号编码，文本与属性做 HTML 转义。
// 扩展语法的输出与 markdown-it 对应插件一致（脚注收集到文末、定义列表、自定义容器、高亮等）。
// 不安全的链接（javascript: 等）输出空地址；扩展节点、代码高亮可以自定义
// ================================

import { collectFootnotes, type FootnoteEntry } from './footnotes';
import { BlockType, InlineType, type BlockNode, type InlineNode, type TableNode } from './types';

/** HTML 转义（文本与属性值） */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;'
  );
}

/** 不需要编码的 URL（只含结构字符与合法的 %XX） */
const ENCODED_URL = /^(?:[A-Za-z0-9\-._~:/?#@!$&'()*+,;=]|%[0-9a-fA-F]{2})*$/;

/**
 * URL 百分号编码：保留 URL 的结构字符与已有的 %XX，其余（空格、非 ASCII、反斜杠等）按 UTF-8 编码
 */
export function normalizeUrl(url: string): string {
  if (ENCODED_URL.test(url)) return url;
  let result = '';
  for (let i = 0; i < url.length; i++) {
    const char = url[i]!;
    if (char === '%' && /^[0-9a-fA-F]{2}$/.test(url.slice(i + 1, i + 3))) {
      result += url.slice(i, i + 3);
      i += 2;
    } else if (/[A-Za-z0-9\-._~:/?#@!$&'()*+,;=]/.test(char)) {
      result += char;
    } else {
      const code = url.codePointAt(i)!;
      const symbol = String.fromCodePoint(code);
      result += encodeURIComponent(symbol);
      i += symbol.length - 1;
    }
  }
  return result;
}

const BAD_PROTOCOL = /^(?:vbscript|javascript|file|data):/;
const GOOD_DATA = /^data:image\/(?:gif|png|jpeg|webp);/;

/** 与 markdown-it 默认规则相同：拒绝 javascript: vbscript: file: 与 data:（常见图片格式的 data: 除外） */
export function isSafeUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return !BAD_PROTOCOL.test(normalized) || GOOD_DATA.test(normalized);
}

/** 自定义扩展节点渲染时可用的工具 */
export interface ExtensionRenderContext {
  escapeHtml(text: string): string;
  /** 渲染一组行内节点 */
  renderInline(nodes: readonly InlineNode[]): string;
}

/** HTML 渲染选项 */
export interface HtmlRenderOptions {
  /** 空元素写成 <br />、<hr />（默认 true，与 commonmark.js 一致）；false 时写成 <br> */
  xhtmlOut?: boolean;
  /** 代码块语言的 class 前缀（默认 language-） */
  langPrefix?: string;
  /** 代码高亮：返回高亮后的 HTML（以 <pre 开头时整体替换代码块）；返回空值时按默认转义输出 */
  highlight?: (code: string, language: string, info: string) => string | null | undefined;
  /** 链接与图片地址是否安全；不安全时地址输出为空（默认 isSafeUrl） */
  validateLink?: (url: string) => boolean;
  /** 扩展节点（InlineType / BlockType 为 Extension）按节点名渲染；未提供的输出带 data-extension 的 span / div */
  extensions?: Readonly<Record<string, (node: InlineNode | BlockNode, context: ExtensionRenderContext) => string>>;
}

/** 输出缓冲：分段收集，记住最后一个字符（在不断增长的字符串上调用 endsWith 会反复拍平字符串，大文档变成平方级） */
class HtmlWriter {
  private readonly parts: string[] = [];
  private lastChar = '';

  /** 换行（已在行首时不重复） */
  cr(): void {
    if (this.lastChar !== '' && this.lastChar !== '\n') this.write('\n');
  }

  write(text: string): void {
    if (!text) return;
    this.parts.push(text);
    this.lastChar = text[text.length - 1]!;
  }

  toString(): string {
    return this.parts.join('');
  }
}

/** {…} 属性 → HTML 属性串 */
function attributeString(attributes: Record<string, string> | undefined): string {
  if (!attributes) return '';
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
}

/** 行内节点的纯文本（图片的 alt 属性用） */
function plainText(nodes: readonly InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === InlineType.Image) return node.children ? plainText(node.children) : (node.alt ?? '');
      if (node.type === InlineType.LineBreak || node.type === InlineType.SoftBreak) return '\n';
      return node.children ? plainText(node.children) : node.content;
    })
    .join('');
}

const INLINE_TAGS: Partial<Record<InlineType, string>> = {
  [InlineType.Bold]: 'strong',
  [InlineType.Italic]: 'em',
  [InlineType.Strikethrough]: 'del',
  [InlineType.Mark]: 'mark',
  [InlineType.Insert]: 'ins',
  [InlineType.Subscript]: 'sub',
  [InlineType.Superscript]: 'sup',
};

class HtmlRenderer {
  private readonly xhtml: boolean;
  private readonly langPrefix: string;
  private readonly validateLink: (url: string) => boolean;
  private readonly context: ExtensionRenderContext = {
    escapeHtml,
    renderInline: (nodes) => this.inline(nodes),
  };

  constructor(private readonly options: HtmlRenderOptions) {
    this.xhtml = options.xhtmlOut ?? true;
    this.langPrefix = options.langPrefix ?? 'language-';
    this.validateLink = options.validateLink ?? isSafeUrl;
  }

  private get close(): string {
    return this.xhtml ? ' />' : '>';
  }

  private url(url: string): string {
    return this.validateLink(url) ? escapeHtml(normalizeUrl(url)) : '';
  }

  private extension(node: InlineNode | BlockNode, block: boolean): string {
    const render = node.name ? this.options.extensions?.[node.name] : undefined;
    if (render) return render(node, this.context);
    const tag = block ? 'div' : 'span';
    return `<${tag} data-extension="${escapeHtml(node.name ?? '')}">${escapeHtml(node.content ?? '')}</${tag}>`;
  }

  inline(nodes: readonly InlineNode[] | undefined): string {
    let out = '';
    for (const node of nodes ?? []) {
      const attributes = attributeString(node.attributes);
      const children = () => (node.children ? this.inline(node.children) : escapeHtml(node.content));
      const tag = INLINE_TAGS[node.type];
      if (tag) {
        out += `<${tag}${attributes}>${children()}</${tag}>`;
        continue;
      }
      switch (node.type) {
        case InlineType.Text:
        case InlineType.Escape:
          out += escapeHtml(node.content);
          break;
        case InlineType.BoldItalic:
          out += `<em${attributes}><strong>${children()}</strong></em>`;
          break;
        case InlineType.Code:
          out += `<code${attributes}>${escapeHtml(node.content)}</code>`;
          break;
        case InlineType.Link: {
          const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
          out += `<a href="${this.url(node.url ?? '')}"${title}${attributes}>${children()}</a>`;
          break;
        }
        case InlineType.Image: {
          const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
          const alt = node.children ? plainText(node.children) : (node.alt ?? node.content);
          out += `<img src="${this.url(node.url ?? '')}" alt="${escapeHtml(alt)}"${title}${attributes}${this.close}`;
          break;
        }
        case InlineType.AutoLink:
          out += `<a href="${this.url(node.url ?? node.content)}"${attributes}>${escapeHtml(node.content)}</a>`;
          break;
        case InlineType.Abbreviation:
          out += `<abbr title="${escapeHtml(node.title ?? '')}">${escapeHtml(node.content)}</abbr>`;
          break;
        case InlineType.HtmlTag:
          out += node.content;
          break;
        case InlineType.LineBreak:
          out += `<br${this.close}\n`;
          break;
        case InlineType.SoftBreak:
          out += '\n';
          break;
        case InlineType.FootnoteRef: {
          const id = footnoteRefId(node.footnoteIndex ?? 0, node.footnoteSubId ?? 0);
          out += `<sup class="footnote-ref"><a href="#fn${node.footnoteIndex}" id="fnref${id}">[${id}]</a></sup>`;
          break;
        }
        case InlineType.Extension:
          out += this.extension(node, false);
          break;
      }
    }
    return out;
  }

  private table(table: TableNode, writer: HtmlWriter): void {
    const cell = (tag: 'th' | 'td', node: TableNode['header']['cells'][number]) => {
      const align = node.alignment ? ` align="${node.alignment}"` : '';
      return `<${tag}${align}>${this.inline(node.inline)}</${tag}>\n`;
    };
    writer.cr();
    writer.write('<table>\n<thead>\n<tr>\n');
    for (const node of table.header.cells) writer.write(cell('th', node));
    writer.write('</tr>\n</thead>\n');
    if (table.rows.length > 0) {
      writer.write('<tbody>\n');
      for (const row of table.rows) {
        writer.write('<tr>\n');
        for (const node of row.cells) writer.write(cell('td', node));
        writer.write('</tr>\n');
      }
      writer.write('</tbody>\n');
    }
    writer.write('</table>\n');
  }

  private code(node: BlockNode, writer: HtmlWriter): void {
    const content = node.content ?? '';
    const language = node.language ?? '';
    const highlighted = this.options.highlight?.(content, language, node.info ?? '');
    writer.cr();
    if (highlighted && highlighted.startsWith('<pre')) {
      writer.write(highlighted);
    } else {
      const className = language ? ` class="${escapeHtml(this.langPrefix + language)}"` : '';
      const body = highlighted || `${escapeHtml(content)}${content && !content.endsWith('\n') ? '\n' : ''}`;
      writer.write(`<pre><code${className}>${body}</code></pre>`);
    }
    writer.cr();
  }

  /** 块级元素：<tag 属性>子节点</tag>，前后换行 */
  private wrap(writer: HtmlWriter, open: string, close: string, children: readonly BlockNode[], tight = false): void {
    writer.cr();
    writer.write(open);
    writer.cr();
    for (const child of children) this.block(child, writer, tight);
    writer.cr();
    writer.write(close);
    writer.cr();
  }

  block(node: BlockNode, writer: HtmlWriter, tight: boolean): void {
    const attributes = attributeString(node.attributes);
    switch (node.type) {
      case BlockType.Document:
        for (const child of node.children ?? []) this.block(child, writer, false);
        return;
      case BlockType.Paragraph:
        if (tight) {
          writer.write(this.inline(node.inline));
          return;
        }
        writer.cr();
        writer.write(`<p${attributes}>${this.inline(node.inline)}</p>`);
        writer.cr();
        return;
      case BlockType.Heading:
        writer.cr();
        writer.write(`<h${node.level}${attributes}>${this.inline(node.inline)}</h${node.level}>`);
        writer.cr();
        return;
      case BlockType.CodeBlock:
      case BlockType.FencedCode:
        this.code(node, writer);
        return;
      case BlockType.Blockquote:
        this.wrap(writer, '<blockquote>', '</blockquote>', node.children ?? []);
        return;
      case BlockType.List: {
        const tag = node.ordered ? 'ol' : 'ul';
        const start = node.ordered && node.start !== undefined && node.start !== 1 ? ` start="${node.start}"` : '';
        writer.cr();
        writer.write(`<${tag}${start}>`);
        writer.cr();
        for (const item of node.children ?? []) this.block(item, writer, node.tight ?? false);
        writer.cr();
        writer.write(`</${tag}>`);
        writer.cr();
        return;
      }
      case BlockType.ListItem:
      case BlockType.TaskListItem:
        writer.cr();
        writer.write('<li>');
        if (node.type === BlockType.TaskListItem) {
          writer.write(`<input type="checkbox" disabled=""${node.checked ? ' checked=""' : ''}${this.close} `);
        }
        for (const child of node.children ?? []) this.block(child, writer, tight);
        writer.write('</li>');
        writer.cr();
        return;
      case BlockType.ThematicBreak:
        writer.cr();
        writer.write(`<hr${this.close}`);
        writer.cr();
        return;
      case BlockType.HtmlBlock:
        writer.cr();
        writer.write(node.content ?? '');
        writer.cr();
        return;
      case BlockType.Table:
        this.table(node as TableNode, writer);
        return;
      case BlockType.Container:
        this.wrap(writer, `<div class="${escapeHtml(node.name ?? '')}">`, '</div>', node.children ?? []);
        return;
      case BlockType.DefinitionList:
        this.wrap(writer, '<dl>', '</dl>', node.children ?? []);
        return;
      case BlockType.DefinitionTerm:
        writer.cr();
        writer.write(`<dt${attributes}>${this.inline(node.inline)}</dt>`);
        writer.cr();
        return;
      case BlockType.DefinitionDescription:
        if (node.tight) {
          writer.cr();
          writer.write('<dd>');
          for (const child of node.children ?? []) this.block(child, writer, true);
          writer.write('</dd>');
          writer.cr();
        } else {
          this.wrap(writer, '<dd>', '</dd>', node.children ?? []);
        }
        return;
      case BlockType.Extension:
        writer.cr();
        writer.write(this.extension(node, true));
        writer.cr();
        return;
      // 脚注定义收集到文末输出；YAML 头部不输出
      case BlockType.FootnoteDefinition:
      case BlockType.FrontMatter:
      case BlockType.BlankLine:
      case BlockType.TableRow:
      case BlockType.TableCell:
        return;
    }
  }

  /** 文末的脚注列表（与 markdown-it-footnote 的结构相同）：回链放在最后一个段落里 */
  footnotes(entries: readonly FootnoteEntry[], writer: HtmlWriter): void {
    writer.cr();
    writer.write(`<hr class="footnotes-sep"${this.close}\n<section class="footnotes">\n<ol class="footnotes-list">\n`);
    for (const entry of entries) {
      const backrefs = Array.from({ length: entry.references }, (_, sub) => {
        return ` <a href="#fnref${footnoteRefId(entry.index, sub)}" class="footnote-backref">\u21a9\uFE0E</a>`;
      }).join('');
      writer.write(`<li id="fn${entry.index}" class="footnote-item">`);
      // 内容紧接在 <li> 之后（与 markdown-it-footnote 一致）：在新的缓冲中渲染，第一个块前不换行
      const body = new HtmlWriter();
      const blocks = entry.definition?.children ?? [];
      const last = blocks[blocks.length - 1];
      if (entry.inline) {
        body.write(`<p>${this.inline(entry.inline)}${backrefs}</p>\n`);
      } else if (last && last.type === BlockType.Paragraph) {
        for (const child of blocks.slice(0, -1)) this.block(child, body, false);
        body.cr();
        body.write(`<p>${this.inline(last.inline)}${backrefs}</p>\n`);
      } else {
        for (const child of blocks) this.block(child, body, false);
        body.write(backrefs);
      }
      writer.write(body.toString());
      writer.write('</li>\n');
    }
    writer.write('</ol>\n</section>\n');
  }
}

/** 第 sub 次引用的锚点名：第一次为编号本身，之后为 编号:次数 */
function footnoteRefId(index: number, sub: number): string {
  return sub > 0 ? `${index}:${sub}` : String(index);
}

/**
 * 把 parseCommonMark 的文档节点渲染为 HTML（被引用的脚注输出在文末）
 */
export function renderHtml(document: BlockNode, options: HtmlRenderOptions = {}): string {
  const renderer = new HtmlRenderer(options);
  const writer = new HtmlWriter();
  renderer.block(document, writer, false);
  const footnotes = collectFootnotes(document);
  if (footnotes.length > 0) renderer.footnotes(footnotes, writer);
  return writer.toString();
}
