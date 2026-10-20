// ================================
// 本应用的 JSON 全量导出格式：knowledge-export.json + attachments/ 目录
// 包含条目（正文、摘要、要点、转写、来源、标签、文件夹路径、时间、收藏 / 置顶、元数据）、标签颜色与文件夹结构，
// 可在另一台设备或另一个知识库中用“导入 → 本应用 JSON”还原
// ================================

import type { KnowledgeItem, KnowledgeItemType, Tag } from '../../types/knowledge';
import { attachmentItemType, TitleRegistry } from './common';
import type { ImportEntry, ImportPlan } from './types';

export const KNOWLEDGE_EXPORT_FILE = 'knowledge-export.json';
const FORMAT = 1;

const ITEM_TYPES: readonly KnowledgeItemType[] = [
  'note',
  'audio',
  'image',
  'video',
  'document',
  'webpage',
  'code',
  'bookmark',
  'file',
];

export interface ExportedItem {
  id: string;
  type: KnowledgeItemType;
  title: string;
  content?: string;
  summary?: string;
  keyPoints?: string[];
  transcript?: string;
  sourceUrl?: string;
  tags: string[];
  folderPath: string[];
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
  isPinned: boolean;
  metadata?: Record<string, unknown>;
  /** 附件在导出目录中的相对路径 */
  file?: { path: string; fileName: string; mimeType: string };
}

export interface KnowledgeExport {
  app: 'code-reader';
  format: number;
  exportedAt: string;
  workspace: string;
  tags: Array<{ name: string; color?: string }>;
  /** 全部文件夹路径（含空文件夹） */
  folders: string[][];
  items: ExportedItem[];
}

export function buildKnowledgeExport(input: {
  workspace: string;
  items: KnowledgeItem[];
  tags: Tag[];
  folderPathOf: (folderId: string | undefined) => string[];
  folderPaths: string[][];
  /** 条目附件在导出目录中的位置；没有附件时为 undefined */
  attachmentOf: (item: KnowledgeItem) => { path: string; fileName: string } | undefined;
}): KnowledgeExport {
  const tagName = new Map(input.tags.map((tag) => [tag.id, tag.name]));
  return {
    app: 'code-reader',
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    workspace: input.workspace,
    tags: input.tags.map((tag) => ({ name: tag.name, ...(tag.color ? { color: tag.color } : {}) })),
    folders: input.folderPaths,
    items: input.items.map((item) => {
      const attachment = input.attachmentOf(item);
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        ...(item.content ? { content: item.content } : {}),
        ...(item.summary ? { summary: item.summary } : {}),
        ...(item.keyPoints?.length ? { keyPoints: item.keyPoints } : {}),
        ...(item.transcript ? { transcript: item.transcript } : {}),
        ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
        tags: item.tagIds.flatMap((id) => tagName.get(id) ?? []),
        folderPath: input.folderPathOf(item.folderId),
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        isFavorite: item.isFavorite,
        isPinned: item.isPinned,
        ...(item.metadata ? { metadata: item.metadata } : {}),
        ...(attachment
          ? { file: { ...attachment, mimeType: item.mimeType ?? 'application/octet-stream' } }
          : {}),
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** 解析 JSON 导出为导入计划；格式不符时抛出错误 */
export function parseKnowledgeExport(text: string): ImportPlan {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!isRecord(data) || data.app !== 'code-reader' || !Array.isArray(data.items)) {
    throw new Error('不是本应用导出的 JSON（缺少 app / items 字段）');
  }
  if (typeof data.format !== 'number' || data.format > FORMAT) {
    throw new Error('导出文件来自更新版本的应用，请先升级');
  }

  const titles = new TitleRegistry();
  const warnings: string[] = [];
  const entries: ImportEntry[] = [];
  data.items.forEach((raw, index) => {
    if (!isRecord(raw) || typeof raw.title !== 'string' || !ITEM_TYPES.includes(raw.type as KnowledgeItemType)) {
      warnings.push(`第 ${index + 1} 个条目格式无效，已跳过`);
      return;
    }
    const file = isRecord(raw.file) && typeof raw.file.path === 'string' ? raw.file : undefined;
    const mimeType = optionalString(file?.mimeType) ?? 'application/octet-stream';
    entries.push({
      key: optionalString(raw.id) ?? `#${index + 1}`,
      type: file && raw.type === 'file' ? attachmentItemType(mimeType) : (raw.type as KnowledgeItemType),
      title: titles.claim(raw.title),
      content: optionalString(raw.content),
      summary: optionalString(raw.summary),
      transcript: optionalString(raw.transcript),
      sourceUrl: optionalString(raw.sourceUrl),
      tags: stringList(raw.tags),
      folderPath: stringList(raw.folderPath),
      createdAt: optionalString(raw.createdAt),
      updatedAt: optionalString(raw.updatedAt),
      isFavorite: raw.isFavorite === true,
      isPinned: raw.isPinned === true,
      ...(Array.isArray(raw.keyPoints) ? { keyPoints: stringList(raw.keyPoints) } : {}),
      ...(isRecord(raw.metadata) ? { metadata: raw.metadata } : {}),
      ...(file
        ? {
            file: {
              source: { kind: 'file' as const, path: file.path as string },
              fileName: optionalString(file.fileName) ?? (file.path as string).split('/').pop()!,
              mimeType,
            },
          }
        : {}),
    });
  });

  const tagColors: Record<string, string> = {};
  for (const tag of Array.isArray(data.tags) ? data.tags : []) {
    if (isRecord(tag) && typeof tag.name === 'string' && typeof tag.color === 'string') tagColors[tag.name] = tag.color;
  }
  const folders = Array.isArray(data.folders) ? data.folders.map(stringList).filter((path) => path.length > 0) : [];
  return { entries, warnings, tagColors, folders };
}
