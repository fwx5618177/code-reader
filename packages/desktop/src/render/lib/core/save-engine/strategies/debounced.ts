// ================================
// DebouncedSaveStrategy
// 带防抖和最大间隔约束的自动保存策略
// 设计灵感来自 VS Code 的自动保存实现
// ================================

import { ISaveStrategy, SaveResult } from '../types';

/**
 * 防抖保存策略配置
 */
export interface DebouncedStrategyConfig {
  /**
   * 防抖延迟（毫秒）
   * 在最后一次更改后等待多长时间再保存
   * @default 1500
   */
  debounceMs: number;

  /**
   * 保存之间的最大间隔（毫秒）
   * 即使仍在接收更改，也在此时间后强制保存
   * @default 30000
   */
  maxIntervalMs: number;

  /**
   * 是否输出调试信息
   * @default false
   */
  debug?: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_DEBOUNCED_CONFIG: DebouncedStrategyConfig = {
  debounceMs: 1500,
  maxIntervalMs: 30000,
  debug: false,
};

/**
 * DebouncedSaveStrategy - 防抖保存策略
 *
 * 实现双定时器方法进行自动保存：
 *
 * 1. **防抖定时器**：每次保存请求时重置
 *    - 等待用户停止输入
 *    - 在 `debounceMs` 无操作后保存
 *
 * 2. **最大间隔定时器**：不重置
 *    - 确保在持续编辑期间也会保存
 *    - 自上次保存后 `maxIntervalMs` 时强制保存
 *
 * 这提供了两全其美的效果：
 * - 响应式保存（输入时不过于激进）
 * - 可靠保存（不会等待太长时间）
 *
 * 使用示例：
 * ```typescript
 * const strategy = new DebouncedSaveStrategy({
 *   debounceMs: 1500,
 *   maxIntervalMs: 30000,
 * });
 *
 * strategy.scheduleSave(async () => {
 *   const snapshot = model.getSnapshot();
 *   return await saveToDatabase(snapshot);
 * });
 * ```
 */
export class DebouncedSaveStrategy implements ISaveStrategy {
  readonly name = 'debounced';

  private readonly config: DebouncedStrategyConfig;

  // 定时器
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxIntervalTimer: ReturnType<typeof setTimeout> | null = null;

  // 状态
  private pendingPerformSave: (() => Promise<SaveResult>) | null = null;
  private lastSaveTimestamp: number = 0;
  private isExecuting: boolean = false;

  constructor(config: Partial<DebouncedStrategyConfig> = {}) {
    this.config = { ...DEFAULT_DEBOUNCED_CONFIG, ...config };
  }

  // ================================
  // ISaveStrategy 实现
  // ================================

  scheduleSave(performSave: () => Promise<SaveResult>): void {
    // 存储保存函数
    this.pendingPerformSave = performSave;

    // 清除现有的防抖定时器
    this.clearDebounceTimer();

    // 设置防抖定时器
    this.debounceTimer = setTimeout(() => {
      this.executeSave();
    }, this.config.debounceMs);

    this.log('保存已调度（防抖）', this.config.debounceMs, 'ms');

    // 如果尚未运行，设置最大间隔定时器
    if (!this.maxIntervalTimer) {
      this.setupMaxIntervalTimer();
    }
  }

  cancel(): void {
    this.clearDebounceTimer();
    this.clearMaxIntervalTimer();
    this.pendingPerformSave = null;
    this.log('保存已取消');
  }

  isScheduled(): boolean {
    return this.debounceTimer !== null || this.maxIntervalTimer !== null;
  }

  async flush(): Promise<SaveResult | null> {
    if (!this.pendingPerformSave) {
      return null;
    }

    // 清除定时器
    this.clearDebounceTimer();
    this.clearMaxIntervalTimer();

    // 立即执行
    return this.executeSave();
  }

  destroy(): void {
    this.cancel();
    this.log('策略已销毁');
  }

  // ================================
  // 配置访问
  // ================================

  /**
   * 获取当前配置
   */
  getConfig(): DebouncedStrategyConfig {
    return { ...this.config };
  }

  /**
   * 动态更新配置
   */
  updateConfig(updates: Partial<DebouncedStrategyConfig>): void {
    Object.assign(this.config, updates);
    this.log('配置已更新', updates);
  }

  /**
   * 获取距离下次调度保存的时间
   */
  getTimeUntilSave(): number | null {
    if (!this.debounceTimer) {
      return null;
    }

    // 这是一个近似值，因为我们没有追踪确切的定时器开始时间
    return this.config.debounceMs;
  }

  // ================================
  // 私有方法
  // ================================

  private async executeSave(): Promise<SaveResult | null> {
    if (this.isExecuting || !this.pendingPerformSave) {
      return null;
    }

    this.isExecuting = true;
    const performSave = this.pendingPerformSave;

    // 清除定时器
    this.clearDebounceTimer();
    this.clearMaxIntervalTimer();
    this.pendingPerformSave = null;

    try {
      this.log('正在执行保存...');
      const result = await performSave();

      if (result.success) {
        this.lastSaveTimestamp = Date.now();
        this.log('保存成功，版本:', result.savedVersionId);
      } else {
        this.log('保存失败:', result.error);
      }

      return result;
    } catch (error) {
      this.log('保存错误:', error);
      return {
        success: false,
        savedVersionId: 0,
        savedContentHash: '',
        savedAt: new Date(),
        error: error instanceof Error ? error.message : '未知错误',
      };
    } finally {
      this.isExecuting = false;
    }
  }

  private setupMaxIntervalTimer(): void {
    const timeSinceLastSave = this.lastSaveTimestamp > 0 ? Date.now() - this.lastSaveTimestamp : 0;

    // 计算距离最大间隔的剩余时间
    const remainingTime = Math.max(0, this.config.maxIntervalMs - timeSinceLastSave);

    this.maxIntervalTimer = setTimeout(() => {
      this.maxIntervalTimer = null;
      this.log('达到最大间隔，强制保存');
      this.executeSave();
    }, remainingTime);

    this.log('最大间隔定时器设置为', remainingTime, 'ms');
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearMaxIntervalTimer(): void {
    if (this.maxIntervalTimer) {
      clearTimeout(this.maxIntervalTimer);
      this.maxIntervalTimer = null;
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[DebouncedSaveStrategy]', ...args);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建防抖保存策略
 */
export function createDebouncedStrategy(
  config?: Partial<DebouncedStrategyConfig>
): DebouncedSaveStrategy {
  return new DebouncedSaveStrategy(config);
}

/**
 * 创建针对输入优化的策略（更长的防抖）
 */
export function createTypingOptimizedStrategy(): DebouncedSaveStrategy {
  return new DebouncedSaveStrategy({
    debounceMs: 2000, // 输入停止后等待 2 秒
    maxIntervalMs: 60000, // 至少每分钟保存一次
  });
}

/**
 * 创建针对响应性优化的策略（更短的防抖）
 */
export function createResponsiveStrategy(): DebouncedSaveStrategy {
  return new DebouncedSaveStrategy({
    debounceMs: 500, // 输入停止后 500ms 保存
    maxIntervalMs: 15000, // 至少每 15 秒保存一次
  });
}
