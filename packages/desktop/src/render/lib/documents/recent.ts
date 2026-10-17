// ================================
// 最近文档：写作文档（note 条目）按更新时间倒序，供托盘“最近打开”使用
// ================================

import type { KnowledgeItem } from '../../types/knowledge';
import type { RecentDocument } from '../../types/electron';
import { displayTitle } from '../links/link-index';
import { DOCUMENT_TYPE, PLACEHOLDERS } from './constants';

/** 托盘中显示的最近文档数 */
export const RECENT_DOCUMENTS_LIMIT = 10;

export function pickRecentDocuments(
  items: readonly KnowledgeItem[],
  limit: number = RECENT_DOCUMENTS_LIMIT
): RecentDocument[] {
  return items
    .filter((item) => item.type === DOCUMENT_TYPE && !item.isDeleted)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit)
    .map((item) => ({ id: item.id, title: displayTitle(item.title) || PLACEHOLDERS.TITLE }));
}
