// ================================
// 知识库条目流的纯逻辑：范围 → 搜索 / 类型 / 标签筛选 → 排序 → 分组 → 虚拟列表行
// 不依赖 React，便于单元测试
// ================================

import type { KnowledgeItem, KnowledgeItemType, Tag } from '../../types/knowledge';
import { matchesAllRules, type FilterRule } from '../../lib/knowledge/filter-rules';
import { tagLineageIds, tagScopeIds } from '../../lib/knowledge/tag-tree';
import { displayTitle } from '../../lib/links/link-index';

/** 全部条目类型（筛选与分组的固定顺序） */
export const ITEM_TYPES: readonly KnowledgeItemType[] = [
  'note',
  'audio',
  'image',
  'video',
  'document',
  'webpage',
  'code',
  'bookmark',
  'file',
];

export type SortKey = 'updated' | 'created' | 'title';
export type GroupBy = 'none' | 'date' | 'type' | 'tag';

export const SORT_LABELS: Record<SortKey, string> = {
  updated: '最近更新',
  created: '创建时间',
  title: '标题',
};

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: '不分组',
  date: '按日期',
  type: '按类型',
  tag: '按标签',
};

// ================================
// 范围
// ================================

/** 侧边栏选中的范围：文件夹或智能文件夹 */
export interface WorkspaceScope {
  label: string;
  folderId?: string;
  rules?: FilterRule[];
}

export function filterByScope(
  items: KnowledgeItem[],
  scope: Pick<WorkspaceScope, 'folderId' | 'rules'>
): KnowledgeItem[] {
  return items.filter(
    (item) =>
      (!scope.folderId || item.folderId === scope.folderId) && matchesAllRules(item, scope.rules)
  );
}

// ================================
// 搜索与筛选
// ================================

export interface ItemFilters {
  /** 搜索词：空格分隔的多个词须全部命中 */
  query: string;
  /** 类型（多选，任一命中） */
  types: KnowledgeItemType[];
  /** 标签 ID（多选，全部命中；父标签包含其子孙标签） */
  tagIds: string[];
}

export const EMPTY_FILTERS: ItemFilters = { query: '', types: [], tagIds: [] };

export function hasActiveFilters(filters: ItemFilters): boolean {
  return !!filters.query.trim() || filters.types.length > 0 || filters.tagIds.length > 0;
}

export function parseSearchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** 条目的可搜索文本（小写）：标题、摘要、正文、转写与标签名 */
export function buildSearchText(
  item: KnowledgeItem,
  tagNameById: ReadonlyMap<string, string>
): string {
  const tagNames = item.tagIds.map((id) => tagNameById.get(id));
  return [item.title, item.summary, item.content, item.transcript, ...tagNames]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export interface FilterResult {
  items: KnowledgeItem[];
  /** 各类型条目数（应用搜索与标签筛选，不应用类型筛选） */
  typeCounts: Map<KnowledgeItemType, number>;
  /** 结果中带有各标签的条目数，即追加该标签后的结果数 */
  tagCounts: Map<string, number>;
}

function increment<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * 应用搜索、类型、标签筛选，并统计分面计数
 * 标签按层级匹配：选中父标签时带有其任一子孙标签的条目也命中；子标签的条目同时计入祖先标签的计数
 * @param searchText 条目的可搜索文本（由调用方缓存）
 * @param tags 全部标签（用于展开层级）
 */
export function applyFilters(
  items: KnowledgeItem[],
  filters: ItemFilters,
  searchText: (item: KnowledgeItem) => string,
  tags: readonly Tag[]
): FilterResult {
  const terms = parseSearchTerms(filters.query);
  const types = new Set(filters.types);
  const scopes = filters.tagIds.map((id) => tagScopeIds(id, tags));
  const lineage = tagLineageIds(tags);
  const result: FilterResult = { items: [], typeCounts: new Map(), tagCounts: new Map() };

  for (const item of items) {
    if (terms.length > 0) {
      const text = searchText(item);
      if (!terms.every((term) => text.includes(term))) continue;
    }
    if (!scopes.every((scope) => item.tagIds.some((id) => scope.has(id)))) continue;
    increment(result.typeCounts, item.type);
    if (types.size > 0 && !types.has(item.type)) continue;
    result.items.push(item);
    const counted = new Set(item.tagIds.flatMap((id) => lineage.get(id) ?? [id]));
    for (const tagId of counted) increment(result.tagCounts, tagId);
  }
  return result;
}

// ================================
// 排序
// ================================

const titleCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

const COMPARATORS: Record<SortKey, (a: KnowledgeItem, b: KnowledgeItem) => number> = {
  updated: (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  created: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  title: (a, b) => titleCollator.compare(displayTitle(a.title), displayTitle(b.title)),
};

/** 置顶条目在前，其余按所选方式排序 */
export function sortItems(items: KnowledgeItem[], sort: SortKey): KnowledgeItem[] {
  const compare = COMPARATORS[sort];
  return [...items].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || compare(a, b));
}

// ================================
// 分组
// ================================

export type DateBucket = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier';

export const DATE_BUCKET_LABELS: Record<DateBucket, string> = {
  today: '今天',
  yesterday: '昨天',
  thisWeek: '本周',
  thisMonth: '本月',
  earlier: '更早',
};

const DATE_BUCKETS: readonly DateBucket[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlier'];

/** 日期所属区间（一周从周一开始；“昨天”优先于“本周”；未来时间归入“今天”） */
export function dateBucket(date: Date, now: Date): DateBucket {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const time = date.getTime();
  if (time >= new Date(y, m, d).getTime()) return 'today';
  if (time >= new Date(y, m, d - 1).getTime()) return 'yesterday';
  const daysSinceMonday = (now.getDay() + 6) % 7;
  if (time >= new Date(y, m, d - daysSinceMonday).getTime()) return 'thisWeek';
  if (time >= new Date(y, m, 1).getTime()) return 'thisMonth';
  return 'earlier';
}

export interface ItemGroup {
  key: string;
  /** 不分组时为 null（不显示分组标题） */
  label: string | null;
  items: KnowledgeItem[];
}

/** 无标签分组的键 */
export const UNTAGGED_GROUP = '__untagged__';

/**
 * 按固定顺序分桶；一个条目可属于多个桶（按标签分组时），空桶不输出
 */
function bucketize(
  items: KnowledgeItem[],
  order: readonly { key: string; label: string }[],
  keysOf: (item: KnowledgeItem) => string[]
): ItemGroup[] {
  const buckets = new Map<string, KnowledgeItem[]>(order.map(({ key }) => [key, []]));
  for (const item of items) {
    for (const key of keysOf(item)) buckets.get(key)?.push(item);
  }
  return order
    .map(({ key, label }) => ({ key, label, items: buckets.get(key) ?? [] }))
    .filter((group) => group.items.length > 0);
}

export interface GroupOptions {
  /** 按日期分组时使用的时间字段与排序一致：按创建时间排序则按创建时间分组，否则按更新时间 */
  sort: SortKey;
  /** 按标签分组的顺序 */
  tags: Tag[];
  typeLabels: Record<KnowledgeItemType, string>;
  now: Date;
}

/**
 * 将已排序的条目分组（组内保持原顺序）
 * 按标签分组时，带多个标签的条目出现在每个标签下
 */
export function groupItems(
  items: KnowledgeItem[],
  groupBy: GroupBy,
  options: GroupOptions
): ItemGroup[] {
  switch (groupBy) {
    case 'none':
      return items.length > 0 ? [{ key: 'all', label: null, items }] : [];
    case 'date': {
      const field = options.sort === 'created' ? 'createdAt' : 'updatedAt';
      return bucketize(
        items,
        DATE_BUCKETS.map((key) => ({ key, label: DATE_BUCKET_LABELS[key] })),
        (item) => [dateBucket(item[field], options.now)]
      );
    }
    case 'type':
      return bucketize(
        items,
        ITEM_TYPES.map((key) => ({ key, label: options.typeLabels[key] })),
        (item) => [item.type]
      );
    case 'tag': {
      const known = new Set(options.tags.map((tag) => tag.id));
      return bucketize(
        items,
        [
          ...options.tags.map((tag) => ({ key: tag.id, label: tag.name })),
          { key: UNTAGGED_GROUP, label: '无标签' },
        ],
        (item) => {
          const ids = item.tagIds.filter((id) => known.has(id));
          return ids.length > 0 ? ids : [UNTAGGED_GROUP];
        }
      );
    }
  }
}

// ================================
// 虚拟列表行与键盘导航
// ================================

export type StreamRow =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'items'; key: string; items: KnowledgeItem[] };

/**
 * 分组 → 虚拟列表行：分组标题单独一行，条目按列数切分成行（列表布局为 1 列）
 */
export function buildStreamRows(groups: ItemGroup[], columns: number): StreamRow[] {
  const rows: StreamRow[] = [];
  const perRow = Math.max(1, Math.floor(columns));
  for (const group of groups) {
    if (group.label !== null) {
      rows.push({
        kind: 'header',
        key: `header:${group.key}`,
        label: group.label,
        count: group.items.length,
      });
    }
    for (let i = 0; i < group.items.length; i += perRow) {
      const chunk = group.items.slice(i, i + perRow);
      rows.push({ kind: 'items', key: `${group.key}:${chunk[0].id}`, items: chunk });
    }
  }
  return rows;
}

export interface StreamNavigation {
  /** 键盘导航顺序（去重，按首次出现） */
  order: string[];
  /** 条目首次出现所在的行 */
  rowOf: Map<string, number>;
}

export function indexStreamRows(rows: StreamRow[]): StreamNavigation {
  const order: string[] = [];
  const rowOf = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind !== 'items') return;
    for (const item of row.items) {
      if (rowOf.has(item.id)) continue;
      rowOf.set(item.id, index);
      order.push(item.id);
    }
  });
  return { order, rowOf };
}

/**
 * 键盘导航：返回移动后选中的条目；当前未选中或不在列表中时从首 / 尾开始
 */
export function stepSelection(
  order: string[],
  currentId: string | undefined,
  delta: 1 | -1
): string | undefined {
  if (order.length === 0) return undefined;
  const index = currentId ? order.indexOf(currentId) : -1;
  if (index === -1) return delta > 0 ? order[0] : order[order.length - 1];
  return order[Math.min(order.length - 1, Math.max(0, index + delta))];
}
