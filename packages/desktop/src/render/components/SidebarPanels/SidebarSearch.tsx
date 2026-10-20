// ================================
// 侧栏搜索：复用全局检索（写作文档 + 知识库混合检索），结果按组列在侧栏
// 可按调用方条件过滤命中（如阅读模式只看书库内的条目）
// ================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ITEM_TYPE_ICONS } from '../ReadingWorkspace/item-type';
import { SEARCH_GROUPS, type SearchHit } from '../SearchPanel/search-results';
import { Snippet } from '../SearchPanel/Snippet';
import { useGlobalSearch } from '../SearchPanel/useGlobalSearch';
import { PanelEmpty } from './PanelEmpty';
import styles from './SidebarSearch.module.scss';

export interface SidebarSearchProps {
  placeholder: string;
  /** 只保留满足条件的命中；不传则全部显示 */
  filterHit?: (hit: SearchHit) => boolean;
  selectedId?: string | null;
  onOpenItem: (id: string) => void;
}

export const SidebarSearch: React.FC<SidebarSearchProps> = ({ placeholder, filterHit, selectedId, onOpenItem }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { groups, isLoading } = useGlobalSearch(query);

  // 切换到搜索面板时直接可以输入
  useEffect(() => inputRef.current?.focus(), []);

  const visibleGroups = useMemo(
    () =>
      SEARCH_GROUPS.map(({ key, label }) => ({
        key,
        label,
        hits: filterHit ? groups[key].filter(filterHit) : groups[key],
      })).filter((group) => group.hits.length > 0),
    [groups, filterHit]
  );

  const renderResults = () => {
    if (!query.trim()) return <PanelEmpty>输入关键词，搜索标题、正文与转写文本</PanelEmpty>;
    if (visibleGroups.length === 0) return <PanelEmpty>{isLoading ? '搜索中…' : '未找到匹配结果'}</PanelEmpty>;
    return visibleGroups.map((group) => (
      <div key={group.key} role="group" aria-label={group.label}>
        <div className={styles.groupHeader}>
          {group.label}
          <span className={styles.groupCount}>{group.hits.length}</span>
        </div>
        {group.hits.map((hit) => {
          const Icon = ITEM_TYPE_ICONS[hit.type];
          return (
            <button
              key={hit.id}
              type="button"
              className={`${styles.hit} ${hit.id === selectedId ? styles.hitSelected : ''}`}
              onClick={() => onOpenItem(hit.id)}
            >
              <span className={styles.hitTitle}>
                <Icon size={13} className={styles.hitIcon} />
                {hit.title}
              </span>
              {hit.snippet && <Snippet snippet={hit.snippet} />}
            </button>
          );
        })}
      </div>
    ));
  };

  return (
    <div className={styles.panel}>
      <div className={styles.inputWrapper}>
        <Search size={14} className={styles.searchIcon} />
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
        />
        {query && (
          <button type="button" className={styles.clear} onClick={() => setQuery('')} aria-label="清空">
            <X size={12} />
          </button>
        )}
      </div>
      <div className={styles.results} aria-busy={isLoading}>
        {renderResults()}
      </div>
    </div>
  );
};
