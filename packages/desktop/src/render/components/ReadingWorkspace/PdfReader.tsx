// ================================
// PDF 阅读器
// 画布渲染页面 + 透明文本层（可选中复制）；全部页面按尺寸预先占位，
// 只渲染滚动区域附近的页面，离开后释放画布。支持缩放与适合宽度。
// 扫描页识别后用识别结果生成文本层（结构与 pdf.js 文本层一致），选区、高亮与摘录同样可用。
// 高亮按页保存片段（跨页选区拆为多个片段）：页面文本层渲染完成后在该页内定位并标记本页的片段，
// 页面释放时标记随文本层一起移除，重新渲染后再次恢复。
// 精确查找的命中同样等所在页的文本层渲染后，在文本层中定位并短暂高亮命中的文字
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
import { Loader2, Maximize2, ScanText, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  applyHighlightMarks,
  clearHighlightMarks,
  findHighlightMark,
  HIGHLIGHT_ID_ATTR,
  joinTextRuns,
  selectionSegments,
  setActiveHighlight,
  type HighlightSegment,
  type HighlightTarget,
  type ReadingHighlight,
} from '../../lib/reading';
import type { OcrPageResult } from '../../lib/reading/ocr';
import { renderOcrTextLayer } from '../../lib/reading/ocr-text-layer';
import { loadPdfjs, type PDFDocumentProxy } from '../../lib/reading/pdf';
import { findTextElements } from '../../lib/reading/text-locate';
import { flashElement } from '../../lib/editor/reveal-highlight';
import type { LoadedPdf, PdfPageSize } from './hooks';
import type { PdfOcrState } from './usePdfOcr';
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
const NO_READING_HIGHLIGHTS: readonly ReadingHighlight[] = [];
const NO_HIGHLIGHTS: readonly HighlightTarget[] = [];

/** 等待所在页渲染后再定位的目标：高亮，或一段文字（精确查找的命中） */
type PendingReveal = { page: number; highlightId: string } | { page: number; text: string };

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

/** 文本层中的选区（可以跨越多页） */
export interface PdfTextSelection {
  /** 选中的原文：各页片段按顺序拼接 */
  text: string;
  /** 按页拆分的片段（与高亮定位使用同一套归一化规则） */
  segments: HighlightSegment[];
  /** 选区在视口中的位置 */
  rect: DOMRect;
}

/** 读取文本层内的选区并按页拆分；不在阅读器内或没有文字时返回 null */
function readSelection(container: HTMLElement): PdfTextSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  // 只有已渲染的页面有文本层；选区两端所在页面必然已渲染
  const pages = Array.from(container.querySelectorAll<HTMLElement>(`[${TEXT_LAYER_ATTR}]`)).flatMap((root) => {
    const page = closestPage(root);
    return page ? [{ page: pageNumberOf(page), root }] : [];
  });
  const segments = selectionSegments(pages, range);
  if (segments.length === 0) return null;
  return {
    text: joinTextRuns(segments.map((segment) => segment.text)),
    segments,
    rect: range.getBoundingClientRect(),
  };
}

/** 供外层调用的跳转方法 */
export interface PdfReaderHandle {
  /** 滚动到指定页的页首 */
  scrollToPage(page: number): void;
  /** 滚动到高亮：所在页（首个片段所在页）已渲染时直接定位，否则先到该页页首，待文本层渲染后再定位 */
  scrollToHighlight(id: string, page: number): void;
  /** 滚动到第 page 页中的一段文字并短暂高亮（忽略空白匹配）；文字无法定位时停留在页首 */
  scrollToText(page: number, text: string): void;
}

export interface PdfReaderProps {
  document: LoadedPdf;
  /** 页面占位完成、可以恢复滚动位置时调用（仅一次） */
  onLayout?: () => void;
  /** 需要标记的高亮（只处理带页面片段的） */
  highlights?: readonly ReadingHighlight[];
  /** 选中的高亮：其全部片段以选中样式显示 */
  activeHighlightId?: string | null;
  /** 点击高亮标记（任一片段）；rect 为被点击标记在视口中的位置 */
  onHighlightClick?: (id: string, rect: DOMRect) => void;
  /** 当前页变化 */
  onPageChange?: (page: number) => void;
  /** 在文本层中选中文字（null 表示没有有效选区）；不提供时不处理选区 */
  onTextSelect?: (selection: PdfTextSelection | null) => void;
  /** 扫描页文字识别；不提供时不显示识别入口 */
  ocr?: PdfOcrState;
}

export const PdfReader = forwardRef<PdfReaderHandle, PdfReaderProps>(function PdfReader(
  {
    document: { pdf, pageSizes },
    onLayout,
    highlights = NO_READING_HIGHLIGHTS,
    activeHighlightId = null,
    onHighlightClick,
    onPageChange,
    onTextSelect,
    ocr,
  },
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
        setPendingReveal({ highlightId: id, page });
      },
      scrollToText(page, text) {
        const container = pagesRef.current;
        if (!container) return;
        pageElement(container, page)?.scrollIntoView({ block: 'start' });
        setPendingReveal({ text, page });
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

  // 高亮片段按页分组；没有高亮的页面共用同一个空数组，避免无关页面重新标记
  const highlightsByPage = useMemo(() => {
    const byPage = new Map<number, HighlightTarget[]>();
    for (const highlight of highlights) {
      for (const { page, text, offset } of highlight.segments ?? []) {
        const target: HighlightTarget = { id: highlight.id, text, offset };
        const list = byPage.get(page);
        if (list) list.push(target);
        else byPage.set(page, [target]);
      }
    }
    return byPage;
  }, [highlights]);

  const handleMouseUp = useCallback(() => {
    const container = pagesRef.current;
    if (onTextSelect && container) onTextSelect(readSelection(container));
  }, [onTextSelect]);

  // 点击高亮标记（拖选文字结束时的点击不算）
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const mark = (event.target as Element).closest<HTMLElement>(`mark[${HIGHLIGHT_ID_ATTR}]`);
      const selection = window.getSelection();
      if (!mark || !onHighlightClick || (selection && !selection.isCollapsed)) return;
      onHighlightClick(mark.getAttribute(HIGHLIGHT_ID_ATTR) ?? '', mark.getBoundingClientRect());
    },
    [onHighlightClick]
  );

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
        {ocr && <OcrControls ocr={ocr} />}
      </div>

      <div
        ref={pagesRef}
        className={styles.pages}
        style={{ '--scale-factor': zoom ?? 1 } as React.CSSProperties}
        onMouseUp={onTextSelect ? handleMouseUp : undefined}
        onClick={onHighlightClick ? handleClick : undefined}
      >
        {zoom !== null &&
          pageSizes.map((size, index) => {
            const pageNumber = index + 1;
            const pageHighlights = highlightsByPage.get(pageNumber) ?? NO_HIGHLIGHTS;
            const ocrResult = ocr?.results.get(pageNumber);
            return (
              <PdfPage
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                size={size}
                zoom={zoom}
                active={activePages.has(pageNumber)}
                highlights={pageHighlights}
                activeHighlightId={
                  pageHighlights.some((highlight) => highlight.id === activeHighlightId) ? activeHighlightId : null
                }
                ocrResult={ocrResult && ocrResult.lines.length > 0 ? ocrResult : null}
                reveal={pendingReveal?.page === pageNumber ? pendingReveal : null}
                onRevealed={clearPendingReveal}
              />
            );
          })}
      </div>
    </div>
  );
});

// ================================
// 工具栏：扫描页识别入口与进度
// ================================

const OcrControls: React.FC<{ ocr: PdfOcrState }> = ({ ocr: { scannedPages, results, progress, error, run, cancel } }) => {
  if (progress) {
    return (
      <span className={styles.ocrStatus} role="status">
        <Loader2 size={14} className={styles.spinner} />
        识别中 {progress.done}/{progress.total}
        <button className={styles.toolButton} onClick={cancel} title="取消识别" aria-label="取消识别">
          <X size={14} />
        </button>
      </span>
    );
  }
  if (!scannedPages || scannedPages.length === 0) {
    return error ? <span className={styles.ocrError}>{error}</span> : null;
  }
  const pending = scannedPages.filter((page) => !results.has(page)).length;
  return (
    <span className={styles.ocrStatus}>
      {error ? (
        <span className={styles.ocrError}>{error}</span>
      ) : (
        <span>{pending > 0 ? `检测到 ${pending} 页扫描页` : `已识别 ${scannedPages.length} 页扫描页`}</span>
      )}
      <button className={styles.ocrButton} onClick={() => run(pending === 0)}>
        <ScanText size={14} />
        {pending > 0 ? '识别扫描页' : '重新识别'}
      </button>
    </span>
  );
};

// ================================
// 单页：激活时渲染画布与文本层，未激活时只保留占位
// ================================

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  size: PdfPageSize;
  zoom: number;
  active: boolean;
  /** 本页的高亮片段 */
  highlights: readonly HighlightTarget[];
  /** 本页中需要显示为选中的高亮 */
  activeHighlightId: string | null;
  /** 本页的识别结果；有结果时用它生成文本层，取代 pdf.js 文本层 */
  ocrResult: OcrPageResult | null;
  /** 本页文本层就绪、高亮标记完成后需要定位的高亮或文字 */
  reveal: PendingReveal | null;
  onRevealed: () => void;
}

const PdfPage = memo(function PdfPage({
  pdf,
  pageNumber,
  size,
  zoom,
  active,
  highlights,
  activeHighlightId,
  ocrResult,
  reveal,
  onRevealed,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  /** 文本层已按当前缩放渲染完成，可以标记高亮 */
  const [textReady, setTextReady] = useState(false);

  // 画布
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;

    (async () => {
      const page = await pdf.getPage(pageNumber);
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
    })().catch((error) => {
      // 滚动离开或缩放导致的取消属于正常流程
      if (!cancelled) console.error(`[Reading] 渲染 PDF 第 ${pageNumber} 页失败:`, error);
    });

    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [active, pdf, pageNumber, zoom]);

  // 文本层：有识别结果时由识别结果生成（位置随 --scale-factor 缩放），否则由 pdf.js 按当前缩放渲染
  useEffect(() => {
    const textContainer = textLayerRef.current;
    if (!active || !textContainer) return;
    let cancelled = false;
    let cancelText: (() => void) | null = null;

    (async () => {
      if (ocrResult) {
        renderOcrTextLayer(textContainer, ocrResult, size);
      } else {
        const [page, { TextLayer }] = await Promise.all([pdf.getPage(pageNumber), loadPdfjs()]);
        if (cancelled) return;
        textContainer.replaceChildren();
        const textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textContainer,
          viewport: page.getViewport({ scale: zoom }),
        });
        cancelText = () => textLayer.cancel();
        await textLayer.render();
      }
      if (!cancelled) setTextReady(true);
    })().catch((error) => {
      if (!cancelled) console.error(`[Reading] 渲染 PDF 第 ${pageNumber} 页文本层失败:`, error);
    });

    return () => {
      cancelled = true;
      cancelText?.();
      setTextReady(false);
    };
  }, [active, pdf, pageNumber, zoom, ocrResult, size]);

  // 在本页文本层内标记高亮；高亮变化、重新渲染或页面释放前清除旧标记
  useLayoutEffect(() => {
    const textContainer = textLayerRef.current;
    if (!textReady || !textContainer || highlights.length === 0) return;
    applyHighlightMarks(textContainer, highlights, styles.highlightMark);
    return () => clearHighlightMarks(textContainer);
  }, [textReady, highlights]);

  // 在标记之后执行：选中的高亮加上选中样式（标记重建后重新应用）
  useLayoutEffect(() => {
    const textContainer = textLayerRef.current;
    if (!textReady || !textContainer || !activeHighlightId) return;
    return setActiveHighlight(textContainer, activeHighlightId, styles.highlightMarkActive);
  }, [textReady, highlights, activeHighlightId]);

  // 在标记之后执行：定位等待中的高亮或文字（文字命中的片段短暂高亮）；无法定位时停留在页首
  useEffect(() => {
    const textContainer = textLayerRef.current;
    if (!textReady || !textContainer || !reveal) return;
    if ('highlightId' in reveal) {
      findHighlightMark(textContainer, reveal.highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      const elements = findTextElements(textContainer, reveal.text);
      elements[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      elements.forEach(flashElement);
    }
    onRevealed();
  }, [textReady, reveal, onRevealed]);

  return (
    <div
      className={styles.page}
      data-page={pageNumber}
      style={{ '--page-width': `${size.width}px`, '--page-height': `${size.height}px` } as React.CSSProperties}
    >
      {active && (
        <>
          <canvas ref={canvasRef} className={styles.canvas} />
          <div
            ref={textLayerRef}
            className={`${styles.textLayer} ${ocrResult ? styles.ocrLayer : ''}`}
            data-text-layer=""
          />
        </>
      )}
    </div>
  );
});
