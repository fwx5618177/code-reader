// ================================
// ProseMirror 文档 → Markdown
//
// 分块序列化：文档的顶层块是不可变对象，未修改的块在事务前后保持同一引用。
// 以块为单位缓存序列化结果，每次编辑只重新序列化发生变化的块，
// 大文档的保存开销与修改量成正比，而不是与文档长度成正比。
// ================================

import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import type { Node as PMNode } from 'prosemirror-model';
import { markdownSchema, type CellAlign } from './schema';
import { formatWikiLink, type WikiLinkParts } from './wiki-link';

/** 代码围栏：必须比内容中最长的反引号序列更长 */
function fenceFor(content: string): string {
  const runs = content.match(/`{3,}/g);
  if (!runs) return '```';
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(longest + 1);
}

/** 对齐方式 → 分隔行单元 */
function alignRule(align: CellAlign): string {
  switch (align) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}

const baseNodes = defaultMarkdownSerializer.nodes;

const serializer: MarkdownSerializer = new MarkdownSerializer(
  {
    ...baseNodes,
    front_matter(state, node) {
      const yaml = node.textContent;
      state.write(`---\n${yaml}${yaml && !yaml.endsWith('\n') ? '\n' : ''}---`);
      state.closeBlock(node);
    },
    code_block(state, node) {
      const fence = fenceFor(node.textContent);
      state.write(fence + (node.attrs.language || '') + '\n');
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write(fence);
      state.closeBlock(node);
    },
    bullet_list(state, node) {
      state.renderList(node, '  ', () => `${node.attrs.bullet || '-'} `);
    },
    ordered_list(state, node) {
      const start = (node.attrs.order as number) || 1;
      const delimiter = (node.attrs.delimiter as string) || '.';
      const maxWidth = String(start + node.childCount - 1).length;
      const indent = ' '.repeat(maxWidth + 2);
      state.renderList(node, indent, (i) => {
        const number = String(start + i);
        return ' '.repeat(maxWidth - number.length) + number + delimiter + ' ';
      });
    },
    list_item(state, node) {
      const checked = node.attrs.checked as boolean | null;
      if (checked !== null) state.write(checked ? '[x] ' : '[ ] ');
      state.renderContent(node);
    },
    table(state, node) {
      const rows: string[][] = [];
      const aligns: CellAlign[] = [];
      node.forEach((row, _offset, rowIndex) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          if (rowIndex === 0) aligns.push(cell.attrs.align as CellAlign);
          cells.push(serializeTableCell(cell));
        });
        rows.push(cells);
      });
      const columns = Math.max(...rows.map((r) => r.length));
      const line = (cells: string[]) =>
        '| ' + Array.from({ length: columns }, (_, i) => cells[i] ?? '').join(' | ') + ' |';

      state.write(line(rows[0] ?? []));
      state.ensureNewLine();
      state.write('| ' + Array.from({ length: columns }, (_, i) => alignRule(aligns[i] ?? null)).join(' | ') + ' |');
      for (const row of rows.slice(1)) {
        state.ensureNewLine();
        state.write(line(row));
      }
      state.closeBlock(node);
    },
    math_inline(state, node) {
      state.write('$' + (node.attrs.latex as string) + '$');
    },
    math_block(state, node) {
      state.write('$$');
      state.ensureNewLine();
      state.text(node.attrs.latex as string, false);
      state.ensureNewLine();
      state.write('$$');
      state.closeBlock(node);
    },
    wiki_link(state, node) {
      state.write(formatWikiLink(node.attrs as WikiLinkParts));
    },
    wiki_embed(state, node) {
      state.write(formatWikiLink(node.attrs as WikiLinkParts, true));
      state.closeBlock(node);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  },
  // $ 会被识别为公式定界符，正文中的 $ 需要转义
  { escapeExtraCharacters: /[$]/g }
);

/**
 * 表格单元格：行内内容按段落序列化，| 转义、换行替换为空格
 */
function serializeTableCell(cell: PMNode): string {
  const paragraph = markdownSchema.nodes.paragraph.create(null, cell.content);
  const doc = markdownSchema.topNodeType.create(null, paragraph);
  return serializer.serialize(doc).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

/** 顶层块的序列化缓存（以不可变节点为键，节点被回收时自动释放） */
const blockCache = new WeakMap<PMNode, string>();

/** 序列化单个顶层块 */
function serializeBlock(node: PMNode): string {
  const cached = blockCache.get(node);
  if (cached !== undefined) return cached;
  const markdown = serializer.serialize(markdownSchema.topNodeType.create(null, node));
  blockCache.set(node, markdown);
  return markdown;
}

/**
 * 相邻的同类型列表在 Markdown 中会被合并为一个列表，
 * 因此第二个列表改用另一种标记符（- ↔ *，. ↔ )）以保持为独立列表
 */
function withAlternateMarker(node: PMNode): PMNode {
  if (node.type === markdownSchema.nodes.bullet_list) {
    const bullet = node.attrs.bullet === '*' ? '-' : '*';
    return node.type.create({ ...node.attrs, bullet }, node.content);
  }
  const delimiter = node.attrs.delimiter === ')' ? '.' : ')';
  return node.type.create({ ...node.attrs, delimiter }, node.content);
}

function sameListMarker(a: PMNode, b: PMNode): boolean {
  if (a.type !== b.type) return false;
  if (a.type === markdownSchema.nodes.bullet_list) return a.attrs.bullet === b.attrs.bullet;
  if (a.type === markdownSchema.nodes.ordered_list) return a.attrs.delimiter === b.attrs.delimiter;
  return false;
}

/**
 * 序列化文档为 Markdown（按顶层块增量缓存）
 */
export function serializeMarkdown(doc: PMNode): string {
  const parts: string[] = [];
  let previous: PMNode | null = null;
  doc.forEach((child, _offset, index) => {
    // 只有 YAML 头部时，文档结构要求的空段落不输出
    const filler = index === 1 && doc.childCount === 2 && previous?.type === markdownSchema.nodes.front_matter;
    if (filler && child.type === markdownSchema.nodes.paragraph && child.content.size === 0) return;
    let block = child;
    if (previous && sameListMarker(previous, block)) {
      block = withAlternateMarker(block);
    }
    parts.push(serializeBlock(block));
    previous = block;
  });
  const body = parts.join('\n\n');
  return body ? body + '\n' : '';
}

/**
 * 序列化为纯文本：每个顶层块对应一行（旧版内容中的嵌套块展开为多行）
 */
export function serializePlainText(doc: PMNode): string {
  const lines: string[] = [];
  doc.forEach((block) => {
    lines.push(blockText(block));
  });
  return lines.join('\n');
}

function blockText(node: PMNode): string {
  if (node.isTextblock) {
    let text = '';
    node.forEach((child) => {
      if (child.isText) text += child.text;
      else if (child.type === markdownSchema.nodes.hard_break) text += '\n';
      else text += child.textContent;
    });
    return text;
  }
  const parts: string[] = [];
  node.forEach((child) => parts.push(blockText(child)));
  return parts.join('\n');
}
