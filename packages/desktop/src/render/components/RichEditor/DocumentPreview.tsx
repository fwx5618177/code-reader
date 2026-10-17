// ================================
// 文档预览组件
// 与编辑器共用 Markdown 解析器与自研数学渲染器，预览与编辑结果一致
// ================================

import React, { useCallback, useMemo, useRef } from 'react';
import {
  renderContentToHtml,
  wikiLinkClickTarget,
  type ContentFormat,
} from '../../lib/markdown';
import { useEmbedResolver } from '../../lib/links';
import { useEmbedImages } from '../ReadingWorkspace/embed-images';
import styles from './RichEditor.module.scss';

export interface DocumentPreviewProps {
  /** 文档源内容（Markdown 或纯文本） */
  content: string;
  /** 内容格式 */
  format: ContentFormat;
  /** 文档标题（嵌入的循环检测） */
  title?: string;
  /** 点击双向链接（参数为 目标#标题 形式的引用） */
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
  title,
  onWikiLinkClick,
  className,
}) => {
  const resolveEmbed = useEmbedResolver(content);
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => renderContentToHtml(content, format, { resolveEmbed, title }).html,
    [content, format, resolveEmbed, title]
  );
  useEmbedImages(containerRef, html);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('[data-wiki-target]');
      if (!link) return;
      event.preventDefault();
      const click = wikiLinkClickTarget(link, content, format);
      if (click.kind === 'open') {
        onWikiLinkClick?.(click.ref);
      } else if (click.id) {
        // [[#标题]]：在预览内滚动
        containerRef.current?.querySelector(`[id="${click.id}"]`)?.scrollIntoView({ block: 'start' });
      }
    },
    [content, format, onWikiLinkClick]
  );

  return (
    <div
      ref={containerRef}
      className={`${styles.previewContent} ${className || ''}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default DocumentPreview;
