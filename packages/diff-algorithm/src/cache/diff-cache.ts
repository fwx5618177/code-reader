// ================================
// Diff Cache - 基于内容哈希的差分结果缓存
//
// 特性：
// - 基于内容哈希避免重复计算
// - 支持文本和二进制差分缓存
// - 自动过期和容量限制
// - 统计和监控
// ================================

import { LRUCache, createLRUCache } from './lru-cache';
import type { TextDiffResult, BinaryDelta, DiffStats } from '../types';

// ================================
// 类型定义
// ================================

/**
 * 缓存键生成策略
 */
export type CacheKeyStrategy = 'hash' | 'content' | 'hybrid';

/**
 * 差分缓存配置
 */
export interface DiffCacheConfig {
  /** 最大缓存条目数 */
  maxSize: number;
  /** 条目过期时间（毫秒），0 表示不过期 */
  ttl?: number;
  /** 最大内存占用（字节），0 表示不限制 */
  maxMemory?: number;
  /** 缓存键策略 */
  keyStrategy?: CacheKeyStrategy;
  /** 是否启用统计 */
  enableStats?: boolean;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * 缓存的文本差分结果
 */
export interface CachedTextDiff {
  /** 差分结果 */
  result: TextDiffResult;
  /** 差分统计 */
  stats: DiffStats;
  /** 缓存时间 */
  cachedAt: number;
  /** 源文本哈希 */
  sourceHash: string;
  /** 目标文本哈希 */
  targetHash: string;
}

/**
 * 缓存的二进制差分结果
 */
export interface CachedBinaryDiff {
  /** 差分结果 */
  delta: BinaryDelta;
  /** 缓存时间 */
  cachedAt: number;
  /** 源数据哈希 */
  sourceHash: string;
  /** 目标数据哈希 */
  targetHash: string;
}

/**
 * 差分缓存统计
 */
export interface DiffCacheStats {
  /** 文本差分缓存命中次数 */
  textHits: number;
  /** 文本差分缓存未命中次数 */
  textMisses: number;
  /** 二进制差分缓存命中次数 */
  binaryHits: number;
  /** 二进制差分缓存未命中次数 */
  binaryMisses: number;
  /** 节省的计算时间（毫秒） */
  savedTimeMs: number;
  /** 缓存条目数 */
  entryCount: number;
  /** 估算内存占用（字节） */
  memoryUsage: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<DiffCacheConfig> = {
  maxSize: 500,
  ttl: 5 * 60 * 1000, // 5 分钟
  maxMemory: 50 * 1024 * 1024, // 50MB
  keyStrategy: 'hash',
  enableStats: true,
  debug: false,
};

// ================================
// 哈希工具
// ================================

/**
 * 快速哈希算法（FNV-1a）
 * 用于生成缓存键
 */
function fnv1aHash(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

/**
 * 计算字符串的快速哈希
 */
export function quickHash(content: string): string {
  // 对于短字符串，直接计算
  if (content.length < 10000) {
    return fnv1aHash(content);
  }

  // 对于长字符串，采样计算
  const sampleSize = 1000;
  const samples: string[] = [];

  // 开头
  samples.push(content.slice(0, sampleSize));
  // 中间
  const mid = Math.floor(content.length / 2);
  samples.push(content.slice(mid - sampleSize / 2, mid + sampleSize / 2));
  // 结尾
  samples.push(content.slice(-sampleSize));
  // 长度信息
  samples.push(content.length.toString());

  return fnv1aHash(samples.join('|'));
}

/**
 * 计算二进制数据的快速哈希
 */
export function quickBinaryHash(data: Uint8Array | readonly number[]): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.length < 10000) {
    // 短数据直接计算
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(36);
  }

  // 长数据采样计算
  const sampleSize = 1000;
  let hash = 2166136261;

  // 开头
  for (let i = 0; i < Math.min(sampleSize, bytes.length); i++) {
    hash ^= bytes[i];
    hash = (hash * 16777619) >>> 0;
  }

  // 中间
  const mid = Math.floor(bytes.length / 2);
  for (let i = mid - sampleSize / 2; i < mid + sampleSize / 2 && i < bytes.length; i++) {
    if (i >= 0) {
      hash ^= bytes[i];
      hash = (hash * 16777619) >>> 0;
    }
  }

  // 结尾
  for (let i = Math.max(0, bytes.length - sampleSize); i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = (hash * 16777619) >>> 0;
  }

  // 长度
  hash ^= bytes.length;
  hash = (hash * 16777619) >>> 0;

  return hash.toString(36);
}

// ================================
// DiffCache 类
// ================================

/**
 * 差分结果缓存
 *
 * 基于内容哈希缓存差分计算结果，避免重复计算。
 *
 * @example
 * ```typescript
 * const cache = new DiffCache({ maxSize: 100 });
 *
 * // 检查缓存
 * const cached = cache.getTextDiff(source, target);
 * if (cached) {
 *   return cached.result;
 * }
 *
 * // 计算差分
 * const result = engine.diff(source, target);
 *
 * // 存入缓存
 * cache.setTextDiff(source, target, result, stats);
 * ```
 */
export class DiffCache {
  private readonly config: Required<DiffCacheConfig>;
  private readonly textCache: LRUCache<string, CachedTextDiff>;
  private readonly binaryCache: LRUCache<string, CachedBinaryDiff>;

  // 统计
  private textHits = 0;
  private textMisses = 0;
  private binaryHits = 0;
  private binaryMisses = 0;
  private savedTimeMs = 0;

  constructor(config: Partial<DiffCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 创建文本差分缓存
    this.textCache = createLRUCache<string, CachedTextDiff>({
      maxSize: this.config.maxSize,
      ttl: this.config.ttl,
      maxMemory: this.config.maxMemory / 2,
      sizeCalculator: (value) => this.estimateTextDiffSize(value),
      onEvict: (key, _value, reason) => {
        this.log(`文本缓存驱逐: ${key} (${reason})`);
      },
    });

    // 创建二进制差分缓存
    this.binaryCache = createLRUCache<string, CachedBinaryDiff>({
      maxSize: this.config.maxSize,
      ttl: this.config.ttl,
      maxMemory: this.config.maxMemory / 2,
      sizeCalculator: (value) => this.estimateBinaryDiffSize(value),
      onEvict: (key, _value, reason) => {
        this.log(`二进制缓存驱逐: ${key} (${reason})`);
      },
    });
  }

  // ================================
  // 文本差分缓存
  // ================================

  /**
   * 获取缓存的文本差分结果
   *
   * @param source 源文本
   * @param target 目标文本
   * @returns 缓存的结果，如果不存在则返回 undefined
   */
  getTextDiff(source: string, target: string): CachedTextDiff | undefined {
    const key = this.generateTextKey(source, target);
    const cached = this.textCache.get(key);

    if (cached) {
      this.textHits++;
      this.savedTimeMs += cached.result.computeTimeMs;
      this.log(`文本缓存命中: ${key}`);
      return cached;
    }

    this.textMisses++;
    this.log(`文本缓存未命中: ${key}`);
    return undefined;
  }

  /**
   * 缓存文本差分结果
   *
   * @param source 源文本
   * @param target 目标文本
   * @param result 差分结果
   * @param stats 差分统计
   */
  setTextDiff(source: string, target: string, result: TextDiffResult, stats: DiffStats): void {
    const sourceHash = quickHash(source);
    const targetHash = quickHash(target);
    const key = this.generateTextKey(source, target);

    const cached: CachedTextDiff = {
      result,
      stats,
      cachedAt: Date.now(),
      sourceHash,
      targetHash,
    };

    this.textCache.set(key, cached);
    this.log(`文本缓存写入: ${key}`);
  }

  /**
   * 检查是否有缓存的文本差分
   */
  hasTextDiff(source: string, target: string): boolean {
    const key = this.generateTextKey(source, target);
    return this.textCache.has(key);
  }

  /**
   * 删除文本差分缓存
   */
  deleteTextDiff(source: string, target: string): boolean {
    const key = this.generateTextKey(source, target);
    return this.textCache.delete(key);
  }

  // ================================
  // 二进制差分缓存
  // ================================

  /**
   * 获取缓存的二进制差分结果
   *
   * @param source 源数据
   * @param target 目标数据
   * @returns 缓存的结果，如果不存在则返回 undefined
   */
  getBinaryDiff(
    source: Uint8Array | readonly number[],
    target: Uint8Array | readonly number[]
  ): CachedBinaryDiff | undefined {
    const key = this.generateBinaryKey(source, target);
    const cached = this.binaryCache.get(key);

    if (cached) {
      this.binaryHits++;
      this.log(`二进制缓存命中: ${key}`);
      return cached;
    }

    this.binaryMisses++;
    this.log(`二进制缓存未命中: ${key}`);
    return undefined;
  }

  /**
   * 缓存二进制差分结果
   *
   * @param source 源数据
   * @param target 目标数据
   * @param delta 差分结果
   */
  setBinaryDiff(
    source: Uint8Array | readonly number[],
    target: Uint8Array | readonly number[],
    delta: BinaryDelta
  ): void {
    const sourceHash = quickBinaryHash(source);
    const targetHash = quickBinaryHash(target);
    const key = this.generateBinaryKey(source, target);

    const cached: CachedBinaryDiff = {
      delta,
      cachedAt: Date.now(),
      sourceHash,
      targetHash,
    };

    this.binaryCache.set(key, cached);
    this.log(`二进制缓存写入: ${key}`);
  }

  /**
   * 检查是否有缓存的二进制差分
   */
  hasBinaryDiff(
    source: Uint8Array | readonly number[],
    target: Uint8Array | readonly number[]
  ): boolean {
    const key = this.generateBinaryKey(source, target);
    return this.binaryCache.has(key);
  }

  /**
   * 删除二进制差分缓存
   */
  deleteBinaryDiff(
    source: Uint8Array | readonly number[],
    target: Uint8Array | readonly number[]
  ): boolean {
    const key = this.generateBinaryKey(source, target);
    return this.binaryCache.delete(key);
  }

  // ================================
  // 高级操作
  // ================================

  /**
   * 预热缓存
   *
   * @param entries 预热条目
   */
  warmup(
    entries: Array<{
      type: 'text' | 'binary';
      source: string | Uint8Array;
      target: string | Uint8Array;
      result: TextDiffResult | BinaryDelta;
      stats?: DiffStats;
    }>
  ): void {
    for (const entry of entries) {
      if (entry.type === 'text') {
        this.setTextDiff(
          entry.source as string,
          entry.target as string,
          entry.result as TextDiffResult,
          entry.stats || this.createEmptyStats()
        );
      } else {
        this.setBinaryDiff(
          entry.source as Uint8Array,
          entry.target as Uint8Array,
          entry.result as BinaryDelta
        );
      }
    }
  }

  /**
   * 通过哈希获取缓存（用于增量同步场景）
   *
   * @param sourceHash 源内容哈希
   * @param targetHash 目标内容哈希
   */
  getByHashes(
    sourceHash: string,
    targetHash: string
  ): CachedTextDiff | CachedBinaryDiff | undefined {
    const key = `${sourceHash}:${targetHash}`;

    // 先查文本缓存
    const textResult = this.textCache.get(key);
    if (textResult) {
      this.textHits++;
      return textResult;
    }

    // 再查二进制缓存
    const binaryResult = this.binaryCache.get(key);
    if (binaryResult) {
      this.binaryHits++;
      return binaryResult;
    }

    return undefined;
  }

  // ================================
  // 维护操作
  // ================================

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.textCache.clear();
    this.binaryCache.clear();
    this.resetStats();
    this.log('缓存已清空');
  }

  /**
   * 清理过期条目
   *
   * @returns 清理的条目数
   */
  prune(): number {
    const textPruned = this.textCache.prune();
    const binaryPruned = this.binaryCache.prune();
    const total = textPruned + binaryPruned;
    this.log(`清理了 ${total} 个过期条目`);
    return total;
  }

  /**
   * 获取缓存统计
   */
  getStats(): DiffCacheStats {
    const textStats = this.textCache.getStats();
    const binaryStats = this.binaryCache.getStats();

    return {
      textHits: this.textHits,
      textMisses: this.textMisses,
      binaryHits: this.binaryHits,
      binaryMisses: this.binaryMisses,
      savedTimeMs: this.savedTimeMs,
      entryCount: textStats.size + binaryStats.size,
      memoryUsage: textStats.memoryUsage + binaryStats.memoryUsage,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.textHits = 0;
    this.textMisses = 0;
    this.binaryHits = 0;
    this.binaryMisses = 0;
    this.savedTimeMs = 0;
    this.textCache.resetStats();
    this.binaryCache.resetStats();
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.textCache.size + this.binaryCache.size;
  }

  /**
   * 获取文本缓存大小
   */
  get textSize(): number {
    return this.textCache.size;
  }

  /**
   * 获取二进制缓存大小
   */
  get binarySize(): number {
    return this.binaryCache.size;
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 生成文本缓存键
   */
  private generateTextKey(source: string, target: string): string {
    switch (this.config.keyStrategy) {
      case 'content':
        // 直接使用内容（适合短字符串）
        if (source.length + target.length < 200) {
          return `${source}|${target}`;
        }
        // 回退到哈希
        return `${quickHash(source)}:${quickHash(target)}`;

      case 'hybrid':
        // 混合策略：短内容用内容，长内容用哈希
        const sourceKey = source.length < 100 ? source : quickHash(source);
        const targetKey = target.length < 100 ? target : quickHash(target);
        return `${sourceKey}:${targetKey}`;

      case 'hash':
      default:
        return `${quickHash(source)}:${quickHash(target)}`;
    }
  }

  /**
   * 生成二进制缓存键
   */
  private generateBinaryKey(
    source: Uint8Array | readonly number[],
    target: Uint8Array | readonly number[]
  ): string {
    return `${quickBinaryHash(source)}:${quickBinaryHash(target)}`;
  }

  /**
   * 估算文本差分缓存大小
   */
  private estimateTextDiffSize(cached: CachedTextDiff): number {
    let size = 0;

    // 差分数组
    for (const [, text] of cached.result.diffs) {
      size += text.length * 2; // UTF-16
    }

    // 统计数据
    size += 100; // 估算

    // 哈希
    size += cached.sourceHash.length * 2;
    size += cached.targetHash.length * 2;

    return size;
  }

  /**
   * 估算二进制差分缓存大小
   */
  private estimateBinaryDiffSize(cached: CachedBinaryDiff): number {
    let size = 0;

    // delta 数组
    size += cached.delta.delta.length * 4; // number[]

    // 元数据
    size += 50;

    // 哈希
    size += cached.sourceHash.length * 2;
    size += cached.targetHash.length * 2;

    return size;
  }

  /**
   * 创建空的统计对象
   */
  private createEmptyStats(): DiffStats {
    return {
      insertions: 0,
      deletions: 0,
      unchanged: 0,
      totalChars: 0,
      changeRatio: 0,
      levenshtein: 0,
    };
  }

  /**
   * 调试日志
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[DiffCache]', ...args);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建差分缓存
 */
export function createDiffCache(config?: Partial<DiffCacheConfig>): DiffCache {
  return new DiffCache(config);
}

/**
 * 创建高性能差分缓存（大容量、长 TTL）
 */
export function createHighPerformanceCache(): DiffCache {
  return new DiffCache({
    maxSize: 2000,
    ttl: 30 * 60 * 1000, // 30 分钟
    maxMemory: 100 * 1024 * 1024, // 100MB
    keyStrategy: 'hash',
  });
}

/**
 * 创建轻量级差分缓存（小容量、短 TTL）
 */
export function createLightweightCache(): DiffCache {
  return new DiffCache({
    maxSize: 100,
    ttl: 60 * 1000, // 1 分钟
    maxMemory: 10 * 1024 * 1024, // 10MB
    keyStrategy: 'hash',
  });
}

// ================================
// 默认实例
// ================================

let defaultCache: DiffCache | null = null;

/**
 * 获取默认缓存实例
 */
export function getDefaultDiffCache(): DiffCache {
  if (!defaultCache) {
    defaultCache = new DiffCache();
  }
  return defaultCache;
}

/**
 * 重置默认缓存
 */
export function resetDefaultDiffCache(): void {
  if (defaultCache) {
    defaultCache.clear();
  }
  defaultCache = null;
}

// ================================
// 便捷函数
// ================================

/**
 * 快速获取/设置文本差分缓存
 */
export function cachedTextDiff(
  source: string,
  target: string,
  computeFn: () => { result: TextDiffResult; stats: DiffStats }
): CachedTextDiff {
  const cache = getDefaultDiffCache();
  const cached = cache.getTextDiff(source, target);

  if (cached) {
    return cached;
  }

  const { result, stats } = computeFn();
  cache.setTextDiff(source, target, result, stats);

  return {
    result,
    stats,
    cachedAt: Date.now(),
    sourceHash: quickHash(source),
    targetHash: quickHash(target),
  };
}

/**
 * 快速获取/设置二进制差分缓存
 */
export function cachedBinaryDiff(
  source: Uint8Array | readonly number[],
  target: Uint8Array | readonly number[],
  computeFn: () => BinaryDelta
): CachedBinaryDiff {
  const cache = getDefaultDiffCache();
  const cached = cache.getBinaryDiff(source, target);

  if (cached) {
    return cached;
  }

  const delta = computeFn();
  cache.setBinaryDiff(source, target, delta);

  return {
    delta,
    cachedAt: Date.now(),
    sourceHash: quickBinaryHash(source),
    targetHash: quickBinaryHash(target),
  };
}
