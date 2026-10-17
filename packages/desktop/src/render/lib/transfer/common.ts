// ================================
// 导入解析器共用的小工具：文件类型、标题去重、路径处理
// ================================

import type { KnowledgeItemType } from '../../types/knowledge';
import { normalizeLinkTarget } from '../links/link-index';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  heic: 'image/heic',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  zip: 'application/zip',
};

/** 文件扩展名（小写，不含点；没有时为空字符串） */
export function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** 去掉扩展名 */
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 路径的最后一段 */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** 路径的目录部分（各级） */
export function directorySegments(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  return parts.filter(Boolean);
}

/** 按扩展名推断 MIME；未知时为 application/octet-stream */
export function mimeFromFileName(name: string): string {
  return MIME_BY_EXTENSION[fileExtension(name)] ?? 'application/octet-stream';
}

/** 附件条目类型：PDF / EPUB / Office / 文本为文档，其余按 MIME 大类 */
export function attachmentItemType(mimeType: string): KnowledgeItemType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/epub+zip' ||
    mimeType.startsWith('text/') ||
    mimeType.includes('word') ||
    mimeType.includes('officedocument') ||
    mimeType.includes('ms-excel') ||
    mimeType.includes('ms-powerpoint')
  ) {
    return 'document';
  }
  return 'file';
}

/**
 * 标题登记：保证标题唯一（按链接目标规范化比较：大小写不敏感、忽略 .md 等文本扩展名）。
 * 重名时在扩展名前追加“ (2)”“ (3)”……
 */
export class TitleRegistry {
  private readonly used = new Set<string>();

  constructor(existing: Iterable<string> = []) {
    for (const title of existing) this.used.add(normalizeLinkTarget(title));
  }

  has(title: string): boolean {
    return this.used.has(normalizeLinkTarget(title));
  }

  /** 登记并返回唯一标题 */
  claim(title: string): string {
    let candidate = title;
    const dot = title.lastIndexOf('.');
    const [stem, extension] = dot > 0 ? [title.slice(0, dot), title.slice(dot)] : [title, ''];
    for (let n = 2; this.has(candidate); n += 1) candidate = `${stem} (${n})${extension}`;
    this.used.add(normalizeLinkTarget(candidate));
    return candidate;
  }
}

/** 不能出现在标题与嵌入目标中的字符（[ ] | # ^ 与换行）替换为空格 */
export function sanitizeTitle(title: string): string {
  return title.replace(/[[\]|#^\n\r]+/g, ' ').replace(/\s+/g, ' ').trim() || '未命名';
}

/** 解析日期字符串为 ISO；无法解析时为 undefined */
export function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
