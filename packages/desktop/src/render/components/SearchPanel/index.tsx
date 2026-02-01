// ================================
// Search Panel Component
// Full-text search with filters and results
// ================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Filter,
  Clock,
  FileText,
  Mic,
  Image,
  Code,
  Globe,
  Bookmark,
  Tag,
  Folder,
  Calendar,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { useWritingService } from '../../lib/writing';
import styles from './SearchPanel.module.scss';

// ================================
// Types
// ================================

export interface SearchResult {
  id: string;
  title: string;
  type: 'note' | 'audio' | 'image' | 'code' | 'webpage' | 'document' | 'bookmark';
  content: string;
  highlights: string[];
  tags: string[];
  folder?: string;
  createdAt: Date;
  updatedAt: Date;
  score: number;
}

export interface SearchFilter {
  types: string[];
  tags: string[];
  folders: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  favoritesOnly: boolean;
}

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onResultSelect?: (result: SearchResult) => void;
}

// ================================
// Type Icons
// ================================

const TYPE_ICONS: Record<string, React.ReactNode> = {
  note: <FileText size={14} />,
  audio: <Mic size={14} />,
  image: <Image size={14} />,
  code: <Code size={14} />,
  webpage: <Globe size={14} />,
  document: <FileText size={14} />,
  bookmark: <Bookmark size={14} />,
};

const TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  audio: '音频',
  image: '图片',
  code: '代码',
  webpage: '网页',
  document: '文档',
  bookmark: '书签',
};

// ================================
// Search Panel Component
// ================================

const SearchPanel: React.FC<SearchPanelProps> = ({ isOpen, onClose, onResultSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [filters, setFilters] = useState<SearchFilter>({
    types: [],
    tags: [],
    folders: [],
    favoritesOnly: false,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current && results.length > 0) {
      const selectedItem = resultsRef.current.querySelector('.search-result-item.selected');
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, results]);

  // ================================
  // Writing Service
  // ================================

  const { search: searchService, isInitialized: serviceInitialized } = useWritingService();

  // ================================
  // Search Handler
  // ================================

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }

      setIsLoading(true);

      try {
        // 使用 WritingService 进行真实搜索
        if (serviceInitialized) {
          const searchResults = await searchService(searchQuery, {
            limit: 50,
            fuzzy: true,
            highlight: true,
          });

          // 将搜索结果转换为 SearchResult 格式
          const formattedResults: SearchResult[] = searchResults.map((result) => ({
            id: result.id,
            title: result.title || '无标题',
            type: 'note' as const, // 默认类型，可以根据实际数据调整
            content: result.snippet || '',
            // 将 SearchHighlight[] 转换为 string[]，使用 snippet 字段
            highlights: result.highlights?.map((h) => h.snippet || '') || [],
            tags: [], // DocumentSearchResult 没有 tags 字段
            folder: undefined, // DocumentSearchResult 没有 folderId 字段
            createdAt: new Date(), // DocumentSearchResult 没有时间字段
            updatedAt: new Date(),
            score: result.score || 0,
          }));

          // 应用本地过滤器
          let filteredResults = formattedResults;
          if (filters.types.length > 0) {
            filteredResults = filteredResults.filter((r) => filters.types.includes(r.type));
          }
          if (filters.tags.length > 0) {
            filteredResults = filteredResults.filter((r) =>
              r.tags.some((t) => filters.tags.includes(t))
            );
          }

          setResults(filteredResults);
        } else {
          // 服务未初始化时显示空结果
          setResults([]);
        }

        // 添加到搜索历史
        if (!searchHistory.includes(searchQuery)) {
          setSearchHistory((prev) => [searchQuery, ...prev].slice(0, 10));
        }
      } catch (error) {
        console.error('搜索失败:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [filters, searchHistory, searchService, serviceInitialized]
  );

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  // ================================
  // Keyboard Navigation
  // ================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex] && onResultSelect) {
            onResultSelect(results[selectedIndex]);
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, onResultSelect, onClose]
  );

  // ================================
  // Filter Toggle
  // ================================

  const toggleTypeFilter = (type: string) => {
    setFilters((prev) => ({
      ...prev,
      types: prev.types.includes(type)
        ? prev.types.filter((t) => t !== type)
        : [...prev.types, type],
    }));
  };

  // ================================
  // Render
  // ================================

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.searchPanel} onClick={(e) => e.stopPropagation()}>
        {/* Search Header */}
        <div className={styles.searchHeader}>
          <div className={styles.searchInputWrapper}>
            <Search className={styles.searchIcon} size={18} />
            <input
              ref={inputRef}
              type="text"
              className={styles.searchInput}
              placeholder="搜索笔记、文档、音频..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {query && (
              <button className={styles.clearBtn} onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
            <button
              className={`${styles.filterBtn} ${showFilters ? styles.filterBtnActive : ''}`}
              onClick={() => setShowFilters(!showFilters)}
              title="筛选"
            >
              <Filter size={16} />
            </button>
          </div>

          {/* Keyboard hints */}
          <div className={styles.keyboardHints}>
            <span className={styles.hint}>
              <ArrowUp size={12} />
              <ArrowDown size={12} />
              导航
            </span>
            <span className={styles.hint}>
              <kbd>↵</kbd> 选择
            </span>
            <span className={styles.hint}>
              <kbd>esc</kbd> 关闭
            </span>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className={styles.searchFilters}>
            <div className={styles.filterSection}>
              <label className={styles.filterLabel}>类型</label>
              <div className={styles.filterChips}>
                {Object.entries(TYPE_LABELS).map(([type, label]) => (
                  <button
                    key={type}
                    className={`${styles.filterChip} ${filters.types.includes(type) ? styles.filterChipActive : ''}`}
                    onClick={() => toggleTypeFilter(type)}
                  >
                    {TYPE_ICONS[type]}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.filterSection}>
              <label className={styles.filterLabel}>时间范围</label>
              <div className={styles.filterChips}>
                <button className={styles.filterChip}>
                  <Calendar size={14} />
                  <span>今天</span>
                </button>
                <button className={styles.filterChip}>
                  <Calendar size={14} />
                  <span>本周</span>
                </button>
                <button className={styles.filterChip}>
                  <Calendar size={14} />
                  <span>本月</span>
                </button>
              </div>
            </div>

            <div className={styles.filterActions}>
              <button
                className={styles.clearFiltersBtn}
                onClick={() =>
                  setFilters({ types: [], tags: [], folders: [], favoritesOnly: false })
                }
              >
                清除筛选
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        <div className={styles.searchResults} ref={resultsRef}>
          {isLoading ? (
            <div className={styles.searchLoading}>
              <div className={styles.loadingSpinner} />
              <span>搜索中...</span>
            </div>
          ) : query === '' ? (
            // Show search history when no query
            <div className={styles.searchEmpty}>
              {searchHistory.length > 0 ? (
                <>
                  <div className={styles.sectionTitle}>
                    <Clock size={14} />
                    <span>最近搜索</span>
                  </div>
                  <div className={styles.historyList}>
                    {searchHistory.map((term, index) => (
                      <button
                        key={index}
                        className={styles.historyItem}
                        onClick={() => setQuery(term)}
                      >
                        <Clock size={14} />
                        <span>{term}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className={styles.emptyState}>
                  <Search size={32} />
                  <p>输入关键词开始搜索</p>
                  <span className={styles.hintText}>支持全文搜索、标签、文件夹等</span>
                </div>
              )}
            </div>
          ) : results.length === 0 ? (
            <div className={styles.searchEmpty}>
              <div className={styles.emptyState}>
                <Search size={32} />
                <p>未找到匹配结果</p>
                <span className={styles.hintText}>尝试使用其他关键词</span>
              </div>
            </div>
          ) : (
            <div className={styles.resultsList}>
              <div className={styles.resultsHeader}>
                <span>找到 {results.length} 个结果</span>
              </div>
              {results.map((result, index) => (
                <div
                  key={result.id}
                  className={`${styles.resultItem} ${index === selectedIndex ? styles.resultItemSelected : ''}`}
                  onClick={() => {
                    if (onResultSelect) {
                      onResultSelect(result);
                      onClose();
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className={styles.resultIcon}>{TYPE_ICONS[result.type]}</div>
                  <div className={styles.resultContent}>
                    <div className={styles.resultTitle}>{result.title}</div>
                    <div
                      className={styles.resultHighlight}
                      dangerouslySetInnerHTML={{
                        __html: result.highlights[0] || result.content,
                      }}
                    />
                    <div className={styles.resultMeta}>
                      {result.folder && (
                        <span className={styles.metaItem}>
                          <Folder size={12} />
                          {result.folder}
                        </span>
                      )}
                      {result.tags.length > 0 && (
                        <span className={styles.metaItem}>
                          <Tag size={12} />
                          {result.tags.slice(0, 2).join(', ')}
                        </span>
                      )}
                      <span className={`${styles.metaItem} ${styles.metaItemDate}`}>
                        {new Date(result.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  </div>
                  <div className={styles.resultScore}>
                    <span>{Math.round(result.score * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.searchFooter}>
          <span className={styles.footerHint}>
            提示: 使用 <kbd>Cmd+P</kbd> 快速打开搜索
          </span>
        </div>
      </div>
    </div>
  );
};

export default SearchPanel;
