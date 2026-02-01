// ================================
// VersionTracker
// 管理版本 ID 以追踪文档变更
// 设计灵感来自 VS Code 的 ITextModel versionId
// ================================

/**
 * 版本追踪配置
 */
export interface VersionTrackerConfig {
  /** 初始版本 ID（默认: 1） */
  initialVersionId?: number;
  /** 最大版本 ID，超过后回滚（默认: Number.MAX_SAFE_INTEGER） */
  maxVersionId?: number;
}

/**
 * 版本快照 - 版本的不可变记录
 */
export interface VersionSnapshot {
  /** 版本 ID */
  readonly versionId: number;
  /** 该版本创建时的时间戳 */
  readonly timestamp: number;
  /** 可选的内容哈希，用于变更检测 */
  readonly contentHash?: string;
}

/**
 * 版本变更事件
 */
export interface VersionChangeEvent {
  /** 之前的版本 ID */
  previousVersionId: number;
  /** 新的版本 ID */
  newVersionId: number;
  /** 变更时间戳 */
  timestamp: number;
}

/**
 * 版本变更监听器
 */
export type VersionChangeListener = (event: VersionChangeEvent) => void;

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<VersionTrackerConfig> = {
  initialVersionId: 1,
  maxVersionId: Number.MAX_SAFE_INTEGER,
};

/**
 * VersionTracker - 管理文档的版本 ID
 *
 * 核心特性：
 * - 单调递增的版本 ID
 * - 线程安全（JS 单线程，但异步安全）
 * - 支持版本比较
 * - 基于事件的变更通知
 * - 回滚保护
 *
 * 使用示例：
 * ```typescript
 * const tracker = new VersionTracker();
 *
 * // 获取当前版本
 * const version = tracker.getVersionId(); // 1
 *
 * // 变更时递增
 * tracker.increment(); // 现在是 2
 *
 * // 检查自某个已知版本后是否有变更
 * tracker.hasChangedSince(1); // true
 * tracker.hasChangedSince(2); // false
 * ```
 */
export class VersionTracker {
  private versionId: number;
  private readonly maxVersionId: number;
  private readonly listeners: Set<VersionChangeListener>;
  private lastChangeTimestamp: number;

  constructor(config: VersionTrackerConfig = {}) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    this.versionId = mergedConfig.initialVersionId;
    this.maxVersionId = mergedConfig.maxVersionId;
    this.listeners = new Set();
    this.lastChangeTimestamp = Date.now();
  }

  // ================================
  // 公共 API
  // ================================

  /**
   * 获取当前版本 ID
   */
  getVersionId(): number {
    return this.versionId;
  }

  /**
   * 获取最后版本变更的时间戳
   */
  getLastChangeTimestamp(): number {
    return this.lastChangeTimestamp;
  }

  /**
   * 获取当前版本的快照
   */
  getSnapshot(contentHash?: string): VersionSnapshot {
    return {
      versionId: this.versionId,
      timestamp: this.lastChangeTimestamp,
      contentHash,
    };
  }

  /**
   * 递增版本 ID
   * 当文档内容变更时调用此方法
   *
   * @returns 新的版本 ID
   */
  increment(): number {
    const previousVersionId = this.versionId;
    const timestamp = Date.now();

    // 处理回滚（实际中极不可能发生）
    if (this.versionId >= this.maxVersionId) {
      console.warn('[VersionTracker] 检测到版本 ID 回滚，重置为 1');
      this.versionId = 1;
    } else {
      this.versionId++;
    }

    this.lastChangeTimestamp = timestamp;

    // 通知监听器
    const event: VersionChangeEvent = {
      previousVersionId,
      newVersionId: this.versionId,
      timestamp,
    };

    this.notifyListeners(event);

    return this.versionId;
  }

  /**
   * 检查自某个已知版本后是否有变更
   *
   * @param knownVersionId 要比较的版本 ID
   * @returns 如果当前版本比 knownVersionId 更新则返回 true
   */
  hasChangedSince(knownVersionId: number): boolean {
    return this.versionId > knownVersionId;
  }

  /**
   * 检查文档是否已修改（版本 > 初始值）
   */
  isModified(): boolean {
    return this.versionId > 1;
  }

  /**
   * 重置版本追踪器到指定版本
   * 在加载新文档或回退时使用
   *
   * @param versionId 要重置到的版本 ID（默认: 1）
   */
  reset(versionId: number = 1): void {
    const previousVersionId = this.versionId;
    const timestamp = Date.now();

    this.versionId = Math.max(1, Math.min(versionId, this.maxVersionId));
    this.lastChangeTimestamp = timestamp;

    // 通知监听器重置事件
    const event: VersionChangeEvent = {
      previousVersionId,
      newVersionId: this.versionId,
      timestamp,
    };

    this.notifyListeners(event);
  }

  /**
   * 订阅版本变更
   *
   * @param listener 版本变更时调用的回调函数
   * @returns 取消订阅函数
   */
  onVersionChange(listener: VersionChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 比较两个版本 ID
   *
   * @returns 如果 a < b 返回负数，a === b 返回 0，a > b 返回正数
   */
  static compare(a: number, b: number): number {
    return a - b;
  }

  /**
   * 检查版本 A 是否比版本 B 更新
   */
  static isNewer(a: number, b: number): boolean {
    return a > b;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.listeners.clear();
  }

  // ================================
  // 私有方法
  // ================================

  private notifyListeners(event: VersionChangeEvent): void {
    // 使用 Array.from 以兼容 ES5
    Array.from(this.listeners).forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('[VersionTracker] 监听器错误:', error);
      }
    });
  }
}

/**
 * 创建 VersionTracker 的工厂函数
 */
export function createVersionTracker(config?: VersionTrackerConfig): VersionTracker {
  return new VersionTracker(config);
}
