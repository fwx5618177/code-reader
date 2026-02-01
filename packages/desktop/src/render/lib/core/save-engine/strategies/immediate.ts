// ================================
// ImmediateSaveStrategy
// 立即执行保存，不进行调度
// 用于手动保存操作（Cmd+S）
// ================================

import { ISaveStrategy, SaveResult } from '../types';

/**
 * 立即保存策略配置
 */
export interface ImmediateStrategyConfig {
  /**
   * 是否输出调试信息
   * @default false
   */
  debug?: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_IMMEDIATE_CONFIG: ImmediateStrategyConfig = {
  debug: false,
};

/**
 * ImmediateSaveStrategy - 立即保存策略
 *
 * 立即执行保存，不进行任何调度或防抖。
 * 用于：
 * - 手动保存操作（Cmd+S / Ctrl+S）
 * - 关闭前保存
 * - 切换文档前保存
 *
 * 此策略确保保存同步发生（在异步允许的范围内尽可能同步）
 * 没有任何人为延迟。
 *
 * 使用示例：
 * ```typescript
 * const strategy = new ImmediateSaveStrategy();
 *
 * strategy.scheduleSave(async () => {
 *   const snapshot = model.getSnapshot();
 *   return await saveToDatabase(snapshot);
 * });
 * ```
 */
export class ImmediateSaveStrategy implements ISaveStrategy {
  readonly name = 'immediate';

  private readonly config: ImmediateStrategyConfig;
  private isExecuting: boolean = false;
  private pendingPromise: Promise<SaveResult> | null = null;

  constructor(config: Partial<ImmediateStrategyConfig> = {}) {
    this.config = { ...DEFAULT_IMMEDIATE_CONFIG, ...config };
  }

  // ================================
  // ISaveStrategy 实现
  // ================================

  scheduleSave(performSave: () => Promise<SaveResult>): void {
    // 立即执行 - 不进行调度
    this.log('立即执行保存');

    // 不在这里等待 - 只是触发并追踪
    this.pendingPromise = this.executeSave(performSave);
  }

  cancel(): void {
    // 无法取消正在执行的立即保存
    // 只记录尝试
    if (this.isExecuting) {
      this.log('无法取消 - 保存正在执行');
    }
  }

  isScheduled(): boolean {
    // 对于立即策略，"已调度"意味着正在执行
    return this.isExecuting;
  }

  async flush(): Promise<SaveResult | null> {
    // 如果有待处理的保存，等待它完成
    if (this.pendingPromise) {
      return this.pendingPromise;
    }
    return null;
  }

  destroy(): void {
    // 立即策略没有需要清理的资源
    this.log('策略已销毁');
  }

  // ================================
  // 私有方法
  // ================================

  private async executeSave(performSave: () => Promise<SaveResult>): Promise<SaveResult> {
    if (this.isExecuting) {
      // 已经在执行中 - 返回跳过结果
      this.log('保存正在进行中，跳过');
      return {
        success: false,
        savedVersionId: 0,
        savedContentHash: '',
        savedAt: new Date(),
        error: '保存正在进行中',
      };
    }

    this.isExecuting = true;

    try {
      this.log('正在执行保存...');
      const result = await performSave();

      if (result.success) {
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
      this.pendingPromise = null;
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[ImmediateSaveStrategy]', ...args);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建立即保存策略
 */
export function createImmediateStrategy(
  config?: Partial<ImmediateStrategyConfig>
): ImmediateSaveStrategy {
  return new ImmediateSaveStrategy(config);
}
