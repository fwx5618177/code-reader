// ================================
// 附件呈现：图片 / 音频 / 视频经 Blob URL 内嵌播放，PDF 在应用内分页阅读，
// EPUB 在阅读模式中按章节阅读，其他文件提供“在文件夹中显示”
// ================================

import React, { forwardRef } from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import type { AttachmentKind } from '../../lib/reading';
import { useBlobUrl, usePdfDocument, type PdfDocumentState } from './hooks';
import { PdfReader, type PdfReaderHandle, type PdfReaderProps } from './PdfReader';
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

export interface PdfAttachmentProps extends Omit<PdfReaderProps, 'document'> {
  filePath: string;
  /** 由调用方打开的文档（阅读视图需要同时读取目录） */
  state: PdfDocumentState;
}

/**
 * PDF 附件：加载中、打开失败与阅读器三种状态
 */
export const PdfAttachment = forwardRef<PdfReaderHandle, PdfAttachmentProps>(function PdfAttachment(
  { filePath, state, ...readerProps },
  ref
) {
  if (state.error) return <FileCard filePath={filePath} message="无法打开 PDF，文件可能已损坏、加密或被移动" />;
  if (!state.document) return <div className={styles.mediaLoading}>正在打开 PDF…</div>;
  return <PdfReader ref={ref} document={state.document} {...readerProps} />;
});

/** 仅预览的 PDF（详情面板）：自行打开文档 */
const PdfPreview: React.FC<{ filePath: string }> = ({ filePath }) => {
  const state = usePdfDocument(filePath);
  return <PdfAttachment filePath={filePath} state={state} />;
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
      return <PdfPreview filePath={props.filePath} />;
    default:
      return (
        <div className={styles.media}>
          <MediaAttachment {...props} />
        </div>
      );
  }
};
