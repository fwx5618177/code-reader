// ================================
// Rsync 算法实现
// 基于滚动哈希和签名的增量同步算法
// 适用于网络文件同步、大文件增量传输
// ================================

import {
  Adler32RollingHash,
  type IRollingHash,
  type ChunkConfig,
  ContentDefinedChunker,
} from './rolling-hash';

// ================================
// 类型定义
// ================================

/**
 * 块签名（弱哈希 + 强哈希）
 */
export interface BlockSignature {
  /** 块索引 */
  readonly index: number;
  /** 块偏移量 */
  readonly offset: number;
  /** 块大小 */
  readonly size: number;
  /** 弱哈希（Adler32，用于快速查找） */
  readonly weakHash: number;
  /** 强哈希（MD5/SHA1 简化版，用于确认） */
  readonly strongHash: number;
}

/**
 * 文件签名（所有块的签名集合）
 */
export interface FileSignature {
  /** 块大小 */
  readonly blockSize: number;
  /** 文件总大小 */
  readonly fileSize: number;
  /** 块数量 */
  readonly blockCount: number;
  /** 所有块签名 */
  readonly signatures: readonly BlockSignature[];
  /** 签名创建时间 */
  readonly createdAt: number;
}

/**
 * Delta 指令类型
 */
export type DeltaInstructionType = 'copy' | 'literal';

/**
 * Delta 指令
 */
export interface DeltaInstruction {
  /** 指令类型 */
  readonly type: DeltaInstructionType;
  /** copy: 源文件中的块索引; literal: 无意义 */
  readonly blockIndex?: number;
  /** copy: 源文件中的偏移; literal: 无意义 */
  readonly offset?: number;
  /** 长度（copy: 块大小; literal: 数据长度） */
  readonly length: number;
  /** literal 指令的数据 */
  readonly data?: Uint8Array;
}

/**
 * Rsync Delta（差分结果）
 */
export interface RsyncDelta {
  /** 目标文件大小 */
  readonly targetSize: number;
  /** 源文件大小 */
  readonly sourceSize: number;
  /** 使用的块大小 */
  readonly blockSize: number;
  /** Delta 指令列表 */
  readonly instructions: readonly DeltaInstruction[];
  /** 统计信息 */
  readonly stats: RsyncStats;
}

/**
 * Rsync 统计信息
 */
export interface RsyncStats {
  /** 匹配的块数 */
  readonly matchedBlocks: number;
  /** 未匹配的字节数 */
  readonly literalBytes: number;
  /** 总块数 */
  readonly totalBlocks: number;
  /** 匹配率 (0-1) */
  readonly matchRatio: number;
  /** 压缩率（delta 大小 / 目标大小） */
  readonly compressionRatio: number;
  /** 计算耗时（毫秒） */
  readonly computeTimeMs: number;
}

/**
 * Rsync 配置
 */
export interface RsyncConfig {
  /** 块大小（默认 2048） */
  blockSize?: number;
  /** 最大块大小（可变块大小时） */
  maxBlockSize?: number;
  /** 使用内容定义分块（CDC） */
  useContentDefinedChunking?: boolean;
  /** CDC 配置 */
  cdcConfig?: Partial<ChunkConfig>;
  /** 强哈希算法（简化版） */
  strongHashAlgorithm?: 'djb2' | 'fnv1a' | 'murmur';
}

// ================================
// 常量
// ================================

const DEFAULT_BLOCK_SIZE = 2048;
const DEFAULT_CONFIG: Required<RsyncConfig> = {
  blockSize: DEFAULT_BLOCK_SIZE,
  maxBlockSize: 65536,
  useContentDefinedChunking: false,
  cdcConfig: {},
  strongHashAlgorithm: 'fnv1a',
};

// ================================
// 强哈希算法（纯 JS 实现）
// ================================

/**
 * DJB2 哈希算法
 */
function djb2Hash(data: Uint8Array): number {
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash + data[i]) >>> 0;
  }
  return hash;
}

/**
 * FNV-1a 哈希算法
 */
function fnv1aHash(data: Uint8Array): number {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

/**
 * MurmurHash3 (简化版 32 位)
 */
function murmurHash3(data: Uint8Array): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h1 = 0;

  const len = data.length;
  const nblocks = Math.floor(len / 4);

  // Body
  for (let i = 0; i < nblocks; i++) {
    const i4 = i * 4;
    let k1 = (data[i4] | (data[i4 + 1] << 8) | (data[i4 + 2] << 16) | (data[i4 + 3] << 24)) >>> 0;

    k1 = Math.imul(k1, c1) >>> 0;
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2) >>> 0;

    h1 ^= k1;
    h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }

  // Tail
  let k1 = 0;
  const tail = nblocks * 4;
  switch (len & 3) {
    case 3:
      k1 ^= data[tail + 2] << 16;
      k1 ^= data[tail + 1] << 8;
      k1 ^= data[tail];
      break;
    case 2:
      k1 ^= data[tail + 1] << 8;
      k1 ^= data[tail];
      break;
    case 1:
      k1 ^= data[tail];
      break;
    default:
      break;
  }
  if ((len & 3) !== 0) {
    k1 = Math.imul(k1, c1) >>> 0;
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2) >>> 0;
    h1 ^= k1;
  }

  // Finalization
  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b) >>> 0;
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35) >>> 0;
  h1 ^= h1 >>> 16;

  return h1;
}

/**
 * 获取强哈希函数
 */
function getStrongHashFn(
  algorithm: RsyncConfig['strongHashAlgorithm']
): (data: Uint8Array) => number {
  switch (algorithm) {
    case 'djb2':
      return djb2Hash;
    case 'murmur':
      return murmurHash3;
    case 'fnv1a':
    default:
      return fnv1aHash;
  }
}

// ================================
// RsyncEngine 类
// ================================

/**
 * Rsync 同步引擎
 *
 * 实现 rsync 算法的核心逻辑：
 * 1. 生成文件签名（源文件的块哈希集合）
 * 2. 计算 Delta（比较目标文件和签名）
 * 3. 应用 Delta（重建目标文件）
 *
 * @example
 * ```typescript
 * const engine = new RsyncEngine();
 *
 * // 在源端生成签名
 * const signature = engine.generateSignature(sourceData);
 *
 * // 在目标端计算 delta
 * const delta = engine.computeDelta(targetData, signature);
 *
 * // 在源端应用 delta
 * const reconstructed = engine.applyDelta(sourceData, delta);
 * // reconstructed 应该等于 targetData
 * ```
 */
export class RsyncEngine {
  private readonly config: Required<RsyncConfig>;
  private readonly weakHasher: IRollingHash;
  private readonly strongHashFn: (data: Uint8Array) => number;
  private readonly chunker?: ContentDefinedChunker;

  constructor(config: RsyncConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.weakHasher = new Adler32RollingHash(this.config.blockSize);
    this.strongHashFn = getStrongHashFn(this.config.strongHashAlgorithm);

    if (this.config.useContentDefinedChunking) {
      this.chunker = new ContentDefinedChunker(this.config.cdcConfig);
    }
  }

  // ================================
  // 签名生成
  // ================================

  /**
   * 生成文件签名
   *
   * 将文件分成固定大小的块，计算每块的弱哈希和强哈希。
   *
   * @param data 源文件数据
   * @returns 文件签名
   */
  generateSignature(data: Uint8Array): FileSignature {
    const { blockSize } = this.config;
    const signatures: BlockSignature[] = [];
    const fileSize = data.length;
    const blockCount = Math.ceil(fileSize / blockSize);

    for (let i = 0; i < blockCount; i++) {
      const offset = i * blockSize;
      const size = Math.min(blockSize, fileSize - offset);
      const blockData = data.slice(offset, offset + size);

      signatures.push({
        index: i,
        offset,
        size,
        weakHash: this.weakHasher.hash(blockData),
        strongHash: this.strongHashFn(blockData),
      });
    }

    return {
      blockSize,
      fileSize,
      blockCount,
      signatures,
      createdAt: Date.now(),
    };
  }

  /**
   * 使用内容定义分块生成签名
   * 块边界由内容决定，相似文件会有更多匹配块
   */
  generateCDCSignature(data: Uint8Array): FileSignature {
    if (!this.chunker) {
      // 回退到固定大小分块
      return this.generateSignature(data);
    }

    const chunks = this.chunker.chunk(data);
    const signatures: BlockSignature[] = chunks.map((chunk, index) => ({
      index,
      offset: chunk.offset,
      size: chunk.size,
      weakHash: this.weakHasher.hash(chunk.data),
      strongHash: this.strongHashFn(chunk.data),
    }));

    return {
      blockSize: this.config.blockSize, // 参考值
      fileSize: data.length,
      blockCount: chunks.length,
      signatures,
      createdAt: Date.now(),
    };
  }

  // ================================
  // Delta 计算
  // ================================

  /**
   * 计算 Delta
   *
   * 扫描目标文件，寻找与签名匹配的块。
   * 对于匹配的块，生成 copy 指令；
   * 对于不匹配的数据，生成 literal 指令。
   *
   * @param targetData 目标文件数据
   * @param signature 源文件签名
   * @returns Rsync Delta
   */
  computeDelta(targetData: Uint8Array, signature: FileSignature): RsyncDelta {
    const startTime = performance.now();
    const { blockSize } = signature;
    const targetSize = targetData.length;

    // 构建弱哈希到签名的映射（用于快速查找）
    const weakHashMap = new Map<number, BlockSignature[]>();
    for (const sig of signature.signatures) {
      const existing = weakHashMap.get(sig.weakHash) || [];
      existing.push(sig);
      weakHashMap.set(sig.weakHash, existing);
    }

    const instructions: DeltaInstruction[] = [];
    let pos = 0;
    let literalStart = -1; // 当前 literal 段的起始位置
    let matchedBlocks = 0;
    let literalBytes = 0;

    // 使用滚动哈希扫描目标文件
    const rollingHasher = new Adler32RollingHash(blockSize);

    while (pos <= targetSize - blockSize) {
      // 计算当前位置的弱哈希
      const hash =
        pos === 0 || literalStart !== -1
          ? rollingHasher.init(targetData, pos, blockSize)
          : rollingHasher.roll(
              rollingHasher.init(targetData, pos - 1, blockSize),
              targetData[pos - 1],
              targetData[pos + blockSize - 1]
            );

      // 查找匹配的块
      const candidates = weakHashMap.get(hash);
      let matched = false;

      if (candidates) {
        const blockData = targetData.slice(pos, pos + blockSize);
        const strongHash = this.strongHashFn(blockData);

        for (const candidate of candidates) {
          if (candidate.strongHash === strongHash && candidate.size === blockSize) {
            // 找到匹配！

            // 先输出之前的 literal 数据
            if (literalStart !== -1 && literalStart < pos) {
              const literalData = targetData.slice(literalStart, pos);
              instructions.push({
                type: 'literal',
                length: literalData.length,
                data: literalData,
              });
              literalBytes += literalData.length;
              literalStart = -1;
            }

            // 输出 copy 指令
            instructions.push({
              type: 'copy',
              blockIndex: candidate.index,
              offset: candidate.offset,
              length: blockSize,
            });
            matchedBlocks++;
            pos += blockSize;
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        // 没有匹配，记录为 literal
        if (literalStart === -1) {
          literalStart = pos;
        }
        pos++;
      }
    }

    // 处理剩余的 literal 数据
    if (literalStart !== -1 || pos < targetSize) {
      const start = literalStart !== -1 ? literalStart : pos;
      const literalData = targetData.slice(start, targetSize);
      if (literalData.length > 0) {
        instructions.push({
          type: 'literal',
          length: literalData.length,
          data: literalData,
        });
        literalBytes += literalData.length;
      }
    }

    const endTime = performance.now();

    // 计算 delta 大小（简化估算）
    let deltaSize = 0;
    for (const inst of instructions) {
      if (inst.type === 'copy') {
        deltaSize += 8; // 指令类型 + 偏移 + 长度
      } else {
        deltaSize += 4 + (inst.data?.length || 0); // 指令类型 + 长度 + 数据
      }
    }

    const stats: RsyncStats = {
      matchedBlocks,
      literalBytes,
      totalBlocks: signature.blockCount,
      matchRatio: signature.blockCount > 0 ? matchedBlocks / signature.blockCount : 0,
      compressionRatio: targetSize > 0 ? deltaSize / targetSize : 0,
      computeTimeMs: endTime - startTime,
    };

    return {
      targetSize,
      sourceSize: signature.fileSize,
      blockSize,
      instructions,
      stats,
    };
  }

  // ================================
  // Delta 应用
  // ================================

  /**
   * 应用 Delta 重建目标文件
   *
   * @param sourceData 源文件数据
   * @param delta Rsync Delta
   * @returns 重建的目标文件
   */
  applyDelta(sourceData: Uint8Array, delta: RsyncDelta): Uint8Array {
    const result = new Uint8Array(delta.targetSize);
    let offset = 0;

    for (const instruction of delta.instructions) {
      if (instruction.type === 'copy') {
        // 从源文件复制块
        const srcOffset = instruction.offset!;
        const length = instruction.length;
        result.set(sourceData.slice(srcOffset, srcOffset + length), offset);
        offset += length;
      } else {
        // 写入 literal 数据
        result.set(instruction.data!, offset);
        offset += instruction.length;
      }
    }

    return result;
  }

  // ================================
  // 便捷方法
  // ================================

  /**
   * 一步完成同步（计算差分并应用）
   *
   * @param sourceData 源数据
   * @param targetData 目标数据
   * @returns 同步结果
   */
  sync(sourceData: Uint8Array, targetData: Uint8Array): RsyncSyncResult {
    const signature = this.generateSignature(sourceData);
    const delta = this.computeDelta(targetData, signature);
    const reconstructed = this.applyDelta(sourceData, delta);

    // 验证重建结果
    const isValid = this.verifyResult(targetData, reconstructed);

    return {
      signature,
      delta,
      reconstructed,
      isValid,
    };
  }

  /**
   * 验证重建结果是否正确
   */
  verifyResult(expected: Uint8Array, actual: Uint8Array): boolean {
    if (expected.length !== actual.length) {
      return false;
    }
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * 估算同步效率
   */
  estimateEfficiency(sourceData: Uint8Array, targetData: Uint8Array): RsyncEfficiencyEstimate {
    const signature = this.generateSignature(sourceData);
    const delta = this.computeDelta(targetData, signature);

    const signatureSize = signature.blockCount * 12; // 约 12 字节/签名
    let deltaSize = 0;
    for (const inst of delta.instructions) {
      deltaSize += inst.type === 'copy' ? 8 : 4 + inst.length;
    }

    const fullTransferSize = targetData.length;
    const rsyncTransferSize = signatureSize + deltaSize;
    const savings = 1 - rsyncTransferSize / fullTransferSize;

    return {
      signatureSize,
      deltaSize,
      fullTransferSize,
      rsyncTransferSize,
      savings,
      worthUsing: savings > 0.2, // 节省超过 20% 才值得
      stats: delta.stats,
    };
  }
}

/**
 * 同步结果
 */
export interface RsyncSyncResult {
  readonly signature: FileSignature;
  readonly delta: RsyncDelta;
  readonly reconstructed: Uint8Array;
  readonly isValid: boolean;
}

/**
 * 效率估算结果
 */
export interface RsyncEfficiencyEstimate {
  /** 签名大小（字节） */
  readonly signatureSize: number;
  /** Delta 大小（字节） */
  readonly deltaSize: number;
  /** 全量传输大小 */
  readonly fullTransferSize: number;
  /** Rsync 传输大小 */
  readonly rsyncTransferSize: number;
  /** 节省比例 (0-1) */
  readonly savings: number;
  /** 是否值得使用 rsync */
  readonly worthUsing: boolean;
  /** 统计信息 */
  readonly stats: RsyncStats;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Rsync 引擎
 */
export function createRsyncEngine(config?: RsyncConfig): RsyncEngine {
  return new RsyncEngine(config);
}

/**
 * 创建高性能 Rsync 引擎（大块、少计算）
 */
export function createFastRsyncEngine(): RsyncEngine {
  return new RsyncEngine({
    blockSize: 8192,
    strongHashAlgorithm: 'djb2',
  });
}

/**
 * 创建高精度 Rsync 引擎（小块、更多匹配）
 */
export function createPreciseRsyncEngine(): RsyncEngine {
  return new RsyncEngine({
    blockSize: 512,
    strongHashAlgorithm: 'murmur',
  });
}

/**
 * 创建 CDC Rsync 引擎（内容定义分块）
 */
export function createCDCRsyncEngine(cdcConfig?: Partial<ChunkConfig>): RsyncEngine {
  return new RsyncEngine({
    useContentDefinedChunking: true,
    cdcConfig,
  });
}

// ================================
// 便捷函数
// ================================

let defaultEngine: RsyncEngine | null = null;

function getDefaultEngine(): RsyncEngine {
  if (!defaultEngine) {
    defaultEngine = new RsyncEngine();
  }
  return defaultEngine;
}

/**
 * 快速生成签名
 */
export function quickSignature(data: Uint8Array): FileSignature {
  return getDefaultEngine().generateSignature(data);
}

/**
 * 快速计算 Delta
 */
export function quickRsyncDelta(targetData: Uint8Array, signature: FileSignature): RsyncDelta {
  return getDefaultEngine().computeDelta(targetData, signature);
}

/**
 * 快速应用 Delta
 */
export function quickApplyRsyncDelta(sourceData: Uint8Array, delta: RsyncDelta): Uint8Array {
  return getDefaultEngine().applyDelta(sourceData, delta);
}

/**
 * 快速同步
 */
export function quickRsync(sourceData: Uint8Array, targetData: Uint8Array): RsyncSyncResult {
  return getDefaultEngine().sync(sourceData, targetData);
}

/**
 * 快速估算效率
 */
export function quickRsyncEfficiency(
  sourceData: Uint8Array,
  targetData: Uint8Array
): RsyncEfficiencyEstimate {
  return getDefaultEngine().estimateEfficiency(sourceData, targetData);
}

/**
 * 重置默认引擎
 */
export function resetDefaultRsyncEngine(): void {
  defaultEngine = null;
}
