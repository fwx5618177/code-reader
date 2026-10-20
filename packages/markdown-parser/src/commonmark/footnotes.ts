// ================================
// @code-reader/markdown-parser - 脚注编号与收集
// 与 markdown-it-footnote 一致：按第一次引用的顺序编号（行内脚注 ^[…] 在出现处取号），
// 同一脚注多次引用时依次编为第 0、1、2… 次；没有被引用的定义不编号、不输出。
// 解析与增量更新之后都整篇重新编号（只遍历节点，不重新解析）
// ================================

import { BlockType, InlineType, type BlockNode, type InlineNode, type TableNode } from './types';

/** 一条被引用的脚注（按编号排列） */
export interface FootnoteEntry {
  /** 编号（1 起） */
  index: number;
  /** [^label] 的标签；行内脚注没有 */
  label?: string;
  /** 被引用的次数 */
  references: number;
  /** 定义块（[^label]: …） */
  definition?: BlockNode;
  /** 行内脚注 ^[…] 的内容 */
  inline?: InlineNode[];
  /** 行内脚注方括号内的原始文本 */
  text?: string;
}

/** 按文档顺序访问所有行内节点（含表格单元格、链接与行内脚注内部），先访问父节点 */
function walkInline(block: BlockNode, visit: (node: InlineNode) => void): void {
  const visitNodes = (nodes: readonly InlineNode[] | undefined) => {
    for (const node of nodes ?? []) {
      visit(node);
      visitNodes(node.children);
    }
  };
  visitNodes(block.inline);
  if (block.type === BlockType.Table) {
    const table = block as TableNode;
    for (const row of [table.header, ...table.rows]) for (const cell of row.cells) visitNodes(cell.inline);
  }
  for (const child of block.children ?? []) walkInline(child, visit);
}

function walkBlocks(block: BlockNode, visit: (node: BlockNode) => void): void {
  visit(block);
  for (const child of block.children ?? []) walkBlocks(child, visit);
}

/** 给一组行内节点中的脚注引用编号，返回标签 → 编号 */
function numberReferences(visitAll: (visit: (node: InlineNode) => void) => void): Map<string, number> {
  const byLabel = new Map<string, { index: number; count: number }>();
  let next = 1;
  visitAll((node) => {
    if (node.type !== InlineType.FootnoteRef) return;
    if (node.footnoteId === undefined) {
      node.footnoteIndex = next++;
      node.footnoteSubId = 0;
      return;
    }
    let entry = byLabel.get(node.footnoteId);
    if (!entry) byLabel.set(node.footnoteId, (entry = { index: next++, count: 0 }));
    node.footnoteIndex = entry.index;
    node.footnoteSubId = entry.count++;
  });
  return new Map([...byLabel].map(([label, entry]) => [label, entry.index]));
}

/** 整篇编号：引用按出现顺序取号，定义块写入对应编号（未被引用的定义去掉编号） */
export function numberFootnotes(document: BlockNode): void {
  const indexes = numberReferences((visit) => walkInline(document, visit));
  walkBlocks(document, (block) => {
    if (block.type !== BlockType.FootnoteDefinition) return;
    const index = indexes.get(block.footnoteId ?? '');
    if (index === undefined) delete block.footnoteIndex;
    else block.footnoteIndex = index;
  });
}

/** 只有行内内容时（parseInline）的编号 */
export function numberInlineFootnotes(nodes: readonly InlineNode[]): void {
  numberReferences((visit) => {
    const visitNodes = (list: readonly InlineNode[] | undefined) => {
      for (const node of list ?? []) {
        visit(node);
        visitNodes(node.children);
      }
    };
    visitNodes(nodes);
  });
}

/** 收集被引用的脚注（渲染到文末用），按编号排列 */
export function collectFootnotes(document: BlockNode): FootnoteEntry[] {
  const entries = new Map<number, FootnoteEntry>();
  walkInline(document, (node) => {
    if (node.type !== InlineType.FootnoteRef || node.footnoteIndex === undefined) return;
    const entry = entries.get(node.footnoteIndex);
    if (entry) {
      entry.references = Math.max(entry.references, (node.footnoteSubId ?? 0) + 1);
      return;
    }
    entries.set(node.footnoteIndex, {
      index: node.footnoteIndex,
      references: (node.footnoteSubId ?? 0) + 1,
      ...(node.footnoteId !== undefined ? { label: node.footnoteId } : { inline: node.children ?? [], text: node.content.slice(2, -1) }),
    });
  });
  walkBlocks(document, (block) => {
    if (block.type !== BlockType.FootnoteDefinition || block.footnoteIndex === undefined) return;
    const entry = entries.get(block.footnoteIndex);
    if (entry && !entry.definition) entry.definition = block;
  });
  return [...entries.values()].sort((a, b) => a.index - b.index);
}
