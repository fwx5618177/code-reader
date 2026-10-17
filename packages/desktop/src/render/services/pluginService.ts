// ================================
// 插件服务（渲染进程单例）
// 负责：经 IPC 列出插件包并校验 manifest、按持久化的启用状态与授权加载插件、
// 启用前请求授权（由 PluginHost 渲染 PermissionDialog）、启用/禁用/重新加载/卸载、执行插件命令。
// 由 PluginHost 在应用启动时调用 init()，只初始化一次。
// ================================

import type { PluginPackage } from '../types/electron';
import { ExtensionRegistry } from '../lib/plugins/extension-registry';
import { validateManifest } from '../lib/plugins/manifest';
import { PluginLoader, type PluginCommand } from '../lib/plugins/plugin-loader';
import {
  disable,
  getPreference,
  grantAndEnable,
  grantedPermissions,
  missingPermissions,
  removePreference,
  type PluginPreferences,
} from '../lib/plugins/preferences';
import type { Permission } from '../lib/plugins/sandbox';
import { clearPluginStorage } from '../lib/plugins/storage';
import type { PluginId, PluginManifest, PluginSource } from '../lib/plugins/types';
import { createWorkerPlugin } from '../lib/plugins/worker-plugin';
import { settingsService } from './settingsService';

export type PluginStatus = 'disabled' | 'loading' | 'active' | 'error';

export interface PluginEntry {
  id: PluginId;
  source: PluginSource;
  /** manifest 无效时为 null，原因见 errors */
  manifest: PluginManifest | null;
  errors: string[];
  enabled: boolean;
  grantedPermissions: Permission[];
  status: PluginStatus;
}

/** 等待用户确认的授权请求 */
export interface PermissionRequest {
  pluginId: PluginId;
  pluginName: string;
  version: string;
  permissions: Permission[];
}

export interface PluginSnapshot {
  initialized: boolean;
  /** 用户插件目录 */
  pluginsDir: string;
  plugins: PluginEntry[];
  permissionRequest: PermissionRequest | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class PluginService {
  /** 扩展点注册表：界面（状态栏）从这里订阅插件贡献 */
  readonly registry = new ExtensionRegistry();
  private readonly loader = new PluginLoader({ registry: this.registry });

  private snapshot: PluginSnapshot = { initialized: false, pluginsDir: '', plugins: [], permissionRequest: null };
  private readonly listeners = new Set<() => void>();
  private preferences: PluginPreferences = {};
  private initialized: Promise<void> | null = null;
  /** 修改插件状态的操作串行执行，避免启用、重新加载、卸载交错 */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly permissionQueue: Array<{ request: PermissionRequest; resolve: (allowed: boolean) => void }> = [];

  // ======= 状态订阅 =======

  getSnapshot = (): PluginSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setSnapshot(patch: Partial<PluginSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private patchEntry(pluginId: PluginId, patch: Partial<PluginEntry>): void {
    this.setSnapshot({
      plugins: this.snapshot.plugins.map((entry) => (entry.id === pluginId ? { ...entry, ...patch } : entry)),
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  // ======= 初始化 =======

  /** 读取偏好、扫描插件目录并启动已启用的插件（只执行一次） */
  init(): Promise<void> {
    this.initialized ??= this.serialize(async () => {
      this.preferences = { ...(await settingsService.get()).plugins };
      await this.scan();
      for (const entry of this.snapshot.plugins) {
        if (entry.enabled && entry.manifest) await this.enable(entry.id);
      }
      this.setSnapshot({ initialized: true });
    });
    return this.initialized;
  }

  // ======= 用户操作 =======

  setEnabled(pluginId: PluginId, enabled: boolean): Promise<void> {
    return this.serialize(async () => {
      if (enabled) {
        await this.enable(pluginId);
      } else {
        await this.loader.deactivate(pluginId);
        await this.savePreferences(disable(this.preferences, pluginId));
        this.patchEntry(pluginId, { status: 'disabled', errors: [] });
      }
    });
  }

  /** 重新读取插件目录与入口代码；已启用的插件重新激活 */
  reload(pluginId: PluginId): Promise<void> {
    return this.serialize(async () => {
      await this.loader.deactivate(pluginId);
      await this.scan();
      const entry = this.findEntry(pluginId);
      if (entry?.enabled && entry.manifest) await this.enable(pluginId);
    });
  }

  /** 重新扫描插件目录（发现新复制进来的插件） */
  refresh(): Promise<void> {
    return this.serialize(() => this.scan());
  }

  uninstall(pluginId: PluginId): Promise<void> {
    return this.serialize(async () => {
      await this.loader.deactivate(pluginId);
      await window.electron.plugins.uninstall(pluginId);
      clearPluginStorage(pluginId);
      await this.savePreferences(removePreference(this.preferences, pluginId));
      await this.scan();
    });
  }

  openDirectory(): Promise<void> {
    return window.electron.plugins.openDirectory();
  }

  getCommands(): PluginCommand[] {
    return this.loader.getCommands();
  }

  executeCommand(pluginId: PluginId, commandId: string): Promise<unknown> {
    return this.loader.executeCommand(pluginId, commandId);
  }

  /** PermissionDialog 的确认结果 */
  resolvePermissionRequest(allowed: boolean): void {
    const current = this.permissionQueue.shift();
    current?.resolve(allowed);
    this.setSnapshot({ permissionRequest: this.permissionQueue[0]?.request ?? null });
  }

  // ======= 内部流程 =======

  private findEntry(pluginId: PluginId): PluginEntry | undefined {
    return this.snapshot.plugins.find((entry) => entry.id === pluginId);
  }

  private toEntry(item: PluginPackage): PluginEntry {
    const validation = item.error
      ? { manifest: null, errors: [item.error] }
      : validateManifest(item.manifest, item.id);
    const preference = getPreference(this.preferences, item.id);
    const active = this.loader.isActive(item.id);
    return {
      id: item.id,
      source: item.source,
      manifest: validation.manifest,
      errors: validation.errors,
      enabled: preference.enabled,
      grantedPermissions: grantedPermissions(this.preferences, item.id),
      status: active ? 'active' : validation.manifest ? 'disabled' : 'error',
    };
  }

  private async scan(): Promise<void> {
    const { pluginsDir, packages } = await window.electron.plugins.list();
    // 已从目录中消失的插件随之停用
    for (const entry of this.snapshot.plugins) {
      if (!packages.some((item) => item.id === entry.id)) await this.loader.deactivate(entry.id);
    }
    this.setSnapshot({ pluginsDir, plugins: packages.map((item) => this.toEntry(item)) });
  }

  private async savePreferences(preferences: PluginPreferences): Promise<void> {
    this.preferences = preferences;
    await settingsService.update({ plugins: preferences });
    this.setSnapshot({
      plugins: this.snapshot.plugins.map((entry) => ({
        ...entry,
        enabled: getPreference(preferences, entry.id).enabled,
        grantedPermissions: grantedPermissions(preferences, entry.id),
      })),
    });
  }

  private requestPermissions(manifest: PluginManifest, permissions: Permission[]): Promise<boolean> {
    return new Promise((resolve) => {
      const request: PermissionRequest = {
        pluginId: manifest.id,
        pluginName: manifest.name,
        version: manifest.version,
        permissions,
      };
      this.permissionQueue.push({ request, resolve });
      if (this.permissionQueue.length === 1) this.setSnapshot({ permissionRequest: request });
    });
  }

  /** 缺少授权时先请求；用户拒绝则保持禁用。授权通过后持久化并激活 */
  private async enable(pluginId: PluginId): Promise<void> {
    const manifest = this.findEntry(pluginId)?.manifest;
    if (!manifest) throw new Error(`插件 ${pluginId} 的 manifest 无效，无法启用`);
    if (this.loader.isActive(pluginId)) return;

    const missing = missingPermissions(this.preferences, manifest);
    if (missing.length > 0 && !(await this.requestPermissions(manifest, missing))) {
      await this.savePreferences(disable(this.preferences, pluginId));
      this.patchEntry(pluginId, { status: 'disabled' });
      return;
    }
    await this.savePreferences(grantAndEnable(this.preferences, manifest));

    this.patchEntry(pluginId, { status: 'loading', errors: [] });
    try {
      const code = await window.electron.plugins.readEntry(pluginId, manifest.main);
      await this.loader.activate(createWorkerPlugin(manifest, code), grantedPermissions(this.preferences, pluginId));
      this.patchEntry(pluginId, { status: 'active' });
    } catch (error) {
      this.patchEntry(pluginId, { status: 'error', errors: [errorMessage(error)] });
    }
  }
}

export const pluginService = new PluginService();
