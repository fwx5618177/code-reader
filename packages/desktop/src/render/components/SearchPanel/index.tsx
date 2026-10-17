// ================================
// 全局搜索（⌘P）
// 同时搜索写作文档（内存全文索引）与知识库条目（混合检索），按组展示
// 输入防抖；只采用最新一次查询的结果，过期响应直接丢弃
// ================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, Filter, Search, X } from 'lucide-react';
import { useWritingService } from '../../lib/writing';
import type { KnowledgeItemType } from '../../types/knowledge';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';
import {
  mergeSearchResults,
  splitHighlights,
  type SearchGroupKey,
  type SearchGroups,
  type SearchHit,
} from './search-results';
import styles from './SearchPanel.module.scss';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** 打开命中的条目：由调用方按条目类型决定进入写作、阅读还是知识库 */
  onOpenItem: (id: string) => void;
}

/** 输入停顿多久后发起搜索（毫秒） */
const SEARCH_DEBOUNCE_MS = 300;
/** 每一路搜索的结果上限 */
const RESULT_LIMIT = 30;
/** 保留的最近搜索词数 */
const HISTORY_LIMIT = 10;

const EMPTY_GROUPS: SearchGroups = { documents: [], knowledge: [] };

const GROUPS: Array<{ key: SearchGroupKey; label: string }> = [
  { key: 'documents', label: '写作文档' },
  { key: 'knowledge', label: '知识条目' },
];

const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as KnowledgeItemType[];

const Snippet: React.FC<{ snippet: string }> = ({ snippet }) => (
  <div className={styles.resultHighlight}>
    {splitHighlights(snippet).map((segment, index) =>
      segment.highlight ? (
        <mark key={index}>{segment.text}</mark>
      ) : (
        <React.Fragment key={index}>{segment.text}</React.Fragment>
      )
    )}
  </div>
);

const SearchPanel: React.FC<SearchPanelProps> = ({ isOpen, onClose, onOpenItem }) => {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroups>(EMPTY_GROUPS);
  const [isLoading, setIsLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState<KnowledgeItemType[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // 每次查询递增，响应返回时与最新值比较以丢弃过期结果
  const requestSeqRef = useRef(0);

  const { search: searchDocuments } = useWritingService();

  // 打开时聚焦并选中输入框
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isOpen]);

  // 防抖搜索
  useEffect(() => {
    const seq = ++requestSeqRef.current;
    const trimmed = query.trim();
    if (!trimmed) {
      setGroups(EMPTY_GROUPS);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(() => {
      void Promise.allSettled([
        searchDocuments(trimmed, { limit: RESULT_LIMIT, fuzzy: true, highlight: true }),
        window.electron.search.hybrid(trimmed, { limit: RESULT_LIMIT }),
      ]).then(([writing, hybrid]) => {
        if (seq !== requestSeqRef.current) return;
        if (writing.status === 'rejected') console.error('[Search] 写作文档搜索失败:', writing.reason);
        if (hybrid.status === 'rejected') console.error('[Search] 知识库搜索失败:', hybrid.reason);
        setGroups(
          mergeSearchResults(
            writing.status === 'fulfilled' ? writing.value : [],
            hybrid.status === 'fulfilled' ? hybrid.value : []
          )
        );
        setIsLoading(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchDocuments]);

  // 按类型筛选后的分组，以及键盘导航用的扁平列表
  const visibleGroups = useMemo(() => {
    const keep = (hit: SearchHit) => typeFilter.length === 0 || typeFilter.includes(hit.type);
    return GROUPS.map(({ key, label }) => ({ key, label, hits: groups[key].filter(keep) })).filter(
      (group) => group.hits.length > 0
    );
  }, [groups, typeFilter]);
  const flatHits = useMemo(() => visibleGroups.flatMap((group) => group.hits), [visibleGroups]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [flatHits]);

  // 选中项滚动到可见区域
  useEffect(() => {
    resultsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, flatHits]);

  const openHit = useCallback(
    (hit: SearchHit) => {
      const term = query.trim();
      setSearchHistory((prev) => [term, ...prev.filter((t) => t !== term)].slice(0, HISTORY_LIMIT));
      onOpenItem(hit.id);
      onClose();
    },
    [query, onOpenItem, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatHits.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (flatHits[selectedIndex]) openHit(flatHits[selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  const toggleTypeFilter = (type: KnowledgeItemType) => {
    setTypeFilter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  if (!isOpen) return null;

  const renderResults = () => {
    if (isLoading && flatHits.length === 0) {
      return (
        <div className={styles.searchLoading}>
          <div className={styles.loadingSpinner} />
          <span>搜索中...</span>
        </div>
      );
    }

    if (!query.trim()) {
      return (
        <div className={styles.searchEmpty}>
          {searchHistory.length > 0 ? (
            <>
              <div className={styles.sectionTitle}>
                <Clock size={14} />
                <span>最近搜索</span>
              </div>
              <div className={styles.historyList}>
                {searchHistory.map((term) => (
                  <button key={term} type="button" className={styles.historyItem} onClick={() => setQuery(term)}>
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
              <span className={styles.hintText}>同时搜索写作文档与知识库条目</span>
            </div>
          )}
        </div>
      );
    }

    if (flatHits.length === 0) {
      return (
        <div className={styles.searchEmpty}>
          <div className={styles.emptyState}>
            <Search size={32} />
            <p>未找到匹配结果</p>
            <span className={styles.hintText}>
              {typeFilter.length > 0 ? '尝试清除类型筛选' : '尝试使用其他关键词'}
            </span>
          </div>
        </div>
      );
    }

    let offset = 0;
    return (
      <div className={styles.resultsList} role="listbox" aria-label="搜索结果">
        {visibleGroups.map((group) => {
          const start = offset;
          offset += group.hits.length;
          return (
            <div key={group.key} role="group" aria-label={group.label}>
              <div className={styles.resultsHeader}>
                {group.label}
                <span className={styles.groupCount}>{group.hits.length}</span>
              </div>
              {group.hits.map((hit, i) => {
                const index = start + i;
                const Icon = ITEM_TYPE_ICONS[hit.type];
                const selected = index === selectedIndex;
                return (
                  <div
                    key={hit.id}
                    role="option"
                    aria-selected={selected}
                    className={`${styles.resultItem} ${selected ? styles.resultItemSelected : ''}`}
                    onClick={() => openHit(hit)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className={styles.resultIcon}>
                      <Icon size={14} />
                    </div>
                    <div className={styles.resultContent}>
                      <div className={styles.resultTitle}>{hit.title}</div>
                      {hit.snippet && <Snippet snippet={hit.snippet} />}
                      {hit.group === 'knowledge' && (
                        <div className={styles.resultMeta}>
                          <span className={styles.metaItem}>{ITEM_TYPE_LABELS[hit.type]}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.searchPanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchHeader}>
          <div className={styles.searchInputWrapper}>
            <Search className={styles.searchIcon} size={18} />
            <input
              ref={inputRef}
              type="text"
              className={styles.searchInput}
              placeholder="搜索写作文档与知识库..."
              aria-label="搜索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {query && (
              <button type="button" className={styles.clearBtn} aria-label="清空" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
            <button
              type="button"
              className={`${styles.filterBtn} ${showFilters || typeFilter.length > 0 ? styles.filterBtnActive : ''}`}
              onClick={() => setShowFilters(!showFilters)}
              title="按类型筛选"
            >
              <Filter size={16} />
            </button>
          </div>

          <div className={styles.keyboardHints}>
            <span className={styles.hint}>
              <ArrowUp size={12} />
              <ArrowDown size={12} />
              导航
            </span>
            <span className={styles.hint}>
              <kbd>↵</kbd> 打开
            </span>
            <span className={styles.hint}>
              <kbd>esc</kbd> 关闭
            </span>
          </div>
        </div>

        {showFilters && (
          <div className={styles.searchFilters}>
            <div className={styles.filterSection}>
              <label className={styles.filterLabel}>类型</label>
              <div className={styles.filterChips}>
                {ITEM_TYPES.map((type) => {
                  const Icon = ITEM_TYPE_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`${styles.filterChip} ${typeFilter.includes(type) ? styles.filterChipActive : ''}`}
                      onClick={() => toggleTypeFilter(type)}
                    >
                      <Icon size={14} />
                      <span>{ITEM_TYPE_LABELS[type]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {typeFilter.length > 0 && (
              <div className={styles.filterActions}>
                <button type="button" className={styles.clearFiltersBtn} onClick={() => setTypeFilter([])}>
                  清除筛选
                </button>
              </div>
            )}
          </div>
        )}

        <div className={styles.searchResults} ref={resultsRef}>
          {renderResults()}
        </div>

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
