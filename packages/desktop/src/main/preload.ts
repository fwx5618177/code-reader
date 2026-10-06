import { contextBridge, ipcRenderer } from 'electron';

// 定义有效的 IPC 通道
const validChannels = [
  // 窗口控制
  'window-minimize',
  'window-maximize',
  'window-close',
  'window-is-maximized',
  'window-create-child',

  // 文件系统操作
  'read-file',
  'write-file',
  'write-binary-file',
  'get-file-info',
  'create-directory',
  'path-exists',

  // 知识库数据操作
  'get-data-path',

  // 系统操作
  'open-external',
  'show-in-folder',

  // 数据库操作
  'db:initialize',
  'db:close',
  'db:run',
  'db:get',
  'db:all',
  'db:exec',
  'db:search',
  'db:rebuildFTS',
  'db:getSchemaVersion',
  'db:backup',
  'db:vacuum',
  'db:stats',
  'db:clearAllData',

  // AI 操作
  'ai:getProviders',
  'ai:getProvider',
  'ai:addProvider',
  'ai:updateProvider',
  'ai:removeProvider',
  'ai:setDefaultProvider',
  'ai:setDefaultEmbeddingProvider',
  'ai:testConnection',
  'ai:chatCompletion',
  'ai:createEmbeddings',
  'ai:summarize',
  'ai:extractTags',
  'ai:transcribe',

  // Agent 操作
  'agent:start',
  'agent:stop',
  'agent:isActive',
  'agent:createTask',
  'agent:cancelTask',
  'agent:getTask',
  'agent:getPendingCount',
  'agent:getTasksForItem',
  'agent:processItem',

  // 语义搜索
  'search:semantic',
  'search:findSimilar',
  'search:hybrid',
  'search:clearCache',

  // 版本历史
  'version:create',
  'version:get-history',
  'version:get',
  'version:get-latest',
  'version:get-by-number',
  'version:restore',
  'version:get-count',
  'version:prune',
  'version:auto-save',
  'version:should-auto-save',

  // Git 操作
  'git:is-in-repository',
  'git:get-repository',
  'git:sync-repository',
  'git:get-current-branch',
  'git:get-branches',
  'git:get-remote-url',
  'git:get-remotes',
  'git:get-status',
  'git:get-file-status',
  'git:has-uncommitted-changes',
  'git:get-head-commit',
  'git:get-commit-history',
  'git:get-commit',
  'git:get-file-history',
  'git:get-working-diff',
  'git:get-staged-diff',
  'git:get-commit-diff',
  'git:get-file-at-commit',
  'git:get-blame',
  'git:list-stashes',
];

// 用于接收事件的通道
const eventChannels = ['agent:progress', 'agent:taskCompleted', 'agent:taskFailed'];

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Unauthorized IPC channel: ${channel}`);
    },
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      if (validChannels.includes(channel) || eventChannels.includes(channel)) {
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
          callback(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
      console.warn(`Unauthorized event channel: ${channel}`);
      return () => {};
    },
    once: (channel: string, callback: (...args: unknown[]) => void) => {
      if (validChannels.includes(channel) || eventChannels.includes(channel)) {
        ipcRenderer.once(channel, (_event, ...args) => callback(...args));
      }
    },
    removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
      if (validChannels.includes(channel) || eventChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, callback);
      }
    },
    removeAllListeners: (channel: string) => {
      if (validChannels.includes(channel) || eventChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    },
  },

  // 平台信息
  platform: process.platform,

  // 窗口控制便捷方法
  window: {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    createChild: (mode: string) => ipcRenderer.invoke('window-create-child', mode),
  },

  // 数据库便捷方法
  database: {
    initialize: () => ipcRenderer.invoke('db:initialize'),
    close: () => ipcRenderer.invoke('db:close'),
    run: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run', sql, params),
    get: <T>(sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:get', sql, params) as Promise<T | undefined>,
    all: <T>(sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:all', sql, params) as Promise<T[]>,
    search: (query: string, options?: { types?: string[]; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('db:search', query, options),
    getSchemaVersion: () => ipcRenderer.invoke('db:getSchemaVersion'),
    backup: (path?: string) => ipcRenderer.invoke('db:backup', path),
    vacuum: () => ipcRenderer.invoke('db:vacuum'),
    stats: () => ipcRenderer.invoke('db:stats'),
    clearAllData: () => ipcRenderer.invoke('db:clearAllData'),
  },

  // AI 便捷方法
  ai: {
    getProviders: () => ipcRenderer.invoke('ai:getProviders'),
    getProvider: (id: string) => ipcRenderer.invoke('ai:getProvider', id),
    addProvider: (provider: unknown) => ipcRenderer.invoke('ai:addProvider', provider),
    updateProvider: (id: string, updates: unknown) =>
      ipcRenderer.invoke('ai:updateProvider', id, updates),
    removeProvider: (id: string) => ipcRenderer.invoke('ai:removeProvider', id),
    setDefaultProvider: (id: string) => ipcRenderer.invoke('ai:setDefaultProvider', id),
    setDefaultEmbeddingProvider: (id: string) =>
      ipcRenderer.invoke('ai:setDefaultEmbeddingProvider', id),
    testConnection: (providerId: string) => ipcRenderer.invoke('ai:testConnection', providerId),
    chatCompletion: (request: unknown) => ipcRenderer.invoke('ai:chatCompletion', request),
    createEmbeddings: (request: unknown) => ipcRenderer.invoke('ai:createEmbeddings', request),
    summarize: (request: unknown) => ipcRenderer.invoke('ai:summarize', request),
    extractTags: (request: unknown) => ipcRenderer.invoke('ai:extractTags', request),
    transcribe: (request: unknown) => ipcRenderer.invoke('ai:transcribe', request),
  },

  // Agent 便捷方法
  agent: {
    start: () => ipcRenderer.invoke('agent:start'),
    stop: () => ipcRenderer.invoke('agent:stop'),
    isActive: () => ipcRenderer.invoke('agent:isActive'),
    createTask: (type: string, targetItemId: string, options?: unknown) =>
      ipcRenderer.invoke('agent:createTask', type, targetItemId, options),
    cancelTask: (taskId: string) => ipcRenderer.invoke('agent:cancelTask', taskId),
    getTask: (taskId: string) => ipcRenderer.invoke('agent:getTask', taskId),
    getPendingCount: () => ipcRenderer.invoke('agent:getPendingCount'),
    getTasksForItem: (itemId: string) => ipcRenderer.invoke('agent:getTasksForItem', itemId),
    processItem: (targetItemId: string, options?: unknown) =>
      ipcRenderer.invoke('agent:processItem', targetItemId, options),
    onProgress: (callback: (progress: unknown) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, progress: unknown) =>
        callback(progress);
      ipcRenderer.on('agent:progress', subscription);
      return () => {
        ipcRenderer.removeListener('agent:progress', subscription);
      };
    },
  },

  // 语义搜索便捷方法
  search: {
    semantic: (query: string, options?: unknown) =>
      ipcRenderer.invoke('search:semantic', query, options),
    findSimilar: (itemId: string, options?: unknown) =>
      ipcRenderer.invoke('search:findSimilar', itemId, options),
    hybrid: (query: string, options?: unknown) =>
      ipcRenderer.invoke('search:hybrid', query, options),
    clearCache: () => ipcRenderer.invoke('search:clearCache'),
  },

  // 版本历史便捷方法
  version: {
    create: (input: unknown) => ipcRenderer.invoke('version:create', input),
    getHistory: (options: unknown) => ipcRenderer.invoke('version:get-history', options),
    get: (versionId: string) => ipcRenderer.invoke('version:get', versionId),
    getLatest: (itemId: string) => ipcRenderer.invoke('version:get-latest', itemId),
    getByNumber: (itemId: string, versionNumber: number) =>
      ipcRenderer.invoke('version:get-by-number', itemId, versionNumber),
    restore: (itemId: string, versionId: string) =>
      ipcRenderer.invoke('version:restore', itemId, versionId),
    getCount: (itemId: string) => ipcRenderer.invoke('version:get-count', itemId),
    prune: (itemId: string, keepCount?: number) =>
      ipcRenderer.invoke('version:prune', itemId, keepCount),
    autoSave: (itemId: string, content: string, options?: unknown) =>
      ipcRenderer.invoke('version:auto-save', itemId, content, options),
    shouldAutoSave: (itemId: string, minIntervalMs?: number) =>
      ipcRenderer.invoke('version:should-auto-save', itemId, minIntervalMs),
  },

  // Git 便捷方法
  git: {
    isInRepository: (path: string) => ipcRenderer.invoke('git:is-in-repository', path),
    getRepository: (path: string) => ipcRenderer.invoke('git:get-repository', path),
    syncRepository: (path: string) => ipcRenderer.invoke('git:sync-repository', path),
    getCurrentBranch: (repoPath: string) => ipcRenderer.invoke('git:get-current-branch', repoPath),
    getBranches: (repoPath: string) => ipcRenderer.invoke('git:get-branches', repoPath),
    getRemoteUrl: (repoPath: string) => ipcRenderer.invoke('git:get-remote-url', repoPath),
    getRemotes: (repoPath: string) => ipcRenderer.invoke('git:get-remotes', repoPath),
    getStatus: (repoPath: string) => ipcRenderer.invoke('git:get-status', repoPath),
    getFileStatus: (repoPath: string, filePath: string) =>
      ipcRenderer.invoke('git:get-file-status', repoPath, filePath),
    hasUncommittedChanges: (repoPath: string) =>
      ipcRenderer.invoke('git:has-uncommitted-changes', repoPath),
    getHeadCommit: (repoPath: string) => ipcRenderer.invoke('git:get-head-commit', repoPath),
    getCommitHistory: (repoPath: string, options?: unknown) =>
      ipcRenderer.invoke('git:get-commit-history', repoPath, options),
    getCommit: (repoPath: string, commitHash: string) =>
      ipcRenderer.invoke('git:get-commit', repoPath, commitHash),
    getFileHistory: (repoPath: string, filePath: string, limit?: number) =>
      ipcRenderer.invoke('git:get-file-history', repoPath, filePath, limit),
    getWorkingDiff: (repoPath: string, filePath?: string) =>
      ipcRenderer.invoke('git:get-working-diff', repoPath, filePath),
    getStagedDiff: (repoPath: string, filePath?: string) =>
      ipcRenderer.invoke('git:get-staged-diff', repoPath, filePath),
    getCommitDiff: (repoPath: string, fromCommit: string, toCommit?: string, filePath?: string) =>
      ipcRenderer.invoke('git:get-commit-diff', repoPath, fromCommit, toCommit, filePath),
    getFileAtCommit: (repoPath: string, filePath: string, commitHash: string) =>
      ipcRenderer.invoke('git:get-file-at-commit', repoPath, filePath, commitHash),
    getBlame: (repoPath: string, filePath: string) =>
      ipcRenderer.invoke('git:get-blame', repoPath, filePath),
    listStashes: (repoPath: string) => ipcRenderer.invoke('git:list-stashes', repoPath),
  },
});

// Note: Type definitions are in src/render/types/electron.d.ts
