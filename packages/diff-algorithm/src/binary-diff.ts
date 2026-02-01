// ================================
// Binary Diff - 二进制差分算法实现
// 基于 fossil-delta 库
// 适用于二进制文件、大文件、软件更新等场景
// ================================

import * as fossilDelta from 'fossil-delta';
import type { BinaryDelta, IBinaryDiffAlgorithm } from './types';

// ================================
// BinaryDiffEngine 类
// ================================

/**
 * 二进制差分引擎
 *
 * 基于 Fossil SCM 使用的 fossil-delta 算法实现，特点：
 * - O(n) 时间复杂度
 * - 高压缩率
 * - 适合二进制数据
 * - 跨平台兼容
 *
 * @example
 * ```typescript
 * const engine = new BinaryDiffEngine();
 *
 * // 从 Uint8Array 创建差分
 * const delta = engine.diff(sourceBytes, targetBytes);
 *
 * // 应用差分
 * const restored = engine.apply(sourceBytes, delta.delta);
 *
 * // 从字符串创建差分
 * const stringDelta = engine.diffString(sourceText, targetText);
 *
 * // 应用差分到字符串
 * const restoredText = engine.applyString(sourceText, stringDelta.delta);
 * ```
 */
export class BinaryDiffEngine implements IBinaryDiffAlgorithm {
  public readonly name = 'fossil-delta' as const;

  // ================================
  // 核心差分操作
  // ================================

  /**
   * 计算两个二进制数据之间的差分
   *
   * @param source 源数据
   * @param target 目标数据
   * @returns 差分结果
   */
  diff(source: Uint8Array | number[], target: Uint8Array | number[]): BinaryDelta {
    const sourceArray = source instanceof Uint8Array ? Array.from(source) : source;
    const targetArray = target instanceof Uint8Array ? Array.from(target) : target;

    const delta = fossilDelta.createDelta(sourceArray, targetArray);

    const compressionRatio =
      targetArray.length > 0 ? delta.length / targetArray.length : delta.length > 0 ? 1 : 0;

    return {
      delta,
      sourceLength: sourceArray.length,
      targetLength: targetArray.length,
      deltaSize: delta.length,
      compressionRatio,
    };
  }

  /**
   * 应用差分到源数据以获得目标数据
   *
   * @param source 源数据
   * @param delta 差分数据
   * @returns 目标数据
   */
  apply(source: Uint8Array | number[], delta: readonly number[]): Uint8Array {
    const sourceArray = source instanceof Uint8Array ? Array.from(source) : source;
    const deltaArray = delta as number[];

    const result = fossilDelta.applyDelta(sourceArray, deltaArray);
    return new Uint8Array(result);
  }

  /**
   * 获取应用差分后的输出大小
   *
   * @param delta 差分数据
   * @returns 输出大小
   */
  getOutputSize(delta: readonly number[]): number {
    return fossilDelta.getDeltaTargetSize(delta as number[]);
  }

  // ================================
  // 字符串便捷方法
  // ================================

  /**
   * 从字符串创建差分
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @returns 差分结果
   */
  diffString(source: string, target: string): BinaryDelta {
    const encoder = new TextEncoder();
    const sourceBytes = encoder.encode(source);
    const targetBytes = encoder.encode(target);
    return this.diff(sourceBytes, targetBytes);
  }

  /**
   * 应用差分到字符串
   *
   * @param source 源字符串
   * @param delta 差分数据
   * @returns 目标字符串
   */
  applyString(source: string, delta: readonly number[]): string {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const sourceBytes = encoder.encode(source);
    const result = this.apply(sourceBytes, delta);
    return decoder.decode(result);
  }

  // ================================
  // 验证与工具方法
  // ================================

  /**
   * 验证差分是否可以成功应用
   *
   * @param source 源数据
   * @param delta 差分数据
   * @returns 是否有效
   */
  validate(source: Uint8Array | number[], delta: readonly number[]): boolean {
    try {
      const expectedSize = this.getOutputSize(delta);
      const result = this.apply(source, delta);
      return result.length === expectedSize;
    } catch {
      return false;
    }
  }

  /**
   * 计算差分的压缩效率
   *
   * @param delta 差分结果
   * @returns 效率评估
   */
  getEfficiency(delta: BinaryDelta): DeltaEfficiency {
    const { deltaSize, sourceLength, targetLength } = delta;

    // 相对于目标大小的压缩率
    const compressionRatio = targetLength > 0 ? deltaSize / targetLength : 0;

    // 相对于全量替换的节省
    const savings = targetLength > 0 ? 1 - compressionRatio : 0;

    // 是否值得使用增量
    const worthUsing = compressionRatio < 0.5; // 小于 50% 时值得使用

    return {
      compressionRatio,
      savings,
      worthUsing,
      deltaSize,
      targetSize: targetLength,
      sourceSize: sourceLength,
    };
  }

  /**
   * 判断是否应该使用增量传输
   *
   * @param source 源数据
   * @param target 目标数据
   * @param threshold 阈值（默认 0.5）
   * @returns 是否应该使用增量
   */
  shouldUseIncremental(
    source: Uint8Array | number[],
    target: Uint8Array | number[],
    threshold: number = 0.5
  ): IncrementalDecision {
    const delta = this.diff(source, target);
    const efficiency = this.getEfficiency(delta);

    return {
      shouldUse: efficiency.compressionRatio < threshold,
      delta,
      efficiency,
      reason: this.getDecisionReason(efficiency, threshold),
    };
  }

  /**
   * 获取决策原因
   */
  private getDecisionReason(efficiency: DeltaEfficiency, threshold: number): string {
    if (efficiency.targetSize === 0) {
      return '目标为空，无需增量';
    }
    if (efficiency.sourceSize === 0) {
      return '源为空，需要全量传输';
    }
    if (efficiency.compressionRatio < threshold) {
      return `压缩率 ${(efficiency.compressionRatio * 100).toFixed(1)}% 低于阈值 ${threshold * 100}%，建议使用增量`;
    }
    return `压缩率 ${(efficiency.compressionRatio * 100).toFixed(1)}% 高于阈值 ${threshold * 100}%，建议全量传输`;
  }
}

// ================================
// 类型定义
// ================================

/**
 * 差分效率评估
 */
export interface DeltaEfficiency {
  /** 压缩率 (deltaSize / targetSize) */
  readonly compressionRatio: number;
  /** 节省比例 (1 - compressionRatio) */
  readonly savings: number;
  /** 是否值得使用增量 */
  readonly worthUsing: boolean;
  /** 差分大小 */
  readonly deltaSize: number;
  /** 目标大小 */
  readonly targetSize: number;
  /** 源大小 */
  readonly sourceSize: number;
}

/**
 * 增量决策结果
 */
export interface IncrementalDecision {
  /** 是否应该使用增量 */
  readonly shouldUse: boolean;
  /** 差分结果 */
  readonly delta: BinaryDelta;
  /** 效率评估 */
  readonly efficiency: DeltaEfficiency;
  /** 决策原因 */
  readonly reason: string;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建二进制差分引擎实例
 *
 * @returns 二进制差分引擎
 */
export function createBinaryDiffEngine(): BinaryDiffEngine {
  return new BinaryDiffEngine();
}

// ================================
// 便捷函数
// ================================

// 默认实例（延迟初始化）
let defaultEngine: BinaryDiffEngine | null = null;

/**
 * 获取默认引擎
 */
function getDefaultEngine(): BinaryDiffEngine {
  if (!defaultEngine) {
    defaultEngine = new BinaryDiffEngine();
  }
  return defaultEngine;
}

/**
 * 快速计算二进制差分
 *
 * @param source 源数据
 * @param target 目标数据
 * @returns 差分结果
 */
export function quickBinaryDiff(
  source: Uint8Array | number[],
  target: Uint8Array | number[]
): BinaryDelta {
  return getDefaultEngine().diff(source, target);
}

/**
 * 快速应用二进制差分
 *
 * @param source 源数据
 * @param delta 差分数据
 * @returns 目标数据
 */
export function quickApplyBinaryDiff(
  source: Uint8Array | number[],
  delta: readonly number[]
): Uint8Array {
  return getDefaultEngine().apply(source, delta);
}

/**
 * 快速计算字符串差分（使用二进制算法）
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @returns 差分结果
 */
export function quickBinaryDiffString(source: string, target: string): BinaryDelta {
  return getDefaultEngine().diffString(source, target);
}

/**
 * 快速应用差分到字符串
 *
 * @param source 源字符串
 * @param delta 差分数据
 * @returns 目标字符串
 */
export function quickApplyBinaryDiffString(source: string, delta: readonly number[]): string {
  return getDefaultEngine().applyString(source, delta);
}

/**
 * 快速判断是否应该使用增量
 *
 * @param source 源数据
 * @param target 目标数据
 * @param threshold 阈值
 * @returns 决策结果
 */
export function quickShouldUseIncremental(
  source: Uint8Array | number[],
  target: Uint8Array | number[],
  threshold?: number
): IncrementalDecision {
  return getDefaultEngine().shouldUseIncremental(source, target, threshold);
}

/**
 * 重置默认引擎
 */
export function resetDefaultBinaryDiffEngine(): void {
  defaultEngine = null;
}

// ================================
// 导出
// ================================

export type { BinaryDelta };
