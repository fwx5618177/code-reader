// ================================
// 使用指南的目录与站内锚点
// 指南按 GitHub 的写法互相引用章节（[从这里开始](#1-从这里开始)），应用内渲染时标题的 id 是 heading-序号，
// 这里按 GitHub 的规则算出每个标题的锚点，把 #锚点 换算成渲染结果中的 id
// ================================

import type { RenderedHeading } from '../../lib/markdown';

/** 目录收录的标题层级：二级为章，三级为节 */
const OUTLINE_LEVELS = new Set([2, 3]);

/**
 * GitHub 生成标题锚点的规则：小写；去掉标点与符号（保留字母、数字、空格、- 与 _）；每个空格换成 -；
 * 同名标题依次加 -1、-2
 */
export function headingSlugs(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  });
}

/** #锚点 → 渲染结果中的标题 id */
export function anchorIndex(headings: readonly RenderedHeading[]): Map<string, string> {
  const slugs = headingSlugs(headings.map((heading) => heading.text));
  return new Map(slugs.map((slug, i) => [slug, headings[i]!.id]));
}

/** 链接里的 #锚点（百分号编码的中文先解码）；不是站内锚点时返回 null */
export function anchorOf(href: string): string | null {
  if (!href.startsWith('#') || href.length < 2) return null;
  try {
    return decodeURIComponent(href.slice(1)).toLowerCase();
  } catch {
    return href.slice(1).toLowerCase();
  }
}

/** 目录：章与节，按关键字过滤时保留命中的节及其所在的章 */
export function guideOutline(headings: readonly RenderedHeading[], filter: string): RenderedHeading[] {
  const outline = headings.filter((heading) => OUTLINE_LEVELS.has(heading.level));
  const query = filter.trim().toLowerCase();
  if (!query) return outline;
  const result: RenderedHeading[] = [];
  let chapterPending: RenderedHeading | null = null;
  for (const heading of outline) {
    const hit = heading.text.toLowerCase().includes(query);
    if (heading.level === 2) {
      chapterPending = hit ? null : heading;
      if (hit) result.push(heading);
    } else if (hit) {
      if (chapterPending) result.push(chapterPending);
      chapterPending = null;
      result.push(heading);
    }
  }
  return result;
}
