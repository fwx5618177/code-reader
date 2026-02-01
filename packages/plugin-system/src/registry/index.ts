// ================================
// 插件注册表
// 管理扩展点注册和扩展获取
// ================================

import type {
  ExtensionPoint,
  ExtensionPointType,
  ExtensionRegistration,
  PluginId,
  Disposable,
} from '../types';

// ================================
// 扩展点注册表
// ================================

/**
 * 扩展点注册表
 * 管理所有扩展点的定义和扩展注册
 */
export class ExtensionRegistry {
  /** 扩展点定义 */
  private extensionPoints: Map<string, ExtensionPoint> = new Map();

  /** 扩展注册 */
  private extensions: Map<string, ExtensionRegistration[]> = new Map();

  /** 变更监听器 */
  private listeners: Set<ExtensionChangeListener> = new Set();

  // ================================
  // 扩展点管理
  // ================================

  /**
   * 定义扩展点
   * @param extensionPoint 扩展点定义
   */
  defineExtensionPoint<T>(extensionPoint: ExtensionPoint<T>): Disposable {
    if (this.extensionPoints.has(extensionPoint.id)) {
      throw new Error(`扩展点 "${extensionPoint.id}" 已存在`);
    }

    this.extensionPoints.set(extensionPoint.id, extensionPoint as ExtensionPoint);
    this.extensions.set(extensionPoint.id, []);

    this.emitChange({
      type: 'extension-point-added',
      extensionPointId: extensionPoint.id,
    });

    return {
      dispose: () => {
        this.removeExtensionPoint(extensionPoint.id);
      },
    };
  }

  /**
   * 移除扩展点
   * @param extensionPointId 扩展点 ID
   */
  removeExtensionPoint(extensionPointId: string): void {
    this.extensionPoints.delete(extensionPointId);
    this.extensions.delete(extensionPointId);

    this.emitChange({
      type: 'extension-point-removed',
      extensionPointId,
    });
  }

  /**
   * 获取扩展点定义
   * @param extensionPointId 扩展点 ID
   */
  getExtensionPoint<T>(extensionPointId: string): ExtensionPoint<T> | undefined {
    return this.extensionPoints.get(extensionPointId) as ExtensionPoint<T> | undefined;
  }

  /**
   * 获取所有扩展点
   */
  getAllExtensionPoints(): ExtensionPoint[] {
    return Array.from(this.extensionPoints.values());
  }

  /**
   * 按类型获取扩展点
   * @param type 扩展点类型
   */
  getExtensionPointsByType(type: ExtensionPointType): ExtensionPoint[] {
    return Array.from(this.extensionPoints.values()).filter((ep) => ep.type === type);
  }

  // ================================
  // 扩展注册
  // ================================

  /**
   * 注册扩展
   * @param extensionPointId 扩展点 ID
   * @param pluginId 插件 ID
   * @param extension 扩展数据
   * @param priority 优先级
   */
  registerExtension<T>(
    extensionPointId: string,
    pluginId: PluginId,
    extension: T,
    priority = 50
  ): Disposable {
    const extensionPoint = this.extensionPoints.get(extensionPointId);
    if (!extensionPoint) {
      throw new Error(`扩展点 "${extensionPointId}" 不存在`);
    }

    // 验证扩展
    if (extensionPoint.validator && !extensionPoint.validator(extension)) {
      throw new Error(`扩展验证失败: ${extensionPointId}`);
    }

    const registration: ExtensionRegistration<T> = {
      extensionPointId,
      pluginId,
      extension,
      priority,
    };

    const registrations = this.extensions.get(extensionPointId);
    if (!registrations) {
      throw new Error(`扩展点 "${extensionPointId}" 的注册列表不存在`);
    }

    registrations.push(registration as ExtensionRegistration);

    // 按优先级排序（高优先级在前）
    registrations.sort((a, b) => b.priority - a.priority);

    this.emitChange({
      type: 'extension-added',
      extensionPointId,
      pluginId,
    });

    return {
      dispose: () => {
        this.unregisterExtension(extensionPointId, pluginId, extension);
      },
    };
  }

  /**
   * 注销扩展
   * @param extensionPointId 扩展点 ID
   * @param pluginId 插件 ID
   * @param extension 扩展数据
   */
  unregisterExtension<T>(extensionPointId: string, pluginId: PluginId, extension: T): void {
    const registrations = this.extensions.get(extensionPointId);
    if (!registrations) return;

    const index = registrations.findIndex(
      (r) => r.pluginId === pluginId && r.extension === extension
    );

    if (index !== -1) {
      registrations.splice(index, 1);

      this.emitChange({
        type: 'extension-removed',
        extensionPointId,
        pluginId,
      });
    }
  }

  /**
   * 注销插件的所有扩展
   * @param pluginId 插件 ID
   */
  unregisterAllByPlugin(pluginId: PluginId): void {
    for (const [extensionPointId, registrations] of this.extensions) {
      const filtered = registrations.filter((r) => r.pluginId !== pluginId);
      if (filtered.length !== registrations.length) {
        this.extensions.set(extensionPointId, filtered);
        this.emitChange({
          type: 'extension-removed',
          extensionPointId,
          pluginId,
        });
      }
    }
  }

  // ================================
  // 扩展获取
  // ================================

  /**
   * 获取扩展点的所有扩展
   * @param extensionPointId 扩展点 ID
   */
  getExtensions<T>(extensionPointId: string): ExtensionRegistration<T>[] {
    return (this.extensions.get(extensionPointId) || []) as ExtensionRegistration<T>[];
  }

  /**
   * 获取扩展点的所有扩展数据
   * @param extensionPointId 扩展点 ID
   */
  getExtensionData<T>(extensionPointId: string): T[] {
    return this.getExtensions<T>(extensionPointId).map((r) => r.extension);
  }

  /**
   * 获取插件注册的所有扩展
   * @param pluginId 插件 ID
   */
  getExtensionsByPlugin(pluginId: PluginId): ExtensionRegistration[] {
    const result: ExtensionRegistration[] = [];
    for (const registrations of this.extensions.values()) {
      for (const registration of registrations) {
        if (registration.pluginId === pluginId) {
          result.push(registration);
        }
      }
    }
    return result;
  }

  // ================================
  // 事件监听
  // ================================

  /**
   * 添加变更监听器
   * @param listener 监听器
   */
  onExtensionChange(listener: ExtensionChangeListener): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  /**
   * 触发变更事件
   */
  private emitChange(event: ExtensionChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ExtensionRegistry] 监听器错误:', error);
      }
    }
  }

  // ================================
  // 清理
  // ================================

  /**
   * 清空所有扩展点和扩展
   */
  clear(): void {
    this.extensionPoints.clear();
    this.extensions.clear();
    this.listeners.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): ExtensionRegistryStats {
    let totalExtensions = 0;
    for (const registrations of this.extensions.values()) {
      totalExtensions += registrations.length;
    }

    return {
      extensionPointCount: this.extensionPoints.size,
      totalExtensionCount: totalExtensions,
      extensionsByPoint: Object.fromEntries(
        Array.from(this.extensions.entries()).map(([id, regs]) => [id, regs.length])
      ),
    };
  }
}

// ================================
// 类型定义
// ================================

/** 扩展变更事件 */
export interface ExtensionChangeEvent {
  type:
    | 'extension-point-added'
    | 'extension-point-removed'
    | 'extension-added'
    | 'extension-removed';
  extensionPointId: string;
  pluginId?: PluginId;
}

/** 扩展变更监听器 */
export type ExtensionChangeListener = (event: ExtensionChangeEvent) => void;

/** 注册表统计信息 */
export interface ExtensionRegistryStats {
  extensionPointCount: number;
  totalExtensionCount: number;
  extensionsByPoint: Record<string, number>;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建扩展点注册表
 */
export function createExtensionRegistry(): ExtensionRegistry {
  return new ExtensionRegistry();
}

// ================================
// 导出
// ================================

export { ExtensionRegistry as default };
