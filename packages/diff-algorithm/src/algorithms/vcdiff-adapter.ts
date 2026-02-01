// ================================
// VCDIFF/XDelta 适配器
// RFC 3284 标准的增量编码格式
// 提供接口和 fossil-delta 回退实现
// ================================

/**
 * VCDIFF (RFC 3284) 是一种通用的增量编码格式，
 * 被 xdelta、open-vcdiff 等工具使用。
 *
 * 由于纯 JavaScript 实现 VCDIFF 性能较差，
 * 本模块提供：
 * 1. 统一的接口定义
 * 2. 基于 fossil-delta 的回退实现
 * 3. 未来可接入 WASM 或原生模块
 */

import * as fossilDelta from 'fossil-delta';

// ================================
// 类型定义
// ================================

/**
 * VCDIFF 编码器接口
 */
export interface IVCDiffEncoder {
  /** 编码器名称 */
  readonly name: string;
  /** 是否为原生实现 */
  readonly isNative: boolean;
  /** 创建增量 */
  encode(source: Uint8Array, target: Uint8Array): Uint8Array;
  /** 应用增量 */
  decode(source: Uint8Array, delta: Uint8Array): Uint8Array;
  /** 获取增量大小（不实际编码） */
  estimateSize?(source: Uint8Array, target: Uint8Array): number;
}

/**
 * VCDIFF Delta 结构
 */
export interface VCDiffDelta {
  /** 原始格式数据 */
  readonly data: Uint8Array;
  /** Delta 大小 */
  readonly size: number;
  /** 源大小 */
  readonly sourceSize: number;
  /** 目标大小 */
  readonly targetSize: number;
  /** 压缩率 */
  readonly compressionRatio: number;
  /** 使用的编码器 */
  readonly encoder: string;
}

/**
 * VCDIFF 编码选项
 */
export interface VCDiffOptions {
  /** 窗口大小 */
  windowSize?: number;
  /** 压缩级别 (0-9) */
  compressionLevel?: number;
  /** 是否启用二次压缩 */
  secondaryCompression?: boolean;
}

/**
 * VCDIFF 统计信息
 */
export interface VCDiffStats {
  /** 添加指令数 */
  readonly addCount: number;
  /** 复制指令数 */
  readonly copyCount: number;
  /** 运行指令数 */
  readonly runCount: number;
  /** 添加字节数 */
  readonly addBytes: number;
  /** 复制字节数 */
  readonly copyBytes: number;
  /** 编码耗时（毫秒） */
  readonly encodeTimeMs: number;
}

// ================================
// Fossil-Delta 回退实现
// ================================

/**
 * 基于 fossil-delta 的 VCDIFF 兼容编码器
 *
 * fossil-delta 使用类似的滚动哈希算法，
 * 性能和压缩率接近 xdelta。
 */
class FossilDeltaEncoder implements IVCDiffEncoder {
  public readonly name = 'fossil-delta';
  public readonly isNative = false;

  encode(source: Uint8Array, target: Uint8Array): Uint8Array {
    const sourceArray = Array.from(source);
    const targetArray = Array.from(target);
    const delta = fossilDelta.createDelta(sourceArray, targetArray);
    return new Uint8Array(delta);
  }

  decode(source: Uint8Array, delta: Uint8Array): Uint8Array {
    const sourceArray = Array.from(source);
    const deltaArray = Array.from(delta);
    const result = fossilDelta.applyDelta(sourceArray, deltaArray);
    return new Uint8Array(result);
  }

  estimateSize(source: Uint8Array, target: Uint8Array): number {
    // 简单估算：如果内容相似，delta 大小约为变化部分
    // 这里使用实际编码来获取准确大小
    const delta = this.encode(source, target);
    return delta.length;
  }
}

// ================================
// VCDIFF 引擎
// ================================

/**
 * VCDIFF 引擎
 *
 * 提供统一的 VCDIFF 风格增量编码接口。
 * 当前使用 fossil-delta 作为后端，
 * 未来可替换为 WASM 实现的 xdelta。
 *
 * @example
 * ```typescript
 * const engine = new VCDiffEngine();
 *
 * // 创建增量
 * const delta = engine.encode(sourceData, targetData);
 * console.log(`Delta size: ${delta.size} bytes`);
 *
 * // 应用增量
 * const reconstructed = engine.decode(sourceData, delta);
 * ```
 */
export class VCDiffEngine {
  private encoder: IVCDiffEncoder;

  constructor(encoder?: IVCDiffEncoder) {
    this.encoder = encoder ?? new FossilDeltaEncoder();
  }

  /**
   * 获取当前编码器信息
   */
  getEncoderInfo(): { name: string; isNative: boolean } {
    return {
      name: this.encoder.name,
      isNative: this.encoder.isNative,
    };
  }

  /**
   * 设置编码器
   */
  setEncoder(encoder: IVCDiffEncoder): void {
    this.encoder = encoder;
  }

  /**
   * 创建 VCDIFF 增量
   */
  encode(source: Uint8Array, target: Uint8Array): VCDiffDelta {
    const data = this.encoder.encode(source, target);

    const compressionRatio = target.length > 0 ? data.length / target.length : 0;

    return {
      data,
      size: data.length,
      sourceSize: source.length,
      targetSize: target.length,
      compressionRatio,
      encoder: this.encoder.name,
    };
  }

  /**
   * 应用 VCDIFF 增量
   */
  decode(source: Uint8Array, delta: VCDiffDelta | Uint8Array): Uint8Array {
    const deltaData = delta instanceof Uint8Array ? delta : delta.data;
    return this.encoder.decode(source, deltaData);
  }

  /**
   * 从字符串创建增量
   */
  encodeString(source: string, target: string): VCDiffDelta {
    const encoder = new TextEncoder();
    return this.encode(encoder.encode(source), encoder.encode(target));
  }

  /**
   * 将增量应用到字符串
   */
  decodeString(source: string, delta: VCDiffDelta | Uint8Array): string {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const result = this.decode(encoder.encode(source), delta);
    return decoder.decode(result);
  }

  /**
   * 验证增量是否有效
   */
  validate(source: Uint8Array, target: Uint8Array, delta: VCDiffDelta | Uint8Array): boolean {
    try {
      const reconstructed = this.decode(source, delta);
      if (reconstructed.length !== target.length) {
        return false;
      }
      for (let i = 0; i < target.length; i++) {
        if (reconstructed[i] !== target[i]) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 判断是否应该使用增量编码
   */
  shouldUseIncremental(
    source: Uint8Array,
    target: Uint8Array,
    threshold: number = 0.5
  ): IncrementalDecision {
    // 边界情况
    if (source.length === 0 || target.length === 0) {
      return {
        shouldUse: false,
        reason: source.length === 0 ? 'Empty source' : 'Empty target',
        estimatedRatio: 1,
      };
    }

    // 计算增量
    const delta = this.encode(source, target);

    const shouldUse = delta.compressionRatio < threshold;
    const reason = shouldUse
      ? `Compression ratio ${(delta.compressionRatio * 100).toFixed(1)}% is below threshold ${threshold * 100}%`
      : `Compression ratio ${(delta.compressionRatio * 100).toFixed(1)}% exceeds threshold ${threshold * 100}%`;

    return {
      shouldUse,
      reason,
      estimatedRatio: delta.compressionRatio,
      delta: shouldUse ? delta : undefined,
    };
  }

  /**
   * 批量编码（多个目标版本共享同一源）
   */
  encodeBatch(source: Uint8Array, targets: Uint8Array[]): VCDiffDelta[] {
    return targets.map((target) => this.encode(source, target));
  }

  /**
   * 链式编码（每个版本基于前一个）
   */
  encodeChain(versions: Uint8Array[]): VCDiffDelta[] {
    if (versions.length < 2) {
      return [];
    }

    const deltas: VCDiffDelta[] = [];
    for (let i = 1; i < versions.length; i++) {
      deltas.push(this.encode(versions[i - 1], versions[i]));
    }
    return deltas;
  }

  /**
   * 应用增量链重建最终版本
   */
  decodeChain(initial: Uint8Array, deltas: (VCDiffDelta | Uint8Array)[]): Uint8Array {
    let current = initial;
    for (const delta of deltas) {
      current = this.decode(current, delta);
    }
    return current;
  }
}

/**
 * 增量决策结果
 */
export interface IncrementalDecision {
  /** 是否应该使用增量 */
  readonly shouldUse: boolean;
  /** 决策原因 */
  readonly reason: string;
  /** 估算的压缩率 */
  readonly estimatedRatio: number;
  /** 如果决定使用，返回计算好的增量 */
  readonly delta?: VCDiffDelta;
}

// ================================
// WASM 适配器（预留接口）
// ================================

/**
 * WASM XDelta 编码器（预留接口）
 *
 * 当有可用的 xdelta WASM 模块时，可以实现此类：
 *
 * ```typescript
 * class WasmXDeltaEncoder implements IVCDiffEncoder {
 *   readonly name = 'xdelta-wasm';
 *   readonly isNative = true;
 *   private wasm: any;
 *
 *   async init() {
 *     this.wasm = await loadXDeltaWasm();
 *   }
 *
 *   encode(source: Uint8Array, target: Uint8Array): Uint8Array {
 *     return this.wasm.encode(source, target);
 *   }
 *
 *   decode(source: Uint8Array, delta: Uint8Array): Uint8Array {
 *     return this.wasm.decode(source, delta);
 *   }
 * }
 * ```
 */

/**
 * 创建 WASM 编码器的占位函数
 * 返回 null 表示 WASM 不可用，回退到 fossil-delta
 */
export async function createWasmEncoder(): Promise<IVCDiffEncoder | null> {
  // TODO: 实现 WASM 加载
  // 当前返回 null，使用回退实现
  return null;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 VCDIFF 引擎
 */
export function createVCDiffEngine(): VCDiffEngine {
  return new VCDiffEngine();
}

/**
 * 创建并初始化最优 VCDIFF 引擎
 * 尝试加载 WASM 实现，失败则使用 fossil-delta
 */
export async function createOptimalVCDiffEngine(): Promise<VCDiffEngine> {
  const wasmEncoder = await createWasmEncoder();
  return new VCDiffEngine(wasmEncoder ?? undefined);
}

// ================================
// 便捷函数
// ================================

let defaultEngine: VCDiffEngine | null = null;

function getDefaultEngine(): VCDiffEngine {
  if (!defaultEngine) {
    defaultEngine = new VCDiffEngine();
  }
  return defaultEngine;
}

/**
 * 快速创建增量
 */
export function quickVCDiffEncode(source: Uint8Array, target: Uint8Array): VCDiffDelta {
  return getDefaultEngine().encode(source, target);
}

/**
 * 快速应用增量
 */
export function quickVCDiffDecode(source: Uint8Array, delta: VCDiffDelta | Uint8Array): Uint8Array {
  return getDefaultEngine().decode(source, delta);
}

/**
 * 快速字符串增量
 */
export function quickVCDiffString(source: string, target: string): VCDiffDelta {
  return getDefaultEngine().encodeString(source, target);
}

/**
 * 快速字符串解码
 */
export function quickVCDiffDecodeString(source: string, delta: VCDiffDelta | Uint8Array): string {
  return getDefaultEngine().decodeString(source, delta);
}

/**
 * 重置默认引擎
 */
export function resetDefaultVCDiffEngine(): void {
  defaultEngine = null;
}
