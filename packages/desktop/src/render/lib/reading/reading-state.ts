// ================================
// 阅读状态
// 书架归属、阅读进度与高亮摘录保存在 item.metadata.reading 中。
// 本模块负责：安全读取（逐字段校验结构）、合并写回（不丢失其他元数据键）、
// 书架归属规则、阅读状态推导与书架排序/筛选，以及摘录笔记的生成。
// ================================

import type { KnowledgeItem, KnowledgeItemType } from '../../types/knowledge';
import { displayTitle } from '../links/link-index';

/**
 * 一条高亮（摘录到知识库的高亮会记录新条目 ID）。
 * 与其他阅读状态一起保存在条目 metadata（JSON 列）中，新增字段无需改动表结构
 */
export interface ReadingHighlight {
  id: string;
  /** 高亮的原文 */
  text: string;
  /** 用户批注 */
  note?: string;
  /** 创建时间（ISO） */
  createdAt: string;
  /** 摘录生成的知识条目 ID */
  excerptItemId?: string;
  /** PDF 高亮所在页码（从 1 开始）：原文只在该页的文本层中定位 */
  page?: number;
}

/** metadata.reading 的结构 */
export interface ReadingState {
  /** 显式加入（true）或移出（false）书架；未设置时按类型决定 */
  inShelf?: boolean;
  /** 阅读进度 0-1 */
  progress?: number;
  /** 最后阅读时间（ISO） */
  lastReadAt?: string;
  /** 读完时间（ISO） */
  finishedAt?: string;
  highlights?: ReadingHighlight[];
}

/** 阅读状态 */
export type ReadingStatus = 'unread' | 'reading' | 'finished';

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  unread: '未开始',
  reading: '阅读中',
  finished: '已读完',
};

/** 书架筛选：全部或某一阅读状态 */
export type ShelfFilter = 'all' | ReadingStatus;

/** 进度达到该值视为读完 */
export const FINISHED_THRESHOLD = 0.98;

const METADATA_KEY = 'reading';

/** 默认在书架上的条目类型 */
const DEFAULT_SHELF_TYPES: ReadonlySet<KnowledgeItemType> = new Set<KnowledgeItemType>([
  'webpage',
  'bookmark',
  'document',
]);

// ================================
// 读取与校验
// ================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isoDate(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseHighlight(value: unknown): ReadingHighlight | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const text = nonEmptyString(value.text);
  const createdAt = isoDate(value.createdAt);
  if (!id || !text || !createdAt) return null;

  const highlight: ReadingHighlight = { id, text, createdAt };
  const note = nonEmptyString(value.note);
  if (note) highlight.note = note;
  const excerptItemId = nonEmptyString(value.excerptItemId);
  if (excerptItemId) highlight.excerptItemId = excerptItemId;
  if (typeof value.page === 'number' && Number.isInteger(value.page) && value.page >= 1) {
    highlight.page = value.page;
  }
  return highlight;
}

/**
 * 从条目元数据读取阅读状态；结构不合法的字段被忽略
 */
export function getReadingState(item: Pick<KnowledgeItem, 'metadata'>): ReadingState {
  const raw = item.metadata?.[METADATA_KEY];
  if (!isRecord(raw)) return {};

  const state: ReadingState = {};
  if (typeof raw.inShelf === 'boolean') state.inShelf = raw.inShelf;
  if (typeof raw.progress === 'number' && Number.isFinite(raw.progress)) {
    state.progress = clampProgress(raw.progress);
  }
  const lastReadAt = isoDate(raw.lastReadAt);
  if (lastReadAt) state.lastReadAt = lastReadAt;
  const finishedAt = isoDate(raw.finishedAt);
  if (finishedAt) state.finishedAt = finishedAt;
  if (Array.isArray(raw.highlights)) {
    const highlights = raw.highlights
      .map(parseHighlight)
      .filter((highlight): highlight is ReadingHighlight => highlight !== null);
    if (highlights.length > 0) state.highlights = highlights;
  }
  return state;
}

// ================================
// 更新
// ================================

/**
 * 合并阅读状态补丁；补丁中值为 undefined 的字段会被移除
 */
export function patchReadingState(state: ReadingState, patch: Partial<ReadingState>): ReadingState {
  const next: Record<string, unknown> = { ...state, ...patch };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  return next as ReadingState;
}

/**
 * 生成写回用的完整元数据：保留其他键、替换 reading；阅读状态为空时移除该键
 */
export function withReadingState(
  metadata: Record<string, unknown> | undefined,
  state: ReadingState
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metadata };
  if (Object.keys(state).length > 0) next[METADATA_KEY] = state;
  else delete next[METADATA_KEY];
  return next;
}

/**
 * 记录滚动进度：同时刷新最后阅读时间，首次达到阈值时记录读完时间
 */
export function progressPatch(
  state: ReadingState,
  progress: number,
  now: Date = new Date()
): Partial<ReadingState> {
  const value = clampProgress(progress);
  const patch: Partial<ReadingState> = { progress: value, lastReadAt: now.toISOString() };
  if (value >= FINISHED_THRESHOLD && !state.finishedAt) patch.finishedAt = now.toISOString();
  return patch;
}

/**
 * 标记为已读（进度拉满）或未读（清空进度，回到“未开始”）
 */
export function finishedPatch(finished: boolean, now: Date = new Date()): Partial<ReadingState> {
  if (!finished) return { progress: undefined, lastReadAt: undefined, finishedAt: undefined };
  const timestamp = now.toISOString();
  return { progress: 1, lastReadAt: timestamp, finishedAt: timestamp };
}

// ================================
// 书架
// ================================

/**
 * 书架归属：网页剪藏/书签/文档默认在书架上；显式设置的 inShelf 优先
 */
export function isOnShelf(item: Pick<KnowledgeItem, 'type' | 'metadata'>): boolean {
  const { inShelf } = getReadingState(item);
  return inShelf ?? DEFAULT_SHELF_TYPES.has(item.type);
}

/**
 * 推导阅读状态：有读完时间为已读完；有进度或阅读记录为阅读中
 */
export function getReadingStatus(state: ReadingState): ReadingStatus {
  if (state.finishedAt) return 'finished';
  if ((state.progress ?? 0) > 0 || state.lastReadAt) return 'reading';
  return 'unread';
}

function lastReadTime(item: KnowledgeItem): number {
  const { lastReadAt } = getReadingState(item);
  return lastReadAt ? Date.parse(lastReadAt) : -Infinity;
}

/**
 * 书架排序：最近阅读在前；未读过的按更新时间倒序排在其后
 */
export function sortShelfItems(items: KnowledgeItem[]): KnowledgeItem[] {
  return [...items].sort(
    (a, b) =>
      lastReadTime(b) - lastReadTime(a) || b.updatedAt.getTime() - a.updatedAt.getTime()
  );
}

/**
 * 按阅读状态与关键词（标题、来源 URL）筛选
 */
export function filterShelfItems(
  items: KnowledgeItem[],
  filter: ShelfFilter,
  query: string
): KnowledgeItem[] {
  const keyword = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter !== 'all' && getReadingStatus(getReadingState(item)) !== filter) return false;
    if (!keyword) return true;
    return (
      displayTitle(item.title).toLowerCase().includes(keyword) ||
      (item.sourceUrl ?? '').toLowerCase().includes(keyword)
    );
  });
}

/**
 * 相对时间描述（最后阅读、高亮时间等）
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ================================
// 摘录
// ================================

export interface ExcerptSource {
  title: string;
  sourceUrl?: string;
}

export interface ExcerptInput {
  /** 摘录原文 */
  quote: string;
  /** 用户批注 */
  note?: string;
  source: ExcerptSource;
  /** 原文所在页码（PDF） */
  page?: number;
}

/** 摘录标题中引用原文的最大字符数 */
const EXCERPT_TITLE_LENGTH = 20;

/**
 * 摘录笔记的 Markdown：原文引用块 + 可选批注 + 来源双向链接（及页码、原始链接）
 */
export function buildExcerptMarkdown({ quote, note, source, page }: ExcerptInput): string {
  const quoteBlock = quote
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');

  let sourceLine = `来源：[[${displayTitle(source.title)}]]`;
  if (page) sourceLine += ` · 第 ${page} 页`;
  if (source.sourceUrl) sourceLine += ` · [原文链接](${source.sourceUrl})`;

  const blocks = [quoteBlock];
  const trimmedNote = note?.trim();
  if (trimmedNote) blocks.push(trimmedNote);
  blocks.push(sourceLine);
  return `${blocks.join('\n\n')}\n`;
}

/**
 * 摘录笔记标题：“摘录：” + 原文前 20 个字符（去掉换行与文件名非法字符）+ .md
 */
export function buildExcerptTitle(quote: string): string {
  const compact = quote
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const head = Array.from(compact).slice(0, EXCERPT_TITLE_LENGTH).join('').trim();
  return `摘录：${head}.md`;
}
