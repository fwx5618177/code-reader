// ================================
// Electron API Type Definitions
// Exposed via preload.ts
// ================================

import type { KnowledgeItemType } from './knowledge';

// ================================
// Database Types
// ================================

interface FTSResult {
  id: string;
  rank: number;
  snippet: string;
  title?: string;
  type?: string;
}

interface DatabaseStats {
  pageSize: number;
  pageCount: number;
  dbSizeBytes: number;
  walSizeBytes: number;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/** 事务中的单条参数化写语句（db:transaction） */
export interface SqlStatement {
  sql: string;
  params?: unknown[];
}

// ================================
// AI Types
// ================================

/** 与主进程 main/ai/provider-config.ts 保持一致；type 由主进程校验是否受支持 */
interface AIProviderConfig {
  id: string;
  type: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  isEnabled: boolean;
  /** 对话模型 */
  defaultModel?: string;
  /** 向量模型；为空表示不参与向量生成 */
  embeddingModel?: string;
  /** 语音转写模型；为空表示不参与转写 */
  transcriptionModel?: string;
  settings?: Record<string, unknown>;
}

/** 新增服务商输入，id 由主进程生成 */
type AIProviderInput = Omit<AIProviderConfig, 'id'>;

/** 字段缺省表示不变；apiKey 为空保留原密钥；baseUrl/模型为空字符串表示清除 */
type AIProviderUpdate = Partial<Omit<AIProviderConfig, 'id' | 'type'>>;

/** 渲染进程可见的服务商视图，不含密钥；requiresApiKey 为 false 时无密钥也可用（本地服务商） */
type AIProviderView = Omit<AIProviderConfig, 'apiKey'> & {
  hasApiKey: boolean;
  requiresApiKey: boolean;
};

/** 配置快照，默认服务商为主进程实际生效的值 */
interface AIConfigSnapshot {
  providers: AIProviderView[];
  defaultProviderId?: string;
  defaultEmbeddingProviderId?: string;
  defaultTranscriptionProviderId?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  providerId?: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

interface ChatCompletionResponse {
  id: string;
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  /** 流式对话被停止；此时 content 为停止前已生成的部分 */
  aborted?: boolean;
}

/** 进行中的流式对话 */
export interface ChatStreamHandle {
  /** 生成结束（或被停止）后的完整结果 */
  result: Promise<ChatCompletionResponse>;
  /** 停止生成；result 以已生成的部分正常返回 */
  cancel: () => Promise<void>;
}

interface EmbeddingRequest {
  providerId?: string;
  model?: string;
  input: string | string[];
}

interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

interface SummarizeRequest {
  content: string;
  maxLength?: number;
  language?: string;
  providerId?: string;
}

interface SummarizeResponse {
  summary: string;
  keyPoints: string[];
}

interface ExtractTagsRequest {
  content: string;
  maxTags?: number;
  existingTags?: string[];
  providerId?: string;
}

interface ExtractTagsResponse {
  tags: Array<{
    name: string;
    confidence: number;
  }>;
}

interface TranscribeRequest {
  audioPath: string;
  language?: string;
  providerId?: string;
}

interface TranscribeResponse {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
  duration?: number;
}

interface TestConnectionResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

// ================================
// Agent Types
// ================================

export type TaskType =
  | 'transcribe'
  | 'summarize'
  | 'extract-tags'
  | 'generate-embedding'
  | 'find-related'
  | 'categorize'
  | 'extract-entities';

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/** 由 Agent 任务生命周期维护的条目状态 */
export type ItemProcessingStatus = 'processing' | 'ready' | 'error';

interface AgentTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  /** 为空表示面向整个知识库的任务 */
  targetItemId: string | null;
  priority: number;
  progress: number;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  result?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskProgress {
  taskId: string;
  targetItemId: string | null;
  type: TaskType;
  progress: number;
  status: TaskStatus;
  message?: string;
}

export interface TaskCompletedEvent {
  taskId: string;
  targetItemId: string | null;
  type: TaskType;
  /** 任务执行结果，结构随任务类型而定 */
  result?: unknown;
}

interface TaskFailedEvent {
  taskId: string;
  targetItemId: string | null;
  type: TaskType;
  error: string;
  /** 为 true 时任务已重新排队，稍后自动重试；false 表示永久失败 */
  willRetry: boolean;
}

/** itemId 为空表示库级任务（如整库归类）的状态 */
interface ItemStatusChangedEvent {
  itemId: string | null;
  status: ItemProcessingStatus;
}

export interface ProcessItemOptions {
  transcribe?: boolean;
  summarize?: boolean;
  extractTags?: boolean;
  generateEmbedding?: boolean;
  findRelated?: boolean;
  extractEntities?: boolean;
  categorize?: boolean;
}

/** categorize 任务结果：实际生效的变更 */
export interface CategorizeResult {
  scope: 'item' | 'library';
  analyzedCount: number;
  createdFolders: string[];
  moves: Array<{ itemId: string; title: string; folder: string }>;
  tagAdditions: Array<{ itemId: string; title: string; tags: string[] }>;
  tagMerges: Array<{ from: string; into: string }>;
}

export type EntityType =
  | 'person'
  | 'organization'
  | 'place'
  | 'concept'
  | 'event'
  | 'work'
  | 'technology'
  | 'other';

/** extract-entities 任务结果 */
export interface ExtractEntitiesResult {
  chunkCount: number;
  entities: Array<{ name: string; type: EntityType; mentions: number }>;
}

/** 实体图谱数据（仅包含未删除条目及其关联的实体） */
export interface EntityGraphData {
  entities: Array<{ id: string; name: string; type: EntityType; itemCount: number }>;
  links: Array<{ itemId: string; entityId: string; mentionCount: number }>;
  items: Array<{ id: string; title: string; type: KnowledgeItemType }>;
}

// ================================
// Search Types
// ================================

interface SemanticSearchResult {
  itemId: string;
  title: string;
  type: string;
  similarity: number;
  snippet?: string;
  createdAt: string;
}

interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  types?: string[];
  folderId?: string;
  projectId?: string;
  includeDeleted?: boolean;
}

export interface HybridSearchResult extends SemanticSearchResult {
  ftsScore?: number;
  combinedScore: number;
}

/** 托盘“最近打开”中的文档 */
export interface RecentDocument {
  id: string;
  title: string;
}

/** 网页剪藏：主进程抓取的网页 */
export interface FetchedHtml {
  /** 重定向后的最终地址 */
  url: string;
  html: string;
}

/** 网页剪藏：单张图片的下载结果（url 为请求时的地址） */
export type ImageDownloadResult =
  | { url: string; filePath: string; mimeType: string; size: number }
  | { url: string; error: string };

/** 拼写检查词典；id 形如 builtin:en_US（内置）或 user:de_DE（导入） */
export interface SpellcheckDictionaryInfo {
  id: string;
  /** 词典文件名，通常是语言代码 */
  name: string;
  source: 'builtin' | 'user';
}

/** Hunspell 词典文件的原始字节 */
export interface SpellcheckDictionaryFiles {
  aff: Uint8Array;
  dic: Uint8Array;
}

/** 文字识别语言：内置随应用打包，用户导入的可删除 */
export interface OcrLanguageInfo {
  /** tesseract 语言代码，如 eng、chi_sim */
  code: string;
  source: 'builtin' | 'user';
}

/** 一个条目已保存的文字识别结果 */
export interface OcrStoredResults {
  /** 各页的识别结果（JSON 文本），按页码升序 */
  pages: Array<{ page: number; data: string }>;
  /** 最近一次写入正文的识别全文；从未写入时为 null */
  indexedText: string | null;
  /** 扫描页检测结果（JSON 文本）；从未检测时为 null */
  scan: string | null;
}

interface HybridSearchOptions extends SemanticSearchOptions {
  semanticWeight?: number;
}

// ================================
// Workspace Types（与主进程 main/workspace 保持一致）
// ================================

/** 知识库颜色：对应主题中的颜色变量（accent → --accent-primary，info → --color-info …） */
export type WorkspaceColor = 'accent' | 'info' | 'success' | 'warning' | 'error' | 'secondary';

/** 知识库：独立的 SQLite 文件与附件/备份目录 */
export interface WorkspaceInfo {
  id: string;
  name: string;
  color: WorkspaceColor;
  createdAt: string;
  /** 从未打开过时为 null */
  lastOpenedAt: string | null;
  /** 默认知识库（沿用升级前的数据位置，不可删除） */
  isDefault: boolean;
  /** 当前打开的知识库 */
  isCurrent: boolean;
  rootPath: string;
  dbPath: string;
  attachmentsPath: string;
  backupsPath: string;
}

/** 新建或编辑知识库时可修改的字段 */
export interface WorkspaceInput {
  name: string;
  color: WorkspaceColor;
}

// ================================
// Version History Types
// ================================

type ChangeType = 'create' | 'edit' | 'auto-save' | 'restore' | 'ai-update';
type AuthorType = 'user' | 'ai' | 'system';

interface DocumentVersion {
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

interface CreateVersionInput {
  itemId: string;
  title?: string;
  content?: string;
  summary?: string;
  changeType?: ChangeType;
  changeDescription?: string;
  authorType?: AuthorType;
}

interface VersionListOptions {
  itemId: string;
  limit?: number;
  offset?: number;
  changeTypes?: ChangeType[];
}

// ================================
// Electron API Interface
// ================================

interface ElectronAPI {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    once: (channel: string, callback: (...args: unknown[]) => void) => void;
    removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
    removeAllListeners: (channel: string) => void;
  };

  platform: NodeJS.Platform;

  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    createChild: (mode: string) => Promise<{ windowId: string; success: boolean }>;
  };

  database: {
    initialize: () => Promise<{ success: boolean }>;
    close: () => Promise<{ success: boolean }>;
    run: (sql: string, params?: unknown[]) => Promise<RunResult>;
    /** 在同一个事务中依次执行，任一失败则全部回滚 */
    transaction: (statements: SqlStatement[]) => Promise<RunResult[]>;
    get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>;
    all: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    search: (
      query: string,
      options?: { types?: string[]; limit?: number; offset?: number }
    ) => Promise<FTSResult[]>;
    getSchemaVersion: () => Promise<number>;
    backup: (path?: string) => Promise<{ success: boolean; path: string }>;
    vacuum: () => Promise<{ success: boolean }>;
    stats: () => Promise<DatabaseStats>;
  };

  ai: {
    getConfig: () => Promise<AIConfigSnapshot>;
    addProvider: (input: AIProviderInput) => Promise<AIProviderView>;
    updateProvider: (id: string, updates: AIProviderUpdate) => Promise<AIProviderView>;
    removeProvider: (id: string) => Promise<{ success: boolean }>;
    setDefaultProvider: (id: string) => Promise<{ success: boolean }>;
    setDefaultEmbeddingProvider: (id: string) => Promise<{ success: boolean }>;
    setDefaultTranscriptionProvider: (id: string) => Promise<{ success: boolean }>;
    testConnection: (providerId: string) => Promise<TestConnectionResult>;
    chatCompletion: (request: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
    /** 流式对话：生成过程中逐段回调 onDelta，可通过返回的 cancel 停止 */
    chatStream: (
      request: ChatCompletionRequest,
      onDelta: (delta: string) => void
    ) => ChatStreamHandle;
    createEmbeddings: (request: EmbeddingRequest) => Promise<EmbeddingResponse>;
    summarize: (request: SummarizeRequest) => Promise<SummarizeResponse>;
    extractTags: (request: ExtractTagsRequest) => Promise<ExtractTagsResponse>;
    transcribe: (request: TranscribeRequest) => Promise<TranscribeResponse>;
  };

  agent: {
    start: () => Promise<{ success: boolean }>;
    stop: () => Promise<{ success: boolean }>;
    isActive: () => Promise<boolean>;
    createTask: (
      type: TaskType,
      targetItemId: string,
      options?: { priority?: number; maxRetries?: number }
    ) => Promise<string>;
    cancelTask: (taskId: string) => Promise<boolean>;
    getTask: (taskId: string) => Promise<AgentTask | undefined>;
    getPendingCount: () => Promise<number>;
    getTasksForItem: (itemId: string) => Promise<AgentTask[]>;
    processItem: (targetItemId: string, options?: ProcessItemOptions) => Promise<string[]>;
    /** 整库自动归类，返回任务 ID（已有进行中的整库归类时返回其 ID） */
    categorizeLibrary: () => Promise<string>;
    /** 为所有有文本的条目抽取实体，返回新提交的条目数 */
    extractAllEntities: () => Promise<number>;
    /** 为语义索引过期（缺失、条目已修改、旧版截断向量）的条目重建分段向量，返回新提交的条目数 */
    reindexEmbeddings: () => Promise<number>;
    onProgress: (callback: (progress: TaskProgress) => void) => () => void;
    onTaskCompleted: (callback: (event: TaskCompletedEvent) => void) => () => void;
    onTaskFailed: (callback: (event: TaskFailedEvent) => void) => () => void;
    onItemStatusChanged: (callback: (event: ItemStatusChangedEvent) => void) => () => void;
  };

  entities: {
    getGraph: () => Promise<EntityGraphData>;
  };

  search: {
    semantic: (query: string, options?: SemanticSearchOptions) => Promise<SemanticSearchResult[]>;
    findSimilar: (
      itemId: string,
      options?: SemanticSearchOptions
    ) => Promise<SemanticSearchResult[]>;
    hybrid: (query: string, options?: HybridSearchOptions) => Promise<HybridSearchResult[]>;
    clearCache: () => Promise<{ success: boolean }>;
  };

  version: {
    create: (input: CreateVersionInput) => Promise<DocumentVersion>;
    getHistory: (options: VersionListOptions) => Promise<DocumentVersion[]>;
    get: (versionId: string) => Promise<DocumentVersion | null>;
    getLatest: (itemId: string) => Promise<DocumentVersion | null>;
    getByNumber: (itemId: string, versionNumber: number) => Promise<DocumentVersion | null>;
    restore: (itemId: string, versionId: string) => Promise<DocumentVersion>;
    getCount: (itemId: string) => Promise<number>;
    prune: (itemId: string, keepCount?: number) => Promise<number>;
    autoSave: (
      itemId: string,
      content: string,
      options?: { title?: string; minIntervalMs?: number }
    ) => Promise<DocumentVersion | null>;
    shouldAutoSave: (itemId: string, minIntervalMs?: number) => Promise<boolean>;
  };

  /** 网页剪藏：经主进程抓取 http/https 网页的 HTML（超时或过大时拒绝）；
   *  下载正文图片到目录（只接受 image/*，过大的图片拒绝），结果按输入顺序返回 */
  web: {
    fetchHtml: (url: string) => Promise<FetchedHtml>;
    downloadImages: (urls: string[], directory: string) => Promise<ImageDownloadResult[]>;
  };

  /** 拼写检查：列出/读取/导入（弹出文件选择框，取消时返回空数组）/删除词典，读写用户词表 */
  spellcheck: {
    listDictionaries: () => Promise<SpellcheckDictionaryInfo[]>;
    readDictionary: (id: string) => Promise<SpellcheckDictionaryFiles>;
    importDictionary: () => Promise<SpellcheckDictionaryInfo[]>;
    removeDictionary: (id: string) => Promise<void>;
    getUserWords: () => Promise<string[]>;
    addUserWord: (word: string) => Promise<void>;
    removeUserWord: (word: string) => Promise<void>;
  };

  /** 扫描版 PDF 文字识别：列出/导入（弹出文件选择框，取消时返回空数组）/删除语言数据；
   *  在当前知识库中按“条目 + 页码”读写识别结果与扫描页检测结果，removeResults 删除条目的全部缓存 */
  ocr: {
    listLanguages: () => Promise<OcrLanguageInfo[]>;
    importLanguage: () => Promise<OcrLanguageInfo[]>;
    removeLanguage: (code: string) => Promise<void>;
    readResults: (itemId: string) => Promise<OcrStoredResults>;
    writePageResult: (itemId: string, page: number, data: string) => Promise<void>;
    writeIndexedText: (itemId: string, text: string) => Promise<void>;
    writeScanResult: (itemId: string, data: string) => Promise<void>;
    removeResults: (itemId: string) => Promise<void>;
  };

  /** 托盘菜单：on* 订阅菜单动作并返回取消订阅函数；setRecentDocuments 更新“最近打开”子菜单 */
  tray: {
    onQuickNote: (callback: () => void) => () => void;
    onOpenSearch: (callback: () => void) => () => void;
    onSwitchMode: (callback: (mode: 'knowledge' | 'writing' | 'reading') => void) => () => void;
    onOpenSettings: (callback: () => void) => () => void;
    onOpenDocument: (callback: (id: string) => void) => () => void;
    setRecentDocuments: (documents: RecentDocument[]) => void;
  };

  /** 知识库：名称重复/为空等校验失败时主进程抛错；remove 弹出系统确认框，取消时 deleted 为 false；
   *  switchTo 成功后主进程重新加载所有窗口 */
  workspace: {
    list: () => Promise<WorkspaceInfo[]>;
    getCurrent: () => Promise<WorkspaceInfo>;
    create: (input: WorkspaceInput) => Promise<WorkspaceInfo>;
    update: (id: string, input: WorkspaceInput) => Promise<WorkspaceInfo>;
    remove: (id: string) => Promise<{ deleted: boolean }>;
    switchTo: (id: string) => Promise<void>;
  };

  /** 落盘：主进程切换知识库、关闭窗口、退出前调用 handler，其完成后自动回 ack；返回取消订阅函数 */
  lifecycle: {
    onFlushRequest: (handler: () => Promise<void>) => () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
