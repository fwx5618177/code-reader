// ================================
// 阅读视图
// 舒适排版的正文阅读：目录与滚动联动、阅读进度自动保存与恢复、
// 选中文字高亮或摘录到知识库、AI 导读与附件内嵌预览。
// PDF 在应用内分页阅读：目录来自文档书签，高亮按页保存并在该页渲染后标记。
//
// 阅读状态（metadata.reading）在视图打开期间以本地状态为准：
// 每次写回都基于最新的条目元数据合并，只替换 reading 键。
// ================================

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookMinus,
  BookOpen,
  BookPlus,
  Bookmark,
  ChevronDown,
  ChevronLeft,
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
import { displayTitle, useEmbedResolver } from '../../lib/links';
import { flashElement } from '../../lib/editor/reveal-highlight';
import {
  linkAnchorId,
  renderContentToHtml,
  wikiLinkClickTarget,
  type RenderedDocument,
} from '../../lib/markdown';
import {
  addBookmark,
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
  segmentPageRange,
  sourceHost,
  withReadingState,
  type ReadingBookmark,
  type ReadingHighlight,
  type ReadingState,
} from '../../lib/reading';
import { generateUUID } from '../../lib/utils/id';
import { isWritingDocument } from '../../lib/documents/constants';
import { bookProgress, EPUB_TARGET_ATTR } from '../../lib/reading/epub';
import { registerFlush } from '../../services/flushRegistry';
import type { KnowledgeItem } from '../../types/knowledge';
import { useDismiss, useLatestRef, useReadingSettings } from './hooks';
import { hydrateEmbedMedia } from './embed-media';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from './item-type';
import { PdfAttachment, ReadingAttachment } from './ReadingAttachment';
import type { PdfTextSelection } from './PdfReader';
import {
  ReadingOutline,
  ReadingSidebarNav,
  type ReadingNavProps,
  type ReadingSidebarPanel,
} from './ReadingOutline';
import { ReadingSettingsPanel } from './ReadingSettingsPanel';
import {
  HighlightToolbar,
  SelectionToolbar,
  type SelectionAnchor,
  type ToolbarAnchor,
} from './SelectionToolbar';
import { openExternal } from './system';
import { isEpubChapterView, useEpubReader, type EpubScrollTarget } from './useEpubReader';
import { usePdfOcr } from './usePdfOcr';
import { usePdfReader } from './usePdfReader';
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
  /**
   * 通过 [[文档#标题]] / [[文档#^块]] 打开时要定位的标题（occurrence 为同名标题序号）或 ^块 ID；
   * 每个请求对象只定位一次
   */
  revealTarget?: { heading: string; occurrence?: number } | null;
  /** 应用侧栏当前显示的阅读导航面板；设置且有挂载点时导航渲染到侧栏，视图内侧栏隐藏 */
  navPanel?: ReadingSidebarPanel | null;
  /** 应用侧栏中的导航挂载点 */
  navTarget?: HTMLElement | null;
}

/** 进度变化小于该值时不保存（也忽略恢复滚动位置引起的滚动事件） */
const PROGRESS_EPSILON = 0.005;
/** 停止滚动后保存进度的延迟（毫秒） */
const PROGRESS_SAVE_DELAY = 1500;
/** 选区工具栏宽度的一半，用于水平方向限位 */
const TOOLBAR_HALF_WIDTH = 160;
const NO_HIGHLIGHTS: ReadingHighlight[] = [];
const NO_BOOKMARKS: ReadingBookmark[] = [];

/** 已执行的定位请求（视图重建或正文更新后不重复滚动） */
const revealedRequests = new WeakSet<object>();

/** 滚动到正文中的锚点并短暂高亮 */
function revealAnchor(articleEl: HTMLElement, id: string): void {
  const element = articleEl.querySelector<HTMLElement>(`[id="${id}"]`);
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  flashElement(element);
}

/** EPUB 章节写入后滚动到目标元素或章节内比例位置 */
function scrollToEpubTarget(scroller: HTMLElement, articleEl: HTMLElement, target: EpubScrollTarget): void {
  if ('elementId' in target) {
    const element = Array.from(articleEl.querySelectorAll('[id]')).find((el) => el.id === target.elementId);
    (element ?? articleEl).scrollIntoView({ block: 'start' });
    return;
  }
  scroller.scrollTop = target.ratio * (scroller.scrollHeight - scroller.clientHeight);
}

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
  revealTarget,
  navPanel,
  navTarget,
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
  const bookmarks = reading.bookmarks ?? NO_BOOKMARKS;

  // ---------- 正文 ----------

  const resolveEmbed = useEmbedResolver(item.content);
  const previousRenderedRef = useRef<RenderedDocument | null>(null);
  const markdownRendered = useMemo(() => {
    const article = resolveArticle(item);
    if (!article) return null;
    const next = renderContentToHtml(article.content, article.format, { resolveEmbed, title: item.title });
    // 条目列表更新（如阅读进度写回）会生成新的解析器；结果不变时沿用旧对象，避免重写正文
    const previous = previousRenderedRef.current;
    return previous && previous.html === next.html ? previous : next;
  }, [item.type, item.title, item.content, resolveEmbed]);
  previousRenderedRef.current = markdownRendered;

  const attachmentKind = resolveAttachmentKind(item);
  // EPUB 按章节渲染为正文；仅“在读”状态从上次位置继续（已读完的从头开始）
  const epub = useEpubReader(
    attachmentKind === 'epub' ? item.filePath : undefined,
    getReadingStatus(readingRef.current) === 'reading' ? readingRef.current.progress ?? 0 : 0
  );
  const epubRef = useLatestRef(epub);
  const pdf = usePdfReader(attachmentKind === 'pdf' ? item.filePath : undefined);
  const { readerRef: pdfReaderRef } = pdf;
  // 扫描页识别结果追加到条目正文（PDF 的正文只用于全文检索）
  const ocr = usePdfOcr({
    itemId: item.id,
    document: pdf.file.document ?? undefined,
    getContent: () => itemRef.current.content ?? '',
    saveContent: (content) => onUpdateItemRef.current(itemRef.current.id, { content }),
  });
  const rendered: RenderedDocument | null = epub.view ?? markdownRendered;
  const showTranscript = item.type === 'audio' && !!item.transcript;
  const showGuide = !!item.summary || (item.keyPoints?.length ?? 0) > 0;

  const [outlineOpen, setOutlineOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [locatedHighlightIds, setLocatedHighlightIds] = useState<ReadonlySet<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  /** 点击选中的高亮（PDF）及其工具栏位置 */
  const [selectedHighlight, setSelectedHighlight] = useState<{ id: string; anchor: ToolbarAnchor } | null>(null);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useDismiss(settingsAnchorRef, closeSettings, settingsOpen);

  const setProgressBar = useCallback((ratio: number) => {
    progressBarRef.current?.style.setProperty('--reading-progress', String(ratio));
  }, []);

  useLayoutEffect(() => {
    setProgressBar(readingRef.current.progress ?? 0);
  }, [setProgressBar]);

  // 正文由 DOM 直接管理（高亮标记会改写文本节点），仅在内容变化时重建。
  // 首次呈现时恢复上次的阅读位置（已读完的从头开始）；PDF 在页面占位完成后恢复
  const restoredRef = useRef(false);
  const restoreScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || restoredRef.current) return;
    restoredRef.current = true;
    const { progress = 0 } = readingRef.current;
    if (getReadingStatus(readingRef.current) === 'reading' && progress > 0) {
      scroller.scrollTop = progress * (scroller.scrollHeight - scroller.clientHeight);
    }
  }, []);

  useLayoutEffect(() => {
    const articleEl = articleRef.current;
    const scroller = scrollerRef.current;
    if (!articleEl || !scroller || !rendered) return;
    articleEl.innerHTML = rendered.html;
    const disposeMedia = hydrateEmbedMedia(articleEl);

    // EPUB 每次切换章节都滚动到跳转目标
    if (isEpubChapterView(rendered)) scrollToEpubTarget(scroller, articleEl, rendered.scrollTarget);
    else restoreScroll();
    return disposeMedia;
  }, [rendered, restoreScroll]);

  // 高亮变化时重新标记（必须在写入正文之后执行）
  useLayoutEffect(() => {
    const articleEl = articleRef.current;
    if (!articleEl || !rendered) return;
    clearHighlightMarks(articleEl);
    setLocatedHighlightIds(applyHighlightMarks(articleEl, highlights, styles.highlightMark));
  }, [rendered, highlights]);

  // 通过 [[文档#标题]] / [[文档#^块]] 打开时定位锚点（在写入正文与恢复阅读位置之后执行）
  useEffect(() => {
    const articleEl = articleRef.current;
    if (!articleEl || !markdownRendered || !revealTarget || revealedRequests.has(revealTarget)) return;
    revealedRequests.add(revealTarget);
    const article = resolveArticle(itemRef.current);
    const id = article && linkAnchorId(article.content, article.format, revealTarget.heading, revealTarget.occurrence);
    if (id) revealAnchor(articleEl, id);
  }, [markdownRendered, revealTarget, itemRef]);

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

  const flushProgress = useCallback(async (): Promise<void> => {
    const pending = pendingProgressRef.current;
    cancelPendingProgress();
    if (pending === null) return;
    await updateReading(progressPatch(readingRef.current, pending)).catch((error) =>
      console.error('[Reading] 保存阅读进度失败:', error)
    );
  }, [cancelPendingProgress, updateReading]);

  // 切换知识库、关闭窗口、退出前以及离开条目时，保存尚未写回的进度
  useEffect(() => {
    const unregister = registerFlush(flushProgress);
    return () => {
      unregister();
      void flushProgress();
    };
  }, [flushProgress]);

  /** 当前滚动位置对应的整本书进度 */
  const currentProgress = useCallback((): number | null => {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const ratio = max > 0 ? scroller.scrollTop / max : 1;
    // EPUB 的滚动比例只是当前章节内的位置，换算为整本书的进度
    const { view, chapterCount } = epubRef.current;
    return view ? bookProgress(view.chapterIndex, chapterCount, ratio) : ratio;
  }, [epubRef]);

  const handleScroll = useCallback(() => {
    const progress = currentProgress();
    if (progress === null) return;
    setProgressBar(progress);

    if (Math.abs(progress - (readingRef.current.progress ?? 0)) < PROGRESS_EPSILON) {
      cancelPendingProgress();
      return;
    }
    pendingProgressRef.current = progress;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushProgress, PROGRESS_SAVE_DELAY);
  }, [cancelPendingProgress, currentProgress, flushProgress, setProgressBar]);

  const toggleFinished = useCallback(() => {
    cancelPendingProgress();
    const finished = getReadingStatus(readingRef.current) !== 'finished';
    setProgressBar(finished ? 1 : 0);
    updateReading(finishedPatch(finished)).catch((error) =>
      console.error('[Reading] 更新阅读状态失败:', error)
    );
  }, [cancelPendingProgress, setProgressBar, updateReading]);

  // ---------- 高亮与摘录 ----------

  /** 工具栏锚点：视口坐标换算为相对正文内容容器，水平方向限位 */
  const toolbarAnchor = useCallback((rect: DOMRect): ToolbarAnchor | null => {
    const contentEl = contentRef.current;
    if (!contentEl) return null;
    const base = contentEl.getBoundingClientRect();
    const center = rect.left + rect.width / 2 - base.left;
    return {
      top: rect.top - base.top,
      bottom: rect.bottom - base.top,
      left: Math.min(Math.max(center, TOOLBAR_HALF_WIDTH), base.width - TOOLBAR_HALF_WIDTH),
    };
  }, []);

  /** 在选区（视口坐标）上方显示工具栏 */
  const showSelectionToolbar = useCallback(
    (rect: DOMRect, text: string, segments?: SelectionAnchor['segments']) => {
      const anchor = toolbarAnchor(rect);
      if (anchor) setSelectionAnchor({ ...anchor, text, segments });
    },
    [toolbarAnchor]
  );

  const handleSelectionEnd = useCallback(() => {
    const articleEl = articleRef.current;
    const selection = window.getSelection();
    if (!articleEl || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionAnchor(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (!text || !articleEl.contains(range.commonAncestorContainer)) {
      setSelectionAnchor(null);
      return;
    }
    showSelectionToolbar(range.getBoundingClientRect(), text);
  }, [showSelectionToolbar]);

  const handlePdfTextSelect = useCallback(
    (selection: PdfTextSelection | null) => {
      if (selection) showSelectionToolbar(selection.rect, selection.text, selection.segments);
      else setSelectionAnchor(null);
    },
    [showSelectionToolbar]
  );

  // 点击高亮的任一片段：选中整条高亮并在被点击的片段旁显示工具栏
  const handlePdfHighlightClick = useCallback(
    (id: string, rect: DOMRect) => {
      const anchor = toolbarAnchor(rect);
      setSelectionAnchor(null);
      setSelectedHighlight(anchor ? { id, anchor } : null);
    },
    [toolbarAnchor]
  );

  const dismissSelectedHighlight = useCallback(() => setSelectedHighlight(null), []);

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
    async ({ text: quote, segments }: SelectionAnchor, note: string, tags: string[]) => {
      const current = itemRef.current;
      const trimmedNote = note.trim();
      const excerptItemId = await onCreateExcerpt({
        title: buildExcerptTitle(quote),
        content: buildExcerptMarkdown({
          quote,
          note: trimmedNote,
          source: { title: current.title, sourceUrl: current.sourceUrl },
          pages: segmentPageRange(segments),
        }),
        sourceItemId: current.id,
        tags,
      });
      await addHighlight({
        text: quote,
        segments,
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

  // PDF 高亮按首个片段所在页定位（所在页可能尚未渲染），其他正文直接查找标记
  const scrollToHighlight = useCallback(
    (id: string) => {
      const highlight = readingRef.current.highlights?.find((candidate) => candidate.id === id);
      const pages = segmentPageRange(highlight?.segments);
      if (pages) {
        pdfReaderRef.current?.scrollToHighlight(id, pages.first);
        return;
      }
      const articleEl = articleRef.current;
      if (articleEl) findHighlightMark(articleEl, id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [pdfReaderRef]
  );

  // PDF 高亮只在所在页渲染时才有标记，带页面片段即可跳转
  const pdfHighlightIds = useMemo<ReadonlySet<string>>(
    () => new Set(highlights.filter((highlight) => highlight.segments).map((highlight) => highlight.id)),
    [highlights]
  );

  // ---------- 书签 ----------

  /** PDF 按页跳转，EPUB 按整本书进度切换章节，其他正文按滚动比例 */
  const openBookmark = useCallback(
    (bookmark: ReadingBookmark) => {
      if (bookmark.page !== undefined && pdfReaderRef.current) {
        pdfReaderRef.current.scrollToPage(bookmark.page);
        return;
      }
      if (epubRef.current.view) {
        epubRef.current.goToProgress(bookmark.progress);
        return;
      }
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollTop = bookmark.progress * (scroller.scrollHeight - scroller.clientHeight);
    },
    [pdfReaderRef, epubRef]
  );

  const deleteBookmark = useCallback(
    (id: string) => {
      const remaining = (readingRef.current.bookmarks ?? []).filter((bookmark) => bookmark.id !== id);
      updateReading({ bookmarks: remaining.length > 0 ? remaining : undefined }).catch((error) =>
        console.error('[Reading] 删除书签失败:', error)
      );
    },
    [updateReading]
  );

  // ---------- 正文链接 ----------

  const handleArticleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
      if (!anchor) return;
      // 阻止应用窗口内跳转：双向链接交给上层，EPUB 书内链接跳转到对应章节，外部链接在系统浏览器中打开
      event.preventDefault();
      const epubTarget = anchor.getAttribute(EPUB_TARGET_ATTR);
      if (epubTarget !== null) {
        epubRef.current.openTarget(epubTarget);
        return;
      }
      if (anchor.hasAttribute('data-wiki-target')) {
        const article = resolveArticle(itemRef.current);
        const click = wikiLinkClickTarget(anchor, article?.content ?? '', article?.format ?? 'markdown');
        if (click.kind === 'open') onWikiLinkClick?.(click.ref);
        else if (click.id && articleRef.current) revealAnchor(articleRef.current, click.id);
        return;
      }
      const href = anchor.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) openExternal(href);
    },
    [onWikiLinkClick, itemRef, epubRef]
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

  // 侧栏的目录来源：EPUB 目录、PDF 书签或正文标题；没有可阅读正文时不显示侧栏
  const outline = epub.view
    ? { headings: epub.toc, activeId: epub.activeTocId, open: epub.openTocEntry, located: locatedHighlightIds }
    : pdf.file.document
      ? { headings: pdf.toc, activeId: pdf.activeTocId, open: pdf.openTocEntry, located: pdfHighlightIds }
      : rendered
        ? { headings: rendered.headings, activeId: activeHeadingId, open: scrollToHeading, located: locatedHighlightIds }
        : null;
  const navProps: ReadingNavProps | null = outline && {
    headings: outline.headings,
    activeHeadingId: outline.activeId,
    onHeadingClick: outline.open,
    bookmarks,
    onBookmarkClick: openBookmark,
    onBookmarkDelete: deleteBookmark,
    highlights,
    locatedHighlightIds: outline.located,
    onHighlightClick: scrollToHighlight,
    onHighlightDelete: deleteHighlight,
  };
  // 应用侧栏显示章节 / 书签时，导航渲染到侧栏，不再重复显示视图内侧栏
  const sidebarNavActive = !!navPanel && !!navTarget;

  /** 在当前位置添加书签：名称取页码与当前章节，都没有时取进度百分比 */
  const addCurrentBookmark = () => {
    const progress = currentProgress();
    if (progress === null || !outline) return;
    const page = pdf.file.document ? pdf.currentPage : undefined;
    const chapter = outline.headings.find((heading) => heading.id === outline.activeId)?.text;
    const label =
      [page !== undefined ? `第 ${page} 页` : null, chapter].filter(Boolean).join(' · ') ||
      `${Math.round(progress * 100)}% 处`;
    const bookmark: ReadingBookmark = {
      id: generateUUID(),
      createdAt: new Date().toISOString(),
      label,
      progress,
      ...(page !== undefined ? { page } : {}),
    };
    updateReading({ bookmarks: addBookmark(readingRef.current.bookmarks, bookmark) }).catch((error) =>
      console.error('[Reading] 添加书签失败:', error)
    );
  };

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
          {outline && (
            <button className={styles.iconButton} onClick={addCurrentBookmark} title="在当前位置添加书签">
              <Bookmark size={16} />
            </button>
          )}
          {outline && !sidebarNavActive && (
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
              <ReadingSettingsPanel
                settings={settings}
                onChange={updateSettings}
                onReset={resetSettings}
                showOcrLanguages={attachmentKind === 'pdf'}
              />
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
          {isWritingDocument(item) && onOpenInWriting && (
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

            {attachmentKind === 'pdf' && item.filePath ? (
              <PdfAttachment
                ref={pdfReaderRef}
                filePath={item.filePath}
                state={pdf.file}
                onLayout={restoreScroll}
                highlights={highlights}
                activeHighlightId={selectedHighlight?.id ?? null}
                onHighlightClick={handlePdfHighlightClick}
                onPageChange={pdf.setCurrentPage}
                onTextSelect={handlePdfTextSelect}
                ocr={ocr}
              />
            ) : (
              attachmentKind &&
              attachmentKind !== 'epub' &&
              item.filePath && (
                <ReadingAttachment
                  filePath={item.filePath}
                  mimeType={item.mimeType}
                  kind={attachmentKind}
                  title={displayTitle(item.title)}
                />
              )
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
            ) : attachmentKind === 'epub' ? (
              <div className={epub.error ? styles.noContent : styles.mediaLoading}>
                {epub.error ? '无法打开 EPUB，文件可能已损坏或被移动' : '正在打开 EPUB…'}
              </div>
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

            {epub.view && (
              <EpubChapterNav
                chapterIndex={epub.view.chapterIndex}
                chapterCount={epub.chapterCount}
                error={epub.error}
                onNavigate={epub.goToChapter}
              />
            )}

            {!hasBody && <div className={styles.noContent}>此条目没有可阅读的内容</div>}

            {selectionAnchor && (
              <SelectionToolbar
                anchor={selectionAnchor}
                onHighlight={() => addHighlight({ text: selectionAnchor.text, segments: selectionAnchor.segments })}
                onExcerpt={(note, tags) => createExcerpt(selectionAnchor, note, tags)}
                onDismiss={dismissSelection}
              />
            )}

            {selectedHighlight && (
              <HighlightToolbar
                anchor={selectedHighlight.anchor}
                onDelete={() => {
                  deleteHighlight(selectedHighlight.id);
                  setSelectedHighlight(null);
                }}
                onDismiss={dismissSelectedHighlight}
              />
            )}
          </div>
        </div>

        {navProps && outlineOpen && !sidebarNavActive && <ReadingOutline {...navProps} />}
      </div>

      {navPanel &&
        navTarget &&
        createPortal(
          navProps ? (
            <ReadingSidebarNav panel={navPanel} {...navProps} />
          ) : (
            <div className={styles.outlineEmpty}>此条目没有可导航的正文</div>
          ),
          navTarget
        )}
    </div>
  );
};

// ================================
// EPUB 章节切换
// ================================

interface EpubChapterNavProps {
  chapterIndex: number;
  chapterCount: number;
  /** 最近一次章节渲染失败 */
  error: boolean;
  onNavigate: (chapterIndex: number) => void;
}

const EpubChapterNav: React.FC<EpubChapterNavProps> = ({ chapterIndex, chapterCount, error, onNavigate }) => (
  <nav className={styles.chapterNav}>
    <button
      className={styles.secondaryButton}
      onClick={() => onNavigate(chapterIndex - 1)}
      disabled={chapterIndex === 0}
    >
      <ChevronLeft size={14} />
      上一章
    </button>
    <span className={styles.chapterInfo}>
      {error ? '章节加载失败' : `第 ${chapterIndex + 1} / ${chapterCount} 章`}
    </span>
    <button
      className={styles.secondaryButton}
      onClick={() => onNavigate(chapterIndex + 1)}
      disabled={chapterIndex >= chapterCount - 1}
    >
      下一章
      <ChevronRight size={14} />
    </button>
  </nav>
);

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
