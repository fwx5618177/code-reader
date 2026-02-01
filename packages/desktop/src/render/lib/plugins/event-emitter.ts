// ================================
// 插件事件系统实现
// 高性能、类型安全的事件发射器
// ================================

import type { Disposable, PluginEvent, PluginEventType, PluginId } from './types';

// ================================
// 类型定义
// ================================

/** 事件监听器类型 */
export type EventListener<T> = (event: T) => void;

/** 事件监听器选项 */
export interface ListenerOptions {
  /** 是否只触发一次 */
  once?: boolean;
  /** 优先级（数字越大越先执行） */
  priority?: number;
}

/** 内部监听器包装 */
interface ListenerWrapper<T> {
  /** 监听器函数 */
  listener: EventListener<T>;
  /** 是否只触发一次 */
  once: boolean;
  /** 优先级 */
  priority: number;
}

// ================================
// 通用事件发射器
// ================================

/**
 * 高性能通用事件发射器
 * 支持类型安全、优先级、一次性监听等特性
 */
export class TypedEventEmitter<TEventMap extends Record<string, unknown>> {
  /** 事件监听器映射 */
  private listeners: Map<keyof TEventMap, ListenerWrapper<unknown>[]> = new Map();

  /** 最大监听器数量（防止内存泄漏） */
  private maxListeners: number = 100;

  /** 是否已销毁 */
  private destroyed: boolean = false;

  /**
   * 构造函数
   * @param maxListeners 最大监听器数量
   */
  constructor(maxListeners?: number) {
    if (maxListeners !== undefined) {
      this.maxListeners = maxListeners;
    }
  }

  /**
   * 设置最大监听器数量
   */
  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  /**
   * 获取最大监听器数量
   */
  getMaxListeners(): number {
    return this.maxListeners;
  }

  /**
   * 添加事件监听器
   * @param event 事件类型
   * @param listener 监听器函数
   * @param options 监听器选项
   * @returns Disposable 用于移除监听器
   */
  on<K extends keyof TEventMap>(
    event: K,
    listener: EventListener<TEventMap[K]>,
    options?: ListenerOptions
  ): Disposable {
    if (this.destroyed) {
      console.warn('EventEmitter: 尝试在已销毁的发射器上添加监听器');
      return { dispose: () => {} };
    }

    const wrapper: ListenerWrapper<TEventMap[K]> = {
      listener,
      once: options?.once ?? false,
      priority: options?.priority ?? 0,
    };

    let list = this.listeners.get(event);
    if (!list) {
      list = [];
      this.listeners.set(event, list);
    }

    // 检查是否超过最大监听器数量
    if (list.length >= this.maxListeners) {
      console.warn(
        `EventEmitter: 事件 "${String(event)}" 的监听器数量超过 ${this.maxListeners}，可能存在内存泄漏`
      );
    }

    // 按优先级插入（高优先级在前）
    const insertIndex = this.findInsertIndex(list, wrapper.priority);
    list.splice(insertIndex, 0, wrapper as ListenerWrapper<unknown>);

    // 返回 Disposable
    return {
      dispose: () => {
        this.off(event, listener);
      },
    };
  }

  /**
   * 添加一次性事件监听器
   */
  once<K extends keyof TEventMap>(
    event: K,
    listener: EventListener<TEventMap[K]>,
    options?: Omit<ListenerOptions, 'once'>
  ): Disposable {
    return this.on(event, listener, { ...options, once: true });
  }

  /**
   * 移除事件监听器
   */
  off<K extends keyof TEventMap>(event: K, listener: EventListener<TEventMap[K]>): void {
    const list = this.listeners.get(event);
    if (!list) return;

    const index = list.findIndex((w) => w.listener === listener);
    if (index !== -1) {
      list.splice(index, 1);
    }

    // 如果没有监听器了，删除事件键
    if (list.length === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * 触发事件
   * @param event 事件类型
   * @param data 事件数据
   */
  emit<K extends keyof TEventMap>(event: K, data: TEventMap[K]): void {
    if (this.destroyed) return;

    const list = this.listeners.get(event);
    if (!list || list.length === 0) return;

    // 创建副本以防止在迭代时修改
    const snapshot = [...list];
    const toRemove: ListenerWrapper<unknown>[] = [];

    for (const wrapper of snapshot) {
      try {
        (wrapper.listener as EventListener<TEventMap[K]>)(data);

        if (wrapper.once) {
          toRemove.push(wrapper);
        }
      } catch (error) {
        console.error(`EventEmitter: 监听器执行错误 (事件: ${String(event)})`, error);
      }
    }

    // 移除一次性监听器
    for (const wrapper of toRemove) {
      const index = list.indexOf(wrapper);
      if (index !== -1) {
        list.splice(index, 1);
      }
    }

    if (list.length === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * 异步触发事件（并行执行所有监听器）
   */
  async emitAsync<K extends keyof TEventMap>(event: K, data: TEventMap[K]): Promise<void> {
    if (this.destroyed) return;

    const list = this.listeners.get(event);
    if (!list || list.length === 0) return;

    const snapshot = [...list];
    const toRemove: ListenerWrapper<unknown>[] = [];

    const promises = snapshot.map(async (wrapper) => {
      try {
        await Promise.resolve((wrapper.listener as EventListener<TEventMap[K]>)(data));

        if (wrapper.once) {
          toRemove.push(wrapper);
        }
      } catch (error) {
        console.error(`EventEmitter: 异步监听器执行错误 (事件: ${String(event)})`, error);
      }
    });

    await Promise.all(promises);

    // 移除一次性监听器
    for (const wrapper of toRemove) {
      const index = list.indexOf(wrapper);
      if (index !== -1) {
        list.splice(index, 1);
      }
    }

    if (list.length === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * 获取事件的监听器数量
   */
  listenerCount<K extends keyof TEventMap>(event: K): number {
    const list = this.listeners.get(event);
    return list?.length ?? 0;
  }

  /**
   * 获取所有事件名称
   */
  eventNames(): (keyof TEventMap)[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * 移除指定事件的所有监听器
   */
  removeAllListeners<K extends keyof TEventMap>(event?: K): void {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * 销毁发射器
   */
  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  /**
   * 检查是否已销毁
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * 查找插入位置（按优先级降序）
   */
  private findInsertIndex(list: ListenerWrapper<unknown>[], priority: number): number {
    let low = 0;
    let high = list.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (list[mid].priority >= priority) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }
}

// ================================
// 插件事件发射器
// ================================

/** 插件事件映射 */
export type PluginEventMap = {
  [PluginEventType.Loaded]: PluginEvent;
  [PluginEventType.Activated]: PluginEvent;
  [PluginEventType.Deactivated]: PluginEvent;
  [PluginEventType.Unloaded]: PluginEvent;
  [PluginEventType.Error]: PluginEvent;
  [PluginEventType.StateChanged]: PluginEvent;
  [key: string]: PluginEvent;
};

/**
 * 插件专用事件发射器
 * 提供插件生命周期事件的发布订阅
 */
export class PluginEventEmitter extends TypedEventEmitter<PluginEventMap> {
  /** 单例实例 */
  private static instance: PluginEventEmitter | null = null;

  /** 事件历史记录（用于调试） */
  private eventHistory: PluginEvent[] = [];

  /** 是否记录历史 */
  private recordHistory: boolean = false;

  /** 历史记录最大长度 */
  private maxHistoryLength: number = 100;

  /** 插件事件过滤器 */
  private pluginFilters: Map<PluginId, Set<PluginEventType>> = new Map();

  /**
   * 构造函数
   */
  constructor() {
    super(200); // 插件系统可能有更多监听器
  }

  /**
   * 获取单例实例
   */
  static getInstance(): PluginEventEmitter {
    if (!PluginEventEmitter.instance) {
      PluginEventEmitter.instance = new PluginEventEmitter();
    }
    return PluginEventEmitter.instance;
  }

  /**
   * 重置单例（用于测试）
   */
  static resetInstance(): void {
    if (PluginEventEmitter.instance) {
      PluginEventEmitter.instance.destroy();
      PluginEventEmitter.instance = null;
    }
  }

  /**
   * 启用事件历史记录
   */
  enableHistory(maxLength?: number): void {
    this.recordHistory = true;
    if (maxLength !== undefined) {
      this.maxHistoryLength = maxLength;
    }
  }

  /**
   * 禁用事件历史记录
   */
  disableHistory(): void {
    this.recordHistory = false;
    this.eventHistory = [];
  }

  /**
   * 获取事件历史
   */
  getHistory(): ReadonlyArray<PluginEvent> {
    return this.eventHistory;
  }

  /**
   * 清空事件历史
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 发送插件事件
   */
  emitPluginEvent(event: PluginEvent): void {
    // 记录历史
    if (this.recordHistory) {
      this.eventHistory.push(event);
      if (this.eventHistory.length > this.maxHistoryLength) {
        this.eventHistory.shift();
      }
    }

    // 检查过滤器
    const filters = this.pluginFilters.get(event.pluginId);
    if (filters && !filters.has(event.type)) {
      return;
    }

    // 触发事件
    this.emit(event.type, event);
  }

  /**
   * 订阅特定插件的事件
   * @param pluginId 插件 ID
   * @param eventType 事件类型
   * @param listener 监听器
   */
  onPlugin(
    pluginId: PluginId,
    eventType: PluginEventType,
    listener: EventListener<PluginEvent>
  ): Disposable {
    // 包装监听器以过滤特定插件
    const wrappedListener: EventListener<PluginEvent> = (event) => {
      if (event.pluginId === pluginId) {
        listener(event);
      }
    };

    return this.on(eventType, wrappedListener);
  }

  /**
   * 订阅所有插件事件
   */
  onAll(listener: EventListener<PluginEvent>): Disposable {
    const disposables: Disposable[] = [];

    // 订阅所有事件类型
    const eventTypes: PluginEventType[] = [
      'plugin:loaded' as PluginEventType,
      'plugin:activated' as PluginEventType,
      'plugin:deactivated' as PluginEventType,
      'plugin:unloaded' as PluginEventType,
      'plugin:error' as PluginEventType,
      'plugin:stateChanged' as PluginEventType,
    ];

    for (const type of eventTypes) {
      disposables.push(this.on(type, listener));
    }

    return {
      dispose: () => {
        for (const d of disposables) {
          d.dispose();
        }
      },
    };
  }

  /**
   * 设置插件事件过滤器
   * 只允许指定类型的事件通过
   */
  setPluginFilter(pluginId: PluginId, allowedTypes: PluginEventType[]): void {
    this.pluginFilters.set(pluginId, new Set(allowedTypes));
  }

  /**
   * 移除插件事件过滤器
   */
  removePluginFilter(pluginId: PluginId): void {
    this.pluginFilters.delete(pluginId);
  }

  /**
   * 清除所有过滤器
   */
  clearFilters(): void {
    this.pluginFilters.clear();
  }

  /**
   * 等待特定事件
   */
  waitFor(
    eventType: PluginEventType,
    predicate?: (event: PluginEvent) => boolean,
    timeout?: number
  ): Promise<PluginEvent> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let disposable: Disposable | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (disposable) {
          disposable.dispose();
        }
      };

      disposable = this.on(eventType, (event) => {
        if (!predicate || predicate(event)) {
          cleanup();
          resolve(event);
        }
      });

      if (timeout !== undefined) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error(`等待事件 ${eventType} 超时 (${timeout}ms)`));
        }, timeout);
      }
    });
  }

  /**
   * 销毁发射器
   */
  override destroy(): void {
    this.eventHistory = [];
    this.pluginFilters.clear();
    super.destroy();
  }
}

// ================================
// 工具函数
// ================================

/**
 * 创建可释放资源
 */
export function createDisposable(cleanup: () => void): Disposable {
  let disposed = false;

  return {
    dispose() {
      if (!disposed) {
        disposed = true;
        cleanup();
      }
    },
  };
}

/**
 * 组合多个 Disposable
 */
export function combineDisposables(...disposables: Disposable[]): Disposable {
  return {
    dispose() {
      for (const d of disposables) {
        try {
          d.dispose();
        } catch (error) {
          console.error('Disposable 清理错误:', error);
        }
      }
    },
  };
}

/**
 * 创建 DisposableStore
 * 用于管理多个 Disposable
 */
export class DisposableStore implements Disposable {
  private disposables: Disposable[] = [];
  private disposed: boolean = false;

  /**
   * 添加 Disposable
   */
  add<T extends Disposable>(disposable: T): T {
    if (this.disposed) {
      console.warn('DisposableStore: 尝试向已销毁的 Store 添加 Disposable');
      disposable.dispose();
      return disposable;
    }

    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * 删除 Disposable（但不调用 dispose）
   */
  delete(disposable: Disposable): void {
    const index = this.disposables.indexOf(disposable);
    if (index !== -1) {
      this.disposables.splice(index, 1);
    }
  }

  /**
   * 清空所有 Disposable
   */
  clear(): void {
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch (error) {
        console.error('DisposableStore: 清理错误', error);
      }
    }
    this.disposables = [];
  }

  /**
   * 销毁 Store
   */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.clear();
  }

  /**
   * 检查是否已销毁
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * 获取当前 Disposable 数量
   */
  get size(): number {
    return this.disposables.length;
  }
}
