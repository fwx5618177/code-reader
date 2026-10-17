// ================================
// PDF 支持
// 按需加载 pdf.js（及其 Worker），提供文档打开与全文提取。
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
export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({
    data,
    CMapReaderFactory: InlineCMapReaderFactory,
    StandardFontDataFactory: InlineStandardFontDataFactory,
    isEvalSupported: false,
  }).promise;
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
 * 提取 PDF 全部页面的文本，页与页之间以空行分隔（扫描件等无文本层的页面为空）
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdf = await openPdf(data);
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pageText(content.items);
      if (text) pages.push(text);
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    await pdf.destroy();
  }
}
