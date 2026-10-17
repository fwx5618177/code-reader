// ================================
// 版本历史 IPC 处理器
// 向渲染进程暴露文档版本历史服务
// ================================

import { ipcMain } from 'electron';
import {
  getVersionHistoryService,
  type CreateVersionInput,
  type VersionListOptions,
} from './version-history';
import type { VersionRetentionPolicy } from './version-retention';

// ================================
// Version History IPC Handlers
// ================================

export function registerVersionHistoryHandlers(): void {
  const versionService = getVersionHistoryService();

  // Create a new version
  ipcMain.handle('version:create', async (_event, input: CreateVersionInput) => {
    try {
      return await versionService.createVersion(input);
    } catch (error) {
      console.error('[IPC] version:create error:', error);
      throw error;
    }
  });

  // Get version history for an item
  ipcMain.handle('version:get-history', async (_event, options: VersionListOptions) => {
    try {
      return await versionService.getVersionHistory(options);
    } catch (error) {
      console.error('[IPC] version:get-history error:', error);
      throw error;
    }
  });

  // Get a specific version
  ipcMain.handle('version:get', async (_event, versionId: string) => {
    try {
      return await versionService.getVersion(versionId);
    } catch (error) {
      console.error('[IPC] version:get error:', error);
      throw error;
    }
  });

  // Get latest version for an item
  ipcMain.handle('version:get-latest', async (_event, itemId: string) => {
    try {
      return await versionService.getLatestVersion(itemId);
    } catch (error) {
      console.error('[IPC] version:get-latest error:', error);
      throw error;
    }
  });

  // Get version by number
  ipcMain.handle('version:get-by-number', async (_event, itemId: string, versionNumber: number) => {
    try {
      return await versionService.getVersionByNumber(itemId, versionNumber);
    } catch (error) {
      console.error('[IPC] version:get-by-number error:', error);
      throw error;
    }
  });

  // Restore a version
  ipcMain.handle('version:restore', async (_event, itemId: string, versionId: string) => {
    try {
      return await versionService.restoreVersion(itemId, versionId);
    } catch (error) {
      console.error('[IPC] version:restore error:', error);
      throw error;
    }
  });

  // Get version count
  ipcMain.handle('version:get-count', async (_event, itemId: string) => {
    try {
      return await versionService.getVersionCount(itemId);
    } catch (error) {
      console.error('[IPC] version:get-count error:', error);
      throw error;
    }
  });

  // 按保留策略清理一篇文档的旧版本
  ipcMain.handle('version:prune', async (_event, itemId: string) => {
    try {
      return await versionService.pruneVersions(itemId);
    } catch (error) {
      console.error('[IPC] version:prune error:', error);
      throw error;
    }
  });

  // 按保留策略清理全部文档
  ipcMain.handle('version:prune-all', async () => {
    try {
      return await versionService.pruneAllVersions();
    } catch (error) {
      console.error('[IPC] version:prune-all error:', error);
      throw error;
    }
  });

  // 保留策略读写与版本统计
  ipcMain.handle('version:get-retention', () => versionService.getRetentionPolicy());
  ipcMain.handle('version:set-retention', (_event, policy: Partial<VersionRetentionPolicy>) =>
    versionService.setRetentionPolicy(policy)
  );
  ipcMain.handle('version:get-stats', () => versionService.getVersionStats());

  // Auto-save
  ipcMain.handle(
    'version:auto-save',
    async (
      _event,
      itemId: string,
      content: string,
      options?: { title?: string; minIntervalMs?: number }
    ) => {
      try {
        return await versionService.autoSave(itemId, content, options);
      } catch (error) {
        console.error('[IPC] version:auto-save error:', error);
        throw error;
      }
    }
  );

  // Should auto-save check
  ipcMain.handle(
    'version:should-auto-save',
    async (_event, itemId: string, minIntervalMs?: number) => {
      try {
        return await versionService.shouldAutoSave(itemId, minIntervalMs);
      } catch (error) {
        console.error('[IPC] version:should-auto-save error:', error);
        throw error;
      }
    }
  );

  console.log('[IPC] Version history handlers registered');
}

export default registerVersionHistoryHandlers;
