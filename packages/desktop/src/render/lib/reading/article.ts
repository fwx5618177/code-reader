// ================================
// 阅读内容解析
// 决定条目在阅读视图中以何种方式呈现：正文（Markdown/纯文本）或附件（图片/音视频/PDF/EPUB/其他文件）
// ================================

import type { ContentFormat } from '../markdown';
import type { KnowledgeItem } from '../../types/knowledge';

/** 可渲染的正文 */
export interface ArticleSource {
  content: string;
  format: ContentFormat;
}

/** 附件呈现方式；file 表示无法在应用内预览 */
export type AttachmentKind = 'image' | 'audio' | 'video' | 'pdf' | 'epub' | 'file';

/** 可在应用内阅读的电子书/文档格式 */
export type DocumentFormat = 'pdf' | 'epub';

const DOCUMENT_MIME_TYPES: Record<string, DocumentFormat> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
};

/** MIME 类型缺失时按扩展名推断 */
const EXTENSION_KINDS: Record<string, AttachmentKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  flac: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  pdf: 'pdf',
  epub: 'epub',
};

function extensionOf(path: string): string | undefined {
  return /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase();
}

/**
 * 判断文件是否为 PDF / EPUB：优先 MIME 类型，其次扩展名
 */
export function documentFormat(file: { name: string; type?: string }): DocumentFormat | null {
  const byMime = file.type ? DOCUMENT_MIME_TYPES[file.type] : undefined;
  if (byMime) return byMime;
  const extension = extensionOf(file.name);
  return extension === 'pdf' || extension === 'epub' ? extension : null;
}

/**
 * 条目正文：纯文本笔记（.txt）按纯文本渲染，其余按 Markdown。
 * PDF / EPUB 的 content 只是用于检索的提取文本，阅读时直接呈现原文件，不作为正文。
 */
export function resolveArticle(
  item: Pick<KnowledgeItem, 'type' | 'title' | 'content' | 'filePath' | 'mimeType'>
): ArticleSource | null {
  if (!item.content || !item.content.trim()) return null;
  if (item.filePath && documentFormat({ name: item.filePath, type: item.mimeType })) return null;
  const format: ContentFormat =
    item.type === 'note' && /\.txt$/i.test(item.title) ? 'plain' : 'markdown';
  return { content: item.content, format };
}

/**
 * 附件呈现方式：优先 MIME 类型，其次条目类型，最后文件扩展名
 */
export function resolveAttachmentKind(
  item: Pick<KnowledgeItem, 'type' | 'filePath' | 'mimeType'>
): AttachmentKind | null {
  if (!item.filePath) return null;
  const mime = item.mimeType ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (DOCUMENT_MIME_TYPES[mime]) return DOCUMENT_MIME_TYPES[mime];
  if (item.type === 'image' || item.type === 'audio' || item.type === 'video') return item.type;
  const extension = extensionOf(item.filePath);
  return (extension && EXTENSION_KINDS[extension]) || 'file';
}

/**
 * 来源链接的简短显示（域名）
 */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
