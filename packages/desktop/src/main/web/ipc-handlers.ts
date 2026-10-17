// ================================
// 网页抓取 IPC 处理器
// 渲染进程受 CSP（connect-src 'self'）限制无法访问外部网址，
// 网页剪藏经主进程 net.fetch 获取 HTML，正文提取仍在渲染进程完成。
// ================================

import { app, ipcMain, net } from 'electron';

/** 网页抓取结果 */
export interface FetchedHtml {
  /** 重定向后的最终地址 */
  url: string;
  html: string;
}

/** 请求超时（毫秒） */
const FETCH_TIMEOUT = 20_000;
/** 网页大小上限：超过时整体拒绝，不截断内容 */
const MAX_HTML_BYTES = 15 * 1024 * 1024;
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
async function readBody(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_HTML_BYTES) throw new Error('网页过大，无法剪藏');
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error('网页过大，无法剪藏');
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

async function fetchHtml(input: unknown): Promise<FetchedHtml> {
  const url = parseWebUrl(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await net.fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': browserUserAgent(),
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error(`链接内容不是网页（${contentType.split(';')[0]}）`);
    }
    const body = await readBody(response);
    return { url: response.url || url.toString(), html: decodeHtml(contentType, body) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
}
