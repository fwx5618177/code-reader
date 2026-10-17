// ================================
// PDF 支持
// 按需加载 pdf.js（及其 Worker），提供文档打开、目录读取与全文提取。
//
// 渲染进程的生产页面运行在 file:// 下且 CSP 为 connect-src 'self'，无法 fetch 本地资源，
// 因此 Worker 以 Blob URL 创建，CMap 与标准字体以内联 data URL 按需加载并在主线程解码。
// ================================

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';

export type { PDFDocumentProxy };

type Pdfjs = typeof import('pdfjs-dist');

/** 内联资源加载器：key 为文件路径，value 返回 base64 data URL */
type InlineAssetLoaders = Record<string, () => Promise<string>>;

const CMAP_DIR = '/node_modules/pdfjs-dist/cmaps/';
const STANDARD_FONT_DIR = '/node_modules/pdfjs-dist/standard_fonts/';

const CMAP_LOADERS: InlineAssetLoaders = import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?url&inline',
  import: 'default',
  exhaustive: true,
});

const STANDARD_FONT_LOADERS: InlineAssetLoaders = import.meta.glob<string>(
  '/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}',
  { query: '?url&inline', import: 'default', exhaustive: true }
);

/** 读取内联资源为字节 */
async function loadInlineAsset(loaders: InlineAssetLoaders, path: string): Promise<Uint8Array> {
  const loader = loaders[path];
  if (!loader) throw new Error(`缺少 PDF 资源：${path}`);
  const dataUrl = await loader();
  const marker = ';base64,';
  const index = dataUrl.indexOf(marker);
  if (index < 0) throw new Error(`PDF 资源不是 base64 data URL：${path}`);
  const binary = atob(dataUrl.slice(index + marker.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 供 pdf.js 调用的 CMap 读取器（接口与 DOMCMapReaderFactory 一致） */
class InlineCMapReaderFactory {
  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    return { cMapData: await loadInlineAsset(CMAP_LOADERS, `${CMAP_DIR}${name}.bcmap`), isCompressed: true };
  }
}

/** 供 pdf.js 调用的标准字体读取器（接口与 DOMStandardFontDataFactory 一致） */
class InlineStandardFontDataFactory {
  fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    return loadInlineAsset(STANDARD_FONT_LOADERS, `${STANDARD_FONT_DIR}${filename}`);
  }
}

let pdfjsPromise: Promise<Pdfjs> | null = null;

async function initPdfjs(): Promise<Pdfjs> {
  const [pdfjs, workerSource] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?raw'),
  ]);
  const workerUrl = URL.createObjectURL(new Blob([workerSource.default], { type: 'text/javascript' }));
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
  return pdfjs;
}

/**
 * 加载 pdf.js；全局只初始化一次，失败后允许重试
 */
export function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = initPdfjs().catch((error: unknown) => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

/**
 * 打开 PDF 文档。pdf.js 会转移传入的缓冲区，调用方之后不应再使用 data。
 */
/**
 * 文件内容的 SHA-256（十六进制），用于判断按条目缓存的派生数据是否过期。
 * 须在 openPdf 之前调用：pdf.js 会把数据转移给 Worker，之后缓冲区可能已分离
 */
export async function hashFileContent(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({
    data,
    CMapReaderFactory: InlineCMapReaderFactory,
    StandardFontDataFactory: InlineStandardFontDataFactory,
    isEvalSupported: false,
  }).promise;
}

/** PDF 目录（书签）中的一项，按文档中的先后顺序展开为扁平列表 */
export interface PdfOutlineEntry {
  title: string;
  /** 层级，顶层为 0 */
  depth: number;
  /** 跳转目标页码（从 1 开始） */
  page: number;
}

/** 读取目录所需的文档接口 */
type OutlineSource = Pick<PDFDocumentProxy, 'numPages' | 'getOutline' | 'getDestination' | 'getPageIndex'>;

type OutlineNode = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number];

/**
 * 目录项跳转目标 → 页码：命名目标先查出显式目标，显式目标首项为页面引用或页面序号（从 0 开始）。
 * 外部链接等没有页面目标的项返回 null
 */
async function destinationPage(pdf: OutlineSource, dest: OutlineNode['dest']): Promise<number | null> {
  const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
  const target: unknown = Array.isArray(explicit) ? explicit[0] : null;
  let index: number | null = null;
  if (typeof target === 'number' && Number.isInteger(target)) index = target;
  else if (target && typeof target === 'object') index = await pdf.getPageIndex(target as { num: number; gen: number });
  return index !== null && index >= 0 && index < pdf.numPages ? index + 1 : null;
}

/**
 * 读取 PDF 目录；没有页面目标或目标无法解析的项被跳过（其子项保留）
 */
export async function loadPdfOutline(pdf: OutlineSource): Promise<PdfOutlineEntry[]> {
  const flat: Array<{ title: string; depth: number; dest: OutlineNode['dest'] }> = [];
  const visit = (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      flat.push({ title: node.title.replace(/\s+/g, ' ').trim(), depth, dest: node.dest });
      visit(node.items, depth + 1);
    }
  };
  visit((await pdf.getOutline()) ?? [], 0);

  const pages = await Promise.all(
    flat.map(({ dest }) =>
      destinationPage(pdf, dest).catch((error: unknown) => {
        console.warn('[Reading] 无法解析 PDF 目录项的跳转目标:', error);
        return null;
      })
    )
  );
  return flat.flatMap(({ title, depth }, index) => {
    const page = pages[index];
    return title && page !== null ? [{ title, depth, page }] : [];
  });
}

/** 单页文本：按 pdf.js 的行尾标记换行 */
function pageText(items: Array<TextItem | TextMarkedContent>): string {
  let text = '';
  for (const item of items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.trim();
}

/**
 * 逐页提取文本层文字（下标 0 为第 1 页；扫描件等没有文本层的页面为空字符串）。
 * signal 中止时在当前页之后停止并抛出 AbortError
 */
export async function extractPageTexts(
  pdf: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>,
  signal?: AbortSignal
): Promise<string[]> {
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    signal?.throwIfAborted();
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(pageText(content.items));
  }
  return pages;
}

/**
 * 提取 PDF 全部页面的文本，页与页之间以空行分隔（扫描件等无文本层的页面为空，
 * 可在阅读视图中识别后追加到正文）
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdf = await openPdf(data);
  try {
    return (await extractPageTexts(pdf)).filter(Boolean).join('\n\n');
  } finally {
    await pdf.destroy();
  }
}

/** 文字识别的渲染分辨率：300 DPI（PDF 坐标单位为 1/72 英寸） */
const OCR_RENDER_SCALE = 300 / 72;
/** 画布最长边上限，避免超大幅面占用过多内存 */
const OCR_MAX_CANVAS_SIDE = 4096;

/**
 * 把页面渲染到新画布（供文字识别），返回画布与渲染比例（画布像素 / 缩放比例 1 下的页面坐标）
 */
export async function renderPageToCanvas(
  pdf: Pick<PDFDocumentProxy, 'getPage'>,
  pageNumber: number
): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(OCR_RENDER_SCALE, OCR_MAX_CANVAS_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布');
  await page.render({ canvasContext: context, viewport }).promise;
  return { canvas, scale: canvas.width / base.width };
}
