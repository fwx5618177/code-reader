// ================================
// Version Service
// Single responsibility: Business logic only
// No state management, no UI concerns
// ================================

import { versionRepository } from './repository';
import {
  DocumentVersion,
  CreateVersionInput,
  VersionComparison,
  ChangeType,
  type VersionPruneResult,
  type VersionRetentionPolicy,
  type VersionStats,
} from './types';

// ================================
// Constants
// ================================

/** Default limit for version history queries */
const DEFAULT_HISTORY_LIMIT = 20;

/** Minimum interval between auto-save versions (5 minutes) */
const DEFAULT_AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;

// ================================
// Service Class
// ================================

class VersionService {
  /**
   * Create a new version snapshot
   */
  async createVersion(input: CreateVersionInput): Promise<DocumentVersion> {
    const version = await versionRepository.create({
      ...input,
      changeType: input.changeType || 'edit',
      authorType: input.authorType || 'user',
    });

    console.log('[VersionService] Version created:', version.id, 'v' + version.versionNumber);
    await this.pruneAfterCreate(input.itemId);

    return version;
  }

  /**
   * Create a version when document is saved (manual save)
   */
  async createSaveVersion(
    itemId: string,
    content: string,
    options: {
      title?: string;
      changeDescription?: string;
    } = {}
  ): Promise<DocumentVersion> {
    return this.createVersion({
      itemId,
      content,
      title: options.title,
      changeType: 'edit',
      changeDescription: options.changeDescription || '手动保存',
      authorType: 'user',
    });
  }

  /**
   * Create a version during auto-save
   * Uses the backend's auto-save logic to avoid creating too many versions
   */
  async createAutoSaveVersion(
    itemId: string,
    content: string,
    options: {
      title?: string;
      minIntervalMs?: number;
    } = {}
  ): Promise<DocumentVersion | null> {
    const version = await versionRepository.autoSave(itemId, content, {
      title: options.title,
      minIntervalMs: options.minIntervalMs || DEFAULT_AUTO_SAVE_INTERVAL_MS,
    });

    if (version) {
      console.log(
        '[VersionService] Auto-save version created:',
        version.id,
        'v' + version.versionNumber
      );
      await this.pruneAfterCreate(itemId);
    }

    return version;
  }

  /**
   * Check if an auto-save version should be created
   */
  async shouldCreateAutoSaveVersion(
    itemId: string,
    minIntervalMs: number = DEFAULT_AUTO_SAVE_INTERVAL_MS
  ): Promise<boolean> {
    return versionRepository.shouldAutoSave(itemId, minIntervalMs);
  }

  /**
   * Create a version when a document is first created
   */
  async createInitialVersion(
    itemId: string,
    content: string,
    title?: string
  ): Promise<DocumentVersion> {
    return this.createVersion({
      itemId,
      content,
      title,
      changeType: 'create',
      changeDescription: '创建文档',
      authorType: 'user',
    });
  }

  /**
   * Get version history for a document
   */
  async getVersionHistory(
    itemId: string,
    options: {
      limit?: number;
      offset?: number;
      changeTypes?: ChangeType[];
    } = {}
  ): Promise<DocumentVersion[]> {
    return versionRepository.getHistory({
      itemId,
      limit: options.limit || DEFAULT_HISTORY_LIMIT,
      offset: options.offset || 0,
      changeTypes: options.changeTypes,
    });
  }

  /**
   * Get a specific version by ID
   */
  async getVersion(versionId: string): Promise<DocumentVersion | null> {
    return versionRepository.getById(versionId);
  }

  /**
   * Get the latest version for a document
   */
  async getLatestVersion(itemId: string): Promise<DocumentVersion | null> {
    return versionRepository.getLatest(itemId);
  }

  /**
   * Get version by number
   */
  async getVersionByNumber(itemId: string, versionNumber: number): Promise<DocumentVersion | null> {
    return versionRepository.getByNumber(itemId, versionNumber);
  }

  /**
   * 获取在指定版本之前仍保留的最近一个版本（不依赖历史列表是否已分页加载到该版本）。
   * 分层保留策略会删除中间版本，版本号不一定连续；本身已是最早保留的版本时返回 null
   */
  async getVersionBefore(version: DocumentVersion): Promise<DocumentVersion | null> {
    if (version.versionNumber <= 1) return null;
    const [previous] = await versionRepository.getHistory({
      itemId: version.itemId,
      beforeVersionNumber: version.versionNumber,
      limit: 1,
    });
    return previous ?? null;
  }

  /**
   * Get total version count for a document
   */
  async getVersionCount(itemId: string): Promise<number> {
    return versionRepository.getCount(itemId);
  }

  /**
   * Restore a document to a specific version
   * Creates a new version with the restored content
   */
  async restoreVersion(itemId: string, versionId: string): Promise<DocumentVersion> {
    const restoredVersion = await versionRepository.restore(itemId, versionId);

    console.log(
      '[VersionService] Restored to version:',
      versionId,
      '-> new version:',
      restoredVersion.id
    );
    await this.pruneAfterCreate(itemId);

    return restoredVersion;
  }

  /**
   * Restore to a specific version number
   */
  async restoreToVersionNumber(
    itemId: string,
    versionNumber: number
  ): Promise<DocumentVersion | null> {
    const version = await this.getVersionByNumber(itemId, versionNumber);
    if (!version) {
      console.warn('[VersionService] Version not found:', itemId, versionNumber);
      return null;
    }
    return this.restoreVersion(itemId, version.id);
  }

  /**
   * 按已保存的保留策略（最近全部保留，之后按日/周/月抽样）清理一篇文档的旧版本
   */
  async pruneVersions(itemId: string): Promise<number> {
    const deletedCount = await versionRepository.prune(itemId);

    if (deletedCount > 0) {
      console.log('[VersionService] Pruned', deletedCount, 'old versions for', itemId);
    }

    return deletedCount;
  }

  /** 按保留策略立即清理全部文档 */
  async pruneAllVersions(): Promise<VersionPruneResult> {
    return versionRepository.pruneAll();
  }

  async getRetentionPolicy(): Promise<VersionRetentionPolicy> {
    return versionRepository.getRetention();
  }

  /** 保存保留策略，返回实际生效的值（主进程会规范化不合理的参数） */
  async setRetentionPolicy(policy: VersionRetentionPolicy): Promise<VersionRetentionPolicy> {
    return versionRepository.setRetention(policy);
  }

  async getStats(): Promise<VersionStats> {
    return versionRepository.getStats();
  }

  /**
   * 新增版本后按保留策略清理旧版本
   * 版本已创建成功，清理失败只记录日志，下次创建时会再次清理
   */
  private async pruneAfterCreate(itemId: string): Promise<void> {
    try {
      await this.pruneVersions(itemId);
    } catch (error) {
      console.error('[VersionService] 清理旧版本失败:', itemId, error);
    }
  }

  /**
   * Compare two versions
   */
  compareVersions(versionA: DocumentVersion, versionB: DocumentVersion): VersionComparison {
    return {
      versionA,
      versionB,
      titleChanged: versionA.title !== versionB.title,
      contentChanged: versionA.contentHash !== versionB.contentHash,
      summaryChanged: versionA.summary !== versionB.summary,
    };
  }

  /**
   * Check if a document has any versions
   */
  async hasVersions(itemId: string): Promise<boolean> {
    const count = await this.getVersionCount(itemId);
    return count > 0;
  }

  /**
   * Get the previous version (before the latest)
   */
  async getPreviousVersion(itemId: string): Promise<DocumentVersion | null> {
    const history = await this.getVersionHistory(itemId, { limit: 2 });
    if (history.length < 2) return null;
    return history[1];
  }
}

// ================================
// Singleton Export
// ================================

export const versionService = new VersionService();
