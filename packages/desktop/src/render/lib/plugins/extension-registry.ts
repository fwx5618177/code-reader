// ================================
// 扩展点注册表实现
// 管理插件扩展点的注册、查询和生命周期
// ================================

import type {
  Disposable,
  ExtensionPoint,
  ExtensionPointType,
  ExtensionRegistration,
  PluginId,
} from './types';
import { createDisposable, DisposableStore } from './event-emitter';

// ================================
// 类型定义
// ================================

/** 扩展点变更事件 */
export interface ExtensionPointChangeEvent<T = unknown> {
  /** 扩展点 ID */
  extensionPointId: string;
  /** 变更类型 */
  changeType: 'added' | 'removed' | 'updated';
  /** 相关的扩展注册信息 */
  registration?: ExtensionRegistration<T>;
}

/** 扩展点查询选项 */
export interface ExtensionQueryOptions {
  /** 按插件 ID 过滤 */
  pluginId?: PluginId;
  /** 按扩展点类型过滤 */
  type?: ExtensionPointType;
  /** 是否按优先级排序（默认 true） */
  sortByPriority?: boolean;
}

/** 扩展点监听器 */
export type ExtensionPointListener<T = unknown> = (event: ExtensionPointChangeEvent<T>) => void;

// ================================
// 扩展点注册表类
// ================================

/**
 * 扩展点注册表
 * 负责管理所有扩展点的定义和扩展注册
 */
export class ExtensionRegistry {
  /** 单例实例 */
  private static instance: ExtensionRegistry | null = null;

  /** 扩展点定义映射 */
  private extensionPoints: Map<string, ExtensionPoint<unknown>> = new Map();

  /** 扩展注册映射（扩展点 ID -> 注册列表） */
  private registrations: Map<string, ExtensionRegistration<unknown>[]> = new Map();

  /** 插件到扩展的反向索引（插件 ID -> 扩展点 ID 集合） */
  private pluginExtensions: Map<PluginId, Set<string>> = new Map();

  /** 变更监听器 */
  private listeners: Map<string, Set<ExtensionPointListener<unknown>>> = new Map();

  /** 全局监听器（监听所有扩展点变更） */
  private globalListeners: Set<ExtensionPointListener<unknown>> = new Set();

  /** 资源管理器 */
  private disposables: DisposableStore = new DisposableStore();

  /** 是否已销毁 */
  private destroyed: boolean = false;

  /**
   * 获取单例实例
   */
  static getInstance(): ExtensionRegistry {
    if (!ExtensionRegistry.instance) {
      ExtensionRegistry.instance = new ExtensionRegistry();
    }
    return ExtensionRegistry.instance;
  }

  /**
   * 重置单例（用于测试）
   */
  static resetInstance(): void {
    if (ExtensionRegistry.instance) {
      ExtensionRegistry.instance.destroy();
      ExtensionRegistry.instance = null;
    }
  }

  // ================================
  // 扩展点定义管理
  // ================================

  /**
   * 定义扩展点
   * @param extensionPoint 扩展点定义
   * @returns Disposable 用于取消定义
   */
  defineExtensionPoint<T>(extensionPoint: ExtensionPoint<T>): Disposable {
    if (this.destroyed) {
      throw new Error('ExtensionRegistry: 注册表已销毁');
    }

    if (this.extensionPoints.has(extensionPoint.id)) {
      throw new Error(`ExtensionRegistry: 扩展点 "${extensionPoint.id}" 已存在`);
    }

    this.extensionPoints.set(extensionPoint.id, extensionPoint as ExtensionPoint<unknown>);
    this.registrations.set(extensionPoint.id, []);

    return createDisposable(() => {
      this.undefineExtensionPoint(extensionPoint.id);
    });
  }

  /**
   * 取消定义扩展点
   */
  undefineExtensionPoint(extensionPointId: string): void {
    // 先移除所有注册的扩展
    const registrations = this.registrations.get(extensionPointId);
    if (registrations) {
      for (const reg of [...registrations]) {
        this.unregisterExtension(extensionPointId, reg.pluginId);
      }
    }

    this.extensionPoints.delete(extensionPointId);
    this.registrations.delete(extensionPointId);
    this.listeners.delete(extensionPointId);
  }

  /**
   * 检查扩展点是否存在
   */
  hasExtensionPoint(extensionPointId: string): boolean {
    return this.extensionPoints.has(extensionPointId);
  }

  /**
   * 获取扩展点定义
   */
  getExtensionPoint<T>(extensionPointId: string): ExtensionPoint<T> | undefined {
    return this.extensionPoints.get(extensionPointId) as ExtensionPoint<T> | undefined;
  }

  /**
   * 获取所有扩展点
   */
  getAllExtensionPoints(): ExtensionPoint<unknown>[] {
    return Array.from(this.extensionPoints.values());
  }

  /**
   * 按类型获取扩展点
   */
  getExtensionPointsByType(type: ExtensionPointType): ExtensionPoint<unknown>[] {
    return this.getAllExtensionPoints().filter((ep) => ep.type === type);
  }

  // ================================
  // 扩展注册管理
  // ================================

  /**
   * 注册扩展
   * @param extensionPointId 扩展点 ID
   * @param pluginId 插件 ID
   * @param extension 扩展数据
   * @param priority 优先级
   * @returns Disposable 用于取消注册
   */
  registerExtension<T>(
    extensionPointId: string,
    pluginId: PluginId,
    extension: T,
    priority: number = 50
  ): Disposable {
    if (this.destroyed) {
      throw new Error('ExtensionRegistry: 注册表已销毁');
    }

    const extensionPoint = this.extensionPoints.get(extensionPointId);
    if (!extensionPoint) {
      throw new Error(`ExtensionRegistry: 扩展点 "${extensionPointId}" 不存在`);
    }

    // 验证扩展
    if (extensionPoint.validator) {
      if (!extensionPoint.validator(extension)) {
        throw new Error(`ExtensionRegistry: 扩展验证失败 (扩展点: ${extensionPointId})`);
      }
    }

    const registration: ExtensionRegistration<T> = {
      extensionPointId,
      pluginId,
      extension,
      priority,
    };

    // 添加到注册列表
    const registrations = this.registrations.get(extensionPointId)!;

    // 检查是否已存在相同插件的注册
    const existingIndex = registrations.findIndex((r) => r.pluginId === pluginId);
    if (existingIndex !== -1) {
      // 更新现有注册
      registrations[existingIndex] = registration as ExtensionRegistration<unknown>;
      this.notifyChange({
        extensionPointId,
        changeType: 'updated',
        registration: registration as ExtensionRegistration<unknown>,
      });
    } else {
      // 新增注册
      registrations.push(registration as ExtensionRegistration<unknown>);

      // 更新反向索引
      let pluginExtensionSet = this.pluginExtensions.get(pluginId);
      if (!pluginExtensionSet) {
        pluginExtensionSet = new Set();
        this.pluginExtensions.set(pluginId, pluginExtensionSet);
      }
      pluginExtensionSet.add(extensionPointId);

      this.notifyChange({
        extensionPointId,
        changeType: 'added',
        registration: registration as ExtensionRegistration<unknown>,
      });
    }

    // 按优先级排序（高优先级在前）
    registrations.sort((a, b) => b.priority - a.priority);

    return createDisposable(() => {
      this.unregisterExtension(extensionPointId, pluginId);
    });
  }

  /**
   * 取消注册扩展
   */
  unregisterExtension(extensionPointId: string, pluginId: PluginId): boolean {
    const registrations = this.registrations.get(extensionPointId);
    if (!registrations) return false;

    const index = registrations.findIndex((r) => r.pluginId === pluginId);
    if (index === -1) return false;

    const [removed] = registrations.splice(index, 1);

    // 更新反向索引
    const pluginExtensionSet = this.pluginExtensions.get(pluginId);
    if (pluginExtensionSet) {
      pluginExtensionSet.delete(extensionPointId);
      if (pluginExtensionSet.size === 0) {
        this.pluginExtensions.delete(pluginId);
      }
    }

    this.notifyChange({
      extensionPointId,
      changeType: 'removed',
      registration: removed,
    });

    return true;
  }

  /**
   * 取消插件的所有扩展注册
   */
  unregisterAllByPlugin(pluginId: PluginId): void {
    const extensionPointIds = this.pluginExtensions.get(pluginId);
    if (!extensionPointIds) return;

    // 复制集合以避免迭代时修改
    for (const extensionPointId of [...extensionPointIds]) {
      this.unregisterExtension(extensionPointId, pluginId);
    }
  }

  // ================================
  // 扩展查询
  // ================================

  /**
   * 获取扩展点的所有扩展
   */
  getExtensions<T>(extensionPointId: string, options?: ExtensionQueryOptions): T[] {
    const registrations = this.registrations.get(extensionPointId);
    if (!registrations) return [];

    let result = [...registrations];

    // 按插件 ID 过滤
    if (options?.pluginId) {
      result = result.filter((r) => r.pluginId === options.pluginId);
    }

    // 按优先级排序（默认启用）
    if (options?.sortByPriority !== false) {
      result.sort((a, b) => b.priority - a.priority);
    }

    return result.map((r) => r.extension as T);
  }

  /**
   * 获取扩展注册信息
   */
  getRegistrations<T>(
    extensionPointId: string,
    options?: ExtensionQueryOptions
  ): ExtensionRegistration<T>[] {
    const registrations = this.registrations.get(extensionPointId);
    if (!registrations) return [];

    let result = [...registrations];

    if (options?.pluginId) {
      result = result.filter((r) => r.pluginId === options.pluginId);
    }

    if (options?.sortByPriority !== false) {
      result.sort((a, b) => b.priority - a.priority);
    }

    return result as ExtensionRegistration<T>[];
  }

  /**
   * 获取特定插件的扩展
   */
  getPluginExtension<T>(extensionPointId: string, pluginId: PluginId): T | undefined {
    const registrations = this.registrations.get(extensionPointId);
    if (!registrations) return undefined;

    const registration = registrations.find((r) => r.pluginId === pluginId);
    return registration?.extension as T | undefined;
  }

  /**
   * 获取插件注册的所有扩展点 ID
   */
  getPluginExtensionPointIds(pluginId: PluginId): string[] {
    const extensionPointIds = this.pluginExtensions.get(pluginId);
    return extensionPointIds ? Array.from(extensionPointIds) : [];
  }

  /**
   * 获取扩展点的注册数量
   */
  getExtensionCount(extensionPointId: string): number {
    const registrations = this.registrations.get(extensionPointId);
    return registrations?.length ?? 0;
  }

  // ================================
  // 变更监听
  // ================================

  /**
   * 监听扩展点变更
   */
  onExtensionPointChange<T>(
    extensionPointId: string,
    listener: ExtensionPointListener<T>
  ): Disposable {
    let listeners = this.listeners.get(extensionPointId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(extensionPointId, listeners);
    }

    listeners.add(listener as ExtensionPointListener<unknown>);

    return createDisposable(() => {
      listeners!.delete(listener as ExtensionPointListener<unknown>);
      if (listeners!.size === 0) {
        this.listeners.delete(extensionPointId);
      }
    });
  }

  /**
   * 监听所有扩展点变更
   */
  onAnyExtensionPointChange(listener: ExtensionPointListener<unknown>): Disposable {
    this.globalListeners.add(listener);

    return createDisposable(() => {
      this.globalListeners.delete(listener);
    });
  }

  /**
   * 通知变更
   */
  private notifyChange(event: ExtensionPointChangeEvent<unknown>): void {
    // 通知特定扩展点的监听器
    const listeners = this.listeners.get(event.extensionPointId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('ExtensionRegistry: 监听器执行错误', error);
        }
      }
    }

    // 通知全局监听器
    for (const listener of this.globalListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('ExtensionRegistry: 全局监听器执行错误', error);
      }
    }
  }

  // ================================
  // 工具方法
  // ================================

  /**
   * 获取注册表统计信息
   */
  getStats(): {
    extensionPointCount: number;
    totalRegistrations: number;
    pluginCount: number;
    registrationsByType: Record<string, number>;
  } {
    const registrationsByType: Record<string, number> = {};

    for (const [id, regs] of this.registrations) {
      const ep = this.extensionPoints.get(id);
      if (ep) {
        const type = ep.type;
        registrationsByType[type] = (registrationsByType[type] || 0) + regs.length;
      }
    }

    let totalRegistrations = 0;
    for (const regs of this.registrations.values()) {
      totalRegistrations += regs.length;
    }

    return {
      extensionPointCount: this.extensionPoints.size,
      totalRegistrations,
      pluginCount: this.pluginExtensions.size,
      registrationsByType,
    };
  }

  /**
   * 清空所有注册
   */
  clear(): void {
    // 通知所有移除事件
    for (const [extensionPointId, registrations] of this.registrations) {
      for (const registration of registrations) {
        this.notifyChange({
          extensionPointId,
          changeType: 'removed',
          registration,
        });
      }
    }

    this.extensionPoints.clear();
    this.registrations.clear();
    this.pluginExtensions.clear();
  }

  /**
   * 销毁注册表
   */
  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.clear();
    this.listeners.clear();
    this.globalListeners.clear();
    this.disposables.dispose();
  }

  /**
   * 检查是否已销毁
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

// ================================
// 预定义扩展点
// ================================

/** 编辑器扩展点 ID */
export const EDITOR_EXTENSION_POINT = 'core.editor.extensions';

/** 解析器扩展点 ID */
export const PARSER_EXTENSION_POINT = 'core.parser.extensions';

/** 补全扩展点 ID */
export const AUTOCOMPLETE_EXTENSION_POINT = 'core.autocomplete.providers';

/** 命令扩展点 ID */
export const COMMAND_EXTENSION_POINT = 'core.commands';

/** 工具栏扩展点 ID */
export const TOOLBAR_EXTENSION_POINT = 'core.toolbar.items';

/** 侧边栏扩展点 ID */
export const SIDEBAR_EXTENSION_POINT = 'core.sidebar.views';

/** 主题扩展点 ID */
export const THEME_EXTENSION_POINT = 'core.themes';

/** 语言扩展点 ID */
export const LANGUAGE_EXTENSION_POINT = 'core.languages';

/** 快捷键扩展点 ID */
export const KEYBINDING_EXTENSION_POINT = 'core.keybindings';

/** 菜单扩展点 ID */
export const MENU_EXTENSION_POINT = 'core.menus';

/**
 * 初始化核心扩展点
 */
export function initializeCoreExtensionPoints(registry: ExtensionRegistry): Disposable[] {
  const disposables: Disposable[] = [];
  const { ExtensionPointType } = require('./types');

  // 编辑器扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: EDITOR_EXTENSION_POINT,
      type: ExtensionPointType.Editor,
      description: '编辑器扩展，用于扩展编辑器功能',
    })
  );

  // 解析器扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: PARSER_EXTENSION_POINT,
      type: ExtensionPointType.Parser,
      description: '解析器扩展，用于扩展内容解析能力',
    })
  );

  // 补全扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: AUTOCOMPLETE_EXTENSION_POINT,
      type: ExtensionPointType.Autocomplete,
      description: '补全提供者扩展，用于添加自定义补全源',
    })
  );

  // 命令扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: COMMAND_EXTENSION_POINT,
      type: ExtensionPointType.Command,
      description: '命令扩展，用于注册可执行命令',
    })
  );

  // 工具栏扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: TOOLBAR_EXTENSION_POINT,
      type: ExtensionPointType.Toolbar,
      description: '工具栏扩展，用于添加工具栏按钮',
    })
  );

  // 侧边栏扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: SIDEBAR_EXTENSION_POINT,
      type: ExtensionPointType.Sidebar,
      description: '侧边栏扩展，用于添加侧边栏视图',
    })
  );

  // 主题扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: THEME_EXTENSION_POINT,
      type: ExtensionPointType.Theme,
      description: '主题扩展，用于添加编辑器主题',
    })
  );

  // 语言扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: LANGUAGE_EXTENSION_POINT,
      type: ExtensionPointType.Language,
      description: '语言扩展，用于添加语言支持',
    })
  );

  // 快捷键扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: KEYBINDING_EXTENSION_POINT,
      type: ExtensionPointType.Keybinding,
      description: '快捷键扩展，用于添加快捷键绑定',
    })
  );

  // 菜单扩展点
  disposables.push(
    registry.defineExtensionPoint({
      id: MENU_EXTENSION_POINT,
      type: ExtensionPointType.Menu,
      description: '菜单扩展，用于添加菜单项',
    })
  );

  return disposables;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建扩展点注册表实例
 */
export function createExtensionRegistry(): ExtensionRegistry {
  return ExtensionRegistry.getInstance();
}
