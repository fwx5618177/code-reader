// ================================
// EPUB 阅读状态
// 打开电子书、按章节渲染、目录跳转与章节内链接跳转。
// 整本书的阅读进度 = (章节序号 + 章节内滚动比例) / 章节数。
// ================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderedDocument, RenderedHeading } from '../../lib/markdown';
import {
  chapterPosition,
  EPUB_ID_PREFIX,
  EpubRenderer,
  openEpub,
  splitEpubTarget,
  type EpubTocEntry,
} from '../../lib/reading/epub';
import { readBinaryFile } from './system';

/** 章节渲染后的滚动目标：章节内元素或章节内比例 */
export type EpubScrollTarget = { elementId: string } | { ratio: number };

/** 当前显示的章节 */
export interface EpubChapterView extends RenderedDocument {
  chapterIndex: number;
  scrollTarget: EpubScrollTarget;
}

/** 当前正文是否为 EPUB 章节 */
export function isEpubChapterView(document: RenderedDocument): document is EpubChapterView {
  return 'scrollTarget' in document;
}

export interface EpubReaderState {
  /** 当前章节；尚未加载完成时为 null */
  view: EpubChapterView | null;
  error: boolean;
  chapterCount: number;
  /** 目录（id 为 toc-序号，供阅读侧栏使用） */
  toc: RenderedHeading[];
  /** 当前章节对应的目录项 */
  activeTocId: string | null;
  goToChapter: (index: number) => void;
  /** 跳转到整本书的进度位置（0–1，用于书签） */
  goToProgress: (progress: number) => void;
  openTocEntry: (id: string) => void;
  /** 打开包内链接目标（路径#片段） */
  openTarget: (target: string) => void;
}

interface OpenedBook {
  renderer: EpubRenderer;
  toc: EpubTocEntry[];
}

const NO_HEADINGS: RenderedHeading[] = [];
const TOC_ID_PREFIX = 'toc-';

/**
 * EPUB 阅读：filePath 为 undefined 时不加载（非 EPUB 条目）
 *
 * @param initialProgress 打开时恢复到的整本书进度（0–1）
 */
export function useEpubReader(filePath: string | undefined, initialProgress: number): EpubReaderState {
  const [book, setBook] = useState<OpenedBook | null>(null);
  const [view, setView] = useState<EpubChapterView | null>(null);
  const [error, setError] = useState(false);
  const initialProgressRef = useRef(initialProgress);
  const requestRef = useRef(0);

  /** 渲染章节；快速连续跳转时只采用最后一次请求的结果 */
  const showChapter = useCallback((renderer: EpubRenderer, chapterIndex: number, scrollTarget: EpubScrollTarget) => {
    const request = ++requestRef.current;
    renderer
      .renderChapter(chapterIndex)
      .then((html) => {
        if (request !== requestRef.current) return;
        setView({ html, headings: NO_HEADINGS, chapterIndex, scrollTarget });
        setError(false);
      })
      .catch((reason) => {
        console.error('[Reading] 渲染 EPUB 章节失败:', reason);
        if (request === requestRef.current) setError(true);
      });
  }, []);

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    let renderer: EpubRenderer | null = null;

    readBinaryFile(filePath)
      .then(openEpub)
      .then((opened) => {
        if (cancelled) return;
        renderer = new EpubRenderer(opened);
        setBook({ renderer, toc: opened.toc });
        const { chapterIndex, ratio } = chapterPosition(initialProgressRef.current, renderer.chapterCount);
        showChapter(renderer, chapterIndex, { ratio });
      })
      .catch((reason) => {
        console.error('[Reading] 打开 EPUB 失败:', reason);
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      requestRef.current++;
      renderer?.dispose();
    };
  }, [filePath, showChapter]);

  const openTarget = useCallback(
    (target: string) => {
      if (!book) return;
      const chapterIndex = book.renderer.chapterIndexOf(target);
      if (chapterIndex < 0) return;
      const { fragment } = splitEpubTarget(target);
      showChapter(book.renderer, chapterIndex, fragment ? { elementId: `${EPUB_ID_PREFIX}${fragment}` } : { ratio: 0 });
    },
    [book, showChapter]
  );

  const goToChapter = useCallback(
    (chapterIndex: number) => {
      if (book && chapterIndex >= 0 && chapterIndex < book.renderer.chapterCount) {
        showChapter(book.renderer, chapterIndex, { ratio: 0 });
      }
    },
    [book, showChapter]
  );

  const goToProgress = useCallback(
    (progress: number) => {
      if (!book) return;
      const { chapterIndex, ratio } = chapterPosition(progress, book.renderer.chapterCount);
      showChapter(book.renderer, chapterIndex, { ratio });
    },
    [book, showChapter]
  );

  const openTocEntry = useCallback(
    (id: string) => {
      const entry = book?.toc[Number(id.slice(TOC_ID_PREFIX.length))];
      if (entry) openTarget(entry.target);
    },
    [book, openTarget]
  );

  const toc = useMemo<RenderedHeading[]>(
    () =>
      (book?.toc ?? []).map((entry, index) => ({
        id: `${TOC_ID_PREFIX}${index}`,
        level: entry.depth + 1,
        text: entry.label,
      })),
    [book]
  );

  // 各目录项所在的章节序号（不在书脊中为 -1）
  const tocChapters = useMemo(
    () => (book ? book.toc.map((entry) => book.renderer.chapterIndexOf(entry.target)) : []),
    [book]
  );

  // 当前章节的第一个目录项；章节本身不在目录中时取之前最近的目录项
  const activeTocId = useMemo(() => {
    if (!view) return null;
    let index = tocChapters.indexOf(view.chapterIndex);
    if (index < 0) {
      tocChapters.forEach((chapterIndex, entryIndex) => {
        if (chapterIndex >= 0 && chapterIndex < view.chapterIndex) index = entryIndex;
      });
    }
    return index < 0 ? null : `${TOC_ID_PREFIX}${index}`;
  }, [tocChapters, view]);

  return {
    view,
    error,
    chapterCount: book?.renderer.chapterCount ?? 0,
    toc,
    activeTocId,
    goToChapter,
    goToProgress,
    openTocEntry,
    openTarget,
  };
}
