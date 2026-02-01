// ================================
// Writing Module - Type Definitions
// 写作模块类型定义
// ================================

import type { TextDiffResult, DiffStats } from '@code-reader/diff-algorithm';
import type { SearchHighlight, SearchDocument } from '@code-reader/search-service';

// 重新导出类型以保持向后兼容
export type { TextDiffResult, DiffStats, SearchHighlight, SearchDocument };

// ================================
// Document Index Types
// ================================

/**
 * 可索引的文档
 */
export interface IndexableDocument {
  /** 文档 ID */
  readonly id: string;
  /** 文档标题 */
  readonly title: string;
  /** 文档内容（纯文本或 HTML） */
  readonly content: string;
  /** 文档路径（可选） */
  readonly path?: string;
  /** 文档类型 */
  readonly type?: 'document' | 'note' | 'code' | 'markdown';
  /** 标签 */
  readonly tags?: readonly string[];
  /** 最后更新时间 */
  readonly updatedAt?: Date;
}

/**
 * 文档搜索结果
 * 注意：不继承 SearchResult 以避免 readonly 数组类型不兼容问题
 */
export interface DocumentSearchResult {
  /** 文档 ID（对应 SearchResult.id） */
  readonly id: string;
  /** 文档 ID（别名） */
  readonly documentId: string;
  /** 文档标题 */
  readonly title: string;
  /** 匹配高亮 */
  readonly highlights: SearchHighlight[];
  /** 匹配摘要 */
  readonly snippet: string;
  /** 匹配分数 */
  readonly score: number;
  /** 原始文档 */
  readonly document?: SearchDocument;
  /** 匹配的字段 */
  readonly matchedFields?: string[];
  /** 匹配的词项 */
  readonly matchedTerms?: string[];
}

/**
 * 搜索建议
 */
export interface SearchSuggestion {
  /** 建议文本 */
  readonly text: string;
  /** 建议类型 */
  readonly type: 'term' | 'document' | 'tag' | 'history';
  /** 相关度分数 */
  readonly score: number;
  /** 关联的文档 ID（如果有） */
  readonly documentId?: string;
}

// ================================
// Diff Cache Types
// ================================

/**
 * 缓存的差分结果
 */
export interface CachedDiff {
  /** 差分结果 */
  readonly result: TextDiffResult;
  /** 差分统计 */
  readonly stats: DiffStats;
  /** 源内容哈希 */
  readonly sourceHash: string;
  /** 目标内容哈希 */
  readonly targetHash: string;
  /** 缓存时间戳 */
  readonly cachedAt: number;
}

/**
 * 增量保存操作
 */
export interface IncrementalOperation {
  /** 操作类型 */
  readonly type: 'insert' | 'delete' | 'retain';
  /** 操作值 */
  readonly value: string | number;
}

/**
 * 增量保存数据
 */
export interface IncrementalData {
  /** 文档 ID */
  readonly documentId: string;
  /** 基准版本 ID */
  readonly baseVersionId: number;
  /** 基准内容哈希 */
  readonly baseHash: string;
  /** 目标版本 ID */
  readonly targetVersionId: number;
  /** 目标内容哈希 */
  readonly targetHash: string;
  /** 操作列表 */
  readonly operations: readonly IncrementalOperation[];
  /** 时间戳 */
  readonly timestamp: number;
}

// ================================
// Writing Service Config
// ================================

/**
 * 写作服务配置
 */
export interface WritingServiceConfig {
  /** 是否启用搜索索引 */
  enableSearchIndex?: boolean;
  /** 是否启用差分缓存 */
  enableDiffCache?: boolean;
  /** 是否启用 Worker 后台计算 */
  enableWorker?: boolean;
  /** 是否启用索引持久化 */
  enableIndexPersistence?: boolean;
  /** 索引持久化数据库名称 */
  indexDbName?: string;
  /** 差分缓存最大条目数 */
  diffCacheMaxSize?: number;
  /** 差分缓存 TTL（毫秒） */
  diffCacheTTL?: number;
  /** Worker 阈值（字节数，超过则使用 Worker） */
  workerThreshold?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * 默认写作服务配置
 */
export const DEFAULT_WRITING_CONFIG: Required<WritingServiceConfig> = {
  enableSearchIndex: true,
  enableDiffCache: true,
  enableWorker: true,
  enableIndexPersistence: true,
  indexDbName: 'writing-search-index',
  diffCacheMaxSize: 500,
  diffCacheTTL: 5 * 60 * 1000, // 5 minutes
  workerThreshold: 50 * 1024, // 50KB
  debug: false,
};

// ================================
// Service State Types
// ================================

/**
 * 写作服务状态
 */
export interface WritingServiceState {
  /** 是否已初始化 */
  readonly isInitialized: boolean;
  /** 索引文档数量 */
  readonly indexedDocumentCount: number;
  /** 缓存命中次数 */
  readonly cacheHits: number;
  /** 缓存未命中次数 */
  readonly cacheMisses: number;
  /** Worker 是否就绪 */
  readonly isWorkerReady: boolean;
  /** 最后索引更新时间 */
  readonly lastIndexUpdateAt: Date | null;
  /** 最后持久化时间 */
  readonly lastPersistAt: Date | null;
}

/**
 * 初始服务状态
 */
export const initialWritingServiceState: WritingServiceState = {
  isInitialized: false,
  indexedDocumentCount: 0,
  cacheHits: 0,
  cacheMisses: 0,
  isWorkerReady: false,
  lastIndexUpdateAt: null,
  lastPersistAt: null,
};

// ================================
// Event Types
// ================================

/**
 * 写作服务事件类型
 */
export type WritingServiceEventType =
  | 'INITIALIZED'
  | 'INDEX_UPDATED'
  | 'INDEX_PERSISTED'
  | 'INDEX_LOADED'
  | 'DOCUMENT_INDEXED'
  | 'DOCUMENT_REMOVED'
  | 'CACHE_HIT'
  | 'CACHE_MISS'
  | 'WORKER_READY'
  | 'WORKER_ERROR'
  | 'ERROR';

/**
 * 写作服务事件
 */
export interface WritingServiceEvent {
  /** 事件类型 */
  readonly type: WritingServiceEventType;
  /** 时间戳 */
  readonly timestamp: number;
  /** 事件数据 */
  readonly data?: unknown;
  /** 错误信息（如果有） */
  readonly error?: string;
}

/**
 * 事件监听器
 */
export type WritingServiceEventListener = (event: WritingServiceEvent) => void;

// ================================
// Search Options
// ================================

/**
 * 文档搜索选项
 */
export interface DocumentSearchOptions {
  /** 最大返回结果数 */
  limit?: number;
  /** 是否启用模糊搜索 */
  fuzzy?: boolean;
  /** 模糊搜索阈值 */
  fuzzyThreshold?: number;
  /** 是否启用高亮 */
  highlight?: boolean;
  /** 高亮片段长度 */
  snippetLength?: number;
  /** 搜索字段 */
  fields?: readonly ('title' | 'content' | 'tags')[];
  /** 文档类型过滤 */
  type?: 'document' | 'note' | 'code' | 'markdown';
}

/**
 * 默认搜索选项
 */
export const DEFAULT_SEARCH_OPTIONS: Required<DocumentSearchOptions> = {
  limit: 20,
  fuzzy: false,
  fuzzyThreshold: 0.7,
  highlight: true,
  snippetLength: 150,
  fields: ['title', 'content'],
  type: 'document',
};

// ================================
// Suggestion Options
// ================================

/**
 * 建议选项
 */
export interface SuggestionOptions {
  /** 最大建议数量 */
  limit?: number;
  /** 是否包含历史记录 */
  includeHistory?: boolean;
  /** 是否包含文档标题 */
  includeDocuments?: boolean;
  /** 是否包含标签 */
  includeTags?: boolean;
}

/**
 * 默认建议选项
 */
export const DEFAULT_SUGGESTION_OPTIONS: Required<SuggestionOptions> = {
  limit: 10,
  includeHistory: true,
  includeDocuments: true,
  includeTags: true,
};

// ================================
// Diff Options
// ================================

/**
 * 差分计算选项
 */
export interface DiffOptions {
  /** 是否使用缓存 */
  useCache?: boolean;
  /** 是否使用 Worker */
  useWorker?: boolean;
  /** 是否启用语义清理 */
  semanticCleanup?: boolean;
  /** 是否启用效率清理 */
  efficiencyCleanup?: boolean;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 默认差分选项
 */
export const DEFAULT_DIFF_OPTIONS: Required<DiffOptions> = {
  useCache: true,
  useWorker: true,
  semanticCleanup: true,
  efficiencyCleanup: true,
  timeout: 5000,
};

// ================================
// Interface Definitions
// ================================

/**
 * 写作服务接口
 */
export interface IWritingService {
  // 生命周期
  initialize(): Promise<void>;
  destroy(): void;
  getState(): WritingServiceState;

  // 事件
  addEventListener(listener: WritingServiceEventListener): () => void;

  // 索引操作
  indexDocument(doc: IndexableDocument): Promise<void>;
  indexDocuments(docs: readonly IndexableDocument[]): Promise<void>;
  removeDocument(id: string): Promise<void>;
  updateDocument(doc: IndexableDocument): Promise<void>;
  clearIndex(): Promise<void>;

  // 搜索
  search(query: string, options?: DocumentSearchOptions): Promise<DocumentSearchResult[]>;
  suggest(prefix: string, options?: SuggestionOptions): Promise<SearchSuggestion[]>;

  // 差分
  computeDiff(source: string, target: string, options?: DiffOptions): Promise<TextDiffResult>;
  computeDiffStats(source: string, target: string): Promise<DiffStats>;
  shouldUseIncremental(source: string, target: string): Promise<boolean>;

  // 持久化
  persistIndex(): Promise<void>;
  loadIndex(): Promise<boolean>;

  // 缓存
  clearDiffCache(): void;
  getDiffCacheStats(): { hits: number; misses: number; size: number };
}

/**
 * 索引存储接口
 */
export interface IIndexStorage {
  save(key: string, data: unknown): Promise<void>;
  load(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
