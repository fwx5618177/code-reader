// ================================
// Notion 导出（Markdown & CSV，已由主进程解压）导入
// - 文件名与目录名带“ <32 位十六进制 ID>”后缀，去掉后作为标题与文件夹名
// - 页面开头的“# 标题”行去掉；紧随其后的属性块保留，其中 Tags / Created 等属性写入标签与时间
// - 页面间链接与图片改写为本应用的 wiki 链接与块级嵌入；数据库 CSV 转为 Markdown 表格笔记
// ================================

import type { ImportFileEntry } from '../../types/electron';
import { normalizeTagPath } from '../../../shared/tag-path';
import {
  attachmentItemType,
  baseName,
  fileExtension,
  mimeFromFileName,
  sanitizeTitle,
  stripExtension,
  TitleRegistry,
  toIsoDate,
} from './common';
import { rewriteLinks, type LinkTarget } from './link-rewrite';
import { normalizePath } from './obsidian';
import type { ImportEntry, ImportPlan } from './types';

const NOTION_ID = /\s+[0-9a-f]{32}$/i;
const TAG_KEYS = new Set(['tags', 'tag', '标签', '多选标签']);
const CREATED_KEYS = new Set(['created', 'created time', '创建时间', 'date', '日期']);
const UPDATED_KEYS = new Set(['last edited time', '最后编辑时间', 'updated']);
const PROPERTY = /^([^:\n]{1,40}):\s*(.*)$/;

/** 去掉 Notion ID 后缀 */
export function stripNotionId(name: string): string {
  return name.replace(NOTION_ID, '').trim() || name;
}

/** 解析 CSV（支持引号、转义双引号、引号内的逗号与换行） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\ufeff/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

/** CSV 行 → Markdown 表格（第一行为表头） */
export function csvToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((cells) => cells.length));
  const cell = (value: string | undefined) => (value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(cells[i])).join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join(
    '\n'
  );
}

interface PageMeta {
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** 去掉开头的“# 标题”行，读取紧随其后的属性块（属性行保留在正文中） */
function readPage(text: string): { body: string; meta: PageMeta } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let index = lines.findIndex((line) => line.trim());
  if (index >= 0 && /^#\s+/.test(lines[index])) {
    lines.splice(index, 1);
    while (lines[index] !== undefined && !lines[index].trim()) lines.splice(index, 1);
  } else {
    index = Math.max(index, 0);
  }
  const meta: PageMeta = { tags: [] };
  for (let i = index; i < lines.length && lines[i].trim(); i += 1) {
    const match = PROPERTY.exec(lines[i]);
    if (!match) break;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (TAG_KEYS.has(key)) meta.tags.push(...value.split(',').map((tag) => tag.trim()).filter(Boolean));
    else if (CREATED_KEYS.has(key)) meta.createdAt ??= toIsoDate(value);
    else if (UPDATED_KEYS.has(key)) meta.updatedAt ??= toIsoDate(value);
  }
  return { body: lines.join('\n').trim(), meta };
}

/** 所有文件都在同一个外层目录（导出包装目录）下时去掉这一层 */
function stripWrapperDirectory(files: ImportFileEntry[]): ImportFileEntry[] {
  const first = files[0]?.path.split('/')[0];
  if (!first || files.some((file) => !file.path.startsWith(`${first}/`))) return files;
  if (NOTION_ID.test(first)) return files;
  return stripWrapperDirectory(files.map((file) => ({ ...file, path: file.path.slice(first.length + 1) })));
}

function folderSegments(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  return parts.filter(Boolean).map(stripNotionId);
}

interface PlannedFile {
  file: ImportFileEntry;
  originalPath: string;
  target: LinkTarget;
}

export function parseNotionExport(input: ImportFileEntry[]): ImportPlan {
  const files = stripWrapperDirectory(input.map((file) => ({ ...file, originalPath: file.path }))) as Array<
    ImportFileEntry & { originalPath: string }
  >;
  const titles = new TitleRegistry();
  const warnings: string[] = [];
  const byPath = new Map<string, PlannedFile>();
  const plan = (file: ImportFileEntry & { originalPath: string }, title: string, isNote: boolean): PlannedFile => {
    const planned = { file, originalPath: file.originalPath, target: { title, isNote } };
    byPath.set(file.path.toLowerCase(), planned);
    return planned;
  };

  const pages: PlannedFile[] = [];
  const tables: PlannedFile[] = [];
  const attachments: PlannedFile[] = [];
  let skipped = 0;
  const csvPaths = new Set(files.filter((file) => fileExtension(file.path) === 'csv').map((file) => file.path));

  for (const file of files) {
    const extension = fileExtension(file.path);
    const stem = stripNotionId(stripExtension(baseName(file.path)));
    if (extension === 'md' && file.text !== undefined) {
      pages.push(plan(file, titles.claim(sanitizeTitle(stem) + '.md'), true));
    } else if (extension === 'txt' && file.text !== undefined) {
      pages.push(plan(file, titles.claim(sanitizeTitle(stem) + '.txt'), true));
    } else if (extension === 'csv' && file.text !== undefined) {
      // 同一数据库的 X.csv 与 X_all.csv：只用包含全部行的 _all 版本
      if (!file.path.endsWith('_all.csv') && csvPaths.has(file.path.replace(/\.csv$/, '_all.csv'))) continue;
      const name = stripNotionId(stem.replace(/_all$/, ''));
      tables.push(plan(file, titles.claim(sanitizeTitle(name) + '.md'), true));
    } else if (file.text === undefined) {
      attachments.push({ file, originalPath: file.originalPath, target: { title: '', isNote: false } });
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) warnings.push(`跳过 ${skipped} 个不支持的文本文件`);

  // 附件常见同名（image.png、Untitled.png）：重名时加上所属页面标题
  for (const attachment of attachments) {
    const name = sanitizeTitle(baseName(attachment.file.path));
    const page = folderSegments(attachment.file.path).at(-1);
    const title = !titles.has(name) || !page ? titles.claim(name) : titles.claim(sanitizeTitle(`${page} - ${name}`));
    attachment.target.title = title;
    byPath.set(attachment.file.path.toLowerCase(), attachment);
  }

  const entries: ImportEntry[] = [];
  for (const page of pages) {
    const dir = page.file.path.split('/').slice(0, -1).join('/');
    const resolvePath = (path: string): LinkTarget | null => {
      const normalized = normalizePath(dir ? `${dir}/${path}` : path);
      return (normalized !== null && byPath.get(normalized.toLowerCase())?.target) || null;
    };
    const isTxt = fileExtension(page.file.path) === 'txt';
    const { body, meta } = isTxt ? { body: page.file.text!, meta: { tags: [] } as PageMeta } : readPage(page.file.text!);
    entries.push({
      key: page.originalPath,
      type: 'note',
      title: page.target.title,
      content: isTxt ? body : rewriteLinks(body, { wiki: () => null, path: resolvePath }),
      tags: [...new Set(meta.tags.map(normalizeTagPath).filter(Boolean))],
      folderPath: folderSegments(page.file.path),
      ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
      ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
    });
  }

  for (const table of tables) {
    entries.push({
      key: table.originalPath,
      type: 'note',
      title: table.target.title,
      content: csvToMarkdownTable(parseCsv(table.file.text!)),
      tags: [],
      folderPath: folderSegments(table.file.path),
    });
  }

  for (const attachment of attachments) {
    const mimeType = mimeFromFileName(attachment.file.path);
    entries.push({
      key: attachment.originalPath,
      type: attachmentItemType(mimeType),
      title: attachment.target.title,
      tags: [],
      folderPath: folderSegments(attachment.file.path),
      file: {
        source: { kind: 'file', path: attachment.originalPath },
        fileName: baseName(attachment.file.path),
        mimeType,
      },
    });
  }

  return { entries, warnings };
}
