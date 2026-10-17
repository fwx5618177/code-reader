// ================================
// 工具栏标签筛选：弹出层列出当前结果中的标签及计数，多选（全部命中）
// ================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Tag as TagIcon } from 'lucide-react';
import type { Tag } from '../../types/knowledge';
import { useDismiss } from '../ReadingWorkspace/hooks';
import { TagOptionList, type TagOption } from './TagOptionList';
import styles from './Toolbar.module.scss';

export interface TagFilterProps {
  tags: Tag[];
  /** 追加该标签后的结果数 */
  counts: Map<string, number>;
  selected: string[];
  onChange: (tagIds: string[]) => void;
}

export const TagFilter: React.FC<TagFilterProps> = ({ tags, counts, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, close, open);

  // 已选标签在前，其余按计数降序；计数为 0 的未选标签不显示
  const options = useMemo<TagOption[]>(() => {
    const keyword = query.trim().toLowerCase();
    const selectedSet = new Set(selected);
    return tags
      .filter((tag) => selectedSet.has(tag.id) || (counts.get(tag.id) ?? 0) > 0)
      .filter((tag) => !keyword || tag.name.toLowerCase().includes(keyword))
      .map((tag) => ({
        key: tag.id,
        name: tag.name,
        count: counts.get(tag.id) ?? 0,
        selected: selectedSet.has(tag.id),
      }))
      .sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count);
  }, [tags, counts, selected, query]);

  const toggle = useCallback(
    (option: TagOption) => {
      onChange(
        selected.includes(option.key)
          ? selected.filter((id) => id !== option.key)
          : [...selected, option.key]
      );
    },
    [selected, onChange]
  );

  return (
    <div className={styles.popoverAnchor} ref={rootRef}>
      <button
        type="button"
        className={styles.control}
        aria-expanded={open}
        data-active={selected.length > 0}
        onClick={() => setOpen((value) => !value)}
      >
        <TagIcon size={13} />
        标签
        {selected.length > 0 && <span className={styles.controlBadge}>{selected.length}</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label="按标签筛选">
          <label className={styles.popoverSearch}>
            <Search size={12} />
            <input
              autoFocus
              value={query}
              placeholder="查找标签"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <TagOptionList
            options={options}
            onPick={toggle}
            emptyText={query ? '没有匹配的标签' : '当前条目没有标签'}
          />
          {selected.length > 0 && (
            <button type="button" className={styles.popoverFooter} onClick={() => onChange([])}>
              清除标签筛选
            </button>
          )}
        </div>
      )}
    </div>
  );
};
