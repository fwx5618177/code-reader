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

/** Default number of versions to keep when pruning */
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
