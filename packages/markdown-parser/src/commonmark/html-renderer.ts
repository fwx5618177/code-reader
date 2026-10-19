// ================================
// @code-reader/markdown-parser - HTML 渲染
// 按 CommonMark 参考实现（commonmark.js）的 HTML 约定输出：块级元素各占一行，
// 紧凑列表中的段落不加 <p>，URL 做百分号编码，文本与属性做 HTML 转义
// ================================

import { BlockType, InlineType, type BlockNode, type InlineNode, type TableNode } from './commonmark-parser';

/** HTML 转义（文本与属性值） */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;'
  );
}

/**
 * URL 百分号编码：保留 URL 的结构字符与已有的 %XX，其余（空格、非 ASCII、反斜杠等）按 UTF-8 编码
 */
export function normalizeUrl(url: string): string {
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

function renderInline(nodes: readonly InlineNode[] | undefined): string {
  let out = '';
  for (const node of nodes ?? []) {
    const children = () => (node.children ? renderInline(node.children) : escapeHtml(node.content));
    switch (node.type) {
      case InlineType.Text:
      case InlineType.Escape:
        out += escapeHtml(node.content);
        break;
      case InlineType.Bold:
        out += `<strong>${children()}</strong>`;
        break;
      case InlineType.Italic:
        out += `<em>${children()}</em>`;
        break;
      case InlineType.BoldItalic:
        out += `<em><strong>${children()}</strong></em>`;
        break;
      case InlineType.Strikethrough:
        out += `<del>${children()}</del>`;
        break;
      case InlineType.Code:
        out += `<code>${escapeHtml(node.content)}</code>`;
        break;
      case InlineType.Link: {
        const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
        out += `<a href="${escapeHtml(normalizeUrl(node.url ?? ''))}"${title}>${children()}</a>`;
        break;
      }
      case InlineType.Image: {
        const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
        const alt = node.children ? plainText(node.children) : (node.alt ?? node.content);
        out += `<img src="${escapeHtml(normalizeUrl(node.url ?? ''))}" alt="${escapeHtml(alt)}"${title} />`;
        break;
      }
      case InlineType.AutoLink:
        out += `<a href="${escapeHtml(normalizeUrl(node.url ?? node.content))}">${escapeHtml(node.content)}</a>`;
        break;
      case InlineType.HtmlTag:
        out += node.content;
        break;
      case InlineType.LineBreak:
        out += '<br />\n';
        break;
      case InlineType.SoftBreak:
        out += '\n';
        break;
      case InlineType.FootnoteRef:
        out += `<sup class="footnote-ref"><a href="#fn${node.footnoteIndex}" id="fnref${node.footnoteIndex}">${node.footnoteIndex}</a></sup>`;
        break;
    }
  }
  return out;
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

function renderTable(table: TableNode, writer: HtmlWriter): void {
  const cell = (tag: 'th' | 'td', node: TableNode['header']['cells'][number]) => {
    const align = node.alignment ? ` align="${node.alignment}"` : '';
    return `<${tag}${align}>${renderInline(node.inline)}</${tag}>\n`;
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

function renderBlock(node: BlockNode, writer: HtmlWriter, tight: boolean): void {
  switch (node.type) {
    case BlockType.Document:
      for (const child of node.children ?? []) renderBlock(child, writer, false);
      return;
    case BlockType.Paragraph:
      if (tight) {
        writer.write(renderInline(node.inline));
        return;
      }
      writer.cr();
      writer.write(`<p>${renderInline(node.inline)}</p>`);
      writer.cr();
      return;
    case BlockType.Heading:
      writer.cr();
      writer.write(`<h${node.level}>${renderInline(node.inline)}</h${node.level}>`);
      writer.cr();
      return;
    case BlockType.CodeBlock:
    case BlockType.FencedCode: {
      const info = node.language?.trim().split(/\s+/)[0];
      const className = info ? ` class="language-${escapeHtml(info)}"` : '';
      const content = node.content ?? '';
      writer.cr();
      writer.write(`<pre><code${className}>${escapeHtml(content)}${content && !content.endsWith('\n') ? '\n' : ''}</code></pre>`);
      writer.cr();
      return;
    }
    case BlockType.Blockquote:
      writer.cr();
      writer.write('<blockquote>');
      writer.cr();
      for (const child of node.children ?? []) renderBlock(child, writer, false);
      writer.cr();
      writer.write('</blockquote>');
      writer.cr();
      return;
    case BlockType.List: {
      const tag = node.ordered ? 'ol' : 'ul';
      const start = node.ordered && node.start !== undefined && node.start !== 1 ? ` start="${node.start}"` : '';
      writer.cr();
      writer.write(`<${tag}${start}>`);
      writer.cr();
      for (const item of node.children ?? []) renderBlock(item, writer, node.tight ?? false);
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
        writer.write(`<input type="checkbox" disabled=""${node.checked ? ' checked=""' : ''} /> `);
      }
      for (const child of node.children ?? []) renderBlock(child, writer, tight);
      writer.write('</li>');
      writer.cr();
      return;
    case BlockType.ThematicBreak:
      writer.cr();
      writer.write('<hr />');
      writer.cr();
      return;
    case BlockType.HtmlBlock:
      writer.cr();
      writer.write(node.content ?? '');
      writer.cr();
      return;
    case BlockType.Table:
      renderTable(node as TableNode, writer);
      return;
    case BlockType.FootnoteDefinition:
      writer.cr();
      writer.write(`<section class="footnote" id="fn${node.footnoteIndex}">`);
      for (const child of node.children ?? []) renderBlock(child, writer, false);
      writer.write('</section>');
      writer.cr();
      return;
    case BlockType.BlankLine:
    case BlockType.TableRow:
    case BlockType.TableCell:
      return;
  }
}

/**
 * 把 parseCommonMark 的文档节点渲染为 HTML
 */
export function renderHtml(document: BlockNode): string {
  const writer = new HtmlWriter();
  renderBlock(document, writer, false);
  return writer.toString();
}
