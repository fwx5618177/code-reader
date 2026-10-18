// ================================
// 命令面板
// ⌘⇧P 打开，列出已启用插件注册的命令；插件调用 showQuickPick 时也复用这里的列表选择。
// 输入按模糊匹配（@code-reader/fuzzy-match-algorithm）排序：字符依次出现即可，连续、词首与开头匹配优先；
// 标题未匹配时再匹配说明（插件名），排在标题匹配之后。命中的字符高亮显示
// ================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fuzzyScore } from '@code-reader/fuzzy-match-algorithm';
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

interface RankedItem {
  item: PaletteItem;
  /** 标题 / 说明中命中的字符位置 */
  labelPositions: number[];
  detailPositions: number[];
}

/** 按模糊匹配筛选并排序；分数相同时保持原有顺序 */
export function rankPaletteItems(items: readonly PaletteItem[], query: string): RankedItem[] {
  const pattern = query.replace(/\s+/g, '');
  if (!pattern) return items.map((item) => ({ item, labelPositions: [], detailPositions: [] }));
  const ranked: Array<RankedItem & { rank: number }> = [];
  for (const item of items) {
    const label = fuzzyScore(pattern, item.label);
    if (label.matched) {
      ranked.push({ item, rank: 100 + label.score, labelPositions: label.positions, detailPositions: [] });
      continue;
    }
    const detail = item.detail ? fuzzyScore(pattern, item.detail) : null;
    if (detail?.matched) ranked.push({ item, rank: detail.score, labelPositions: [], detailPositions: detail.positions });
  }
  return ranked.sort((a, b) => b.rank - a.rank);
}

/** 命中字符用 <mark> 包裹（React 节点，文本不作为 HTML 解析） */
function Highlighted({ text, positions }: { text: string; positions: readonly number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const hit = new Set(positions);
  const parts: React.ReactNode[] = [];
  let start = 0;
  while (start < text.length) {
    const matched = hit.has(start);
    let end = start + 1;
    while (end < text.length && hit.has(end) === matched) end++;
    const slice = text.slice(start, end);
    parts.push(matched ? <mark key={start} className={styles.match}>{slice}</mark> : slice);
    start = end;
  }
  return <>{parts}</>;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ items, placeholder, emptyText, onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => rankPaletteItems(items, query), [items, query]);

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
      const ranked = filtered[activeIndex];
      if (ranked) onSelect(ranked.item);
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
            {filtered.map(({ item, labelPositions, detailPositions }, index) => (
              <li
                key={item.key}
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.item} ${index === activeIndex ? styles.active : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(item)}
              >
                <span className={styles.label}>
                  <Highlighted text={item.label} positions={labelPositions} />
                </span>
                {item.detail && (
                  <span className={styles.detail}>
                    <Highlighted text={item.detail} positions={detailPositions} />
                  </span>
                )}
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
