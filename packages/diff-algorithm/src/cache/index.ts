// ================================
// Cache 模块 - 统一导出
//
// 提供高性能缓存功能：
// - LRU 缓存
// - 差分结果缓存
// ================================

// ================================
// LRU 缓存
// ================================

export {
  // 核心类
  LRUCache,
  // 工厂函数
  createLRUCache,
  createTTLCache,
  createMemoryLimitedCache,
  createStringCache,
  createJSONCache,
  // 工具函数
  estimateObjectSize,
} from './lru-cache';

export type {
  LRUCacheConfig,
  EvictReason,
  CacheStats,
} from './lru-cache';

// ================================
// 差分缓存
// ================================

export {
  // 核心类
  DiffCache,
  // 工厂函数
  createDiffCache,
  createHighPerformanceCache,
  createLightweightCache,
  // 默认实例
  getDefaultDiffCache,
  resetDefaultDiffCache,
  // 便捷函数
  cachedTextDiff,
  cachedBinaryDiff,
  // 哈希工具
  quickHash,
  quickBinaryHash,
} from './diff-cache';

export type {
  CacheKeyStrategy,
  DiffCacheConfig,
  CachedTextDiff,
  CachedBinaryDiff,
  DiffCacheStats,
} from './diff-cache';
