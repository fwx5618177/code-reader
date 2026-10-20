// ================================
// 导出当前知识库
// - Markdown：按文件夹结构写出 .md（头部 YAML 记录类型、标签、时间、来源与摘要），附件文件放在条目所在文件夹，
//   文件名即条目标题，笔记中的 ![[图片.png]] 与 [[笔记]] 在 Obsidian 等工具中可直接解析
// - JSON：knowledge-export.json（全部字段，可用“导入 → 本应用 JSON”还原）+ attachments/ 目录
// ================================

import type { KnowledgeItem, Tag } from '../../types/knowledge';
import type { Folder } from '../folders/types';
import { displayTitle, textExtension } from '../links/link-index';
import { fileExtension, TitleRegistry } from './common';
import { buildKnowledgeExport, KNOWLEDGE_EXPORT_FILE } from './json-format';

export type ExportFormat = 'markdown' | 'json';

export interface ExportProgress {
  done: number;
  total: number;
}

export interface ExportResult {
  path: string;
  items: number;
  files: number;
  failed: Array<{ title: string; error: string }>;
}

export interface ExportInput {
  workspace: string;
  items: KnowledgeItem[];
  tags: Tag[];
  folders: Folder[];
}

/** 文件名与目录名中不允许的字符 */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '未命名';
}

/** 文件夹 ID → 路径（父文件夹缺失或成环时截断） */
export function folderPathResolver(folders: Folder[]): (folderId: string | undefined) => string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return (folderId) => {
    const path: string[] = [];
    const seen = new Set<string>();
    for (let id = folderId; id && byId.has(id) && !seen.has(id); id = byId.get(id)!.parentId ?? undefined) {
      seen.add(id);
      path.unshift(byId.get(id)!.name);
    }
    return path;
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Markdown 头部 YAML */
export function frontmatterFor(item: KnowledgeItem, tagNames: string[]): string {
  const lines = [`type: ${item.type}`];
  if (tagNames.length > 0) lines.push('tags:', ...tagNames.map((name) => `  - ${yamlString(name)}`));
  lines.push(`created: ${item.createdAt.toISOString()}`, `updated: ${item.updatedAt.toISOString()}`);
  if (item.sourceUrl) lines.push(`source: ${yamlString(item.sourceUrl)}`);
  if (item.summary) lines.push(`summary: ${yamlString(item.summary)}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

/** 非笔记条目的 Markdown 正文：正文 / 要点 / 转写 */
function companionBody(item: KnowledgeItem, attachmentName: string | null): string {
  const parts: string[] = [];
  if (attachmentName) parts.push(item.type === 'image' ? `![[${attachmentName}]]` : `[[${attachmentName}]]`);
  if (item.content) parts.push(item.content);
  if (item.keyPoints?.length) parts.push(`## 要点\n\n${item.keyPoints.map((point) => `- ${point}`).join('\n')}`);
  if (item.transcript) parts.push(`## 转写\n\n${item.transcript}`);
  return parts.join('\n\n');
}

/** 每个目录内文件名去重（大小写不敏感，兼容不区分大小写的文件系统） */
class DirectoryNames {
  private readonly registries = new Map<string, TitleRegistry>();

  claim(directory: string[], name: string): string {
    const key = directory.join('/');
    let registry = this.registries.get(key);
    if (!registry) {
      registry = new TitleRegistry();
      this.registries.set(key, registry);
    }
    return registry.claim(name);
  }
}

function joinPath(directory: string[], name: string): string {
  return [...directory.map(safeName), name].join('/');
}

/** 附件的导出文件名：标题已带扩展名时用标题，否则补上原文件的扩展名 */
function attachmentFileName(item: KnowledgeItem): string {
  const extension = fileExtension(item.filePath ?? '');
  const title = safeName(item.title);
  return extension && fileExtension(title) !== extension ? `${title}.${extension}` : title;
}

/**
 * 写出导出内容。exportId 为主进程登记的导出目录
 */
export async function writeExport(
  exportId: string,
  path: string,
  format: ExportFormat,
  input: ExportInput,
  onProgress: (progress: ExportProgress) => void
): Promise<ExportResult> {
  const transfer = window.electron.transfer;
  const tagName = new Map(input.tags.map((tag) => [tag.id, tag.name]));
  const folderPathOf = folderPathResolver(input.folders);
  const result: ExportResult = { path, items: 0, files: 0, failed: [] };
  const total = input.items.length;
  onProgress({ done: 0, total });

  if (format === 'json') {
    const attachmentPaths = new Map<string, { path: string; fileName: string }>();
    const names = new DirectoryNames();
    for (const [index, item] of input.items.entries()) {
      if (item.filePath) {
        const fileName = attachmentFileName(item);
        const relative = `attachments/${names.claim(['attachments'], fileName)}`;
        try {
          await transfer.copyExportFile(exportId, relative, item.filePath);
          attachmentPaths.set(item.id, { path: relative, fileName });
          result.files += 1;
        } catch (error) {
          result.failed.push({ title: item.title, error: error instanceof Error ? error.message : String(error) });
        }
      }
      onProgress({ done: index + 1, total });
    }
    const data = buildKnowledgeExport({
      workspace: input.workspace,
      items: input.items,
      tags: input.tags,
      folderPathOf,
      folderPaths: input.folders.map((folder) => folderPathOf(folder.id)),
      attachmentOf: (item) => attachmentPaths.get(item.id),
    });
    await transfer.writeExportFile(exportId, KNOWLEDGE_EXPORT_FILE, JSON.stringify(data, null, 2));
    result.items = input.items.length;
    return result;
  }

  const names = new DirectoryNames();
  for (const [index, item] of input.items.entries()) {
    const directory = folderPathOf(item.folderId);
    const tags = item.tagIds.flatMap((id) => tagName.get(id) ?? []);
    try {
      if (item.type === 'note') {
        // 笔记保留原扩展名（.md / .tex / .txt）；只有 Markdown 写入头部 YAML
        const extension = textExtension(item.title) || '.md';
        const name = names.claim(directory, safeName(displayTitle(item.title)) + extension);
        const header = extension === '.md' || extension === '.markdown' ? frontmatterFor(item, tags) : '';
        await transfer.writeExportFile(exportId, joinPath(directory, name), header + (item.content ?? ''));
        result.files += 1;
      } else {
        let attachmentName: string | null = null;
        if (item.filePath) {
          attachmentName = names.claim(directory, attachmentFileName(item));
          await transfer.copyExportFile(exportId, joinPath(directory, attachmentName), item.filePath);
          result.files += 1;
        }
        const body = companionBody(item, attachmentName);
        const hasText = !!(item.content || item.summary || item.keyPoints?.length || item.transcript);
        // 只有附件、没有任何文字、标签与来源的条目不写说明文件
        if (!attachmentName || hasText || tags.length > 0 || item.sourceUrl) {
          const name = names.claim(directory, `${safeName(displayTitle(item.title))}.md`);
          await transfer.writeExportFile(exportId, joinPath(directory, name), frontmatterFor(item, tags) + body);
          result.files += 1;
        }
      }
      result.items += 1;
    } catch (error) {
      result.failed.push({ title: item.title, error: error instanceof Error ? error.message : String(error) });
    }
    onProgress({ done: index + 1, total });
  }
  return result;
}
