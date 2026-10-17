// ================================
// 阅读工作区的通用 Hooks
// ================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import {
  DEFAULT_READING_SETTINGS,
  loadReadingSettings,
  normalizeReadingSettings,
  saveReadingSettings,
  type ReadingSettings,
} from '../../lib/reading';
import { hashFileContent, openPdf, type PDFDocumentProxy } from '../../lib/reading/pdf';
import { readBinaryFile } from './system';

/**
 * 始终指向最新值的 ref（供异步回调与卸载清理读取最新 props）
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * 排版设置：读取并在变化时写回 localStorage
 */
export function useReadingSettings(): {
  settings: ReadingSettings;
  updateSettings: (patch: Partial<ReadingSettings>) => void;
  resetSettings: () => void;
} {
  const [settings, setSettings] = useState<ReadingSettings>(loadReadingSettings);

  useEffect(() => {
    saveReadingSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<ReadingSettings>) => {
    setSettings((previous) => normalizeReadingSettings({ ...previous, ...patch }));
  }, []);

  const resetSettings = useCallback(() => setSettings({ ...DEFAULT_READING_SETTINGS }), []);

  return { settings, updateSettings, resetSettings };
}

/**
 * 点击元素外部或按 Esc 时关闭浮层
 */
export function useDismiss(
  ref: RefObject<HTMLElement>,
  onDismiss: () => void,
  active = true
): void {
  const onDismissRef = useLatestRef(onDismiss);

  useEffect(() => {
    if (!active) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismissRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismissRef.current();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, onDismissRef, active]);
}

export interface BlobUrlState {
  url: string | null;
  error: boolean;
}

/**
 * 本地附件的 Blob URL：CSP 禁止 file: 协议加载图片与音视频，
 * 因此经 IPC 读取文件内容后生成 Blob URL，并在卸载或文件变化时释放
 */
export function useBlobUrl(filePath: string | undefined, mimeType: string | undefined): BlobUrlState {
  const [state, setState] = useState<BlobUrlState>({ url: null, error: false });

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    let url: string | null = null;
    setState({ url: null, error: false });

    readBinaryFile(filePath)
      .then((data) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([data], { type: mimeType ?? '' }));
        setState({ url, error: false });
      })
      .catch((error) => {
        console.error('[Reading] 读取附件失败:', error);
        if (!cancelled) setState({ url: null, error: true });
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [filePath, mimeType]);

  return state;
}

/** 页面尺寸（缩放比例为 1 时的 CSS 像素） */
export interface PdfPageSize {
  width: number;
  height: number;
}

export interface LoadedPdf {
  pdf: PDFDocumentProxy;
  pageSizes: PdfPageSize[];
  /** 文件内容哈希（扫描页检测缓存据此判断是否过期） */
  contentHash: string;
}

export interface PdfDocumentState {
  document: LoadedPdf | null;
  error: boolean;
}

/**
 * 打开本地 PDF 并读取全部页面尺寸（用于预先占位、按需渲染）与内容哈希，卸载或文件变化时释放文档。
 * filePath 为 undefined 时不加载（非 PDF 条目）
 */
export function usePdfDocument(filePath: string | undefined): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>({ document: null, error: false });

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    setState({ document: null, error: false });

    (async () => {
      const data = await readBinaryFile(filePath);
      // 先哈希再打开：pdf.js 会把数据转移给 Worker
      const contentHash = await hashFileContent(data);
      const pdf = await openPdf(data);
      if (cancelled) {
        void pdf.destroy();
        return;
      }
      opened = pdf;
      const pageSizes = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, index) => {
          const { width, height } = (await pdf.getPage(index + 1)).getViewport({ scale: 1 });
          return { width, height };
        })
      );
      if (!cancelled) setState({ document: { pdf, pageSizes, contentHash }, error: false });
    })().catch((error) => {
      console.error('[Reading] 打开 PDF 失败:', error);
      if (!cancelled) setState({ document: null, error: true });
    });

    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [filePath]);

  return state;
}
