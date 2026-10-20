// ================================
// 扫描页文字识别
// 打开 PDF 后读取该条目已缓存的识别结果与扫描页检测结果；检测结果缺失或文件内容已变时
// 才逐页读取文本层重新检测并写入缓存；
// 用户点击“识别扫描页”后逐页渲染、识别，每页完成即按“条目 + 页码”写入缓存并显示透明文本层。
// 一次识别结束（完成、取消或出错）后把全部识别文本合并写回条目正文（由已有的全文索引触发器更新检索）。
// 上次识别中途退出而未写回正文时，下次打开会补写。
// ================================

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  findScannedPages,
  ocrDocumentText,
  ocrLinesFromBlocks,
  parseOcrPage,
  parseScanDetection,
  replaceTextTail,
  serializeOcrPage,
  serializeScanDetection,
  type OcrPageResult,
} from '../../lib/reading/ocr';
import { createOcrSession, type OcrSession } from '../../lib/reading/ocr-engine';
import { extractPageTexts, renderPageToCanvas } from '../../lib/reading/pdf';
import { ocrLanguageService } from '../../services/ocrLanguageService';
import { useLatestRef, type LoadedPdf } from './hooks';

export interface PdfOcrProgress {
  /** 已完成的页数 */
  done: number;
  total: number;
}

export interface PdfOcrState {
  /** 扫描页页码；检测完成前为 null */
  scannedPages: number[] | null;
  /** 已识别的页面（页码 → 结果） */
  results: ReadonlyMap<number, OcrPageResult>;
  /** 进行中的识别；空闲时为 null */
  progress: PdfOcrProgress | null;
  error: string | null;
  /** 识别扫描页：rerun 为 false 时只识别尚无结果的页面 */
  run: (rerun: boolean) => void;
  cancel: () => void;
}

export interface UsePdfOcrOptions {
  itemId: string;
  /** 已打开的文档；未打开或非 PDF 时为 undefined */
  document: LoadedPdf | undefined;
  /** 读取条目当前正文 */
  getContent: () => string;
  /** 写回条目正文 */
  saveContent: (content: string) => Promise<void>;
}

const NO_RESULTS: ReadonlyMap<number, OcrPageResult> = new Map();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 中止时 reject，用于与不支持取消的异步步骤竞速 */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function usePdfOcr({ itemId, document, getContent, saveContent }: UsePdfOcrOptions): PdfOcrState {
  const pdf = document?.pdf;
  const [scannedPages, setScannedPages] = useState<number[] | null>(null);
  const [results, setResults] = useState<ReadonlyMap<number, OcrPageResult>>(NO_RESULTS);
  const [progress, setProgress] = useState<PdfOcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef(results);
  /** 最近一次写入正文的识别全文 */
  const indexedTextRef = useRef<string | null>(null);
  const runRef = useRef<AbortController | null>(null);
  const getContentRef = useLatestRef(getContent);
  const saveContentRef = useLatestRef(saveContent);

  const updateResults = useCallback((next: ReadonlyMap<number, OcrPageResult>) => {
    resultsRef.current = next;
    setResults(next);
  }, []);

  /** 识别全文有变化时写回正文，并记录写入的内容 */
  const commitText = useCallback(async () => {
    const text = ocrDocumentText(resultsRef.current);
    const previous = indexedTextRef.current;
    if (text === (previous ?? '')) return;
    await saveContentRef.current(replaceTextTail(getContentRef.current(), previous, text));
    indexedTextRef.current = text;
    await window.electron.ocr.writeIndexedText(itemId, text);
  }, [itemId, getContentRef, saveContentRef]);

  // 读取缓存并检测扫描页；补写上次未写回正文的识别文本
  useEffect(() => {
    setScannedPages(null);
    updateResults(NO_RESULTS);
    setError(null);
    if (!document) return;
    const { pdf, contentHash } = document;
    const controller = new AbortController();

    /** 逐页读取文本层检测扫描页，并写入缓存（写入失败只影响下次打开的速度，不影响本次识别） */
    const detectScannedPages = async (): Promise<number[]> => {
      const scannedPages = findScannedPages(await extractPageTexts(pdf, controller.signal));
      const data = serializeScanDetection({ contentHash, pageCount: pdf.numPages, scannedPages });
      await window.electron.ocr.writeScanResult(itemId, data).catch((cause) => {
        console.error('[Reading] 保存扫描页检测结果失败:', cause);
      });
      return scannedPages;
    };

    (async () => {
      const stored = await window.electron.ocr.readResults(itemId);
      if (controller.signal.aborted) return;
      const cached = new Map<number, OcrPageResult>();
      for (const { page, data } of stored.pages) {
        const result = page <= pdf.numPages ? parseOcrPage(data) : null;
        if (result) cached.set(page, result);
      }
      indexedTextRef.current = stored.indexedText;
      updateResults(cached);
      await commitText().catch((cause) => {
        console.error('[Reading] 写回识别文本失败:', cause);
        setError(`写回识别文本失败：${errorMessage(cause)}`);
      });
      const scannedPages =
        parseScanDetection(stored.scan, contentHash, pdf.numPages) ?? (await detectScannedPages());
      // 补写完成后才允许开始识别，避免两次写回交错
      if (!controller.signal.aborted) setScannedPages(scannedPages);
    })().catch((cause) => {
      if (controller.signal.aborted) return;
      console.error('[Reading] 检测扫描页失败:', cause);
      setError(`检测扫描页失败：${errorMessage(cause)}`);
    });

    return () => controller.abort();
  }, [document, itemId, updateResults, commitText]);

  const run = useCallback(
    (rerun: boolean) => {
      if (!pdf || !scannedPages || runRef.current) return;
      const pages = rerun ? scannedPages : scannedPages.filter((page) => !resultsRef.current.has(page));
      if (pages.length === 0) return;
      const controller = new AbortController();
      const aborted = whenAborted(controller.signal);
      aborted.catch(() => undefined);
      runRef.current = controller;
      setError(null);
      setProgress({ done: 0, total: pages.length });

      (async () => {
        let session: OcrSession | null = null;
        try {
          await ocrLanguageService.refresh();
          const { active: languages, error: listError } = ocrLanguageService.getSnapshot();
          if (listError) throw new Error(listError);
          if (languages.length === 0) throw new Error('没有可用的识别语言，请在“排版”面板中导入语言数据');
          const creating = createOcrSession(languages);
          // 取消时会话可能仍在创建，创建完成后立即终止
          controller.signal.addEventListener('abort', () => {
            creating.then((created) => created.terminate()).catch(() => undefined);
          });
          session = await Promise.race([creating, aborted]);
          for (const [index, page] of pages.entries()) {
            const { canvas, scale } = await Promise.race([renderPageToCanvas(pdf, page), aborted]);
            const blocks = await Promise.race([session.recognize(canvas), aborted]);
            // 释放画布内存
            canvas.width = 0;
            const result: OcrPageResult = { languages, lines: ocrLinesFromBlocks(blocks, scale) };
            await window.electron.ocr.writePageResult(itemId, page, serializeOcrPage(result));
            updateResults(new Map(resultsRef.current).set(page, result));
            setProgress({ done: index + 1, total: pages.length });
          }
        } catch (cause) {
          if (!controller.signal.aborted) {
            console.error('[Reading] 识别扫描页失败:', cause);
            setError(`识别失败：${errorMessage(cause)}`);
          }
        } finally {
          await session?.terminate();
          runRef.current = null;
          setProgress(null);
          // 取消或出错时，已完成的页面同样写回正文
          await commitText().catch((cause) => {
            console.error('[Reading] 写回识别文本失败:', cause);
            setError(`写回识别文本失败：${errorMessage(cause)}`);
          });
        }
      })();
    },
    [pdf, scannedPages, itemId, updateResults, commitText]
  );

  const cancel = useCallback(() => runRef.current?.abort(), []);

  // 离开阅读视图时停止识别（已完成的页面仍会写回）
  useEffect(() => () => runRef.current?.abort(), []);

  return { scannedPages, results, progress, error, run, cancel };
}
