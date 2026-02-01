// ================================
// 插件沙箱模块
// 提供插件隔离执行环境
// ================================

import type {
  PluginId,
  PluginContext,
  Logger,
  StorageAPI,
  CommandAPI,
  EditorAPI,
  UIAPI,
  Disposable,
  PluginState,
  PluginVersion,
} from '../types';
import { createDisposable, PluginPriority } from '../types';

// ================================
// 沙箱配置
// ================================

/** 沙箱配置 */
export interface SandboxConfig {
  /** 插件 ID */
  pluginId: PluginId;
  /** 插件版本 */
  version: PluginVersion;
  /** 是否允许网络访问 */
  allowNetwork?: boolean;
  /** 是否允许文件系统访问 */
  allowFileSystem?: boolean;
  /** 是否允许执行命令 */
  allowCommands?: boolean;
  /** 允许访问的 API 列表 */
  allowedAPIs?: string[];
  /** 执行超时时间（毫秒） */
  timeout?: number;
  /** 内存限制（字节） */
  memoryLimit?: number;
  /** 日志级别 */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/** 默认沙箱配置 */
export const DEFAULT_SANDBOX_CONFIG: Required<Omit<SandboxConfig, 'pluginId' | 'version'>> = {
  allowNetwork: false,
  allowFileSystem: false,
  allowCommands: true,
  allowedAPIs: ['storage', 'commands', 'editor', 'ui', 'logger'],
  timeout: 30000,
  memoryLimit: 50 * 1024 * 1024, // 50MB
  logLevel: 'info',
};

// ================================
// 沙箱日志记录器
// ================================

/**
 * 创建沙箱日志记录器
 */
function createSandboxLogger(pluginId: PluginId, logLevel: string): Logger {
  const prefix = `[Plugin:${pluginId}]`;
  const levels = ['debug', 'info', 'warn', 'error'];
  const minLevel = levels.indexOf(logLevel);

  const shouldLog = (level: string): boolean => {
    return levels.indexOf(level) >= minLevel;
  };

  return {
    debug(message: string, ...args: unknown[]): void {
      if (shouldLog('debug')) {
        console.debug(prefix, message, ...args);
      }
    },
    info(message: string, ...args: unknown[]): void {
      if (shouldLog('info')) {
        console.info(prefix, message, ...args);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      if (shouldLog('warn')) {
        console.warn(prefix, message, ...args);
      }
    },
    error(message: string, ...args: unknown[]): void {
      if (shouldLog('error')) {
        console.error(prefix, message, ...args);
      }
    },
  };
}

// ================================
// 沙箱存储
// ================================

/**
 * 创建沙箱存储
 */
function createSandboxStorage(pluginId: PluginId, isGlobal = false): StorageAPI {
  const storageKey = isGlobal ? 'plugin-global-storage' : `plugin-storage-${pluginId}`;
  let cache: Record<string, unknown> = {};

  // 从 localStorage 加载
  const load = (): void => {
    try {
      const data = localStorage.getItem(storageKey);
      if (data) {
        cache = JSON.parse(data);
      }
    } catch {
      cache = {};
    }
  };

  // 保存到 localStorage
  const save = (): void => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cache));
    } catch (error) {
      console.error(`[SandboxStorage] 保存失败: ${error}`);
    }
  };

  // 初始化加载
  load();

  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const value = cache[key];
      return value !== undefined ? (value as T) : defaultValue;
    },

    async set<T>(key: string, value: T): Promise<void> {
      cache[key] = value;
      save();
    },

    async delete(key: string): Promise<void> {
      delete cache[key];
      save();
    },

    async clear(): Promise<void> {
      cache = {};
      save();
    },

    keys(): string[] {
      return Object.keys(cache);
    },
  };
}

// ================================
// 沙箱命令 API
// ================================

/** 命令处理器类型 */
type CommandHandler = (...args: unknown[]) => unknown;

/**
 * 创建沙箱命令 API
 */
function createSandboxCommandAPI(
  pluginId: PluginId,
  globalCommands: Map<string, CommandHandler>
): CommandAPI {
  /** 插件注册的命令 */
  const pluginCommands = new Map<string, CommandHandler>();

  return {
    registerCommand(id: string, handler: CommandHandler): Disposable {
      const fullId = `${pluginId}.${id}`;

      if (globalCommands.has(fullId) || pluginCommands.has(fullId)) {
        throw new Error(`命令 "${fullId}" 已存在`);
      }

      pluginCommands.set(fullId, handler);
      globalCommands.set(fullId, handler);

      return createDisposable(() => {
        pluginCommands.delete(fullId);
        globalCommands.delete(fullId);
      });
    },

    async executeCommand<T>(id: string, ...args: unknown[]): Promise<T> {
      // 尝试完整 ID
      let handler = globalCommands.get(id);

      // 尝试插件前缀 ID
      if (!handler) {
        handler = globalCommands.get(`${pluginId}.${id}`);
      }

      if (!handler) {
        throw new Error(`命令 "${id}" 不存在`);
      }

      const result = await Promise.resolve(handler(...args));
      return result as T;
    },

    getCommands(): string[] {
      return Array.from(globalCommands.keys());
    },
  };
}

// ================================
// 沙箱编辑器 API
// ================================

/** 编辑器代理接口 */
export interface EditorProxy {
  getContent(): string;
  setContent(content: string): void;
  getSelection(): string;
  replaceSelection(text: string): void;
  insertText(text: string, position?: number): void;
  getCursorPosition(): { line: number; column: number };
  setCursorPosition(line: number, column: number): void;
  getFileType(): string;
  supportsMath(): boolean;
}

/**
 * 创建沙箱编辑器 API
 */
function createSandboxEditorAPI(editorProxy?: EditorProxy): EditorAPI {
  const extensions: unknown[] = [];

  // 如果没有代理，返回空操作
  if (!editorProxy) {
    return {
      getContent: () => '',
      setContent: () => {},
      getSelection: () => '',
      replaceSelection: () => {},
      insertText: () => {},
      getCursorPosition: () => ({ line: 1, column: 1 }),
      setCursorPosition: () => {},
      registerExtension: (ext: unknown) => {
        extensions.push(ext);
        return createDisposable(() => {
          const index = extensions.indexOf(ext);
          if (index !== -1) extensions.splice(index, 1);
        });
      },
      getFileType: () => 'markdown',
      supportsMath: () => true,
    };
  }

  return {
    getContent: () => editorProxy.getContent(),
    setContent: (content: string) => editorProxy.setContent(content),
    getSelection: () => editorProxy.getSelection(),
    replaceSelection: (text: string) => editorProxy.replaceSelection(text),
    insertText: (text: string, position?: number) => editorProxy.insertText(text, position),
    getCursorPosition: () => editorProxy.getCursorPosition(),
    setCursorPosition: (line: number, column: number) =>
      editorProxy.setCursorPosition(line, column),
    registerExtension: (extension: unknown) => {
      extensions.push(extension);
      return createDisposable(() => {
        const index = extensions.indexOf(extension);
        if (index !== -1) extensions.splice(index, 1);
      });
    },
    getFileType: () => editorProxy.getFileType(),
    supportsMath: () => editorProxy.supportsMath(),
  };
}

// ================================
// 沙箱 UI API
// ================================

/** UI 代理接口 */
export interface UIProxy {
  showMessage(message: string, type?: 'info' | 'warning' | 'error'): void;
  showInput(options: { prompt?: string; placeholder?: string; value?: string }): Promise<
    string | undefined
  >;
  showQuickPick(items: string[], options?: { placeholder?: string }): Promise<string | undefined>;
  showConfirm(message: string): Promise<boolean>;
}

/**
 * 创建沙箱 UI API
 */
function createSandboxUIAPI(uiProxy?: UIProxy): UIAPI {
  const sidebarViews = new Map<string, unknown>();
  const toolbarButtons = new Map<string, () => void>();

  // 如果没有代理，返回基础实现
  if (!uiProxy) {
    return {
      showMessage: (message: string, type?: string) => {
        console.log(`[UI Message] [${type || 'info'}] ${message}`);
      },
      showInput: async () => undefined,
      showQuickPick: async () => undefined,
      showConfirm: async () => false,
      registerSidebarView: (id: string, component: unknown) => {
        sidebarViews.set(id, component);
        return createDisposable(() => {
          sidebarViews.delete(id);
        });
      },
      registerToolbarButton: (_button, handler: () => void) => {
        const id = `toolbar-${Date.now()}`;
        toolbarButtons.set(id, handler);
        return createDisposable(() => {
          toolbarButtons.delete(id);
        });
      },
    };
  }

  return {
    showMessage: (message: string, type?: 'info' | 'warning' | 'error') =>
      uiProxy.showMessage(message, type),
    showInput: (options) => uiProxy.showInput(options),
    showQuickPick: (items, options) => uiProxy.showQuickPick(items, options),
    showConfirm: (message) => uiProxy.showConfirm(message),
    registerSidebarView: (id: string, component: unknown) => {
      sidebarViews.set(id, component);
      return createDisposable(() => {
        sidebarViews.delete(id);
      });
    },
    registerToolbarButton: (_button, handler: () => void) => {
      const id = `toolbar-${Date.now()}`;
      toolbarButtons.set(id, handler);
      return createDisposable(() => {
        toolbarButtons.delete(id);
      });
    },
  };
}

// ================================
// 插件沙箱
// ================================

/** 沙箱依赖 */
export interface SandboxDependencies {
  /** 全局命令注册表 */
  globalCommands?: Map<string, CommandHandler>;
  /** 编辑器代理 */
  editorProxy?: EditorProxy;
  /** UI 代理 */
  uiProxy?: UIProxy;
  /** 获取其他插件 API 的函数 */
  getPluginAPI?: <T>(id: PluginId) => T | undefined;
}

/**
 * 插件沙箱
 * 提供插件隔离执行环境
 */
export class PluginSandbox {
  private config: Required<SandboxConfig>;
  private context: PluginContext | null = null;
  private subscriptions: Disposable[] = [];
  private state: PluginState;
  private deps: SandboxDependencies;

  constructor(config: SandboxConfig, deps: SandboxDependencies = {}) {
    this.config = {
      ...DEFAULT_SANDBOX_CONFIG,
      ...config,
    };
    this.state = 'unloaded' as PluginState;
    this.deps = deps;
  }

  /**
   * 获取插件 ID
   */
  getPluginId(): PluginId {
    return this.config.pluginId;
  }

  /**
   * 获取插件状态
   */
  getState(): PluginState {
    return this.state;
  }

  /**
   * 设置插件状态
   */
  setState(state: PluginState): void {
    this.state = state;
  }

  /**
   * 创建插件上下文
   */
  createContext(): PluginContext {
    const { pluginId, version, logLevel } = this.config;

    // 创建 API
    const logger = createSandboxLogger(pluginId, logLevel);
    const storage = createSandboxStorage(pluginId, false);
    const globalStorage = createSandboxStorage(pluginId, true);
    const commands = createSandboxCommandAPI(
      pluginId,
      this.deps.globalCommands || new Map()
    );
    const editor = createSandboxEditorAPI(this.deps.editorProxy);
    const ui = createSandboxUIAPI(this.deps.uiProxy);

    this.context = {
      pluginId,
      version,
      state: this.state,
      logger,
      storage,
      globalStorage,
      commands,
      editor,
      ui,
      subscriptions: this.subscriptions,
      getPlugin: <T>(id: PluginId): T | undefined => {
        if (this.deps.getPluginAPI) {
          return this.deps.getPluginAPI<T>(id);
        }
        return undefined;
      },
    };

    return this.context;
  }

  /**
   * 获取当前上下文
   */
  getContext(): PluginContext | null {
    return this.context;
  }

  /**
   * 执行带超时的函数
   */
  async executeWithTimeout<T>(fn: () => Promise<T> | T): Promise<T> {
    const { timeout } = this.config;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`插件执行超时 (${timeout}ms)`));
      }, timeout);

      Promise.resolve(fn())
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 清理沙箱资源
   */
  dispose(): void {
    // 清理订阅
    for (const subscription of this.subscriptions) {
      try {
        subscription.dispose();
      } catch (error) {
        console.error(`[PluginSandbox] 清理订阅失败: ${error}`);
      }
    }
    this.subscriptions = [];
    this.context = null;
    this.state = 'unloaded' as PluginState;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建插件沙箱
 */
export function createPluginSandbox(
  config: SandboxConfig,
  deps?: SandboxDependencies
): PluginSandbox {
  return new PluginSandbox(config, deps);
}

// ================================
// 导出
// ================================

export { PluginSandbox as default };
