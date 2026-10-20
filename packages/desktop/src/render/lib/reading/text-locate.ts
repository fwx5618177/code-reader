// ================================
// 按文字在阅读视图中定位（全局精确查找打开网页剪藏、PDF 等阅读条目时定位到命中处）
// 命中行来自条目正文的源码，渲染后的文字与源码的空白、换行不同：比较时忽略全部空白
// ================================

import { markdownToPlainText } from '../markdown';

/** 定位时查找的块级元素：命中文字所在的段落、列表项、标题、单元格等 */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, figcaption, dd, dt';

const removeWhitespace = (text: string) => text.replace(/\s+/g, '');

/** 文章源码中一行的可读文字（去掉 Markdown 标记，用于在渲染后的正文中查找）；去不掉时用原文 */
export function plainTextOfSourceLine(sourceLine: string): string {
  return markdownToPlainText(sourceLine) || sourceLine;
}

/** 在元素的文字中查找 needle（忽略空白）：返回命中的各个字符所属的文本节点（按顺序、不重复）；找不到返回空数组 */
function matchedTextNodes(root: HTMLElement, needle: string): Text[] {
  const target = removeWhitespace(needle);
  if (!target) return [];
  const nodes: Text[] = [];
  /** 去掉空白后每个字符所属的文本节点（nodes 下标） */
  const owners: number[] = [];
  let text = '';
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const compact = removeWhitespace(node.textContent ?? '');
    if (!compact) continue;
    nodes.push(node as Text);
    text += compact;
    for (let i = 0; i < compact.length; i++) owners.push(nodes.length - 1);
  }
  const index = text.indexOf(target);
  if (index === -1) return [];
  return nodes.slice(owners[index], owners[index + target.length - 1] + 1);
}

/**
 * 在元素的文字中查找 needle（忽略空白），返回命中起点所在的块级元素；找不到返回 null
 */
export function findTextBlock(root: HTMLElement, needle: string): HTMLElement | null {
  const parent = matchedTextNodes(root, needle)[0]?.parentElement;
  return parent ? (parent.closest<HTMLElement>(BLOCK_SELECTOR) ?? parent) : null;
}

/**
 * 命中文字所在的全部元素（如 PDF 文本层中的各个文字片段，命中可能跨越多个片段）；找不到返回空数组
 */
export function findTextElements(root: HTMLElement, needle: string): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const node of matchedTextNodes(root, needle)) {
    const parent = node.parentElement;
    if (parent && parent !== root && !elements.includes(parent)) elements.push(parent);
  }
  return elements;
}

/** 包含 needle（忽略空白）的第一页页码（从 1 计）；找不到返回 null */
export function findPageContaining(pageTexts: readonly string[], needle: string): number | null {
  const target = removeWhitespace(needle);
  if (!target) return null;
  const index = pageTexts.findIndex((text) => removeWhitespace(text).includes(target));
  return index === -1 ? null : index + 1;
}
