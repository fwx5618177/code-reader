// ================================
// Version Service
// Single responsibility: Business logic only
// No state management, no UI concerns
// ================================

import { versionRepository } from './repository';
import { DocumentVersion, CreateVersionInput, VersionComparison, ChangeType } from './types';

// ================================
// Constants
// ================================

/**
 * 版本保留策略：每篇文档只保留最近 50 个版本，每次新增版本（保存、自动保存、恢复）后自动清理更旧的版本。
 * 自动保存至少间隔 5 分钟，50 个版本足以覆盖数小时的连续写作；
 * 每个版本都是完整快照，删除旧版本不影响其余版本的预览与恢复。
 */
const DEFAULT_PRUNE_KEEP_COUNT = 50;

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
   * 获取紧邻在指定版本之前的版本（不依赖历史列表是否已分页加载到该版本）。
   * 版本号在同一文档内连续：新版本取当前最大号 +1，清理只删除最旧的版本且不支持单独删除，
   * 因此上一版就是版本号减 1；已被清理或本身就是第一版时返回 null
   */
  async getVersionBefore(version: DocumentVersion): Promise<DocumentVersion | null> {
    if (version.versionNumber <= 1) return null;
    return versionRepository.getByNumber(version.itemId, version.versionNumber - 1);
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
   * Prune old versions, keeping only the most recent N
   */
  async pruneVersions(
    itemId: string,
    keepCount: number = DEFAULT_PRUNE_KEEP_COUNT
  ): Promise<number> {
    const deletedCount = await versionRepository.prune(itemId, keepCount);

    if (deletedCount > 0) {
      console.log('[VersionService] Pruned', deletedCount, 'old versions for', itemId);
    }

    return deletedCount;
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
