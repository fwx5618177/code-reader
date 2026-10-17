// ================================
// PDF 阅读器
// 画布渲染页面 + 透明文本层（可选中复制）；全部页面按尺寸预先占位，
// 只渲染滚动区域附近的页面，离开后释放画布。支持缩放与适合宽度。
// 高亮按页保存：页面文本层渲染完成后在该页内定位并标记，页面释放时标记随文本层一起移除。
// ================================

import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  applyHighlightMarks,
  clearHighlightMarks,
  findHighlightMark,
  selectedText,
  type ReadingHighlight,
} from '../../lib/reading';
import { loadPdfjs, type PDFDocumentProxy } from '../../lib/reading/pdf';
import type { LoadedPdf, PdfPageSize } from './hooks';
import styles from './PdfReader.module.scss';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.2;
/** 预渲染范围：可视区域上下各一屏 */
const RENDER_MARGIN = '100% 0px';
/** 当前页判定线：可视区域垂直中线 */
const CURRENT_PAGE_MARGIN = '-50% 0px -50% 0px';
const PAGE_ATTR = 'data-page';
const TEXT_LAYER_ATTR = 'data-text-layer';
const NO_HIGHLIGHTS: readonly ReadingHighlight[] = [];

/** 等待所在页渲染后再定位的高亮 */
interface PendingReveal {
  id: string;
  page: number;
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/** 最近的纵向滚动容器（IntersectionObserver 的 root） */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

function pageNumberOf(element: Element): number {
  return Number(element.getAttribute(PAGE_ATTR));
}

function pageElement(container: HTMLElement, page: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[${PAGE_ATTR}="${page}"]`);
}

/** 节点所在的页面占位元素 */
function closestPage(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(`[${PAGE_ATTR}]`) ?? null;
}

/** 文本层中的选区 */
export interface PdfTextSelection {
  /** 选中的原文（与高亮定位使用同一套归一化规则） */
  text: string;
  /** 所在页码（从 1 开始） */
  page: number;
  /** 选区在视口中的位置 */
  rect: DOMRect;
}

/** 读取单页文本层内的选区；跨页、不在文本层内或没有文字时返回 null */
function readPageSelection(container: HTMLElement): PdfTextSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const page = closestPage(range.startContainer);
  if (!page || page !== closestPage(range.endContainer) || !container.contains(page)) return null;
  const textLayer = page.querySelector<HTMLElement>(`[${TEXT_LAYER_ATTR}]`);
  const text = textLayer ? selectedText(textLayer, range) : '';
  return text ? { text, page: pageNumberOf(page), rect: range.getBoundingClientRect() } : null;
}

/** 供外层调用的跳转方法 */
export interface PdfReaderHandle {
  /** 滚动到指定页的页首 */
  scrollToPage(page: number): void;
  /** 滚动到高亮：所在页已渲染时直接定位，否则先到该页页首，待文本层渲染后再定位 */
  scrollToHighlight(id: string, page: number): void;
}

export interface PdfReaderProps {
  document: LoadedPdf;
  /** 页面占位完成、可以恢复滚动位置时调用（仅一次） */
  onLayout?: () => void;
  /** 需要标记的高亮（只处理带页码的） */
  highlights?: readonly ReadingHighlight[];
  /** 当前页变化 */
  onPageChange?: (page: number) => void;
  /** 在文本层中选中文字（null 表示没有有效选区）；不提供时不处理选区 */
  onTextSelect?: (selection: PdfTextSelection | null) => void;
}

export const PdfReader = forwardRef<PdfReaderHandle, PdfReaderProps>(function PdfReader(
  { document: { pdf, pageSizes }, onLayout, highlights = NO_HIGHLIGHTS, onPageChange, onTextSelect },
  ref
) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [activePages, setActivePages] = useState<ReadonlySet<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingReveal, setPendingReveal] = useState<PendingReveal | null>(null);
  const clearPendingReveal = useCallback(() => setPendingReveal(null), []);
  /** 缩放后需要保持在视野中的页码 */
  const anchorPageRef = useRef<number | null>(null);
  const laidOutRef = useRef(false);
  const ready = zoom !== null;

  const fitWidth = useCallback(() => {
    const width = pagesRef.current?.clientWidth ?? 0;
    const widest = Math.max(...pageSizes.map((size) => size.width));
    return width > 0 && widest > 0 ? clampZoom(width / widest) : 1;
  }, [pageSizes]);

  const changeZoom = useCallback(
    (next: number) => {
      anchorPageRef.current = currentPage;
      setZoom(clampZoom(next));
    },
    [currentPage]
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(page) {
        const container = pagesRef.current;
        if (container) pageElement(container, page)?.scrollIntoView({ block: 'start' });
        setPendingReveal(null);
      },
      scrollToHighlight(id, page) {
        const container = pagesRef.current;
        if (!container) return;
        const mark = findHighlightMark(container, id);
        if (mark) {
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        pageElement(container, page)?.scrollIntoView({ block: 'start' });
        setPendingReveal({ id, page });
      },
    }),
    []
  );

  // 初始按宽度适配
  useLayoutEffect(() => {
    setZoom(fitWidth());
  }, [fitWidth]);

  // 首次占位后通知外层恢复阅读位置；之后缩放时保持当前页在视野中
  useLayoutEffect(() => {
    if (zoom === null) return;
    if (!laidOutRef.current) {
      laidOutRef.current = true;
      onLayout?.();
      return;
    }
    const anchor = anchorPageRef.current;
    anchorPageRef.current = null;
    const container = pagesRef.current;
    if (anchor !== null && container) pageElement(container, anchor)?.scrollIntoView({ block: 'start' });
  }, [zoom, onLayout]);

  // 观察页面占位：靠近可视区域的页面渲染，中线所在页面为当前页。
  // 缩放不重建占位元素，观察器只需在占位首次出现时创建
  useEffect(() => {
    const container = pagesRef.current;
    if (!container || !ready) return;
    const root = scrollParent(container);
    const pages = Array.from(container.querySelectorAll<HTMLElement>(`[${PAGE_ATTR}]`));

    const renderObserver = new IntersectionObserver(
      (entries) =>
        setActivePages((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            if (entry.isIntersecting) next.add(pageNumberOf(entry.target));
            else next.delete(pageNumberOf(entry.target));
          }
          return next;
        }),
      { root, rootMargin: RENDER_MARGIN }
    );
    const currentObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setCurrentPage(pageNumberOf(visible.target));
      },
      { root, rootMargin: CURRENT_PAGE_MARGIN }
    );
    pages.forEach((page) => {
      renderObserver.observe(page);
      currentObserver.observe(page);
    });
    return () => {
      renderObserver.disconnect();
      currentObserver.disconnect();
    };
  }, [pageSizes, ready]);

  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  // 高亮按页分组；没有高亮的页面共用同一个空数组，避免无关页面重新标记
  const highlightsByPage = useMemo(() => {
    const byPage = new Map<number, ReadingHighlight[]>();
    for (const highlight of highlights) {
      if (highlight.page === undefined) continue;
      const list = byPage.get(highlight.page);
      if (list) list.push(highlight);
      else byPage.set(highlight.page, [highlight]);
    }
    return byPage;
  }, [highlights]);

  const handleMouseUp = useCallback(() => {
    const container = pagesRef.current;
    if (onTextSelect && container) onTextSelect(readPageSelection(container));
  }, [onTextSelect]);

  return (
    <div className={styles.reader}>
      <div className={styles.toolbar}>
        <button
          className={styles.toolButton}
          onClick={() => zoom !== null && changeZoom(zoom / ZOOM_STEP)}
          disabled={zoom === null || zoom <= MIN_ZOOM}
          title="缩小"
        >
          <ZoomOut size={14} />
        </button>
        <span className={styles.zoomValue}>{zoom === null ? '—' : `${Math.round(zoom * 100)}%`}</span>
        <button
          className={styles.toolButton}
          onClick={() => zoom !== null && changeZoom(zoom * ZOOM_STEP)}
          disabled={zoom === null || zoom >= MAX_ZOOM}
          title="放大"
        >
          <ZoomIn size={14} />
        </button>
        <button className={styles.toolButton} onClick={() => changeZoom(fitWidth())} title="适合宽度">
          <Maximize2 size={14} />
        </button>
        <span className={styles.pageInfo}>
          第 {currentPage} / {pageSizes.length} 页
        </span>
      </div>

      <div
        ref={pagesRef}
        className={styles.pages}
        style={{ '--scale-factor': zoom ?? 1 } as React.CSSProperties}
        onMouseUp={onTextSelect ? handleMouseUp : undefined}
      >
        {zoom !== null &&
          pageSizes.map((size, index) => (
            <PdfPage
              key={index + 1}
              pdf={pdf}
              pageNumber={index + 1}
              size={size}
              zoom={zoom}
              active={activePages.has(index + 1)}
              highlights={highlightsByPage.get(index + 1) ?? NO_HIGHLIGHTS}
              revealHighlightId={pendingReveal?.page === index + 1 ? pendingReveal.id : null}
              onRevealed={clearPendingReveal}
            />
          ))}
      </div>
    </div>
  );
});

// ================================
// 单页：激活时渲染画布与文本层，未激活时只保留占位
// ================================

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  size: PdfPageSize;
  zoom: number;
  active: boolean;
  /** 本页的高亮 */
  highlights: readonly ReadingHighlight[];
  /** 本页高亮标记完成后需要滚动到的高亮 */
  revealHighlightId: string | null;
  onRevealed: () => void;
}

const PdfPage = memo(function PdfPage({
  pdf,
  pageNumber,
  size,
  zoom,
  active,
  highlights,
  revealHighlightId,
  onRevealed,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  /** 文本层已按当前缩放渲染完成，可以标记高亮 */
  const [textReady, setTextReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;
    if (!active || !canvas || !textContainer) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    let cancelText: (() => void) | null = null;

    (async () => {
      const [page, { TextLayer }] = await Promise.all([pdf.getPage(pageNumber), loadPdfjs()]);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: zoom });
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建画布');
      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      cancelRender = () => renderTask.cancel();
      await renderTask.promise;
      if (cancelled) return;

      textContainer.replaceChildren();
      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textContainer,
        viewport,
      });
      cancelText = () => textLayer.cancel();
      await textLayer.render();
      if (!cancelled) setTextReady(true);
    })().catch((error) => {
      // 滚动离开或缩放导致的取消属于正常流程
      if (!cancelled) console.error(`[Reading] 渲染 PDF 第 ${pageNumber} 页失败:`, error);
    });

    return () => {
      cancelled = true;
      cancelRender?.();
      cancelText?.();
      setTextReady(false);
    };
  }, [active, pdf, pageNumber, zoom]);

  // 在本页文本层内标记高亮；高亮变化、重新渲染或页面释放前清除旧标记
  useLayoutEffect(() => {
    const textContainer = textLayerRef.current;
    if (!textReady || !textContainer || highlights.length === 0) return;
    applyHighlightMarks(textContainer, highlights, styles.highlightMark);
    return () => clearHighlightMarks(textContainer);
  }, [textReady, highlights]);

  // 在标记之后执行：定位等待中的高亮（文字无法定位时停留在页首）
  useEffect(() => {
    const textContainer = textLayerRef.current;
    if (!textReady || !textContainer || !revealHighlightId) return;
    findHighlightMark(textContainer, revealHighlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    onRevealed();
  }, [textReady, revealHighlightId, onRevealed]);

  return (
    <div
      className={styles.page}
      data-page={pageNumber}
      style={{ '--page-width': `${size.width}px`, '--page-height': `${size.height}px` } as React.CSSProperties}
    >
      {active && (
        <>
          <canvas ref={canvasRef} className={styles.canvas} />
          <div ref={textLayerRef} className={styles.textLayer} data-text-layer="" />
        </>
      )}
    </div>
  );
});
