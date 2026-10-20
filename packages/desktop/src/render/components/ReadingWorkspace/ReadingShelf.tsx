// ================================
// 书架（阅读模式侧边栏）
// 按阅读状态筛选、关键词搜索，最近阅读的条目排在最前
// ================================

import React, { useMemo, useState } from 'react';
import { Library, Search, X } from 'lucide-react';
import { displayTitle } from '../../lib/links';
import {
  filterShelfItems,
  formatRelativeTime,
  getReadingState,
  getReadingStatus,
  READING_STATUS_LABELS,
  sortShelfItems,
  type ReadingStatus,
  type ShelfFilter,
} from '../../lib/reading';
import type { KnowledgeItem } from '../../types/knowledge';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from './item-type';
import styles from './ReadingShelf.module.scss';

export interface ReadingShelfProps {
  /** 书架条目（调用方使用 isOnShelf 从知识库条目中筛选） */
  items: KnowledgeItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

const FILTERS: { value: ShelfFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'reading', label: READING_STATUS_LABELS.reading },
  { value: 'unread', label: READING_STATUS_LABELS.unread },
  { value: 'finished', label: READING_STATUS_LABELS.finished },
];

export const ReadingShelf: React.FC<ReadingShelfProps> = ({ items, selectedId, onSelect }) => {
  const [filter, setFilter] = useState<ShelfFilter>('all');
  const [query, setQuery] = useState('');

  const sorted = useMemo(() => sortShelfItems(items), [items]);

  const counts = useMemo(() => {
    const result: Record<ShelfFilter, number> = { all: items.length, reading: 0, unread: 0, finished: 0 };
    for (const item of items) result[getReadingStatus(getReadingState(item))] += 1;
    return result;
  }, [items]);

  const visible = useMemo(() => filterShelfItems(sorted, filter, query), [sorted, filter, query]);

  return (
    <div className={styles.shelf}>
      <div className={styles.header}>
        <Library size={14} />
        <span className={styles.headerTitle}>书架</span>
        <span className={styles.headerCount}>{items.length}</span>
      </div>

      <div className={styles.searchBox}>
        <Search size={13} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题或链接"
        />
        {query && (
          <button className={styles.clearButton} onClick={() => setQuery('')} title="清除搜索">
            <X size={12} />
          </button>
        )}
      </div>

      <div className={styles.filters} role="tablist">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            className={`${styles.filter} ${filter === value ? styles.filterActive : ''}`}
            onClick={() => setFilter(value)}
          >
            {label}
            <span className={styles.filterCount}>{counts[value]}</span>
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {visible.length === 0 ? (
          <div className={styles.empty}>
            {items.length === 0
              ? '书架是空的。网页剪藏、书签和文档会自动出现在这里。'
              : '没有匹配的条目'}
          </div>
        ) : (
          visible.map((item) => (
            <ShelfRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
};

interface ShelfRowProps {
  item: KnowledgeItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ShelfRow: React.FC<ShelfRowProps> = ({ item, selected, onSelect }) => {
  const state = getReadingState(item);
  const status: ReadingStatus = getReadingStatus(state);
  const progress = state.progress ?? 0;
  const Icon = ITEM_TYPE_ICONS[item.type];

  return (
    <button
      className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
      onClick={() => onSelect(item.id)}
      title={displayTitle(item.title)}
    >
      <Icon size={15} className={styles.rowIcon} aria-label={ITEM_TYPE_LABELS[item.type]} />
      <div className={styles.rowBody}>
        <div className={styles.rowTitle}>{displayTitle(item.title)}</div>
        <div className={styles.rowMeta}>
          <span className={styles[`status_${status}`]}>{READING_STATUS_LABELS[status]}</span>
          {state.lastReadAt && <span>· {formatRelativeTime(state.lastReadAt)}</span>}
          {status === 'reading' && progress > 0 && (
            <span className={styles.rowPercent}>{Math.round(progress * 100)}%</span>
          )}
        </div>
        {status !== 'unread' && (
          <div
            className={`${styles.progressTrack} ${status === 'finished' ? styles.progressDone : ''}`}
            style={{ '--shelf-progress': status === 'finished' ? 1 : progress } as React.CSSProperties}
          >
            <div className={styles.progressFill} />
          </div>
        )}
      </div>
    </button>
  );
};

export default ReadingShelf;
