// ================================
// 阅读视图
// 舒适排版的正文阅读：目录与滚动联动、阅读进度自动保存与恢复、
// 选中文字高亮或摘录到知识库、AI 导读与附件内嵌预览。
//
// 阅读状态（metadata.reading）在视图打开期间以本地状态为准：
// 每次写回都基于最新的条目元数据合并，只替换 reading 键。
// ================================

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BookMinus,
  BookOpen,
  BookPlus,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  FileAudio,
  ListTree,
  PenLine,
  RotateCcw,
  Sparkles,
  Star,
  Type,
} from 'lucide-react';
import type { UpdateKnowledgeItemInput } from '../../lib/knowledge/repository';
import { displayTitle } from '../../lib/links';
import { renderContentToHtml } from '../../lib/markdown';
import {
  applyHighlightMarks,
  buildExcerptMarkdown,
  buildExcerptTitle,
  clearHighlightMarks,
  findHighlightMark,
  finishedPatch,
  formatRelativeTime,
  getReadingState,
  getReadingStatus,
  isOnShelf,
  patchReadingState,
  progressPatch,
  READING_STATUS_LABELS,
  resolveArticle,
  resolveAttachmentKind,
  sourceHost,
  withReadingState,
  type ReadingHighlight,
  type ReadingState,
} from '../../lib/reading';
import { generateUUID } from '../../lib/utils/id';
import type { KnowledgeItem } from '../../types/knowledge';
import { useDismiss, useLatestRef, useReadingSettings } from './hooks';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from './item-type';
import { ReadingAttachment } from './ReadingAttachment';
import { ReadingOutline } from './ReadingOutline';
import { ReadingSettingsPanel } from './ReadingSettingsPanel';
import { SelectionToolbar, type SelectionAnchor } from './SelectionToolbar';
import { openExternal } from './system';
import styles from './ReadingView.module.scss';

/** 新建摘录笔记的输入 */
export interface CreateExcerptInput {
  title: string;
  /** 摘录笔记的 Markdown 内容 */
  content: string;
  sourceItemId: string;
  /** 标签名称 */
  tags: string[];
}

export interface ReadingViewProps {
  item: KnowledgeItem | null;
  onUpdateItem: (id: string, input: UpdateKnowledgeItemInput) => Promise<void>;
  /** 创建摘录笔记，返回新条目 ID */
  onCreateExcerpt: (input: CreateExcerptInput) => Promise<string>;
  /** 在写作模式中打开（仅笔记） */
  onOpenInWriting?: (itemId: string) => void;
  /** 点击正文中的 [[双向链接]] */
  onWikiLinkClick?: (target: string) => void;
}

/** 进度变化小于该值时不保存（也忽略恢复滚动位置引起的滚动事件） */
const PROGRESS_EPSILON = 0.005;
/** 停止滚动后保存进度的延迟（毫秒） */
const PROGRESS_SAVE_DELAY = 1500;
/** 选区工具栏宽度的一半，用于水平方向限位 */
const TOOLBAR_HALF_WIDTH = 160;
const NO_HIGHLIGHTS: ReadingHighlight[] = [];

/**
 * 阅读视图：未选择条目时显示引导；切换条目时整体重建，保证进度与高亮状态互不串扰
 */
export const ReadingView: React.FC<ReadingViewProps> = ({ item, ...handlers }) =>
  item ? <ReadingDocument key={item.id} item={item} {...handlers} /> : <ReadingEmptyState />;

const ReadingEmptyState: React.FC = () => (
  <div className={styles.emptyState}>
    <BookOpen size={40} className={styles.emptyIcon} />
    <h2 className={styles.emptyTitle}>从书架选择一篇内容开始阅读</h2>
    <p className={styles.emptyText}>
      网页剪藏、书签和文档会自动出现在书架上；知识库中的任何条目也可以加入书架。
    </p>
    <ul className={styles.emptyTips}>
      <li>选中文字即可高亮，或摘录为一条新的知识笔记</li>
      <li>阅读进度会自动保存，下次打开时回到上次的位置</li>
      <li>右上角“排版”可调整字体、字号、行宽与行高</li>
    </ul>
  </div>
);

// ================================
// 单个条目的阅读
// ================================

interface ReadingDocumentProps extends Omit<ReadingViewProps, 'item'> {
  item: KnowledgeItem;
}

const ReadingDocument: React.FC<ReadingDocumentProps> = ({
  item,
  onUpdateItem,
  onCreateExcerpt,
  onOpenInWriting,
  onWikiLinkClick,
}) => {
  const { settings, updateSettings, resetSettings } = useReadingSettings();
  const itemRef = useLatestRef(item);
  const onUpdateItemRef = useLatestRef(onUpdateItem);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const settingsAnchorRef = useRef<HTMLDivElement>(null);

  // ---------- 阅读状态 ----------

  const [reading, setReading] = useState<ReadingState>(() => getReadingState(item));
  const readingRef = useRef(reading);

  const updateReading = useCallback(
    (patch: Partial<ReadingState>): Promise<void> => {
      const next = patchReadingState(readingRef.current, patch);
      readingRef.current = next;
      setReading(next);
      const current = itemRef.current;
      return onUpdateItemRef.current(current.id, {
        metadata: withReadingState(current.metadata, next),
      });
    },
    [itemRef, onUpdateItemRef]
  );

  const status = getReadingStatus(reading);
  // 书架归属同样以本地阅读状态为准
  const onShelf = isOnShelf({ type: item.type, metadata: withReadingState(undefined, reading) });
  const highlights = reading.highlights ?? NO_HIGHLIGHTS;

  // ---------- 正文 ----------

  const rendered = useMemo(() => {
    const article = resolveArticle(item);
    return article ? renderContentToHtml(article.content, article.format) : null;
  }, [item.type, item.title, item.content]);

  const attachmentKind = resolveAttachmentKind(item);
  const showTranscript = item.type === 'audio' && !!item.transcript;
  const showGuide = !!item.summary || (item.keyPoints?.length ?? 0) > 0;

  const [outlineOpen, setOutlineOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [locatedHighlightIds, setLocatedHighlightIds] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useDismiss(settingsAnchorRef, closeSettings, settingsOpen);

  const setProgressBar = useCallback((ratio: number) => {
    progressBarRef.current?.style.setProperty('--reading-progress', String(ratio));
  }, []);

  useLayoutEffect(() => {
    setProgressBar(readingRef.current.progress ?? 0);
  }, [setProgressBar]);

  // 正文由 DOM 直接管理（高亮标记会改写文本节点），仅在内容变化时重建；
  // 首次渲染时恢复上次的阅读位置（已读完的从头开始）
  const restoredRef = useRef(false);
  useLayoutEffect(() => {
    const articleEl = articleRef.current;
    const scroller = scrollerRef.current;
    if (!articleEl || !scroller || !rendered) return;
    articleEl.innerHTML = rendered.html;

    if (restoredRef.current) return;
    restoredRef.current = true;
    const { progress = 0 } = readingRef.current;
    if (getReadingStatus(readingRef.current) === 'reading' && progress > 0) {
      scroller.scrollTop = progress * (scroller.scrollHeight - scroller.clientHeight);
    }
  }, [rendered]);

  // 高亮变化时重新标记（必须在写入正文之后执行）
  useLayoutEffect(() => {
    const articleEl = articleRef.current;
    if (!articleEl || !rendered) return;
    clearHighlightMarks(articleEl);
    setLocatedHighlightIds(applyHighlightMarks(articleEl, highlights, styles.highlightMark));
  }, [rendered, highlights]);

  // ---------- 目录滚动联动 ----------

  useEffect(() => {
    const scroller = scrollerRef.current;
    const articleEl = articleRef.current;
    const headings = rendered?.headings ?? [];
    if (!scroller || !articleEl || headings.length === 0) return;

    const elements = headings
      .map((heading) => articleEl.querySelector<HTMLElement>(`[id="${heading.id}"]`))
      .filter((element): element is HTMLElement => element !== null);
    const visible = new Set<string>();

    // 观察区域为视口上部 30%：区域内第一个标题即当前章节；
    // 区域内没有标题时（长章节中部），取已滚过顶部的最后一个标题
    const pickActive = (): string | null => {
      const first = headings.find((heading) => visible.has(heading.id));
      if (first) return first.id;
      const top = scroller.getBoundingClientRect().top;
      let current: string | null = null;
      for (const element of elements) {
        if (element.getBoundingClientRect().top >= top) break;
        current = element.id;
      }
      return current;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        setActiveHeadingId(pickActive());
      },
      { root: scroller, rootMargin: '0px 0px -70% 0px' }
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [rendered]);

  const scrollToHeading = useCallback((id: string) => {
    articleRef.current
      ?.querySelector<HTMLElement>(`[id="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveHeadingId(id);
  }, []);

  // ---------- 阅读进度 ----------

  const pendingProgressRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);

  const cancelPendingProgress = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    pendingProgressRef.current = null;
  }, []);

  const flushProgress = useCallback(() => {
    const pending = pendingProgressRef.current;
    cancelPendingProgress();
    if (pending === null) return;
    updateReading(progressPatch(readingRef.current, pending)).catch((error) =>
      console.error('[Reading] 保存阅读进度失败:', error)
    );
  }, [cancelPendingProgress, updateReading]);

  // 离开条目时保存尚未写回的进度
  useEffect(() => flushProgress, [flushProgress]);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const ratio = max > 0 ? scroller.scrollTop / max : 1;
    setProgressBar(ratio);

    if (Math.abs(ratio - (readingRef.current.progress ?? 0)) < PROGRESS_EPSILON) {
      cancelPendingProgress();
      return;
    }
    pendingProgressRef.current = ratio;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushProgress, PROGRESS_SAVE_DELAY);
  }, [cancelPendingProgress, flushProgress, setProgressBar]);

  const toggleFinished = useCallback(() => {
    cancelPendingProgress();
    const finished = getReadingStatus(readingRef.current) !== 'finished';
    setProgressBar(finished ? 1 : 0);
    updateReading(finishedPatch(finished)).catch((error) =>
      console.error('[Reading] 更新阅读状态失败:', error)
    );
  }, [cancelPendingProgress, setProgressBar, updateReading]);

  // ---------- 高亮与摘录 ----------

  const handleSelectionEnd = useCallback(() => {
    const articleEl = articleRef.current;
    const contentEl = contentRef.current;
    const selection = window.getSelection();
    if (!articleEl || !contentEl || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionAnchor(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (!text || !articleEl.contains(range.commonAncestorContainer)) {
      setSelectionAnchor(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const base = contentEl.getBoundingClientRect();
    const center = rect.left + rect.width / 2 - base.left;
    setSelectionAnchor({
      text,
      top: rect.top - base.top,
      bottom: rect.bottom - base.top,
      left: Math.min(Math.max(center, TOOLBAR_HALF_WIDTH), base.width - TOOLBAR_HALF_WIDTH),
    });
  }, []);

  const dismissSelection = useCallback(() => setSelectionAnchor(null), []);

  const addHighlight = useCallback(
    (highlight: Omit<ReadingHighlight, 'id' | 'createdAt'>) => {
      window.getSelection()?.removeAllRanges();
      return updateReading({
        highlights: [
          ...(readingRef.current.highlights ?? []),
          { id: generateUUID(), createdAt: new Date().toISOString(), ...highlight },
        ],
      });
    },
    [updateReading]
  );

  const createExcerpt = useCallback(
    async (quote: string, note: string, tags: string[]) => {
      const current = itemRef.current;
      const trimmedNote = note.trim();
      const excerptItemId = await onCreateExcerpt({
        title: buildExcerptTitle(quote),
        content: buildExcerptMarkdown({
          quote,
          note: trimmedNote,
          source: { title: current.title, sourceUrl: current.sourceUrl },
        }),
        sourceItemId: current.id,
        tags,
      });
      await addHighlight({
        text: quote,
        excerptItemId,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
    },
    [addHighlight, itemRef, onCreateExcerpt]
  );

  const deleteHighlight = useCallback(
    (id: string) => {
      const remaining = (readingRef.current.highlights ?? []).filter((highlight) => highlight.id !== id);
      updateReading({ highlights: remaining.length > 0 ? remaining : undefined }).catch((error) =>
        console.error('[Reading] 删除高亮失败:', error)
      );
    },
    [updateReading]
  );

  const scrollToHighlight = useCallback((id: string) => {
    const articleEl = articleRef.current;
    if (articleEl) findHighlightMark(articleEl, id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // ---------- 正文链接 ----------

  const handleArticleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
      if (!anchor) return;
      // 阻止应用窗口内跳转：双向链接交给上层，外部链接在系统浏览器中打开
      event.preventDefault();
      const wikiTarget = anchor.getAttribute('data-wiki-target');
      if (wikiTarget !== null) {
        onWikiLinkClick?.(wikiTarget);
        return;
      }
      const href = anchor.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) openExternal(href);
    },
    [onWikiLinkClick]
  );

  // ---------- 渲染 ----------

  const typography = {
    '--reading-font-size': `${settings.fontSize}px`,
    '--reading-line-height': String(settings.lineHeight),
    '--reading-line-width': `${settings.lineWidth}px`,
  } as React.CSSProperties;

  const { sourceUrl } = item;
  const TypeIcon = ITEM_TYPE_ICONS[item.type];
  const hasBody = !!rendered || !!attachmentKind || !!sourceUrl || showTranscript || showGuide;

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h1 className={styles.title} title={displayTitle(item.title)}>
            {displayTitle(item.title)}
          </h1>
          <div className={styles.meta}>
            <span className={styles.metaItem}>
              <TypeIcon size={12} />
              {ITEM_TYPE_LABELS[item.type]}
            </span>
            <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
              {READING_STATUS_LABELS[status]}
            </span>
            {reading.lastReadAt && (
              <span className={styles.metaItem}>上次阅读 {formatRelativeTime(reading.lastReadAt)}</span>
            )}
            {sourceUrl && (
              <button className={styles.sourceLink} onClick={() => openExternal(sourceUrl)} title={sourceUrl}>
                <ExternalLink size={12} />
                {sourceHost(sourceUrl)}
              </button>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          {rendered && (
            <button
              className={`${styles.iconButton} ${outlineOpen ? styles.iconButtonActive : ''}`}
              onClick={() => setOutlineOpen((open) => !open)}
              title={outlineOpen ? '隐藏目录与高亮' : '显示目录与高亮'}
            >
              <ListTree size={16} />
            </button>
          )}
          <div ref={settingsAnchorRef} className={styles.popoverAnchor}>
            <button
              className={`${styles.iconButton} ${settingsOpen ? styles.iconButtonActive : ''}`}
              onClick={() => setSettingsOpen((open) => !open)}
              title="排版"
            >
              <Type size={16} />
            </button>
            {settingsOpen && (
              <ReadingSettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
            )}
          </div>
          <button
            className={styles.iconButton}
            onClick={toggleFinished}
            title={status === 'finished' ? '标记为未读' : '标记为已读'}
          >
            {status === 'finished' ? <RotateCcw size={16} /> : <CircleCheck size={16} />}
          </button>
          <button
            className={`${styles.iconButton} ${item.isFavorite ? styles.favoriteActive : ''}`}
            onClick={() =>
              onUpdateItem(item.id, { isFavorite: !item.isFavorite }).catch((error) =>
                console.error('[Reading] 更新收藏失败:', error)
              )
            }
            title={item.isFavorite ? '取消收藏' : '收藏'}
          >
            <Star size={16} />
          </button>
          {item.type === 'note' && onOpenInWriting && (
            <button className={styles.iconButton} onClick={() => onOpenInWriting(item.id)} title="在写作中打开">
              <PenLine size={16} />
            </button>
          )}
          <button
            className={styles.iconButton}
            onClick={() =>
              updateReading({ inShelf: !onShelf }).catch((error) =>
                console.error('[Reading] 更新书架失败:', error)
              )
            }
            title={onShelf ? '移出书架' : '加入书架'}
          >
            {onShelf ? <BookMinus size={16} /> : <BookPlus size={16} />}
          </button>
        </div>
        <div className={styles.progressBar} ref={progressBarRef} />
      </header>

      <div className={styles.body}>
        <div className={styles.scroller} ref={scrollerRef} onScroll={handleScroll}>
          <div
            ref={contentRef}
            className={styles.page}
            data-font={settings.fontFamily}
            style={typography}
          >
            {showGuide && (
              <CollapsibleSection icon={<Sparkles size={14} />} title="AI 导读">
                {item.summary && <p className={styles.guideSummary}>{item.summary}</p>}
                {item.keyPoints && item.keyPoints.length > 0 && (
                  <ul className={styles.guidePoints}>
                    {item.keyPoints.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                )}
              </CollapsibleSection>
            )}

            {attachmentKind && item.filePath && (
              <ReadingAttachment
                filePath={item.filePath}
                mimeType={item.mimeType}
                kind={attachmentKind}
                title={displayTitle(item.title)}
              />
            )}

            {showTranscript && (
              <CollapsibleSection icon={<FileAudio size={14} />} title="转写文本">
                <div className={styles.transcript}>{item.transcript}</div>
              </CollapsibleSection>
            )}

            {rendered ? (
              <div
                ref={articleRef}
                className={styles.article}
                onClick={handleArticleClick}
                onMouseUp={handleSelectionEnd}
              />
            ) : (
              !attachmentKind &&
              sourceUrl && (
                <div className={styles.card}>
                  <ExternalLink size={24} className={styles.cardIcon} />
                  <div className={styles.cardBody}>
                    <div className={styles.cardTitle}>{sourceHost(sourceUrl)}</div>
                    <div className={styles.cardText}>{sourceUrl}</div>
                  </div>
                  <button className={styles.primaryButton} onClick={() => openExternal(sourceUrl)}>
                    在浏览器中打开
                  </button>
                </div>
              )
            )}

            {!hasBody && <div className={styles.noContent}>此条目没有可阅读的内容</div>}

            {selectionAnchor && (
              <SelectionToolbar
                anchor={selectionAnchor}
                onHighlight={() => addHighlight({ text: selectionAnchor.text })}
                onExcerpt={(note, tags) => createExcerpt(selectionAnchor.text, note, tags)}
                onDismiss={dismissSelection}
              />
            )}
          </div>
        </div>

        {rendered && outlineOpen && (
          <ReadingOutline
            headings={rendered.headings}
            activeHeadingId={activeHeadingId}
            onHeadingClick={scrollToHeading}
            highlights={highlights}
            locatedHighlightIds={locatedHighlightIds}
            onHighlightClick={scrollToHighlight}
            onHighlightDelete={deleteHighlight}
          />
        )}
      </div>
    </div>
  );
};

// ================================
// 可折叠区块（AI 导读、转写文本）
// ================================

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ icon, title, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className={styles.section}>
      <button className={styles.sectionHeader} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        <span>{title}</span>
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
};

export default ReadingView;
