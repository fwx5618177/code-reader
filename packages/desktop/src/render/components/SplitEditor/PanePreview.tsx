// ================================
// 非聚焦窗格的只读预览
// 与会话是同一文档时渲染会话中的实时内容；其他文档从数据库读取，保存后（更新时间变化）重新读取
// ================================

import React, { useDeferredValue, useEffect, useState } from 'react';
import { DocumentPreview } from '../RichEditor/DocumentPreview';
import { documentService, getFileTypeId, type Document } from '../../lib/documents';
import { formatForFileType } from '../../lib/markdown';
import { displayTitle } from '../../lib/links';
import styles from './SplitEditor.module.scss';

export interface PanePreviewProps {
  docId: string;
  /** 编辑会话中的文档（实时内容） */
  sessionDocument: Document | null;
  /** 文档列表中的更新时间（毫秒），变化时重新读取 */
  updatedAt: number | undefined;
  /** 点击预览：让该窗格成为聚焦窗格并接管编辑 */
  onActivate: () => void;
}

export const PanePreview: React.FC<PanePreviewProps> = ({
  docId,
  sessionDocument,
  updatedAt,
  onActivate,
}) => {
  const live = sessionDocument?.id === docId ? sessionDocument : null;
  const isLive = live !== null;
  // document 为 null 表示文档不存在
  const [snapshot, setSnapshot] = useState<{ docId: string; document: Document | null } | null>(
    null
  );

  useEffect(() => {
    if (isLive) return;
    let cancelled = false;
    documentService
      .getDocument(docId)
      .then((document) => {
        if (!cancelled) setSnapshot({ docId, document });
      })
      .catch((error) => console.error('加载预览文档失败:', error));
    return () => {
      cancelled = true;
    };
  }, [docId, isLive, updatedAt]);

  const document = live ?? (snapshot?.docId === docId ? snapshot.document : undefined);
  // 实时内容随另一窗格的输入频繁变化，延迟渲染以免拖慢输入
  const content = useDeferredValue(document?.content ?? '');

  return (
    <div className={styles.preview} onMouseDown={onActivate} title="点击在此窗格中编辑">
      {document === undefined ? (
        <div className={styles.previewStatus}>加载中...</div>
      ) : document === null ? (
        <div className={styles.previewStatus}>文档不存在或已删除</div>
      ) : (
        <>
          <h1 className={styles.previewTitle}>{displayTitle(document.title)}</h1>
          <DocumentPreview
            content={content}
            format={formatForFileType(getFileTypeId(document.title))}
          />
        </>
      )}
    </div>
  );
};

export default PanePreview;
