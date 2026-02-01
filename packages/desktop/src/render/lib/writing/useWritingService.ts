// ================================
// useWritingService Hook
// React Hook for Writing Service Integration
// ================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { WritingService, createWritingService, getDefaultWritingService } from './writing-service';
import type {
  WritingServiceConfig,
  WritingServiceState,
  WritingServiceEvent,
  IndexableDocument,
  DocumentSearchResult,
  SearchSuggestion,
  DocumentSearchOptions,
  SuggestionOptions,
  DiffOptions,
} from './types';
import type { TextDiffResult, DiffStats } from '@code-reader/diff-algorithm';

// ================================
// Hook Configuration
// ================================

export interface UseWritingServiceConfig extends WritingServiceConfig {
  /** 是否使用全局单例实例 */
  useGlobal?: boolean;
  /** 初始化时是否自动索引文档 */
  initialDocuments?: readonly IndexableDocument[];
  /** 状态变更回调 */
  onStateChange?: (state: WritingServiceState) => void;
  /** 事件回调 */
  onEvent?: (event: WritingServiceEvent) => void;
}

// ================================
// Hook Return Type
// ================================

export interface UseWritingServiceReturn {
  // 状态
  state: WritingServiceState;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  // 索引操作
  indexDocument: (doc: IndexableDocument) => Promise<void>;
  indexDocuments: (docs: readonly IndexableDocument[]) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  updateDocument: (doc: IndexableDocument) => Promise<void>;
  clearIndex: () => Promise<void>;

  // 搜索操作
  search: (query: string, options?: DocumentSearchOptions) => Promise<DocumentSearchResult[]>;
  suggest: (prefix: string, options?: SuggestionOptions) => Promise<SearchSuggestion[]>;

  // 差分操作
  computeDiff: (source: string, target: string, options?: DiffOptions) => Promise<TextDiffResult>;
  computeDiffStats: (source: string, target: string) => Promise<DiffStats>;
  shouldUseIncremental: (source: string, target: string) => Promise<boolean>;

  // 持久化
  persistIndex: () => Promise<void>;
  loadIndex: () => Promise<boolean>;

  // 缓存
  clearDiffCache: () => void;
  getDiffCacheStats: () => { hits: number; misses: number; size: number };

  // 服务实例（高级用法）
  service: WritingService | null;
}

// ================================
// Hook Implementation
// ================================

/**
 * useWritingService Hook
 *
 * 提供写作服务的 React 集成：
 * - 自动初始化和清理
 * - 状态同步到 React
 * - 事件监听
 * - 错误处理
 *
 * 使用示例：
 * ```tsx
 * function MyEditor() {
 *   const { search, suggest, computeDiff, isInitialized } = useWritingService();
 *
 *   const handleSearch = async (query: string) => {
 *     const results = await search(query, { limit: 10, fuzzy: true });
 *     // 处理搜索结果
 *   };
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export function useWritingService(config: UseWritingServiceConfig = {}): UseWritingServiceReturn {
  const { useGlobal = true, initialDocuments, onStateChange, onEvent, ...serviceConfig } = config;

  // 状态
  const [state, setState] = useState<WritingServiceState>({
    isInitialized: false,
    indexedDocumentCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    isWorkerReady: false,
    lastIndexUpdateAt: null,
    lastPersistAt: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 服务引用
  const serviceRef = useRef<WritingService | null>(null);
  const isOwnedRef = useRef(false);
  const isMountedRef = useRef(true);

  // 回调引用（避免闭包问题）
  const onStateChangeRef = useRef(onStateChange);
  const onEventRef = useRef(onEvent);
  onStateChangeRef.current = onStateChange;
  onEventRef.current = onEvent;

  // ================================
  // 初始化
  // ================================

  useEffect(() => {
    isMountedRef.current = true;

    const initService = async () => {
      try {
        setIsLoading(true);
        setError(null);

        let service: WritingService;

        if (useGlobal) {
          // 使用全局单例
          service = await getDefaultWritingService();
          isOwnedRef.current = false;
        } else {
          // 创建新实例
          service = createWritingService(serviceConfig);
          await service.initialize();
          isOwnedRef.current = true;
        }

        serviceRef.current = service;

        // 监听事件
        const unsubscribe = service.addEventListener((event) => {
          if (!isMountedRef.current) return;

          // 更新状态
          if (
            event.type === 'INITIALIZED' ||
            event.type === 'INDEX_UPDATED' ||
            event.type === 'INDEX_PERSISTED'
          ) {
            const newState = service.getState();
            setState(newState);
            onStateChangeRef.current?.(newState);
          }

          // 触发事件回调
          onEventRef.current?.(event);
        });

        // 初始化文档索引
        if (initialDocuments && initialDocuments.length > 0) {
          await service.indexDocuments(initialDocuments);
        }

        if (isMountedRef.current) {
          setState(service.getState());
          setIsLoading(false);
        }

        return () => {
          unsubscribe();
        };
      } catch (err) {
        if (isMountedRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
        return undefined;
      }
    };

    const cleanupPromise = initService();

    return () => {
      isMountedRef.current = false;

      // 清理
      cleanupPromise.then((cleanup) => cleanup?.());

      // 如果是自己创建的实例，销毁它
      if (isOwnedRef.current && serviceRef.current) {
        serviceRef.current.destroy();
        serviceRef.current = null;
      }
    };
  }, [useGlobal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ================================
  // 索引操作
  // ================================

  const indexDocument = useCallback(async (doc: IndexableDocument): Promise<void> => {
    if (!serviceRef.current) {
      throw new Error('WritingService is not initialized');
    }
    await serviceRef.current.indexDocument(doc);
    if (isMountedRef.current) {
      setState(serviceRef.current.getState());
    }
  }, []);

  const indexDocuments = useCallback(async (docs: readonly IndexableDocument[]): Promise<void> => {
    if (!serviceRef.current) {
      throw new Error('WritingService is not initialized');
    }
    await serviceRef.current.indexDocuments(docs);
    if (isMountedRef.current) {
      setState(serviceRef.current.getState());
    }
  }, []);

  const removeDocument = useCallback(async (id: string): Promise<void> => {
    if (!serviceRef.current) {
      throw new Error('WritingService is not initialized');
    }
    await serviceRef.current.removeDocument(id);
    if (isMountedRef.current) {
      setState(serviceRef.current.getState());
    }
  }, []);

  const updateDocument = useCallback(async (doc: IndexableDocument): Promise<void> => {
    if (!serviceRef.current) {
      throw new Error('WritingService is not initialized');
    }
    await serviceRef.current.updateDocument(doc);
    if (isMountedRef.current) {
      setState(serviceRef.current.getState());
    }
  }, []);

  const clearIndex = useCallback(async (): Promise<void> => {
    if (!serviceRef.current) {
      throw new Error('WritingService is not initialized');
    }
    await serviceRef.current.clearIndex();
    if (isMountedRef.current) {
      setState(serviceRef.current.getState());
    }
  }, []);

  // ================================
  // 搜索操作
  // ================================

  const search = useCallback(
    async (query: string, options?: DocumentSearchOptions): Promise<DocumentSearchResult[]> => {
      if (!serviceRef.current) {
        return [];
      }
      return serviceRef.current.search(query, options);
    },
    []
  );

  const suggest = useCallback(
    async (prefix: string, options?: SuggestionOptions): Promise<SearchSuggestion[]> => {
      if (!serviceRef.current) {
        return [];
      }
      return serviceRef.current.suggest(prefix, options);
    },
    []
  );

  // ================================
  // 差分操作
  // ================================

  const computeDiff = useCallback(
    async (source: string, target: string, options?: DiffOptions): Promise<TextDiffResult> => {
      if (!serviceRef.current) {
        throw new Error('WritingService is not initialized');
      }
      const result = await serviceRef.current.computeDiff(source, target, options);
      if (isMountedRef.current) {
        setState(serviceRef.current.getState());
      }
      return result;
    },
    []
  );

  const computeDiffStats = useCallback(
    async (source: string, target: string): Promise<DiffStats> => {
      if (!serviceRef.current) {
        throw new Error('WritingService is not initialized');
      }
      return serviceRef.current.computeDiffStats(source, target);
    },
    []
  );

  const shouldUseIncremental = useCallback(
    async (source: string, target: string): Promise<boolean> => {
      if (!serviceRef.current) {
        return false;
      }
      return serviceRef.current.shouldUseIncremental(source, target);
    },
    []
  );

  // ================================
  // 持久化操作
  // ================================

  const persistIndex = useCallback(async (): Promise<void> => {
    if (!serviceRef.current) {
      return;
    }
    await serviceRef.current.persistIndex();
    if (isMountedRef.current) {
      setState(serviceRef.current.getState());
    }
  }, []);

  const loadIndex = useCallback(async (): Promise<boolean> => {
    if (!serviceRef.current) {
      return false;
    }
    const success = await serviceRef.current.loadIndex();
    if (isMountedRef.current) {
      setState(serviceRef.current.getState());
    }
    return success;
  }, []);

  // ================================
  // 缓存操作
  // ================================

  const clearDiffCache = useCallback((): void => {
    if (!serviceRef.current) {
      return;
    }
    serviceRef.current.clearDiffCache();
  }, []);

  const getDiffCacheStats = useCallback((): { hits: number; misses: number; size: number } => {
    if (!serviceRef.current) {
      return { hits: 0, misses: 0, size: 0 };
    }
    return serviceRef.current.getDiffCacheStats();
  }, []);

  // ================================
  // 返回值
  // ================================

  return useMemo(
    () => ({
      // 状态
      state,
      isInitialized: state.isInitialized,
      isLoading,
      error,

      // 索引操作
      indexDocument,
      indexDocuments,
      removeDocument,
      updateDocument,
      clearIndex,

      // 搜索操作
      search,
      suggest,

      // 差分操作
      computeDiff,
      computeDiffStats,
      shouldUseIncremental,

      // 持久化
      persistIndex,
      loadIndex,

      // 缓存
      clearDiffCache,
      getDiffCacheStats,

      // 服务实例
      service: serviceRef.current,
    }),
    [
      state,
      isLoading,
      error,
      indexDocument,
      indexDocuments,
      removeDocument,
      updateDocument,
      clearIndex,
      search,
      suggest,
      computeDiff,
      computeDiffStats,
      shouldUseIncremental,
      persistIndex,
      loadIndex,
      clearDiffCache,
      getDiffCacheStats,
    ]
  );
}

// ================================
// Convenience Hooks
// ================================

/**
 * 简化的搜索 Hook
 */
export function useDocumentSearch(options?: DocumentSearchOptions) {
  const { search, suggest, isInitialized, isLoading, error } = useWritingService();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocumentSearchResult[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 防抖搜索
  const debouncedSearch = useCallback(
    async (searchQuery: string) => {
      if (!isInitialized || !searchQuery.trim()) {
        setResults([]);
        setSuggestions([]);
        return;
      }

      setIsSearching(true);

      try {
        const [searchResults, searchSuggestions] = await Promise.all([
          search(searchQuery, options),
          suggest(searchQuery, { limit: 5 }),
        ]);

        setResults(searchResults);
        setSuggestions(searchSuggestions);
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    },
    [isInitialized, search, suggest, options]
  );

  // 更新查询
  const updateQuery = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);

      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }

      searchTimerRef.current = setTimeout(() => {
        debouncedSearch(newQuery);
      }, 200);
    },
    [debouncedSearch]
  );

  // 清理
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  return {
    query,
    setQuery: updateQuery,
    results,
    suggestions,
    isSearching,
    isLoading,
    error,
    isInitialized,
  };
}

/**
 * 简化的差分 Hook
 */
export function useContentDiff() {
  const { computeDiff, computeDiffStats, shouldUseIncremental, isInitialized } =
    useWritingService();

  const [lastDiff, setLastDiff] = useState<TextDiffResult | null>(null);
  const [lastStats, setLastStats] = useState<DiffStats | null>(null);
  const [isComputing, setIsComputing] = useState(false);

  const compare = useCallback(
    async (source: string, target: string, options?: DiffOptions) => {
      if (!isInitialized) {
        return null;
      }

      setIsComputing(true);

      try {
        const [diff, stats] = await Promise.all([
          computeDiff(source, target, options),
          computeDiffStats(source, target),
        ]);

        setLastDiff(diff);
        setLastStats(stats);

        return { diff, stats };
      } catch (err) {
        console.error('Diff error:', err);
        return null;
      } finally {
        setIsComputing(false);
      }
    },
    [isInitialized, computeDiff, computeDiffStats]
  );

  return {
    compare,
    shouldUseIncremental,
    lastDiff,
    lastStats,
    isComputing,
    isInitialized,
  };
}
