// ================================
// 附件呈现：图片 / 音频 / 视频经 Blob URL 内嵌播放，PDF 在应用内分页阅读，
// EPUB 在阅读模式中按章节阅读，其他文件提供“在文件夹中显示”
// ================================

import React from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import type { AttachmentKind } from '../../lib/reading';
import { useBlobUrl, usePdfDocument } from './hooks';
import { PdfReader } from './PdfReader';
import { showInFolder } from './system';
import styles from './ReadingView.module.scss';

export interface ReadingAttachmentProps {
  filePath: string;
  mimeType?: string;
  kind: AttachmentKind;
  /** 图片替代文本 */
  title: string;
  /** PDF 页面占位完成时调用（用于恢复阅读位置） */
  onLayout?: () => void;
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

const PdfAttachment: React.FC<{ filePath: string; onLayout?: () => void }> = ({ filePath, onLayout }) => {
  const { document, error } = usePdfDocument(filePath);

  if (error) return <FileCard filePath={filePath} message="无法打开 PDF，文件可能已损坏、加密或被移动" />;
  if (!document) return <div className={styles.mediaLoading}>正在打开 PDF…</div>;
  return <PdfReader document={document} onLayout={onLayout} />;
};

export const ReadingAttachment: React.FC<ReadingAttachmentProps> = (props) => {
  switch (props.kind) {
    case 'file':
      return (
        <FileCard
          filePath={props.filePath}
          message="暂不支持在应用内预览此文件，可在文件夹中找到后用系统应用打开"
        />
      );
    case 'epub':
      return (
        <FileCard
          filePath={props.filePath}
          message="EPUB 电子书可在阅读模式（⌘3）的书架中打开，按章节阅读"
        />
      );
    case 'pdf':
      return <PdfAttachment filePath={props.filePath} onLayout={props.onLayout} />;
    default:
      return (
        <div className={styles.media}>
          <MediaAttachment {...props} />
        </div>
      );
  }
};
