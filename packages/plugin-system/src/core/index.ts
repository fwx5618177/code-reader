// ================================
// 插件核心管理器
// 负责插件的加载、激活、停用和卸载
// ================================

import type {
  Plugin,
  PluginId,
  PluginManifest,
  PluginContext,
  PluginInstance,
  PluginState,
  PluginSource,
  PluginLoadResult,
  PluginEvent,
  PluginEventType,
  Disposable,
  Logger,
  StorageAPI,
  CommandAPI,
  EditorAPI,
  UIAPI,
} from '../types';
import { createDisposable } from '../types';
import { ExtensionRegistry } from '../registry';

// ================================
// 插件管理器配置
// ================================

/** 插件管理器配置 */
export interface PluginManagerConfig {
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 最大并发加载数 */
  maxConcurrentLoads?: number;
  /** 激活超时时间（毫秒） */
  activationTimeout?: number;
  /** 是否启用沙箱 */
  enableSandbox?: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: Required<PluginManagerConfig> = {
  debug: false,
  maxConcurrentLoads: 5,
  activationTimeout: 10000,
  enableSandbox: true,
};

// ================================
// 插件管理器
// ================================

/**
 * 插件管理器
 * 核心类，负责插件生命周期管理
 */
export class PluginManager {
  private config: Required<PluginManagerConfig>;
  private plugins: Map<PluginId, PluginInstance> = new Map();
  private eventListeners: Set<PluginEventListener> = new Set();
  private registry: ExtensionRegistry;

  /** API 提供者 */
  private storageProvider?: StorageProvider;
  private commandProvider?: CommandProvider;
  private editorProvider?: EditorProvider;
  private uiProvider?: UIProvider;

  constructor(config?: PluginManagerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = new ExtensionRegistry();
  }

  // ================================
  // API 提供者设置
  // ================================

  /** 设置存储提供者 */
  setStorageProvider(provider: StorageProvider): void {
    this.storageProvider = provider;
  }

  /** 设置命令提供者 */
  setCommandProvider(provider: CommandProvider): void {
    this.commandProvider = provider;
  }

  /** 设置编辑器提供者 */
  setEditorProvider(provider: EditorProvider): void {
    this.editorProvider = provider;
  }

  /** 设置 UI 提供者 */
  setUIProvider(provider: UIProvider): void {
    this.uiProvider = provider;
  }

  /** 获取扩展注册表 */
  getRegistry(): ExtensionRegistry {
    return this.registry;
  }

  // ================================
  // 插件加载
  // ================================

  /**
   * 加载插件
   * @param plugin 插件实例
   * @param source 加载源
   */
  async loadPlugin(plugin: Plugin, source: PluginSource = 'user' as PluginSource): Promise<PluginLoadResult> {
    const startTime = Date.now();
    const { id } = plugin.manifest;

    try {
      // 检查是否已加载
      if (this.plugins.has(id)) {
        throw new Error(`插件 "${id}" 已加载`);
      }

      // 验证插件
      this.validatePlugin(plugin);

      // 创建插件实例
      const instance: PluginInstance = {
        plugin,
        context: this.createPluginContext(plugin.manifest),
        state: 'loaded' as PluginState,
        source,
        loadedAt: Date.now(),
      };

      this.plugins.set(id, instance);

      // 触发加载事件
      this.emitEvent({
        type: 'plugin:loaded' as PluginEventType,
        pluginId: id,
        timestamp: Date.now(),
        manifest: plugin.manifest,
      });

      this.log(`插件 "${id}" 加载成功`);

      return {
        success: true,
        pluginId: id,
        loadTime: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.emitEvent({
        type: 'plugin:error' as PluginEventType,
        pluginId: id,
        timestamp: Date.now(),
        error: err,
      });

      return {
        success: false,
        pluginId: id,
        error: err,
        loadTime: Date.now() - startTime,
      };
    }
  }

  /**
   * 批量加载插件
   * @param plugins 插件列表
   * @param source 加载源
   */
  async loadPlugins(
    plugins: Plugin[],
    source: PluginSource = 'user' as PluginSource
  ): Promise<PluginLoadResult[]> {
    const results: PluginLoadResult[] = [];

    // 按优先级排序
    const sorted = [...plugins].sort(
      (a, b) => (b.manifest.priority ?? 50) - (a.manifest.priority ?? 50)
    );

    // 分批加载
    const batches: Plugin[][] = [];
    for (let i = 0; i < sorted.length; i += this.config.maxConcurrentLoads) {
      batches.push(sorted.slice(i, i + this.config.maxConcurrentLoads));
    }

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((plugin) => this.loadPlugin(plugin, source))
      );
      results.push(...batchResults);
    }

    return results;
  }

  // ================================
  // 插件激活
  // ================================

  /**
   * 激活插件
   * @param pluginId 插件 ID
   */
  async activatePlugin(pluginId: PluginId): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`插件 "${pluginId}" 未加载`);
    }

    if (instance.state === ('active' as PluginState)) {
      return; // 已激活
    }

    // 更新状态
    this.updatePluginState(pluginId, 'activating' as PluginState);

    try {
      // 检查依赖
      await this.checkDependencies(instance.plugin.manifest);

      // 激活超时处理
      const activationPromise = Promise.resolve(
        instance.plugin.activate(instance.context)
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`插件 "${pluginId}" 激活超时`));
        }, this.config.activationTimeout);
      });

      // 执行激活
      instance.api = await Promise.race([activationPromise, timeoutPromise]);
      instance.activatedAt = Date.now();

      // 更新状态
      this.updatePluginState(pluginId, 'active' as PluginState);

      this.emitEvent({
        type: 'plugin:activated' as PluginEventType,
        pluginId,
        timestamp: Date.now(),
      });

      this.log(`插件 "${pluginId}" 激活成功`);
    } catch (error) {
      this.updatePluginState(pluginId, 'error' as PluginState);

      const err = error instanceof Error ? error : new Error(String(error));
      this.emitEvent({
        type: 'plugin:error' as PluginEventType,
        pluginId,
        timestamp: Date.now(),
        error: err,
      });

      throw err;
    }
  }

  /**
   * 激活所有已加载的插件
   */
  async activateAll(): Promise<void> {
    const pluginIds = Array.from(this.plugins.keys());

    // 按依赖顺序排序
    const sorted = this.sortByDependencies(pluginIds);

    for (const pluginId of sorted) {
      const instance = this.plugins.get(pluginId);
      if (instance && instance.state !== ('active' as PluginState)) {
        try {
          await this.activatePlugin(pluginId);
        } catch (error) {
          console.error(`[PluginManager] 激活插件 "${pluginId}" 失败:`, error);
        }
      }
    }
  }

  // ================================
  // 插件停用
  // ================================

  /**
   * 停用插件
   * @param pluginId 插件 ID
   */
  async deactivatePlugin(pluginId: PluginId): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw new Error(`插件 "${pluginId}" 未加载`);
    }

    if (instance.state !== ('active' as PluginState)) {
      return; // 未激活
    }

    // 更新状态
    this.updatePluginState(pluginId, 'deactivating' as PluginState);

    try {
      // 执行停用
      if (instance.plugin.deactivate) {
        await instance.plugin.deactivate();
      }

      // 清理订阅
      for (const subscription of instance.context.subscriptions) {
        try {
          subscription.dispose();
        } catch (error) {
          console.error(`[PluginManager] 清理订阅失败:`, error);
        }
      }
      instance.context.subscriptions.length = 0;

      // 注销扩展
      this.registry.unregisterAllByPlugin(pluginId);

      // 更新状态
      this.updatePluginState(pluginId, 'inactive' as PluginState);

      this.emitEvent({
        type: 'plugin:deactivated' as PluginEventType,
        pluginId,
        timestamp: Date.now(),
      });

      this.log(`插件 "${pluginId}" 停用成功`);
    } catch (error) {
      this.updatePluginState(pluginId, 'error' as PluginState);

      const err = error instanceof Error ? error : new Error(String(error));
      this.emitEvent({
        type: 'plugin:error' as PluginEventType,
        pluginId,
        timestamp: Date.now(),
        error: err,
      });

      throw err;
    }
  }

  /**
   * 停用所有插件
   */
  async deactivateAll(): Promise<void> {
    const pluginIds = Array.from(this.plugins.keys());

    // 反向依赖顺序停用
    const sorted = this.sortByDependencies(pluginIds).reverse();

    for (const pluginId of sorted) {
      const instance = this.plugins.get(pluginId);
      if (instance && instance.state === ('active' as PluginState)) {
        try {
          await this.deactivatePlugin(pluginId);
        } catch (error) {
          console.error(`[PluginManager] 停用插件 "${pluginId}" 失败:`, error);
        }
      }
    }
  }

  // ================================
  // 插件卸载
  // ================================

  /**
   * 卸载插件
   * @param pluginId 插件 ID
   */
  async unloadPlugin(pluginId: PluginId): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return; // 未加载
    }

    // 先停用
    if (instance.state === ('active' as PluginState)) {
      await this.deactivatePlugin(pluginId);
    }

    // 移除实例
    this.plugins.delete(pluginId);

    this.emitEvent({
      type: 'plugin:unloaded' as PluginEventType,
      pluginId,
      timestamp: Date.now(),
    });

    this.log(`插件 "${pluginId}" 卸载成功`);
  }

  /**
   * 卸载所有插件
   */
  async unloadAll(): Promise<void> {
    await this.deactivateAll();
    this.plugins.clear();
  }

  // ================================
  // 插件查询
  // ================================

  /**
   * 获取插件实例
   * @param pluginId 插件 ID
   */
  getPlugin(pluginId: PluginId): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取插件 API
   * @param pluginId 插件 ID
   */
  getPluginAPI<T>(pluginId: PluginId): T | undefined {
    const instance = this.plugins.get(pluginId);
    return instance?.api as T | undefined;
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取已激活的插件
   */
  getActivePlugins(): PluginInstance[] {
    return this.getAllPlugins().filter((p) => p.state === ('active' as PluginState));
  }

  /**
   * 检查插件是否已加载
   * @param pluginId 插件 ID
   */
  isLoaded(pluginId: PluginId): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * 检查插件是否已激活
   * @param pluginId 插件 ID
   */
  isActive(pluginId: PluginId): boolean {
    const instance = this.plugins.get(pluginId);
    return instance?.state === ('active' as PluginState);
  }

  // ================================
  // 事件监听
  // ================================

  /**
   * 添加事件监听器
   * @param listener 监听器
   */
  onEvent(listener: PluginEventListener): Disposable {
    this.eventListeners.add(listener);
    return createDisposable(() => {
      this.eventListeners.delete(listener);
    });
  }

  /**
   * 触发事件
   */
  private emitEvent(event: PluginEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[PluginManager] 事件监听器错误:', error);
      }
    }
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 验证插件
   */
  private validatePlugin(plugin: Plugin): void {
    const { manifest } = plugin;

    if (!manifest.id) {
      throw new Error('插件缺少 id');
    }

    if (!manifest.name) {
      throw new Error('插件缺少 name');
    }

    if (!manifest.version) {
      throw new Error('插件缺少 version');
    }

    if (typeof plugin.activate !== 'function') {
      throw new Error('插件缺少 activate 方法');
    }
  }

  /**
   * 检查依赖
   */
  private async checkDependencies(manifest: PluginManifest): Promise<void> {
    const dependencies = manifest.dependencies || [];

    for (const dep of dependencies) {
      const instance = this.plugins.get(dep.id);

      if (!instance) {
        if (dep.optional) {
          continue;
        }
        throw new Error(`缺少必需的依赖插件: ${dep.id}`);
      }

      // 确保依赖已激活
      if (instance.state !== ('active' as PluginState)) {
        await this.activatePlugin(dep.id);
      }
    }
  }

  /**
   * 按依赖排序
   */
  private sortByDependencies(pluginIds: PluginId[]): PluginId[] {
    const result: PluginId[] = [];
    const visited = new Set<PluginId>();
    const visiting = new Set<PluginId>();

    const visit = (id: PluginId): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`检测到循环依赖: ${id}`);
      }

      visiting.add(id);

      const instance = this.plugins.get(id);
      if (instance) {
        const deps = instance.plugin.manifest.dependencies || [];
        for (const dep of deps) {
          if (pluginIds.includes(dep.id)) {
            visit(dep.id);
          }
        }
      }

      visiting.delete(id);
      visited.add(id);
      result.push(id);
    };

    for (const id of pluginIds) {
      visit(id);
    }

    return result;
  }

  /**
   * 更新插件状态
   */
  private updatePluginState(pluginId: PluginId, newState: PluginState): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;

    const previousState = instance.state;
    instance.state = newState;

    this.emitEvent({
      type: 'plugin:stateChanged' as PluginEventType,
      pluginId,
      timestamp: Date.now(),
      previousState,
      currentState: newState,
    });
  }

  /**
   * 创建插件上下文
   */
  private createPluginContext(manifest: PluginManifest): PluginContext {
    const pluginId = manifest.id;
    const subscriptions: Disposable[] = [];

    return {
      pluginId,
      version: manifest.version,
      state: 'loaded' as PluginState,
      logger: this.createLogger(pluginId),
      storage: this.createStorageAPI(pluginId, false),
      globalStorage: this.createStorageAPI(pluginId, true),
      commands: this.createCommandAPI(pluginId),
      editor: this.createEditorAPI(),
      ui: this.createUIAPI(),
      subscriptions,
      getPlugin: <T>(id: PluginId): T | undefined => {
        return this.getPluginAPI<T>(id);
      },
    };
  }

  /**
   * 创建日志记录器
   */
  private createLogger(pluginId: PluginId): Logger {
    const prefix = `[${pluginId}]`;
    return {
      debug: (message: string, ...args: unknown[]) => {
        if (this.config.debug) {
          console.debug(prefix, message, ...args);
        }
      },
      info: (message: string, ...args: unknown[]) => {
        console.info(prefix, message, ...args);
      },
      warn: (message: string, ...args: unknown[]) => {
        console.warn(prefix, message, ...args);
      },
      error: (message: string, ...args: unknown[]) => {
        console.error(prefix, message, ...args);
      },
    };
  }

  /**
   * 创建存储 API
   */
  private createStorageAPI(pluginId: PluginId, global: boolean): StorageAPI {
    const provider = this.storageProvider;
    const keyPrefix = global ? '' : `plugin:${pluginId}:`;

    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        if (provider) {
          return provider.get(`${keyPrefix}${key}`, defaultValue);
        }
        return defaultValue;
      },
      async set<T>(key: string, value: T): Promise<void> {
        if (provider) {
          await provider.set(`${keyPrefix}${key}`, value);
        }
      },
      async delete(key: string): Promise<void> {
        if (provider) {
          await provider.delete(`${keyPrefix}${key}`);
        }
      },
      async clear(): Promise<void> {
        if (provider) {
          await provider.clear(keyPrefix);
        }
      },
      keys(): string[] {
        if (provider) {
          return provider.keys(keyPrefix);
        }
        return [];
      },
    };
  }

  /**
   * 创建命令 API
   */
  private createCommandAPI(pluginId: PluginId): CommandAPI {
    const provider = this.commandProvider;

    return {
      registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
        const fullId = `${pluginId}.${id}`;
        if (provider) {
          return provider.registerCommand(fullId, handler);
        }
        return createDisposable(() => {});
      },
      async executeCommand<T>(id: string, ...args: unknown[]): Promise<T> {
        if (provider) {
          return provider.executeCommand<T>(id, ...args);
        }
        throw new Error(`命令 "${id}" 未注册`);
      },
      getCommands(): string[] {
        if (provider) {
          return provider.getCommands();
        }
        return [];
      },
    };
  }

  /**
   * 创建编辑器 API
   */
  private createEditorAPI(): EditorAPI {
    const provider = this.editorProvider;

    return {
      getContent(): string {
        return provider?.getContent() ?? '';
      },
      setContent(content: string): void {
        provider?.setContent(content);
      },
      getSelection(): string {
        return provider?.getSelection() ?? '';
      },
      replaceSelection(text: string): void {
        provider?.replaceSelection(text);
      },
      insertText(text: string, position?: number): void {
        provider?.insertText(text, position);
      },
      getCursorPosition(): { line: number; column: number } {
        return provider?.getCursorPosition() ?? { line: 1, column: 1 };
      },
      setCursorPosition(line: number, column: number): void {
        provider?.setCursorPosition(line, column);
      },
      registerExtension(extension: unknown): Disposable {
        if (provider) {
          return provider.registerExtension(extension);
        }
        return createDisposable(() => {});
      },
      getFileType(): string {
        return provider?.getFileType() ?? 'markdown';
      },
      supportsMath(): boolean {
        return provider?.supportsMath() ?? true;
      },
    };
  }

  /**
   * 创建 UI API
   */
  private createUIAPI(): UIAPI {
    const provider = this.uiProvider;

    return {
      showMessage(message: string, type?: 'info' | 'warning' | 'error'): void {
        provider?.showMessage(message, type);
      },
      async showInput(options: {
        prompt?: string;
        placeholder?: string;
        value?: string;
      }): Promise<string | undefined> {
        return provider?.showInput(options);
      },
      async showQuickPick(
        items: string[],
        options?: { placeholder?: string }
      ): Promise<string | undefined> {
        return provider?.showQuickPick(items, options);
      },
      async showConfirm(message: string): Promise<boolean> {
        return provider?.showConfirm(message) ?? false;
      },
      registerSidebarView(id: string, component: unknown): Disposable {
        if (provider) {
          return provider.registerSidebarView(id, component);
        }
        return createDisposable(() => {});
      },
      registerToolbarButton(button: unknown, handler: () => void): Disposable {
        if (provider) {
          return provider.registerToolbarButton(button, handler);
        }
        return createDisposable(() => {});
      },
    };
  }

  /**
   * 日志输出
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log('[PluginManager]', message);
    }
  }

  // ================================
  // 清理
  // ================================

  /**
   * 销毁管理器
   */
  async dispose(): Promise<void> {
    await this.unloadAll();
    this.eventListeners.clear();
    this.registry.clear();
  }
}

// ================================
// 提供者接口
// ================================

/** 存储提供者接口 */
export interface StorageProvider {
  get<T>(key: string, defaultValue?: T): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(prefix: string): Promise<void>;
  keys(prefix: string): string[];
}

/** 命令提供者接口 */
export interface CommandProvider {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable;
  executeCommand<T>(id: string, ...args: unknown[]): Promise<T>;
  getCommands(): string[];
}

/** 编辑器提供者接口 */
export interface EditorProvider {
  getContent(): string;
  setContent(content: string): void;
  getSelection(): string;
  replaceSelection(text: string): void;
  insertText(text: string, position?: number): void;
  getCursorPosition(): { line: number; column: number };
  setCursorPosition(line: number, column: number): void;
  registerExtension(extension: unknown): Disposable;
  getFileType(): string;
  supportsMath(): boolean;
}

/** UI 提供者接口 */
export interface UIProvider {
  showMessage(message: string, type?: 'info' | 'warning' | 'error'): void;
  showInput(options: {
    prompt?: string;
    placeholder?: string;
    value?: string;
  }): Promise<string | undefined>;
  showQuickPick(items: string[], options?: { placeholder?: string }): Promise<string | undefined>;
  showConfirm(message: string): Promise<boolean>;
  registerSidebarView(id: string, component: unknown): Disposable;
  registerToolbarButton(button: unknown, handler: () => void): Disposable;
}

// ================================
// 事件监听器类型
// ================================

/** 插件事件监听器 */
export type PluginEventListener = (event: PluginEvent) => void;

// ================================
// 工厂函数
// ================================

/**
 * 创建插件管理器
 */
export function createPluginManager(config?: PluginManagerConfig): PluginManager {
  return new PluginManager(config);
}

// ================================
// 导出
// ================================

export { PluginManager as default };
