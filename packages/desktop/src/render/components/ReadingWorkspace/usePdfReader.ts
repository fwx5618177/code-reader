// ================================
// PDF 阅读状态
// 打开文档、读取目录（书签）供阅读侧栏使用，并按当前页联动目录高亮与跳转。
// ================================

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { RenderedHeading } from '../../lib/markdown';
import { loadPdfOutline, type PdfOutlineEntry } from '../../lib/reading/pdf';
import { usePdfDocument, type PdfDocumentState } from './hooks';
import type { PdfReaderHandle } from './PdfReader';

export interface PdfReaderState {
  file: PdfDocumentState;
  readerRef: RefObject<PdfReaderHandle>;
  /** 目录（id 为 pdf-outline-序号）；文档没有目录时为空 */
  toc: RenderedHeading[];
  /** 当前页所属的目录项 */
  activeTocId: string | null;
  /** 当前页（从 1 开始） */
  currentPage: number;
  /** 阅读器报告的当前页 */
  setCurrentPage: (page: number) => void;
  openTocEntry: (id: string) => void;
}

const TOC_ID_PREFIX = 'pdf-outline-';
const NO_OUTLINE: PdfOutlineEntry[] = [];

/**
 * PDF 阅读：filePath 为 undefined 时不加载（非 PDF 条目）
 */
export function usePdfReader(filePath: string | undefined): PdfReaderState {
  const file = usePdfDocument(filePath);
  const readerRef = useRef<PdfReaderHandle>(null);
  const [outline, setOutline] = useState<PdfOutlineEntry[]>(NO_OUTLINE);
  const [currentPage, setCurrentPage] = useState(1);
  const pdf = file.document?.pdf;

  useEffect(() => {
    setOutline(NO_OUTLINE);
    if (!pdf) return;
    let cancelled = false;
    loadPdfOutline(pdf)
      .then((entries) => {
        if (!cancelled) setOutline(entries);
      })
      .catch((error) => console.error('[Reading] 读取 PDF 目录失败:', error));
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  const toc = useMemo<RenderedHeading[]>(
    () =>
      outline.map((entry, index) => ({
        id: `${TOC_ID_PREFIX}${index}`,
        level: entry.depth + 1,
        text: entry.title,
      })),
    [outline]
  );

  // 起始页不晚于当前页的最后一个目录项；同页多项时取第一项
  const activeTocId = useMemo(() => {
    let active = -1;
    outline.forEach((entry, index) => {
      if (entry.page <= currentPage && (active < 0 || entry.page > outline[active].page)) active = index;
    });
    return active < 0 ? null : `${TOC_ID_PREFIX}${active}`;
  }, [outline, currentPage]);

  const openTocEntry = useCallback(
    (id: string) => {
      const entry = outline[Number(id.slice(TOC_ID_PREFIX.length))];
      if (entry) readerRef.current?.scrollToPage(entry.page);
    },
    [outline]
  );

  return { file, readerRef, toc, activeTocId, currentPage, setCurrentPage, openTocEntry };
}
