// ================================
// 网页抓取 IPC 处理器
// 渲染进程受 CSP（connect-src 'self'）限制无法访问外部网址，
// 网页剪藏经主进程 net.fetch 获取 HTML 与正文图片，正文提取仍在渲染进程完成。
// ================================

import { app, ipcMain, net } from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import { isAbsolute, join } from 'path';

/** 网页抓取结果 */
export interface FetchedHtml {
  /** 重定向后的最终地址 */
  url: string;
  html: string;
}

/** 已保存到本地的图片 */
export interface DownloadedImage {
  /** 请求时的地址（原样返回，便于调用方对应） */
  url: string;
  filePath: string;
  mimeType: string;
  size: number;
}

/** 下载失败的图片 */
export interface FailedImage {
  url: string;
  error: string;
}

export type ImageDownloadResult = DownloadedImage | FailedImage;

/** 请求超时（毫秒，含读取响应体） */
const FETCH_TIMEOUT = 20_000;
/** 网页大小上限：超过时整体拒绝，不截断内容 */
const MAX_HTML_BYTES = 15 * 1024 * 1024;
/** 单张图片大小上限：超过时放弃该图片，不截断保存 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 同时下载的图片数 */
const IMAGE_CONCURRENCY = 4;
/** 文件名中保留的原始文件名长度 */
const IMAGE_NAME_LENGTH = 40;
/** 图片子类型 → 扩展名（其余取子类型中的字母数字） */
const IMAGE_EXTENSIONS: Record<string, string> = {
  jpeg: 'jpg',
  pjpeg: 'jpg',
  'svg+xml': 'svg',
  'x-icon': 'ico',
  'vnd.microsoft.icon': 'ico',
};
/** 嗅探 <meta charset> 时检查的字节数 */
const CHARSET_SNIFF_BYTES = 4096;
/** UA 中保留的浏览器产品标识 */
const BROWSER_PRODUCTS = /^(Mozilla|AppleWebKit|Chrome|Safari)\//;

function parseWebUrl(input: unknown): URL {
  if (typeof input !== 'string') throw new Error('网址无效');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('网址无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http 或 https 网址');
  }
  return url;
}

/** 去掉 UA 中的 Electron 与应用标识，避免被网站识别为非浏览器而拒绝 */
function browserUserAgent(): string {
  return app.userAgentFallback
    .split(' ')
    .filter((token) => !/^\S+\/[\d.]+$/.test(token) || BROWSER_PRODUCTS.test(token))
    .join(' ');
}

/** 读取响应体，超过上限时中止并报错 */
async function readBody(response: Response, limit: number, tooLarge: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > limit) throw new Error(tooLarge);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(tooLarge);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** 字符集：优先响应头，其次页面开头的 <meta> 声明 */
function detectCharset(contentType: string, body: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const head = new TextDecoder('latin1').decode(body.subarray(0, CHARSET_SNIFF_BYTES));
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
}

function decodeHtml(contentType: string, body: Uint8Array): string {
  try {
    return new TextDecoder(detectCharset(contentType, body)).decode(body);
  } catch {
    // 无法识别的字符集按 UTF-8 解码
    return new TextDecoder('utf-8').decode(body);
  }
}

/**
 * GET 请求：使用浏览器 UA，非 2xx 视为失败；超时覆盖读取响应体的整个过程
 */
async function fetchWeb<T>(url: URL, accept: string, read: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await net.fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': browserUserAgent(), Accept: accept },
    });
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function fetchHtml(input: unknown): Promise<FetchedHtml> {
  const url = parseWebUrl(input);
  return fetchWeb(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', async (response) => {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error(`链接内容不是网页（${contentType.split(';')[0]}）`);
    }
    const body = await readBody(response, MAX_HTML_BYTES, '网页过大，无法剪藏');
    return { url: response.url || url.toString(), html: decodeHtml(contentType, body) };
  });
}

function imageExtension(mimeType: string): string {
  const subtype = mimeType.slice(mimeType.indexOf('/') + 1);
  return IMAGE_EXTENSIONS[subtype] ?? (subtype.replace(/[^a-z0-9]/g, '') || 'img');
}

/** 地址中的原始文件名（去掉扩展名与文件系统不允许的字符），便于在附件目录中辨认 */
function imageBaseName(url: URL): string {
  const last = url.pathname.split('/').pop() ?? '';
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  const base = name
    .replace(/\.[^.]*$/, '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, IMAGE_NAME_LENGTH);
  return base || 'image';
}

/**
 * 下载单张图片到目录：只接受 image/* 响应，超过大小上限时拒绝
 */
function downloadImage(input: unknown, directory: string, fileStem: string): Promise<DownloadedImage> {
  const url = parseWebUrl(input);
  return fetchWeb(url, 'image/*', async (response) => {
    const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mimeType.startsWith('image/')) throw new Error(`链接内容不是图片（${mimeType || '未知类型'}）`);
    const body = await readBody(response, MAX_IMAGE_BYTES, '图片过大');
    const filePath = join(directory, `${fileStem}-${imageBaseName(url)}.${imageExtension(mimeType)}`);
    await writeFile(filePath, body);
    return { url: String(input), filePath, mimeType, size: body.byteLength };
  });
}

/**
 * 批量下载图片：限制并发数，结果按输入顺序返回；单张失败不影响其他图片
 */
async function downloadImages(urls: unknown, directory: unknown): Promise<ImageDownloadResult[]> {
  if (!Array.isArray(urls)) throw new Error('图片地址列表无效');
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('保存目录无效');
  await mkdir(directory, { recursive: true });

  const stamp = Date.now().toString(36);
  const results = new Array<ImageDownloadResult>(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const index = next++;
      const input: unknown = urls[index];
      try {
        results[index] = await downloadImage(input, directory, `${stamp}-${index}`);
      } catch (error) {
        results[index] = { url: String(input), error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, urls.length) }, worker));
  return results;
}

export function registerWebHandlers(): void {
  ipcMain.handle('web:fetchHtml', async (_event, url: unknown) => {
    try {
      return await fetchHtml(url);
    } catch (error) {
      console.error('[IPC] web:fetchHtml error:', error);
      throw error;
    }
  });

  ipcMain.handle('web:downloadImages', async (_event, urls: unknown, directory: unknown) => {
    try {
      return await downloadImages(urls, directory);
    } catch (error) {
      console.error('[IPC] web:downloadImages error:', error);
      throw error;
    }
  });
}
