// ================================
// 本地音视频附件的流式播放协议（主进程）
//   kb-media://file/<encodeURIComponent(绝对路径)>
// - 只提供当前知识库附件目录（<知识库根>/attachments）内的文件；解析符号链接后再检查，防止借链接读出目录外的文件
// - 支持 Range 请求（206 + Content-Range），<video> / <audio> 拖动进度条时只读取需要的片段，
//   不再把整个文件读进内存转成 Blob URL
// ================================

import { protocol } from 'electron';
import { createReadStream } from 'fs';
import { realpath, stat } from 'fs/promises';
import { extname } from 'path';
import { Readable } from 'stream';
import { getWorkspaceManager } from '../workspace/workspace-manager';
import { isInside } from '../transfer/files';

export const MEDIA_SCHEME = 'kb-media';

/** 协议权限：stream 允许媒体元素按需读取，standard / secure 使 URL 按标准方式解析并视为安全来源 */
export const MEDIA_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: MEDIA_SCHEME,
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
};

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
};

/** 字节范围（闭区间） */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * 解析 Range 请求头（只支持单个范围，多范围按整段返回）
 * @returns 没有或不支持的 Range 为 null；范围超出文件为 'unsatisfiable'
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    // 后缀范围：最后 N 个字节
    const length = Number(match[2]);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/** 协议 URL 中的文件路径；格式不对时为 null */
export function mediaPathOf(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.host !== 'file') return null;
  try {
    return decodeURIComponent(parsed.pathname.slice(1)) || null;
  } catch {
    return null;
  }
}

/**
 * 文件位于附件目录内时返回解析符号链接后的真实路径；不在目录内或不存在时为 null
 */
async function resolveInsideAttachments(path: string, attachmentsPath: string): Promise<string | null> {
  try {
    const [root, target] = await Promise.all([realpath(attachmentsPath), realpath(path)]);
    return isInside(root, target) ? target : null;
  } catch {
    return null;
  }
}

/**
 * 处理一次媒体请求；attachmentsPath 为当前知识库的附件目录
 */
export async function handleMediaRequest(request: Request, attachmentsPath: string): Promise<Response> {
  const requested = mediaPathOf(request.url);
  const path = requested ? await resolveInsideAttachments(requested, attachmentsPath) : null;
  if (!path) return new Response('Forbidden', { status: 403 });

  const info = await stat(path);
  if (!info.isFile()) return new Response('Not Found', { status: 404 });
  const size = info.size;
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
  };

  const range = parseRange(request.headers.get('Range'), size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });

  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}

/**
 * 注册协议处理器（app ready 之后调用）；附件目录按请求时的当前知识库解析，切换知识库后自动指向新目录
 */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      return await handleMediaRequest(request, getWorkspaceManager().getCurrent().attachmentsPath);
    } catch (error) {
      console.error('[Media] 读取附件失败:', request.url, error);
      return new Response('Not Found', { status: 404 });
    }
  });
}
