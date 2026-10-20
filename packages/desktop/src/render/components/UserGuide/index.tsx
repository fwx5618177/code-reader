// ================================
// 使用指南（应用内）
// 渲染随应用打包的 docs/USER_GUIDE.md：左侧章节目录（可按关键字过滤，滚动时标出当前章节），右侧正文。
// 正文与写作预览共用 Markdown 渲染器与排版；站内锚点按 GitHub 的规则换算，外部链接在系统浏览器中打开。
// 入口：Ribbon 底部的“使用指南”、F1、菜单栏 帮助 → 使用指南、“从这里开始”卡片
// ================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import { renderContentToHtml, type RenderedDocument } from '../../lib/markdown';
import { openExternal } from '../ReadingWorkspace/system';
import { anchorIndex, anchorOf, guideOutline } from './guide-anchors';
import styles from './UserGuide.module.scss';

export interface UserGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 指南正文约 9 万字，第一次打开时才加载并渲染，之后复用 */
let rendered: Promise<RenderedDocument> | null = null;

function loadGuide(): Promise<RenderedDocument> {
  if (!rendered) {
    rendered = import('../../../../../../docs/USER_GUIDE.md?raw').then(({ default: source }) =>
      renderContentToHtml(source, 'markdown', { title: '使用指南' })
    );
    // 加载失败时允许下次打开重试
    rendered.catch(() => {
      rendered = null;
    });
  }
  return rendered;
}

const UserGuide: React.FC<UserGuideProps> = ({ isOpen, onClose }) => {
  const [guide, setGuide] = useState<RenderedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || guide) return;
    let cancelled = false;
    loadGuide().then(
      (result) => !cancelled && setGuide(result),
      (reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason))
    );
    return () => {
      cancelled = true;
    };
  }, [isOpen, guide]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  const anchors = useMemo(() => (guide ? anchorIndex(guide.headings) : new Map<string, string>()), [guide]);
  const outline = useMemo(() => (guide ? guideOutline(guide.headings, filter) : []), [guide, filter]);

  const scrollToHeading = useCallback((id: string) => {
    articleRef.current?.querySelector(`[id="${id}"]`)?.scrollIntoView({ block: 'start' });
    setCurrentId(id);
  }, []);

  // 滚动时标出当前所在的章节：最后一个顶部已越过正文顶部的章 / 节标题
  const handleScroll = useCallback(() => {
    const article = articleRef.current;
    if (!article || !guide) return;
    const top = article.getBoundingClientRect().top + 8;
    let current: string | null = null;
    for (const element of article.querySelectorAll<HTMLElement>('h2[id], h3[id]')) {
      if (element.getBoundingClientRect().top > top) break;
      current = element.id;
    }
    setCurrentId(current);
  }, [guide]);

  const handleArticleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href') ?? '';
      const anchor = anchorOf(href);
      if (anchor !== null) {
        const id = anchors.get(anchor);
        if (id) scrollToHeading(id);
      } else if (/^(https?:|mailto:)/i.test(href)) {
        openExternal(href);
      }
    },
    [anchors, scrollToHeading]
  );

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="使用指南"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.title}>
            <BookOpen size={18} />
            <h2>使用指南</h2>
          </div>
          <button className={styles.closeButton} onClick={onClose} title="关闭 (Esc)" aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className={styles.body}>
          <nav className={styles.outline} aria-label="指南目录">
            <label className={styles.filter}>
              <Search size={14} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="查找章节"
                aria-label="查找章节"
              />
            </label>
            <ul className={styles.outlineList}>
              {outline.map((heading) => (
                <li key={heading.id}>
                  <button
                    className={[
                      styles.outlineItem,
                      heading.level === 3 ? styles.outlineSection : '',
                      heading.id === currentId ? styles.outlineCurrent : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => scrollToHeading(heading.id)}
                  >
                    {heading.text}
                  </button>
                </li>
              ))}
              {guide && outline.length === 0 && <li className={styles.outlineEmpty}>没有匹配的章节</li>}
            </ul>
          </nav>

          <div className={styles.scroller} ref={articleRef} onScroll={handleScroll}>
            {guide ? (
              <article
                className={styles.article}
                onClick={handleArticleClick}
                dangerouslySetInnerHTML={{ __html: guide.html }}
              />
            ) : (
              <p className={styles.status}>{error ? `使用指南加载失败：${error}` : '正在加载…'}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserGuide;
