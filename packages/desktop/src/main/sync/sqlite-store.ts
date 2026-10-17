// ================================
// LocalStore 的 SQLite 实现（主进程，当前知识库）
// ================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
  applyFolder,
  applyItem,
  applyTag,
  localFileWithHash,
  readFolders,
  readItems,
  readTags,
  rememberFile,
  type SyncDb,
} from './local-store';
import type { LocalStore, Snapshot } from './sync-engine';
import type { EntityData, FolderData, ItemData, ItemFile, LocalVersion, SyncEntity, TagData } from './records';

/** 附件文件名中不允许的字符 */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'file';
}

export class SqliteSyncStore implements LocalStore {
  constructor(
    private readonly db: SyncDb,
    private readonly attachmentsPath: string
  ) {}

  async snapshot(): Promise<Snapshot> {
    return { item: await readItems(this.db), folder: readFolders(this.db), tag: readTags(this.db) };
  }

  versions(): Map<string, LocalVersion> {
    const rows = this.db.all<{ entity: string; id: string; hash: string; clock: number; device_id: string }>(
      'SELECT entity, id, hash, clock, device_id FROM sync_records'
    );
    return new Map(rows.map((row) => [`${row.entity}:${row.id}`, { hash: row.hash, clock: row.clock, deviceId: row.device_id }]));
  }

  setVersion(entity: SyncEntity, id: string, version: LocalVersion): void {
    this.db.run(
      `INSERT INTO sync_records (entity, id, hash, clock, device_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(entity, id) DO UPDATE SET hash = excluded.hash, clock = excluded.clock, device_id = excluded.device_id`,
      [entity, id, version.hash, version.clock, version.deviceId]
    );
  }

  cursor(deviceId: string): number {
    return this.db.get<{ last_seq: number }>('SELECT last_seq FROM sync_cursors WHERE device_id = ?', [deviceId])?.last_seq ?? 0;
  }

  setCursor(deviceId: string, seq: number): void {
    this.db.run(
      `INSERT INTO sync_cursors (device_id, last_seq) VALUES (?, ?)
       ON CONFLICT(device_id) DO UPDATE SET last_seq = excluded.last_seq`,
      [deviceId, seq]
    );
  }

  async readItemFile(itemId: string): Promise<Buffer | null> {
    const row = this.db.get<{ file_path: string | null }>('SELECT file_path FROM knowledge_items WHERE id = ?', [itemId]);
    if (!row?.file_path) return null;
    try {
      return await readFile(row.file_path);
    } catch {
      return null;
    }
  }

  fileForBlob(file: ItemFile): string | null {
    return localFileWithHash(this.db, file.hash);
  }

  async storeBlob(file: ItemFile, data: Buffer, title: string): Promise<string> {
    await mkdir(this.attachmentsPath, { recursive: true });
    const stem = safeName(title.replace(/\.[^.]+$/, ''));
    const path = join(this.attachmentsPath, `${file.hash.slice(0, 12)}-${stem}${file.ext ? `.${file.ext}` : ''}`);
    await writeFile(path, data);
    rememberFile(this.db, path, file.hash);
    return path;
  }

  apply<E extends SyncEntity>(entity: E, id: string, data: EntityData[E] | null, filePath: string | null): void {
    if (entity === 'item') applyItem(this.db, id, data as ItemData | null, filePath);
    else if (entity === 'folder') applyFolder(this.db, id, data as FolderData | null);
    else applyTag(this.db, id, data as TagData | null);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }
}
