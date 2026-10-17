// ================================
// Obsidian 库导入：.md / .txt 为笔记，二进制文件为附件，目录结构为文件夹
// - frontmatter 的 tags / created / updated 写入条目，其余字段保存在 metadata.frontmatter
// - 正文行内标签（#标签、#父/子）一并加入标签，正文不变
// - 链接按 Obsidian 规则解析（路径式、按文件名“最短路径优先”），改写为本应用按标题解析的链接与嵌入
// ================================

import type { ImportFileEntry } from '../../types/electron';
import { normalizeTagPath } from '../../../shared/tag-path';
import {
  attachmentItemType,
  baseName,
  directorySegments,
  fileExtension,
  mimeFromFileName,
  sanitizeTitle,
  stripExtension,
  TitleRegistry,
  toIsoDate,
} from './common';
import { frontmatterList, frontmatterString, splitFrontmatter } from './frontmatter';
import { proseLines, rewriteLinks, type LinkTarget } from './link-rewrite';
import type { ImportEntry, ImportPlan } from './types';

const NOTE_EXTENSIONS = new Set(['md', 'markdown']);
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;

/** 解析路径中的 . 与 ..；越出根目录时为 null */
export function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

/** 正文中的行内标签（代码以外；不能全是数字） */
export function inlineTags(markdown: string): string[] {
  const tags: string[] = [];
  for (const line of proseLines(markdown)) {
    for (const match of line.matchAll(INLINE_TAG)) {
      const tag = match[1].replace(/[/-]+$/, '');
      if (tag && !/^\d+$/.test(tag)) tags.push(tag);
    }
  }
  return tags;
}

interface VaultFile {
  path: string;
  dir: string;
  target: LinkTarget;
}

/** 按文件名查找：同目录优先，否则取路径最短的 */
function pickCandidate(candidates: VaultFile[] | undefined, fromDir: string): VaultFile | null {
  if (!candidates || candidates.length === 0) return null;
  return (
    candidates.find((file) => file.dir === fromDir) ??
    [...candidates].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))[0]
  );
}

export function parseObsidianVault(files: ImportFileEntry[]): ImportPlan {
  const titles = new TitleRegistry();
  const warnings: string[] = [];
  const byPath = new Map<string, VaultFile>();
  const byName = new Map<string, VaultFile[]>();
  const register = (file: VaultFile, names: string[]) => {
    byPath.set(file.path.toLowerCase(), file);
    for (const name of names) {
      const key = name.toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), file]);
    }
  };

  const notes: ImportFileEntry[] = [];
  const attachments: ImportFileEntry[] = [];
  const skipped = new Map<string, number>();
  for (const file of files) {
    const extension = fileExtension(file.path);
    if (file.text !== undefined && (NOTE_EXTENSIONS.has(extension) || extension === 'txt')) notes.push(file);
    else if (file.text === undefined) attachments.push(file);
    else skipped.set(extension, (skipped.get(extension) ?? 0) + 1);
  }
  if (skipped.size > 0) {
    const count = [...skipped.values()].reduce((sum, n) => sum + n, 0);
    const kinds = [...skipped.keys()].map((ext) => `.${ext}`).join('、');
    warnings.push(`跳过 ${count} 个不支持的文件（${kinds}）`);
  }

  // 先确定所有标题，正文改写时才能引用最终标题
  for (const file of notes) {
    const name = baseName(file.path);
    const extension = fileExtension(name) === 'txt' ? '.txt' : '.md';
    const title = titles.claim(sanitizeTitle(stripExtension(name)) + extension);
    register(
      { path: file.path, dir: directorySegments(file.path).join('/'), target: { title, isNote: true } },
      [name, stripExtension(name)]
    );
  }
  for (const file of attachments) {
    const name = baseName(file.path);
    const title = titles.claim(sanitizeTitle(name));
    register({ path: file.path, dir: directorySegments(file.path).join('/'), target: { title, isNote: false } }, [name]);
  }

  const entries: ImportEntry[] = [];
  for (const file of notes) {
    const dir = directorySegments(file.path).join('/');
    const self = byPath.get(file.path.toLowerCase())!;
    const isTxt = fileExtension(file.path) === 'txt';
    const { data, body } = isTxt ? { data: {}, body: file.text! } : splitFrontmatter(file.text!);

    const resolveWiki = (target: string): LinkTarget | null => {
      if (!target) return self.target;
      const normalized = normalizePath(target);
      if (normalized && normalized.includes('/')) {
        const exact = byPath.get(normalized.toLowerCase()) ?? byPath.get(`${normalized}.md`.toLowerCase());
        if (exact) return exact.target;
      }
      return pickCandidate(byName.get(baseName(target).toLowerCase()), dir)?.target ?? null;
    };
    const resolvePath = (path: string): LinkTarget | null => {
      const relative = normalizePath(dir ? `${dir}/${path}` : path);
      const fromRoot = normalizePath(path);
      for (const candidate of [relative, fromRoot]) {
        const hit = candidate !== null ? byPath.get(candidate.toLowerCase()) : undefined;
        if (hit) return hit.target;
      }
      return pickCandidate(byName.get(baseName(path).toLowerCase()), dir)?.target ?? null;
    };

    const content = isTxt ? body : rewriteLinks(body, { wiki: resolveWiki, path: resolvePath });
    const tags = [
      ...frontmatterList(data.tags ?? data.tag),
      ...(isTxt ? [] : inlineTags(body)),
    ]
      .map(normalizeTagPath)
      .filter(Boolean);
    const rest = Object.fromEntries(
      Object.entries(data).filter(
        ([key]) => !['tags', 'tag', 'created', 'date', 'created_at', 'updated', 'modified', 'updated_at'].includes(key)
      )
    );
    entries.push({
      key: file.path,
      type: 'note',
      title: self.target.title,
      content: content.replace(/^\n+/, ''),
      tags: [...new Set(tags)],
      folderPath: directorySegments(file.path),
      createdAt: toIsoDate(frontmatterString(data.created ?? data.date ?? data.created_at)),
      updatedAt: toIsoDate(frontmatterString(data.updated ?? data.modified ?? data.updated_at)),
      ...(Object.keys(rest).length > 0 ? { metadata: { frontmatter: rest } } : {}),
    });
  }

  for (const file of attachments) {
    const target = byPath.get(file.path.toLowerCase())!.target;
    const mimeType = mimeFromFileName(file.path);
    entries.push({
      key: file.path,
      type: attachmentItemType(mimeType),
      title: target.title,
      tags: [],
      folderPath: directorySegments(file.path),
      file: { source: { kind: 'file', path: file.path }, fileName: baseName(file.path), mimeType },
    });
  }

  return { entries, warnings };
}
