// ================================
// 条目在列表与详情中的展示文本
// ================================

import type { KnowledgeItem } from '../../types/knowledge';
import { markdownToPlainText } from '../../lib/markdown/extract';
import { formatRelativeTime } from '../../lib/reading';

const SNIPPET_LENGTH = 120;
/** 只解析正文开头的这部分字符，长文档滚动时不必整篇解析 */
const SNIPPET_SOURCE_LENGTH = 600;

/** 条目对象在更新时整体替换，以对象为键缓存即可自动失效 */
const snippetCache = new WeakMap<KnowledgeItem, string>();

/**
 * 预览文本：优先 AI 摘要，否则取正文（去除 Markdown 标记）或转写的开头
 */
export function itemSnippet(item: KnowledgeItem): string {
  const cached = snippetCache.get(item);
  if (cached !== undefined) return cached;

  let text = item.summary?.trim() ?? '';
  if (!text && item.content?.trim()) {
    text = markdownToPlainText(item.content.slice(0, SNIPPET_SOURCE_LENGTH));
  }
  if (!text && item.transcript) text = item.transcript.slice(0, SNIPPET_SOURCE_LENGTH);

  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH);
  snippetCache.set(item, snippet);
  return snippet;
}

export function relativeTime(date: Date): string {
  return formatRelativeTime(date.toISOString());
}

export function absoluteTime(date: Date): string {
  return date.toLocaleString('zh-CN', { hour12: false });
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}
