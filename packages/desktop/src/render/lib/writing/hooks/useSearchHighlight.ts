// ================================
// useSearchHighlight Hook
// 实时搜索高亮 Hook，用于编辑器内容高亮
// 提供搜索、导航、替换和高亮渲染功能
// ================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ================================
// 类型定义
// ================================

/**
 * 高亮范围
 */
export interface HighlightRange {
  /** 起始位置 */
  readonly start: number;
  /** 结束位置 */
  readonly end: number;
  /** 匹配的文本 */
  readonly text: string;
  /** 匹配索引 */
  readonly index: number;
  /** 是否为当前选中的匹配 */
  readonly isActive: boolean;
}

/**
 * 搜索选项
 */
export interface SearchHighlightOptions {
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 是否全词匹配 */
  wholeWord?: boolean;
  /** 是否使用正则表达式 */
  useRegex?: boolean;
  /** 最大匹配数量 */
  maxMatches?: number;
  /** 是否启用实时搜索 */
  realtime?: boolean;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
}

/**
 * Hook 返回值
 */
export interface UseSearchHighlightReturn {
  /** 搜索查询 */
  query: string;
  /** 设置搜索查询 */
  setQuery: (query: string) => void;
  /** 高亮范围列表 */
  highlights: readonly HighlightRange[];
  /** 当前选中的匹配索引 */
  activeIndex: number;
  /** 匹配总数 */
  matchCount: number;
  /** 是否正在搜索 */
  isSearching: boolean;
  /** 跳转到下一个匹配 */
  goToNext: () => void;
  /** 跳转到上一个匹配 */
  goToPrevious: () => void;
  /** 跳转到指定匹配 */
  goToIndex: (index: number) => void;
  /** 清除搜索 */
  clear: () => void;
  /** 获取指定位置是否在高亮范围内 */
  isHighlighted: (position: number) => HighlightRange | null;
  /** 获取包含高亮标记的 HTML */
  getHighlightedHtml: (content: string) => string;
  /** 替换当前匹配 */
  replaceActive: (replacement: string) => string | null;
  /** 替换所有匹配 */
  replaceAll: (content: string, replacement: string) => string;
}

// ================================
// 默认选项
// ================================

const DEFAULT_OPTIONS: Required<SearchHighlightOptions> = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  maxMatches: 10000,
  realtime: true,
  debounceMs: 150,
};

// ================================
// 辅助函数
// ================================

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 创建搜索正则表达式
 */
function createSearchRegex(
  query: string,
  options: Required<SearchHighlightOptions>
): RegExp | null {
  if (!query) return null;

  try {
    let pattern = options.useRegex ? query : escapeRegExp(query);

    if (options.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }

    const flags = options.caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch {
    // 无效的正则表达式
    return null;
  }
}

/**
 * 查找所有匹配
 */
function findMatches(
  content: string,
  regex: RegExp,
  maxMatches: number,
  activeIndex: number
): HighlightRange[] {
  const matches: HighlightRange[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  // 重置全局正则的 lastIndex
  regex.lastIndex = 0;

  while ((match = regex.exec(content)) !== null && matches.length < maxMatches) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      index,
      isActive: index === activeIndex,
    });
    index++;

    // 防止零长度匹配导致的无限循环
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }

  return matches;
}

// ================================
// useSearchHighlight Hook 实现
// ================================

/**
 * 实时搜索高亮 Hook
 *
 * 提供在编辑器内容中搜索和高亮文本的功能：
 * - 实时搜索和高亮
 * - 支持普通文本和正则表达式
 * - 大小写敏感和全词匹配选项
 * - 导航到上一个/下一个匹配
 * - 替换单个或全部匹配
 *
 * @example
 * ```tsx
 * function Editor({ content }) {
 *   const {
 *     query,
 *     setQuery,
 *     highlights,
 *     matchCount,
 *     activeIndex,
 *     goToNext,
 *     goToPrevious,
 *     getHighlightedHtml,
 *   } = useSearchHighlight(content);
 *
 *   return (
 *     <div>
 *       <input value={query} onChange={(e) => setQuery(e.target.value)} />
 *       <span>{matchCount} matches</span>
 *       <button onClick={goToPrevious}>Previous</button>
 *       <button onClick={goToNext}>Next</button>
 *       <div dangerouslySetInnerHTML={{ __html: getHighlightedHtml(content) }} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useSearchHighlight(
  content: string,
  options: SearchHighlightOptions = {}
): UseSearchHighlightReturn {
  const opts = useMemo(() => ({ ...DEFAULT_OPTIONS, ...options }), [options]);

  // 状态
  const [query, setQueryInternal] = useState('');
  const [highlights, setHighlights] = useState<readonly HighlightRange[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  // 引用
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const queryRef = useRef(query);

  // 更新引用
  contentRef.current = content;
  queryRef.current = query;

  // 搜索函数
  const performSearch = useCallback(
    (searchQuery: string, searchContent: string) => {
      if (!searchQuery.trim()) {
        setHighlights([]);
        setActiveIndex(0);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);

      const regex = createSearchRegex(searchQuery, opts);
      if (!regex) {
        setHighlights([]);
        setActiveIndex(0);
        setIsSearching(false);
        return;
      }

      const matches = findMatches(searchContent, regex, opts.maxMatches, activeIndex);
      setHighlights(matches);

      // 如果活跃索引超出范围则调整
      if (activeIndex >= matches.length) {
        setActiveIndex(matches.length > 0 ? 0 : 0);
      }

      setIsSearching(false);
    },
    [opts, activeIndex]
  );

  // 防抖搜索
  const debouncedSearch = useCallback(
    (searchQuery: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (!opts.realtime) {
        performSearch(searchQuery, contentRef.current);
        return;
      }

      setIsSearching(true);
      debounceTimerRef.current = setTimeout(() => {
        performSearch(searchQuery, contentRef.current);
      }, opts.debounceMs);
    },
    [performSearch, opts.realtime, opts.debounceMs]
  );

  // 设置查询（带防抖）
  const setQuery = useCallback(
    (newQuery: string) => {
      setQueryInternal(newQuery);
      debouncedSearch(newQuery);
    },
    [debouncedSearch]
  );

  // 内容变化时重新搜索
  useEffect(() => {
    if (query.trim()) {
      debouncedSearch(query);
    }
  }, [content]);

  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // 活跃索引变化时更新高亮
  useEffect(() => {
    if (highlights.length > 0) {
      setHighlights((prev) =>
        prev.map((h, i) => ({
          ...h,
          isActive: i === activeIndex,
        }))
      );
    }
  }, [activeIndex]);

  // 导航
  const goToNext = useCallback(() => {
    if (highlights.length === 0) return;
    setActiveIndex((prev) => (prev + 1) % highlights.length);
  }, [highlights.length]);

  const goToPrevious = useCallback(() => {
    if (highlights.length === 0) return;
    setActiveIndex((prev) => (prev - 1 + highlights.length) % highlights.length);
  }, [highlights.length]);

  const goToIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < highlights.length) {
        setActiveIndex(index);
      }
    },
    [highlights.length]
  );

  // 清除搜索
  const clear = useCallback(() => {
    setQueryInternal('');
    setHighlights([]);
    setActiveIndex(0);
    setIsSearching(false);
  }, []);

  // 检查位置是否在高亮范围内
  const isHighlighted = useCallback(
    (position: number): HighlightRange | null => {
      for (const highlight of highlights) {
        if (position >= highlight.start && position < highlight.end) {
          return highlight;
        }
      }
      return null;
    },
    [highlights]
  );

  // 生成带高亮的 HTML
  const getHighlightedHtml = useCallback(
    (text: string): string => {
      if (highlights.length === 0 || !query.trim()) {
        return escapeHtml(text);
      }

      const parts: string[] = [];
      let lastIndex = 0;

      for (const highlight of highlights) {
        // 添加高亮前的文本
        if (highlight.start > lastIndex) {
          parts.push(escapeHtml(text.slice(lastIndex, highlight.start)));
        }

        // 添加高亮文本
        const className = highlight.isActive
          ? 'search-highlight search-highlight-active'
          : 'search-highlight';
        parts.push(
          `<mark class="${className}" data-match-index="${highlight.index}">${escapeHtml(
            highlight.text
          )}</mark>`
        );

        lastIndex = highlight.end;
      }

      // 添加剩余文本
      if (lastIndex < text.length) {
        parts.push(escapeHtml(text.slice(lastIndex)));
      }

      return parts.join('');
    },
    [highlights, query]
  );

  // 替换当前活跃匹配
  const replaceActive = useCallback(
    (replacement: string): string | null => {
      if (highlights.length === 0 || activeIndex >= highlights.length) {
        return null;
      }

      const active = highlights[activeIndex];
      const before = content.slice(0, active.start);
      const after = content.slice(active.end);

      return before + replacement + after;
    },
    [content, highlights, activeIndex]
  );

  // 替换所有匹配
  const replaceAll = useCallback(
    (text: string, replacement: string): string => {
      if (!query.trim()) return text;

      const regex = createSearchRegex(query, opts);
      if (!regex) return text;

      return text.replace(regex, replacement);
    },
    [query, opts]
  );

  return {
    query,
    setQuery,
    highlights,
    activeIndex,
    matchCount: highlights.length,
    isSearching,
    goToNext,
    goToPrevious,
    goToIndex,
    clear,
    isHighlighted,
    getHighlightedHtml,
    replaceActive,
    replaceAll,
  };
}

// ================================
// 辅助函数：HTML 转义
// ================================

function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
}

// ================================
// CSS 样式（供参考）
// ================================

/**
 * 推荐的 CSS 样式，可以添加到全局样式表或 module.scss 中：
 *
 * ```css
 * .search-highlight {
 *   background-color: rgba(255, 235, 59, 0.4);
 *   border-radius: 2px;
 *   padding: 0 1px;
 * }
 *
 * .search-highlight-active {
 *   background-color: rgba(255, 152, 0, 0.6);
 *   outline: 2px solid rgba(255, 152, 0, 0.8);
 * }
 * ```
 */
export const SEARCH_HIGHLIGHT_STYLES = `
.search-highlight {
  background-color: rgba(255, 235, 59, 0.4);
  border-radius: 2px;
  padding: 0 1px;
}

.search-highlight-active {
  background-color: rgba(255, 152, 0, 0.6);
  outline: 2px solid rgba(255, 152, 0, 0.8);
}
`;

export default useSearchHighlight;
