// ================================
// 阅读侧栏：目录（滚动联动高亮当前章节）与高亮列表
// ================================

import React, { useMemo, useState } from 'react';
import { Quote, Trash2 } from 'lucide-react';
import type { RenderedHeading } from '../../lib/markdown';
import { formatRelativeTime, type ReadingHighlight } from '../../lib/reading';
import styles from './ReadingView.module.scss';

export interface ReadingOutlineProps {
  headings: RenderedHeading[];
  activeHeadingId: string | null;
  onHeadingClick: (id: string) => void;
  highlights: ReadingHighlight[];
  /** 已在正文中定位到的高亮 */
  locatedHighlightIds: ReadonlySet<string>;
  onHighlightClick: (id: string) => void;
  onHighlightDelete: (id: string) => void;
}

type OutlineTab = 'toc' | 'highlights';

export const ReadingOutline: React.FC<ReadingOutlineProps> = ({
  headings,
  activeHeadingId,
  onHeadingClick,
  highlights,
  locatedHighlightIds,
  onHighlightClick,
  onHighlightDelete,
}) => {
  const [tab, setTab] = useState<OutlineTab>(headings.length > 0 ? 'toc' : 'highlights');

  // 目录缩进以文档中最高的标题级别为基准
  const minLevel = useMemo(
    () => headings.reduce((min, heading) => Math.min(min, heading.level), 6),
    [headings]
  );

  return (
    <aside className={styles.outline}>
      <div className={styles.outlineTabs} role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'toc'}
          className={`${styles.outlineTab} ${tab === 'toc' ? styles.outlineTabActive : ''}`}
          onClick={() => setTab('toc')}
        >
          目录
        </button>
        <button
          role="tab"
          aria-selected={tab === 'highlights'}
          className={`${styles.outlineTab} ${tab === 'highlights' ? styles.outlineTabActive : ''}`}
          onClick={() => setTab('highlights')}
        >
          高亮
          {highlights.length > 0 && <span className={styles.outlineCount}>{highlights.length}</span>}
        </button>
      </div>

      <div className={styles.outlineBody}>
        {tab === 'toc' ? (
          headings.length === 0 ? (
            <div className={styles.outlineEmpty}>正文没有标题</div>
          ) : (
            <nav>
              {headings.map((heading) => (
                <button
                  key={heading.id}
                  className={`${styles.tocItem} ${heading.id === activeHeadingId ? styles.tocItemActive : ''}`}
                  data-depth={heading.level - minLevel}
                  onClick={() => onHeadingClick(heading.id)}
                  title={heading.text}
                >
                  {heading.text}
                </button>
              ))}
            </nav>
          )
        ) : highlights.length === 0 ? (
          <div className={styles.outlineEmpty}>选中正文文字即可高亮或摘录</div>
        ) : (
          highlights.map((highlight) => {
            const located = locatedHighlightIds.has(highlight.id);
            return (
              <div key={highlight.id} className={styles.highlightCard}>
                <button
                  className={styles.highlightText}
                  onClick={() => onHighlightClick(highlight.id)}
                  disabled={!located}
                  title={located ? '跳转到原文' : undefined}
                >
                  {highlight.text}
                </button>
                {highlight.note && <div className={styles.highlightNote}>{highlight.note}</div>}
                <div className={styles.highlightMeta}>
                  <span>{formatRelativeTime(highlight.createdAt)}</span>
                  {highlight.excerptItemId && (
                    <span className={styles.highlightBadge}>
                      <Quote size={10} />
                      已摘录
                    </span>
                  )}
                  {!located && <span className={styles.highlightMissing}>未在正文中定位</span>}
                  <button
                    className={styles.highlightDelete}
                    onClick={() => onHighlightDelete(highlight.id)}
                    title="删除高亮"
                    aria-label="删除高亮"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
