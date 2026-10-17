// ================================
// Document Version History Service
// Manages version snapshots for knowledge/journal items
// ================================

import { getSQLiteService } from './sqlite';
import { randomUUID } from 'crypto';
import {
  normalizeRetentionPolicy,
  selectVersionsToPrune,
  type RetentionCandidate,
  type VersionRetentionPolicy,
} from './version-retention';

/** 保留策略在 app_settings 中的键 */
const RETENTION_SETTING_KEY = 'version_retention';

/** 单条 DELETE 语句的最大参数数 */
const DELETE_CHUNK_SIZE = 500;

// ================================
// Types
// ================================

export type ChangeType = 'create' | 'edit' | 'auto-save' | 'restore' | 'ai-update';
export type AuthorType = 'user' | 'ai' | 'system';

export interface DocumentVersion {
  id: string;
  itemId: string;
  versionNumber: number;
  title: string | null;
  content: string | null;
  summary: string | null;
  changeType: ChangeType;
  changeDescription: string | null;
  diffFromPrevious: string | null;
  contentHash: string | null;
  contentSize: number | null;
  authorType: AuthorType;
  createdAt: string;
}

export interface CreateVersionInput {
  itemId: string;
  title?: string;
  content?: string;
  summary?: string;
  changeType?: ChangeType;
  changeDescription?: string;
  authorType?: AuthorType;
}

export interface VersionListOptions {
  itemId: string;
  limit?: number;
  offset?: number;
  changeTypes?: ChangeType[];
  /** 只返回版本号小于该值的版本（查找某版本之前仍保留的版本） */
  beforeVersionNumber?: number;
}

/** 版本总量统计 */
export interface VersionStats {
  versionCount: number;
  itemCount: number;
}

/** 全库清理结果 */
export interface VersionPruneResult {
  deletedCount: number;
  /** 有版本被删除的文档数 */
  itemCount: number;
}

export interface VersionDiff {
  versionA: DocumentVersion;
  versionB: DocumentVersion;
  titleDiff?: string;
  contentDiff?: string;
  summaryDiff?: string;
}

// ================================
// Helper Functions
// ================================

/**
 * Generate a simple hash of content for comparison
 */
function hashContent(content: string | null | undefined): string | null {
  if (!content) return null;

  // Simple hash using built-in crypto
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Calculate content size in bytes
 */
function getContentSize(content: string | null | undefined): number | null {
  if (!content) return null;
  return Buffer.byteLength(content, 'utf8');
}

/**
 * Create a simple text diff (line-based)
 */
function createSimpleDiff(oldText: string | null, newText: string | null): string | null {
  if (!oldText && !newText) return null;
  if (!oldText) return JSON.stringify({ type: 'new', content: newText });
  if (!newText) return JSON.stringify({ type: 'deleted' });

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const changes: Array<{ type: 'add' | 'remove' | 'keep'; line: number; content: string }> = [];

  // Simple LCS-based diff
  // 注意：使用简化的逐行比较算法，未来可以优化为真正的 LCS
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      changes.push({ type: 'add', line: newIdx, content: newLines[newIdx] });
      newIdx++;
    } else if (newIdx >= newLines.length) {
      changes.push({ type: 'remove', line: oldIdx, content: oldLines[oldIdx] });
      oldIdx++;
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      oldIdx++;
      newIdx++;
    } else {
      // Simple heuristic: if next old line matches current new, it's an addition
      // Otherwise, treat as removal then addition
      const oldNextMatch = oldLines.indexOf(newLines[newIdx], oldIdx + 1);
      const newNextMatch = newLines.indexOf(oldLines[oldIdx], newIdx + 1);

      if (newNextMatch !== -1 && (oldNextMatch === -1 || newNextMatch < oldNextMatch)) {
        changes.push({ type: 'add', line: newIdx, content: newLines[newIdx] });
        newIdx++;
      } else {
        changes.push({ type: 'remove', line: oldIdx, content: oldLines[oldIdx] });
        oldIdx++;
      }
    }
  }

  // Only store if there are actual changes and it's not too large
  if (changes.length === 0) return null;
  if (changes.length > 1000) {
    // Too many changes, store full content instead
    return JSON.stringify({ type: 'full-replace', content: newText });
  }

  return JSON.stringify({ type: 'diff', changes });
}

// ================================
// Version History Service Class
// ================================

class VersionHistoryService {
  // ================================
  // Create Version
  // ================================

  /**
   * Create a new version snapshot
   */
  async createVersion(input: CreateVersionInput): Promise<DocumentVersion> {
    const db = getSQLiteService();

    // Get the latest version number for this item
    const latestVersion = db.get<{ version_number: number }>(
      'SELECT MAX(version_number) as version_number FROM document_versions WHERE item_id = ?',
      [input.itemId]
    );

    const versionNumber = (latestVersion?.version_number || 0) + 1;

    // 与当前最新版本比较（保留策略可能已删除中间版本，版本号不一定连续）
    let diffFromPrevious: string | null = null;
    if (versionNumber > 1) {
      const previousVersion = db.get<{ content: string | null }>(
        'SELECT content FROM document_versions WHERE item_id = ? ORDER BY version_number DESC LIMIT 1',
        [input.itemId]
      );
      if (previousVersion) {
        diffFromPrevious = createSimpleDiff(previousVersion.content, input.content || null);
      }
    }

    const id = randomUUID();
    const contentHash = hashContent(input.content);
    const contentSize = getContentSize(input.content);
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO document_versions (
        id, item_id, version_number, title, content, summary,
        change_type, change_description, diff_from_previous,
        content_hash, content_size, author_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.itemId,
        versionNumber,
        input.title || null,
        input.content || null,
        input.summary || null,
        input.changeType || 'edit',
        input.changeDescription || null,
        diffFromPrevious,
        contentHash,
        contentSize,
        input.authorType || 'user',
        now,
      ]
    );

    console.log(`[VersionHistory] Created version ${versionNumber} for item ${input.itemId}`);

    return {
      id,
      itemId: input.itemId,
      versionNumber,
      title: input.title || null,
      content: input.content || null,
      summary: input.summary || null,
      changeType: input.changeType || 'edit',
      changeDescription: input.changeDescription || null,
      diffFromPrevious,
      contentHash,
      contentSize,
      authorType: input.authorType || 'user',
      createdAt: now,
    };
  }

  // ================================
  // Get Versions
  // ================================

  /**
   * Get version history for an item
   */
  async getVersionHistory(options: VersionListOptions): Promise<DocumentVersion[]> {
    const db = getSQLiteService();
    const { itemId, limit = 50, offset = 0, changeTypes, beforeVersionNumber } = options;

    let sql = `
      SELECT
        id, item_id, version_number, title, content, summary,
        change_type, change_description, diff_from_previous,
        content_hash, content_size, author_type, created_at
      FROM document_versions
      WHERE item_id = ?
    `;
    const params: (string | number)[] = [itemId];

    if (changeTypes && changeTypes.length > 0) {
      sql += ` AND change_type IN (${changeTypes.map(() => '?').join(', ')})`;
      params.push(...changeTypes);
    }

    if (beforeVersionNumber !== undefined) {
      sql += ` AND version_number < ?`;
      params.push(beforeVersionNumber);
    }

    sql += ` ORDER BY version_number DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = db.all<{
      id: string;
      item_id: string;
      version_number: number;
      title: string | null;
      content: string | null;
      summary: string | null;
      change_type: ChangeType;
      change_description: string | null;
      diff_from_previous: string | null;
      content_hash: string | null;
      content_size: number | null;
      author_type: AuthorType;
      created_at: string;
    }>(sql, params);

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      versionNumber: row.version_number,
      title: row.title,
      content: row.content,
      summary: row.summary,
      changeType: row.change_type,
      changeDescription: row.change_description,
      diffFromPrevious: row.diff_from_previous,
      contentHash: row.content_hash,
      contentSize: row.content_size,
      authorType: row.author_type,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get a specific version
   */
  async getVersion(versionId: string): Promise<DocumentVersion | null> {
    const db = getSQLiteService();

    const row = db.get<{
      id: string;
      item_id: string;
      version_number: number;
      title: string | null;
      content: string | null;
      summary: string | null;
      change_type: ChangeType;
      change_description: string | null;
      diff_from_previous: string | null;
      content_hash: string | null;
      content_size: number | null;
      author_type: AuthorType;
      created_at: string;
    }>(`SELECT * FROM document_versions WHERE id = ?`, [versionId]);

    if (!row) return null;

    return {
      id: row.id,
      itemId: row.item_id,
      versionNumber: row.version_number,
      title: row.title,
      content: row.content,
      summary: row.summary,
      changeType: row.change_type,
      changeDescription: row.change_description,
      diffFromPrevious: row.diff_from_previous,
      contentHash: row.content_hash,
      contentSize: row.content_size,
      authorType: row.author_type,
      createdAt: row.created_at,
    };
  }

  /**
   * Get the latest version for an item
   */
  async getLatestVersion(itemId: string): Promise<DocumentVersion | null> {
    const db = getSQLiteService();

    const row = db.get<{
      id: string;
      item_id: string;
      version_number: number;
      title: string | null;
      content: string | null;
      summary: string | null;
      change_type: ChangeType;
      change_description: string | null;
      diff_from_previous: string | null;
      content_hash: string | null;
      content_size: number | null;
      author_type: AuthorType;
      created_at: string;
    }>(
      `SELECT * FROM document_versions
       WHERE item_id = ?
       ORDER BY version_number DESC
       LIMIT 1`,
      [itemId]
    );

    if (!row) return null;

    return {
      id: row.id,
      itemId: row.item_id,
      versionNumber: row.version_number,
      title: row.title,
      content: row.content,
      summary: row.summary,
      changeType: row.change_type,
      changeDescription: row.change_description,
      diffFromPrevious: row.diff_from_previous,
      contentHash: row.content_hash,
      contentSize: row.content_size,
      authorType: row.author_type,
      createdAt: row.created_at,
    };
  }

  /**
   * Get version by number
   */
  async getVersionByNumber(itemId: string, versionNumber: number): Promise<DocumentVersion | null> {
    const db = getSQLiteService();

    const row = db.get<{
      id: string;
      item_id: string;
      version_number: number;
      title: string | null;
      content: string | null;
      summary: string | null;
      change_type: ChangeType;
      change_description: string | null;
      diff_from_previous: string | null;
      content_hash: string | null;
      content_size: number | null;
      author_type: AuthorType;
      created_at: string;
    }>(`SELECT * FROM document_versions WHERE item_id = ? AND version_number = ?`, [
      itemId,
      versionNumber,
    ]);

    if (!row) return null;

    return {
      id: row.id,
      itemId: row.item_id,
      versionNumber: row.version_number,
      title: row.title,
      content: row.content,
      summary: row.summary,
      changeType: row.change_type,
      changeDescription: row.change_description,
      diffFromPrevious: row.diff_from_previous,
      contentHash: row.content_hash,
      contentSize: row.content_size,
      authorType: row.author_type,
      createdAt: row.created_at,
    };
  }

  // ================================
  // Restore Version
  // ================================

  /**
   * Restore an item to a specific version
   * This creates a new version with the restored content
   */
  async restoreVersion(itemId: string, versionId: string): Promise<DocumentVersion> {
    const version = await this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version ${versionId} not found`);
    }

    if (version.itemId !== itemId) {
      throw new Error(`Version ${versionId} does not belong to item ${itemId}`);
    }

    // Create a new version with the restored content
    const restoredVersion = await this.createVersion({
      itemId,
      title: version.title || undefined,
      content: version.content || undefined,
      summary: version.summary || undefined,
      changeType: 'restore',
      changeDescription: `Restored from version ${version.versionNumber}`,
      authorType: 'user',
    });

    // Update the knowledge item with restored content
    const db = getSQLiteService();
    db.run(
      `UPDATE knowledge_items
       SET title = ?, content = ?, summary = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [version.title, version.content, version.summary, itemId]
    );

    console.log(`[VersionHistory] Restored item ${itemId} to version ${version.versionNumber}`);

    return restoredVersion;
  }

  // ================================
  // Version Count
  // ================================

  /**
   * Get total version count for an item
   */
  async getVersionCount(itemId: string): Promise<number> {
    const db = getSQLiteService();

    const result = db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM document_versions WHERE item_id = ?',
      [itemId]
    );

    return result?.count || 0;
  }

  // ================================
  // Cleanup
  // ================================

  /** 读取保留策略（未设置或无法解析时为默认值） */
  getRetentionPolicy(): VersionRetentionPolicy {
    const row = getSQLiteService().get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
      RETENTION_SETTING_KEY,
    ]);
    if (!row) return normalizeRetentionPolicy(null);
    try {
      return normalizeRetentionPolicy(JSON.parse(row.value) as Partial<VersionRetentionPolicy>);
    } catch (error) {
      console.warn('[VersionHistory] 保留策略无法解析，使用默认值:', error);
      return normalizeRetentionPolicy(null);
    }
  }

  /** 保存保留策略，返回规范化后实际生效的策略 */
  setRetentionPolicy(input: Partial<VersionRetentionPolicy>): VersionRetentionPolicy {
    const policy = normalizeRetentionPolicy(input);
    getSQLiteService().run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [RETENTION_SETTING_KEY, JSON.stringify(policy)]
    );
    return policy;
  }

  /** 全库版本数与有版本的文档数 */
  getVersionStats(): VersionStats {
    const row = getSQLiteService().get<VersionStats>(
      'SELECT COUNT(*) AS versionCount, COUNT(DISTINCT item_id) AS itemCount FROM document_versions'
    );
    return { versionCount: row?.versionCount ?? 0, itemCount: row?.itemCount ?? 0 };
  }

  /** 按保留策略删除一篇文档的旧版本，返回删除数量 */
  private pruneItem(itemId: string, policy: VersionRetentionPolicy, now: Date): number {
    const db = getSQLiteService();
    const candidates = db.all<RetentionCandidate>(
      `SELECT id, version_number AS versionNumber, created_at AS createdAt
       FROM document_versions WHERE item_id = ?`,
      [itemId]
    );
    const ids = selectVersionsToPrune(candidates, policy, now);
    if (ids.length === 0) return 0;
    return db.transaction(() => {
      let changes = 0;
      for (let start = 0; start < ids.length; start += DELETE_CHUNK_SIZE) {
        const chunk = ids.slice(start, start + DELETE_CHUNK_SIZE);
        changes += db.run(
          `DELETE FROM document_versions WHERE id IN (${chunk.map(() => '?').join(', ')})`,
          chunk
        ).changes;
      }
      return changes;
    });
  }

  /**
   * 按保留策略清理一篇文档的旧版本（新增版本后调用）
   */
  async pruneVersions(itemId: string): Promise<number> {
    const deleted = this.pruneItem(itemId, this.getRetentionPolicy(), new Date());
    if (deleted > 0) console.log(`[VersionHistory] Pruned ${deleted} old versions for item ${itemId}`);
    return deleted;
  }

  /**
   * 按保留策略清理全部文档（设置中的“立即清理”）
   * 只有不止一个版本、且最早的版本已超出全保留窗口的文档才可能有版本被删除
   */
  async pruneAllVersions(): Promise<VersionPruneResult> {
    const policy = this.getRetentionPolicy();
    const now = new Date();
    const cutoff = new Date(now.getTime() - policy.keepAllHours * 60 * 60 * 1000).toISOString();
    const items = getSQLiteService().all<{ item_id: string }>(
      `SELECT item_id FROM document_versions
       GROUP BY item_id
       HAVING COUNT(*) > 1 AND MIN(julianday(created_at)) < julianday(?)`,
      [cutoff]
    );
    const result: VersionPruneResult = { deletedCount: 0, itemCount: 0 };
    for (const { item_id: itemId } of items) {
      const deleted = this.pruneItem(itemId, policy, now);
      if (deleted === 0) continue;
      result.deletedCount += deleted;
      result.itemCount++;
    }
    console.log(`[VersionHistory] Pruned ${result.deletedCount} versions in ${result.itemCount} items`);
    return result;
  }

  /**
   * Delete all versions for an item
   */
  async deleteAllVersions(itemId: string): Promise<number> {
    const db = getSQLiteService();

    const result = db.run('DELETE FROM document_versions WHERE item_id = ?', [itemId]);

    console.log(`[VersionHistory] Deleted ${result.changes} versions for item ${itemId}`);

    return result.changes;
  }

  // ================================
  // Auto-save Management
  // ================================

  /**
   * Should create an auto-save version?
   * Returns true if enough time has passed since last version
   */
  async shouldAutoSave(itemId: string, minIntervalMs: number = 60000): Promise<boolean> {
    const latestVersion = await this.getLatestVersion(itemId);
    if (!latestVersion) return true;

    const lastSaveTime = new Date(latestVersion.createdAt).getTime();
    const now = Date.now();

    return now - lastSaveTime >= minIntervalMs;
  }

  /**
   * Create auto-save version if criteria met
   */
  async autoSave(
    itemId: string,
    content: string,
    options: { title?: string; minIntervalMs?: number } = {}
  ): Promise<DocumentVersion | null> {
    const shouldSave = await this.shouldAutoSave(itemId, options.minIntervalMs);
    if (!shouldSave) return null;

    // Check if content actually changed
    const latestVersion = await this.getLatestVersion(itemId);
    if (latestVersion) {
      const currentHash = hashContent(content);
      if (currentHash === latestVersion.contentHash) {
        return null; // Content unchanged
      }
    }

    return this.createVersion({
      itemId,
      title: options.title,
      content,
      changeType: 'auto-save',
      changeDescription: 'Auto-saved',
      authorType: 'system',
    });
  }
}

// ================================
// Singleton Export
// ================================

let versionHistoryService: VersionHistoryService | null = null;

export function getVersionHistoryService(): VersionHistoryService {
  if (!versionHistoryService) {
    versionHistoryService = new VersionHistoryService();
  }
  return versionHistoryService;
}

export default VersionHistoryService;
