// ================================
// 附件呈现：图片 / 音频 / 视频经 Blob URL 内嵌播放，其他文件提供“在文件夹中显示”
// ================================

import React from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import type { AttachmentKind } from '../../lib/reading';
import { useBlobUrl } from './hooks';
import { showInFolder } from './system';
import styles from './ReadingView.module.scss';

export interface ReadingAttachmentProps {
  filePath: string;
  mimeType?: string;
  kind: AttachmentKind;
  /** 图片替代文本 */
  title: string;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/** 无法在应用内预览时的文件卡片 */
const FileCard: React.FC<{ filePath: string; message: string }> = ({ filePath, message }) => (
  <div className={styles.card}>
    <FileText size={28} className={styles.cardIcon} />
    <div className={styles.cardBody}>
      <div className={styles.cardTitle}>{fileName(filePath)}</div>
      <div className={styles.cardText}>{message}</div>
    </div>
    <button className={styles.secondaryButton} onClick={() => showInFolder(filePath)}>
      <FolderOpen size={14} />
      在文件夹中显示
    </button>
  </div>
);

const MediaAttachment: React.FC<ReadingAttachmentProps> = ({ filePath, mimeType, kind, title }) => {
  const { url, error } = useBlobUrl(filePath, mimeType);

  if (error) return <FileCard filePath={filePath} message="无法读取附件，文件可能已被移动或删除" />;
  if (!url) return <div className={styles.mediaLoading}>正在加载附件…</div>;

  switch (kind) {
    case 'image':
      return <img className={styles.mediaImage} src={url} alt={title} />;
    case 'audio':
      return <audio className={styles.mediaAudio} src={url} controls />;
    default:
      return <video className={styles.mediaVideo} src={url} controls />;
  }
};

export const ReadingAttachment: React.FC<ReadingAttachmentProps> = (props) =>
  props.kind === 'file' ? (
    <FileCard
      filePath={props.filePath}
      message="暂不支持在应用内预览此文件，可在文件夹中找到后用系统应用打开"
    />
  ) : (
    <div className={styles.media}>
      <MediaAttachment {...props} />
    </div>
  );
