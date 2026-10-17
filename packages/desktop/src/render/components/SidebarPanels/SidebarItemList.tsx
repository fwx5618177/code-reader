// ================================
// 侧栏条目列表：虚拟滚动，每行显示类型图标、标题与一行说明
// 供最近、日历当日条目、标签筛选结果等面板共用
// ================================

import React, { useMemo } from 'react';
import { List, type RowComponentProps } from 'react-window';
import type { KnowledgeItem } from '../../types/knowledge';
import { displayTitle } from '../../lib/links/link-index';
import { ITEM_TYPE_ICONS } from '../ReadingWorkspace/item-type';
import { PanelEmpty } from './PanelEmpty';
import styles from './SidebarItemList.module.scss';

/** 行高，与样式中 .row 一致 */
const ROW_HEIGHT = 44;

export interface SidebarItemListProps {
  items: readonly KnowledgeItem[];
  selectedId?: string | null;
  onOpen: (id: string) => void;
  /** 每行第二行的说明文字（时间、进度等） */
  describe: (item: KnowledgeItem) => string;
  emptyText: string;
  ariaLabel: string;
}

interface RowData {
  items: readonly KnowledgeItem[];
  selectedId?: string | null;
  onOpen: (id: string) => void;
  describe: (item: KnowledgeItem) => string;
}

function ItemRow({ index, style, ariaAttributes, items, selectedId, onOpen, describe }: RowComponentProps<RowData>) {
  const item = items[index];
  const Icon = ITEM_TYPE_ICONS[item.type];
  const title = displayTitle(item.title) || '无标题';
  return (
    <div style={style} {...ariaAttributes}>
      <button
        type="button"
        className={`${styles.row} ${item.id === selectedId ? styles.rowSelected : ''}`}
        onClick={() => onOpen(item.id)}
        title={title}
      >
        <Icon size={14} className={styles.icon} />
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          <span className={styles.meta}>{describe(item)}</span>
        </span>
      </button>
    </div>
  );
}

export const SidebarItemList: React.FC<SidebarItemListProps> = ({
  items,
  selectedId,
  onOpen,
  describe,
  emptyText,
  ariaLabel,
}) => {
  const rowProps = useMemo<RowData>(
    () => ({ items, selectedId, onOpen, describe }),
    [items, selectedId, onOpen, describe]
  );

  if (items.length === 0) return <PanelEmpty>{emptyText}</PanelEmpty>;
  return (
    <div className={styles.container} role="region" aria-label={ariaLabel}>
      <List
        className={styles.list}
        rowComponent={ItemRow}
        rowCount={items.length}
        rowHeight={ROW_HEIGHT}
        rowProps={rowProps}
        overscanCount={6}
      />
    </div>
  );
};
