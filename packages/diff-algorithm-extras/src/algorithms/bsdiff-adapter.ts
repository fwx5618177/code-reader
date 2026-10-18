// ================================
// BSDiff 适配器
// 针对可执行文件和软件更新优化的增量算法
// 提供接口和简化实现
// ================================

/**
 * BSDiff 是 FreeBSD 的增量更新算法，特点：
 * - 极高的压缩率（特别是对可执行文件）
 * - 使用后缀排序实现快速匹配
 * - 广泛用于软件更新（Chrome、Firefox 等）
 *
 * 由于完整的 bsdiff 需要原生实现，
 * 本模块提供：
 * 1. 统一的接口定义
 * 2. 基于块匹配的简化实现
 * 3. 未来可接入 WASM 或原生模块
 */

import * as fossilDelta from 'fossil-delta';

// ================================
// 类型定义
// ================================

/**
 * BSDiff 编码器接口
 */
export interface IBSDiffEncoder {
  /** 编码器名称 */
  readonly name: string;
  /** 是否为原生实现 */
  readonly isNative: boolean;
  /** 支持的压缩格式 */
  readonly compressionFormat: 'bzip2' | 'lzma' | 'none';
  /** 创建补丁 */
  diff(oldData: Uint8Array, newData: Uint8Array): Promise<Uint8Array>;
  /** 应用补丁 */
  patch(oldData: Uint8Array, patchData: Uint8Array): Promise<Uint8Array>;
}

/**
 * BSDiff 补丁结构
 */
export interface BSDiffPatch {
  /** 补丁数据 */
  readonly data: Uint8Array;
  /** 补丁大小 */
  readonly size: number;
  /** 原始文件大小 */
  readonly oldSize: number;
  /** 新文件大小 */
  readonly newSize: number;
  /** 压缩率 */
  readonly compressionRatio: number;
  /** 使用的编码器 */
  readonly encoder: string;
  /** 创建时间 */
  readonly createdAt: number;
}

/**
 * BSDiff 配置选项
 */
export interface BSDiffOptions {
  /** 最小匹配长度 */
  minMatchLength?: number;
  /** 块大小（用于简化实现） */
  blockSize?: number;
  /** 是否启用压缩 */
  compress?: boolean;
}

/**
 * BSDiff 统计信息
 */
export interface BSDiffStats {
  /** 控制块大小 */
  readonly controlSize: number;
  /** 差分块大小 */
  readonly diffSize: number;
  /** 额外数据大小 */
  readonly extraSize: number;
  /** 匹配块数 */
  readonly matchCount: number;
  /** 编码耗时（毫秒） */
  readonly encodeTimeMs: number;
}

// ================================
// 默认配置
// ================================

const DEFAULT_OPTIONS: Required<BSDiffOptions> = {
  minMatchLength: 8,
  blockSize: 512,
  compress: false,
};

// ================================
// 简化实现（使用 fossil-delta 作为后端）
// ================================

/**
 * 基于 fossil-delta 的 BSDiff 兼容编码器
 *
 * 这是一个简化实现，不是真正的 bsdiff 算法，
 * 但提供类似的接口和可接受的性能。
 *
 * 真正的 bsdiff 优势在于：
 * 1. 后缀排序实现 O(n log n) 的匹配
 * 2. 对可执行文件的特殊优化（处理地址重定位）
 * 3. 更好的压缩率（通常比 fossil-delta 好 20-40%）
 */
class SimplifiedBSDiffEncoder implements IBSDiffEncoder {
  public readonly name = 'simplified-bsdiff';
  public readonly isNative = false;
  public readonly compressionFormat = 'none' as const;

  private readonly options: Required<BSDiffOptions>;

  constructor(options: BSDiffOptions = {}) {
    // 选项保留用于未来扩展（如压缩级别、块大小等）
    this.options = { ...DEFAULT_OPTIONS, ...options };
    void this.options; // 抑制未使用警告
  }

  async diff(oldData: Uint8Array, newData: Uint8Array): Promise<Uint8Array> {
    // 使用 fossil-delta 作为核心差分算法
    const oldArray = Array.from(oldData);
    const newArray = Array.from(newData);
    const delta = fossilDelta.createDelta(oldArray, newArray);

    // 添加 bsdiff 兼容的头部
    const header = this.createHeader(oldData.length, newData.length, delta.length);
    const result = new Uint8Array(header.length + delta.length);
    result.set(header, 0);
    result.set(new Uint8Array(delta), header.length);

    return result;
  }

  async patch(oldData: Uint8Array, patchData: Uint8Array): Promise<Uint8Array> {
    // 解析头部
    const { deltaOffset } = this.parseHeader(patchData);

    // 提取 delta 数据
    const deltaData = patchData.slice(deltaOffset);

    // 应用 delta
    const oldArray = Array.from(oldData);
    const deltaArray = Array.from(deltaData);
    const result = fossilDelta.applyDelta(oldArray, deltaArray);

    return new Uint8Array(result);
  }

  /**
   * 创建 bsdiff 风格的头部
   * 格式：BSDIFF40 + oldSize(8) + newSize(8) + deltaSize(8)
   */
  private createHeader(oldSize: number, newSize: number, deltaSize: number): Uint8Array {
    const header = new Uint8Array(32);
    const view = new DataView(header.buffer);

    // Magic: "BSDIFF40" (简化版标识)
    const magic = 'BSDIFF40';
    for (let i = 0; i < 8; i++) {
      header[i] = magic.charCodeAt(i);
    }

    // 文件大小（小端序）
    view.setBigInt64(8, BigInt(oldSize), true);
    view.setBigInt64(16, BigInt(newSize), true);
    view.setBigInt64(24, BigInt(deltaSize), true);

    return header;
  }

  /**
   * 解析头部
   */
  private parseHeader(data: Uint8Array): {
    oldSize: number;
    newSize: number;
    deltaSize: number;
    deltaOffset: number;
  } {
    if (data.length < 32) {
      throw new Error('Invalid bsdiff patch: header too short');
    }

    // 验证 magic
    const magic = String.fromCharCode(...data.slice(0, 8));
    if (magic !== 'BSDIFF40') {
      throw new Error(`Invalid bsdiff patch: bad magic "${magic}"`);
    }

    const view = new DataView(data.buffer, data.byteOffset);
    const oldSize = Number(view.getBigInt64(8, true));
    const newSize = Number(view.getBigInt64(16, true));
    const deltaSize = Number(view.getBigInt64(24, true));

    return {
      oldSize,
      newSize,
      deltaSize,
      deltaOffset: 32,
    };
  }
}

// ================================
// BSDiff 引擎
// ================================

/**
 * BSDiff 引擎
 *
 * 提供统一的 bsdiff 风格增量编码接口。
 * 特别适合软件更新场景。
 *
 * @example
 * ```typescript
 * const engine = new BSDiffEngine();
 *
 * // 创建补丁
 * const patch = await engine.createPatch(oldBinary, newBinary);
 * console.log(`Patch size: ${patch.size} bytes`);
 * console.log(`Compression: ${(1 - patch.compressionRatio) * 100}% saved`);
 *
 * // 应用补丁
 * const updated = await engine.applyPatch(oldBinary, patch);
 * ```
 */
export class BSDiffEngine {
  private encoder: IBSDiffEncoder;

  constructor(encoder?: IBSDiffEncoder, options?: BSDiffOptions) {
    this.encoder = encoder ?? new SimplifiedBSDiffEncoder(options);
  }

  /**
   * 获取编码器信息
   */
  getEncoderInfo(): { name: string; isNative: boolean; compressionFormat: string } {
    return {
      name: this.encoder.name,
      isNative: this.encoder.isNative,
      compressionFormat: this.encoder.compressionFormat,
    };
  }

  /**
   * 设置编码器
   */
  setEncoder(encoder: IBSDiffEncoder): void {
    this.encoder = encoder;
  }

  /**
   * 创建 bsdiff 补丁
   */
  async createPatch(oldData: Uint8Array, newData: Uint8Array): Promise<BSDiffPatch> {
    const data = await this.encoder.diff(oldData, newData);

    const compressionRatio = newData.length > 0 ? data.length / newData.length : 0;

    return {
      data,
      size: data.length,
      oldSize: oldData.length,
      newSize: newData.length,
      compressionRatio,
      encoder: this.encoder.name,
      createdAt: Date.now(),
    };
  }

  /**
   * 应用 bsdiff 补丁
   */
  async applyPatch(oldData: Uint8Array, patch: BSDiffPatch | Uint8Array): Promise<Uint8Array> {
    const patchData = patch instanceof Uint8Array ? patch : patch.data;
    return this.encoder.patch(oldData, patchData);
  }

  /**
   * 验证补丁
   */
  async validate(
    oldData: Uint8Array,
    newData: Uint8Array,
    patch: BSDiffPatch | Uint8Array
  ): Promise<boolean> {
    try {
      const reconstructed = await this.applyPatch(oldData, patch);

      if (reconstructed.length !== newData.length) {
        return false;
      }

      for (let i = 0; i < newData.length; i++) {
        if (reconstructed[i] !== newData[i]) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 估算补丁效率
   */
  async estimateEfficiency(
    oldData: Uint8Array,
    newData: Uint8Array
  ): Promise<BSDiffEfficiencyEstimate> {
    const patch = await this.createPatch(oldData, newData);

    const savings = newData.length > 0 ? 1 - patch.compressionRatio : 0;
    const worthUsing = savings > 0.1; // 节省超过 10% 才值得

    return {
      patchSize: patch.size,
      oldSize: oldData.length,
      newSize: newData.length,
      savings,
      worthUsing,
      recommendation: this.getRecommendation(savings, oldData.length, newData.length),
    };
  }

  /**
   * 获取使用建议
   */
  private getRecommendation(savings: number, oldSize: number, newSize: number): string {
    if (oldSize === 0) {
      return 'No old data, use full transfer';
    }
    if (newSize === 0) {
      return 'Target is empty, no transfer needed';
    }
    if (savings > 0.5) {
      return 'Highly recommended: significant savings';
    }
    if (savings > 0.2) {
      return 'Recommended: moderate savings';
    }
    if (savings > 0.1) {
      return 'Marginal benefit: small savings';
    }
    return 'Not recommended: consider full transfer';
  }

  /**
   * 批量创建补丁（多个新版本，共同旧版本）
   */
  async createBatchPatches(oldData: Uint8Array, newVersions: Uint8Array[]): Promise<BSDiffPatch[]> {
    const patches: BSDiffPatch[] = [];
    for (const newData of newVersions) {
      patches.push(await this.createPatch(oldData, newData));
    }
    return patches;
  }

  /**
   * 创建增量更新链
   */
  async createUpdateChain(versions: Uint8Array[]): Promise<UpdateChainResult> {
    if (versions.length < 2) {
      return {
        patches: [],
        totalSize: 0,
        fullSize: versions.reduce((sum, v) => sum + v.length, 0),
        savings: 0,
      };
    }

    const patches: BSDiffPatch[] = [];
    let totalPatchSize = 0;

    for (let i = 1; i < versions.length; i++) {
      const patch = await this.createPatch(versions[i - 1], versions[i]);
      patches.push(patch);
      totalPatchSize += patch.size;
    }

    // 计算全量传输大小（除了第一个版本）
    const fullSize = versions.slice(1).reduce((sum, v) => sum + v.length, 0);
    const savings = fullSize > 0 ? 1 - totalPatchSize / fullSize : 0;

    return {
      patches,
      totalSize: totalPatchSize,
      fullSize,
      savings,
    };
  }

  /**
   * 应用更新链
   */
  async applyUpdateChain(
    initialVersion: Uint8Array,
    patches: (BSDiffPatch | Uint8Array)[]
  ): Promise<Uint8Array> {
    let current = initialVersion;
    for (const patch of patches) {
      current = await this.applyPatch(current, patch);
    }
    return current;
  }
}

/**
 * 效率估算结果
 */
export interface BSDiffEfficiencyEstimate {
  /** 补丁大小 */
  readonly patchSize: number;
  /** 旧文件大小 */
  readonly oldSize: number;
  /** 新文件大小 */
  readonly newSize: number;
  /** 节省比例 (0-1) */
  readonly savings: number;
  /** 是否值得使用 */
  readonly worthUsing: boolean;
  /** 使用建议 */
  readonly recommendation: string;
}

/**
 * 更新链结果
 */
export interface UpdateChainResult {
  /** 补丁列表 */
  readonly patches: readonly BSDiffPatch[];
  /** 总补丁大小 */
  readonly totalSize: number;
  /** 全量传输大小 */
  readonly fullSize: number;
  /** 节省比例 */
  readonly savings: number;
}

// ================================
// WASM 适配器（预留接口）
// ================================

/**
 * 创建 WASM 编码器的占位函数
 * 返回 null 表示 WASM 不可用
 */
export async function createWasmBSDiffEncoder(): Promise<IBSDiffEncoder | null> {
  // TODO: 实现 WASM 加载
  // 当前返回 null，使用回退实现
  return null;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 BSDiff 引擎
 */
export function createBSDiffEngine(options?: BSDiffOptions): BSDiffEngine {
  return new BSDiffEngine(undefined, options);
}

/**
 * 创建并初始化最优 BSDiff 引擎
 */
export async function createOptimalBSDiffEngine(options?: BSDiffOptions): Promise<BSDiffEngine> {
  const wasmEncoder = await createWasmBSDiffEncoder();
  return new BSDiffEngine(wasmEncoder ?? undefined, options);
}

/**
 * 创建适合软件更新的 BSDiff 引擎
 */
export function createSoftwareUpdateEngine(): BSDiffEngine {
  return new BSDiffEngine(undefined, {
    minMatchLength: 16,
    blockSize: 1024,
    compress: true,
  });
}

// ================================
// 便捷函数
// ================================

let defaultEngine: BSDiffEngine | null = null;

function getDefaultEngine(): BSDiffEngine {
  if (!defaultEngine) {
    defaultEngine = new BSDiffEngine();
  }
  return defaultEngine;
}

/**
 * 快速创建补丁
 */
export async function quickBSDiffPatch(
  oldData: Uint8Array,
  newData: Uint8Array
): Promise<BSDiffPatch> {
  return getDefaultEngine().createPatch(oldData, newData);
}

/**
 * 快速应用补丁
 */
export async function quickBSDiffApply(
  oldData: Uint8Array,
  patch: BSDiffPatch | Uint8Array
): Promise<Uint8Array> {
  return getDefaultEngine().applyPatch(oldData, patch);
}

/**
 * 快速验证补丁
 */
export async function quickBSDiffValidate(
  oldData: Uint8Array,
  newData: Uint8Array,
  patch: BSDiffPatch | Uint8Array
): Promise<boolean> {
  return getDefaultEngine().validate(oldData, newData, patch);
}

/**
 * 快速估算效率
 */
export async function quickBSDiffEstimate(
  oldData: Uint8Array,
  newData: Uint8Array
): Promise<BSDiffEfficiencyEstimate> {
  return getDefaultEngine().estimateEfficiency(oldData, newData);
}

/**
 * 重置默认引擎
 */
export function resetDefaultBSDiffEngine(): void {
  defaultEngine = null;
}
