// ================================
// 条目标签编辑：标签胶囊、删除、输入补全（已有标签）或新建
// ================================

import React, { useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Tag } from '../../types/knowledge';
import { TagOptionList, type TagOption } from './TagOptionList';
import { TagDot } from './TagColor';
import styles from './Inspector.module.scss';

export interface TagEditorProps {
  /** 条目当前的标签名 */
  names: string[];
  allTags: Tag[];
  onChange: (names: string[]) => void;
}

export const TagEditor: React.FC<TagEditorProps> = ({ names, allTags, onChange }) => {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const options = useMemo<TagOption[]>(() => {
    const keyword = query.trim();
    const lower = keyword.toLowerCase();
    const current = new Set(names.map((name) => name.toLowerCase()));
    const matches: TagOption[] = allTags
      .filter((tag) => !current.has(tag.name.toLowerCase()))
      .filter((tag) => !lower || tag.name.toLowerCase().includes(lower))
      .map((tag) => ({ key: tag.id, name: tag.name, color: tag.color, count: tag.usageCount }));
    const exists = allTags.some((tag) => tag.name.toLowerCase() === lower);
    if (keyword && !exists && !current.has(lower)) {
      matches.push({ key: `new:${keyword}`, name: keyword, isNew: true });
    }
    return matches;
  }, [allTags, names, query]);

  const add = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      setQuery('');
      setActiveIndex(-1);
      if (!trimmed || names.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return;
      onChange([...names, trimmed]);
    },
    [names, onChange]
  );

  const remove = (name: string) => onChange(names.filter((n) => n !== name));
  const colorByName = useMemo(() => new Map(allTags.map((tag) => [tag.name, tag.color])), [allTags]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // 输入法组字过程中的按键不处理
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(options.length - 1, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(-1, index - 1));
        break;
      case 'Enter':
      case ',':
      case '，':
        event.preventDefault();
        add(activeIndex >= 0 && options[activeIndex] ? options[activeIndex].name : query);
        break;
      case 'Backspace':
        if (!query && names.length > 0) remove(names[names.length - 1]);
        break;
      case 'Escape':
        setQuery('');
        setActiveIndex(-1);
        (event.target as HTMLInputElement).blur();
        break;
    }
  };

  return (
    <div className={styles.tagEditor}>
      <div className={styles.tagField}>
        {names.map((name) => (
          <span key={name} className={styles.tagChip}>
            <TagDot color={colorByName.get(name)} />
            #{name}
            <button type="button" title={`移除标签「${name}」`} onClick={() => remove(name)}>
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          className={styles.tagInput}
          value={query}
          placeholder={names.length === 0 ? '添加标签…' : '添加'}
          aria-label="添加标签"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {focused && (query || options.length > 0) && (
        <div className={styles.tagSuggestions}>
          <TagOptionList
            options={options}
            activeIndex={activeIndex}
            onPick={(option) => add(option.name)}
            emptyText="没有其他标签"
          />
        </div>
      )}
    </div>
  );
};
