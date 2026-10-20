// ================================
// 正文高亮标记
// 在渲染后的正文中为已保存的高亮包裹 <mark>，以及清除这些标记。
//
// 定位方式：把正文的所有文本节点拼接为一段“归一化文本”（连续空白折叠为一个空格，
// 段落等块级边界视为一个空格），在其中查找高亮文本（记录了选区位置时取离该位置最近的一处，
// 否则取首次出现），再把匹配区间映射回各个文本节点。跨越加粗、链接、行内代码甚至段落的
// 高亮会拆成多个 <mark>，它们共享同一个高亮 ID。
// PDF 选区可以跨越多页：按页（各自的文本层）拆成片段，每个片段只在所属页中定位。
// ================================

import type { HighlightSegment } from './reading-state';
import { isTextBoundary } from './html-blocks';

/** 标记元素上记录高亮 ID 的属性 */
export const HIGHLIGHT_ID_ATTR = 'data-highlight-id';

/** 数学公式渲染结果内部不做包裹，避免破坏公式排版 */
const SKIP_SELECTOR = '.math-inline-wrapper, .math-block-wrapper';

/** 归一化文本中每个字符对应的原始位置；null 表示块级边界产生的虚拟空格 */
type SourcePosition = { node: Text; offset: number } | null;

interface TextIndex {
  text: string;
  positions: SourcePosition[];
}

/** 一个文本节点内需要包裹的区间 */
interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

/** 需要在某个根元素内标记的高亮（PDF 高亮为所属页的片段） */
export interface HighlightTarget {
  id: string;
  text: string;
  /** 文字在归一化文本中的起始位置；有多处相同文字时取离它最近的一处 */
  offset?: number;
}

/** 选区在某个根元素内覆盖的文字 */
export interface SelectedTextSpan {
  text: string;
  /** 在归一化文本中的起始位置 */
  offset: number;
}

function highlightMarks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`mark[${HIGHLIGHT_ID_ATTR}]`));
}

function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 构建归一化文本及其到文本节点的映射 */
function buildTextIndex(root: HTMLElement): TextIndex {
  const chars: string[] = [];
  const positions: SourcePosition[] = [];
  const endsWithSpace = () => chars.length === 0 || chars[chars.length - 1] === ' ';

  const pushBoundary = () => {
    if (endsWithSpace()) return;
    chars.push(' ');
    positions.push(null);
  };

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      for (let offset = 0; offset < value.length; offset++) {
        const char = value[offset];
        if (/\s/.test(char)) {
          if (endsWithSpace()) continue;
          chars.push(' ');
        } else {
          chars.push(char);
        }
        positions.push({ node: node as Text, offset });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches(SKIP_SELECTOR)) return;
    const boundary = isTextBoundary(element);
    if (boundary) pushBoundary();
    element.childNodes.forEach(visit);
    if (boundary) pushBoundary();
  };

  root.childNodes.forEach(visit);
  return { text: chars.join(''), positions };
}

/** needle 在 text 中的出现位置；给出 offset 时取离它最近的一处，否则取首次出现 */
function findOccurrence(text: string, needle: string, offset: number | undefined): number {
  let best = text.indexOf(needle);
  if (best < 0 || offset === undefined) return best;
  for (let next = text.indexOf(needle, best + 1); next >= 0; next = text.indexOf(needle, next + 1)) {
    if (Math.abs(next - offset) >= Math.abs(best - offset)) break;
    best = next;
  }
  return best;
}

/** 在正文中定位文本，返回按文本节点拆分的区间（文档顺序） */
function locateSegments(root: HTMLElement, quote: string, offset: number | undefined): TextSegment[] {
  const needle = normalizeQuote(quote);
  if (!needle) return [];
  const index = buildTextIndex(root);
  const start = findOccurrence(index.text, needle, offset);
  if (start < 0) return [];

  const segments: TextSegment[] = [];
  for (const position of index.positions.slice(start, start + needle.length)) {
    if (!position) continue;
    const last = segments[segments.length - 1];
    if (last && last.node === position.node) {
      last.end = position.offset + 1;
    } else {
      segments.push({ node: position.node, start: position.offset, end: position.offset + 1 });
    }
  }
  // 纯空白片段（如块级元素之间的换行）不包裹，避免在 <ul>/<table> 等容器中插入非法子元素
  return segments.filter(({ node, start, end }) => (node.nodeValue ?? '').slice(start, end).trim() !== '');
}

/** 把文本节点中的 [start, end) 区间拆出并包裹到 mark 中 */
function wrapSegment({ node, start, end }: TextSegment, id: string, className: string): void {
  const target = start > 0 ? node.splitText(start) : node;
  if (end - start < target.length) target.splitText(end - start);
  const mark = document.createElement('mark');
  mark.className = className;
  mark.setAttribute(HIGHLIGHT_ID_ATTR, id);
  target.parentNode?.insertBefore(mark, target);
  mark.appendChild(target);
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
 * 为高亮包裹 <mark>，返回成功定位的高亮 ID。
 * 逐条处理并在每条之后重新建立索引，重叠的高亮会形成嵌套标记。
 */
export function applyHighlightMarks(
  root: HTMLElement,
  highlights: readonly HighlightTarget[],
  className: string
): Set<string> {
  const applied = new Set<string>();
  for (const highlight of highlights) {
    const segments = locateSegments(root, highlight.text, highlight.offset);
    if (segments.length === 0) continue;
    // 各区间位于不同文本节点，拆分互不影响偏移
    segments.forEach((segment) => wrapSegment(segment, highlight.id, className));
    applied.add(highlight.id);
  }
  return applied;
}

/**
 * 查找某条高亮的第一个标记元素
 */
export function findHighlightMark(root: HTMLElement, id: string): HTMLElement | null {
  return highlightMarks(root).find((mark) => mark.getAttribute(HIGHLIGHT_ID_ATTR) === id) ?? null;
}

/**
 * 为某条高亮的全部标记加上选中样式，返回撤销函数
 */
export function setActiveHighlight(root: HTMLElement, id: string, className: string): () => void {
  const marks = highlightMarks(root).filter((mark) => mark.getAttribute(HIGHLIGHT_ID_ATTR) === id);
  marks.forEach((mark) => mark.classList.add(className));
  return () => marks.forEach((mark) => mark.classList.remove(className));
}

/**
 * 选区在 root 内覆盖的归一化文本及其起始位置；没有文字时返回 null。
 * 与高亮定位使用同一套文本索引，保存的原文一定能被重新定位；
 * 用于绝对定位的 PDF 文本层：浏览器的 Selection.toString() 可能在各个绝对定位的文本片段之间插入换行，与索引不一致。
 */
export function selectedTextSpan(root: HTMLElement, range: Range): SelectedTextSpan | null {
  // comparePoint 在节点与选区不在同一棵树时会抛错，先排除与 root 无交集的选区
  if (!range.intersectsNode(root)) return null;
  const { text, positions } = buildTextIndex(root);
  let first = -1;
  let last = -1;
  positions.forEach((position, index) => {
    if (!position) return;
    // 字符完整落在选区内：起点不早于选区起点、终点不晚于选区终点
    if (range.comparePoint(position.node, position.offset) < 0) return;
    if (range.comparePoint(position.node, position.offset + 1) > 0) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return null;
  const raw = text.slice(first, last + 1);
  const trimmed = raw.trim();
  return trimmed ? { text: trimmed, offset: first + raw.length - raw.trimStart().length } : null;
}

/**
 * 把选区按页拆成高亮片段（按 pages 的顺序）：每页取选区在该页文本层内覆盖的文字，没有文字的页面跳过
 */
export function selectionSegments(
  pages: ReadonlyArray<{ page: number; root: HTMLElement }>,
  range: Range
): HighlightSegment[] {
  return pages.flatMap(({ page, root }) => {
    const span = selectedTextSpan(root, range);
    return span ? [{ page, ...span }] : [];
  });
}
