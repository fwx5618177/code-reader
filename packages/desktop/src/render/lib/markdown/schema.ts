// ================================
// Markdown 文档 Schema
// 写作编辑器的唯一文档模型：节点与 Markdown 语法一一对应，
// 保证 Markdown ⇄ ProseMirror 文档往返无损
// ================================

import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { formatWikiLink, wikiLinkRef, type WikiLinkParts } from './wiki-link';

/** 表格单元格对齐方式 */
export type CellAlign = 'left' | 'center' | 'right' | null;

/** 从单元格 DOM 读取对齐方式 */
function readCellAlign(dom: HTMLElement): CellAlign {
  const align = dom.style.textAlign || dom.getAttribute('align');
  return align === 'left' || align === 'center' || align === 'right' ? align : null;
}

/** 表格单元格节点定义（表头与普通单元格共用） */
function tableCellSpec(tag: 'th' | 'td'): NodeSpec {
  return {
    content: 'inline*',
    attrs: { align: { default: null } },
    tableRole: tag === 'th' ? 'header_cell' : 'cell',
    isolating: true,
    parseDOM: [{ tag, getAttrs: (dom: HTMLElement) => ({ align: readCellAlign(dom) }) }],
    toDOM(node) {
      const align = node.attrs.align as CellAlign;
      return [tag, align ? { style: `text-align: ${align}` } : {}, 0];
    },
  };
}

/** 文档节点扩展 */
const EXTRA_NODES: Record<string, NodeSpec> = {
  table: {
    content: 'table_row+',
    group: 'block',
    tableRole: 'table',
    isolating: true,
    parseDOM: [{ tag: 'table' }],
    toDOM() {
      return ['table', ['tbody', 0]];
    },
  },
  table_row: {
    content: '(table_header | table_cell)+',
    tableRole: 'row',
    parseDOM: [{ tag: 'tr' }],
    toDOM() {
      return ['tr', 0];
    },
  },
  table_header: tableCellSpec('th'),
  table_cell: tableCellSpec('td'),

  math_inline: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { latex: { default: '' } },
    parseDOM: [
      {
        tag: 'span[data-math-inline]',
        getAttrs: (dom: HTMLElement) => ({ latex: dom.getAttribute('data-math-inline') || '' }),
      },
    ],
    toDOM(node) {
      return ['span', { 'data-math-inline': node.attrs.latex, class: 'math-node-inline' }];
    },
  },

  math_block: {
    group: 'block',
    atom: true,
    attrs: { latex: { default: '' } },
    parseDOM: [
      {
        tag: 'div[data-math-block]',
        getAttrs: (dom: HTMLElement) => ({ latex: dom.getAttribute('data-math-block') || '' }),
      },
    ],
    toDOM(node) {
      return ['div', { 'data-math-block': node.attrs.latex, class: 'math-node-block' }];
    },
  },

  // 双向链接 [[目标#标题|别名]]
  wiki_link: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { target: { default: '' }, heading: { default: null }, alias: { default: null } },
    parseDOM: [
      {
        tag: 'a[data-wiki-target]',
        getAttrs: (dom: HTMLElement) => ({
          target: dom.getAttribute('data-wiki-target') || '',
          heading: dom.getAttribute('data-wiki-heading'),
          alias: dom.getAttribute('data-wiki-alias'),
        }),
      },
    ],
    toDOM(node) {
      const { target, heading, alias } = node.attrs as WikiLinkParts;
      const attrs: Record<string, string> = { class: 'wiki-link', 'data-wiki-target': target };
      if (heading) attrs['data-wiki-heading'] = heading;
      // 别名遮住了链接目标，悬停时显示
      if (alias) Object.assign(attrs, { 'data-wiki-alias': alias, title: wikiLinkRef(target, heading) });
      return ['a', attrs, alias || wikiLinkRef(target, heading)];
    },
  },

  // 块级嵌入 ![[目标#标题]]：文档中只保存引用，内容在渲染时解析
  wiki_embed: {
    group: 'block',
    atom: true,
    attrs: { target: { default: '' }, heading: { default: null }, alias: { default: null } },
    parseDOM: [
      {
        tag: 'div[data-wiki-embed]',
        getAttrs: (dom: HTMLElement) => ({
          target: dom.getAttribute('data-wiki-embed') || '',
          heading: dom.getAttribute('data-wiki-heading'),
          alias: dom.getAttribute('data-wiki-alias'),
        }),
      },
    ],
    toDOM(node) {
      const parts = node.attrs as WikiLinkParts;
      const attrs: Record<string, string> = { class: 'wiki-embed', 'data-wiki-embed': parts.target };
      if (parts.heading) attrs['data-wiki-heading'] = parts.heading;
      if (parts.alias) attrs['data-wiki-alias'] = parts.alias;
      return ['div', attrs, formatWikiLink(parts, true)];
    },
  },
};

/** 标记扩展 */
const EXTRA_MARKS: Record<string, MarkSpec> = {
  strike: {
    parseDOM: [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' },
      { style: 'text-decoration=line-through' },
    ],
    toDOM() {
      return ['s', 0];
    },
  },
};

/**
 * 创建 Markdown 文档 Schema
 */
export function createMarkdownSchema(): Schema {
  let nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');

  // 代码块：记录语言（对应 ```lang）
  nodes = nodes.update('code_block', {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    isolating: true,
    attrs: { language: { default: '' } },
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs: (dom: HTMLElement) => ({ language: dom.getAttribute('data-language') || '' }),
      },
    ],
    toDOM(node) {
      return ['pre', { 'data-language': node.attrs.language }, ['code', 0]];
    },
  });

  // 列表：记录紧凑/松散与标记符，保证往返时格式不变
  const bullet = nodes.get('bullet_list')!;
  nodes = nodes.update('bullet_list', {
    ...bullet,
    attrs: { tight: { default: true }, bullet: { default: '-' } },
  });
  const ordered = nodes.get('ordered_list')!;
  nodes = nodes.update('ordered_list', {
    ...ordered,
    attrs: { order: { default: 1 }, tight: { default: true }, delimiter: { default: '.' } },
  });

  // 列表项：checked 为 null 表示普通项，布尔值表示任务项
  const listItem = nodes.get('list_item')!;
  nodes = nodes.update('list_item', {
    ...listItem,
    attrs: { checked: { default: null } },
    parseDOM: [
      {
        tag: 'li',
        getAttrs: (dom: HTMLElement) => {
          const checked = dom.getAttribute('data-checked');
          return { checked: checked === null ? null : checked === 'true' };
        },
      },
    ],
    toDOM(node) {
      const checked = node.attrs.checked as boolean | null;
      if (checked === null) return ['li', 0];
      return ['li', { 'data-checked': String(checked), class: 'task-item' }, 0];
    },
  });

  for (const [name, spec] of Object.entries(EXTRA_NODES)) {
    nodes = nodes.addToEnd(name, spec);
  }

  let marks = basicSchema.spec.marks;
  for (const [name, spec] of Object.entries(EXTRA_MARKS)) {
    marks = marks.addToEnd(name, spec);
  }

  return new Schema({ nodes, marks });
}

/** 全局共享的 Schema 实例（节点类型需要在解析器、序列化器与编辑器之间保持一致） */
export const markdownSchema = createMarkdownSchema();
