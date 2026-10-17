// ================================
// 阅读导航：目录（滚动联动高亮当前章节）、书签与高亮列表
// 视图内侧栏以标签页切换；应用侧栏的「章节」「书签」面板复用同一组列表
// ================================

import React, { useMemo, useState } from 'react';
import { Quote, Trash2 } from 'lucide-react';
import type { RenderedHeading } from '../../lib/markdown';
import {
  formatRelativeTime,
  type ReadingBookmark,
  type ReadingHighlight,
} from '../../lib/reading';
import styles from './ReadingView.module.scss';

/** 阅读导航所需的数据与操作 */
export interface ReadingNavProps {
  headings: RenderedHeading[];
  activeHeadingId: string | null;
  onHeadingClick: (id: string) => void;
  bookmarks: ReadingBookmark[];
  onBookmarkClick: (bookmark: ReadingBookmark) => void;
  onBookmarkDelete: (id: string) => void;
  highlights: ReadingHighlight[];
  /** 已在正文中定位到的高亮 */
  locatedHighlightIds: ReadonlySet<string>;
  onHighlightClick: (id: string) => void;
  onHighlightDelete: (id: string) => void;
}

// ================================
// 列表
// ================================

type TocListProps = Pick<ReadingNavProps, 'headings' | 'activeHeadingId' | 'onHeadingClick'>;

export const TocList: React.FC<TocListProps> = ({ headings, activeHeadingId, onHeadingClick }) => {
  // 目录缩进以文档中最高的标题级别为基准
  const minLevel = useMemo(
    () => headings.reduce((min, heading) => Math.min(min, heading.level), 6),
    [headings]
  );

  if (headings.length === 0) return <div className={styles.outlineEmpty}>此内容没有目录</div>;
  return (
    <nav aria-label="目录">
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
  );
};

type BookmarkListProps = Pick<ReadingNavProps, 'bookmarks' | 'onBookmarkClick' | 'onBookmarkDelete'>;

export const BookmarkList: React.FC<BookmarkListProps> = ({ bookmarks, onBookmarkClick, onBookmarkDelete }) => {
  if (bookmarks.length === 0) {
    return <div className={styles.outlineEmpty}>点击顶部的书签按钮，记下当前阅读位置</div>;
  }
  return (
    <>
      {bookmarks.map((bookmark) => (
        <div key={bookmark.id} className={styles.highlightCard}>
          <button className={styles.bookmarkLabel} onClick={() => onBookmarkClick(bookmark)} title="跳转到书签">
            {bookmark.label}
          </button>
          <div className={styles.highlightMeta}>
            <span>{formatRelativeTime(bookmark.createdAt)}</span>
            <span>{Math.round(bookmark.progress * 100)}%</span>
            <button
              className={styles.highlightDelete}
              onClick={() => onBookmarkDelete(bookmark.id)}
              title="删除书签"
              aria-label="删除书签"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </>
  );
};

type HighlightListProps = Pick<
  ReadingNavProps,
  'highlights' | 'locatedHighlightIds' | 'onHighlightClick' | 'onHighlightDelete'
>;

export const HighlightList: React.FC<HighlightListProps> = ({
  highlights,
  locatedHighlightIds,
  onHighlightClick,
  onHighlightDelete,
}) => {
  if (highlights.length === 0) return <div className={styles.outlineEmpty}>选中正文文字即可高亮或摘录</div>;
  return (
    <>
      {highlights.map((highlight) => {
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
              {highlight.page !== undefined && <span>第 {highlight.page} 页</span>}
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
      })}
    </>
  );
};

// ================================
// 视图内侧栏：目录 / 书签 / 高亮 标签页
// ================================

type OutlineTab = 'toc' | 'bookmarks' | 'highlights';

export const ReadingOutline: React.FC<ReadingNavProps> = (props) => {
  // 未手动切换时优先显示目录；目录可能在侧栏出现后才加载完成（PDF 书签）
  const [chosenTab, setChosenTab] = useState<OutlineTab | null>(null);
  const hasToc = props.headings.length > 0;
  const fallback: OutlineTab = hasToc ? 'toc' : 'highlights';
  const tab: OutlineTab = chosenTab === 'toc' && !hasToc ? fallback : (chosenTab ?? fallback);

  const tabs: Array<{ id: OutlineTab; label: string; count?: number }> = [
    ...(hasToc ? [{ id: 'toc' as const, label: '目录' }] : []),
    { id: 'bookmarks', label: '书签', count: props.bookmarks.length },
    { id: 'highlights', label: '高亮', count: props.highlights.length },
  ];

  return (
    <aside className={styles.outline}>
      <div className={styles.outlineTabs} role="tablist">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`${styles.outlineTab} ${tab === id ? styles.outlineTabActive : ''}`}
            onClick={() => setChosenTab(id)}
          >
            {label}
            {!!count && <span className={styles.outlineCount}>{count}</span>}
          </button>
        ))}
      </div>

      <div className={styles.outlineBody}>
        {tab === 'toc' && <TocList {...props} />}
        {tab === 'bookmarks' && <BookmarkList {...props} />}
        {tab === 'highlights' && <HighlightList {...props} />}
      </div>
    </aside>
  );
};

// ================================
// 应用侧栏：「章节」显示目录，「书签」显示书签与高亮
// ================================

export type ReadingSidebarPanel = 'chapters' | 'bookmarks';

export const ReadingSidebarNav: React.FC<ReadingNavProps & { panel: ReadingSidebarPanel }> = ({
  panel,
  ...props
}) => (
  <div className={styles.sidebarNav}>
    {panel === 'chapters' ? (
      <TocList {...props} />
    ) : (
      <>
        <div className={styles.sidebarNavHeading}>书签</div>
        <BookmarkList {...props} />
        <div className={styles.sidebarNavHeading}>高亮</div>
        <HighlightList {...props} />
      </>
    )}
  </div>
);
