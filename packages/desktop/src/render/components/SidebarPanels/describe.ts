// ================================
// 侧栏条目列表每行的说明文字
// ================================

import type { KnowledgeItem } from '../../types/knowledge';
import { getReadingState } from '../../lib/reading';
import { relativeTime } from '../KnowledgeWorkspace/item-display';
import { ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';

/** 类型 · 更新时间（最近、标签筛选结果） */
export function describeUpdated(item: KnowledgeItem): string {
  return `${ITEM_TYPE_LABELS[item.type]} · 更新于 ${relativeTime(item.updatedAt)}`;
}

/** 类型 · 创建时间（日历当日条目） */
export function describeCreated(item: KnowledgeItem): string {
  return `${ITEM_TYPE_LABELS[item.type]} · 创建于 ${relativeTime(item.createdAt)}`;
}

/** 阅读进度 · 最后阅读时间（最近阅读） */
export function describeReading(item: KnowledgeItem): string {
  const { progress = 0, lastReadAt } = getReadingState(item);
  const read = `读到 ${Math.round(progress * 100)}%`;
  return lastReadAt ? `${read} · ${relativeTime(new Date(lastReadAt))}` : read;
}
