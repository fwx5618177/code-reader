// ================================
// 同步的本地读写：把数据库中的条目 / 文件夹 / 标签规范化为同步数据，以及把远端数据写回数据库
// 写回后再读出的数据必须与远端数据哈希一致，否则下一次导出会把它当成本地修改再发出去
// ================================

import { createHash } from 'crypto';
import { createReadStream, statSync } from 'fs';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { ancestorTagPaths, normalizeTagPath } from '../../shared/tag-path';
import type { FolderData, ItemData, ItemFile, TagData } from './records';

/** 同步用到的数据库操作（SQLiteService 的子集） */
export interface SyncDb {
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): { changes: number };
  transaction<T>(fn: () => T): T;
}

interface ItemRow {
  id: string;
  title: string;
  type: string;
  content: string | null;
  summary: string | null;
  key_points: string | null;
  transcript: string | null;
  source_url: string | null;
  mime_type: string | null;
  file_path: string | null;
  folder_id: string | null;
  is_favorite: number;
  is_pinned: number;
  is_deleted: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
  tag_names: string | null;
}

/** 标签名列表在 SQL 中的分隔符（标签名不会包含换行） */
const TAG_SEPARATOR = '\n';

function parseMetadata(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** 文件扩展名（小写、不含点） */
export function fileExt(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

// ================================
// 附件哈希（按路径、大小、修改时间缓存）
// ================================

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** 附件的同步描述；文件不存在时为 null */
export async function describeFile(db: SyncDb, path: string): Promise<ItemFile | null> {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return null;
  }
  const cached = db.get<{ hash: string; size: number; mtime_ms: number }>(
    'SELECT hash, size, mtime_ms FROM sync_file_hashes WHERE path = ?',
    [path]
  );
  const mtime = Math.floor(stats.mtimeMs);
  if (cached && cached.size === stats.size && cached.mtime_ms === mtime) {
    return { hash: cached.hash, size: stats.size, ext: fileExt(path) };
  }
  const hash = await sha256File(path);
  rememberFile(db, path, hash);
  return { hash, size: stats.size, ext: fileExt(path) };
}

/** 记录附件哈希（写入或复制附件后调用） */
export function rememberFile(db: SyncDb, path: string, hash: string): void {
  const stats = statSync(path);
  db.run(
    `INSERT INTO sync_file_hashes (path, size, mtime_ms, hash) VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, hash = excluded.hash`,
    [path, stats.size, Math.floor(stats.mtimeMs), hash]
  );
}

/** 本机已有的、内容为 hash 的附件路径 */
export function localFileWithHash(db: SyncDb, hash: string): string | null {
  const rows = db.all<{ path: string; size: number; mtime_ms: number }>(
    'SELECT path, size, mtime_ms FROM sync_file_hashes WHERE hash = ?',
    [hash]
  );
  for (const row of rows) {
    try {
      const stats = statSync(row.path);
      if (stats.size === row.size && Math.floor(stats.mtimeMs) === row.mtime_ms) return row.path;
    } catch {
      // 文件已不存在，继续找下一个
    }
  }
  return null;
}

// ================================
// 读取本地数据
// ================================

/** 全部条目（含已删除的，删除状态同样需要同步） */
export async function readItems(db: SyncDb): Promise<Map<string, ItemData>> {
  const rows = db.all<ItemRow>(
    `SELECT k.id, k.title, k.type, k.content, k.summary, k.key_points, k.transcript, k.source_url, k.mime_type,
            k.file_path, k.folder_id, k.is_favorite, k.is_pinned, k.is_deleted, k.deleted_at, k.created_at,
            k.updated_at, k.metadata,
            (SELECT GROUP_CONCAT(t.name, char(10)) FROM item_tags it JOIN tags t ON t.id = it.tag_id
             WHERE it.item_id = k.id) AS tag_names
     FROM knowledge_items k`
  );
  const items = new Map<string, ItemData>();
  for (const row of rows) {
    items.set(row.id, {
      title: row.title,
      type: row.type,
      content: row.content,
      summary: row.summary,
      keyPoints: row.key_points,
      transcript: row.transcript,
      sourceUrl: row.source_url,
      mimeType: row.mime_type,
      file: row.file_path ? await describeFile(db, row.file_path) : null,
      folderId: row.folder_id,
      isFavorite: row.is_favorite === 1,
      isPinned: row.is_pinned === 1,
      isDeleted: row.is_deleted === 1,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: parseMetadata(row.metadata),
      tags: row.tag_names ? [...new Set(row.tag_names.split(TAG_SEPARATOR))].sort() : [],
    });
  }
  return items;
}

/** 手动文件夹（智能文件夹是代码中的预设，不需要同步） */
export function readFolders(db: SyncDb): Map<string, FolderData> {
  const rows = db.all<{ id: string; name: string; parent_id: string | null; sort_order: number; is_deleted: number }>(
    `SELECT id, name, parent_id, sort_order, is_deleted FROM folders WHERE type = 'manual'`
  );
  return new Map(
    rows.map((row) => [
      row.id,
      { name: row.name, parentId: row.parent_id, sortOrder: row.sort_order, isDeleted: row.is_deleted === 1 },
    ])
  );
}

/** 有颜色的标签（没有颜色的标签只随条目同步） */
export function readTags(db: SyncDb): Map<string, TagData> {
  const rows = db.all<{ name: string; color: string | null }>(
    `SELECT name, color FROM tags WHERE is_deleted = 0 AND color IS NOT NULL`
  );
  return new Map(rows.map((row) => [row.name, { color: row.color }]));
}

// ================================
// 写回远端数据（在事务中调用）
// ================================

/** 确保标签（及其父标签）存在，返回各标签 ID */
function ensureTags(db: SyncDb, names: string[], now: string): Map<string, string> {
  const ids = new Map<string, string>();
  const all = [...new Set(names.flatMap((name) => [...ancestorTagPaths(name), name]))];
  for (const name of all) {
    db.run(
      `INSERT OR IGNORE INTO tags (id, name, usage_count, is_auto_generated, created_at, updated_at)
       VALUES (?, ?, 0, 0, ?, ?)`,
      [randomUUID(), name, now, now]
    );
  }
  for (const name of names) {
    const row = db.get<{ id: string }>('SELECT id FROM tags WHERE name = ?', [name]);
    if (row) ids.set(name, row.id);
  }
  return ids;
}

/** 重算标签使用次数 */
function recountTags(db: SyncDb, tagIds: Iterable<string>): void {
  for (const id of new Set(tagIds)) {
    db.run('UPDATE tags SET usage_count = (SELECT COUNT(*) FROM item_tags WHERE tag_id = ?) WHERE id = ?', [id, id]);
  }
}

/**
 * 写入条目（新增或覆盖）；data 为 null 时物理删除
 * @param filePath 附件在本机的路径（由调用方事先准备好）
 */
export function applyItem(db: SyncDb, id: string, data: ItemData | null, filePath: string | null): void {
  const previousTags = db.all<{ tag_id: string }>('SELECT tag_id FROM item_tags WHERE item_id = ?', [id]).map((row) => row.tag_id);
  if (!data) {
    db.run('DELETE FROM knowledge_items WHERE id = ?', [id]);
    recountTags(db, previousTags);
    return;
  }
  // 文件夹已不存在（尚未同步到或已被物理删除）时不归档，避免外键错误
  const folderId =
    data.folderId && db.get('SELECT 1 FROM folders WHERE id = ?', [data.folderId]) ? data.folderId : null;
  const metadata = data.metadata === null ? null : typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata);
  const values = [
    data.title,
    data.type,
    data.content,
    data.summary,
    data.keyPoints,
    data.transcript,
    data.sourceUrl,
    data.mimeType,
    filePath,
    data.file?.size ?? null,
    folderId,
    data.isFavorite ? 1 : 0,
    data.isPinned ? 1 : 0,
    data.isDeleted ? 1 : 0,
    data.deletedAt,
    data.createdAt,
    data.updatedAt,
    metadata,
  ];
  const exists = db.get('SELECT 1 FROM knowledge_items WHERE id = ?', [id]);
  if (exists) {
    db.run(
      `UPDATE knowledge_items SET title = ?, type = ?, content = ?, summary = ?, key_points = ?, transcript = ?,
         source_url = ?, mime_type = ?, file_path = ?, file_size = ?, folder_id = ?, is_favorite = ?, is_pinned = ?,
         is_deleted = ?, deleted_at = ?, created_at = ?, updated_at = ?, metadata = ?
       WHERE id = ?`,
      [...values, id]
    );
  } else {
    db.run(
      `INSERT INTO knowledge_items
         (title, type, content, summary, key_points, transcript, source_url, mime_type, file_path, file_size,
          folder_id, is_favorite, is_pinned, is_deleted, deleted_at, created_at, updated_at, metadata, id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
      [...values, id]
    );
  }

  const now = new Date().toISOString();
  const tagIds = ensureTags(db, data.tags.map(normalizeTagPath).filter(Boolean), now);
  db.run('DELETE FROM item_tags WHERE item_id = ?', [id]);
  for (const tagId of tagIds.values()) {
    db.run('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)', [id, tagId]);
  }
  recountTags(db, [...previousTags, ...tagIds.values()]);
}

/** 写入文件夹；父文件夹不存在时放在顶层 */
export function applyFolder(db: SyncDb, id: string, data: FolderData | null): void {
  if (!data) {
    db.run(`UPDATE folders SET is_deleted = 1, deleted_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
    return;
  }
  const parentId = data.parentId && db.get('SELECT 1 FROM folders WHERE id = ?', [data.parentId]) ? data.parentId : null;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO folders (id, name, type, parent_id, sort_order, is_deleted, created_at, updated_at)
     VALUES (?, ?, 'manual', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id,
       sort_order = excluded.sort_order, is_deleted = excluded.is_deleted, updated_at = excluded.updated_at`,
    [id, data.name, parentId, data.sortOrder, data.isDeleted ? 1 : 0, now, now]
  );
}

/** 写入标签颜色；墓碑只删除已无条目使用的标签 */
export function applyTag(db: SyncDb, name: string, data: TagData | null): void {
  const now = new Date().toISOString();
  if (!data) {
    db.run(
      `UPDATE tags SET color = NULL, updated_at = ? WHERE name = ?`,
      [now, name]
    );
    db.run(`DELETE FROM tags WHERE name = ? AND NOT EXISTS (SELECT 1 FROM item_tags WHERE tag_id = tags.id)`, [name]);
    return;
  }
  ensureTags(db, [name], now);
  db.run('UPDATE tags SET color = ?, updated_at = ? WHERE name = ?', [data.color, now, name]);
}
