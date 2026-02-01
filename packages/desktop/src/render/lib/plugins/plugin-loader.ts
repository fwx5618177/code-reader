// ================================
// 插件加载器实现
// 负责插件的加载、激活、停用和卸载
// 集成沙箱系统提供安全隔离
// ================================

import type {
  Disposable,
  PluginContext,
  PluginFactory,
  PluginId,
  PluginInstance,
  PluginLoadResult,
  PluginManifest,
  PluginSource,
  PluginVersion,
  Logger,
  StorageAPI,
  CommandAPI,
  EditorAPI,
  UIAPI,
} from './types';
import { PluginState, PluginPriority, PluginEventType } from './types';
import { PluginEventEmitter, createDisposable, DisposableStore } from './event-emitter';
import { ExtensionRegistry } from './extension-registry';
import { getEditorBridge } from './editor-bridge';
import {
  PluginSandbox,
  createPluginSandbox,
  type SandboxConfig,
  type PermissionPolicy,
  Permission,
} from './sandbox';

// ================================
// 类型定义
// ================================

/** 插件加载器配置 */
export interface PluginLoaderConfig {
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 最大并行加载数 */
  maxConcurrentLoads?: number;
  /** 加载超时时间（毫秒） */
  loadTimeout?: number;
  /** 激活超时时间（毫秒） */
  activationTimeout?: number;
  /** 是否自动激活插件 */
  autoActivate?: boolean;
  /** 严格模式（依赖检查等） */
  strictMode?: boolean;
  /** 是否启用沙箱隔离 */
  enableSandbox?: boolean;
  /** 沙箱配置 */
  sandboxConfig?: Partial<SandboxConfig>;
}

/** 默认配置 */
const DEFAULT_CONFIG: Required<Omit<PluginLoaderConfig, 'sandboxConfig'>> & {
  sandboxConfig?: Partial<SandboxConfig>;
} = {
  debug: false,
  maxConcurrentLoads: 5,
  loadTimeout: 10000,
  activationTimeout: 5000,
  autoActivate: true,
  strictMode: false,
  enableSandbox: true,
  sandboxConfig: undefined,
};

// ================================
// 版本比较工具
// ================================

/**
 * 解析语义化版本号
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * 比较两个版本号
 * @returns -1: a < b, 0: a === b, 1: a > b
 */
function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  if (!versionA || !versionB) return 0;

  if (versionA.major !== versionB.major) {
    return versionA.major < versionB.major ? -1 : 1;
  }
  if (versionA.minor !== versionB.minor) {
    return versionA.minor < versionB.minor ? -1 : 1;
  }
  if (versionA.patch !== versionB.patch) {
    return versionA.patch < versionB.patch ? -1 : 1;
  }

  return 0;
}

/**
 * 检查版本是否满足范围要求
 * 支持简化的 semver 范围：^1.0.0, ~1.0.0, >=1.0.0, 1.0.0
 */
function satisfiesVersion(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;

  // 精确匹配
  if (/^\d+\.\d+\.\d+$/.test(range)) {
    return compareVersions(version, range) === 0;
  }

  // ^x.y.z - 兼容性版本（主版本号相同）
  if (range.startsWith('^')) {
    const rangeVersion = parseVersion(range.slice(1));
    if (!rangeVersion) return false;

    if (parsed.major !== rangeVersion.major) return false;
    if (parsed.major === 0) {
      // 0.x.x 版本，次版本号也必须相同
      return parsed.minor === rangeVersion.minor && parsed.patch >= rangeVersion.patch;
    }
    return compareVersions(version, range.slice(1)) >= 0;
  }

  // ~x.y.z - 近似版本（主版本号和次版本号相同）
  if (range.startsWith('~')) {
    const rangeVersion = parseVersion(range.slice(1));
    if (!rangeVersion) return false;

    return (
      parsed.major === rangeVersion.major &&
      parsed.minor === rangeVersion.minor &&
      parsed.patch >= rangeVersion.patch
    );
  }

  // >=x.y.z
  if (range.startsWith('>=')) {
    return compareVersions(version, range.slice(2)) >= 0;
  }

  // >x.y.z
  if (range.startsWith('>')) {
    return compareVersions(version, range.slice(1)) > 0;
  }

  // <=x.y.z
  if (range.startsWith('<=')) {
    return compareVersions(version, range.slice(2)) <= 0;
  }

  // <x.y.z
  if (range.startsWith('<')) {
    return compareVersions(version, range.slice(1)) < 0;
  }

  // 默认精确匹配
  return compareVersions(version, range) === 0;
}

// ================================
// 日志记录器实现
// ================================

/**
 * 创建插件专用日志记录器
 */
function createLogger(pluginId: PluginId, debug: boolean): Logger {
  const prefix = `[插件:${pluginId}]`;

  return {
    debug(message: string, ...args: unknown[]): void {
      if (debug) {
        console.debug(prefix, message, ...args);
      }
    },
    info(message: string, ...args: unknown[]): void {
      console.info(prefix, message, ...args);
    },
    warn(message: string, ...args: unknown[]): void {
      console.warn(prefix, message, ...args);
    },
    error(message: string, ...args: unknown[]): void {
      console.error(prefix, message, ...args);
    },
  };
}

// ================================
// 存储 API 实现
// ================================

/**
 * 创建插件存储 API
 */
function createStorageAPI(pluginId: PluginId, global: boolean = false): StorageAPI {
  const storageKey = global ? 'plugin-global-storage' : `plugin-storage:${pluginId}`;

  const getStorage = (): Record<string, unknown> => {
    try {
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  };

  const saveStorage = (data: Record<string, unknown>): void => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (error) {
      console.error(`插件存储保存失败: ${pluginId}`, error);
    }
  };

  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const storage = getStorage();
      return key in storage ? (storage[key] as T) : defaultValue;
    },

    async set<T>(key: string, value: T): Promise<void> {
      const storage = getStorage();
      storage[key] = value;
      saveStorage(storage);
    },

    async delete(key: string): Promise<void> {
      const storage = getStorage();
      delete storage[key];
      saveStorage(storage);
    },

    async clear(): Promise<void> {
      localStorage.removeItem(storageKey);
    },

    keys(): string[] {
      return Object.keys(getStorage());
    },
  };
}

// ================================
// 插件加载器类
// ================================

/**
 * 插件加载器
 * 负责管理插件的完整生命周期
 * 集成沙箱系统提供安全隔离
 */
export class PluginLoader {
  /** 单例实例 */
  private static instance: PluginLoader | null = null;

  /** 配置 */
  private config: Required<Omit<PluginLoaderConfig, 'sandboxConfig'>> & {
    sandboxConfig?: Partial<SandboxConfig>;
  };

  /** 插件实例映射 */
  private plugins: Map<PluginId, PluginInstance> = new Map();

  /** 插件工厂映射（用于延迟加载） */
  private factories: Map<PluginId, PluginFactory> = new Map();

  /** 事件发射器 */
  private eventEmitter: PluginEventEmitter;

  /** 扩展注册表 */
  private extensionRegistry: ExtensionRegistry;

  /** 命令注册表 */
  private commands: Map<string, (...args: unknown[]) => unknown> = new Map();

  /** 资源管理器 */
  private disposables: DisposableStore = new DisposableStore();

  /** 是否已初始化 */
  private initialized: boolean = false;

  /** 是否已销毁 */
  private destroyed: boolean = false;

  /** 正在加载的插件 ID 集合 */
  private loading: Set<PluginId> = new Set();

  /** 插件沙箱实例 */
  private sandbox: PluginSandbox | null = null;

  /** 权限确认处理器 */
  private permissionConfirmHandler?: (
    pluginId: string,
    permission: Permission,
    reason?: string
  ) => Promise<boolean>;

  /**
   * 构造函数
   */
  constructor(config?: PluginLoaderConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventEmitter = PluginEventEmitter.getInstance();
    this.extensionRegistry = ExtensionRegistry.getInstance();

    // 初始化沙箱（如果启用）
    if (this.config.enableSandbox) {
      this.sandbox = createPluginSandbox(this.config.sandboxConfig);

      // 设置资源违规处理器
      if (this.config.debug) {
        // 调试模式下记录所有违规
        console.debug('[PluginLoader] 沙箱系统已启用');
      }
    }
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: PluginLoaderConfig): PluginLoader {
    if (!PluginLoader.instance) {
      PluginLoader.instance = new PluginLoader(config);
    }
    return PluginLoader.instance;
  }

  /**
   * 重置单例（用于测试）
   */
  static resetInstance(): void {
    if (PluginLoader.instance) {
      PluginLoader.instance.destroy();
      PluginLoader.instance = null;
    }
  }

  // ================================
  // 初始化
  // ================================

  /**
   * 初始化加载器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 如果有预设的权限确认处理器，设置到沙箱
    if (this.sandbox && this.permissionConfirmHandler) {
      this.sandbox.setPermissionConfirmHandler(this.permissionConfirmHandler);
    }

    if (this.config.debug) {
      console.debug('[PluginLoader] 插件加载器已初始化', {
        sandboxEnabled: this.config.enableSandbox,
        strictMode: this.config.strictMode,
      });
    }

    this.initialized = true;

    if (this.config.debug) {
      console.info('[PluginLoader] 插件加载器已初始化');
    }
  }

  // ================================
  // 插件注册
  // ================================

  /**
   * 注册插件工厂
   * @param manifest 插件清单
   * @param factory 插件工厂函数
   * @param _source 插件来源（保留参数，用于未来扩展）
   */
  registerFactory(
    manifest: PluginManifest,
    factory: PluginFactory,
    _source: PluginSource = 'user' as PluginSource
  ): Disposable {
    if (this.destroyed) {
      throw new Error('PluginLoader: 加载器已销毁');
    }

    const pluginId = manifest.id;

    if (this.factories.has(pluginId) || this.plugins.has(pluginId)) {
      throw new Error(`PluginLoader: 插件 "${pluginId}" 已注册`);
    }

    this.factories.set(pluginId, factory);

    if (this.config.debug) {
      console.debug(`[PluginLoader] 已注册插件工厂: ${pluginId}`);
    }

    return createDisposable(() => {
      this.factories.delete(pluginId);
    });
  }

  // ================================
  // 插件加载
  // ================================

  /**
   * 加载插件
   * @param manifest 插件清单
   * @param factory 插件工厂函数
   * @param source 插件来源
   */
  async load(
    manifest: PluginManifest,
    factory: PluginFactory,
    _source: PluginSource = 'user' as PluginSource
  ): Promise<PluginLoadResult> {
    const pluginId = manifest.id;
    const startTime = performance.now();

    if (this.destroyed) {
      return {
        success: false,
        pluginId,
        error: new Error('PluginLoader: 加载器已销毁'),
        loadTime: 0,
      };
    }

    // 检查是否已加载
    if (this.plugins.has(pluginId)) {
      return {
        success: false,
        pluginId,
        error: new Error(`插件 "${pluginId}" 已加载`),
        loadTime: 0,
      };
    }

    // 检查是否正在加载
    if (this.loading.has(pluginId)) {
      return {
        success: false,
        pluginId,
        error: new Error(`插件 "${pluginId}" 正在加载中`),
        loadTime: 0,
      };
    }

    this.loading.add(pluginId);

    try {
      // 检查依赖
      if (this.config.strictMode && manifest.dependencies) {
        for (const dep of manifest.dependencies) {
          if (!dep.optional) {
            const depPlugin = this.plugins.get(dep.id);
            if (!depPlugin) {
              throw new Error(`缺少依赖插件: ${dep.id}`);
            }

            const depVersion = depPlugin.plugin.manifest.version;
            if (!satisfiesVersion(depVersion, dep.version)) {
              throw new Error(
                `依赖插件 ${dep.id} 版本不兼容: 需要 ${dep.version}, 实际 ${depVersion}`
              );
            }
          }
        }
      }

      // 创建插件实例
      const plugin = factory();

      // 验证插件
      if (!plugin.manifest || !plugin.activate) {
        throw new Error('无效的插件: 缺少 manifest 或 activate 方法');
      }

      // 创建插件上下文
      const context = this.createPluginContext(pluginId, manifest.version);

      // 创建插件实例信息
      const instance: PluginInstance = {
        plugin,
        context,
        state: PluginState.Loaded,
        source: _source,
        loadedAt: Date.now(),
      };

      this.plugins.set(pluginId, instance);

      // 发送加载事件
      this.eventEmitter.emitPluginEvent({
        type: PluginEventType.Loaded,
        pluginId,
        timestamp: Date.now(),
        manifest,
      });

      const loadTime = performance.now() - startTime;

      if (this.config.debug) {
        console.debug(`[PluginLoader] 插件加载完成: ${pluginId} (${loadTime.toFixed(2)}ms)`);
      }

      // 自动激活
      if (this.config.autoActivate) {
        await this.activate(pluginId);
      }

      return {
        success: true,
        pluginId,
        loadTime,
      };
    } catch (error) {
      const loadTime = performance.now() - startTime;

      // 发送错误事件
      this.eventEmitter.emitPluginEvent({
        type: PluginEventType.Error,
        pluginId,
        timestamp: Date.now(),
        error: error as Error,
      });

      return {
        success: false,
        pluginId,
        error: error as Error,
        loadTime,
      };
    } finally {
      this.loading.delete(pluginId);
    }
  }

  /**
   * 批量加载插件
   */
  async loadMany(
    plugins: Array<{
      manifest: PluginManifest;
      factory: PluginFactory;
      source?: PluginSource;
    }>
  ): Promise<PluginLoadResult[]> {
    // 按优先级排序
    const sorted = [...plugins].sort((a, b) => {
      const priorityA = a.manifest.priority ?? PluginPriority.Normal;
      const priorityB = b.manifest.priority ?? PluginPriority.Normal;
      return priorityB - priorityA;
    });

    const results: PluginLoadResult[] = [];

    // 分批加载
    for (let i = 0; i < sorted.length; i += this.config.maxConcurrentLoads) {
      const batch = sorted.slice(i, i + this.config.maxConcurrentLoads);
      const batchResults = await Promise.all(
        batch.map((p) => this.load(p.manifest, p.factory, p.source))
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
   * 如果启用沙箱，在沙箱环境中执行激活
   */
  async activate(pluginId: PluginId): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      console.error(`[PluginLoader] 插件不存在: ${pluginId}`);
      return false;
    }

    if (instance.state === PluginState.Active) {
      return true;
    }

    if (instance.state !== PluginState.Loaded && instance.state !== PluginState.Inactive) {
      console.error(`[PluginLoader] 插件状态无效，无法激活: ${pluginId} (${instance.state})`);
      return false;
    }

    try {
      // 更新状态
      this.updatePluginState(pluginId, PluginState.Activating);

      let api: unknown;

      // 如果启用沙箱，在沙箱中执行激活
      if (this.sandbox && this.config.enableSandbox) {
        api = await this.sandbox.executeInSandbox(
          pluginId,
          async () => {
            return await Promise.race([
              Promise.resolve(instance.plugin.activate(instance.context)),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('激活超时')), this.config.activationTimeout)
              ),
            ]);
          },
          this.config.activationTimeout
        );
      } else {
        // 直接调用激活方法
        api = await Promise.race([
          Promise.resolve(instance.plugin.activate(instance.context)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('激活超时')), this.config.activationTimeout)
          ),
        ]);
      }

      // 保存 API
      instance.api = api;
      instance.activatedAt = Date.now();

      // 更新状态
      this.updatePluginState(pluginId, PluginState.Active);

      // 发送激活事件
      this.eventEmitter.emitPluginEvent({
        type: PluginEventType.Activated,
        pluginId,
        timestamp: Date.now(),
      });

      if (this.config.debug) {
        console.debug(`[PluginLoader] 插件激活完成: ${pluginId}`, {
          sandboxed: this.config.enableSandbox,
        });
      }

      return true;
    } catch (error) {
      console.error(`[PluginLoader] 插件激活失败: ${pluginId}`, error);

      this.updatePluginState(pluginId, PluginState.Error);

      this.eventEmitter.emitPluginEvent({
        type: PluginEventType.Error,
        pluginId,
        timestamp: Date.now(),
        error: error as Error,
      });

      return false;
    }
  }

  /**
   * 批量激活插件
   */
  async activateMany(pluginIds: PluginId[]): Promise<Map<PluginId, boolean>> {
    const results = new Map<PluginId, boolean>();

    for (const pluginId of pluginIds) {
      const success = await this.activate(pluginId);
      results.set(pluginId, success);
    }

    return results;
  }

  // ================================
  // 插件停用
  // ================================

  /**
   * 停用插件
   */
  async deactivate(pluginId: PluginId): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      console.error(`[PluginLoader] 插件不存在: ${pluginId}`);
      return false;
    }

    if (instance.state !== PluginState.Active) {
      return true;
    }

    try {
      // 更新状态
      this.updatePluginState(pluginId, PluginState.Deactivating);

      // 调用停用方法
      if (instance.plugin.deactivate) {
        await Promise.resolve(instance.plugin.deactivate());
      }

      // 清理订阅
      for (const subscription of instance.context.subscriptions) {
        try {
          subscription.dispose();
        } catch (error) {
          console.error(`[PluginLoader] 清理订阅失败: ${pluginId}`, error);
        }
      }
      instance.context.subscriptions.length = 0;

      // 清理扩展注册
      this.extensionRegistry.unregisterAllByPlugin(pluginId);

      // 清理沙箱状态（如果启用）
      if (this.sandbox && this.config.enableSandbox) {
        this.sandbox.destroySandbox(pluginId);
      }

      // 更新状态
      this.updatePluginState(pluginId, PluginState.Inactive);

      // 发送停用事件
      this.eventEmitter.emitPluginEvent({
        type: PluginEventType.Deactivated,
        pluginId,
        timestamp: Date.now(),
      });

      if (this.config.debug) {
        console.debug(`[PluginLoader] 插件停用完成: ${pluginId}`);
      }

      return true;
    } catch (error) {
      console.error(`[PluginLoader] 插件停用失败: ${pluginId}`, error);

      this.updatePluginState(pluginId, PluginState.Error);

      return false;
    }
  }

  // ================================
  // 插件卸载
  // ================================

  /**
   * 卸载插件
   */
  async unload(pluginId: PluginId): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return true;
    }

    // 先停用
    if (instance.state === PluginState.Active) {
      await this.deactivate(pluginId);
    }

    // 移除实例
    this.plugins.delete(pluginId);

    // 发送卸载事件
    this.eventEmitter.emitPluginEvent({
      type: PluginEventType.Unloaded,
      pluginId,
      timestamp: Date.now(),
    });

    if (this.config.debug) {
      console.debug(`[PluginLoader] 插件卸载完成: ${pluginId}`);
    }

    return true;
  }

  /**
   * 卸载所有插件
   */
  async unloadAll(): Promise<void> {
    const pluginIds = Array.from(this.plugins.keys());

    for (const pluginId of pluginIds) {
      await this.unload(pluginId);
    }
  }

  // ================================
  // 插件查询
  // ================================

  /**
   * 获取插件实例
   */
  getPlugin(pluginId: PluginId): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取插件 API
   */
  getPluginAPI<T>(pluginId: PluginId): T | undefined {
    const instance = this.plugins.get(pluginId);
    return instance?.api as T | undefined;
  }

  /**
   * 获取所有插件 ID
   */
  getPluginIds(): PluginId[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * 获取所有插件实例
   */
  getAllPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 检查插件是否已加载
   */
  isLoaded(pluginId: PluginId): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * 检查插件是否已激活
   */
  isActive(pluginId: PluginId): boolean {
    const instance = this.plugins.get(pluginId);
    return instance?.state === PluginState.Active;
  }

  /**
   * 获取插件状态
   */
  getPluginState(pluginId: PluginId): PluginState | undefined {
    return this.plugins.get(pluginId)?.state;
  }

  // ================================
  // 命令管理
  // ================================

  /**
   * 注册命令
   */
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
    if (this.commands.has(id)) {
      throw new Error(`命令 "${id}" 已注册`);
    }

    this.commands.set(id, handler);

    return createDisposable(() => {
      this.commands.delete(id);
    });
  }

  /**
   * 执行命令
   */
  async executeCommand<T>(id: string, ...args: unknown[]): Promise<T> {
    const handler = this.commands.get(id);
    if (!handler) {
      throw new Error(`命令 "${id}" 不存在`);
    }

    return (await Promise.resolve(handler(...args))) as T;
  }

  /**
   * 获取所有命令
   */
  getCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 设置权限确认处理器
   * 用于在插件请求敏感权限时弹出确认对话框
   */
  setPermissionConfirmHandler(
    handler: (pluginId: string, permission: Permission, reason?: string) => Promise<boolean>
  ): void {
    this.permissionConfirmHandler = handler;
    if (this.sandbox) {
      this.sandbox.setPermissionConfirmHandler(handler);
    }
  }

  /**
   * 获取插件沙箱状态
   */
  getSandboxState(pluginId: PluginId) {
    return this.sandbox?.getSandboxState(pluginId);
  }

  /**
   * 获取插件资源使用情况
   */
  getPluginResourceUsage(pluginId: PluginId) {
    return this.sandbox?.getResourceUsage(pluginId);
  }

  /**
   * 获取插件安全违规记录
   */
  getPluginViolations(pluginId: PluginId) {
    return this.sandbox?.getViolations(pluginId);
  }

  /**
   * 创建插件上下文
   * 如果启用沙箱，则返回沙箱化的上下文
   */
  private createPluginContext(pluginId: PluginId, version: PluginVersion): PluginContext {
    const self = this;
    const subscriptions: Disposable[] = [];

    // 命令 API（始终通过加载器管理）
    const commandAPI: CommandAPI = {
      registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
        const prefixedId = `${pluginId}.${id}`;
        const disposable = self.registerCommand(prefixedId, handler);
        subscriptions.push(disposable);
        return disposable;
      },
      async executeCommand<T>(id: string, ...args: unknown[]): Promise<T> {
        return self.executeCommand<T>(id, ...args);
      },
      getCommands(): string[] {
        return self.getCommands();
      },
    };

    // 如果启用沙箱，使用沙箱化的 API
    if (this.sandbox && this.config.enableSandbox) {
      // 获取沙箱化的上下文（包含安全代理的 editor、ui、storage API）
      const sandboxedContext = this.sandbox.createSandboxedContext(pluginId);

      return {
        pluginId,
        version,
        state: PluginState.Loaded,
        logger: createLogger(pluginId, this.config.debug),
        storage: sandboxedContext.storage,
        globalStorage: sandboxedContext.globalStorage,
        commands: sandboxedContext.commands,
        editor: sandboxedContext.editor,
        ui: sandboxedContext.ui,
        subscriptions,
        getPlugin<T>(id: PluginId): T | undefined {
          return self.getPluginAPI<T>(id);
        },
      };
    }

    // 无沙箱模式：直接连接到编辑器桥接
    const bridge = getEditorBridge();
    const editorAPI: EditorAPI = bridge.createEditorAPI();
    const uiAPI: UIAPI = bridge.createUIAPI();

    return {
      pluginId,
      version,
      state: PluginState.Loaded,
      logger: createLogger(pluginId, this.config.debug),
      storage: createStorageAPI(pluginId, false),
      globalStorage: createStorageAPI(pluginId, true),
      commands: commandAPI,
      editor: editorAPI,
      ui: uiAPI,
      subscriptions,
      getPlugin<T>(id: PluginId): T | undefined {
        return self.getPluginAPI<T>(id);
      },
    };
  }

  /**
   * 更新插件状态
   */
  private updatePluginState(pluginId: PluginId, newState: PluginState): void {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;

    const previousState = instance.state;
    instance.state = newState;

    // 发送状态变更事件
    this.eventEmitter.emitPluginEvent({
      type: PluginEventType.StateChanged,
      pluginId,
      timestamp: Date.now(),
      previousState,
      currentState: newState,
    });
  }

  // ================================
  // 生命周期
  // ================================

  /**
   * 获取加载器统计信息
   */
  getStats(): {
    totalPlugins: number;
    activePlugins: number;
    inactivePlugins: number;
    errorPlugins: number;
    commandCount: number;
  } {
    let active = 0;
    let inactive = 0;
    let error = 0;

    for (const instance of this.plugins.values()) {
      switch (instance.state) {
        case PluginState.Active:
          active++;
          break;
        case PluginState.Inactive:
        case PluginState.Loaded:
          inactive++;
          break;
        case PluginState.Error:
          error++;
          break;
      }
    }

    return {
      totalPlugins: this.plugins.size,
      activePlugins: active,
      inactivePlugins: inactive,
      errorPlugins: error,
      commandCount: this.commands.size,
    };
  }

  /**
   * 销毁加载器
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;

    this.destroyed = true;

    // 卸载所有插件
    await this.unloadAll();

    // 清理沙箱（如果启用）
    if (this.sandbox) {
      // 销毁所有插件的沙箱状态
      for (const pluginId of this.plugins.keys()) {
        this.sandbox.destroySandbox(pluginId);
      }
      this.sandbox = null;
    }

    // 清理资源
    this.factories.clear();
    this.commands.clear();
    this.disposables.dispose();
    this.permissionConfirmHandler = undefined;

    if (this.config.debug) {
      console.info('[PluginLoader] 插件加载器已销毁');
    }
  }

  /**
   * 检查是否已销毁
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建插件加载器实例
 */
export function createPluginLoader(config?: PluginLoaderConfig): PluginLoader {
  return PluginLoader.getInstance(config);
}
