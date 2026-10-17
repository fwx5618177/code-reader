// @vitest-environment node
// ================================
// 剪藏图片下载 IPC 测试：只接受 http(s) 与 image/*、超过大小上限整体拒绝、
// 结果按输入顺序返回、并发数受限（electron 的 net.fetch 以 mock 代替）
// ================================

import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const { handlers, fetchMock } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  fetchMock: vi.fn<[string], Promise<Response>>(),
}));

vi.mock('electron', () => ({
  app: { userAgentFallback: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0 Electron/28.0.0 Safari/537.36' },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  net: { fetch: (url: string) => fetchMock(url) },
}));

import { registerWebHandlers } from '../ipc-handlers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const MB = 1024 * 1024;

function image(body: BodyInit, type = 'image/png', headers: Record<string, string> = {}): Response {
  return new Response(body, { headers: { 'content-type': type, ...headers } });
}

/** 分块输出 size 字节、不声明长度的响应 */
function streamed(size: number, chunk = MB): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= size) {
        controller.close();
        return;
      }
      const length = Math.min(chunk, size - sent);
      sent += length;
      controller.enqueue(new Uint8Array(length));
    },
  });
  return new Response(body, { headers: { 'content-type': 'image/jpeg' } });
}

function download(urls: unknown, directory: unknown) {
  return handlers.get('web:downloadImages')!(null, urls, directory) as Promise<
    Array<{ url: string; filePath?: string; mimeType?: string; size?: number; error?: string }>
  >;
}

let dir: string;

beforeEach(async () => {
  handlers.clear();
  registerWebHandlers();
  dir = await mkdtemp(join(tmpdir(), 'clip-images-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('web:downloadImages', () => {
  it('保存图片并按输入顺序返回结果，扩展名取自 MIME 类型', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.endsWith('.svg') ? image('<svg/>', 'image/svg+xml; charset=utf-8') : image(PNG, 'image/jpeg')
    );
    const target = join(dir, 'attachments');

    const results = await download(['https://a.com/%E5%9B%BE%20one.jpg?x=1', 'http://b.com/logo.svg'], target);

    expect(results.map((result) => result.url)).toEqual([
      'https://a.com/%E5%9B%BE%20one.jpg?x=1',
      'http://b.com/logo.svg',
    ]);
    expect(results[0]).toMatchObject({ mimeType: 'image/jpeg', size: PNG.byteLength });
    expect(results[0].filePath).toMatch(/-0-图_one\.jpg$/);
    expect(results[1]).toMatchObject({ mimeType: 'image/svg+xml' });
    expect(results[1].filePath).toMatch(/-1-logo\.svg$/);
    expect(new Uint8Array(await readFile(results[0].filePath!))).toEqual(PNG);
  });

  it('非图片响应、非 http(s) 地址与错误状态码各自失败，不影响其他图片', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('page')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
      if (url.includes('missing')) return new Response('', { status: 404 });
      return image(PNG);
    });

    const results = await download(
      ['https://a.com/page', 'file:///etc/passwd', 'https://a.com/missing.png', 'https://a.com/ok.png'],
      dir
    );

    expect(results[0].error).toContain('不是图片');
    expect(results[1].error).toContain('http');
    expect(results[2].error).toBe('服务器返回 404');
    expect(results[3].filePath).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith('file:///etc/passwd');
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('超过大小上限的图片被拒绝而不是截断保存', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.includes('declared') ? image(PNG, 'image/png', { 'content-length': String(11 * MB) }) : streamed(11 * MB)
    );

    const results = await download(['https://a.com/declared.png', 'https://a.com/streamed.jpg'], dir);

    expect(results.map((result) => result.error)).toEqual(['图片过大', '图片过大']);
    expect(await readdir(dir)).toEqual([]);
  });

  it('同时进行的下载不超过 4 个', async () => {
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return image(PNG);
    });

    const urls = Array.from({ length: 10 }, (_, index) => `https://a.com/${index}.png`);
    const results = await download(urls, dir);

    expect(results.every((result) => result.filePath)).toBe(true);
    expect(peak).toBe(4);
  });

  it('保存目录必须是绝对路径', async () => {
    await expect(download(['https://a.com/a.png'], 'relative/dir')).rejects.toThrow('保存目录无效');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
