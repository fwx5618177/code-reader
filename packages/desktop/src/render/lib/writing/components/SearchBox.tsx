// ================================
// SearchBox 组件
// 可复用的搜索框组件，支持建议和高亮
// ================================

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useDocumentSearch } from '../useWritingService';
import type { DocumentSearchResult, SearchSuggestion, DocumentSearchOptions } from '../types';
import styles from './SearchBox.module.scss';

// ================================
// 类型定义
// ================================

export interface SearchBoxProps {
  /** 占位符文本 */
  placeholder?: string;
  /** 初始查询值 */
  initialQuery?: string;
  /** 搜索选项 */
  searchOptions?: DocumentSearchOptions;
  /** 是否自动聚焦 */
  autoFocus?: boolean;
  /** 是否显示建议 */
  showSuggestions?: boolean;
  /** 最大建议数量 */
  maxSuggestions?: number;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 是否禁用 */
  disabled?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 搜索结果回调 */
  onResults?: (results: DocumentSearchResult[]) => void;
  /** 选择结果回调 */
  onSelect?: (result: DocumentSearchResult) => void;
  /** 选择建议回调 */
  onSuggestionSelect?: (suggestion: SearchSuggestion) => void;
  /** 查询变更回调 */
  onQueryChange?: (query: string) => void;
  /** 清除回调 */
  onClear?: () => void;
  /** 聚焦回调 */
  onFocus?: () => void;
  /** 失焦回调 */
  onBlur?: () => void;
  /** 回车键回调 */
  onEnter?: (query: string) => void;
}

export interface SearchBoxHandle {
  /** 聚焦输入框 */
  focus: () => void;
  /** 失焦输入框 */
  blur: () => void;
  /** 清除查询 */
  clear: () => void;
  /** 设置查询 */
  setQuery: (query: string) => void;
  /** 获取当前查询 */
  getQuery: () => string;
}

// ================================
// SVG 图标组件
// ================================

/** 搜索图标 */
const SearchIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

/** 清除图标 */
const ClearIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

/** 加载中图标 */
const SpinnerIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={styles.spinner}
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

// ================================
// 高亮文本组件
// ================================

interface HighlightedTextProps {
  text: string;
  query: string;
}

/** 转义正则表达式特殊字符 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 高亮匹配文本 */
const HighlightedText: React.FC<HighlightedTextProps> = ({ text, query }) => {
  if (!query.trim()) {
    return <>{text}</>;
  }

  const parts = useMemo(() => {
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    return text.split(regex);
  }, [text, query]);

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={index} className={styles.highlight}>
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
};

// ================================
// SearchBox 组件
// ================================

export const SearchBox = forwardRef<SearchBoxHandle, SearchBoxProps>(
  (
    {
      placeholder = '搜索...',
      initialQuery = '',
      searchOptions,
      autoFocus = false,
      showSuggestions = true,
      maxSuggestions = 5,
      disabled = false,
      className = '',
      onResults,
      onSelect,
      onSuggestionSelect,
      onQueryChange,
      onClear,
      onFocus,
      onBlur,
      onEnter,
    },
    ref
  ) => {
    // 状态
    const [isFocused, setIsFocused] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [hoveredIndex, setHoveredIndex] = useState(-1);

    // 引用
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 使用文档搜索 Hook
    const { query, setQuery, results, suggestions, isSearching, isInitialized } =
      useDocumentSearch(searchOptions);

    // 初始化查询
    useEffect(() => {
      if (initialQuery && initialQuery !== query) {
        setQuery(initialQuery);
      }
    }, [initialQuery, query, setQuery]);

    // 通知父组件搜索结果变更
    useEffect(() => {
      onResults?.(results);
    }, [results, onResults]);

    // 合并列表项用于键盘导航
    const combinedItems = useMemo(() => {
      const items: Array<{
        type: 'suggestion' | 'result';
        data: SearchSuggestion | DocumentSearchResult;
      }> = [];

      if (showSuggestions) {
        suggestions.slice(0, maxSuggestions).forEach((s) => {
          items.push({ type: 'suggestion', data: s });
        });
      }

      results.forEach((r) => {
        items.push({ type: 'result', data: r });
      });

      return items;
    }, [suggestions, results, showSuggestions, maxSuggestions]);

    // 暴露命令式方法
    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      clear: () => {
        setQuery('');
        onClear?.();
      },
      setQuery: (newQuery: string) => setQuery(newQuery),
      getQuery: () => query,
    }));

    // 输入变更处理
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newQuery = e.target.value;
        setQuery(newQuery);
        onQueryChange?.(newQuery);
        setIsOpen(true);
        setHoveredIndex(-1);
      },
      [setQuery, onQueryChange]
    );

    // 聚焦处理
    const handleFocus = useCallback(() => {
      setIsFocused(true);
      setIsOpen(true);
      onFocus?.();
    }, [onFocus]);

    // 失焦处理
    const handleBlur = useCallback(() => {
      setIsFocused(false);
      // 延迟关闭以允许点击下拉项
      setTimeout(() => setIsOpen(false), 150);
      onBlur?.();
    }, [onBlur]);

    // 清除处理
    const handleClear = useCallback(() => {
      setQuery('');
      inputRef.current?.focus();
      onClear?.();
    }, [setQuery, onClear]);

    // 键盘事件处理
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (!isOpen || combinedItems.length === 0) {
          if (e.key === 'Enter') {
            onEnter?.(query);
          }
          return;
        }

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setHoveredIndex((prev) => (prev < combinedItems.length - 1 ? prev + 1 : 0));
            break;
          case 'ArrowUp':
            e.preventDefault();
            setHoveredIndex((prev) => (prev > 0 ? prev - 1 : combinedItems.length - 1));
            break;
          case 'Enter':
            e.preventDefault();
            if (hoveredIndex >= 0 && hoveredIndex < combinedItems.length) {
              const item = combinedItems[hoveredIndex];
              if (item.type === 'suggestion') {
                onSuggestionSelect?.(item.data as SearchSuggestion);
                setQuery((item.data as SearchSuggestion).text);
              } else {
                onSelect?.(item.data as DocumentSearchResult);
              }
              setIsOpen(false);
            } else {
              onEnter?.(query);
            }
            break;
          case 'Escape':
            e.preventDefault();
            setIsOpen(false);
            inputRef.current?.blur();
            break;
        }
      },
      [isOpen, combinedItems, hoveredIndex, query, onEnter, onSelect, onSuggestionSelect, setQuery]
    );

    // 点击建议处理
    const handleSuggestionClick = useCallback(
      (suggestion: SearchSuggestion) => {
        setQuery(suggestion.text);
        onSuggestionSelect?.(suggestion);
        setIsOpen(false);
        inputRef.current?.focus();
      },
      [setQuery, onSuggestionSelect]
    );

    // 点击结果处理
    const handleResultClick = useCallback(
      (result: DocumentSearchResult) => {
        onSelect?.(result);
        setIsOpen(false);
      },
      [onSelect]
    );

    // 点击外部关闭下拉
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsOpen(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 自动聚焦
    useEffect(() => {
      if (autoFocus && inputRef.current) {
        inputRef.current.focus();
      }
    }, [autoFocus]);

    // 判断是否显示下拉
    const shouldShowDropdown = isOpen && query.trim().length > 0 && isInitialized;
    const hasSuggestions = showSuggestions && suggestions.length > 0;
    const hasResults = results.length > 0;

    // 计算输入框包装器的类名
    const inputWrapperClassName = [
      styles.inputWrapper,
      isFocused && styles.focused,
      disabled && styles.disabled,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div ref={containerRef} className={`${styles.container} ${className}`}>
        {/* 输入框包装器 */}
        <div className={inputWrapperClassName}>
          <span className={styles.searchIcon}>
            <SearchIcon />
          </span>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={styles.input}
            aria-label="搜索"
            aria-autocomplete="list"
            aria-expanded={shouldShowDropdown}
            autoComplete="off"
          />

          {isSearching ? (
            <span className={styles.searchIcon}>
              <SpinnerIcon />
            </span>
          ) : query.length > 0 ? (
            <button
              type="button"
              onClick={handleClear}
              className={styles.clearButton}
              aria-label="清除搜索"
              tabIndex={-1}
            >
              <ClearIcon />
            </button>
          ) : null}
        </div>

        {/* 下拉菜单 */}
        {shouldShowDropdown && (hasSuggestions || hasResults) && (
          <div className={styles.dropdown} role="listbox">
            {/* 建议区域 */}
            {hasSuggestions && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>建议</div>
                {suggestions.slice(0, maxSuggestions).map((suggestion, index) => {
                  const itemClassName = [styles.item, hoveredIndex === index && styles.hovered]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <div
                      key={`suggestion-${index}`}
                      className={itemClassName}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(-1)}
                      onClick={() => handleSuggestionClick(suggestion)}
                      role="option"
                      aria-selected={hoveredIndex === index}
                    >
                      <div className={styles.suggestionItem}>
                        <span className={styles.suggestionText}>
                          <HighlightedText text={suggestion.text} query={query} />
                        </span>
                        <span className={styles.suggestionType}>{suggestion.type}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 结果区域 */}
            {hasResults && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>结果</div>
                {results.map((result, index) => {
                  const itemIndex = hasSuggestions
                    ? suggestions.slice(0, maxSuggestions).length + index
                    : index;

                  const itemClassName = [styles.item, hoveredIndex === itemIndex && styles.hovered]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <div
                      key={`result-${result.documentId}`}
                      className={itemClassName}
                      onMouseEnter={() => setHoveredIndex(itemIndex)}
                      onMouseLeave={() => setHoveredIndex(-1)}
                      onClick={() => handleResultClick(result)}
                      role="option"
                      aria-selected={hoveredIndex === itemIndex}
                    >
                      <div className={styles.resultItem}>
                        <div className={styles.resultTitle}>
                          <HighlightedText text={result.title || result.documentId} query={query} />
                        </div>
                        {result.snippet && (
                          <div className={styles.resultSnippet}>
                            <HighlightedText text={result.snippet} query={query} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 无结果提示 */}
            {!hasSuggestions && !hasResults && !isSearching && (
              <div className={styles.noResults}>未找到 "{query}" 的相关结果</div>
            )}
          </div>
        )}
      </div>
    );
  }
);

SearchBox.displayName = 'SearchBox';

export default SearchBox;
