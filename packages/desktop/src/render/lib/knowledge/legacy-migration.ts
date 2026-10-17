// ================================
// 旧版知识库数据迁移
// 早期版本把知识条目、标签、文件夹保存在 knowledge-db.json，与 SQLite 中的
// 写作文档和 Agent 任务互不相通。启动时一次性导入 SQLite，并把旧文件改名保留。
// ================================

import { databaseService, now } from '../../services/database';
import { settingsService } from '../../services/settingsService';
import type { Folder, KnowledgeItem, Tag } from '../../types/knowledge';
import { knowledgeRepository } from './repository';

const LEGACY_FILENAME = 'knowledge-db.json';
const MIGRATED_FILENAME = 'knowledge-db.legacy.json';

interface LegacyDatabase {
  items?: Record<string, KnowledgeItem>;
  tags?: Record<string, Tag>;
  folders?: Record<string, Folder>;
}

/** JSON 中的日期是字符串 */
function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? now() : date.toISOString();
}

/**
 * 导入旧版 JSON 数据
 * @returns 导入的条目数量（没有旧数据时为 0）
 */
export async function migrateLegacyKnowledgeStore(): Promise<number> {
  const dataPath = await settingsService.getDataPath();
  const legacyPath = `${dataPath}/${LEGACY_FILENAME}`;
  const exists = (await window.electron.ipcRenderer.invoke('path-exists', legacyPath)) as boolean;
  if (!exists) return 0;

  const raw = (await window.electron.ipcRenderer.invoke('read-file', legacyPath)) as string;
  const legacy = JSON.parse(raw) as LegacyDatabase;

  // 文件夹：保留原 ID，便于条目继续归属
  const migratedFolders = new Set<string>();
  for (const folder of Object.values(legacy.folders ?? {})) {
    if (folder.isDeleted) continue;
    await databaseService.run(
      `INSERT OR IGNORE INTO folders
       (id, name, type, icon, color, parent_id, sort_order, filter_rules, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0)`,
      [
        folder.id,
        folder.name,
        folder.type === 'smart' ? 'smart' : 'manual',
        folder.icon ?? null,
        folder.color ?? null,
        folder.sortOrder ?? 0,
        folder.filterRules ? JSON.stringify(folder.filterRules) : null,
        toIso(folder.createdAt),
        toIso(folder.updatedAt),
      ]
    );
    migratedFolders.add(folder.id);
  }

  const tagNames = new Map(Object.values(legacy.tags ?? {}).map((tag) => [tag.id, tag.name]));

  let imported = 0;
  for (const item of Object.values(legacy.items ?? {})) {
    if (item.isDeleted || (await knowledgeRepository.getById(item.id))) continue;
    await knowledgeRepository.create({
      id: item.id,
      title: item.title,
      type: item.type,
      content: item.content,
      filePath: item.filePath,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      sourceUrl: item.sourceUrl,
      folderId: item.folderId && migratedFolders.has(item.folderId) ? item.folderId : undefined,
      metadata: item.metadata,
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt),
    });
    if (item.summary || item.keyPoints || item.transcript) {
      await databaseService.run(
        `UPDATE knowledge_items SET summary = ?, key_points = ?, transcript = ?, status = 'ready' WHERE id = ?`,
        [
          item.summary ?? null,
          item.keyPoints ? JSON.stringify(item.keyPoints) : null,
          item.transcript ?? null,
          item.id,
        ]
      );
    }
    const names = (item.tagIds ?? [])
      .map((id) => tagNames.get(id))
      .filter((name): name is string => !!name);
    if (names.length > 0) await knowledgeRepository.setItemTags(item.id, names);
    imported++;
  }

  await window.electron.ipcRenderer.invoke('rename-path', legacyPath, `${dataPath}/${MIGRATED_FILENAME}`);
  console.info(`[Knowledge] 已从旧版 JSON 导入 ${imported} 个条目`);
  return imported;
}
