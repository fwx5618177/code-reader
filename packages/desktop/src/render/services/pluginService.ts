// ================================
// 插件服务（渲染进程单例）
// 负责：经 IPC 列出插件包并校验 manifest、按持久化的启用状态与授权加载插件、
// 启用前请求授权（由 PluginHost 渲染 PermissionDialog）、启用/禁用/重新加载/卸载、执行插件命令、插件配置。
//
// 生命周期编排（@code-reader/plugin-system/lifecycle）：
// 1. 可参与激活的插件 = manifest 有效、未被签名策略阻止、已启用且权限已授予
// 2. 依赖解析：依赖先激活；必需依赖缺失、未启用、版本不满足或循环依赖时拒绝激活并显示原因
// 3. 激活事件：onStartup（默认）/ onLanguage / onView 发生后激活；其余时间保持“等待激活”，
//    执行它的命令（命令面板、快捷键、斜杠菜单、工具栏、视图）时先激活再执行
// 由 PluginHost 在应用启动时调用 init()，只初始化一次。
// ================================

import {
  activationEvent,
  resolveDependencies,
  shouldActivate,
  type DependencyResolution,
} from '@code-reader/plugin-system/lifecycle';
import type { PluginPackage, PluginSignatureCheck } from '../types/electron';
import { getEditorBridge } from '../lib/plugins/editor-bridge';
import { ExtensionRegistry } from '../lib/plugins/extension-registry';
import { currentPlatform, resolveKeybindings, type ResolvedKeybinding } from '../lib/plugins/keybindings';
import { validateManifest } from '../lib/plugins/manifest';
import { PluginLoader } from '../lib/plugins/plugin-loader';
import {
  configurationValues,
  disable,
  getPreference,
  grantAndEnable,
  grantedPermissions,
  missingPermissions,
  removePreference,
  setConfigurationValue,
  type PluginPreferences,
} from '../lib/plugins/preferences';
import type { Permission } from '../lib/plugins/sandbox';
import { clearPluginStorage } from '../lib/plugins/storage';
import type {
  ConfigurationAPI,
  ConfigurationValue,
  PluginId,
  PluginManifest,
  PluginSource,
  PluginView,
} from '../lib/plugins/types';
import { createWorkerPlugin } from '../lib/plugins/worker-plugin';
import { settingsService } from './settingsService';

/** idle：已启用、等待激活事件（或首次执行其命令） */
export type PluginStatus = 'disabled' | 'idle' | 'loading' | 'active' | 'error';

export interface PluginEntry {
  id: PluginId;
  source: PluginSource;
  /** manifest 无效时为 null，原因见 errors */
  manifest: PluginManifest | null;
  errors: string[];
  enabled: boolean;
  grantedPermissions: Permission[];
  status: PluginStatus;
  /** 验签结果；manifest 无法读取时为 null */
  signature: PluginSignatureCheck | null;
  /** 按签名策略不允许加载的原因 */
  blocked: string | null;
  /** 当前配置值（用户设置优先，其余为默认值） */
  configuration: Record<string, ConfigurationValue>;
}

/** 等待用户确认的授权请求 */
export interface PermissionRequest {
  pluginId: PluginId;
  pluginName: string;
  version: string;
  permissions: Permission[];
}

/** 插件命令（命令面板、斜杠菜单、工具栏等入口共用） */
export interface PluginCommand {
  pluginId: PluginId;
  pluginName: string;
  /** 插件内命令 ID */
  commandId: string;
  title: string;
  description?: string;
}

/** 命令面板中的命令（附带生效的快捷键） */
export interface ContributedCommand extends PluginCommand {
  keybinding?: string;
}

export interface ToolbarContributionItem extends PluginCommand {
  icon: string;
  tooltip: string;
}

export interface ViewContribution extends PluginView {
  pluginId: PluginId;
  pluginName: string;
}

/** 已启用插件（运行中或等待激活）贡献给界面的入口 */
export interface PluginContributions {
  commands: ContributedCommand[];
  /** 全部快捷键（含冲突未生效的，conflict 说明原因） */
  keybindings: ResolvedKeybinding[];
  slashItems: PluginCommand[];
  toolbar: ToolbarContributionItem[];
  views: ViewContribution[];
}

export interface PluginSnapshot {
  initialized: boolean;
  /** 用户插件目录 */
  pluginsDir: string;
  plugins: PluginEntry[];
  permissionRequest: PermissionRequest | null;
  contributions: PluginContributions;
}

const EMPTY_CONTRIBUTIONS: PluginContributions = { commands: [], keybindings: [], slashItems: [], toolbar: [], views: [] };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 按 order 排序；相同时保持插件 ID 与 manifest 中的声明顺序（稳定排序） */
function byOrder<T>(items: Array<T & { order?: number }>): T[] {
  return items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

class PluginService {
  /** 扩展点注册表：界面（状态栏、插件视图）从这里订阅插件运行时贡献 */
  readonly registry = new ExtensionRegistry();
  private readonly loader = new PluginLoader({
    registry: this.registry,
    configurationFor: (manifest) => this.configurationFor(manifest),
  });

  private snapshot: PluginSnapshot = {
    initialized: false,
    pluginsDir: '',
    plugins: [],
    permissionRequest: null,
    contributions: EMPTY_CONTRIBUTIONS,
  };
  private readonly listeners = new Set<() => void>();
  private preferences: PluginPreferences = {};
  private initialized: Promise<void> | null = null;
  /** 修改插件状态的操作串行执行，避免启用、激活、重新加载、卸载交错 */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly permissionQueue: Array<{ request: PermissionRequest; resolve: (allowed: boolean) => void }> = [];
  /** 已发生的激活事件（本次运行期间） */
  private readonly firedEvents = new Set<string>();
  /** 最近一次依赖解析的结果 */
  private resolution: DependencyResolution = { order: [], problems: new Map() };
  /** 激活失败的插件：重新加载、重新启用前不再自动重试 */
  private readonly failed = new Set<PluginId>();
  /** manifest 校验与签名策略产生的错误（不随运行状态清除） */
  private readonly packageErrors = new Map<PluginId, string[]>();
  private readonly configurationListeners = new Map<PluginId, Set<(key: string) => void>>();

  // ======= 状态订阅 =======

  getSnapshot = (): PluginSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setSnapshot(patch: Partial<PluginSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (patch.plugins) next.contributions = this.computeContributions(next.plugins);
    this.snapshot = next;
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

  /** 读取偏好、扫描插件目录，按激活事件启动已启用的插件（只执行一次） */
  init(): Promise<void> {
    this.initialized ??= this.serialize(async () => {
      this.preferences = { ...(await settingsService.get()).plugins };
      await this.scan();
      for (const entry of this.snapshot.plugins) {
        // 按签名策略被阻止的插件保持原有偏好，不在启动时加载（原因显示在插件设置中）；
        // 插件更新后新增的权限在这里重新请求授权
        if (entry.enabled && entry.manifest && !entry.blocked && missingPermissions(this.preferences, entry.manifest).length > 0) {
          await this.ensureGranted(entry.id);
        }
      }
      const bridge = getEditorBridge();
      bridge.onDidChange(() => this.fireLanguageEvent());
      this.firedEvents.add('onStartup');
      this.fireLanguageEvent();
      await this.reconcile();
      this.setSnapshot({ initialized: true });
    });
    return this.initialized;
  }

  // ======= 用户操作 =======

  setEnabled(pluginId: PluginId, enabled: boolean): Promise<void> {
    return this.serialize(async () => {
      if (enabled) {
        this.failed.delete(pluginId);
        if (!(await this.ensureGranted(pluginId))) return;
      } else {
        await this.savePreferences(disable(this.preferences, pluginId));
      }
      await this.reconcile();
    });
  }

  /** 重新读取插件目录与入口代码；已启用的插件按新版本重新激活（新增权限会再次请求授权） */
  reload(pluginId: PluginId): Promise<void> {
    return this.serialize(async () => {
      await this.loader.deactivate(pluginId);
      this.failed.delete(pluginId);
      await this.scan();
      const entry = this.findEntry(pluginId);
      if (entry?.enabled && entry.manifest && !entry.blocked) await this.ensureGranted(pluginId);
      await this.reconcile();
    });
  }

  /** 重新扫描插件目录（发现新复制进来的插件） */
  refresh(): Promise<void> {
    return this.serialize(async () => {
      await this.scan();
      await this.reconcile();
    });
  }

  /** 从市场安装或更新；已启用的插件按新版本重新激活（新增权限会再次请求授权） */
  async installFromMarket(registry: string, pluginId: PluginId): Promise<void> {
    await window.electron.plugins.marketInstall(registry, pluginId);
    await this.reload(pluginId);
  }

  uninstall(pluginId: PluginId): Promise<void> {
    return this.serialize(async () => {
      await this.loader.deactivate(pluginId);
      await window.electron.plugins.uninstall(pluginId);
      clearPluginStorage(pluginId);
      this.configurationListeners.delete(pluginId);
      await this.savePreferences(removePreference(this.preferences, pluginId));
      await this.scan();
      await this.reconcile();
    });
  }

  openDirectory(): Promise<void> {
    return window.electron.plugins.openDirectory();
  }

  /** 命令面板中可执行的插件命令（含等待激活的插件） */
  getCommands(): ContributedCommand[] {
    return this.snapshot.contributions.commands;
  }

  /**
   * 执行插件命令；插件尚在等待激活时先激活（相当于 onCommand 激活事件）
   */
  async executeCommand(pluginId: PluginId, commandId: string, ...args: unknown[]): Promise<unknown> {
    if (!this.loader.isActive(pluginId)) {
      if (this.findEntry(pluginId)?.status !== 'idle') throw new Error(`插件 ${pluginId} 未运行`);
      const activated = await this.serialize(() => this.activate(pluginId));
      if (!activated) throw new Error(this.findEntry(pluginId)?.errors[0] ?? `插件 ${pluginId} 激活失败`);
    }
    return this.loader.executeCommand(pluginId, commandId, ...args);
  }

  /** 由界面触发命令（命令面板、快捷键、状态栏、斜杠菜单、工具栏、插件视图）：失败时以消息提示 */
  runCommand(pluginId: PluginId, commandId: string, args: unknown[] = []): void {
    getEditorBridge().getEditor()?.focus();
    this.executeCommand(pluginId, commandId, ...args).catch((error) => {
      const message = `命令执行失败：${errorMessage(error)}`;
      try {
        getEditorBridge().createUIAPI().showMessage(message, 'error');
      } catch {
        console.error('[插件]', message);
      }
    });
  }

  /** 侧栏显示了插件视图：触发 onView 激活事件 */
  notifyViewsShown(viewIds: readonly string[]): void {
    for (const id of viewIds) this.fireActivationEvent(activationEvent('onView', id));
  }

  /** 修改插件配置；value 为 undefined 时恢复默认值。运行中的插件收到 onDidChange 通知 */
  setConfiguration(pluginId: PluginId, key: string, value: ConfigurationValue | undefined): Promise<void> {
    return this.serialize(async () => {
      const manifest = this.findEntry(pluginId)?.manifest;
      if (!manifest) throw new Error(`插件 ${pluginId} 的 manifest 无效`);
      await this.savePreferences(setConfigurationValue(this.preferences, manifest, key, value));
      for (const listener of this.configurationListeners.get(pluginId) ?? []) {
        try {
          listener(key);
        } catch (error) {
          console.error(`[插件:${pluginId}] 配置监听器出错:`, error);
        }
      }
    });
  }

  /** PermissionDialog 的确认结果 */
  resolvePermissionRequest(allowed: boolean): void {
    const current = this.permissionQueue.shift();
    current?.resolve(allowed);
    this.setSnapshot({ permissionRequest: this.permissionQueue[0]?.request ?? null });
  }

  // ======= 激活编排 =======

  private fireLanguageEvent(): void {
    const language = getEditorBridge().getEditor()?.language;
    if (language) this.fireActivationEvent(activationEvent('onLanguage', language));
  }

  private fireActivationEvent(event: string): void {
    if (this.firedEvents.has(event)) return;
    this.firedEvents.add(event);
    // 初始化完成前发生的事件由 init 中的 reconcile 一并处理
    if (this.snapshot.initialized) {
      this.serialize(() => this.reconcile()).catch((error) => console.error('[插件] 处理激活事件失败:', error));
    }
  }

  /** 可参与激活：manifest 有效、未被阻止、已启用且权限已授予 */
  private usableManifest(entry: PluginEntry): PluginManifest | null {
    const { manifest } = entry;
    if (!manifest || entry.blocked || !entry.enabled) return null;
    return missingPermissions(this.preferences, manifest).length === 0 ? manifest : null;
  }

  /**
   * 按当前启用状态、依赖与已发生的激活事件，停用不再满足条件的插件、激活应当运行的插件
   */
  private async reconcile(): Promise<void> {
    const usable = new Map<PluginId, PluginManifest>();
    const unavailable = new Map<PluginId, string>();
    for (const entry of this.snapshot.plugins) {
      const manifest = this.usableManifest(entry);
      if (manifest) usable.set(entry.id, manifest);
      else unavailable.set(entry.id, entry.enabled ? '不可用' : '未启用');
    }
    this.resolution = resolveDependencies(
      [...usable.values()].map(({ id, version, dependencies }) => ({ id, version, dependencies })),
      unavailable
    );
    const { order, problems } = this.resolution;

    for (const entry of this.snapshot.plugins) {
      if (!usable.has(entry.id) || problems.has(entry.id)) {
        await this.loader.deactivate(entry.id);
        const problem = problems.get(entry.id);
        this.patchEntry(entry.id, {
          status: problem || !entry.manifest || entry.blocked ? 'error' : 'disabled',
          errors: problem ? [problem] : (this.packageErrors.get(entry.id) ?? []),
        });
      }
    }

    for (const id of order) {
      const manifest = usable.get(id)!;
      if (this.loader.isActive(id) || this.failed.has(id)) continue;
      if (shouldActivate(manifest.activationEvents, this.firedEvents)) await this.activate(id);
      else this.patchEntry(id, { status: 'idle', errors: [] });
    }
  }

  /** 激活插件（依赖先激活）；失败时记录原因并返回 false */
  private async activate(pluginId: PluginId): Promise<boolean> {
    if (this.loader.isActive(pluginId)) return true;
    const entry = this.findEntry(pluginId);
    const manifest = entry && this.usableManifest(entry);
    if (!manifest || !this.resolution.order.includes(pluginId) || this.failed.has(pluginId)) return false;

    for (const dependency of manifest.dependencies) {
      if (this.resolution.order.includes(dependency.id) && !(await this.activate(dependency.id))) {
        this.failed.add(pluginId);
        this.patchEntry(pluginId, { status: 'error', errors: [`依赖插件 ${dependency.id} 激活失败`] });
        return false;
      }
    }

    this.patchEntry(pluginId, { status: 'loading', errors: [] });
    try {
      const code = await window.electron.plugins.readEntry(pluginId, manifest.main);
      await this.loader.activate(createWorkerPlugin(manifest, code), grantedPermissions(this.preferences, pluginId));
      this.patchEntry(pluginId, { status: 'active' });
      return true;
    } catch (error) {
      this.failed.add(pluginId);
      this.patchEntry(pluginId, { status: 'error', errors: [errorMessage(error)] });
      return false;
    }
  }

  /** 缺少授权时请求；用户拒绝则禁用并返回 false。授权通过后持久化启用状态 */
  private async ensureGranted(pluginId: PluginId): Promise<boolean> {
    const entry = this.findEntry(pluginId);
    const manifest = entry?.manifest;
    if (!manifest) throw new Error(`插件 ${pluginId} 的 manifest 无效，无法启用`);
    if (entry.blocked) throw new Error(entry.blocked);

    const missing = missingPermissions(this.preferences, manifest);
    if (missing.length > 0 && !(await this.requestPermissions(manifest, missing))) {
      await this.savePreferences(disable(this.preferences, pluginId));
      return false;
    }
    await this.savePreferences(grantAndEnable(this.preferences, manifest));
    return true;
  }

  // ======= 配置 =======

  private configurationFor(manifest: PluginManifest): ConfigurationAPI {
    return {
      get: (key) => configurationValues(this.preferences, manifest)[key]!,
      onDidChange: (listener) => {
        const listeners = this.configurationListeners.get(manifest.id) ?? new Set();
        listeners.add(listener);
        this.configurationListeners.set(manifest.id, listeners);
        return { dispose: () => listeners.delete(listener) };
      },
    };
  }

  // ======= 界面贡献 =======

  private computeContributions(plugins: readonly PluginEntry[]): PluginContributions {
    const usable = plugins
      .filter((entry): entry is PluginEntry & { manifest: PluginManifest } =>
        entry.manifest !== null && (entry.status === 'active' || entry.status === 'idle')
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    // 运行中的插件只提供已注册处理器的命令；等待激活的插件提供全部声明的命令（执行时再激活）
    const available = (entry: PluginEntry, commandId: string) =>
      entry.status === 'idle' || this.loader.hasCommand(entry.id, commandId);
    const commandInfo = (entry: PluginEntry & { manifest: PluginManifest }, commandId: string): PluginCommand => {
      const command = entry.manifest.contributes.commands.find((item) => item.id === commandId);
      return {
        pluginId: entry.id,
        pluginName: entry.manifest.name,
        commandId,
        title: command?.title ?? commandId,
        ...(command?.description ? { description: command.description } : {}),
      };
    };

    const keybindings = resolveKeybindings(
      usable.flatMap((entry) =>
        entry.manifest.contributes.keybindings
          .filter((binding) => available(entry, binding.command))
          .map((binding) => ({
            pluginId: entry.id,
            pluginName: entry.manifest.name,
            binding,
            commandTitle: commandInfo(entry, binding.command).title,
          }))
      ),
      currentPlatform()
    );
    const keybindingLabel = (pluginId: PluginId, commandId: string) =>
      keybindings.find((item) => !item.conflict && item.pluginId === pluginId && item.binding.command === commandId)?.label;

    return {
      commands: usable.flatMap((entry) =>
        entry.manifest.contributes.commands
          .filter((command) => available(entry, command.id))
          .map((command) => {
            const keybinding = keybindingLabel(entry.id, command.id);
            return { ...commandInfo(entry, command.id), ...(keybinding ? { keybinding } : {}) };
          })
      ),
      keybindings,
      slashItems: byOrder(
        usable.flatMap((entry) =>
          entry.manifest.contributes.menus['editor/context']
            .filter((item) => available(entry, item.command))
            .map((item) => ({ ...commandInfo(entry, item.command), order: item.order }))
        )
      ),
      toolbar: byOrder(
        usable.flatMap((entry) =>
          entry.manifest.contributes.toolbar
            .filter((item) => available(entry, item.command))
            .map((item) => {
              const info = commandInfo(entry, item.command);
              return { ...info, icon: item.icon, tooltip: item.tooltip ?? info.title, order: item.order };
            })
        )
      ),
      views: usable.flatMap((entry) =>
        entry.manifest.contributes.views.map((view) => ({ ...view, pluginId: entry.id, pluginName: entry.manifest.name }))
      ),
    };
  }

  // ======= 内部流程 =======

  private findEntry(pluginId: PluginId): PluginEntry | undefined {
    return this.snapshot.plugins.find((entry) => entry.id === pluginId);
  }

  private toEntry(item: PluginPackage): PluginEntry {
    const validation = item.error
      ? { manifest: null, errors: [item.error] }
      : validateManifest(item.manifest, item.id);
    const errors = item.blocked ? [...validation.errors, item.blocked] : validation.errors;
    this.packageErrors.set(item.id, errors);
    const active = this.loader.isActive(item.id);
    return {
      id: item.id,
      source: item.source,
      manifest: validation.manifest,
      errors,
      enabled: getPreference(this.preferences, item.id).enabled,
      grantedPermissions: grantedPermissions(this.preferences, item.id),
      status: active ? 'active' : validation.manifest && !item.blocked ? 'disabled' : 'error',
      signature: item.signature,
      blocked: item.blocked,
      configuration: validation.manifest ? configurationValues(this.preferences, validation.manifest) : {},
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
        configuration: entry.manifest ? configurationValues(preferences, entry.manifest) : {},
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
}

export const pluginService = new PluginService();
