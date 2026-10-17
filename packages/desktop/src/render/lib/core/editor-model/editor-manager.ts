// ================================
// DocumentEditorManager
// 单例管理器，管理 EditorModel 和 SaveEngine 实例
// 确保正确的生命周期管理，防止内存泄漏
// ================================

import { EditorModel, createEditorModel } from './editor-model';
import { EditorModelConfig } from './types';
import {
  SaveEngine,
  SaveEngineConfig,
  ISaveExecutor,
  ISaveStrategy,
  DebouncedSaveStrategy,
} from '../save-engine';

// ================================
// 类型定义
// ================================

/**
 * 托管的编辑器实例
 */
export interface ManagedEditorInstance {
  /** EditorModel 实例 */
  readonly model: EditorModel;
  /** SaveEngine 实例 */
  readonly saveEngine: SaveEngine;
  /** 该实例管理的文档 ID */
  readonly documentId: string;
  /** 引用计数，用于清理 */
  refCount: number;
  /** 该实例是否已销毁 */
  isDestroyed: boolean;
  /** 实例创建时间戳 */
  readonly createdAt: number;
  /** 最后访问时间戳 */
  lastAccessedAt: number;
}

/**
 * 编辑器管理器配置
 */
export interface EditorManagerConfig {
  /** 自动保存默认防抖延迟（毫秒） */
  defaultDebounceMs?: number;
  /** 自动保存默认最大间隔（毫秒） */
  defaultMaxIntervalMs?: number;
  /** 默认是否启用自动保存 */
  defaultAutoSaveEnabled?: boolean;
  /** 最大缓存实例数量 */
  maxCachedInstances?: number;
  /** 未使用实例的存活时间（毫秒），0 表示禁用 */
  unusedInstanceTTL?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * 创建编辑器的选项
 */
export interface CreateEditorOptions {
  /** 初始标题 */
  initialTitle?: string;
  /** 初始内容 */
  initialContent?: string;
  /** 初始版本 ID */
  initialVersionId?: number;
  /** 保存执行器（必需） */
  executor: ISaveExecutor;
  /** 自定义保存策略 */
  strategy?: ISaveStrategy;
  /** 覆盖自动保存启用状态 */
  autoSaveEnabled?: boolean;
  /** 覆盖防抖延迟 */
  debounceMs?: number;
  /** 覆盖最大间隔 */
  maxIntervalMs?: number;
}

/**
 * 获取实例的结果
 */
export interface AcquireResult {
  /** 托管的编辑器实例 */
  instance: ManagedEditorInstance;
  /** 是否是新创建的实例 */
  isNew: boolean;
}

// ================================
// 默认配置
// ================================

const DEFAULT_MANAGER_CONFIG: Required<EditorManagerConfig> = {
  defaultDebounceMs: 1500,
  defaultMaxIntervalMs: 30000,
  defaultAutoSaveEnabled: true,
  maxCachedInstances: 10,
  unusedInstanceTTL: 300000, // 5 分钟
  debug: false,
};

// ================================
// DocumentEditorManager
// ================================

/**
 * DocumentEditorManager - 编辑器实例的单例管理器
 *
 * 核心设计原则：
 *
 * 1. **单例模式**：所有编辑器实例的唯一来源
 *    - 防止同一文档创建重复实例
 *    - 支持跨组件协调
 *
 * 2. **引用计数**：追踪使用情况以安全清理
 *    - acquire() 增加引用计数
 *    - release() 减少引用计数
 *    - 引用计数归零时销毁实例
 *
 * 3. **延迟清理**：实例保留在缓存中以便快速重新获取
 *    - 可配置最大缓存大小
 *    - 可配置未使用实例的存活时间
 *
 * 4. **线程安全**：所有操作都是同步和原子的
 *    - JS 单线程环境下无竞态条件
 *    - 异步操作有适当保护
 *
 * 使用示例：
 * ```typescript
 * const manager = DocumentEditorManager.getInstance();
 *
 * // 获取文档的编辑器实例
 * const { instance, isNew } = manager.acquire('doc-123', {
 *   initialTitle: '我的文档',
 *   executor: { save: async (snapshot) => { ... } },
 * });
 *
 * // 使用编辑器
 * instance.model.updateContent('<p>Hello</p>');
 * instance.saveEngine.requestSave();
 *
 * // 完成后释放（如组件卸载时）
 * manager.release('doc-123');
 * ```
 */
export class DocumentEditorManager {
  private static instance: DocumentEditorManager | null = null;

  private readonly config: Required<EditorManagerConfig>;
  private readonly instances: Map<string, ManagedEditorInstance>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // ================================
  // 单例访问
  // ================================

  /**
   * 获取 DocumentEditorManager 的单例实例
   */
  static getInstance(config?: EditorManagerConfig): DocumentEditorManager {
    if (!DocumentEditorManager.instance) {
      DocumentEditorManager.instance = new DocumentEditorManager(config);
    }
    return DocumentEditorManager.instance;
  }

  /**
   * 重置单例实例（用于测试）
   */
  static resetInstance(): void {
    if (DocumentEditorManager.instance) {
      DocumentEditorManager.instance.destroy();
      DocumentEditorManager.instance = null;
    }
  }

  // ================================
  // 构造函数（私有）
  // ================================

  private constructor(config?: EditorManagerConfig) {
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
    this.instances = new Map();

    // 如果配置了 TTL，启动清理定时器
    if (this.config.unusedInstanceTTL > 0) {
      this.startCleanupTimer();
    }

    this.log('管理器初始化，配置:', this.config);
  }

  // ================================
  // 公共 API
  // ================================

  /**
   * 获取文档的编辑器实例
   *
   * 如果实例已存在，增加引用计数并返回。
   * 否则，创建新实例。
   *
   * @param documentId 要获取编辑器的文档 ID
   * @param options 创建新实例的选项
   * @returns 托管实例和是否是新创建的标志
   */
  acquire(documentId: string, options: CreateEditorOptions): AcquireResult {
    // 检查是否有现有实例
    const existing = this.instances.get(documentId);

    if (existing && !existing.isDestroyed) {
      // 增加引用计数
      existing.refCount++;
      existing.lastAccessedAt = Date.now();

      this.log(`获取现有实例 ${documentId}，引用计数: ${existing.refCount}`);

      return { instance: existing, isNew: false };
    }

    // 如果存在已销毁的实例，移除它
    if (existing?.isDestroyed) {
      this.instances.delete(documentId);
    }

    // 创建新实例
    const instance = this.createInstance(documentId, options);
    this.instances.set(documentId, instance);

    this.log(`创建新实例 ${documentId}`);

    // 强制执行最大缓存大小
    this.enforceMaxCacheSize();

    return { instance, isNew: true };
  }

  /**
   * 释放编辑器实例
   *
   * 减少引用计数。如果引用计数归零，实例保留在缓存中
   * 以便可能的重新获取（直到 TTL 过期或缓存满）。
   *
   * @param documentId 要释放的文档 ID
   * @returns 如果找到并释放了实例返回 true
   */
  release(documentId: string): boolean {
    const instance = this.instances.get(documentId);

    if (!instance) {
      this.log(`没有找到要释放的实例 ${documentId}`);
      return false;
    }

    // 减少引用计数
    instance.refCount = Math.max(0, instance.refCount - 1);
    instance.lastAccessedAt = Date.now();

    this.log(`释放实例 ${documentId}，引用计数: ${instance.refCount}`);

    // 不立即销毁 - 保留在缓存中以便可能的重新获取
    // 清理定时器会处理未使用实例的销毁

    return true;
  }

  /**
   * 获取现有实例但不增加引用计数
   *
   * 用于只读访问或当你已有引用时。
   *
   * @param documentId 要查找的文档 ID
   * @returns 如果找到且未销毁返回实例，否则返回 null
   */
  get(documentId: string): ManagedEditorInstance | null {
    const instance = this.instances.get(documentId);

    if (!instance || instance.isDestroyed) {
      return null;
    }

    instance.lastAccessedAt = Date.now();
    return instance;
  }

  /**
   * 检查文档是否存在实例
   *
   * @param documentId 要检查的文档 ID
   * @returns 如果存在有效实例返回 true
   */
  has(documentId: string): boolean {
    const instance = this.instances.get(documentId);
    return instance !== undefined && !instance.isDestroyed;
  }

  /**
   * 强制立即销毁实例
   *
   * 当需要确保实例被清理时使用，不管引用计数。
   *
   * @param documentId 要销毁的文档 ID
   * @returns 如果找到并销毁了实例返回 true
   */
  forceDestroy(documentId: string): boolean {
    const instance = this.instances.get(documentId);

    if (!instance) {
      return false;
    }

    this.destroyInstance(instance);
    this.instances.delete(documentId);

    this.log(`强制销毁实例 ${documentId}`);

    return true;
  }

  /**
   * 获取所有活动的文档 ID
   *
   * @returns 具有活动（未销毁）实例的文档 ID 数组
   */
  getActiveDocumentIds(): string[] {
    const ids: string[] = [];

    this.instances.forEach((instance, id) => {
      if (!instance.isDestroyed) {
        ids.push(id);
      }
    });

    return ids;
  }

  /**
   * 获取实例统计信息
   */
  getStats(): {
    total: number;
    active: number;
    unused: number;
    destroyed: number;
  } {
    let active = 0;
    let unused = 0;
    let destroyed = 0;

    this.instances.forEach((instance) => {
      if (instance.isDestroyed) {
        destroyed++;
      } else if (instance.refCount > 0) {
        active++;
      } else {
        unused++;
      }
    });

    return {
      total: this.instances.size,
      active,
      unused,
      destroyed,
    };
  }

  /**
   * 落盘：所有实例（包括已释放但仍在缓存中、防抖保存尚未触发的实例）立即写回未保存的更改。
   * 任一文档保存失败时 reject，错误信息汇总全部失败的文档
   */
  async flushAll(): Promise<void> {
    const instances = [...this.instances.values()].filter((instance) => !instance.isDestroyed);
    const results = await Promise.all(instances.map((instance) => instance.saveEngine.flush()));
    const failures = results.flatMap((result, index) =>
      result && !result.success ? [`${instances[index].documentId}: ${result.error}`] : []
    );
    if (failures.length > 0) {
      throw new Error(`文档保存失败 - ${failures.join('; ')}`);
    }
  }

  /**
   * 销毁所有实例并清理管理器
   */
  destroy(): void {
    // 停止清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 销毁所有实例
    this.instances.forEach((instance) => {
      this.destroyInstance(instance);
    });

    this.instances.clear();

    this.log('管理器已销毁');
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 创建新的托管编辑器实例
   */
  private createInstance(documentId: string, options: CreateEditorOptions): ManagedEditorInstance {
    // 创建 EditorModel
    const modelConfig: EditorModelConfig = {
      documentId,
      initialTitle: options.initialTitle ?? '',
      initialContent: options.initialContent ?? '',
      initialVersionId: options.initialVersionId ?? 1,
    };

    const model = createEditorModel(modelConfig);

    // 创建带策略的 SaveEngine
    const strategy =
      options.strategy ??
      new DebouncedSaveStrategy({
        debounceMs: options.debounceMs ?? this.config.defaultDebounceMs,
        maxIntervalMs: options.maxIntervalMs ?? this.config.defaultMaxIntervalMs,
        debug: this.config.debug,
      });

    const saveEngineConfig: SaveEngineConfig = {
      contentProvider: model,
      executor: options.executor,
      strategy,
      autoSaveEnabled: options.autoSaveEnabled ?? this.config.defaultAutoSaveEnabled,
    };

    const saveEngine = new SaveEngine(saveEngineConfig);

    // 实例自身负责自动保存与保存后的标记，不依赖创建它的组件：
    // 同一文档可能同时被多个编辑窗格持有，任一方释放后其余持有方照常工作
    model.onContentChange(() => saveEngine.requestSave());
    saveEngine.addEventListener((event) => {
      if (event.type === 'SAVE_SUCCESS') {
        model.markAsSaved(event.result.savedVersionId, event.result.savedContentHash);
      }
    });

    const now = Date.now();

    return {
      model,
      saveEngine,
      documentId,
      refCount: 1, // 初始引用计数为 1
      isDestroyed: false,
      createdAt: now,
      lastAccessedAt: now,
    };
  }

  /**
   * 销毁托管的编辑器实例
   */
  private destroyInstance(instance: ManagedEditorInstance): void {
    if (instance.isDestroyed) {
      return;
    }

    // 先标记为已销毁，防止进一步操作
    (instance as { isDestroyed: boolean }).isDestroyed = true;

    // 先销毁 SaveEngine（可能触发最后一次保存）
    try {
      instance.saveEngine.destroy();
    } catch (error) {
      console.error('[EditorManager] 销毁 SaveEngine 时出错:', error);
    }

    // 然后销毁 EditorModel
    try {
      instance.model.destroy();
    } catch (error) {
      console.error('[EditorManager] 销毁 EditorModel 时出错:', error);
    }
  }

  /**
   * 启动未使用实例的清理定时器
   */
  private startCleanupTimer(): void {
    // 每分钟运行一次清理
    const interval = Math.min(60000, this.config.unusedInstanceTTL / 2);

    this.cleanupTimer = setInterval(() => {
      this.cleanupUnusedInstances();
    }, interval);
  }

  /**
   * 清理超过 TTL 的未使用实例
   */
  private cleanupUnusedInstances(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    this.instances.forEach((instance, id) => {
      // 跳过仍在使用的实例
      if (instance.refCount > 0) {
        return;
      }

      // 跳过已销毁的实例
      if (instance.isDestroyed) {
        toRemove.push(id);
        return;
      }

      // 检查 TTL 是否过期
      const unusedDuration = now - instance.lastAccessedAt;
      if (unusedDuration >= this.config.unusedInstanceTTL) {
        this.log(`清理未使用实例 ${id}（未使用 ${unusedDuration}ms）`);
        this.destroyInstance(instance);
        toRemove.push(id);
      }
    });

    // 从 Map 中移除
    toRemove.forEach((id) => {
      this.instances.delete(id);
    });
  }

  /**
   * 通过移除最旧的未使用实例来强制执行最大缓存大小
   */
  private enforceMaxCacheSize(): void {
    if (this.instances.size <= this.config.maxCachedInstances) {
      return;
    }

    // 收集未使用实例并按最后访问时间排序
    const unused: Array<{ id: string; instance: ManagedEditorInstance }> = [];

    this.instances.forEach((instance, id) => {
      if (instance.refCount === 0 && !instance.isDestroyed) {
        unused.push({ id, instance });
      }
    });

    // 按最后访问时间排序（最旧的在前）
    unused.sort((a, b) => a.instance.lastAccessedAt - b.instance.lastAccessedAt);

    // 移除最旧的直到低于限制
    const toRemove = this.instances.size - this.config.maxCachedInstances;

    for (let i = 0; i < Math.min(toRemove, unused.length); i++) {
      const { id, instance } = unused[i];
      this.log(`驱逐缓存实例 ${id}（缓存已满）`);
      this.destroyInstance(instance);
      this.instances.delete(id);
    }
  }

  /**
   * 输出调试日志
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[EditorManager]', ...args);
    }
  }
}

// ================================
// 便捷函数
// ================================

/**
 * 获取默认的 DocumentEditorManager 实例
 */
export function getEditorManager(config?: EditorManagerConfig): DocumentEditorManager {
  return DocumentEditorManager.getInstance(config);
}

/**
 * 获取文档的编辑器实例
 * manager.acquire() 的便捷包装
 */
export function acquireEditor(documentId: string, options: CreateEditorOptions): AcquireResult {
  return DocumentEditorManager.getInstance().acquire(documentId, options);
}

/**
 * 释放编辑器实例
 * manager.release() 的便捷包装
 */
export function releaseEditor(documentId: string): boolean {
  return DocumentEditorManager.getInstance().release(documentId);
}

/**
 * 获取编辑器实例但不获取引用
 * manager.get() 的便捷包装
 */
export function getEditor(documentId: string): ManagedEditorInstance | null {
  return DocumentEditorManager.getInstance().get(documentId);
}
