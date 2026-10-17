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
  'db:transaction',
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
  'ai:chatStreamCancel',
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
  'agent:categorizeLibrary',
  'agent:extractAllEntities',
  'agent:reindexEmbeddings',

  // 实体图谱
  'entities:getGraph',

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
  'version:prune-all',
  'version:get-retention',
  'version:set-retention',
  'version:get-stats',
  'version:auto-save',
  'version:should-auto-save',

  // 网页剪藏
  'web:fetchHtml',
  'web:downloadImages',

  // 拼写检查
  'spellcheck:listDictionaries',
  'spellcheck:readDictionary',
  'spellcheck:importDictionary',
  'spellcheck:removeDictionary',
  'spellcheck:getUserWords',
  'spellcheck:addUserWord',
  'spellcheck:removeUserWord',

  // 插件
  'plugins:list',
  'plugins:readEntry',
  'plugins:openDirectory',
  'plugins:uninstall',

  // 扫描版 PDF 文字识别
  'ocr:listLanguages',
  'ocr:importLanguage',
  'ocr:removeLanguage',
  'ocr:readResults',
  'ocr:writePageResult',
  'ocr:writeIndexedText',
  'ocr:writeScanResult',
  'ocr:removeResults',

  // 知识库（多库切换）
  'workspace:list',
  'workspace:getCurrent',
  'workspace:create',
  'workspace:update',
  'workspace:remove',
  'workspace:switch',

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
  'tray:open-document',
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
    transaction: (statements: Array<{ sql: string; params?: unknown[] }>) =>
      ipcRenderer.invoke('db:transaction', statements),
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
    chatStream: (request: unknown, onDelta: (delta: string) => void) => {
      const streamId = `chat-${++chatStreamSeq}`;
      const unsubscribe = subscribe<{ streamId: string; delta: string }>(
        'ai:chatChunk',
        (chunk) => {
          if (chunk.streamId === streamId) onDelta(chunk.delta);
        }
      );
      // 主进程先发送增量事件再返回结果，同一通道保序，返回时增量已全部送达
      const result = ipcRenderer.invoke('ai:chatStream', streamId, request).finally(unsubscribe);
      // AbortSignal 无法穿过 contextBridge，改为返回停止函数
      const cancel = () => ipcRenderer.invoke('ai:chatStreamCancel', streamId);
      return { result, cancel };
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
    categorizeLibrary: () => ipcRenderer.invoke('agent:categorizeLibrary'),
    extractAllEntities: () => ipcRenderer.invoke('agent:extractAllEntities'),
    reindexEmbeddings: () => ipcRenderer.invoke('agent:reindexEmbeddings'),
    onProgress: (callback: (progress: unknown) => void) => subscribe('agent:progress', callback),
    onTaskCompleted: (callback: (event: unknown) => void) =>
      subscribe('agent:taskCompleted', callback),
    onTaskFailed: (callback: (event: unknown) => void) => subscribe('agent:taskFailed', callback),
    onItemStatusChanged: (callback: (event: unknown) => void) =>
      subscribe('agent:itemStatusChanged', callback),
  },

  // 实体图谱便捷方法
  entities: {
    getGraph: () => ipcRenderer.invoke('entities:getGraph'),
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
    prune: (itemId: string) => ipcRenderer.invoke('version:prune', itemId),
    pruneAll: () => ipcRenderer.invoke('version:prune-all'),
    getRetention: () => ipcRenderer.invoke('version:get-retention'),
    setRetention: (policy: unknown) => ipcRenderer.invoke('version:set-retention', policy),
    getStats: () => ipcRenderer.invoke('version:get-stats'),
    autoSave: (itemId: string, content: string, options?: unknown) =>
      ipcRenderer.invoke('version:auto-save', itemId, content, options),
    shouldAutoSave: (itemId: string, minIntervalMs?: number) =>
      ipcRenderer.invoke('version:should-auto-save', itemId, minIntervalMs),
  },

  // 网页剪藏：由主进程抓取 HTML、下载正文图片
  web: {
    fetchHtml: (url: string) => ipcRenderer.invoke('web:fetchHtml', url),
    downloadImages: (urls: string[], directory: string) =>
      ipcRenderer.invoke('web:downloadImages', urls, directory),
  },

  // 拼写检查：词典文件与用户词表由主进程管理
  spellcheck: {
    listDictionaries: () => ipcRenderer.invoke('spellcheck:listDictionaries'),
    readDictionary: (id: string) => ipcRenderer.invoke('spellcheck:readDictionary', id),
    importDictionary: () => ipcRenderer.invoke('spellcheck:importDictionary'),
    removeDictionary: (id: string) => ipcRenderer.invoke('spellcheck:removeDictionary', id),
    getUserWords: () => ipcRenderer.invoke('spellcheck:getUserWords'),
    addUserWord: (word: string) => ipcRenderer.invoke('spellcheck:addUserWord', word),
    removeUserWord: (word: string) => ipcRenderer.invoke('spellcheck:removeUserWord', word),
  },

  // 插件：插件目录由主进程管理，渲染进程只拿到 manifest 与入口代码文本
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    readEntry: (id: string, main: string) => ipcRenderer.invoke('plugins:readEntry', id, main),
    openDirectory: () => ipcRenderer.invoke('plugins:openDirectory'),
    uninstall: (id: string) => ipcRenderer.invoke('plugins:uninstall', id),
  },

  // 扫描版 PDF 文字识别：语言数据由主进程管理（识别引擎经 ocr-resource:// 协议加载），识别结果按条目保存在当前知识库
  ocr: {
    listLanguages: () => ipcRenderer.invoke('ocr:listLanguages'),
    importLanguage: () => ipcRenderer.invoke('ocr:importLanguage'),
    removeLanguage: (code: string) => ipcRenderer.invoke('ocr:removeLanguage', code),
    readResults: (itemId: string) => ipcRenderer.invoke('ocr:readResults', itemId),
    writePageResult: (itemId: string, page: number, data: string) =>
      ipcRenderer.invoke('ocr:writePageResult', itemId, page, data),
    writeIndexedText: (itemId: string, text: string) => ipcRenderer.invoke('ocr:writeIndexedText', itemId, text),
    writeScanResult: (itemId: string, data: string) => ipcRenderer.invoke('ocr:writeScanResult', itemId, data),
    removeResults: (itemId: string) => ipcRenderer.invoke('ocr:removeResults', itemId),
  },

  // 托盘菜单：动作由主进程推送；最近文档列表由渲染进程提供
  tray: {
    onQuickNote: (callback: () => void) => subscribe('tray:quick-note', callback),
    onOpenSearch: (callback: () => void) => subscribe('tray:open-search', callback),
    onSwitchMode: (callback: (mode: string) => void) => subscribe('tray:switch-mode', callback),
    onOpenSettings: (callback: () => void) => subscribe('tray:open-settings', callback),
    onOpenDocument: (callback: (id: string) => void) => subscribe('tray:open-document', callback),
    setRecentDocuments: (documents: Array<{ id: string; title: string }>) =>
      ipcRenderer.send('tray:set-recent-documents', documents),
  },

  // 知识库：注册表与数据路径由主进程管理；切换成功后主进程重新加载所有窗口
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    getCurrent: () => ipcRenderer.invoke('workspace:getCurrent'),
    create: (input: unknown) => ipcRenderer.invoke('workspace:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('workspace:update', id, input),
    remove: (id: string) => ipcRenderer.invoke('workspace:remove', id),
    switchTo: (id: string) => ipcRenderer.invoke('workspace:switch', id),
  },

  // 落盘：主进程在切换知识库、关闭窗口、退出前请求写回防抖中的数据，handler 完成后自动回 ack
  lifecycle: {
    onFlushRequest: (handler: () => Promise<void>) =>
      subscribe<string>('app:flush-request', (requestId) => {
        void handler().finally(() => ipcRenderer.send('app:flush-ack', requestId));
      }),
  },
});

// Note: Type definitions are in src/render/types/electron.d.ts
