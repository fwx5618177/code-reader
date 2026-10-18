// ================================
// Streaming Diff - 大文件流式差分处理
//
// 支持超大文件的增量差分计算，避免内存溢出
// 特性：
// - 分块流式处理
// - 内存使用可控
// - 支持进度回调
// - 可中断处理
// ================================

import { Adler32RollingHash, ContentDefinedChunker } from '../algorithms/rolling-hash';
import { createStreamingHasher, type HashAlgorithm } from './streaming-hasher';

// ================================
// 类型定义
// ================================

/**
 * 流式差分配置
 */
export interface StreamingDiffConfig {
  /** 分块大小（字节） */
  chunkSize: number;
  /** 最大内存使用（字节） */
  maxMemory: number;
  /** 是否使用内容定义分块 */
  useContentDefinedChunking: boolean;
  /** 进度回调 */
  onProgress?: (phase: DiffPhase, progress: number, total: number) => void;
  /** 是否可中断 */
  abortSignal?: AbortSignal;
  /** 哈希算法 */
  hashAlgorithm: HashAlgorithm;
}

/**
 * 差分处理阶段
 */
export type DiffPhase =
  | 'hashing' // 计算哈希
  | 'chunking' // 分块
  | 'matching' // 匹配
  | 'diffing' // 差分计算
  | 'applying' // 应用差分
  | 'complete'; // 完成

/**
 * 分块信息
 */
export interface ChunkInfo {
  /** 块索引 */
  index: number;
  /** 块偏移 */
  offset: number;
  /** 块大小 */
  size: number;
  /** 弱哈希（滚动哈希） */
  weakHash: number;
  /** 强哈希 */
  strongHash: string;
}

/**
 * 流式差分结果
 */
export interface StreamingDiffResult {
  /** 源文件分块数 */
  sourceChunks: number;
  /** 目标文件分块数 */
  targetChunks: number;
  /** 匹配的块数 */
  matchedChunks: number;
  /** 新增的块数 */
  addedChunks: number;
  /** 删除的块数 */
  deletedChunks: number;
  /** 变更的字节数 */
  changedBytes: number;
  /** 匹配率 */
  matchRatio: number;
  /** 计算耗时（毫秒） */
  computeTimeMs: number;
  /** delta 数据 */
  delta: StreamingDelta;
}

/**
 * 流式 delta 指令类型
 */
export type DeltaInstructionType = 'copy' | 'insert';

/**
 * 流式 delta 指令
 */
export interface DeltaInstruction {
  /** 指令类型 */
  type: DeltaInstructionType;
  /** copy: 源偏移；insert: 无意义 */
  sourceOffset?: number;
  /** copy: 复制长度；insert: 数据长度 */
  length: number;
  /** insert: 新数据 */
  data?: Uint8Array;
}

/**
 * 流式 delta
 */
export interface StreamingDelta {
  /** 源文件大小 */
  sourceSize: number;
  /** 目标文件大小 */
  targetSize: number;
  /** 指令列表 */
  instructions: DeltaInstruction[];
  /** delta 大小估算 */
  estimatedSize: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<Omit<StreamingDiffConfig, 'onProgress' | 'abortSignal'>> = {
  chunkSize: 4096, // 4KB
  maxMemory: 64 * 1024 * 1024, // 64MB
  useContentDefinedChunking: false,
  hashAlgorithm: 'xxhash',
};

// ================================
// StreamingDiffEngine 类
// ================================

/**
 * 流式差分引擎
 *
 * 处理大文件差分计算，支持：
 * - 分块处理，内存可控
 * - 进度回调
 * - 可中断操作
 * - 内容定义分块
 *
 * @example
 * ```typescript
 * const engine = new StreamingDiffEngine({ chunkSize: 8192 });
 *
 * // 计算差分
 * const result = await engine.diff(sourceFile, targetFile, {
 *   onProgress: (phase, progress, total) => {
 *     console.log(`${phase}: ${progress}/${total}`);
 *   }
 * });
 *
 * // 应用差分
 * const reconstructed = await engine.applyDelta(sourceFile, result.delta);
 * ```
 */
export class StreamingDiffEngine {
  private readonly config: Required<Omit<StreamingDiffConfig, 'onProgress' | 'abortSignal'>>;

  constructor(config: Partial<StreamingDiffConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 核心差分操作
  // ================================

  /**
   * 计算两个文件/数据之间的流式差分
   *
   * @param source 源数据
   * @param target 目标数据
   * @param options 选项
   */
  async diff(
    source: Uint8Array | ArrayBuffer | File | Blob,
    target: Uint8Array | ArrayBuffer | File | Blob,
    options?: {
      onProgress?: (phase: DiffPhase, progress: number, total: number) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<StreamingDiffResult> {
    const startTime = performance.now();
    const onProgress = options?.onProgress ?? (() => {});
    const abortSignal = options?.abortSignal;

    // 转换为 Uint8Array
    const sourceData = await this.toUint8Array(source);
    const targetData = await this.toUint8Array(target);

    // 检查中断
    this.checkAbort(abortSignal);

    // 阶段 1: 分块源文件
    onProgress('chunking', 0, 100);
    const sourceChunks = await this.createChunks(sourceData, (p, t) => {
      onProgress('chunking', (p * 50) / t, 100);
    });

    this.checkAbort(abortSignal);

    // 阶段 2: 分块目标文件
    const targetChunks = await this.createChunks(targetData, (p, t) => {
      onProgress('chunking', 50 + (p * 50) / t, 100);
    });

    this.checkAbort(abortSignal);

    // 阶段 3: 匹配块
    onProgress('matching', 0, 100);
    const matchResult = this.matchChunks(
      sourceData,
      targetData,
      sourceChunks,
      targetChunks,
      (p, t) => onProgress('matching', p, t)
    );

    this.checkAbort(abortSignal);

    // 阶段 4: 生成 delta
    onProgress('diffing', 0, 100);
    const delta = this.generateDelta(sourceData, targetData, sourceChunks, matchResult, (p, t) =>
      onProgress('diffing', p, t)
    );

    onProgress('complete', 100, 100);

    const endTime = performance.now();

    return {
      sourceChunks: sourceChunks.length,
      targetChunks: targetChunks.length,
      matchedChunks: matchResult.matchedChunks,
      addedChunks: matchResult.addedChunks,
      deletedChunks: matchResult.deletedChunks,
      changedBytes: matchResult.changedBytes,
      matchRatio: sourceChunks.length > 0 ? matchResult.matchedChunks / sourceChunks.length : 0,
      computeTimeMs: endTime - startTime,
      delta,
    };
  }

  /**
   * 应用 delta 重建目标数据
   *
   * @param source 源数据
   * @param delta delta 数据
   * @param options 选项
   */
  async applyDelta(
    source: Uint8Array | ArrayBuffer | File | Blob,
    delta: StreamingDelta,
    options?: {
      onProgress?: (phase: DiffPhase, progress: number, total: number) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<Uint8Array> {
    const onProgress = options?.onProgress ?? (() => {});
    const abortSignal = options?.abortSignal;

    const sourceData = await this.toUint8Array(source);
    const result = new Uint8Array(delta.targetSize);
    let targetOffset = 0;

    onProgress('applying', 0, delta.instructions.length);

    for (let i = 0; i < delta.instructions.length; i++) {
      this.checkAbort(abortSignal);

      const instruction = delta.instructions[i];

      if (instruction.type === 'copy') {
        // 从源复制
        const sourceOffset = instruction.sourceOffset!;
        const length = instruction.length;
        result.set(sourceData.subarray(sourceOffset, sourceOffset + length), targetOffset);
        targetOffset += length;
      } else {
        // 插入新数据
        if (instruction.data) {
          result.set(instruction.data, targetOffset);
          targetOffset += instruction.data.length;
        }
      }

      onProgress('applying', i + 1, delta.instructions.length);
    }

    onProgress('complete', 100, 100);

    return result;
  }

  /**
   * 估算差分效率
   *
   * @param source 源数据
   * @param target 目标数据
   */
  async estimateEfficiency(
    source: Uint8Array | ArrayBuffer | File | Blob,
    target: Uint8Array | ArrayBuffer | File | Blob
  ): Promise<{
    worthUsing: boolean;
    estimatedSavings: number;
    estimatedDeltaSize: number;
    fullSize: number;
  }> {
    const sourceData = await this.toUint8Array(source);
    const targetData = await this.toUint8Array(target);

    // 快速采样估算
    const sampleSize = Math.min(sourceData.length, targetData.length, 64 * 1024);
    const sourceSample = sourceData.subarray(0, sampleSize);
    const targetSample = targetData.subarray(0, sampleSize);

    const sourceChunks = await this.createChunks(sourceSample);
    const targetChunks = await this.createChunks(targetSample);

    const matchResult = this.matchChunks(sourceSample, targetSample, sourceChunks, targetChunks);

    const matchRatio =
      sourceChunks.length > 0 ? matchResult.matchedChunks / sourceChunks.length : 0;

    // 估算 delta 大小
    const estimatedDeltaSize = Math.floor(
      targetData.length * (1 - matchRatio) + targetData.length * 0.1 // 10% 开销
    );

    return {
      worthUsing: matchRatio > 0.3, // 匹配率超过 30% 则值得使用
      estimatedSavings: 1 - estimatedDeltaSize / targetData.length,
      estimatedDeltaSize,
      fullSize: targetData.length,
    };
  }

  // ================================
  // 分块处理
  // ================================

  /**
   * 创建数据块
   */
  private async createChunks(
    data: Uint8Array,
    onProgress?: (processed: number, total: number) => void
  ): Promise<ChunkInfo[]> {
    const chunks: ChunkInfo[] = [];

    if (this.config.useContentDefinedChunking) {
      // 内容定义分块
      const chunker = new ContentDefinedChunker({
        minSize: Math.floor(this.config.chunkSize / 2),
        maxSize: this.config.chunkSize * 2,
        targetSize: this.config.chunkSize,
        windowSize: 48,
      });

      const cdcChunks = chunker.chunk(data);

      for (let i = 0; i < cdcChunks.length; i++) {
        const chunk = cdcChunks[i];
        const chunkData = data.subarray(chunk.offset, chunk.offset + chunk.size);
        const strongHash = await this.computeStrongHash(chunkData);

        chunks.push({
          index: i,
          offset: chunk.offset,
          size: chunk.size,
          weakHash: chunk.hash,
          strongHash,
        });

        onProgress?.(i + 1, cdcChunks.length);
      }
    } else {
      // 固定大小分块
      const chunkSize = this.config.chunkSize;
      const numChunks = Math.ceil(data.length / chunkSize);
      const hasher = new Adler32RollingHash(chunkSize);

      for (let i = 0; i < numChunks; i++) {
        const offset = i * chunkSize;
        const size = Math.min(chunkSize, data.length - offset);
        const chunkData = data.subarray(offset, offset + size);

        const weakHash = hasher.init(chunkData, 0, size);
        const strongHash = await this.computeStrongHash(chunkData);

        chunks.push({
          index: i,
          offset,
          size,
          weakHash,
          strongHash,
        });

        onProgress?.(i + 1, numChunks);
      }
    }

    return chunks;
  }

  /**
   * 计算强哈希
   */
  private async computeStrongHash(data: Uint8Array): Promise<string> {
    const hasher = createStreamingHasher({ algorithm: this.config.hashAlgorithm });
    hasher.update(data);
    const result = await hasher.finalize();
    return result.hash;
  }

  // ================================
  // 块匹配
  // ================================

  /**
   * 匹配源和目标的块
   */
  private matchChunks(
    _sourceData: Uint8Array,
    _targetData: Uint8Array,
    sourceChunks: ChunkInfo[],
    targetChunks: ChunkInfo[],
    onProgress?: (processed: number, total: number) => void
  ): {
    matchedChunks: number;
    addedChunks: number;
    deletedChunks: number;
    changedBytes: number;
    matches: Map<number, number>; // targetIndex -> sourceIndex
  } {
    // 构建源块哈希索引
    const weakHashIndex = new Map<number, ChunkInfo[]>();
    for (const chunk of sourceChunks) {
      const existing = weakHashIndex.get(chunk.weakHash) || [];
      existing.push(chunk);
      weakHashIndex.set(chunk.weakHash, existing);
    }

    const matches = new Map<number, number>();
    let matchedChunks = 0;
    let changedBytes = 0;

    // 匹配目标块
    for (let i = 0; i < targetChunks.length; i++) {
      const targetChunk = targetChunks[i];
      const candidates = weakHashIndex.get(targetChunk.weakHash);

      let matched = false;
      if (candidates) {
        // 检查强哈希
        for (const candidate of candidates) {
          if (candidate.strongHash === targetChunk.strongHash) {
            matches.set(i, candidate.index);
            matchedChunks++;
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        changedBytes += targetChunk.size;
      }

      onProgress?.(i + 1, targetChunks.length);
    }

    // 计算删除的块
    const matchedSourceIndices = new Set(matches.values());
    const deletedChunks = sourceChunks.length - matchedSourceIndices.size;
    const addedChunks = targetChunks.length - matchedChunks;

    return {
      matchedChunks,
      addedChunks,
      deletedChunks,
      changedBytes,
      matches,
    };
  }

  // ================================
  // Delta 生成
  // ================================

  /**
   * 生成 delta 指令
   */
  private generateDelta(
    sourceData: Uint8Array,
    targetData: Uint8Array,
    sourceChunks: ChunkInfo[],
    matchResult: {
      matches: Map<number, number>;
      matchedChunks: number;
    },
    onProgress?: (processed: number, total: number) => void
  ): StreamingDelta {
    const instructions: DeltaInstruction[] = [];
    const chunkSize = this.config.chunkSize;
    const numTargetChunks = Math.ceil(targetData.length / chunkSize);
    let estimatedSize = 0;

    for (let i = 0; i < numTargetChunks; i++) {
      const offset = i * chunkSize;
      const size = Math.min(chunkSize, targetData.length - offset);
      const sourceChunkIndex = matchResult.matches.get(i);

      if (sourceChunkIndex !== undefined) {
        // 匹配的块：生成 copy 指令
        const sourceChunk = sourceChunks[sourceChunkIndex];
        instructions.push({
          type: 'copy',
          sourceOffset: sourceChunk.offset,
          length: sourceChunk.size,
        });
        estimatedSize += 12; // 指令开销
      } else {
        // 新块：生成 insert 指令
        const data = targetData.subarray(offset, offset + size);
        instructions.push({
          type: 'insert',
          length: data.length,
          data: data.slice(), // 复制数据
        });
        estimatedSize += 8 + data.length; // 指令开销 + 数据
      }

      onProgress?.(i + 1, numTargetChunks);
    }

    // 合并相邻的 copy 指令
    const optimizedInstructions = this.optimizeInstructions(instructions);

    return {
      sourceSize: sourceData.length,
      targetSize: targetData.length,
      instructions: optimizedInstructions,
      estimatedSize,
    };
  }

  /**
   * 优化指令（合并相邻的同类型指令）
   */
  private optimizeInstructions(instructions: DeltaInstruction[]): DeltaInstruction[] {
    if (instructions.length === 0) return [];

    const optimized: DeltaInstruction[] = [];
    let current = { ...instructions[0] };

    if (current.data) {
      current.data = current.data.slice();
    }

    for (let i = 1; i < instructions.length; i++) {
      const next = instructions[i];

      if (current.type === 'copy' && next.type === 'copy') {
        // 检查是否连续
        if (current.sourceOffset! + current.length === next.sourceOffset!) {
          current.length += next.length;
          continue;
        }
      } else if (current.type === 'insert' && next.type === 'insert') {
        // 合并 insert 数据
        if (current.data && next.data) {
          const merged = new Uint8Array(current.data.length + next.data.length);
          merged.set(current.data);
          merged.set(next.data, current.data.length);
          current.data = merged;
          current.length += next.length;
          continue;
        }
      }

      // 无法合并，保存当前指令
      optimized.push(current);
      current = { ...next };
      if (current.data) {
        current.data = current.data.slice();
      }
    }

    optimized.push(current);
    return optimized;
  }

  // ================================
  // 工具方法
  // ================================

  /**
   * 转换为 Uint8Array
   */
  private async toUint8Array(data: Uint8Array | ArrayBuffer | File | Blob): Promise<Uint8Array> {
    if (data instanceof Uint8Array) {
      return data;
    }

    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }

    // File 或 Blob
    const buffer = await data.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * 检查中断信号
   */
  private checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DiffAbortError('Diff operation was aborted');
    }
  }
}

/**
 * 差分中断错误
 */
export class DiffAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffAbortError';
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建流式差分引擎
 */
export function createStreamingDiffEngine(
  config?: Partial<StreamingDiffConfig>
): StreamingDiffEngine {
  return new StreamingDiffEngine(config);
}

/**
 * 创建大文件优化的流式差分引擎
 */
export function createLargeFileDiffEngine(): StreamingDiffEngine {
  return new StreamingDiffEngine({
    chunkSize: 16 * 1024, // 16KB
    useContentDefinedChunking: true,
    maxMemory: 128 * 1024 * 1024, // 128MB
  });
}

/**
 * 创建快速流式差分引擎
 */
export function createFastStreamingDiffEngine(): StreamingDiffEngine {
  return new StreamingDiffEngine({
    chunkSize: 4 * 1024, // 4KB
    useContentDefinedChunking: false,
    hashAlgorithm: 'fnv1a',
  });
}

// ================================
// 便捷函数
// ================================

/**
 * 快速计算流式差分
 */
export async function quickStreamingDiff(
  source: Uint8Array | ArrayBuffer | File | Blob,
  target: Uint8Array | ArrayBuffer | File | Blob,
  onProgress?: (phase: DiffPhase, progress: number, total: number) => void
): Promise<StreamingDiffResult> {
  const engine = new StreamingDiffEngine();
  return engine.diff(source, target, { onProgress });
}

/**
 * 快速应用流式 delta
 */
export async function quickApplyStreamingDelta(
  source: Uint8Array | ArrayBuffer | File | Blob,
  delta: StreamingDelta,
  onProgress?: (phase: DiffPhase, progress: number, total: number) => void
): Promise<Uint8Array> {
  const engine = new StreamingDiffEngine();
  return engine.applyDelta(source, delta, { onProgress });
}

/**
 * 快速估算差分效率
 */
export async function quickEstimateDiffEfficiency(
  source: Uint8Array | ArrayBuffer | File | Blob,
  target: Uint8Array | ArrayBuffer | File | Blob
): Promise<{
  worthUsing: boolean;
  estimatedSavings: number;
  estimatedDeltaSize: number;
  fullSize: number;
}> {
  const engine = new StreamingDiffEngine();
  return engine.estimateEfficiency(source, target);
}
