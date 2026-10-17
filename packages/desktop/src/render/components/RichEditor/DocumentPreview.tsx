// ================================
// 文档预览组件
// 与编辑器共用 Markdown 解析器与自研数学渲染器，预览与编辑结果一致
// ================================

import React, { useCallback, useMemo } from 'react';
import { renderContentToHtml, type ContentFormat } from '../../lib/markdown';
import styles from './RichEditor.module.scss';

export interface DocumentPreviewProps {
  /** 文档源内容（Markdown 或纯文本） */
  content: string;
  /** 内容格式 */
  format: ContentFormat;
  /** 点击双向链接 */
  onWikiLinkClick?: (target: string) => void;
  /** 自定义类名 */
  className?: string;
}

/**
 * 文档预览组件
 */
export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  content,
  format,
  onWikiLinkClick,
  className,
}) => {
  const html = useMemo(() => renderContentToHtml(content, format).html, [content, format]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('[data-wiki-target]');
      if (link && onWikiLinkClick) {
        event.preventDefault();
        onWikiLinkClick(link.dataset.wikiTarget || '');
      }
    },
    [onWikiLinkClick]
  );

  return (
    <div
      className={`${styles.previewContent} ${className || ''}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default DocumentPreview;
