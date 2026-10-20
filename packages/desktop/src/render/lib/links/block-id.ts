// ================================
// 为其他文档中的块写入 ID
// [[笔记#^ 补全选中没有 ID 的块时，在目标文档源码中写入标记：
// 段落/标题末尾追加 ` ^id`；表格、代码块之后插入独立一段 `^id`。
// 与重命名改写相同，直接在源码上按位置插入，其余内容逐字节保持不变。
// ================================

import type { MarkdownItToken as Token } from '@code-reader/markdown-parser';
import { findBlockInDoc, findSlotNode, markdownTokenizer, parseMarkdown, type BlockIdSlot } from '../markdown';
import { splitLines } from './rename';

/** 写入位置对应的块级 token 类型（与解析器的节点映射一致） */
const SLOT_TOKEN_TYPES: Record<'append' | 'table' | 'code_block', ReadonlySet<string>> = {
  append: new Set(['paragraph_open', 'heading_open']),
  table: new Set(['table_open']),
  code_block: new Set(['fence', 'code_block']),
};

function slotToken(markdown: string, slot: BlockIdSlot): Token | null {
  const types = SLOT_TOKEN_TYPES[slot.kind === 'append' ? 'append' : slot.node];
  const tokens = markdownTokenizer.parse(markdown, {}).filter((token) => types.has(token.type));
  return tokens[slot.kind === 'append' ? slot.anchorIndex : slot.index] ?? null;
}

/** 段落/标题末尾追加 ` ^id` 的源码偏移 */
function appendOffset(token: Token, lines: string[], starts: number[]): number | null {
  const atx = token.type === 'heading_open' && token.markup.startsWith('#');
  // 段落取最后一行；ATX 标题只有一行；Setext 标题取下划线的上一行
  const lineIndex = token.type === 'paragraph_open' ? token.map![1] - 1 : atx ? token.map![0] : token.map![1] - 2;
  const line = lines[lineIndex];
  if (line === undefined) return null;
  // ATX 标题的结尾 # 序列不属于标题文本，标记写在它之前
  const closing = atx ? /\s+#+\s*$/.exec(line) : null;
  return starts[lineIndex] + (closing ? closing.index : line.trimEnd().length);
}

/**
 * 表格/代码块之后插入独立一段 `^id`：前后以空行分隔（下一行已是空行时不再补），
 * 沿用块最后一行的容器前缀（引用的 >、列表的缩进）
 */
function insertAfterBlock(markdown: string, token: Token, lines: string[], starts: number[], id: string): string | null {
  const lastIndex = token.map![1] - 1;
  const last = lines[lastIndex];
  if (last === undefined) return null;
  const prefix = /^[ \t>]*/.exec(last)![0];
  const next = lines[lastIndex + 1];
  const trailing = next !== undefined && next.trim() !== '' ? `\n${prefix.trimEnd()}` : '';
  const offset = starts[lastIndex] + last.length;
  return `${markdown.slice(0, offset)}\n${prefix.trimEnd()}\n${prefix}^${id}${trailing}${markdown.slice(offset)}`;
}

/**
 * 在写入位置为块写入 ^id（位置编号与 collectDocBlocks 一致）
 * 插入后重新解析校验：块 ID 未落在预期的块上（源码结构无法安全改写）时返回 null
 */
export function addBlockIdToMarkdown(markdown: string, slot: BlockIdSlot, id: string): string | null {
  const token = slotToken(markdown, slot);
  if (!token?.map) return null;

  const { lines, starts } = splitLines(markdown);
  let result: string | null;
  if (slot.kind === 'append') {
    const offset = appendOffset(token, lines, starts);
    result = offset === null ? null : `${markdown.slice(0, offset)} ^${id}${markdown.slice(offset)}`;
  } else {
    result = insertAfterBlock(markdown, token, lines, starts, id);
  }
  if (result === null) return null;

  const doc = parseMarkdown(result);
  const block = findBlockInDoc(doc, id);
  const valid =
    slot.kind === 'append'
      ? block?.marker?.anchorIndex === slot.anchorIndex
      : block?.relation === 'previous' && block.pos === findSlotNode(doc, slot)?.pos;
  return valid ? result : null;
}
