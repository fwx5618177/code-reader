// @vitest-environment node
// ================================
// 音视频流式协议：Range 解析、附件目录限制（含符号链接逃逸）、206 分段响应
// ================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({ protocol: { handle: vi.fn() }, app: { getPath: () => '' }, ipcMain: { handle: vi.fn() } }));
vi.mock('../../workspace/workspace-manager', () => ({ getWorkspaceManager: () => ({ getCurrent: () => ({}) }) }));

import { handleMediaRequest, mediaPathOf, parseRange } from '../media-protocol';

const url = (path: string) => `kb-media://file/${encodeURIComponent(path)}`;
const request = (path: string, range?: string) =>
  new Request(url(path), { headers: range ? { Range: range } : {} });

let root: string;
let attachments: string;
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-media-'));
  attachments = join(root, 'attachments');
  mkdirSync(attachments);
  writeFileSync(join(attachments, '会议 录像.mp4'), bytes);
  writeFileSync(join(attachments, 'empty.mp3'), '');
  writeFileSync(join(root, 'secret.txt'), 'secret');
  symlinkSync(join(root, 'secret.txt'), join(attachments, 'link.mp4'));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('parseRange', () => {
  it('起止、开放结尾、后缀范围；越界与非法格式', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=500-5000', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-1', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-9', 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });

  it('协议 URL 还原文件路径（含空格与中文）', () => {
    expect(mediaPathOf(url('/a/会议 录像.mp4'))).toBe('/a/会议 录像.mp4');
    expect(mediaPathOf('kb-media://other/x')).toBeNull();
  });
});

describe('handleMediaRequest', () => {
  it('无 Range 时返回整段并声明支持 Range', async () => {
    const response = await handleMediaRequest(request(join(attachments, '会议 录像.mp4')), attachments);
    expect(response.status).toBe(200);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Content-Length')).toBe('1000');
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('Range 请求只返回请求的片段（206）', async () => {
    const response = await handleMediaRequest(request(join(attachments, '会议 录像.mp4'), 'bytes=100-199'), attachments);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 100-199/1000');
    expect(response.headers.get('Content-Length')).toBe('100');
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(100, 200))).toBe(true);
  });

  it('范围越界返回 416；空文件返回 200 空内容', async () => {
    const outOfRange = await handleMediaRequest(request(join(attachments, '会议 录像.mp4'), 'bytes=2000-'), attachments);
    expect(outOfRange.status).toBe(416);
    expect(outOfRange.headers.get('Content-Range')).toBe('bytes */1000');
    const empty = await handleMediaRequest(request(join(attachments, 'empty.mp3')), attachments);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('Content-Length')).toBe('0');
  });

  it('附件目录之外的文件、借符号链接逃逸、不存在的文件都拒绝', async () => {
    expect((await handleMediaRequest(request(join(root, 'secret.txt')), attachments)).status).toBe(403);
    expect((await handleMediaRequest(request(join(attachments, '..', 'secret.txt')), attachments)).status).toBe(403);
    expect((await handleMediaRequest(request(join(attachments, 'link.mp4')), attachments)).status).toBe(403);
    expect((await handleMediaRequest(request(join(attachments, 'missing.mp4')), attachments)).status).toBe(403);
  });
});
