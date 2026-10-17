// ================================
// 正文高亮标记
// 在渲染后的正文中为已保存的高亮包裹 <mark>，以及清除这些标记。
//
// 限制：每条高亮只在“单个文本节点”内查找其首次出现的位置。
// 跨越多个节点的文本（如横跨加粗、链接或段落边界的选区）无法定位，会被跳过；
// 这类高亮仍保留在高亮列表中，只是不在正文中显示标记。
// ================================

import type { ReadingHighlight } from './reading-state';

/** 标记元素上记录高亮 ID 的属性 */
export const HIGHLIGHT_ID_ATTR = 'data-highlight-id';

/** 数学公式渲染结果内部不做包裹，避免破坏公式排版 */
const SKIP_SELECTOR = '.math-inline-wrapper, .math-block-wrapper';

function highlightMarks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`mark[${HIGHLIGHT_ID_ATTR}]`));
}

/** 在单个文本节点中查找文本的首次出现 */
function findInTextNode(root: HTMLElement, text: string): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const offset = (node.nodeValue ?? '').indexOf(text);
    if (offset >= 0) return { node: node as Text, offset };
  }
  return null;
}

/**
 * 移除所有高亮标记，恢复为原始文本节点
 */
export function clearHighlightMarks(root: HTMLElement): void {
  const parents = new Set<Node>();
  for (const mark of highlightMarks(root)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parents.add(parent);
  }
  // 合并被拆分的相邻文本节点，保证下次匹配时文本完整
  parents.forEach((parent) => parent.normalize());
}

/**
 * 为高亮包裹 <mark>，返回成功定位的高亮 ID
 */
export function applyHighlightMarks(
  root: HTMLElement,
  highlights: Pick<ReadingHighlight, 'id' | 'text'>[],
  className: string
): Set<string> {
  const applied = new Set<string>();
  for (const highlight of highlights) {
    const match = findInTextNode(root, highlight.text);
    if (!match) continue;
    const range = document.createRange();
    range.setStart(match.node, match.offset);
    range.setEnd(match.node, match.offset + highlight.text.length);
    const mark = document.createElement('mark');
    mark.className = className;
    mark.setAttribute(HIGHLIGHT_ID_ATTR, highlight.id);
    range.surroundContents(mark);
    applied.add(highlight.id);
  }
  return applied;
}

/**
 * 查找某条高亮的标记元素
 */
export function findHighlightMark(root: HTMLElement, id: string): HTMLElement | null {
  return highlightMarks(root).find((mark) => mark.getAttribute(HIGHLIGHT_ID_ATTR) === id) ?? null;
}
