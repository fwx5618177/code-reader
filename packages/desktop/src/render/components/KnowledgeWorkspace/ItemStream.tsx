// ================================
// 条目流：虚拟滚动的列表 / 卡片，分组标题与条目行高度不同
// ↑ / ↓ 移动选中，Enter 或双击在写作中打开笔记
// ================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { AlertCircle, Pin, Star } from 'lucide-react';
import type { KnowledgeItem, Tag } from '../../types/knowledge';
import type { ItemActivity } from '../../lib/agent/agentStore';
import { KNOWLEDGE_ITEM_DRAG_TYPE } from '../../lib/knowledge/drag';
import { displayTitle } from '../../lib/links/link-index';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';
import { activeTaskLabel } from '../AgentActivity/activity';
import { StatusIcon } from '../AgentActivity/TaskProgressList';
import {
  buildStreamRows,
  indexStreamRows,
  stepSelection,
  type ItemGroup,
  type StreamRow,
} from './filtering';
import { absoluteTime, itemSnippet, relativeTime } from './item-display';
import type { StreamLayout } from './preferences';
import { TagDot } from './TagColor';
import styles from './ItemStream.module.scss';

/** 行高，与样式中 .header / .entry / .cardRow 的尺寸一致 */
const HEADER_HEIGHT = 36;
const LIST_ROW_HEIGHT = 88;
const CARD_ROW_HEIGHT = 176;
/** 卡片最小宽度与间距（决定每行卡片数） */
const CARD_MIN_WIDTH = 240;
const CARD_GAP = 12;
const STREAM_PADDING = 16;

export interface ItemStreamProps {
  groups: ItemGroup[];
  layout: StreamLayout;
  /** 行内显示的时间字段 */
  timeField: 'createdAt' | 'updatedAt';
  selectedId?: string;
  onSelect: (id: string) => void;
  /** Enter / 双击：在写作中打开（仅笔记） */
  onOpen: (item: KnowledgeItem) => void;
  onToggleFavorite: (item: KnowledgeItem) => void;
  tagById: ReadonlyMap<string, Tag>;
  activityByItem: ReadonlyMap<string, ItemActivity>;
}

interface RowData {
  rows: StreamRow[];
  layout: StreamLayout;
  columns: number;
  timeField: 'createdAt' | 'updatedAt';
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpen: (item: KnowledgeItem) => void;
  onToggleFavorite: (item: KnowledgeItem) => void;
  tagById: ReadonlyMap<string, Tag>;
  activityByItem: ReadonlyMap<string, ItemActivity>;
}

function rowHeight(index: number, data: RowData): number {
  if (data.rows[index].kind === 'header') return HEADER_HEIGHT;
  return data.layout === 'card' ? CARD_ROW_HEIGHT : LIST_ROW_HEIGHT;
}

function cardColumns(width: number): number {
  return Math.max(1, Math.floor((width - 2 * STREAM_PADDING + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
}

/** AI 处理状态：实时活动优先于数据库中的状态 */
const StatusBadge: React.FC<{ item: KnowledgeItem; activity?: ItemActivity }> = ({ item, activity }) => {
  const status = activity?.status ?? item.status;
  if (status === 'processing') {
    return (
      <span className={styles.badge} data-kind="processing">
        <StatusIcon status="processing" size={11} />
        {activity ? activeTaskLabel(activity) : 'AI 处理中'}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className={styles.badge} data-kind="error">
        <AlertCircle size={11} />
        处理失败
      </span>
    );
  }
  return null;
};

interface EntryProps {
  item: KnowledgeItem;
  data: RowData;
}

const Entry: React.FC<EntryProps> = ({ item, data }) => {
  const Icon = ITEM_TYPE_ICONS[item.type];
  const title = displayTitle(item.title) || '未命名';
  const snippet = itemSnippet(item);
  const tags = item.tagIds
    .map((id) => data.tagById.get(id))
    .filter((tag): tag is Tag => !!tag);
  const time = item[data.timeField];

  return (
    <div
      className={styles.entry}
      data-layout={data.layout}
      data-selected={item.id === data.selectedId}
      aria-current={item.id === data.selectedId}
      // 可拖到侧边栏文件夹上移动
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(KNOWLEDGE_ITEM_DRAG_TYPE, item.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => data.onSelect(item.id)}
      onDoubleClick={() => data.onOpen(item)}
    >
      <div className={styles.entryHead}>
        <Icon size={15} className={styles.typeIcon} aria-label={ITEM_TYPE_LABELS[item.type]} />
        <span className={styles.title} title={title}>
          {title}
        </span>
        {item.isPinned && <Pin size={12} className={styles.pin} aria-label="已置顶" />}
        <StatusBadge item={item} activity={data.activityByItem.get(item.id)} />
        <button
          type="button"
          className={styles.star}
          data-active={item.isFavorite}
          title={item.isFavorite ? '取消收藏' : '收藏'}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleFavorite(item);
          }}
        >
          <Star size={13} />
        </button>
        <time className={styles.time} dateTime={time.toISOString()} title={absoluteTime(time)}>
          {relativeTime(time)}
        </time>
      </div>
      {snippet && <p className={styles.snippet}>{snippet}</p>}
      {tags.length > 0 && (
        <div className={styles.tags}>
          {tags.map((tag) => (
            <span key={tag.id} className={styles.tag}>
              <TagDot color={tag.color} />#{tag.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

function StreamRowView({
  index,
  style,
  ariaAttributes,
  ...data
}: RowComponentProps<RowData>): React.ReactElement {
  const row = data.rows[index];
  if (row.kind === 'header') {
    return (
      <div style={style} className={styles.header} {...ariaAttributes}>
        <span>{row.label}</span>
        <span className={styles.headerCount}>{row.count}</span>
      </div>
    );
  }
  if (data.layout === 'list') {
    return (
      <div style={style} className={styles.listRow} {...ariaAttributes}>
        <Entry item={row.items[0]} data={data} />
      </div>
    );
  }
  return (
    <div
      style={{ ...style, gridTemplateColumns: `repeat(${data.columns}, minmax(0, 1fr))` }}
      className={styles.cardRow}
      {...ariaAttributes}
    >
      {row.items.map((item) => (
        <Entry key={item.id} item={item} data={data} />
      ))}
    </div>
  );
}

export const ItemStream: React.FC<ItemStreamProps> = ({
  groups,
  layout,
  timeField,
  selectedId,
  onSelect,
  onOpen,
  onToggleFavorite,
  tagById,
  activityByItem,
}) => {
  const listRef = useListRef(null);
  const [width, setWidth] = useState(0);
  const columns = layout === 'card' ? cardColumns(width) : 1;

  const rows = useMemo(() => buildStreamRows(groups, columns), [groups, columns]);
  const navigation = useMemo(() => indexStreamRows(rows), [rows]);

  const rowData = useMemo<RowData>(
    () => ({
      rows,
      layout,
      columns,
      timeField,
      selectedId,
      onSelect,
      onOpen,
      onToggleFavorite,
      tagById,
      activityByItem,
    }),
    [rows, layout, columns, timeField, selectedId, onSelect, onOpen, onToggleFavorite, tagById, activityByItem]
  );

  // 只在选中项变化时滚动到可见位置；条目被 Agent 更新导致的重排不打断用户滚动
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  useEffect(() => {
    if (!selectedId) return;
    const index = navigationRef.current.rowOf.get(selectedId);
    if (index !== undefined) listRef.current?.scrollToRow({ index, align: 'auto' });
  }, [selectedId, listRef]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = stepSelection(navigation.order, selectedId, event.key === 'ArrowDown' ? 1 : -1);
        if (next) onSelect(next);
      } else if (event.key === 'Enter' && selectedId) {
        const row = rows[navigation.rowOf.get(selectedId) ?? -1];
        const item = row?.kind === 'items' ? row.items.find((i) => i.id === selectedId) : undefined;
        if (item) {
          event.preventDefault();
          onOpen(item);
        }
      }
    },
    [navigation, rows, selectedId, onSelect, onOpen]
  );

  return (
    <div
      className={styles.stream}
      tabIndex={0}
      role="region"
      aria-label="条目列表，使用上下方向键选择，Enter 打开"
      onKeyDown={handleKeyDown}
    >
      <List
        listRef={listRef}
        className={styles.list}
        rowComponent={StreamRowView}
        rowCount={rows.length}
        rowHeight={rowHeight}
        rowProps={rowData}
        overscanCount={4}
        onResize={(size) => setWidth(size.width)}
      />
    </div>
  );
};
