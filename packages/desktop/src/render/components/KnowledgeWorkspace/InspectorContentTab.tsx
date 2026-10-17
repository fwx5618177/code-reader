// ================================
// 详情面板「原始内容」：附件预览（图片 / 音视频 / 文件）、正文、转写、书签链接
// ================================

import React, { useCallback, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { KnowledgeItem } from '../../types/knowledge';
import { renderContentToHtml } from '../../lib/markdown';
import { resolveArticle, resolveAttachmentKind, sourceHost, type ArticleSource } from '../../lib/reading';
import { displayTitle } from '../../lib/links/link-index';
import { ReadingAttachment } from '../ReadingWorkspace/ReadingAttachment';
import { openExternal } from '../ReadingWorkspace/system';
import readingStyles from '../ReadingWorkspace/ReadingView.module.scss';
import styles from './Inspector.module.scss';

/** 代码条目未使用代码块包裹时，整体作为代码块渲染 */
function articleOf(item: Pick<KnowledgeItem, 'type' | 'title' | 'content'>): ArticleSource | null {
  const article = resolveArticle(item);
  if (!article || item.type !== 'code' || article.content.includes('```')) return article;
  return { content: `\`\`\`\n${article.content}\n\`\`\``, format: 'markdown' };
}

export interface InspectorContentTabProps {
  item: KnowledgeItem;
  /** 点击正文中的 [[双向链接]] */
  onWikiLink: (target: string) => void;
}

export const InspectorContentTab: React.FC<InspectorContentTabProps> = ({ item, onWikiLink }) => {
  const attachmentKind = resolveAttachmentKind(item);
  const { type, title, content } = item;
  const html = useMemo(() => {
    const article = articleOf({ type, title, content });
    return article ? renderContentToHtml(article.content, article.format).html : null;
  }, [type, title, content]);
  const transcript = item.transcript?.trim();

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
      if (!anchor) return;
      // 阻止应用窗口内跳转：双向链接交给上层，外部链接在系统浏览器中打开
      event.preventDefault();
      const wikiTarget = anchor.getAttribute('data-wiki-target');
      if (wikiTarget !== null) {
        onWikiLink(wikiTarget);
        return;
      }
      const href = anchor.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) openExternal(href);
    },
    [onWikiLink]
  );

  if (!attachmentKind && !html && !transcript) {
    return (
      <div className={styles.tabBody}>
        {item.sourceUrl ? (
          <div className={styles.linkCard}>
            <div className={styles.linkCardBody}>
              <div className={styles.linkCardHost}>{sourceHost(item.sourceUrl)}</div>
              <div className={styles.linkCardUrl} title={item.sourceUrl}>
                {item.sourceUrl}
              </div>
            </div>
            <button
              type="button"
              className={styles.button}
              onClick={() => item.sourceUrl && openExternal(item.sourceUrl)}
            >
              <ExternalLink size={13} />
              打开链接
            </button>
          </div>
        ) : (
          <p className={styles.emptyText}>这个条目没有可显示的原始内容。</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.tabBody}>
      {attachmentKind && item.filePath && (
        <ReadingAttachment
          filePath={item.filePath}
          mimeType={item.mimeType}
          kind={attachmentKind}
          title={displayTitle(item.title)}
        />
      )}
      {transcript && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>转写</h4>
          <p className={styles.transcript}>{transcript}</p>
        </section>
      )}
      {html !== null && (
        <div
          className={`${readingStyles.article} ${styles.article}`}
          onClick={handleClick}
          // 正文由本地 Markdown 渲染器生成
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
};
