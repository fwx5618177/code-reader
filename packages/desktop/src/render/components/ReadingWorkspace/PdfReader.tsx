// ================================
// PDF 阅读器
// 画布渲染页面 + 透明文本层（可选中复制）；全部页面按尺寸预先占位，
// 只渲染滚动区域附近的页面，离开后释放画布。支持缩放与适合宽度。
// ================================

import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
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

export interface PdfReaderProps {
  document: LoadedPdf;
  /** 页面占位完成、可以恢复滚动位置时调用（仅一次） */
  onLayout?: () => void;
}

export const PdfReader: React.FC<PdfReaderProps> = ({ document: { pdf, pageSizes }, onLayout }) => {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [activePages, setActivePages] = useState<ReadonlySet<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
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
    if (anchor !== null) {
      pagesRef.current?.querySelector(`[${PAGE_ATTR}="${anchor}"]`)?.scrollIntoView({ block: 'start' });
    }
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
            />
          ))}
      </div>
    </div>
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
}

const PdfPage = memo(function PdfPage({ pdf, pageNumber, size, zoom, active }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

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
    })().catch((error) => {
      // 滚动离开或缩放导致的取消属于正常流程
      if (!cancelled) console.error(`[Reading] 渲染 PDF 第 ${pageNumber} 页失败:`, error);
    });

    return () => {
      cancelled = true;
      cancelRender?.();
      cancelText?.();
    };
  }, [active, pdf, pageNumber, zoom]);

  return (
    <div
      className={styles.page}
      data-page={pageNumber}
      style={{ '--page-width': `${size.width}px`, '--page-height': `${size.height}px` } as React.CSSProperties}
    >
      {active && (
        <>
          <canvas ref={canvasRef} className={styles.canvas} />
          <div ref={textLayerRef} className={styles.textLayer} />
        </>
      )}
    </div>
  );
});
