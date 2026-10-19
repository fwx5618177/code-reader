// ================================
// 精确查找（⌘P 的“精确”模式）：在全部条目正文中逐行查找，支持区分大小写、全词、正则，
// 结果带行号与命中位置。查找由 search-service 的 FileSearcher 完成，条目正文经 IFileProvider 提供
// ================================

import { FileSearcher, type FileMatch, type IFileProvider, type MatchPosition } from '@code-reader/search-service';
import { databaseService } from '../../services/database';
import { isWritingDocument } from '../../lib/documents/constants';
import { getFileTypeId } from '../../lib/documents/file-types';
import { displayTitle } from '../../lib/links/link-index';
import { topLevelBlockAtLine, type SourceLocation } from '../../lib/markdown';
import type { KnowledgeItemType } from '../../types/knowledge';
import { ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';

export interface ExactSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export interface ExactLineHit {
  lineNumber: number;
  text: string;
  positions: MatchPosition[];
  location: SourceLocation;
}

export interface ExactItemHit {
  id: string;
  title: string;
  type: KnowledgeItemType;
  matchCount: number;
  lines: ExactLineHit[];
}

export interface ExactSearchResult {
  items: ExactItemHit[];
  /** 命中行数超过上限而被截断 */
  truncated: boolean;
}

interface SearchableRow {
  id: string;
  title: string;
  type: string;
  content: string;
}

/** 每个条目最多列出的命中行 */
const MAX_LINES_PER_ITEM = 20;
/** 最多列出的条目 */
const MAX_ITEMS = 100;

/**
 * 条目正文的快照：一次查询读出全部有正文的条目，FileSearcher 按“路径”（条目 ID）读取
 */
class KnowledgeContentProvider implements IFileProvider {
  constructor(private readonly rows: ReadonlyMap<string, SearchableRow>) {}

  async listFiles(): Promise<string[]> {
    return [...this.rows.keys()];
  }

  async readFile(id: string): Promise<string> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`条目不存在：${id}`);
    return row.content;
  }

  async getFileSize(id: string): Promise<number> {
    return this.rows.get(id)?.content.length ?? 0;
  }

  getFileName(id: string): string {
    return this.rows.get(id)?.title ?? id;
  }
}

/** 数据库中的类型字段为自由文本，未知类型按普通文件展示 */
function toItemType(type: string): KnowledgeItemType {
  return type in ITEM_TYPE_LABELS ? (type as KnowledgeItemType) : 'file';
}

/**
 * 源码行对应的顶层块：Markdown 笔记按块级结构换算，纯文本一行一段，其余格式（LaTeX 等）不需要
 */
function locate(row: SearchableRow, line: number): SourceLocation {
  if (!isWritingDocument(row)) return { line, block: 0 };
  const fileType = getFileTypeId(row.title);
  if (fileType === 'plain') return { line, block: line - 1 };
  if (fileType === 'latex') return { line, block: 0 };
  return { line, block: topLevelBlockAtLine(row.content, line - 1) ?? 0 };
}

function toItemHit(match: FileMatch, row: SearchableRow): ExactItemHit {
  return {
    id: row.id,
    title: displayTitle(row.title) || '无标题',
    type: toItemType(row.type),
    matchCount: match.matchCount,
    lines: match.matches.slice(0, MAX_LINES_PER_ITEM).map((line) => ({
      lineNumber: line.lineNumber,
      text: line.lineContent,
      positions: line.positions,
      location: locate(row, line.lineNumber),
    })),
  };
}

/**
 * 在全部条目正文中精确查找。正则无效时抛出 search-service 的 InvalidSearchPatternError
 */
export async function exactSearch(
  query: string,
  options: ExactSearchOptions,
  signal?: AbortSignal
): Promise<ExactSearchResult> {
  const rows = await databaseService.all<SearchableRow>(
    `SELECT id, title, type, content FROM knowledge_items
     WHERE is_deleted = 0 AND content IS NOT NULL AND content != ''
     ORDER BY is_pinned DESC, updated_at DESC`
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const searcher = new FileSearcher(new KnowledgeContentProvider(byId));
  const { results } = await searcher.search(query, {
    ...options,
    contextLines: 0,
    maxFiles: MAX_ITEMS + 1,
    maxMatchesPerFile: MAX_LINES_PER_ITEM,
    excludePatterns: [],
    maxFileSize: Number.POSITIVE_INFINITY,
    abortSignal: signal,
  });

  // 结果按条目原有顺序（置顶、最近更新在前）排列
  const order = new Map(rows.map((row, index) => [row.id, index]));
  const sorted = [...results].sort((a, b) => order.get(a.path)! - order.get(b.path)!);
  return {
    items: sorted.slice(0, MAX_ITEMS).map((match) => toItemHit(match, byId.get(match.path)!)),
    truncated: sorted.length > MAX_ITEMS,
  };
}

export interface LineSegment {
  text: string;
  highlight: boolean;
}

/** 命中行拆成普通文本与高亮片段（以 React 文本节点渲染）；过长的行截取第一处命中附近 */
export function lineSegments(text: string, positions: readonly MatchPosition[], maxLength = 160): LineSegment[] {
  const first = positions[0]?.start ?? 0;
  const start = text.length > maxLength ? Math.max(0, Math.min(first - 40, text.length - maxLength)) : 0;
  const end = Math.min(text.length, start + maxLength);
  const segments: LineSegment[] = [];
  let cursor = start;
  for (const position of positions) {
    if (position.end <= cursor || position.start >= end) continue;
    const from = Math.max(position.start, cursor);
    if (from > cursor) segments.push({ text: text.slice(cursor, from), highlight: false });
    const to = Math.min(position.end, end);
    segments.push({ text: text.slice(from, to), highlight: true });
    cursor = to;
  }
  if (cursor < end) segments.push({ text: text.slice(cursor, end), highlight: false });
  if (start > 0) segments.unshift({ text: '…', highlight: false });
  if (end < text.length) segments.push({ text: '…', highlight: false });
  return segments;
}
