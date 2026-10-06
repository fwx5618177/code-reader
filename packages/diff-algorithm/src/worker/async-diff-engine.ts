// ================================
// Async Diff Engine - 异步差分引擎
//
// 使用 Worker Pool 在后台线程执行差分计算
// 自动根据数据大小选择同步或异步执行
// ================================

import {
  WorkerPool,
  createWorkerPool,
  getDefaultWorkerPool,
  type WorkerPoolConfig,
  type PoolStats,
} from './worker-pool';
import type { TextDiffResult, BinaryDelta, DiffStats, TextDiff } from '../types';

// ================================
// 类型定义
// ================================

/**
 * 异步差分引擎配置
 */
export interface AsyncDiffEngineConfig {
  /** Worker 池配置 */
  poolConfig?: Partial<WorkerPoolConfig>;
  /** 使用 Worker 的最小数据大小（字节） */
  workerThreshold: number;
  /** 是否自动初始化 Worker 池 */
  autoInitialize: boolean;
  /** 是否使用默认共享 Worker 池 */
  useSharedPool: boolean;
  /** 启用调试日志 */
  debug: boolean;
}

/**
 * 异步文本差分结果
 */
export interface AsyncTextDiffResult extends TextDiffResult {
  /** 是否使用了 Worker */
  usedWorker: boolean;
  /** Worker 计算耗时 */
  workerTimeMs?: number;
}

/**
 * 异步二进制差分结果
 */
export interface AsyncBinaryDiffResult extends BinaryDelta {
  /** 是否使用了 Worker */
  usedWorker: boolean;
  /** 计算耗时 */
  computeTimeMs: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<AsyncDiffEngineConfig> = {
  poolConfig: {},
  workerThreshold: 50 * 1024, // 50KB
  autoInitialize: true,
  useSharedPool: true,
  debug: false,
};

// ================================
// AsyncDiffEngine 类
// ================================

/**
 * 异步差分引擎
 *
 * 自动根据数据大小选择执行方式：
 * - 小数据：在主线程同步执行
 * - 大数据：在 Worker 线程异步执行
 *
 * @example
 * ```typescript
 * const engine = new AsyncDiffEngine();
 *
 * // 自动选择执行方式
 * const result = await engine.diff(source, target);
 *
 * // 强制使用 Worker
 * const workerResult = await engine.diffInWorker(source, target);
 *
 * // 批量处理
 * const results = await engine.batchDiff([
 *   { source: 'a', target: 'b' },
 *   { source: 'c', target: 'd' },
 * ]);
 * ```
 */
export class AsyncDiffEngine {
  private readonly config: Required<AsyncDiffEngineConfig>;
  private pool: WorkerPool | null = null;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(config: Partial<AsyncDiffEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 初始化
  // ================================

  /**
   * 初始化 Worker 池
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.doInitialize();
    await this.initializationPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      if (this.config.useSharedPool) {
        this.pool = await getDefaultWorkerPool();
      } else {
        this.pool = createWorkerPool(this.config.poolConfig);
        await this.pool.initialize();
      }
      this.isInitialized = true;
      this.log('AsyncDiffEngine initialized');
    } catch (error) {
      this.log('Failed to initialize worker pool:', error);
      // 降级到同步模式
      this.pool = null;
      this.isInitialized = true;
    }
  }

  /**
   * 确保已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized && this.config.autoInitialize) {
      await this.initialize();
    }
  }

  /**
   * 关闭引擎
   */
  destroy(): void {
    if (this.pool && !this.config.useSharedPool) {
      this.pool.terminate();
    }
    this.pool = null;
    this.isInitialized = false;
    this.initializationPromise = null;
  }

  // ================================
  // 文本差分
  // ================================

  /**
   * 计算文本差分（自动选择执行方式）
   *
   * @param source 源文本
   * @param target 目标文本
   */
  async diff(source: string, target: string): Promise<AsyncTextDiffResult> {
    const dataSize = source.length + target.length;

    // 小数据使用同步方式
    if (dataSize < this.config.workerThreshold || !this.canUseWorker()) {
      return this.diffSync(source, target);
    }

    // 大数据使用 Worker
    return this.diffInWorker(source, target);
  }

  /**
   * 在主线程同步计算差分
   */
  diffSync(source: string, target: string): AsyncTextDiffResult {
    const startTime = performance.now();

    // 使用简化的差分算法
    const diffs = this.computeSimpleDiff(source, target);
    // 统计信息可用于调试和性能分析
    this.computeStats(diffs);

    const endTime = performance.now();

    return {
      diffs,
      sourceLength: source.length,
      targetLength: target.length,
      computeTimeMs: endTime - startTime,
      algorithm: 'dmp',
      usedWorker: false,
    };
  }

  /**
   * 强制在 Worker 中计算差分
   */
  async diffInWorker(source: string, target: string): Promise<AsyncTextDiffResult> {
    await this.ensureInitialized();

    if (!this.pool) {
      // 降级到同步模式
      return this.diffSync(source, target);
    }

    const startTime = performance.now();

    try {
      const result = await this.pool.textDiff(source, target);
      const endTime = performance.now();

      return {
        diffs: result.diffs as TextDiff[],
        sourceLength: result.sourceLength,
        targetLength: result.targetLength,
        computeTimeMs: endTime - startTime,
        algorithm: 'dmp',
        usedWorker: true,
        workerTimeMs: result.computeTimeMs,
      };
    } catch (error) {
      this.log('Worker diff failed, falling back to sync:', error);
      return this.diffSync(source, target);
    }
  }

  /**
   * 批量计算文本差分
   */
  async batchDiff(
    pairs: Array<{ source: string; target: string }>
  ): Promise<AsyncTextDiffResult[]> {
    await this.ensureInitialized();

    // 并行处理所有差分
    const promises = pairs.map((pair) => this.diff(pair.source, pair.target));
    return Promise.all(promises);
  }

  // ================================
  // 二进制差分
  // ================================

  /**
   * 计算二进制差分（自动选择执行方式）
   */
  async binaryDiff(
    source: Uint8Array | ArrayBuffer,
    target: Uint8Array | ArrayBuffer
  ): Promise<AsyncBinaryDiffResult> {
    // 统一为字节视图：Uint8Array 可能只覆盖底层缓冲区的一部分，不能直接取 .buffer
    const sourceBytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    const targetBytes = target instanceof ArrayBuffer ? new Uint8Array(target) : target;
    const dataSize = sourceBytes.byteLength + targetBytes.byteLength;

    if (dataSize < this.config.workerThreshold || !this.canUseWorker()) {
      return this.binaryDiffSync(sourceBytes, targetBytes);
    }

    return this.binaryDiffInWorker(sourceBytes, targetBytes);
  }

  /**
   * 同步计算二进制差分
   */
  binaryDiffSync(source: Uint8Array, target: Uint8Array): AsyncBinaryDiffResult {
    const startTime = performance.now();

    const delta = this.computeSimpleBinaryDiff(source, target);

    const endTime = performance.now();

    return {
      delta: delta,
      sourceLength: source.byteLength,
      targetLength: target.byteLength,
      deltaSize: delta.length,
      compressionRatio: target.byteLength > 0 ? delta.length / target.byteLength : 0,
      usedWorker: false,
      computeTimeMs: endTime - startTime,
    };
  }

  /**
   * 在 Worker 中计算二进制差分
   */
  async binaryDiffInWorker(
    source: Uint8Array,
    target: Uint8Array
  ): Promise<AsyncBinaryDiffResult> {
    await this.ensureInitialized();

    if (!this.pool) {
      return this.binaryDiffSync(source, target);
    }

    const startTime = performance.now();

    try {
      // 按视图区间复制出独立的 ArrayBuffer：既避免转移调用方缓冲区，也保证只传输有效字节
      const sourceCopy = source.slice().buffer;
      const targetCopy = target.slice().buffer;

      const result = await this.pool.binaryDiff(sourceCopy, targetCopy);
      const endTime = performance.now();

      return {
        delta: result.delta,
        sourceLength: result.sourceLength,
        targetLength: result.targetLength,
        deltaSize: result.deltaSize,
        compressionRatio: result.compressionRatio,
        usedWorker: true,
        computeTimeMs: endTime - startTime,
      };
    } catch (error) {
      this.log('Worker binary diff failed, falling back to sync:', error);
      return this.binaryDiffSync(source, target);
    }
  }

  // ================================
  // 哈希计算
  // ================================

  /**
   * 计算哈希（自动选择执行方式）
   */
  async computeHash(
    data: string | ArrayBuffer,
    algorithm: 'fnv1a' | 'xxhash' | 'adler32' = 'fnv1a'
  ): Promise<{
    hash: string;
    usedWorker: boolean;
    computeTimeMs: number;
  }> {
    const dataSize = typeof data === 'string' ? data.length : data.byteLength;

    if (dataSize < this.config.workerThreshold || !this.canUseWorker()) {
      return this.computeHashSync(data, algorithm);
    }

    return this.computeHashInWorker(data, algorithm);
  }

  /**
   * 同步计算哈希
   */
  computeHashSync(
    data: string | ArrayBuffer,
    algorithm: 'fnv1a' | 'xxhash' | 'adler32' = 'fnv1a'
  ): {
    hash: string;
    usedWorker: boolean;
    computeTimeMs: number;
  } {
    const startTime = performance.now();

    let bytes: Uint8Array;
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else {
      bytes = new Uint8Array(data);
    }

    let hash: number;
    switch (algorithm) {
      case 'adler32':
        hash = this.adler32(bytes);
        break;
      case 'xxhash':
      case 'fnv1a':
      default:
        hash = this.fnv1a(bytes);
        break;
    }

    const endTime = performance.now();

    return {
      hash: hash.toString(36),
      usedWorker: false,
      computeTimeMs: endTime - startTime,
    };
  }

  /**
   * 在 Worker 中计算哈希
   */
  async computeHashInWorker(
    data: string | ArrayBuffer,
    algorithm: 'fnv1a' | 'xxhash' | 'adler32' = 'fnv1a'
  ): Promise<{
    hash: string;
    usedWorker: boolean;
    computeTimeMs: number;
  }> {
    await this.ensureInitialized();

    if (!this.pool) {
      return this.computeHashSync(data, algorithm);
    }

    const startTime = performance.now();

    try {
      // 复制数据
      const dataCopy = typeof data === 'string' ? data : data.slice(0);
      const result = await this.pool.computeHash(dataCopy, algorithm);
      const endTime = performance.now();

      return {
        hash: result.hash,
        usedWorker: true,
        computeTimeMs: endTime - startTime,
      };
    } catch (error) {
      this.log('Worker hash failed, falling back to sync:', error);
      return this.computeHashSync(data, algorithm);
    }
  }

  // ================================
  // 相似度计算
  // ================================

  /**
   * 计算相似度（自动选择执行方式）
   */
  async computeSimilarity(
    source: string,
    target: string,
    caseSensitive: boolean = false
  ): Promise<{
    distance: number;
    similarity: number;
    usedWorker: boolean;
    computeTimeMs: number;
  }> {
    const dataSize = source.length + target.length;

    if (dataSize < this.config.workerThreshold || !this.canUseWorker()) {
      return this.computeSimilaritySync(source, target, caseSensitive);
    }

    return this.computeSimilarityInWorker(source, target, caseSensitive);
  }

  /**
   * 同步计算相似度
   */
  computeSimilaritySync(
    source: string,
    target: string,
    caseSensitive: boolean = false
  ): {
    distance: number;
    similarity: number;
    usedWorker: boolean;
    computeTimeMs: number;
  } {
    const startTime = performance.now();

    const s = caseSensitive ? source : source.toLowerCase();
    const t = caseSensitive ? target : target.toLowerCase();

    const distance = this.levenshteinDistance(s, t);
    const maxLen = Math.max(s.length, t.length);
    const similarity = maxLen > 0 ? 1 - distance / maxLen : 1;

    const endTime = performance.now();

    return {
      distance,
      similarity,
      usedWorker: false,
      computeTimeMs: endTime - startTime,
    };
  }

  /**
   * 在 Worker 中计算相似度
   */
  async computeSimilarityInWorker(
    source: string,
    target: string,
    caseSensitive: boolean = false
  ): Promise<{
    distance: number;
    similarity: number;
    usedWorker: boolean;
    computeTimeMs: number;
  }> {
    await this.ensureInitialized();

    if (!this.pool) {
      return this.computeSimilaritySync(source, target, caseSensitive);
    }

    const startTime = performance.now();

    try {
      const result = await this.pool.computeSimilarity(source, target, caseSensitive);
      const endTime = performance.now();

      return {
        distance: result.distance,
        similarity: result.similarity,
        usedWorker: true,
        computeTimeMs: endTime - startTime,
      };
    } catch (error) {
      this.log('Worker similarity failed, falling back to sync:', error);
      return this.computeSimilaritySync(source, target, caseSensitive);
    }
  }

  // ================================
  // 应用差分
  // ================================

  /**
   * 应用文本差分
   */
  async applyDiff(source: string, diffs: TextDiff[]): Promise<string> {
    const dataSize = source.length + diffs.reduce((acc, [, text]) => acc + text.length, 0);

    if (dataSize < this.config.workerThreshold || !this.canUseWorker()) {
      return this.applyDiffSync(source, diffs);
    }

    return this.applyDiffInWorker(source, diffs);
  }

  /**
   * 同步应用差分
   */
  applyDiffSync(source: string, diffs: TextDiff[]): string {
    const result: string[] = [];
    let sourceIndex = 0;

    for (const [op, text] of diffs) {
      switch (op) {
        case 0: // EQUAL
          result.push(source.substring(sourceIndex, sourceIndex + text.length));
          sourceIndex += text.length;
          break;
        case 1: // INSERT
          result.push(text);
          break;
        case -1: // DELETE
          sourceIndex += text.length;
          break;
      }
    }

    return result.join('');
  }

  /**
   * 在 Worker 中应用差分
   */
  async applyDiffInWorker(source: string, diffs: TextDiff[]): Promise<string> {
    await this.ensureInitialized();

    if (!this.pool) {
      return this.applyDiffSync(source, diffs);
    }

    try {
      return await this.pool.applyTextDiff(source, diffs as Array<[number, string]>);
    } catch (error) {
      this.log('Worker apply diff failed, falling back to sync:', error);
      return this.applyDiffSync(source, diffs);
    }
  }

  // ================================
  // 状态和统计
  // ================================

  /**
   * 检查是否可以使用 Worker
   */
  canUseWorker(): boolean {
    return this.isInitialized && this.pool !== null;
  }

  /**
   * 获取 Worker 池统计
   */
  getPoolStats(): PoolStats | null {
    if (!this.pool) return null;
    return this.pool.getStats();
  }

  /**
   * 获取引擎状态
   */
  getStatus(): {
    isInitialized: boolean;
    canUseWorker: boolean;
    workerThreshold: number;
    poolStats: PoolStats | null;
  } {
    return {
      isInitialized: this.isInitialized,
      canUseWorker: this.canUseWorker(),
      workerThreshold: this.config.workerThreshold,
      poolStats: this.getPoolStats(),
    };
  }

  // ================================
  // 私有辅助方法
  // ================================

  /**
   * 简化的文本差分算法
   */
  private computeSimpleDiff(source: string, target: string): TextDiff[] {
    const DIFF_DELETE = -1 as const;
    const DIFF_EQUAL = 0 as const;
    const DIFF_INSERT = 1 as const;

    if (source === target) {
      return source.length > 0 ? [[DIFF_EQUAL, source]] : [];
    }

    if (source.length === 0) {
      return [[DIFF_INSERT, target]];
    }

    if (target.length === 0) {
      return [[DIFF_DELETE, source]];
    }

    // 查找公共前缀
    let commonPrefixLength = 0;
    const minLength = Math.min(source.length, target.length);
    while (
      commonPrefixLength < minLength &&
      source[commonPrefixLength] === target[commonPrefixLength]
    ) {
      commonPrefixLength++;
    }

    // 查找公共后缀
    let commonSuffixLength = 0;
    while (
      commonSuffixLength < minLength - commonPrefixLength &&
      source[source.length - 1 - commonSuffixLength] ===
        target[target.length - 1 - commonSuffixLength]
    ) {
      commonSuffixLength++;
    }

    const diffs: TextDiff[] = [];

    if (commonPrefixLength > 0) {
      diffs.push([DIFF_EQUAL, source.substring(0, commonPrefixLength)]);
    }

    const sourceMiddle = source.substring(commonPrefixLength, source.length - commonSuffixLength);
    const targetMiddle = target.substring(commonPrefixLength, target.length - commonSuffixLength);

    if (sourceMiddle.length > 0 && targetMiddle.length > 0) {
      diffs.push([DIFF_DELETE, sourceMiddle]);
      diffs.push([DIFF_INSERT, targetMiddle]);
    } else if (sourceMiddle.length > 0) {
      diffs.push([DIFF_DELETE, sourceMiddle]);
    } else if (targetMiddle.length > 0) {
      diffs.push([DIFF_INSERT, targetMiddle]);
    }

    if (commonSuffixLength > 0) {
      diffs.push([DIFF_EQUAL, source.substring(source.length - commonSuffixLength)]);
    }

    return diffs;
  }

  /**
   * 计算差分统计
   */
  private computeStats(diffs: TextDiff[]): DiffStats {
    let insertions = 0;
    let deletions = 0;
    let unchanged = 0;

    for (const [op, text] of diffs) {
      switch (op) {
        case 1:
          insertions += text.length;
          break;
        case -1:
          deletions += text.length;
          break;
        case 0:
          unchanged += text.length;
          break;
      }
    }

    const totalChars = insertions + deletions + unchanged;
    const changeRatio = totalChars > 0 ? (insertions + deletions) / totalChars : 0;

    return {
      insertions,
      deletions,
      unchanged,
      totalChars,
      changeRatio,
      levenshtein: insertions + deletions,
    };
  }

  /**
   * 简化的二进制差分
   */
  private computeSimpleBinaryDiff(_source: Uint8Array, target: Uint8Array): readonly number[] {
    // 非常简化的实现：直接存储目标
    // 实际应用中应该使用更高效的算法
    const delta: number[] = [];

    // 写入目标长度
    delta.push(target.length & 0xff);
    delta.push((target.length >> 8) & 0xff);
    delta.push((target.length >> 16) & 0xff);
    delta.push((target.length >> 24) & 0xff);

    // 写入目标数据
    for (let i = 0; i < target.length; i++) {
      delta.push(target[i]);
    }

    return delta;
  }

  /**
   * FNV-1a 哈希
   */
  private fnv1a(data: Uint8Array): number {
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i];
      hash = (hash * 16777619) >>> 0;
    }
    return hash;
  }

  /**
   * Adler32 哈希
   */
  private adler32(data: Uint8Array): number {
    const MOD = 65521;
    let a = 1;
    let b = 0;
    for (let i = 0; i < data.length; i++) {
      a = (a + data[i]) % MOD;
      b = (b + a) % MOD;
    }
    return (b << 16) | a;
  }

  /**
   * Levenshtein 距离
   */
  private levenshteinDistance(s: string, t: string): number {
    const m = s.length;
    const n = t.length;

    if (m === 0) return n;
    if (n === 0) return m;

    let prev = new Array(n + 1);
    let curr = new Array(n + 1);

    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }

    return prev[n];
  }

  /**
   * 调试日志
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[AsyncDiffEngine]', ...args);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建异步差分引擎
 */
export function createAsyncDiffEngine(config?: Partial<AsyncDiffEngineConfig>): AsyncDiffEngine {
  return new AsyncDiffEngine(config);
}

/**
 * 创建高性能异步差分引擎
 */
export function createHighPerformanceAsyncEngine(): AsyncDiffEngine {
  return new AsyncDiffEngine({
    workerThreshold: 10 * 1024, // 10KB
    autoInitialize: true,
    useSharedPool: true,
  });
}

/**
 * 创建独立异步差分引擎（不共享 Worker 池）
 */
export function createIsolatedAsyncEngine(poolConfig?: Partial<WorkerPoolConfig>): AsyncDiffEngine {
  return new AsyncDiffEngine({
    poolConfig,
    useSharedPool: false,
    autoInitialize: true,
  });
}

// ================================
// 默认实例
// ================================

let defaultEngine: AsyncDiffEngine | null = null;

/**
 * 获取默认异步差分引擎
 */
export async function getDefaultAsyncDiffEngine(): Promise<AsyncDiffEngine> {
  if (!defaultEngine) {
    defaultEngine = new AsyncDiffEngine();
    await defaultEngine.initialize();
  }
  return defaultEngine;
}

/**
 * 重置默认异步差分引擎
 */
export function resetDefaultAsyncDiffEngine(): void {
  if (defaultEngine) {
    defaultEngine.destroy();
    defaultEngine = null;
  }
}

// ================================
// 便捷函数
// ================================

/**
 * 快速异步差分
 */
export async function quickAsyncDiff(source: string, target: string): Promise<AsyncTextDiffResult> {
  const engine = await getDefaultAsyncDiffEngine();
  return engine.diff(source, target);
}

/**
 * 快速异步二进制差分
 */
export async function quickAsyncBinaryDiff(
  source: Uint8Array | ArrayBuffer,
  target: Uint8Array | ArrayBuffer
): Promise<AsyncBinaryDiffResult> {
  const engine = await getDefaultAsyncDiffEngine();
  return engine.binaryDiff(source, target);
}

/**
 * 快速异步哈希
 */
export async function quickAsyncHash(
  data: string | ArrayBuffer,
  algorithm: 'fnv1a' | 'xxhash' | 'adler32' = 'fnv1a'
): Promise<string> {
  const engine = await getDefaultAsyncDiffEngine();
  const result = await engine.computeHash(data, algorithm);
  return result.hash;
}

/**
 * 快速异步相似度
 */
export async function quickAsyncSimilarity(source: string, target: string): Promise<number> {
  const engine = await getDefaultAsyncDiffEngine();
  const result = await engine.computeSimilarity(source, target);
  return result.similarity;
}
