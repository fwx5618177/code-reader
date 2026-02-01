// ================================
// Version History & Git IPC Handlers
// Exposes version history and git services to renderer process
// ================================

import { ipcMain } from 'electron';
import {
  getVersionHistoryService,
  type CreateVersionInput,
  type VersionListOptions,
} from './version-history';
import { getGitService } from './git-service';

// 类型别名用于 IPC 响应中的类型注解
// 实际类型从 git-service 和 version-history 导出，
// 在 IPC 响应中由服务方法返回值推断

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

  // Prune old versions
  ipcMain.handle('version:prune', async (_event, itemId: string, keepCount?: number) => {
    try {
      return await versionService.pruneVersions(itemId, keepCount);
    } catch (error) {
      console.error('[IPC] version:prune error:', error);
      throw error;
    }
  });

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

// ================================
// Git IPC Handlers
// ================================

export function registerGitHandlers(): void {
  const gitService = getGitService();

  // Check if path is in a git repository
  ipcMain.handle('git:is-in-repository', async (_event, path: string) => {
    try {
      return await gitService.isInRepository(path);
    } catch (error) {
      console.error('[IPC] git:is-in-repository error:', error);
      return false;
    }
  });

  // Get or create repository record
  ipcMain.handle('git:get-repository', async (_event, path: string) => {
    try {
      return await gitService.getOrCreateRepository(path);
    } catch (error) {
      console.error('[IPC] git:get-repository error:', error);
      throw error;
    }
  });

  // Sync repository info
  ipcMain.handle('git:sync-repository', async (_event, path: string) => {
    try {
      return await gitService.syncRepository(path);
    } catch (error) {
      console.error('[IPC] git:sync-repository error:', error);
      throw error;
    }
  });

  // Get current branch
  ipcMain.handle('git:get-current-branch', async (_event, repoPath: string) => {
    try {
      return await gitService.getCurrentBranch(repoPath);
    } catch (error) {
      console.error('[IPC] git:get-current-branch error:', error);
      return null;
    }
  });

  // Get all branches
  ipcMain.handle('git:get-branches', async (_event, repoPath: string) => {
    try {
      return await gitService.getBranches(repoPath);
    } catch (error) {
      console.error('[IPC] git:get-branches error:', error);
      return [];
    }
  });

  // Get remote URL
  ipcMain.handle('git:get-remote-url', async (_event, repoPath: string) => {
    try {
      return await gitService.getRemoteUrl(repoPath);
    } catch (error) {
      console.error('[IPC] git:get-remote-url error:', error);
      return null;
    }
  });

  // Get all remotes
  ipcMain.handle('git:get-remotes', async (_event, repoPath: string) => {
    try {
      return await gitService.getRemotes(repoPath);
    } catch (error) {
      console.error('[IPC] git:get-remotes error:', error);
      return [];
    }
  });

  // Get repository status
  ipcMain.handle('git:get-status', async (_event, repoPath: string) => {
    try {
      return await gitService.getStatus(repoPath);
    } catch (error) {
      console.error('[IPC] git:get-status error:', error);
      return [];
    }
  });

  // Get file status
  ipcMain.handle('git:get-file-status', async (_event, repoPath: string, filePath: string) => {
    try {
      return await gitService.getFileStatus(repoPath, filePath);
    } catch (error) {
      console.error('[IPC] git:get-file-status error:', error);
      return 'unmodified';
    }
  });

  // Check for uncommitted changes
  ipcMain.handle('git:has-uncommitted-changes', async (_event, repoPath: string) => {
    try {
      return await gitService.hasUncommittedChanges(repoPath);
    } catch (error) {
      console.error('[IPC] git:has-uncommitted-changes error:', error);
      return false;
    }
  });

  // Get HEAD commit
  ipcMain.handle('git:get-head-commit', async (_event, repoPath: string) => {
    try {
      return await gitService.getHeadCommit(repoPath);
    } catch (error) {
      console.error('[IPC] git:get-head-commit error:', error);
      return null;
    }
  });

  // Get commit history
  ipcMain.handle(
    'git:get-commit-history',
    async (
      _event,
      repoPath: string,
      options?: { limit?: number; skip?: number; branch?: string; filePath?: string }
    ) => {
      try {
        return await gitService.getCommitHistory(repoPath, options);
      } catch (error) {
        console.error('[IPC] git:get-commit-history error:', error);
        return [];
      }
    }
  );

  // Get commit details
  ipcMain.handle('git:get-commit', async (_event, repoPath: string, commitHash: string) => {
    try {
      return await gitService.getCommit(repoPath, commitHash);
    } catch (error) {
      console.error('[IPC] git:get-commit error:', error);
      return null;
    }
  });

  // Get file history
  ipcMain.handle(
    'git:get-file-history',
    async (_event, repoPath: string, filePath: string, limit?: number) => {
      try {
        return await gitService.getFileHistory(repoPath, filePath, limit);
      } catch (error) {
        console.error('[IPC] git:get-file-history error:', error);
        return [];
      }
    }
  );

  // Get working directory diff
  ipcMain.handle('git:get-working-diff', async (_event, repoPath: string, filePath?: string) => {
    try {
      return await gitService.getWorkingDiff(repoPath, filePath);
    } catch (error) {
      console.error('[IPC] git:get-working-diff error:', error);
      return '';
    }
  });

  // Get staged diff
  ipcMain.handle('git:get-staged-diff', async (_event, repoPath: string, filePath?: string) => {
    try {
      return await gitService.getStagedDiff(repoPath, filePath);
    } catch (error) {
      console.error('[IPC] git:get-staged-diff error:', error);
      return '';
    }
  });

  // Get commit diff
  ipcMain.handle(
    'git:get-commit-diff',
    async (_event, repoPath: string, fromCommit: string, toCommit?: string, filePath?: string) => {
      try {
        return await gitService.getCommitDiff(repoPath, fromCommit, toCommit, filePath);
      } catch (error) {
        console.error('[IPC] git:get-commit-diff error:', error);
        return '';
      }
    }
  );

  // Get file content at commit
  ipcMain.handle(
    'git:get-file-at-commit',
    async (_event, repoPath: string, filePath: string, commitHash: string) => {
      try {
        return await gitService.getFileAtCommit(repoPath, filePath, commitHash);
      } catch (error) {
        console.error('[IPC] git:get-file-at-commit error:', error);
        return null;
      }
    }
  );

  // Get blame information
  ipcMain.handle('git:get-blame', async (_event, repoPath: string, filePath: string) => {
    try {
      return await gitService.getBlame(repoPath, filePath);
    } catch (error) {
      console.error('[IPC] git:get-blame error:', error);
      return [];
    }
  });

  // List stashes
  ipcMain.handle('git:list-stashes', async (_event, repoPath: string) => {
    try {
      return await gitService.listStashes(repoPath);
    } catch (error) {
      console.error('[IPC] git:list-stashes error:', error);
      return [];
    }
  });

  console.log('[IPC] Git handlers registered');
}

// ================================
// Register All Handlers
// ================================

export function registerVersionAndGitHandlers(): void {
  registerVersionHistoryHandlers();
  registerGitHandlers();
}

export default registerVersionAndGitHandlers;
