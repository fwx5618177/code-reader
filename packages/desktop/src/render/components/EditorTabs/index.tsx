// ================================
// 写作模式标签栏
// 单击切换、中键或 × 关闭、拖动重排或拖到另一窗格；有未保存修改的标签显示圆点
// ================================

import React, { useCallback, useState } from 'react';
import { Columns2, PanelRightClose, RotateCcw, X } from 'lucide-react';
import type { PaneIndex, TabGroup } from '../../lib/editor-tabs';
import styles from './EditorTabs.module.scss';

/** 拖动标签时携带的数据类型，只接受本应用的标签拖放 */
const TAB_DRAG_TYPE = 'application/x-writing-tab';

interface DraggedTab {
  docId: string;
  pane: PaneIndex;
}

function readDraggedTab(dataTransfer: DataTransfer): DraggedTab | null {
  try {
    const value = JSON.parse(dataTransfer.getData(TAB_DRAG_TYPE)) as Partial<DraggedTab>;
    if (typeof value.docId !== 'string' || (value.pane !== 0 && value.pane !== 1)) return null;
    return { docId: value.docId, pane: value.pane };
  } catch {
    return null;
  }
}

export interface EditorTabsProps {
  pane: PaneIndex;
  group: TabGroup;
  /** 是否为聚焦窗格（分栏时高亮活动标签） */
  focused: boolean;
  isSplit: boolean;
  /** 是否显示右侧操作按钮（分栏时只在最右侧窗格显示） */
  showActions: boolean;
  canReopen: boolean;
  getTitle: (docId: string) => string;
  isDirty: (docId: string) => boolean;
  onActivate: (pane: PaneIndex, docId: string) => void;
  onClose: (pane: PaneIndex, docId: string) => void;
  onMove: (docId: string, from: PaneIndex, to: PaneIndex, toIndex: number) => void;
  onToggleSplit: () => void;
  onReopen: () => void;
}

export const EditorTabs: React.FC<EditorTabsProps> = ({
  pane,
  group,
  focused,
  isSplit,
  showActions,
  canReopen,
  getTitle,
  isDirty,
  onActivate,
  onClose,
  onMove,
  onToggleSplit,
  onReopen,
}) => {
  // 拖动经过时的插入位置（插入到该下标的标签之前）
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const dropIndexAt = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-index]');
      if (!tab) return group.tabs.length;
      const index = Number(tab.dataset.tabIndex);
      const rect = tab.getBoundingClientRect();
      return event.clientX < rect.left + rect.width / 2 ? index : index + 1;
    },
    [group.tabs.length]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropIndex(dropIndexAt(event));
    },
    [dropIndexAt]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const dragged = readDraggedTab(event.dataTransfer);
      setDropIndex(null);
      if (!dragged) return;
      event.preventDefault();
      onMove(dragged.docId, dragged.pane, pane, dropIndexAt(event));
    },
    [dropIndexAt, onMove, pane]
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
  }, []);

  return (
    <div className={`${styles.tabBar} ${focused && isSplit ? styles.focused : ''}`}>
      <div
        className={styles.tabStrip}
        role="tablist"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
      >
        {group.tabs.map((docId, index) => {
          const title = getTitle(docId);
          const active = docId === group.activeId;
          const dirty = isDirty(docId);
          const classes = [
            styles.tab,
            active ? styles.active : '',
            dirty ? styles.dirty : '',
            dropIndex === index ? styles.dropBefore : '',
            dropIndex === group.tabs.length && index === group.tabs.length - 1
              ? styles.dropAfter
              : '',
          ];
          return (
            <div
              key={docId}
              role="tab"
              aria-selected={active}
              data-tab-index={index}
              className={classes.filter(Boolean).join(' ')}
              title={title}
              draggable
              onClick={() => onActivate(pane, docId)}
              onMouseDown={(event) => {
                // 阻止中键按下时的自动滚动
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(pane, docId);
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData(TAB_DRAG_TYPE, JSON.stringify({ docId, pane }));
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDropIndex(null)}
            >
              <span className={styles.title}>{title}</span>
              <button
                className={styles.close}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(pane, docId);
                }}
                title={dirty ? '未保存，关闭前将自动保存 (⌘W)' : '关闭 (⌘W)'}
                aria-label={`关闭 ${title}`}
              >
                <span className={styles.dirtyDot} />
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {showActions && (
        <div className={styles.actions}>
          <button
            className={styles.actionButton}
            onClick={onReopen}
            disabled={!canReopen}
            title="重新打开关闭的标签 (⌘⇧T)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            className={styles.actionButton}
            onClick={onToggleSplit}
            disabled={!isSplit && !group.activeId}
            title={isSplit ? '关闭分栏 (⌘\\)' : '向右分栏 (⌘\\)'}
          >
            {isSplit ? <PanelRightClose size={14} /> : <Columns2 size={14} />}
          </button>
        </div>
      )}
    </div>
  );
};

export default EditorTabs;
