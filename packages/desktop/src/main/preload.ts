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
  'read-binary-file',
  'write-file',
  'write-binary-file',
  'get-file-info',
  'create-directory',
  'path-exists',
  'rename-path',

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
  'ai:getConfig',
  'ai:addProvider',
  'ai:updateProvider',
  'ai:removeProvider',
  'ai:setDefaultProvider',
  'ai:setDefaultEmbeddingProvider',
  'ai:setDefaultTranscriptionProvider',
  'ai:testConnection',
  'ai:chatCompletion',
  'ai:chatStream',
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

];

// 用于接收事件的通道
const eventChannels = [
  'agent:progress',
  'agent:taskCompleted',
  'agent:taskFailed',
  'agent:itemStatusChanged',
  'ai:chatChunk',
  'tray:quick-note',
  'tray:open-search',
  'tray:switch-mode',
  'tray:open-settings',
];

/** 流式对话序号；事件只发往发起请求的窗口，窗口内唯一即可 */
let chatStreamSeq = 0;

/**
 * 订阅主进程推送的事件，返回取消订阅函数
 */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const subscription = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, subscription);
  return () => {
    ipcRenderer.removeListener(channel, subscription);
  };
}

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
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    addProvider: (input: unknown) => ipcRenderer.invoke('ai:addProvider', input),
    updateProvider: (id: string, updates: unknown) =>
      ipcRenderer.invoke('ai:updateProvider', id, updates),
    removeProvider: (id: string) => ipcRenderer.invoke('ai:removeProvider', id),
    setDefaultProvider: (id: string) => ipcRenderer.invoke('ai:setDefaultProvider', id),
    setDefaultEmbeddingProvider: (id: string) =>
      ipcRenderer.invoke('ai:setDefaultEmbeddingProvider', id),
    setDefaultTranscriptionProvider: (id: string) =>
      ipcRenderer.invoke('ai:setDefaultTranscriptionProvider', id),
    testConnection: (providerId: string) => ipcRenderer.invoke('ai:testConnection', providerId),
    chatCompletion: (request: unknown) => ipcRenderer.invoke('ai:chatCompletion', request),
    chatStream: async (request: unknown, onDelta: (delta: string) => void) => {
      const streamId = `chat-${++chatStreamSeq}`;
      const unsubscribe = subscribe<{ streamId: string; delta: string }>(
        'ai:chatChunk',
        (chunk) => {
          if (chunk.streamId === streamId) onDelta(chunk.delta);
        }
      );
      try {
        // 主进程先发送增量事件再返回结果，同一通道保序，返回时增量已全部送达
        return await ipcRenderer.invoke('ai:chatStream', streamId, request);
      } finally {
        unsubscribe();
      }
    },
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
    onProgress: (callback: (progress: unknown) => void) => subscribe('agent:progress', callback),
    onTaskCompleted: (callback: (event: unknown) => void) =>
      subscribe('agent:taskCompleted', callback),
    onTaskFailed: (callback: (event: unknown) => void) => subscribe('agent:taskFailed', callback),
    onItemStatusChanged: (callback: (event: unknown) => void) =>
      subscribe('agent:itemStatusChanged', callback),
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

  // 托盘菜单动作（主进程推送）
  tray: {
    onQuickNote: (callback: () => void) => subscribe('tray:quick-note', callback),
    onOpenSearch: (callback: () => void) => subscribe('tray:open-search', callback),
    onSwitchMode: (callback: (mode: string) => void) => subscribe('tray:switch-mode', callback),
    onOpenSettings: (callback: () => void) => subscribe('tray:open-settings', callback),
  },
});

// Note: Type definitions are in src/render/types/electron.d.ts
