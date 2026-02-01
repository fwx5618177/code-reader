// ================================
// Version Repository
// Single responsibility: Database operations via IPC only
// No business logic, no state management
// ================================

import {
  DocumentVersion,
  CreateVersionInput,
  VersionListOptions,
} from './types';

// ================================
// Repository Class
// ================================

class VersionRepository {
  /**
   * Create a new version
   */
  async create(input: CreateVersionInput): Promise<DocumentVersion> {
    return window.electron.version.create(input);
  }

  /**
   * Get version history for a document
   */
  async getHistory(options: VersionListOptions): Promise<DocumentVersion[]> {
    return window.electron.version.getHistory(options);
  }

  /**
   * Get a specific version by ID
   */
  async getById(versionId: string): Promise<DocumentVersion | null> {
    return window.electron.version.get(versionId);
  }

  /**
   * Get the latest version for a document
   */
  async getLatest(itemId: string): Promise<DocumentVersion | null> {
    return window.electron.version.getLatest(itemId);
  }

  /**
   * Get version by number
   */
  async getByNumber(itemId: string, versionNumber: number): Promise<DocumentVersion | null> {
    return window.electron.version.getByNumber(itemId, versionNumber);
  }

  /**
   * Restore a document to a specific version
   * Creates a new version with the restored content
   */
  async restore(itemId: string, versionId: string): Promise<DocumentVersion> {
    return window.electron.version.restore(itemId, versionId);
  }

  /**
   * Get total version count for a document
   */
  async getCount(itemId: string): Promise<number> {
    return window.electron.version.getCount(itemId);
  }

  /**
   * Prune old versions, keeping only the most recent N
   */
  async prune(itemId: string, keepCount?: number): Promise<number> {
    return window.electron.version.prune(itemId, keepCount);
  }

  /**
   * Auto-save content if criteria are met
   */
  async autoSave(
    itemId: string,
    content: string,
    options?: { title?: string; minIntervalMs?: number }
  ): Promise<DocumentVersion | null> {
    return window.electron.version.autoSave(itemId, content, options);
  }

  /**
   * Check if auto-save should happen
   */
  async shouldAutoSave(itemId: string, minIntervalMs?: number): Promise<boolean> {
    return window.electron.version.shouldAutoSave(itemId, minIntervalMs);
  }
}

// ================================
// Singleton Export
// ================================

export const versionRepository = new VersionRepository();
