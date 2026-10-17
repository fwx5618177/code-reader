// ================================
// 多设备同步服务（主进程）：设置、连接 / 断开同步文件夹、手动与定时同步、IPC
// 这不是云服务：同步经由用户选择的共享文件夹（iCloud Drive、Dropbox、OneDrive、Syncthing、NAS 等）完成，
// 由这些工具负责在设备间传输文件。
// - 设备 ID 与设备名属于本机安装（userData/config/sync-device.json）；同步设置属于知识库（app_settings 的 sync.config）
// - 加密口令用系统钥匙串（safeStorage）加密后保存；系统不支持时只保存在内存中，重启后需要重新输入
// - 换了同步文件夹（sync.json 的 id 不同）时清空本地同步状态，重新全量导出
// ================================

import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import { dirname, join } from 'path';
import { getSQLiteService } from '../database/sqlite';
import { getWorkspaceManager } from '../workspace/workspace-manager';
import { createEncryptionInfo, unlock } from './crypto';
import { runSync, type SyncResult } from './sync-engine';
import { SqliteSyncStore } from './sqlite-store';
import { SyncFolder, type DeviceInfo } from './sync-folder';

const CONFIG_KEY = 'sync.config';
export const SYNC_INTERVALS = [5, 15, 30, 60] as const;
const INITIAL_DELAY_MS = 30 * 1000;

export interface SyncConfig {
  folder: string | null;
  /** 已连接的同步文件夹 ID */
  folderId: string | null;
  enabled: boolean;
  intervalMinutes: number;
  encrypted: boolean;
  /** safeStorage 加密后的口令（base64） */
  passphrase: string | null;
  lastSyncAt: string | null;
  lastResult: Omit<SyncResult, 'devices' | 'changedItemIds'> | null;
  lastError: string | null;
}

export interface SyncStatus extends Omit<SyncConfig, 'passphrase'> {
  deviceId: string;
  deviceName: string;
  running: boolean;
  /** 加密的同步文件夹需要重新输入口令（系统钥匙串不可用或口令已失效） */
  needsPassphrase: boolean;
  devices: DeviceInfo[];
}

function defaultConfig(): SyncConfig {
  return {
    folder: null,
    folderId: null,
    enabled: false,
    intervalMinutes: 15,
    encrypted: false,
    passphrase: null,
    lastSyncAt: null,
    lastResult: null,
    lastError: null,
  };
}

function readConfig(): SyncConfig {
  const row = getSQLiteService().get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [CONFIG_KEY]);
  if (!row) return defaultConfig();
  try {
    return { ...defaultConfig(), ...(JSON.parse(row.value) as Partial<SyncConfig>) };
  } catch {
    return defaultConfig();
  }
}

function writeConfig(config: SyncConfig): void {
  getSQLiteService().run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [CONFIG_KEY, JSON.stringify(config)]
  );
}

// ================================
// 本机设备身份
// ================================

interface DeviceIdentity {
  deviceId: string;
  name: string;
}

function identityPath(): string {
  return join(app.getPath('userData'), 'config', 'sync-device.json');
}

function readIdentity(): DeviceIdentity {
  const path = identityPath();
  if (existsSync(path)) {
    try {
      const identity = JSON.parse(readFileSync(path, 'utf-8')) as Partial<DeviceIdentity>;
      if (typeof identity.deviceId === 'string' && typeof identity.name === 'string') return identity as DeviceIdentity;
    } catch {
      // 损坏时重新生成
    }
  }
  return writeIdentity({ deviceId: randomUUID(), name: hostname().replace(/\.local$/, '') || '我的设备' });
}

function writeIdentity(identity: DeviceIdentity): DeviceIdentity {
  const path = identityPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(identity, null, 2), 'utf-8');
  return identity;
}

// ================================
// 服务
// ================================

class SyncService {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running: Promise<SyncResult> | null = null;
  /** 当前知识库同步文件夹的密钥（解锁后缓存，切换知识库时清除） */
  private key: Buffer | null = null;

  start(): void {
    this.stop();
    this.key = null;
    const config = readConfig();
    if (!config.enabled || !config.folder) return;
    this.initialTimer = setTimeout(() => void this.runQuietly(), INITIAL_DELAY_MS);
    this.timer = setInterval(() => void this.runQuietly(), config.intervalMinutes * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  /** 切换知识库或恢复备份前：停止定时并等待进行中的同步结束，避免写入即将关闭的数据库 */
  async halt(): Promise<void> {
    this.stop();
    await this.running?.catch(() => undefined);
    this.key = null;
  }

  async status(): Promise<SyncStatus> {
    const config = readConfig();
    const identity = readIdentity();
    const { passphrase: _stored, ...rest } = config;
    let devices: DeviceInfo[] = [];
    if (config.folder && existsSync(config.folder)) {
      try {
        devices = await new SyncFolder(config.folder, null).listDevices();
      } catch {
        devices = [];
      }
    }
    return {
      ...rest,
      deviceId: identity.deviceId,
      deviceName: identity.name,
      running: this.running !== null,
      needsPassphrase: config.encrypted && !this.key && !this.storedPassphrase(config),
      devices,
    };
  }

  /** 选择同步文件夹，返回其状态（是否已有同步数据、是否加密），不连接 */
  async inspectFolder(folder: string): Promise<{ folder: string; exists: boolean; encrypted: boolean; devices: number }> {
    const info = await SyncFolder.readInfo(folder);
    return {
      folder,
      exists: !!info,
      encrypted: !!info?.encryption,
      devices: info ? (await new SyncFolder(folder, null).listDevices()).length : 0,
    };
  }

  /**
   * 连接同步文件夹：已有同步数据时加入（加密的需要正确口令），否则新建（提供口令即启用加密）。连接后立即同步一次
   */
  async connect(input: { folder: string; passphrase?: string }): Promise<SyncResult> {
    if (this.running) throw new Error('正在同步，请稍候');
    const passphrase = input.passphrase?.trim() || null;
    let info = await SyncFolder.readInfo(input.folder);
    let key: Buffer | null = null;
    if (info) {
      if (info.encryption) {
        if (!passphrase) throw new Error('该同步文件夹已加密，请输入同步口令');
        key = unlock(passphrase, info.encryption);
      }
    } else {
      const encryption = passphrase ? createEncryptionInfo(passphrase) : null;
      info = await SyncFolder.create(input.folder, encryption?.info ?? null);
      key = encryption?.key ?? null;
    }

    const previous = readConfig();
    if (previous.folderId !== info.id) {
      // 换了同步文件夹：清空同步状态，下次同步全量导出、并从头应用新文件夹中的变更
      getSQLiteService().transaction(() => {
        getSQLiteService().run('DELETE FROM sync_records');
        getSQLiteService().run('DELETE FROM sync_cursors');
      });
    }
    this.key = key;
    writeConfig({
      ...previous,
      folder: input.folder,
      folderId: info.id,
      enabled: true,
      encrypted: !!info.encryption,
      passphrase: passphrase && info.encryption && safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(passphrase).toString('base64')
        : null,
      lastError: null,
    });
    this.start();
    return this.runNow();
  }

  /** 解锁加密的同步文件夹（口令只保存在本机） */
  async providePassphrase(passphrase: string): Promise<void> {
    const config = readConfig();
    if (!config.folder) throw new Error('尚未连接同步文件夹');
    const info = await SyncFolder.readInfo(config.folder);
    if (!info?.encryption) throw new Error('同步文件夹没有加密');
    this.key = unlock(passphrase, info.encryption);
    writeConfig({
      ...config,
      passphrase: safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(passphrase).toString('base64') : null,
    });
  }

  disconnect(): void {
    this.stop();
    this.key = null;
    writeConfig({ ...readConfig(), folder: null, enabled: false, passphrase: null });
  }

  update(input: { enabled?: unknown; intervalMinutes?: unknown; deviceName?: unknown }): void {
    const config = readConfig();
    if (typeof input.deviceName === 'string' && input.deviceName.trim()) {
      writeIdentity({ ...readIdentity(), name: input.deviceName.trim().slice(0, 40) });
    }
    const interval = SYNC_INTERVALS.find((minutes) => minutes === input.intervalMinutes) ?? config.intervalMinutes;
    const enabled = typeof input.enabled === 'boolean' ? input.enabled && !!config.folder : config.enabled;
    writeConfig({ ...config, enabled, intervalMinutes: interval });
    this.start();
  }

  private storedPassphrase(config: SyncConfig): string | null {
    if (!config.passphrase || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(config.passphrase, 'base64'));
    } catch {
      return null;
    }
  }

  private async folderForSync(config: SyncConfig): Promise<SyncFolder> {
    if (!config.folder) throw new Error('尚未连接同步文件夹');
    const info = await SyncFolder.readInfo(config.folder);
    if (!info) throw new Error(`同步文件夹不可用：${config.folder}`);
    if (info.id !== config.folderId) throw new Error('同步文件夹已被替换，请重新连接');
    if (info.encryption && !this.key) {
      const passphrase = this.storedPassphrase(config);
      if (!passphrase) throw new Error('需要输入同步口令');
      this.key = unlock(passphrase, info.encryption);
    }
    return new SyncFolder(config.folder, info.encryption ? this.key : null);
  }

  /** 立即同步；已有同步在进行时返回同一次的结果 */
  runNow(): Promise<SyncResult> {
    this.running ??= this.execute().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runQuietly(): Promise<void> {
    try {
      await this.runNow();
    } catch {
      // 错误已记录到 lastError，在设置页显示
    }
  }

  private async execute(): Promise<SyncResult> {
    const config = readConfig();
    const identity = readIdentity();
    try {
      const folder = await this.folderForSync(config);
      const workspace = getWorkspaceManager().getCurrent();
      const result = await runSync({
        store: new SqliteSyncStore(getSQLiteService(), workspace.attachmentsPath),
        folder,
        deviceId: identity.deviceId,
        deviceName: identity.name,
      });
      const { devices: _devices, changedItemIds, ...summary } = result;
      writeConfig({ ...readConfig(), lastSyncAt: new Date().toISOString(), lastResult: summary, lastError: null });
      if (changedItemIds.length > 0) {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('sync:applied', changedItemIds);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Sync] 同步失败:', error);
      writeConfig({ ...readConfig(), lastSyncAt: new Date().toISOString(), lastError: message });
      throw error;
    }
  }
}

let service: SyncService | null = null;

export function getSyncService(): SyncService {
  if (!service) service = new SyncService();
  return service;
}

const CHANNELS = [
  'sync:getStatus',
  'sync:chooseFolder',
  'sync:connect',
  'sync:providePassphrase',
  'sync:disconnect',
  'sync:update',
  'sync:runNow',
] as const;

export function registerSyncHandlers(): void {
  const sync = getSyncService();
  ipcMain.handle('sync:getStatus', () => sync.status());
  ipcMain.handle('sync:chooseFolder', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '选择同步文件夹（例如 iCloud Drive、Dropbox 或 Syncthing 中的文件夹）',
      properties: ['openDirectory' as const, 'createDirectory' as const],
    };
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return sync.inspectFolder(picked.filePaths[0]);
  });
  ipcMain.handle('sync:connect', (_event, input: { folder?: unknown; passphrase?: unknown }) => {
    if (typeof input?.folder !== 'string') throw new Error('同步文件夹无效');
    return sync.connect({ folder: input.folder, passphrase: typeof input.passphrase === 'string' ? input.passphrase : undefined });
  });
  ipcMain.handle('sync:providePassphrase', (_event, passphrase: unknown) => {
    if (typeof passphrase !== 'string' || !passphrase) throw new Error('请输入同步口令');
    return sync.providePassphrase(passphrase);
  });
  ipcMain.handle('sync:disconnect', () => sync.disconnect());
  ipcMain.handle('sync:update', (_event, input: Record<string, unknown>) => sync.update(input ?? {}));
  ipcMain.handle('sync:runNow', () => sync.runNow());
}

export function cleanupSyncHandlers(): void {
  getSyncService().stop();
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);
}
