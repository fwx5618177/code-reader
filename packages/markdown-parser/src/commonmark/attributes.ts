// ================================
// @code-reader/markdown-parser - {…} 属性（attributes 选项）
// 写法：{#id .class key=value key="带空格的值"}。
// 本包更严格：{…} 中任何一项不合法时整体保留为文本（如 R Markdown 的 ```{r}、正文中的 {不是 属性}）。
// 块级属性的归属：
// - 标题、段落、术语、表格单元格末尾的 {…} 属于该块；围栏代码块信息串末尾的 {…} 属于代码块
// - 列表项第一个块末尾的 {…} 属于列表项（li）；单独一行写在列表项第一段之后的 {…} 属于所在列表
// - 紧跟在表格、列表之后、只有 {…} 的段落属于该表格 / 列表（段落本身去掉）
// - 段落最后单独一行的 {…} 属于“在这里同时结束的最外层块”（如引用的最后一段 → 引用）
// - 只有分隔符加 {…} 的段落（--- {#id}）是带属性的主题分隔线
// ================================

import { BlockType, InlineType, type BlockNode, type InlineNode } from './types';

export type Attributes = Record<string, string>;

const ATTRIBUTE_TOKEN = /^(?:#([\w:.-]+)|\.([\w-]+)|([A-Za-z_:][\w:.-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))$/;

/** 合并属性：class 追加（空格分隔），其余同名覆盖；顺序按第一次出现 */
export function mergeAttributes(target: Attributes | undefined, extra: Attributes | undefined): Attributes | undefined {
  if (!extra) return target;
  const merged: Attributes = { ...target };
  for (const [name, value] of Object.entries(extra)) {
    merged[name] = name === 'class' && merged.class ? `${merged.class} ${value}` : value;
  }
  return merged;
}

/** 解析 {…} 中的属性：空白分隔的 #id、.class、key=value；任何一项不合法都不算属性 */
export function parseAttributes(inner: string): Attributes | null {
  const parts = inner.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!parts) return null;
  let attributes: Attributes = {};
  for (const part of parts) {
    const match = ATTRIBUTE_TOKEN.exec(part);
    if (!match) return null;
    const [name, value] =
      match[1] !== undefined ? ['id', match[1]] : match[2] !== undefined ? ['class', match[2]] : [match[3]!, match[4] ?? match[5] ?? match[6] ?? ''];
    attributes = mergeAttributes(attributes, { [name]: value })!;
  }
  return attributes;
}

/** 文本末尾的 {…} 属性（之前的空白一并去掉）：返回属性与去掉的长度 */
export function trailingAttributes(text: string): { attributes: Attributes; length: number } | null {
  if (!text.endsWith('}')) return null;
  const open = text.lastIndexOf('{');
  if (open === -1) return null;
  const attributes = parseAttributes(text.slice(open + 1, -1));
  if (!attributes) return null;
  let start = open;
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
  return { attributes, length: text.length - start };
}

/** 块末尾的 {…}：去掉最后一个文本节点末尾的属性（文本变空时连同之前的换行一起去掉，ownLine 表示 {…} 单独占一行） */
export function blockAttributes(nodes: InlineNode[]): { attributes: Attributes; length: number; ownLine: boolean } | null {
  const last = nodes[nodes.length - 1];
  if (!last || last.type !== InlineType.Text) return null;
  const found = trailingAttributes(last.content);
  if (!found) return null;
  last.content = last.content.slice(0, last.content.length - found.length);
  if (last.position.end - last.position.start >= found.length) {
    last.position = { ...last.position, end: last.position.end - found.length, endColumn: last.position.endColumn - found.length };
  }
  let ownLine = false;
  if (!last.content) {
    nodes.pop();
    const previous = nodes[nodes.length - 1];
    if (previous && (previous.type === InlineType.SoftBreak || previous.type === InlineType.LineBreak)) {
      nodes.pop();
      ownLine = true;
    }
  }
  return { ...found, ownLine };
}

/** 属性可以“冒泡”到的块：段落是它们的最后一个子孙时，段落末行的 {…} 属于它们 */
const ENCLOSING: ReadonlySet<BlockType> = new Set([
  BlockType.Blockquote,
  BlockType.List,
  BlockType.ListItem,
  BlockType.TaskListItem,
  BlockType.Container,
  BlockType.DefinitionList,
  BlockType.DefinitionDescription,
]);

/**
 * 把段落上暂存的块级属性移到所属的块（规则见文件头）。
 * ownLine 是 {…} 单独占一行的段落（处理过的会从集合中去掉）
 */
export function placeBlockAttributes(document: BlockNode, ownLine: Set<BlockNode>): void {
  /** 处理 node 的子树；返回需要交给更外层块的属性 */
  const place = (node: BlockNode): Attributes | undefined => {
    const children = node.children;
    if (!children) {
      if (node.type !== BlockType.Paragraph || !ownLine.has(node)) return undefined;
      ownLine.delete(node);
      const attributes = node.attributes;
      delete node.attributes;
      return attributes;
    }
    if (node.type === BlockType.List) {
      for (const item of children) firstBlockOfItem(node, item, ownLine);
    }
    absorbAttributeParagraphs(children, ownLine);
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const hoisted = place(child);
      if (!hoisted) continue;
      if (i === children.length - 1 && ENCLOSING.has(node.type)) return hoisted;
      child.attributes = mergeAttributes(child.attributes, hoisted);
    }
    return undefined;
  };
  place(document);
}

/** 列表项的第一个块（段落或标题）末尾的 {…} 属于列表项；单独一行时属于列表 */
function firstBlockOfItem(list: BlockNode, item: BlockNode, ownLine: Set<BlockNode>): void {
  const first = item.children?.[0];
  if (!first || !first.attributes || (first.type !== BlockType.Paragraph && first.type !== BlockType.Heading)) return;
  if (ownLine.delete(first)) list.attributes = mergeAttributes(list.attributes, first.attributes);
  else item.attributes = mergeAttributes(item.attributes, first.attributes);
  delete first.attributes;
}

/** 紧跟在表格、列表之后、只有 {…} 的段落：属性给前一个块，段落去掉 */
function absorbAttributeParagraphs(children: BlockNode[], ownLine: Set<BlockNode>): void {
  for (let i = 1; i < children.length; i++) {
    const node = children[i]!;
    const previous = children[i - 1]!;
    if (node.type !== BlockType.Paragraph || !node.attributes || ownLine.has(node) || (node.inline?.length ?? 0) > 0) continue;
    if (previous.type !== BlockType.Table && previous.type !== BlockType.List) continue;
    previous.attributes = mergeAttributes(previous.attributes, node.attributes);
    children.splice(i, 1);
    i--;
  }
}

/** 只有分隔符加 {…} 的段落内容（--- {#id}）：分隔符与 { 之间最多一个空格 */
export const THEMATIC_BREAK_WITH_ATTRIBUTES = /^[-*_]{3,} ?\{[^}]*\}$/;
