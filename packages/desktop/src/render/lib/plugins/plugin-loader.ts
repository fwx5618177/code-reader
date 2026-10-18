// ================================
// 插件加载器
// 负责插件生命周期：以沙箱化上下文激活插件、管理其命令与扩展贡献、停用时统一清理
// ================================

import type { ExtensionRegistry } from '@code-reader/plugin-system/registry';
import { getEditorBridge } from './editor-bridge';
import { STATUS_BAR_ITEMS, VIEW_ITEMS, type ViewItemsByView } from './extension-registry';
import { configurationValues } from './preferences';
import { createSandboxedContext, type Permission } from './sandbox';
import { createPluginStorage } from './storage';
import type { ConfigurationAPI, Disposable, Plugin, PluginContext, PluginId, PluginManifest, StorageAPI } from './types';

export interface PluginLoaderOptions {
  registry: ExtensionRegistry;
  /** 插件私有存储，默认使用 localStorage */
  storageFor?: (pluginId: PluginId) => StorageAPI;
  /** 插件配置，默认只提供 manifest 中的默认值 */
  configurationFor?: (manifest: PluginManifest) => ConfigurationAPI;
  /** 激活超时（毫秒） */
  activationTimeout?: number;
}

interface ActivePlugin {
  plugin: Plugin;
  context: PluginContext;
  commands: Map<string, (...args: unknown[]) => unknown>;
  /** 扩展点 ID → 本插件当前的贡献（重新设置时先撤下旧贡献） */
  contributions: Map<string, Disposable>;
}

const DEFAULT_ACTIVATION_TIMEOUT = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class PluginLoader {
  private readonly active = new Map<PluginId, ActivePlugin>();
  private readonly registry: ExtensionRegistry;
  private readonly storageFor: (pluginId: PluginId) => StorageAPI;
  private readonly configurationFor: (manifest: PluginManifest) => ConfigurationAPI;
  private readonly activationTimeout: number;

  constructor(options: PluginLoaderOptions) {
    this.registry = options.registry;
    this.storageFor = options.storageFor ?? ((pluginId) => createPluginStorage(pluginId));
    this.configurationFor =
      options.configurationFor ??
      ((manifest) => {
        const defaults = configurationValues({}, manifest);
        return { get: (key) => defaults[key]!, onDidChange: () => ({ dispose: () => undefined }) };
      });
    this.activationTimeout = options.activationTimeout ?? DEFAULT_ACTIVATION_TIMEOUT;
  }

  isActive(pluginId: PluginId): boolean {
    return this.active.has(pluginId);
  }

  /** 已激活的插件是否已注册该命令的处理器 */
  hasCommand(pluginId: PluginId, commandId: string): boolean {
    return this.active.get(pluginId)?.commands.has(commandId) ?? false;
  }

  /**
   * 激活插件；失败时清理已产生的命令、订阅与扩展贡献后抛出
   * @param granted 用户已授予的权限
   */
  async activate(plugin: Plugin, granted: readonly Permission[]): Promise<void> {
    const { manifest } = plugin;
    const pluginId = manifest.id;
    if (this.active.has(pluginId)) throw new Error(`插件 ${pluginId} 已激活`);

    const bridge = getEditorBridge();
    const commands = new Map<string, (...args: unknown[]) => unknown>();
    const contributions = new Map<string, Disposable>();
    const contribute = (pointId: string, value: unknown) => {
      const registration = this.registry.registerExtension(pointId, pluginId, value);
      contributions.get(pointId)?.dispose();
      contributions.set(pointId, registration);
    };
    let views: ViewItemsByView = {};
    const context = createSandboxedContext(manifest, granted, {
      editor: bridge.createEditorAPI(),
      ui: bridge.createUIAPI(),
      storage: this.storageFor(pluginId),
      statusBar: {
        set: (item) => contribute(STATUS_BAR_ITEMS, item),
        clear: () => {
          contributions.get(STATUS_BAR_ITEMS)?.dispose();
          contributions.delete(STATUS_BAR_ITEMS);
        },
      },
      views: {
        set: (viewId, items) => {
          views = { ...views, [viewId]: items };
          contribute(VIEW_ITEMS, views);
        },
      },
      configuration: this.configurationFor(manifest),
      registerCommand: (id, handler): Disposable => {
        if (commands.has(id)) throw new Error(`命令 ${id} 已注册`);
        commands.set(id, handler);
        return {
          dispose: () => {
            if (commands.get(id) === handler) commands.delete(id);
          },
        };
      },
    });

    this.active.set(pluginId, { plugin, context, commands, contributions });
    try {
      await withTimeout(
        (async () => plugin.activate(context))(),
        this.activationTimeout,
        `插件 ${pluginId} 激活超时（${this.activationTimeout / 1000} 秒）`
      );
    } catch (error) {
      await this.deactivate(pluginId);
      throw error;
    }
  }

  async deactivate(pluginId: PluginId): Promise<void> {
    const entry = this.active.get(pluginId);
    if (!entry) return;
    this.active.delete(pluginId);
    try {
      await entry.plugin.deactivate?.();
    } catch (error) {
      console.error(`[插件:${pluginId}] 停用出错:`, error);
    }
    for (const disposable of entry.context.subscriptions.splice(0)) {
      try {
        disposable.dispose();
      } catch (error) {
        console.error(`[插件:${pluginId}] 释放资源出错:`, error);
      }
    }
    entry.commands.clear();
    this.registry.unregisterAllByPlugin(pluginId);
    entry.contributions.clear();
  }

  async executeCommand(pluginId: PluginId, commandId: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.active.get(pluginId)?.commands.get(commandId);
    if (!handler) throw new Error(`命令 ${pluginId}.${commandId} 不可用`);
    return handler(...args);
  }
}
