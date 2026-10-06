// ================================
// Writing Service
// 写作模块服务层 - 整合搜索、差分、持久化
// ================================

import {
  SearchIndex,
  createSearchIndex,
  type SearchDocument,
  type SearchOptions,
} from '@code-reader/search-service';
import {
  DiffCache,
  createDiffCache,
  AsyncDiffEngine,
  createAsyncDiffEngine,
  type TextDiffResult,
  type DiffStats,
  type AsyncDiffEngineConfig,
} from '@code-reader/diff-algorithm';
import { IndexStorage, createIndexStorage, type IndexStorageConfig } from './index-storage';
import {
  type IWritingService,
  type WritingServiceConfig,
  type WritingServiceState,
  type WritingServiceEvent,
  type WritingServiceEventListener,
  type IndexableDocument,
  type DocumentSearchResult,
  type SearchSuggestion,
  type DocumentSearchOptions,
  type SuggestionOptions,
  type DiffOptions,
  DEFAULT_WRITING_CONFIG,
  DEFAULT_SEARCH_OPTIONS,
  DEFAULT_SUGGESTION_OPTIONS,
  DEFAULT_DIFF_OPTIONS,
  initialWritingServiceState,
} from './types';

// ================================
// Constants
// ================================

const INDEX_STORAGE_KEY = 'writing-search-index';
const PERSIST_DEBOUNCE_MS = 5000;

// ================================
// Writing Service Implementation
// ================================

/**
 * 写作服务
 *
 * 提供写作模块所需的核心功能：
 * - 全文搜索索引（自动持久化）
 * - 文档差分计算（带缓存）
 * - 搜索建议
 * - Worker 后台计算
 *
 * 设计原则：
 * - 高内聚：所有写作相关功能集中管理
 * - 低耦合：通过接口与其他模块交互
 * - 单一职责：每个内部组件只负责一个功能
 */
export class WritingService implements IWritingService {
  private readonly config: Required<WritingServiceConfig>;
  private readonly listeners: Set<WritingServiceEventListener>;
  private state: WritingServiceState;

  // 核心组件
  private searchIndex: SearchIndex | null = null;
  private diffCache: DiffCache | null = null;
  private asyncDiffEngine: AsyncDiffEngine | null = null;
  private indexStorage: IndexStorage | null = null;

  // 持久化控制
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private needsPersist = false;

  // 搜索历史
  private searchHistory: string[] = [];
  private readonly maxHistorySize = 50;

  // 初始化状态
  private initPromise: Promise<void> | null = null;
  private isDestroyed = false;

  constructor(config: WritingServiceConfig = {}) {
    this.config = { ...DEFAULT_WRITING_CONFIG, ...config };
    this.listeners = new Set();
    this.state = { ...initialWritingServiceState };
  }

  // ================================
  // Lifecycle
  // ================================

  /**
   * 初始化服务
   */
  async initialize(): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('WritingService has been destroyed');
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      this.log('Initializing WritingService...');

      // 初始化搜索索引
      if (this.config.enableSearchIndex) {
        this.searchIndex = createSearchIndex({
          caseSensitive: false,
          minWordLength: 1,
          fieldWeights: {
            title: 3.0,
            content: 1.0,
            path: 2.0,
          },
        });
        this.log('Search index created');
      }

      // 初始化差分缓存
      if (this.config.enableDiffCache) {
        this.diffCache = createDiffCache({
          maxSize: this.config.diffCacheMaxSize,
          ttl: this.config.diffCacheTTL,
        });
        this.log('Diff cache created');
      }

      // 初始化异步差分引擎
      if (this.config.enableWorker) {
        const asyncConfig: AsyncDiffEngineConfig = {
          workerThreshold: this.config.workerThreshold,
          autoInitialize: true,
          useSharedPool: true,
          debug: this.config.debug,
        };
        this.asyncDiffEngine = createAsyncDiffEngine(asyncConfig);
        await this.asyncDiffEngine.initialize();
        this.updateState({ isWorkerReady: true });
        this.emitEvent({ type: 'WORKER_READY', timestamp: Date.now() });
        this.log('Async diff engine initialized');
      }

      // 初始化索引存储
      if (this.config.enableIndexPersistence) {
        const storageConfig: IndexStorageConfig = {
          dbName: this.config.indexDbName,
          debug: this.config.debug,
        };
        this.indexStorage = createIndexStorage(storageConfig);
        this.log('Index storage created');

        // 尝试加载持久化的索引
        await this.loadIndex();
      }

      this.updateState({ isInitialized: true });
      this.emitEvent({ type: 'INITIALIZED', timestamp: Date.now() });
      this.log('WritingService initialized successfully');
    } catch (error) {
      this.log('Failed to initialize WritingService:', error);
      this.emitEvent({
        type: 'ERROR',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;

    // 清理持久化定时器
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    // 如果有待持久化的数据，同步保存
    if (this.needsPersist && this.searchIndex && this.indexStorage) {
      this.persistIndexSync();
    }

    // 销毁异步差分引擎
    if (this.asyncDiffEngine) {
      this.asyncDiffEngine.destroy();
      this.asyncDiffEngine = null;
    }

    // 关闭索引存储
    if (this.indexStorage) {
      this.indexStorage.close();
      this.indexStorage = null;
    }

    // 清空缓存
    if (this.diffCache) {
      this.diffCache.clear();
      this.diffCache = null;
    }

    // 清空索引
    if (this.searchIndex) {
      this.searchIndex.clear();
      this.searchIndex = null;
    }

    this.listeners.clear();
    this.searchHistory = [];
    this.initPromise = null;

    // 资源已释放：同步重置运行态标记，避免外部读取到“已初始化 / Worker 就绪”的过期状态
    // 缓存命中统计与最后持久化时间属于历史数据，予以保留
    this.updateState({
      isInitialized: false,
      isWorkerReady: false,
      indexedDocumentCount: 0,
    });

    this.log('WritingService destroyed');
  }

  /**
   * 获取当前状态
   */
  getState(): WritingServiceState {
    return { ...this.state };
  }

  // ================================
  // Event Handling
  // ================================

  /**
   * 添加事件监听器
   */
  addEventListener(listener: WritingServiceEventListener): () => void {
    if (this.isDestroyed) {
      return () => {};
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ================================
  // Index Operations
  // ================================

  /**
   * 索引单个文档
   */
  async indexDocument(doc: IndexableDocument): Promise<void> {
    this.ensureInitialized();

    if (!this.searchIndex) return;

    const searchDoc: SearchDocument = {
      id: doc.id,
      title: doc.title,
      content: this.stripHtml(doc.content),
      path: doc.path,
      type: doc.type ?? 'document',
    };

    this.searchIndex.addDocument(searchDoc);

    this.updateState({
      indexedDocumentCount: this.searchIndex.getStats().documentCount,
      lastIndexUpdateAt: new Date(),
    });

    this.emitEvent({
      type: 'DOCUMENT_INDEXED',
      timestamp: Date.now(),
      data: { documentId: doc.id },
    });

    this.schedulePersist();
  }

  /**
   * 批量索引文档
   */
  async indexDocuments(docs: readonly IndexableDocument[]): Promise<void> {
    this.ensureInitialized();

    if (!this.searchIndex) return;

    const searchDocs: SearchDocument[] = docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: this.stripHtml(doc.content),
      path: doc.path,
      type: doc.type ?? 'document',
    }));

    this.searchIndex.addDocuments(searchDocs);

    this.updateState({
      indexedDocumentCount: this.searchIndex.getStats().documentCount,
      lastIndexUpdateAt: new Date(),
    });

    this.emitEvent({
      type: 'INDEX_UPDATED',
      timestamp: Date.now(),
      data: { documentCount: docs.length },
    });

    this.schedulePersist();
  }

  /**
   * 移除文档
   */
  async removeDocument(id: string): Promise<void> {
    this.ensureInitialized();

    if (!this.searchIndex) return;

    this.searchIndex.removeDocument(id);

    this.updateState({
      indexedDocumentCount: this.searchIndex.getStats().documentCount,
      lastIndexUpdateAt: new Date(),
    });

    this.emitEvent({
      type: 'DOCUMENT_REMOVED',
      timestamp: Date.now(),
      data: { documentId: id },
    });

    this.schedulePersist();
  }

  /**
   * 更新文档
   */
  async updateDocument(doc: IndexableDocument): Promise<void> {
    this.ensureInitialized();

    if (!this.searchIndex) return;

    const searchDoc: SearchDocument = {
      id: doc.id,
      title: doc.title,
      content: this.stripHtml(doc.content),
      path: doc.path,
      type: doc.type ?? 'document',
    };

    this.searchIndex.updateDocument(searchDoc);

    this.updateState({ lastIndexUpdateAt: new Date() });
    this.schedulePersist();
  }

  /**
   * 清空索引
   */
  async clearIndex(): Promise<void> {
    this.ensureInitialized();

    if (!this.searchIndex) return;

    this.searchIndex.clear();

    this.updateState({
      indexedDocumentCount: 0,
      lastIndexUpdateAt: new Date(),
    });

    this.schedulePersist();
  }

  // ================================
  // Search Operations
  // ================================

  /**
   * 搜索文档
   */
  async search(
    query: string,
    options: DocumentSearchOptions = {}
  ): Promise<DocumentSearchResult[]> {
    this.ensureInitialized();

    if (!this.searchIndex || !query.trim()) {
      return [];
    }

    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };

    const searchOpts: SearchOptions = {
      limit: opts.limit,
      fuzzy: opts.fuzzy,
      fuzzyThreshold: opts.fuzzyThreshold,
      highlight: opts.highlight,
      snippetLength: opts.snippetLength,
      fields: opts.fields as string[],
    };

    const results = this.searchIndex.search(query, searchOpts);

    // 添加到搜索历史
    this.addToSearchHistory(query);

    return results.map((result) => ({
      ...result,
      documentId: result.id,
      title: result.document?.title ?? '',
      snippet: result.highlights?.[0]?.snippet ?? '',
    }));
  }

  /**
   * 获取搜索建议
   */
  async suggest(prefix: string, options: SuggestionOptions = {}): Promise<SearchSuggestion[]> {
    this.ensureInitialized();

    if (!this.searchIndex || !prefix.trim()) {
      return [];
    }

    const opts = { ...DEFAULT_SUGGESTION_OPTIONS, ...options };
    const suggestions: SearchSuggestion[] = [];

    // 从索引获取词条建议（suggest 返回 string[]）
    const termSuggestions = this.searchIndex.suggest(prefix, opts.limit);
    for (let i = 0; i < termSuggestions.length; i++) {
      const term = termSuggestions[i];
      suggestions.push({
        text: term,
        type: 'term',
        score: 1 - i * 0.1, // 基于顺序计算分数
      });
    }

    // 从历史记录获取建议
    if (opts.includeHistory) {
      const historySuggestions = this.searchHistory
        .filter((h) => h.toLowerCase().startsWith(prefix.toLowerCase()))
        .slice(0, 5)
        .map((text, index) => ({
          text,
          type: 'history' as const,
          score: 0.9 - index * 0.1,
        }));
      suggestions.push(...historySuggestions);
    }

    // 从文档标题获取建议
    if (opts.includeDocuments) {
      const prefixResults = this.searchIndex.searchPrefix(prefix);
      for (const result of prefixResults.slice(0, 5)) {
        if (result.document) {
          suggestions.push({
            text: result.document.title ?? '',
            type: 'document',
            score: result.score,
            documentId: result.id,
          });
        }
      }
    }

    // 按分数排序并去重
    const seen = new Set<string>();
    return suggestions
      .filter((s) => {
        const key = `${s.type}:${s.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit);
  }

  // ================================
  // Diff Operations
  // ================================

  /**
   * 计算差分
   */
  async computeDiff(
    source: string,
    target: string,
    options: DiffOptions = {}
  ): Promise<TextDiffResult> {
    this.ensureInitialized();

    const opts = { ...DEFAULT_DIFF_OPTIONS, ...options };
    const dataSize = source.length + target.length;

    // 尝试从缓存获取
    if (opts.useCache && this.diffCache) {
      const cached = this.diffCache.getTextDiff(source, target);
      if (cached) {
        this.updateState({ cacheHits: this.state.cacheHits + 1 });
        this.emitEvent({ type: 'CACHE_HIT', timestamp: Date.now() });
        return cached.result;
      }
      this.updateState({ cacheMisses: this.state.cacheMisses + 1 });
      this.emitEvent({ type: 'CACHE_MISS', timestamp: Date.now() });
    }

    let result: TextDiffResult;

    // 根据数据大小和配置选择计算方式
    if (opts.useWorker && this.asyncDiffEngine && dataSize > this.config.workerThreshold) {
      // AsyncDiffEngine.diff 只接受 source 和 target 两个参数
      result = await this.asyncDiffEngine.diff(source, target);
    } else if (this.asyncDiffEngine) {
      result = this.asyncDiffEngine.diffSync(source, target);
    } else {
      // 降级到同步计算
      result = this.computeDiffSync(source, target);
    }

    // 存入缓存
    if (opts.useCache && this.diffCache) {
      const stats = this.computeStatsFromResult(result);
      this.diffCache.setTextDiff(source, target, result, stats);
    }

    return result;
  }

  /**
   * 计算差分统计
   */
  async computeDiffStats(source: string, target: string): Promise<DiffStats> {
    const result = await this.computeDiff(source, target, { useCache: true });
    return this.computeStatsFromResult(result);
  }

  /**
   * 判断是否应该使用增量保存
   */
  async shouldUseIncremental(source: string, target: string): Promise<boolean> {
    const stats = await this.computeDiffStats(source, target);
    // 如果变化率小于 50%，建议使用增量保存
    return stats.changeRatio < 0.5;
  }

  // ================================
  // Persistence Operations
  // ================================

  /**
   * 持久化索引
   */
  async persistIndex(): Promise<void> {
    if (!this.searchIndex || !this.indexStorage) {
      return;
    }

    try {
      const exportedData = this.searchIndex.export();
      await this.indexStorage.save(INDEX_STORAGE_KEY, exportedData);

      this.needsPersist = false;
      this.updateState({ lastPersistAt: new Date() });

      this.emitEvent({ type: 'INDEX_PERSISTED', timestamp: Date.now() });
      this.log('Index persisted successfully');
    } catch (error) {
      this.log('Failed to persist index:', error);
      this.emitEvent({
        type: 'ERROR',
        timestamp: Date.now(),
        error: `Failed to persist index: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * 加载索引
   */
  async loadIndex(): Promise<boolean> {
    if (!this.searchIndex || !this.indexStorage) {
      return false;
    }

    try {
      const data = await this.indexStorage.load(INDEX_STORAGE_KEY);
      if (data) {
        this.searchIndex.import(data as ReturnType<SearchIndex['export']>);

        this.updateState({
          indexedDocumentCount: this.searchIndex.getStats().documentCount,
          lastIndexUpdateAt: new Date(),
        });

        this.emitEvent({ type: 'INDEX_LOADED', timestamp: Date.now() });
        this.log('Index loaded successfully');
        return true;
      }
    } catch (error) {
      this.log('Failed to load index:', error);
    }

    return false;
  }

  // ================================
  // Cache Operations
  // ================================

  /**
   * 清空差分缓存
   */
  clearDiffCache(): void {
    if (this.diffCache) {
      this.diffCache.clear();
    }
  }

  /**
   * 获取差分缓存统计
   */
  getDiffCacheStats(): { hits: number; misses: number; size: number } {
    if (!this.diffCache) {
      return { hits: 0, misses: 0, size: 0 };
    }

    const stats = this.diffCache.getStats();
    return {
      hits: stats.textHits,
      misses: stats.textMisses,
      size: stats.entryCount,
    };
  }

  // ================================
  // Private Helpers
  // ================================

  private ensureInitialized(): void {
    if (!this.state.isInitialized) {
      throw new Error('WritingService is not initialized. Call initialize() first.');
    }
    if (this.isDestroyed) {
      throw new Error('WritingService has been destroyed');
    }
  }

  private updateState(updates: Partial<WritingServiceState>): void {
    this.state = { ...this.state, ...updates };
  }

  private emitEvent(event: WritingServiceEvent): void {
    if (this.isDestroyed) return;

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[WritingService] Event listener error:', error);
      }
    }
  }

  private schedulePersist(): void {
    if (!this.config.enableIndexPersistence || !this.indexStorage) {
      return;
    }

    this.needsPersist = true;

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistIndex();
    }, PERSIST_DEBOUNCE_MS);
  }

  private persistIndexSync(): void {
    if (!this.searchIndex || !this.indexStorage) return;

    try {
      const exportedData = this.searchIndex.export();
      // 使用同步方式保存（在 destroy 时使用）
      this.indexStorage.save(INDEX_STORAGE_KEY, exportedData).catch((error) => {
        console.error('[WritingService] Failed to persist index on destroy:', error);
      });
    } catch (error) {
      console.error('[WritingService] Failed to export index on destroy:', error);
    }
  }

  private addToSearchHistory(query: string): void {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return;

    // 移除重复项
    const index = this.searchHistory.indexOf(normalized);
    if (index !== -1) {
      this.searchHistory.splice(index, 1);
    }

    // 添加到开头
    this.searchHistory.unshift(normalized);

    // 限制大小
    if (this.searchHistory.length > this.maxHistorySize) {
      this.searchHistory.pop();
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private computeDiffSync(source: string, target: string): TextDiffResult {
    // 简化的同步差分计算（作为降级方案）
    const startTime = performance.now();

    if (source === target) {
      return {
        diffs: source ? [[0 as const, source] as const] : [],
        sourceLength: source.length,
        targetLength: target.length,
        computeTimeMs: performance.now() - startTime,
        algorithm: 'dmp',
      };
    }

    // 计算公共前缀和后缀
    let commonPrefixLength = 0;
    const minLength = Math.min(source.length, target.length);
    while (
      commonPrefixLength < minLength &&
      source[commonPrefixLength] === target[commonPrefixLength]
    ) {
      commonPrefixLength++;
    }

    let commonSuffixLength = 0;
    while (
      commonSuffixLength < minLength - commonPrefixLength &&
      source[source.length - 1 - commonSuffixLength] ===
        target[target.length - 1 - commonSuffixLength]
    ) {
      commonSuffixLength++;
    }

    // 使用 DiffOpType 常量来确保类型正确
    const EQUAL = 0 as const;
    const DELETE = -1 as const;
    const INSERT = 1 as const;
    const diffs: Array<readonly [typeof DELETE | typeof EQUAL | typeof INSERT, string]> = [];

    if (commonPrefixLength > 0) {
      diffs.push([EQUAL, source.substring(0, commonPrefixLength)]);
    }

    const sourceMiddle = source.substring(commonPrefixLength, source.length - commonSuffixLength);
    const targetMiddle = target.substring(commonPrefixLength, target.length - commonSuffixLength);

    if (sourceMiddle) {
      diffs.push([DELETE, sourceMiddle]);
    }
    if (targetMiddle) {
      diffs.push([INSERT, targetMiddle]);
    }

    if (commonSuffixLength > 0) {
      diffs.push([EQUAL, source.substring(source.length - commonSuffixLength)]);
    }

    return {
      diffs,
      sourceLength: source.length,
      targetLength: target.length,
      computeTimeMs: performance.now() - startTime,
      algorithm: 'dmp',
    };
  }

  private computeStatsFromResult(result: TextDiffResult): DiffStats {
    let insertions = 0;
    let deletions = 0;
    let unchanged = 0;

    for (const [op, text] of result.diffs) {
      switch (op) {
        case 1:
          insertions += text.length;
          break;
        case -1:
          deletions += text.length;
          break;
        case 0:
          unchanged += text.length;
          break;
      }
    }

    const totalChars = insertions + deletions + unchanged;
    const changeRatio = totalChars > 0 ? (insertions + deletions) / totalChars : 0;

    return {
      insertions,
      deletions,
      unchanged,
      totalChars,
      changeRatio,
      levenshtein: insertions + deletions,
    };
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[WritingService]', ...args);
    }
  }
}

// ================================
// Factory Functions
// ================================

/**
 * 创建写作服务实例
 */
export function createWritingService(config?: WritingServiceConfig): WritingService {
  return new WritingService(config);
}

/**
 * 创建高性能写作服务
 */
export function createHighPerformanceWritingService(): WritingService {
  return new WritingService({
    enableSearchIndex: true,
    enableDiffCache: true,
    enableWorker: true,
    enableIndexPersistence: true,
    diffCacheMaxSize: 1000,
    diffCacheTTL: 10 * 60 * 1000, // 10 minutes
    workerThreshold: 10 * 1024, // 10KB
    debug: false,
  });
}

/**
 * 创建轻量级写作服务
 */
export function createLightweightWritingService(): WritingService {
  return new WritingService({
    enableSearchIndex: true,
    enableDiffCache: true,
    enableWorker: false,
    enableIndexPersistence: false,
    diffCacheMaxSize: 100,
    diffCacheTTL: 60 * 1000, // 1 minute
    workerThreshold: 100 * 1024, // 100KB
    debug: false,
  });
}

// ================================
// Singleton Instance
// ================================

let defaultService: WritingService | null = null;

/**
 * 获取默认写作服务实例
 */
export async function getDefaultWritingService(): Promise<WritingService> {
  if (!defaultService) {
    defaultService = createWritingService();
    await defaultService.initialize();
  }
  return defaultService;
}

/**
 * 重置默认写作服务
 */
export function resetDefaultWritingService(): void {
  if (defaultService) {
    defaultService.destroy();
    defaultService = null;
  }
}
