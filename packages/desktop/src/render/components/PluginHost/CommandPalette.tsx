// ================================
// 命令面板
// ⌘⇧P 打开，列出已启用插件注册的命令；插件调用 showQuickPick 时也复用这里的列表选择
// ================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './CommandPalette.module.scss';

export interface PaletteItem {
  key: string;
  label: string;
  detail?: string;
  /** 快捷键提示 */
  shortcut?: string;
}

export interface CommandPaletteProps {
  items: PaletteItem[];
  placeholder: string;
  /** 没有任何条目时的提示 */
  emptyText: string;
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ items, placeholder, emptyText, onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(keyword));
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) onSelect(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        className={styles.palette}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={placeholder}
      >
        <input
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus
        />
        {filtered.length === 0 ? (
          <div className={styles.empty}>{items.length === 0 ? emptyText : '没有匹配的条目'}</div>
        ) : (
          <ul ref={listRef} className={styles.list} role="listbox">
            {filtered.map((item, index) => (
              <li
                key={item.key}
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.item} ${index === activeIndex ? styles.active : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(item)}
              >
                <span className={styles.label}>{item.label}</span>
                {item.detail && <span className={styles.detail}>{item.detail}</span>}
                {item.shortcut && <kbd className={styles.shortcut}>{item.shortcut}</kbd>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
};

export default CommandPalette;
