// ================================
// 执行导入：把 ImportPlan 写入当前知识库
// - 所有条目放在新建的顶层文件夹「导入 · 来源名」下，按来源的目录结构建子文件夹
// - 与知识库中已有条目重名时标题追加序号，并同步改写导入笔记中对它的 [[链接]] 与 ![[嵌入]]
// - 附件复制（或由 base64 写入）到当前知识库的附件目录；标签按层级规范化写入
// - 单个条目失败不影响其余条目，失败原因计入结果；导入的条目不自动提交 AI 处理
// ================================

import type { ImportSource } from '../../types/electron';
import { knowledgeRepository } from '../knowledge/repository';
import { folderService } from '../folders/service';
import { normalizeLinkTarget, textExtension } from '../links/link-index';
import { TitleRegistry } from './common';
import { rewriteLinks } from './link-rewrite';
import type { ImportEntry, ImportPlan } from './types';
import { parseEnexFiles } from './enex';
import { KNOWLEDGE_EXPORT_FILE, parseKnowledgeExport } from './json-format';
import { parseNotionExport } from './notion';
import { parseObsidianVault } from './obsidian';

export const IMPORT_SOURCE_LABELS: Record<ImportSource['kind'], string> = {
  obsidian: 'Obsidian',
  notion: 'Notion',
  evernote: '印象笔记',
  json: '本应用 JSON',
};

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportResult {
  folderName: string;
  created: number;
  /** 其中附件数 */
  attachments: number;
  /** 因与已有条目重名而改名的条目数 */
  renamed: number;
  failed: Array<{ key: string; error: string }>;
  warnings: string[];
}

/** 按来源类型解析 */
export function parseImportSource(source: ImportSource): ImportPlan {
  switch (source.kind) {
    case 'obsidian':
      return parseObsidianVault(source.files);
    case 'notion':
      return parseNotionExport(source.files);
    case 'evernote':
      return parseEnexFiles(source.files);
    case 'json': {
      const file = source.files.find((entry) => entry.path.endsWith('.json'));
      if (!file?.text) throw new Error(`没有找到 ${KNOWLEDGE_EXPORT_FILE}`);
      return parseKnowledgeExport(file.text);
    }
  }
}

/**
 * 与已有条目重名的标题改名，并改写导入笔记中对改名条目的引用
 */
export function resolveTitleConflicts(entries: ImportEntry[], existingTitles: Iterable<string>): {
  entries: ImportEntry[];
  renamed: number;
} {
  const registry = new TitleRegistry(existingTitles);
  const renames = new Map<string, { title: string; isNote: boolean }>();
  const titled = entries.map((entry) => {
    const title = registry.claim(entry.title);
    if (title === entry.title) return entry;
    renames.set(normalizeLinkTarget(entry.title), { title, isNote: !!textExtension(title) });
    return { ...entry, title };
  });
  if (renames.size === 0) return { entries: titled, renamed: 0 };
  const resolvers = { wiki: (target: string) => renames.get(normalizeLinkTarget(target)) ?? null, path: () => null };
  return {
    entries: titled.map((entry) =>
      entry.type === 'note' && entry.content ? { ...entry, content: rewriteLinks(entry.content, resolvers) } : entry
    ),
    renamed: renames.size,
  };
}

/** 文件夹按路径创建（同名时复用），返回末级文件夹 ID */
class FolderBuilder {
  private readonly ids = new Map<string, string>();

  constructor(private readonly rootId: string) {}

  async ensure(path: string[]): Promise<string> {
    let parentId = this.rootId;
    for (let depth = 1; depth <= path.length; depth += 1) {
      const key = path.slice(0, depth).join('/');
      let id = this.ids.get(key);
      if (!id) {
        id = (await folderService.createFolder({ name: path[depth - 1], parentId })).id;
        this.ids.set(key, id);
      }
      parentId = id;
    }
    return parentId;
  }
}

/** 在顶层新建不重名的导入文件夹 */
async function createRootFolder(base: string): Promise<{ id: string; name: string }> {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base} (${n})`;
    try {
      const folder = await folderService.createFolder({ name, parentId: null });
      return { id: folder.id, name };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('同名')) throw error;
    }
  }
}

async function saveFile(sourceId: string, entry: ImportEntry): Promise<{ filePath: string; size: number } | undefined> {
  const file = entry.file;
  if (!file) return undefined;
  return file.source.kind === 'file'
    ? window.electron.transfer.copyAttachment(sourceId, file.source.path)
    : window.electron.transfer.writeAttachment(file.fileName, file.source.data);
}

/**
 * 写入知识库。调用方负责之后结束导入（清理临时文件）与刷新界面
 */
export async function runImport(
  source: ImportSource,
  plan: ImportPlan,
  onProgress: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const existing = await knowledgeRepository.listAll();
  const { entries, renamed } = resolveTitleConflicts(
    plan.entries,
    existing.map((item) => item.title)
  );
  const root = await createRootFolder(`导入 · ${IMPORT_SOURCE_LABELS[source.kind]} · ${source.name}`);
  const folders = new FolderBuilder(root.id);
  for (const path of plan.folders ?? []) await folders.ensure(path);

  const result: ImportResult = {
    folderName: root.name,
    created: 0,
    attachments: 0,
    renamed,
    failed: [],
    warnings: [...plan.warnings],
  };
  const total = entries.length;
  onProgress({ done: 0, total });

  for (const [index, entry] of entries.entries()) {
    try {
      const saved = await saveFile(source.id, entry);
      const item = await knowledgeRepository.create({
        title: entry.title,
        type: entry.type,
        content: entry.content,
        summary: entry.summary,
        keyPoints: entry.keyPoints,
        transcript: entry.transcript,
        sourceUrl: entry.sourceUrl,
        folderId: await folders.ensure(entry.folderPath),
        filePath: saved?.filePath,
        fileSize: saved?.size,
        mimeType: entry.file?.mimeType,
        metadata: entry.metadata,
        isFavorite: entry.isFavorite,
        isPinned: entry.isPinned,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt ?? entry.createdAt,
      });
      if (entry.tags.length > 0) await knowledgeRepository.setItemTags(item.id, entry.tags);
      result.created += 1;
      if (saved) result.attachments += 1;
    } catch (error) {
      result.failed.push({ key: entry.key, error: error instanceof Error ? error.message : String(error) });
    }
    onProgress({ done: index + 1, total });
  }

  // 只为还没有颜色的标签还原颜色
  const colors = plan.tagColors ?? {};
  if (Object.keys(colors).length > 0) {
    for (const tag of await knowledgeRepository.listTags()) {
      const color = colors[tag.name];
      if (color && !tag.color) await knowledgeRepository.setTagColor(tag.id, color);
    }
  }
  return result;
}
