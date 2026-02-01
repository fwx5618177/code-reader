// ================================
// useEditorSearch Hook
// RichEditor 集成 Hook - 实时搜索和高亮
// 提供编辑器内搜索、跨文档搜索、搜索替换功能
// ================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchHighlight, type SearchHighlightOptions } from './useSearchHighlight';
import { useWritingService } from '../useWritingService';
import type { DocumentSearchResult, DocumentSearchOptions } from '../types';

// ================================
// 类型定义
// ================================

/**
 * 编辑器搜索模式
 * - local: 仅本地搜索（当前文档内）
 * - global: 仅全局搜索（跨文档）
 * - both: 同时进行本地和全局搜索
 */
export type EditorSearchMode = 'local' | 'global' | 'both';

/**
 * 搜索匹配信息
 */
export interface EditorSearchMatch {
  /** 匹配索引 */
  readonly index: number;
  /** 起始位置 */
  readonly start: number;
  /** 结束位置 */
  readonly end: number;
  /** 匹配文本 */
  readonly text: string;
  /** 是否为当前活跃匹配 */
  readonly isActive: boolean;
  /** 匹配所在行号（从 1 开始） */
  readonly lineNumber: number;
  /** 匹配所在列号（从 1 开始） */
  readonly column: number;
}

/**
 * 全局搜索结果
 */
export interface GlobalSearchResult extends DocumentSearchResult {
  /** 是否为当前文档 */
  readonly isCurrentDocument: boolean;
}

/**
 * Hook 配置
 */
export interface UseEditorSearchConfig {
  /** 当前文档 ID */
  documentId?: string;
  /** 搜索模式 */
  mode?: EditorSearchMode;
  /** 本地搜索选项 */
  localSearchOptions?: SearchHighlightOptions;
  /** 全局搜索选项 */
  globalSearchOptions?: DocumentSearchOptions;
  /** 是否启用快捷键 */
  enableShortcuts?: boolean;
  /** 搜索变化回调 */
  onSearchChange?: (query: string, matchCount: number) => void;
  /** 活跃匹配变化回调 */
  onActiveMatchChange?: (match: EditorSearchMatch | null) => void;
  /** 全局结果选择回调 */
  onGlobalResultSelect?: (result: GlobalSearchResult) => void;
}

/**
 * Hook 返回值
 */
export interface UseEditorSearchReturn {
  // 搜索状态
  /** 搜索查询 */
  query: string;
  /** 设置搜索查询 */
  setQuery: (query: string) => void;
  /** 搜索面板是否打开 */
  isOpen: boolean;
  /** 打开搜索面板 */
  open: () => void;
  /** 关闭搜索面板 */
  close: () => void;
  /** 切换搜索面板 */
  toggle: () => void;

  // 本地搜索（当前文档内）
  /** 本地匹配列表 */
  localMatches: readonly EditorSearchMatch[];
  /** 当前活跃的本地匹配 */
  activeLocalMatch: EditorSearchMatch | null;
  /** 本地匹配数量 */
  localMatchCount: number;
  /** 跳转到下一个本地匹配 */
  goToNextLocal: () => void;
  /** 跳转到上一个本地匹配 */
  goToPreviousLocal: () => void;
  /** 跳转到指定的本地匹配 */
  goToLocalMatch: (index: number) => void;

  // 全局搜索（跨文档）
  /** 全局搜索结果 */
  globalResults: readonly GlobalSearchResult[];
  /** 是否正在全局搜索 */
  isSearchingGlobal: boolean;
  /** 全局结果数量 */
  globalResultCount: number;
  /** 选择全局搜索结果 */
  selectGlobalResult: (result: GlobalSearchResult) => void;

  // 替换功能
  /** 替换文本 */
  replacement: string;
  /** 设置替换文本 */
  setReplacement: (text: string) => void;
  /** 替换当前活跃匹配 */
  replaceActive: () => string | null;
  /** 替换所有匹配 */
  replaceAll: () => string;

  // 搜索选项
  /** 是否区分大小写 */
  caseSensitive: boolean;
  /** 设置是否区分大小写 */
  setCaseSensitive: (value: boolean) => void;
  /** 是否全词匹配 */
  wholeWord: boolean;
  /** 设置是否全词匹配 */
  setWholeWord: (value: boolean) => void;
  /** 是否使用正则表达式 */
  useRegex: boolean;
  /** 设置是否使用正则表达式 */
  setUseRegex: (value: boolean) => void;

  // 高亮相关
  /** 获取带高亮标记的内容 */
  getHighlightedContent: () => string;
  /** 获取编辑器装饰配置 */
  getHighlightDecorations: () => Array<{
    from: number;
    to: number;
    class: string;
  }>;

  // 清理
  /** 清除搜索 */
  clear: () => void;
  /** 清除并关闭 */
  clearAndClose: () => void;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<
  Omit<
    UseEditorSearchConfig,
    'documentId' | 'onSearchChange' | 'onActiveMatchChange' | 'onGlobalResultSelect'
  >
> = {
  mode: 'both',
  localSearchOptions: {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    maxMatches: 10000,
    realtime: true,
    debounceMs: 100,
  },
  globalSearchOptions: {
    limit: 20,
    fuzzy: false,
    highlight: true,
    snippetLength: 100,
  },
  enableShortcuts: true,
};

// ================================
// 辅助函数
// ================================

/**
 * 计算位置对应的行号和列号
 * @param content - 文本内容
 * @param position - 字符位置
 * @returns 行号和列号（从 1 开始）
 */
function getLineAndColumn(content: string, position: number): { line: number; column: number } {
  const lines = content.substring(0, position).split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * 将高亮范围转换为编辑器匹配对象
 * @param content - 文本内容
 * @param highlights - 高亮范围列表
 * @returns 编辑器匹配对象列表
 */
function highlightsToMatches(
  content: string,
  highlights: readonly {
    start: number;
    end: number;
    text: string;
    index: number;
    isActive: boolean;
  }[]
): EditorSearchMatch[] {
  return highlights.map((h) => {
    const { line, column } = getLineAndColumn(content, h.start);
    return {
      index: h.index,
      start: h.start,
      end: h.end,
      text: h.text,
      isActive: h.isActive,
      lineNumber: line,
      column,
    };
  });
}

// ================================
// useEditorSearch Hook
// ================================

/**
 * RichEditor 搜索集成 Hook
 *
 * 提供编辑器内搜索和高亮功能：
 * - 本地搜索（当前文档内实时高亮）
 * - 全局搜索（跨所有文档搜索）
 * - 搜索和替换
 * - 快捷键支持
 * - 与 ProseMirror/CodeMirror 装饰系统兼容
 *
 * @example
 * ```tsx
 * function MyEditor({ content, documentId }) {
 *   const {
 *     query,
 *     setQuery,
 *     isOpen,
 *     toggle,
 *     localMatches,
 *     activeLocalMatch,
 *     goToNextLocal,
 *     goToPreviousLocal,
 *     getHighlightDecorations,
 *   } = useEditorSearch(content, { documentId });
 *
 *   // Apply decorations to editor
 *   useEffect(() => {
 *     if (editorView) {
 *       const decorations = getHighlightDecorations();
 *       // Apply to ProseMirror/CodeMirror
 *     }
 *   }, [getHighlightDecorations]);
 *
 *   return (
 *     <div>
 *       {isOpen && (
 *         <SearchPanel
 *           query={query}
 *           onChange={setQuery}
 *           matchCount={localMatches.length}
 *           onNext={goToNextLocal}
 *           onPrev={goToPreviousLocal}
 *         />
 *       )}
 *       <Editor />
 *     </div>
 *   );
 * }
 * ```
 */
export function useEditorSearch(
  content: string,
  config: UseEditorSearchConfig = {}
): UseEditorSearchReturn {
  const {
    documentId,
    mode = DEFAULT_CONFIG.mode,
    localSearchOptions = DEFAULT_CONFIG.localSearchOptions,
    globalSearchOptions = DEFAULT_CONFIG.globalSearchOptions,
    enableShortcuts = DEFAULT_CONFIG.enableShortcuts,
    onSearchChange,
    onActiveMatchChange,
    onGlobalResultSelect,
  } = config;

  // State
  const [isOpen, setIsOpen] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(localSearchOptions?.caseSensitive ?? false);
  const [wholeWord, setWholeWord] = useState(localSearchOptions?.wholeWord ?? false);
  const [useRegex, setUseRegex] = useState(localSearchOptions?.useRegex ?? false);
  const [globalResults, setGlobalResults] = useState<readonly GlobalSearchResult[]>([]);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);

  // Refs
  const contentRef = useRef(content);
  contentRef.current = content;

  // Merged search options
  const mergedLocalOptions = useMemo<SearchHighlightOptions>(
    () => ({
      ...localSearchOptions,
      caseSensitive,
      wholeWord,
      useRegex,
    }),
    [localSearchOptions, caseSensitive, wholeWord, useRegex]
  );

  // Use local search highlight
  const {
    query,
    setQuery,
    highlights,
    matchCount: localMatchCount,
    goToNext: goToNextLocal,
    goToPrevious: goToPreviousLocal,
    goToIndex: goToLocalMatch,
    clear: clearLocal,
    getHighlightedHtml,
    replaceActive: replaceActiveLocal,
    replaceAll: replaceAllLocal,
  } = useSearchHighlight(content, mergedLocalOptions);

  // Use writing service for global search
  const { search, isInitialized } = useWritingService();

  // Convert highlights to matches
  const localMatches = useMemo(
    () => highlightsToMatches(content, highlights),
    [content, highlights]
  );

  // Get active match
  const activeLocalMatch = useMemo(
    () => localMatches.find((m) => m.isActive) ?? null,
    [localMatches]
  );

  // Notify on search change
  useEffect(() => {
    onSearchChange?.(query, localMatchCount);
  }, [query, localMatchCount, onSearchChange]);

  // Notify on active match change
  useEffect(() => {
    onActiveMatchChange?.(activeLocalMatch);
  }, [activeLocalMatch, onActiveMatchChange]);

  // 全局搜索
  useEffect(() => {
    if (mode === 'local' || !query.trim() || !isInitialized) {
      setGlobalResults([]);
      return;
    }

    let cancelled = false;
    setIsSearchingGlobal(true);

    const performGlobalSearch = async () => {
      try {
        const results = await search(query, globalSearchOptions);

        if (cancelled) return;

        const globalResultsWithMeta: GlobalSearchResult[] = results.map((r) => ({
          ...r,
          isCurrentDocument: r.documentId === documentId,
        }));

        setGlobalResults(globalResultsWithMeta);
      } catch (error) {
        console.error('[useEditorSearch] 全局搜索失败:', error);
        setGlobalResults([]);
      } finally {
        if (!cancelled) {
          setIsSearchingGlobal(false);
        }
      }
    };

    // 防抖全局搜索
    const timer = setTimeout(performGlobalSearch, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode, documentId, search, isInitialized, globalSearchOptions]);

  // 面板控制
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // 全局结果选择
  const selectGlobalResult = useCallback(
    (result: GlobalSearchResult) => {
      onGlobalResultSelect?.(result);
    },
    [onGlobalResultSelect]
  );

  // 替换功能
  const replaceActive = useCallback((): string | null => {
    return replaceActiveLocal(replacement);
  }, [replaceActiveLocal, replacement]);

  const replaceAll = useCallback((): string => {
    return replaceAllLocal(content, replacement);
  }, [replaceAllLocal, content, replacement]);

  // 获取编辑器高亮装饰
  const getHighlightDecorations = useCallback(() => {
    return localMatches.map((match) => ({
      from: match.start,
      to: match.end,
      class: match.isActive ? 'search-highlight search-highlight-active' : 'search-highlight',
    }));
  }, [localMatches]);

  // 获取带高亮的内容
  const getHighlightedContent = useCallback(() => {
    return getHighlightedHtml(content);
  }, [getHighlightedHtml, content]);

  // 清理功能
  const clear = useCallback(() => {
    clearLocal();
    setReplacement('');
    setGlobalResults([]);
  }, [clearLocal]);

  const clearAndClose = useCallback(() => {
    clear();
    close();
  }, [clear, close]);

  // 键盘快捷键
  useEffect(() => {
    if (!enableShortcuts) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F: 打开搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        open();
        return;
      }

      // Escape: 关闭搜索
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        clearAndClose();
        return;
      }

      // Enter: 下一个匹配（搜索打开时）
      if (e.key === 'Enter' && isOpen && !e.shiftKey) {
        e.preventDefault();
        goToNextLocal();
        return;
      }

      // Shift + Enter: 上一个匹配
      if (e.key === 'Enter' && isOpen && e.shiftKey) {
        e.preventDefault();
        goToPreviousLocal();
        return;
      }

      // Cmd/Ctrl + G: 下一个匹配
      if ((e.metaKey || e.ctrlKey) && e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        goToNextLocal();
        return;
      }

      // Cmd/Ctrl + Shift + G: 上一个匹配
      if ((e.metaKey || e.ctrlKey) && e.key === 'g' && e.shiftKey) {
        e.preventDefault();
        goToPreviousLocal();
        return;
      }

      // Cmd/Ctrl + H: 打开替换（可扩展）
      if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
        e.preventDefault();
        open();
        // 聚焦替换输入框（需要 ref）
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enableShortcuts, isOpen, open, clearAndClose, goToNextLocal, goToPreviousLocal]);

  return {
    // 搜索状态
    query,
    setQuery,
    isOpen,
    open,
    close,
    toggle,

    // 本地搜索
    localMatches,
    activeLocalMatch,
    localMatchCount,
    goToNextLocal,
    goToPreviousLocal,
    goToLocalMatch,

    // 全局搜索
    globalResults,
    isSearchingGlobal,
    globalResultCount: globalResults.length,
    selectGlobalResult,

    // 替换
    replacement,
    setReplacement,
    replaceActive,
    replaceAll,

    // 搜索选项
    caseSensitive,
    setCaseSensitive,
    wholeWord,
    setWholeWord,
    useRegex,
    setUseRegex,

    // 高亮
    getHighlightedContent,
    getHighlightDecorations,

    // 清理
    clear,
    clearAndClose,
  };
}

export default useEditorSearch;
