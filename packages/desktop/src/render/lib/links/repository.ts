// ================================
// 链接持久化（SQLite links 表）
// - type='reference'：笔记中 [[双向链接]] 解析出的引用关系，随文档保存同步
// - type='ai-suggested'：Agent 根据语义相似度发现的关联（只读）
// ================================

import { databaseService, generateId, now } from '../../services/database';
import type { RelatedLink } from './link-index';

class LinkRepository {
  /**
   * 用当前解析结果替换某个条目的引用关系
   */
  async syncReferences(sourceId: string, targetIds: string[]): Promise<void> {
    const existing = await databaseService.all<{ target_id: string }>(
      `SELECT target_id FROM links WHERE source_id = ? AND type = 'reference' AND is_deleted = 0`,
      [sourceId]
    );
    const current = new Set(existing.map((row) => row.target_id));
    const next = new Set(targetIds);

    for (const targetId of current) {
      if (!next.has(targetId)) {
        await databaseService.run(
          `DELETE FROM links WHERE source_id = ? AND target_id = ? AND type = 'reference'`,
          [sourceId, targetId]
        );
      }
    }
    const timestamp = now();
    for (const targetId of next) {
      if (current.has(targetId)) continue;
      // UNIQUE(source_id, target_id)：已有其他类型（如 AI 关联）时升级为引用
      await databaseService.run(
        `INSERT INTO links (id, source_id, target_id, type, created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, 'reference', ?, ?, 0)
         ON CONFLICT(source_id, target_id) DO UPDATE SET type = 'reference', is_deleted = 0, updated_at = excluded.updated_at`,
        [generateId(), sourceId, targetId, timestamp, timestamp]
      );
    }
  }

  /** Agent 发现的语义关联 */
  async listRelated(): Promise<RelatedLink[]> {
    const rows = await databaseService.all<{ source_id: string; target_id: string }>(
      `SELECT source_id, target_id FROM links WHERE type = 'ai-suggested' AND is_deleted = 0`
    );
    return rows.map((row) => ({ sourceId: row.source_id, targetId: row.target_id }));
  }
}

export const linkRepository = new LinkRepository();
