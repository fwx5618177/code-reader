// ================================
// 全局搜索（⌘P）
// - 全文：同时搜索写作文档与知识库条目，按组展示
// - 精确：在全部条目正文中逐行查找（区分大小写 / 全词 / 正则），列出命中行，打开后定位到该行
// 检索见 useGlobalSearch
// ================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, Filter, Search, X } from 'lucide-react';
import type { KnowledgeItemType } from '../../types/knowledge';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';
import { SEARCH_GROUPS, type SearchHit } from './search-results';
import { useExactSearch, useGlobalSearch } from './useGlobalSearch';
import type { SourceLocation } from '../../lib/markdown';
import { lineSegments, type ExactItemHit, type ExactLineHit, type ExactSearchOptions } from './exact-search';
import { Snippet } from './Snippet';
import styles from './SearchPanel.module.scss';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** 打开命中的条目：由调用方按条目类型决定进入写作、阅读还是知识库；精确查找带上命中行的位置 */
  onOpenItem: (id: string, location?: SourceLocation) => void;
}

type SearchMode = 'fulltext' | 'exact';

/** 精确查找的选项开关 */
const EXACT_OPTIONS: ReadonlyArray<{ key: keyof ExactSearchOptions; label: string; title: string }> = [
  { key: 'caseSensitive', label: 'Aa', title: '区分大小写' },
  { key: 'wholeWord', label: 'ab', title: '全词匹配' },
  { key: 'useRegex', label: '.*', title: '正则表达式' },
];

/** 精确查找的可选中项：一行命中及其所属条目 */
interface ExactEntry {
  item: ExactItemHit;
  line: ExactLineHit;
}

/** 保留的最近搜索词数 */
const HISTORY_LIMIT = 10;

const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as KnowledgeItemType[];

const SearchPanel: React.FC<SearchPanelProps> = ({ isOpen, onClose, onOpenItem }) => {
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState<KnowledgeItemType[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [mode, setMode] = useState<SearchMode>('fulltext');
  const [exactOptions, setExactOptions] = useState<ExactSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const exactMode = mode === 'exact';
  const { groups, isLoading: fulltextLoading } = useGlobalSearch(exactMode ? '' : query);
  const exact = useExactSearch(query, exactOptions, exactMode);
  const isLoading = exactMode ? exact.isLoading : fulltextLoading;

  // 打开时聚焦并选中输入框
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isOpen]);

  // 按类型筛选后的分组，以及键盘导航用的扁平列表
  const visibleGroups = useMemo(() => {
    const keep = (hit: SearchHit) => typeFilter.length === 0 || typeFilter.includes(hit.type);
    return SEARCH_GROUPS.map(({ key, label }) => ({ key, label, hits: groups[key].filter(keep) })).filter(
      (group) => group.hits.length > 0
    );
  }, [groups, typeFilter]);
  const flatHits = useMemo(() => visibleGroups.flatMap((group) => group.hits), [visibleGroups]);

  const exactItems = useMemo(
    () => exact.result.items.filter((item) => typeFilter.length === 0 || typeFilter.includes(item.type)),
    [exact.result.items, typeFilter]
  );
  const exactEntries = useMemo<ExactEntry[]>(
    () => exactItems.flatMap((item) => item.lines.map((line) => ({ item, line }))),
    [exactItems]
  );
  const optionCount = exactMode ? exactEntries.length : flatHits.length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [flatHits, exactEntries]);

  // 选中项滚动到可见区域
  useEffect(() => {
    resultsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, flatHits, exactEntries]);

  const open = useCallback(
    (id: string, location?: SourceLocation) => {
      const term = query.trim();
      setSearchHistory((prev) => [term, ...prev.filter((t) => t !== term)].slice(0, HISTORY_LIMIT));
      onOpenItem(id, location);
      onClose();
    },
    [query, onOpenItem, onClose]
  );
  const openHit = useCallback((hit: SearchHit) => open(hit.id), [open]);
  const openEntry = useCallback((entry: ExactEntry) => open(entry.item.id, entry.line.location), [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, optionCount - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (exactMode) {
          if (exactEntries[selectedIndex]) openEntry(exactEntries[selectedIndex]);
        } else if (flatHits[selectedIndex]) {
          openHit(flatHits[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  const toggleExactOption = (key: keyof ExactSearchOptions) => {
    setExactOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTypeFilter = (type: KnowledgeItemType) => {
    setTypeFilter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  if (!isOpen) return null;

  const renderResults = () => {
    if (exactMode && exact.error) {
      return (
        <div className={styles.searchError} role="alert">
          {exact.error}
        </div>
      );
    }

    if (isLoading && optionCount === 0) {
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
              <span className={styles.hintText}>
                {exactMode ? '在全部条目正文中逐行查找，可区分大小写、全词或使用正则' : '同时搜索写作文档与知识库条目'}
              </span>
            </div>
          )}
        </div>
      );
    }

    if (optionCount === 0) {
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

    if (exactMode) return renderExactResults();

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

  const renderExactResults = () => {
    let index = 0;
    return (
      <div className={styles.resultsList} role="listbox" aria-label="精确查找结果">
        {exactItems.map((item) => {
          const Icon = ITEM_TYPE_ICONS[item.type];
          return (
            <div key={item.id} role="group" aria-label={item.title}>
              <div className={styles.exactItemHeader}>
                <Icon size={14} />
                <span>{item.title}</span>
                <span className={styles.groupCount}>{item.matchCount}</span>
              </div>
              {item.lines.map((line) => {
                const entryIndex = index++;
                const selected = entryIndex === selectedIndex;
                return (
                  <div
                    key={line.lineNumber}
                    role="option"
                    aria-selected={selected}
                    className={`${styles.lineHit} ${selected ? styles.resultItemSelected : ''}`}
                    onClick={() => openEntry({ item, line })}
                    onMouseEnter={() => setSelectedIndex(entryIndex)}
                  >
                    <span className={styles.lineNumber}>{line.lineNumber}</span>
                    <span className={styles.lineText}>
                      {lineSegments(line.text, line.positions).map((segment, i) =>
                        segment.highlight ? <mark key={i}>{segment.text}</mark> : <span key={i}>{segment.text}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {exact.result.truncated && <div className={styles.truncatedHint}>结果较多，只列出前 100 个条目</div>}
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
              placeholder={exactMode ? '在条目正文中精确查找...' : '搜索写作文档与知识库...'}
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

          <div className={styles.modeBar}>
            <div className={styles.modeTabs} role="tablist" aria-label="搜索模式">
              {(['fulltext', 'exact'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  className={`${styles.modeTab} ${mode === value ? styles.modeTabActive : ''}`}
                  onClick={() => {
                    setMode(value);
                    inputRef.current?.focus();
                  }}
                >
                  {value === 'fulltext' ? '全文' : '精确'}
                </button>
              ))}
            </div>
            {exactMode &&
              EXACT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  title={option.title}
                  aria-label={option.title}
                  aria-pressed={exactOptions[option.key]}
                  className={`${styles.optionToggle} ${exactOptions[option.key] ? styles.optionToggleActive : ''}`}
                  onClick={() => {
                    toggleExactOption(option.key);
                    inputRef.current?.focus();
                  }}
                >
                  {option.label}
                </button>
              ))}
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
