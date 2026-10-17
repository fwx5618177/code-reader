// ================================
// 双向链接语法：[[目标#标题|别名]]、![[目标#标题]]
// 解析、格式化与标题匹配，供分词器、编辑器、渲染与重命名共用
// ================================

import type { NodeType, ResolvedPos } from 'prosemirror-model';

/** 双向链接的组成部分 */
export interface WikiLinkParts {
  /** 目标文档标题；空字符串表示当前文档（[[#标题]]） */
  target: string;
  /** 目标文档内的标题 */
  heading: string | null;
  /** 显示别名 */
  alias: string | null;
}

/**
 * 解析 [[…]] 内部文本
 * - 第一个 | 之后为别名，第一个 # 之后为标题
 * - # 后为空（如 [[C#]]）时整体视为目标，保证往返不变
 * 不合法（含方括号/换行，或目标与标题均为空）时返回 null
 */
export function parseWikiLinkInner(inner: string): WikiLinkParts | null {
  if (/[[\]\n]/.test(inner)) return null;
  const bar = inner.indexOf('|');
  const ref = bar === -1 ? inner : inner.slice(0, bar);
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim() || null;
  const hash = ref.indexOf('#');
  const heading = hash === -1 ? '' : ref.slice(hash + 1).trim();
  const target = (heading ? ref.slice(0, hash) : ref).trim();
  if (!target && !heading) return null;
  return { target, heading: heading || null, alias };
}

/** 链接引用文本：目标#标题（点击回调与显示均使用此形式） */
export function wikiLinkRef(target: string, heading: string | null): string {
  return heading ? `${target}#${heading}` : target;
}

/** 格式化为 Markdown 源码 */
export function formatWikiLink(parts: WikiLinkParts, embed = false): string {
  const alias = parts.alias ? `|${parts.alias}` : '';
  return `${embed ? '!' : ''}[[${wikiLinkRef(parts.target, parts.heading)}${alias}]]`;
}

/** 从渲染后的链接元素读取引用文本（data-wiki-target + data-wiki-heading） */
export function wikiLinkRefOf(element: HTMLElement): string {
  return wikiLinkRef(element.dataset.wikiTarget || '', element.dataset.wikiHeading || null);
}

/** 标题匹配键：忽略大小写与多余空白 */
function headingKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 匹配键为 key 的第 occurrence 个标题下标（从 0 计）；不存在时返回 -1 */
function nthHeadingIndex(headings: ReadonlyArray<{ text: string }>, key: string, occurrence: number): number {
  let seen = 0;
  return headings.findIndex((h) => headingKey(h.text) === key && seen++ === occurrence);
}

/**
 * 在标题列表中查找链接指向的标题
 * 先按完整文本匹配；[[note#父标题#子标题]] 这类路径写法再按最后一段匹配
 * occurrence 指定同名标题中的第几个（从 0 计，默认第一个）
 */
export function findHeadingIndex(
  headings: ReadonlyArray<{ text: string }>,
  heading: string,
  occurrence = 0
): number {
  const index = nthHeadingIndex(headings, headingKey(heading), occurrence);
  if (index !== -1 || !heading.includes('#')) return index;
  return nthHeadingIndex(headings, headingKey(heading.slice(heading.lastIndexOf('#') + 1)), occurrence);
}

/**
 * 第 index 个标题在同名标题中的序号（从 0 计），与 findHeadingIndex 的匹配规则一致：
 * findHeadingIndex(headings, headings[i].text, headingOccurrence(headings, i)) === i
 */
export function headingOccurrence(headings: ReadonlyArray<{ text: string }>, index: number): number {
  const key = headingKey(headings[index].text);
  return headings.slice(0, index).filter((h) => headingKey(h.text) === key).length;
}

/** 嵌入与标题的组合键（循环检测） */
export function embedKey(title: string, heading: string | null): string {
  return `${title}#${heading ? headingKey(heading) : ''}`;
}

/**
 * 段落中只有 ![[…]]（[[ 位于 $open，链接结束于 end），且该段落可整体替换为块级嵌入
 * 列表项必须以段落开头，因此列表项的首段不能替换
 */
export function isEmbedParagraph($open: ResolvedPos, end: number, embedType: NodeType): boolean {
  const paragraph = $open.parent;
  if (paragraph.type.name !== 'paragraph' || $open.parentOffset !== 1 || end !== $open.end()) return false;
  if (paragraph.textBetween(0, 1) !== '!') return false;
  const index = $open.index(-1);
  return $open.node(-1).canReplaceWith(index, index + 1, embedType);
}
