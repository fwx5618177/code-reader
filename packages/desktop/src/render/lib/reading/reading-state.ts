// ================================
// 阅读状态
// 书架归属、阅读进度与高亮摘录保存在 item.metadata.reading 中。
// 本模块负责：安全读取（逐字段校验结构）、合并写回（不丢失其他元数据键）、
// 书架归属规则、阅读状态推导与书架排序/筛选，以及摘录笔记的生成。
// ================================

import type { KnowledgeItem, KnowledgeItemType } from '../../types/knowledge';
import { displayTitle } from '../links/link-index';

/**
 * PDF 高亮在某一页上的片段。跨页选区按页拆分，每页一个片段，渲染时各页分别定位
 */
export interface HighlightSegment {
  /** 页码（从 1 开始） */
  page: number;
  /** 该页内被高亮的原文（与文本层定位使用同一套归一化规则） */
  text: string;
  /** 片段在该页归一化文本中的起始位置：同页多处相同文字时定位到被选中的那一处 */
  offset?: number;
}

/**
 * 一条高亮（摘录到知识库的高亮会记录新条目 ID）。
 * 与其他阅读状态一起保存在条目 metadata（JSON 列）中，新增字段无需改动表结构
 */
export interface ReadingHighlight {
  id: string;
  /** 高亮的原文（PDF 高亮为各页片段的拼接） */
  text: string;
  /** 用户批注 */
  note?: string;
  /** 创建时间（ISO） */
  createdAt: string;
  /** 摘录生成的知识条目 ID */
  excerptItemId?: string;
  /**
   * PDF 高亮按页的片段（按文档顺序）；正文高亮没有。
   * 旧数据只有单个 page 字段，读取时规范化为一个片段
   */
  segments?: HighlightSegment[];
}

/** 一个书签：记录添加时的阅读位置 */
export interface ReadingBookmark {
  id: string;
  /** 创建时间（ISO） */
  createdAt: string;
  /** 展示名称（章节标题或页码等） */
  label: string;
  /** 添加时的全书进度 0-1，用于排序与非 PDF 的跳转 */
  progress: number;
  /** PDF 书签所在页码（从 1 开始） */
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
  /** 书签，按进度升序 */
  bookmarks?: ReadingBookmark[];
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

function isPage(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function parseSegment(value: unknown): HighlightSegment | null {
  if (!isRecord(value)) return null;
  const text = nonEmptyString(value.text);
  if (!isPage(value.page) || !text) return null;
  const segment: HighlightSegment = { page: value.page, text };
  if (typeof value.offset === 'number' && Number.isInteger(value.offset) && value.offset >= 0) {
    segment.offset = value.offset;
  }
  return segment;
}

/** PDF 高亮的片段：优先读取 segments；旧数据的单个 page 规范化为整段原文位于该页 */
function parseSegments(value: Record<string, unknown>, text: string): HighlightSegment[] | undefined {
  if (Array.isArray(value.segments)) {
    const segments = value.segments
      .map(parseSegment)
      .filter((segment): segment is HighlightSegment => segment !== null);
    return segments.length > 0 ? segments : undefined;
  }
  return isPage(value.page) ? [{ page: value.page, text }] : undefined;
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
  const segments = parseSegments(value, text);
  if (segments) highlight.segments = segments;
  return highlight;
}

function parseBookmark(value: unknown): ReadingBookmark | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const label = nonEmptyString(value.label);
  const createdAt = isoDate(value.createdAt);
  if (!id || !label || !createdAt) return null;
  if (typeof value.progress !== 'number' || !Number.isFinite(value.progress)) return null;

  const bookmark: ReadingBookmark = { id, label, createdAt, progress: clampProgress(value.progress) };
  if (isPage(value.page)) bookmark.page = value.page;
  return bookmark;
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
  if (Array.isArray(raw.bookmarks)) {
    const bookmarks = raw.bookmarks
      .map(parseBookmark)
      .filter((bookmark): bookmark is ReadingBookmark => bookmark !== null);
    if (bookmarks.length > 0) state.bookmarks = bookmarks;
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

/**
 * 添加书签并保持按进度升序（进度相同时先添加的在前）
 */
export function addBookmark(
  bookmarks: readonly ReadingBookmark[] | undefined,
  bookmark: ReadingBookmark
): ReadingBookmark[] {
  return [...(bookmarks ?? []), bookmark].sort((a, b) => a.progress - b.progress);
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
 * 最近阅读：只保留有阅读记录的条目，按最后阅读时间倒序
 */
export function pickRecentlyRead(items: KnowledgeItem[]): KnowledgeItem[] {
  return sortShelfItems(items.filter((item) => lastReadTime(item) > -Infinity));
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
// PDF 高亮页码
// ================================

/** 页码范围（从 1 开始，包含首末页） */
export interface PageRange {
  first: number;
  last: number;
}

/** 高亮片段覆盖的页码范围；没有片段（正文高亮）时为 undefined */
export function segmentPageRange(segments: readonly HighlightSegment[] | undefined): PageRange | undefined {
  if (!segments || segments.length === 0) return undefined;
  const pages = segments.map((segment) => segment.page);
  return { first: Math.min(...pages), last: Math.max(...pages) };
}

/** “第 3 页”或“第 3–4 页” */
export function formatPageRange({ first, last }: PageRange): string {
  return first === last ? `第 ${first} 页` : `第 ${first}–${last} 页`;
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
  /** 原文所在页码范围（PDF） */
  pages?: PageRange;
}

/** 摘录标题中引用原文的最大字符数 */
const EXCERPT_TITLE_LENGTH = 20;

/**
 * 摘录笔记的 Markdown：原文引用块 + 可选批注 + 来源双向链接（及页码、原始链接）
 */
export function buildExcerptMarkdown({ quote, note, source, pages }: ExcerptInput): string {
  const quoteBlock = quote
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');

  let sourceLine = `来源：[[${displayTitle(source.title)}]]`;
  if (pages) sourceLine += ` · ${formatPageRange(pages)}`;
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
