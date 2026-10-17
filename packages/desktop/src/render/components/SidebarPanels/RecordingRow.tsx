// ================================
// 录音列表行：标题、创建时间、时长与转写状态，悬停显示操作
// ================================

import React from 'react';
import { Info, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { KnowledgeItem } from '../../types/knowledge';
import type { ItemActivity } from '../../lib/agent/agentStore';
import { displayTitle } from '../../lib/links/link-index';
import { absoluteTime } from '../KnowledgeWorkspace/item-display';
import { recordedDurationSeconds } from '../../lib/knowledge/recording-metadata';
import { useAudioDuration } from './audio-duration';
import { formatDuration, transcriptState, TRANSCRIPT_LABELS } from './recordings';
import styles from './RecordingRow.module.scss';

export interface RecordingRowProps {
  item: KnowledgeItem;
  activity: ItemActivity | undefined;
  selected: boolean;
  playing: boolean;
  onTogglePlay: (item: KnowledgeItem) => void;
  onOpenDetails: (id: string) => void;
  onRename: (item: KnowledgeItem) => void;
  onDelete: (item: KnowledgeItem) => void;
}

export const RecordingRow: React.FC<RecordingRowProps> = ({
  item,
  activity,
  selected,
  playing,
  onTogglePlay,
  onOpenDetails,
  onRename,
  onDelete,
}) => {
  // 优先使用录音时记录的时长，缺失时才读取音频文件
  const recorded = recordedDurationSeconds(item);
  const probed = useAudioDuration(recorded === null ? item.filePath : undefined, item.mimeType);
  const duration = recorded ?? probed;
  const transcript = transcriptState(item, activity);
  const title = displayTitle(item.title) || '未命名录音';

  return (
    <div className={`${styles.row} ${selected ? styles.rowSelected : ''}`}>
      <button
        type="button"
        className={`${styles.playButton} ${playing ? styles.playButtonActive : ''}`}
        onClick={() => onTogglePlay(item)}
        disabled={!item.filePath}
        aria-label={playing ? `停止播放 ${title}` : `播放 ${title}`}
        title={item.filePath ? (playing ? '停止' : '播放') : '没有音频文件'}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button type="button" className={styles.body} onClick={() => onOpenDetails(item.id)} title={title}>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>
          <span>{absoluteTime(item.createdAt)}</span>
          <span>{duration !== null ? formatDuration(duration) : '--:--'}</span>
          <span className={styles[`transcript_${transcript}`]}>{TRANSCRIPT_LABELS[transcript]}</span>
        </span>
      </button>
      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={() => onOpenDetails(item.id)} aria-label="打开详情" title="打开详情">
          <Info size={13} />
        </button>
        <button type="button" className={styles.action} onClick={() => onRename(item)} aria-label="重命名" title="重命名">
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.actionDanger}`}
          onClick={() => onDelete(item)}
          aria-label="删除"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
};
