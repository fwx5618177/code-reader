// ================================
// 录音管理：列出音频条目（虚拟滚动），可播放、打开详情、重命名与删除
// ================================

import React, { useCallback, useMemo, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import type { KnowledgeItem } from '../../types/knowledge';
import type { ItemActivity } from '../../lib/agent/agentStore';
import { displayTitle } from '../../lib/links/link-index';
import { useActivityByItem } from '../AgentActivity/activity';
import InputDialog, { ConfirmDialog } from '../InputDialog';
import { PanelEmpty } from './PanelEmpty';
import { RecordingPlayer } from './RecordingPlayer';
import { RecordingRow, type RecordingRowProps } from './RecordingRow';
import { listRecordings } from './recordings';
import styles from './RecordingsPanel.module.scss';

/** 行高，与 RecordingRow 样式中 .row 一致 */
const ROW_HEIGHT = 56;

export interface RecordingsPanelProps {
  items: KnowledgeItem[];
  selectedItemId?: string;
  onOpenDetails: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 操作失败时的提示 */
  onError: (message: string) => void;
}

type RowData = Omit<RecordingRowProps, 'item' | 'activity' | 'selected' | 'playing'> & {
  recordings: KnowledgeItem[];
  activityByItem: ReadonlyMap<string, ItemActivity>;
  selectedItemId?: string;
  playingId: string | null;
};

function Row({ index, style, ariaAttributes, recordings, activityByItem, selectedItemId, playingId, ...handlers }: RowComponentProps<RowData>) {
  const item = recordings[index];
  return (
    <div style={style} {...ariaAttributes}>
      <RecordingRow
        item={item}
        activity={activityByItem.get(item.id)}
        selected={item.id === selectedItemId}
        playing={item.id === playingId}
        {...handlers}
      />
    </div>
  );
}

type PendingAction = { kind: 'rename' | 'delete'; item: KnowledgeItem } | null;

export const RecordingsPanel: React.FC<RecordingsPanelProps> = ({
  items,
  selectedItemId,
  onOpenDetails,
  onRename,
  onDelete,
  onError,
}) => {
  const recordings = useMemo(() => listRecordings(items), [items]);
  const activityByItem = useActivityByItem();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const playing = playingId ? recordings.find((item) => item.id === playingId) : undefined;

  const onTogglePlay = useCallback(
    (item: KnowledgeItem) => setPlayingId((current) => (current === item.id ? null : item.id)),
    []
  );
  const onRequestRename = useCallback((item: KnowledgeItem) => setPending({ kind: 'rename', item }), []);
  const onRequestDelete = useCallback((item: KnowledgeItem) => setPending({ kind: 'delete', item }), []);

  const rowProps = useMemo<RowData>(
    () => ({
      recordings,
      activityByItem,
      selectedItemId,
      playingId,
      onTogglePlay,
      onOpenDetails,
      onRename: onRequestRename,
      onDelete: onRequestDelete,
    }),
    [recordings, activityByItem, selectedItemId, playingId, onTogglePlay, onOpenDetails, onRequestRename, onRequestDelete]
  );

  const confirmRename = (value: string) => {
    if (pending?.kind !== 'rename') return;
    const { item } = pending;
    setPending(null);
    const next = value.trim();
    const shown = displayTitle(item.title);
    if (!next || next === shown) return;
    // 只改显示部分，保留原有扩展名
    onRename(item.id, next + item.title.slice(shown.length)).catch((error) =>
      onError(`重命名失败：${error instanceof Error ? error.message : String(error)}`)
    );
  };

  const confirmDelete = () => {
    if (pending?.kind !== 'delete') return;
    const { item } = pending;
    setPending(null);
    if (playingId === item.id) setPlayingId(null);
    onDelete(item.id).catch((error) =>
      onError(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    );
  };

  return (
    <div className={styles.panel}>
      {playing && <RecordingPlayer key={playing.id} item={playing} onClose={() => setPlayingId(null)} />}

      {recordings.length === 0 ? (
        <PanelEmpty>还没有录音。点击左侧麦克风按钮或按 ⌘⇧R 开始录音</PanelEmpty>
      ) : (
        <>
          <div className={styles.summary}>共 {recordings.length} 条录音</div>
          <List
            className={styles.list}
            rowComponent={Row}
            rowCount={recordings.length}
            rowHeight={ROW_HEIGHT}
            rowProps={rowProps}
            overscanCount={4}
            aria-label="录音列表"
          />
        </>
      )}

      <InputDialog
        isOpen={pending?.kind === 'rename'}
        title="重命名录音"
        placeholder="请输入录音名称"
        defaultValue={pending?.kind === 'rename' ? displayTitle(pending.item.title) : ''}
        onConfirm={confirmRename}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        isOpen={pending?.kind === 'delete'}
        title="删除录音"
        message={`确定删除录音「${pending ? displayTitle(pending.item.title) : ''}」吗？其转写文本与摘要会一并删除。`}
        confirmText="删除"
        isDanger
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};
