// ================================
// 备份与恢复（当前知识库）
// - 数据库备份：SQLite 在线备份到 <知识库根>/backups/*.db，可列出、恢复、删除；也可从外部 .db 文件恢复
// - 完整备份：选择文件夹，写入 knowledge.db + attachments/ + ocr-results/ + manifest.json，
//   恢复时把附件复制回当前知识库，并把数据库中附件的绝对路径改写为当前知识库的附件目录（可跨设备恢复）
// 恢复前先校验备份（必须是本应用的数据库，schema 版本不高于当前版本），当前数据库另存为 before-restore-*.db
// ================================

import Database from 'better-sqlite3';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import { getSQLiteService, SCHEMA_VERSION } from '../database/sqlite';
import { getWorkspaceManager } from '../workspace/workspace-manager';
import { flushWindows } from '../flush/window-flush';
import { getOrganizeScheduler } from '../agent/organize-schedule';
import { getSyncService } from '../sync/sync-service';

/** 完整备份的清单文件 */
const MANIFEST_FILE = 'manifest.json';
const BACKUP_DB_FILE = 'knowledge.db';
const OCR_RESULTS_DIR = 'ocr-results';

export interface BackupFileInfo {
  fileName: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface BackupCheck {
  schemaVersion: number;
  itemCount: number;
}

interface FullBackupManifest {
  app: 'code-reader';
  format: 1;
  workspaceName: string;
  createdAt: string;
  schemaVersion: number;
  /** 备份时附件目录的绝对路径（恢复时据此改写数据库中的附件路径） */
  attachmentsPath: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * 校验备份数据库：能以只读方式打开，包含条目表与 schema_version，且版本不高于当前应用支持的版本
 */
export function checkBackupDatabase(path: string): BackupCheck {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const tables = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
        (row) => row.name
      )
    );
    if (!tables.has('knowledge_items') || !tables.has('schema_version')) {
      throw new Error('不是本应用的知识库数据库');
    }
    const version = (db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number | null })
      .version;
    if (!version) throw new Error('备份缺少版本信息');
    if (version > SCHEMA_VERSION) {
      throw new Error(`备份来自更新版本的应用（数据库版本 ${version}，当前支持 ${SCHEMA_VERSION}），请先升级应用`);
    }
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM knowledge_items WHERE is_deleted = 0').get() as {
      count: number;
    };
    return { schemaVersion: version, itemCount: count };
  } catch (error) {
    if (error instanceof Error && /file is not a database|SQLITE_NOTADB/i.test(error.message)) {
      throw new Error('文件不是有效的数据库');
    }
    throw error;
  } finally {
    db?.close();
  }
}

/**
 * 备份时的附件路径改写到当前附件目录下；不在 fromRoot 之下时为 null。
 * 备份可能来自另一种系统，分隔符以备份时的路径为准
 */
export function rebaseAttachmentPath(path: string, fromRoot: string, toRoot: string, toSep: string = sep): string | null {
  const fromSep = fromRoot.includes('\\') && !fromRoot.includes('/') ? '\\' : '/';
  const prefix = fromRoot.endsWith(fromSep) ? fromRoot : fromRoot + fromSep;
  if (!path.startsWith(prefix)) return null;
  const target = toRoot.endsWith(toSep) ? toRoot : toRoot + toSep;
  return target + path.slice(prefix.length).split(fromSep).join(toSep);
}

/** 把数据库中位于 fromRoot 下的附件路径改写到 toRoot 下（在临时副本上执行），返回改写的条目数 */
export function rebaseAttachmentPaths(dbPath: string, fromRoot: string, toRoot: string): number {
  if (resolve(fromRoot) === resolve(toRoot)) return 0;
  const db = new Database(dbPath);
  try {
    const rows = db
      .prepare(`SELECT id, file_path FROM knowledge_items WHERE file_path IS NOT NULL`)
      .all() as Array<{ id: string; file_path: string }>;
    const update = db.prepare('UPDATE knowledge_items SET file_path = ? WHERE id = ?');
    let changed = 0;
    db.transaction(() => {
      for (const row of rows) {
        const rebased = rebaseAttachmentPath(row.file_path, fromRoot, toRoot);
        if (rebased === null) continue;
        update.run(rebased, row.id);
        changed += 1;
      }
    })();
    return changed;
  } finally {
    db.close();
  }
}

function backupsDir(): string {
  const dir = getWorkspaceManager().getCurrent().backupsPath;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** backups 目录中的文件；拒绝路径分隔符，防止越出目录 */
function backupFilePath(fileName: string): string {
  if (!/^[\w.-]+\.db$/.test(fileName)) throw new Error('无效的备份文件名');
  const path = join(backupsDir(), fileName);
  if (!existsSync(path)) throw new Error('备份文件不存在');
  return path;
}

export function listBackups(): BackupFileInfo[] {
  const dir = backupsDir();
  return readdirSync(dir)
    .filter((name) => name.endsWith('.db'))
    .map((fileName) => {
      const path = join(dir, fileName);
      const stats = statSync(path);
      return { fileName, path, size: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup(): Promise<BackupFileInfo> {
  const path = join(backupsDir(), `knowledge-backup-${timestamp()}.db`);
  await getSQLiteService().backup(path);
  const stats = statSync(path);
  return { fileName: basename(path), path, size: stats.size, createdAt: stats.mtime.toISOString() };
}

/** 用数据库文件恢复当前知识库，完成后重新加载所有窗口 */
async function restoreFromDatabase(sourcePath: string): Promise<void> {
  const safetyCopy = join(backupsDir(), `before-restore-${timestamp()}.db`);
  await getSyncService().halt();
  try {
    await getWorkspaceManager().replaceDatabase(sourcePath, safetyCopy, () => flushWindows());
  } finally {
    getSyncService().start();
  }
  getOrganizeScheduler().restart();
  for (const window of BrowserWindow.getAllWindows()) window.webContents.reload();
}

async function confirmRestore(owner: BrowserWindow | null, detail: string): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    buttons: ['取消', '恢复'],
    defaultId: 0,
    cancelId: 0,
    title: '恢复备份',
    message: '用备份替换当前知识库的数据？',
    detail: `${detail}\n\n当前数据会先另存到备份目录（before-restore-*.db），恢复后窗口会重新加载。`,
  };
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  return response === 1;
}

async function pickDirectory(owner: BrowserWindow | null, title: string, create: boolean): Promise<string | null> {
  const options = {
    title,
    properties: create ? (['openDirectory', 'createDirectory'] as const) : (['openDirectory'] as const),
  };
  const picked = owner
    ? await dialog.showOpenDialog(owner, { ...options, properties: [...options.properties] })
    : await dialog.showOpenDialog({ ...options, properties: [...options.properties] });
  return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0];
}

// ================================
// 完整备份
// ================================

/** 写入完整备份到 parentDir 下的新文件夹，返回该文件夹路径 */
export async function writeFullBackup(parentDir: string): Promise<string> {
  const workspace = getWorkspaceManager().getCurrent();
  const safeName = workspace.name.replace(/[\\/:*?"<>|]/g, '_');
  const target = join(parentDir, `CodeReader-备份-${safeName}-${timestamp()}`);
  mkdirSync(target, { recursive: true });
  await getSQLiteService().backup(join(target, BACKUP_DB_FILE));
  if (existsSync(workspace.attachmentsPath)) {
    cpSync(workspace.attachmentsPath, join(target, 'attachments'), { recursive: true });
  }
  const ocrDir = join(workspace.rootPath, OCR_RESULTS_DIR);
  if (existsSync(ocrDir)) cpSync(ocrDir, join(target, OCR_RESULTS_DIR), { recursive: true });
  const manifest: FullBackupManifest = {
    app: 'code-reader',
    format: 1,
    workspaceName: workspace.name,
    createdAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    attachmentsPath: workspace.attachmentsPath,
  };
  writeFileSync(join(target, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');
  return target;
}

function readManifest(dir: string): FullBackupManifest {
  const path = join(dir, MANIFEST_FILE);
  if (!existsSync(path)) throw new Error('所选文件夹不是完整备份（缺少 manifest.json）');
  const manifest = JSON.parse(readFileSync(path, 'utf-8')) as Partial<FullBackupManifest>;
  if (manifest.app !== 'code-reader' || manifest.format !== 1 || typeof manifest.attachmentsPath !== 'string') {
    throw new Error('备份清单无效');
  }
  return manifest as FullBackupManifest;
}

/** 从完整备份恢复：附件复制回当前知识库（不覆盖已有文件），数据库路径改写后替换当前数据库 */
async function restoreFullBackup(dir: string, manifest: FullBackupManifest): Promise<void> {
  const workspace = getWorkspaceManager().getCurrent();
  const staged = join(backupsDir(), `restore-staging-${timestamp()}.db`);
  copyFileSync(join(dir, BACKUP_DB_FILE), staged);
  try {
    rebaseAttachmentPaths(staged, manifest.attachmentsPath, workspace.attachmentsPath);
    const attachments = join(dir, 'attachments');
    if (existsSync(attachments)) {
      cpSync(attachments, workspace.attachmentsPath, { recursive: true, force: false, errorOnExist: false });
    }
    const ocr = join(dir, OCR_RESULTS_DIR);
    if (existsSync(ocr)) {
      cpSync(ocr, join(workspace.rootPath, OCR_RESULTS_DIR), { recursive: true, force: false, errorOnExist: false });
    }
    await restoreFromDatabase(staged);
  } finally {
    rmSync(staged, { force: true });
  }
}

// ================================
// IPC
// ================================

const CHANNELS = [
  'backup:list',
  'backup:create',
  'backup:restore',
  'backup:restoreFromFile',
  'backup:delete',
  'backup:openFolder',
  'backup:exportFull',
  'backup:restoreFull',
] as const;

export function registerBackupHandlers(): void {
  ipcMain.handle('backup:list', () => listBackups());

  ipcMain.handle('backup:create', () => createBackup());

  ipcMain.handle('backup:restore', async (event, fileName: string) => {
    const path = backupFilePath(fileName);
    const check = checkBackupDatabase(path);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!(await confirmRestore(owner, `备份：${fileName}（${check.itemCount} 个条目）`))) return { restored: false };
    await restoreFromDatabase(path);
    return { restored: true };
  });

  ipcMain.handle('backup:restoreFromFile', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '选择要恢复的数据库备份',
      properties: ['openFile' as const],
      filters: [{ name: '知识库数据库', extensions: ['db'] }],
    };
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return { restored: false };
    const [path] = picked.filePaths;
    const check = checkBackupDatabase(path);
    if (!(await confirmRestore(owner, `备份：${path}（${check.itemCount} 个条目）`))) return { restored: false };
    await restoreFromDatabase(path);
    return { restored: true };
  });

  ipcMain.handle('backup:delete', (_event, fileName: string) => {
    rmSync(backupFilePath(fileName));
  });

  ipcMain.handle('backup:openFolder', async () => {
    const error = await shell.openPath(backupsDir());
    if (error) throw new Error(error);
  });

  ipcMain.handle('backup:exportFull', async (event) => {
    const dir = await pickDirectory(BrowserWindow.fromWebContents(event.sender), '选择完整备份的保存位置', true);
    return dir ? writeFullBackup(dir) : null;
  });

  ipcMain.handle('backup:restoreFull', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dir = await pickDirectory(owner, '选择完整备份文件夹（含 manifest.json）', false);
    if (!dir) return { restored: false };
    const manifest = readManifest(dir);
    const check = checkBackupDatabase(join(dir, BACKUP_DB_FILE));
    const detail = `完整备份：${manifest.workspaceName}，${new Date(manifest.createdAt).toLocaleString('zh-CN')}（${check.itemCount} 个条目）。附件会复制回当前知识库`;
    if (!(await confirmRestore(owner, detail))) return { restored: false };
    await restoreFullBackup(dir, manifest);
    return { restored: true };
  });
}

export function cleanupBackupHandlers(): void {
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);
}
