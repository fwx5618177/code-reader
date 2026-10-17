// ================================
// 印象笔记 / Evernote 导出（.enex）导入
// 每个 .enex 文件是一个笔记本（导入为同名文件夹）；每条 <note> 的 ENML 正文转换为 Markdown，
// 内嵌资源（base64）保存为附件条目，正文中的 <en-media hash> 按资源二进制的 MD5 对应，改写为块级嵌入 ![[附件标题]]
// ================================

import { DOMParser as PMDOMParser } from 'prosemirror-model';
import type { ImportFileEntry } from '../../types/electron';
import { normalizeTagPath } from '../../../shared/tag-path';
import { markdownSchema, serializeMarkdown } from '../markdown';
import { attachmentItemType, baseName, fileExtension, mimeFromFileName, sanitizeTitle, stripExtension, TitleRegistry } from './common';
import { md5Hex } from './md5';
import type { ImportEntry, ImportPlan } from './types';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
};

const EMBED_TOKEN = 'ENEXEMBED';
const TODO_TOKEN = 'ENEXTODO';

/** 20201010T101010Z → ISO；无效时为 undefined */
export function parseEnexDate(value: string | null | undefined): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match;
  const time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function childText(parent: Element, tag: string): string | undefined {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) return child.textContent ?? undefined;
  }
  return undefined;
}

function childElement(parent: Element, tag: string): Element | undefined {
  return Array.from(parent.children).find((child) => child.tagName === tag);
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface EnmlResult {
  markdown: string;
  encrypted: number;
}

/**
 * ENML → Markdown：en-media / en-todo 先替换为只含字母数字的占位符（避免被当作 HTML 未闭合元素吞掉后续内容，
 * 也避免序列化时被转义），转换后再还原为块级嵌入与任务项
 */
export function enmlToMarkdown(enml: string, embedTitle: (hash: string) => string | undefined): EnmlResult {
  const hashes: string[] = [];
  let encrypted = 0;
  const prepared = enml
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<en-media\b([^>]*?)\/?>(?:\s*<\/en-media>)?/gi, (_match, attributes: string) => {
      const hash = /\bhash\s*=\s*"([0-9a-f]+)"/i.exec(attributes)?.[1]?.toLowerCase() ?? '';
      hashes.push(hash);
      return `<p>${EMBED_TOKEN}${hashes.length - 1}${EMBED_TOKEN}</p>`;
    })
    .replace(/<en-todo\b([^>]*?)\/?>(?:\s*<\/en-todo>)?/gi, (_match, attributes: string) =>
      /\bchecked\s*=\s*"true"/i.test(attributes) ? `${TODO_TOKEN}X ` : `${TODO_TOKEN}O `
    )
    .replace(/<en-crypt\b[^>]*>[\s\S]*?<\/en-crypt>/gi, () => {
      encrypted += 1;
      return '（加密内容未导入）';
    });

  const body = new DOMParser().parseFromString(prepared, 'text/html').body;
  let markdown = serializeMarkdown(PMDOMParser.fromSchema(markdownSchema).parse(body));

  markdown = markdown.replace(new RegExp(`${EMBED_TOKEN}(\\d+)${EMBED_TOKEN}`, 'g'), (_match, index: string) => {
    const title = embedTitle(hashes[Number(index)]);
    return title ? `\n\n![[${title}]]\n\n` : '';
  });
  markdown = markdown
    .split('\n')
    .map((line) =>
      line
        .replace(new RegExp(`^(\\s*)${TODO_TOKEN}([XO])\\s*`), (_m, indent: string, state: string) =>
          `${indent}- [${state === 'X' ? 'x' : ' '}] `
        )
        .replace(new RegExp(`${TODO_TOKEN}([XO])\\s*`, 'g'), (_m, state: string) => (state === 'X' ? '[x] ' : '[ ] '))
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown, encrypted };
}

interface ParsedResource {
  hash: string;
  data: string;
  mimeType: string;
  fileName: string;
}

function readResources(note: Element, noteTitle: string, warnings: string[]): ParsedResource[] {
  const resources: ParsedResource[] = [];
  Array.from(note.children)
    .filter((child) => child.tagName === 'resource')
    .forEach((resource, index) => {
      const data = (childText(resource, 'data') ?? '').replace(/\s+/g, '');
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64(data);
      } catch {
        warnings.push(`「${noteTitle}」中有一个附件数据无效，已跳过`);
        return;
      }
      const attributes = childElement(resource, 'resource-attributes');
      const declaredName = attributes ? childText(attributes, 'file-name')?.trim() : undefined;
      const mimeType =
        childText(resource, 'mime')?.trim() || (declaredName ? mimeFromFileName(declaredName) : 'application/octet-stream');
      const extension = EXTENSION_BY_MIME[mimeType] ?? 'bin';
      resources.push({
        hash: md5Hex(bytes),
        data,
        mimeType,
        fileName: declaredName || `${noteTitle}-${index + 1}.${extension}`,
      });
    });
  return resources;
}

export function parseEnexFiles(files: ImportFileEntry[]): ImportPlan {
  const titles = new TitleRegistry();
  const warnings: string[] = [];
  const entries: ImportEntry[] = [];
  let encryptedTotal = 0;

  for (const file of files) {
    if (fileExtension(file.path) !== 'enex' || file.text === undefined) continue;
    const notebook = stripExtension(baseName(file.path));
    const doc = new DOMParser().parseFromString(file.text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      warnings.push(`「${baseName(file.path)}」不是有效的 ENEX 文件，已跳过`);
      continue;
    }

    Array.from(doc.getElementsByTagName('note')).forEach((note, index) => {
      const rawTitle = childText(note, 'title')?.trim() || '未命名笔记';
      const title = titles.claim(sanitizeTitle(rawTitle) + '.md');
      const resources = readResources(note, sanitizeTitle(rawTitle), warnings);
      const attachmentTitles = new Map<string, string>();
      const attachments: ImportEntry[] = resources.map((resource, resourceIndex) => {
        const attachmentTitle = titles.claim(sanitizeTitle(resource.fileName));
        if (!attachmentTitles.has(resource.hash)) attachmentTitles.set(resource.hash, attachmentTitle);
        return {
          key: `${file.path}#${index + 1}/${resourceIndex + 1}`,
          type: attachmentItemType(resource.mimeType),
          title: attachmentTitle,
          tags: [],
          folderPath: [notebook],
          file: { source: { kind: 'base64', data: resource.data }, fileName: resource.fileName, mimeType: resource.mimeType },
        };
      });

      const { markdown, encrypted } = enmlToMarkdown(childText(note, 'content') ?? '', (hash) => attachmentTitles.get(hash));
      encryptedTotal += encrypted;
      const attributes = childElement(note, 'note-attributes');
      const sourceUrl = attributes ? childText(attributes, 'source-url')?.trim() : undefined;
      const tags = Array.from(note.children)
        .filter((child) => child.tagName === 'tag')
        .map((tag) => normalizeTagPath(tag.textContent ?? ''))
        .filter(Boolean);

      const createdAt = parseEnexDate(childText(note, 'created'));
      const updatedAt = parseEnexDate(childText(note, 'updated'));
      entries.push({
        key: `${file.path}#${index + 1}`,
        type: 'note',
        title,
        content: markdown,
        tags: [...new Set(tags)],
        folderPath: [notebook],
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
      });
      entries.push(...attachments.map((attachment) => ({ ...attachment, ...(createdAt ? { createdAt } : {}) })));
    });
  }

  if (encryptedTotal > 0) warnings.push(`${encryptedTotal} 处加密内容无法解密，已用占位文字代替`);
  return { entries, warnings };
}
