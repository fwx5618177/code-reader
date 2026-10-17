// ================================
// 录音播放条：读取当前录音为 Blob URL 并自动播放
// ================================

import React from 'react';
import { X } from 'lucide-react';
import type { KnowledgeItem } from '../../types/knowledge';
import { displayTitle } from '../../lib/links/link-index';
import { useBlobUrl } from '../ReadingWorkspace/hooks';
import styles from './RecordingPlayer.module.scss';

export interface RecordingPlayerProps {
  item: KnowledgeItem;
  onClose: () => void;
}

export const RecordingPlayer: React.FC<RecordingPlayerProps> = ({ item, onClose }) => {
  const { url, error } = useBlobUrl(item.filePath, item.mimeType);
  return (
    <div className={styles.player} role="region" aria-label="正在播放">
      <div className={styles.playerHeader}>
        <span className={styles.playerTitle}>{displayTitle(item.title) || '未命名录音'}</span>
        <button type="button" className={styles.close} onClick={onClose} aria-label="关闭播放" title="关闭播放">
          <X size={13} />
        </button>
      </div>
      {error ? (
        <div className={styles.playerError}>无法读取音频文件，文件可能已被移动或删除</div>
      ) : url ? (
        <audio className={styles.audio} src={url} controls autoPlay onEnded={onClose} />
      ) : (
        <div className={styles.playerLoading}>正在读取音频…</div>
      )}
    </div>
  );
};
