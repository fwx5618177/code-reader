// ================================
// 块级引用（与 Obsidian 一致）
// - 块尾的 ` ^block-id` 标记一个块（ID 由字母、数字与 - 组成）
// - 列表项首段的标记指向整个列表项；独占一段的 `^id` 指向前一个块（表格、代码块、列表等）
// - 没有 ID 的表格、代码块同样可引用：写入 ID 时在其后插入独立一段 `^id`
// - [[笔记#^id]] 链接到块，![[笔记#^id]] 嵌入块内容
// 链接中的 #^id 沿用标题字段存储（heading 以 ^ 开头），解析、序列化与重命名无需特殊处理
// ================================

import { Slice, type Node as PMNode } from 'prosemirror-model';
import { parseMarkdown } from './parser';
import { markdownSchema } from './schema';
import { serializeMarkdown } from './serializer';

/** 块尾标记：前面为空白或位于文本开头 */
const MARKER_PATTERN = /(^|\s+)\^([A-Za-z0-9-]+)$/;

/** 块 ID 是否合法 */
export function isBlockId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id);
}

/** 链接的 #^id 部分 → 块 ID；不是块引用时返回 null */
export function blockRefId(heading: string | null): string | null {
  if (!heading?.startsWith('^')) return null;
  const id = heading.slice(1).trim();
  return isBlockId(id) ? id : null;
}

/** 去掉文本末尾的块 ID 标记（标题文本、显示文本使用） */
export function stripBlockMarker(text: string): string {
  return text.replace(MARKER_PATTERN, '').trimEnd();
}

/** 块与 ID 标记的关系 */
export type BlockRelation =
  /** 标记在段落/标题末尾，块即该文本块 */
  | 'self'
  /** 标记在列表项首段末尾，块为整个列表项 */
  | 'list-item'
  /** 独占一段的标记，块为前一个兄弟节点（没有 ID 的表格、代码块写入 ID 后同样如此） */
  | 'previous';

/** 自身没有可承载标记的段落、写入 ID 时在其后插入独立标记的块类型 */
export type StandaloneBlockKind = 'table' | 'code_block';

const STANDALONE_KINDS: ReadonlySet<string> = new Set<StandaloneBlockKind>(['table', 'code_block']);

function standaloneKind(node: PMNode): StandaloneBlockKind | null {
  return STANDALONE_KINDS.has(node.type.name) ? (node.type.name as StandaloneBlockKind) : null;
}

/**
 * 为没有 ID 的块写入 ID 的位置
 * - append：在第 anchorIndex 个段落/标题末尾追加 ` ^id`
 * - after：在第 index 个同类块（表格或代码块，按文档顺序从 0 计）之后插入独立一段 `^id`
 */
export type BlockIdSlot =
  | { kind: 'append'; anchorIndex: number }
  | { kind: 'after'; node: StandaloneBlockKind; index: number };

/** 段落与标题：可在末尾承载 ID 标记的文本块（按文档顺序编号，与 Markdown 源码中的块一一对应） */
export function isAnchorTextblock(node: PMNode): boolean {
  return node.type.name === 'paragraph' || node.type.name === 'heading';
}

/** 文档中的一个可引用块 */
export interface DocBlock {
  /** 块 ID；没有标记时为 null */
  id: string | null;
  /** 块节点 */
  node: PMNode;
  /** 块节点在文档中的位置 */
  pos: number;
  relation: BlockRelation;
  /**
   * 标记在文档中的范围：from..to 为删除范围（含前导空白；独占一段时为整个段落），
   * idFrom 为 ^ 的位置，standalone 表示标记独占一段，anchorIndex 为承载标记的段落/标题序号；
   * 没有标记时为 null
   */
  marker: { from: number; idFrom: number; to: number; standalone: boolean; anchorIndex: number } | null;
  /** 没有 ID 时写入 ID 的位置；已有 ID 时为 null */
  slot: BlockIdSlot | null;
  /** 块的纯文本（不含标记） */
  text: string;
}

/** 文本块末尾的标记（偏移相对文本块内容起点） */
interface TextblockMarker {
  id: string;
  from: number;
  idFrom: number;
  /** 文本块只包含标记 */
  standalone: boolean;
}

function textblockMarker(node: PMNode): TextblockMarker | null {
  const last = node.lastChild;
  if (!last?.isText || last.marks.length > 0) return null;
  const match = MARKER_PATTERN.exec(last.text ?? '');
  if (!match) return null;
  const index = node.childCount - 1;
  const previous = index > 0 ? node.child(index - 1) : null;
  // 紧贴在行内节点后的 ^id 不是标记（硬换行后的新行除外）
  if (!match[1] && previous && previous.type !== markdownSchema.nodes.hard_break) return null;
  const lastStart = node.content.size - last.nodeSize;
  const idFrom = lastStart + match.index + match[1].length;
  // 标记独占硬换行后的一行时，连同硬换行一起删除
  const from = !match[1] && previous ? lastStart - previous.nodeSize : lastStart + match.index;
  return { id: match[2], from, idFrom, standalone: from === 0 && node.type === markdownSchema.nodes.paragraph };
}

/** 叶子节点在块文本中的表示 */
function leafText(node: PMNode): string {
  if (node.type === markdownSchema.nodes.wiki_link) return node.attrs.alias || node.attrs.target;
  if (node.type === markdownSchema.nodes.math_inline) return `$${node.attrs.latex as string}$`;
  return ' ';
}

/** 节点在 [from, to) 内的可读文本（相对节点内容起点） */
function nodeText(node: PMNode, to = node.content.size): string {
  return node.textBetween(0, to, ' ', leafText).replace(/\s+/g, ' ').trim();
}

/**
 * 收集文档中的块：每个段落与标题（列表项首段代表整个列表项）、表格与代码块，以及由独立标记指向的块
 * 按文档顺序；空的文本块与代码块没有可引用内容，除非带有 ID
 */
export function collectDocBlocks(doc: PMNode): DocBlock[] {
  const blocks: DocBlock[] = [];
  /** 段落/标题/表格/代码块的位置 → blocks 中的下标（独立标记据此找到前一个块） */
  const byPos = new Map<number, number>();
  let anchorIndex = 0;
  const standaloneCounts: Record<StandaloneBlockKind, number> = { table: 0, code_block: 0 };

  doc.descendants((node, pos, parent, index) => {
    const kind = standaloneKind(node);
    if (kind) {
      // 序号对所有同类块计数（含空代码块），与源码中的块一一对应
      const slot: BlockIdSlot = { kind: 'after', node: kind, index: standaloneCounts[kind]++ };
      const text = nodeText(node);
      if (text) {
        byPos.set(pos, blocks.length);
        blocks.push({ id: null, node, pos, relation: 'previous', marker: null, slot, text });
      }
      return false;
    }
    if (!isAnchorTextblock(node)) return !node.isTextblock;
    const anchor = anchorIndex++;
    const found = textblockMarker(node);
    const marker = found
      ? {
          from: pos + 1 + found.from,
          idFrom: pos + 1 + found.idFrom,
          to: pos + node.nodeSize - 1,
          standalone: false,
          anchorIndex: anchor,
        }
      : null;

    if (found?.standalone && parent && index > 0) {
      const previous = parent.child(index - 1);
      const previousPos = pos - previous.nodeSize;
      const entry = {
        id: found.id,
        marker: { ...marker!, from: pos, to: pos + node.nodeSize, standalone: true },
        slot: null,
      };
      const existing = byPos.get(previousPos);
      if (existing === undefined) {
        blocks.push({ ...entry, node: previous, pos: previousPos, relation: 'previous', text: nodeText(previous) });
        return false;
      }
      // 前一个块尚无 ID：独立标记为它命名（保留列表项等关系）
      if (blocks[existing].id === null) {
        blocks[existing] = { ...blocks[existing], ...entry };
        return false;
      }
    }

    const text = nodeText(node, found ? found.from : undefined);
    if (!found && !text) return false;
    const inListItem = parent?.type === markdownSchema.nodes.list_item && index === 0;
    byPos.set(pos, blocks.length);
    blocks.push({
      id: found?.id ?? null,
      node: inListItem ? parent! : node,
      pos: inListItem ? pos - 1 : pos,
      relation: inListItem ? 'list-item' : 'self',
      marker,
      slot: found ? null : { kind: 'append', anchorIndex: anchor },
      text,
    });
    return false;
  });
  return blocks;
}

/** 按 ID 查找块（同一 ID 出现多次时取第一个） */
export function findBlockInDoc(doc: PMNode, id: string): DocBlock | null {
  return collectDocBlocks(doc).find((block) => block.id === id) ?? null;
}

/** 写入位置对应的节点：第 anchorIndex 个段落/标题，或第 index 个表格/代码块 */
export function findSlotNode(doc: PMNode, slot: BlockIdSlot): { node: PMNode; pos: number } | null {
  const matches =
    slot.kind === 'append' ? isAnchorTextblock : (node: PMNode) => node.type.name === slot.node;
  const target = slot.kind === 'append' ? slot.anchorIndex : slot.index;
  let count = 0;
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (matches(node) && count++ === target) found = { node, pos };
    return !node.isTextblock;
  });
  return found;
}

/**
 * 截取块的 Markdown 源码（不含 ID 标记），找不到块时返回 null
 * 列表项保留所在列表的类型与序号
 */
export function extractBlock(markdown: string, id: string): string | null {
  const doc = parseMarkdown(markdown);
  const block = findBlockInDoc(doc, id);
  if (!block?.marker) return null;
  // 标记总在块的起点之后，删除标记不影响块的位置
  const stripped = doc.replace(block.marker.from, block.marker.to, Slice.empty);
  let node = stripped.nodeAt(block.pos);
  if (!node) return null;
  if (block.relation === 'list-item') {
    const $pos = stripped.resolve(block.pos);
    const list = $pos.parent;
    const attrs =
      list.type === markdownSchema.nodes.ordered_list
        ? { ...list.attrs, order: (list.attrs.order as number) + $pos.index() }
        : list.attrs;
    node = list.type.create(attrs, node);
  }
  return serializeMarkdown(markdownSchema.topNodeType.create(null, node));
}

/** 补全与反链展示用的块摘要 */
export interface BlockSummary {
  id: string | null;
  /** 块节点类型 */
  kind: string;
  text: string;
  /** 没有 ID 时写入 ID 的位置；已有 ID 时为 null */
  slot: BlockIdSlot | null;
}

/** 列出 Markdown 中的块 */
export function summarizeBlocks(markdown: string): BlockSummary[] {
  return summarizeDocBlocks(parseMarkdown(markdown));
}

export function summarizeDocBlocks(doc: PMNode): BlockSummary[] {
  return collectDocBlocks(doc).map((block) => ({
    id: block.id,
    kind: block.node.type.name,
    text: block.text,
    slot: block.slot,
  }));
}

/** 块类型的中文名 */
export function blockKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    paragraph: '段落',
    heading: '标题',
    list_item: '列表项',
    bullet_list: '列表',
    ordered_list: '列表',
    blockquote: '引用',
    code_block: '代码块',
    math_block: '公式',
    table: '表格',
  };
  return labels[kind] ?? '块';
}

/** 生成不与已有 ID 重复的块 ID（6 位小写字母与数字） */
export function generateBlockId(existing: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    let id = '';
    while (id.length < 6) id += Math.floor(random() * 36).toString(36);
    if (!existing.has(id)) return id;
  }
}
