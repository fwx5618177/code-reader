// ================================
// Diff 算法库 - 统一导出
//
// 桌面端正在使用的差分能力：
// - 文本差分 (diff-match-patch)：保存引擎、历史管理、写作服务
// - 二进制差分 (fossil-delta)：统一差分引擎的增量判断
// - 编辑距离、模糊匹配：统一差分引擎的距离与搜索
// - Histogram Diff：版本对比按行对齐
// - 缓存层（LRU 缓存、diff 结果缓存）、Worker 支持（后台线程差分计算）
//
// 暂未使用的算法（rsync、滚动哈希、Patience、LCS、VCDIFF / BSDiff、CRDT 接口、流式哈希与流式差分、
// 独立的 diff-match-patch Worker 实现）在 @code-reader/diff-algorithm-extras 中，需要时单独引入
// ================================

// ================================
// 类型定义
// ================================

export type {
  // 基础类型
  DiffAlgorithm,
  DiffOpType,
  TextDiff,
  // 文本差分类型
  TextDiffResult,
  Patch,
  PatchResult,
  DiffStats,
  TextDiffConfig,
  // 二进制差分类型
  BinaryDelta,
  // 编辑距离类型
  EditOperation,
  EditStep,
  LevenshteinResult,
  LevenshteinConfig,
  // 模糊匹配类型
  MatchResult,
  SearchResultItem,
  MatchHighlight,
  FuzzyMatchConfig,
  FuzzySearchConfig,
  // 差分引擎类型
  DiffEngineConfig,
  AlgorithmHints,
  DiffOperation,
  IncrementalSaveData,
  // 接口类型
  ITextDiffAlgorithm,
  IBinaryDiffAlgorithm,
  ILevenshteinAlgorithm,
  IFuzzyMatchAlgorithm,
  IDiffEngine,
  // 工具类型
  DeepReadonly,
  DeepPartial,
} from './types';

// 常量
export { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT } from './types';

// ================================
// 文本差分
// ================================

export {
  // 核心类
  TextDiffEngine,
  // 工厂函数
  createTextDiffEngine,
  createCodeDiffEngine as createCodeTextDiffEngine,
  createFastTextDiffEngine,
  // 便捷函数
  quickTextDiff,
  quickLineDiff,
  quickApplyTextDiff,
  quickCreatePatch as quickTextCreatePatch,
  quickApplyPatch as quickTextApplyPatch,
  quickDiffStats,
  resetDefaultTextDiffEngine,
} from './text-diff';

// ================================
// 二进制差分
// ================================

export {
  // 核心类
  BinaryDiffEngine,
  // 工厂函数
  createBinaryDiffEngine,
  // 便捷函数
  quickBinaryDiff,
  quickApplyBinaryDiff,
  quickBinaryDiffString,
  quickApplyBinaryDiffString,
  quickShouldUseIncremental,
  resetDefaultBinaryDiffEngine,
} from './binary-diff';

export type { DeltaEfficiency, IncrementalDecision } from './binary-diff';

// ================================
// 编辑距离 (Levenshtein)
// ================================

export {
  // 核心类
  LevenshteinEngine,
  // 工厂函数
  createLevenshteinEngine,
  // 便捷函数
  quickLevenshteinDistance,
  quickSimilarity,
  quickFindMostSimilar,
  quickSpellingSuggestions,
  resetDefaultLevenshteinEngine,
} from './levenshtein';

export type { SimilarItem, SpellingSuggestion } from './levenshtein';

// ================================
// 模糊匹配
// ================================

export {
  // 核心类
  FuzzyMatchEngine,
  // 工厂函数
  createFuzzyMatchEngine,
  createFileSearchEngine,
  createCommandSearchEngine,
  // 便捷函数
  quickFuzzyMatch,
  quickFuzzySearch,
  quickSearchStrings,
  quickHighlight,
  resetDefaultFuzzyMatchEngine,
} from './fuzzy-match';

export type { HighlightResult } from './fuzzy-match';

// ================================
// 统一差分引擎
// ================================

export {
  // 核心类
  DiffEngine,
  // 工厂函数
  createDiffEngine,
  createCodeDiffEngine,
  createFastDiffEngine,
  // 便捷函数
  quickDiff,
  quickApplyDiff,
  quickCreatePatch,
  quickApplyPatch,
  quickBinaryDiff as quickUnifiedBinaryDiff,
  quickApplyBinaryDiff as quickUnifiedApplyBinaryDiff,
  quickDistance,
  quickSearch,
  resetDefaultDiffEngine,
} from './diff-engine';

// ================================
// 底层算法 - Histogram Diff
// ================================

export {
  // 类
  HistogramDiffEngine,
  // 工厂函数
  createHistogramDiffEngine,
  createWhitespaceAgnosticDiffEngine,
  // 便捷函数
  quickHistogramDiff,
  quickHistogramFormatUnified,
  quickHistogramFormatHtml,
  quickLineChanges,
  resetDefaultHistogramDiffEngine,
} from './algorithms';

export type {
  HistogramDiffOp,
  DiffHunk,
  HistogramDiffResult,
  HistogramDiffStats,
  HistogramDiffConfig,
  LineChange,
} from './algorithms';

// ================================
// 缓存层
// ================================

export {
  // LRU 缓存
  LRUCache,
  createLRUCache,
  createTTLCache,
  createMemoryLimitedCache,
  createStringCache,
  createJSONCache,
  estimateObjectSize,
  // Diff 缓存
  DiffCache,
  createDiffCache,
  createHighPerformanceCache,
  createLightweightCache,
  getDefaultDiffCache,
  resetDefaultDiffCache,
  cachedTextDiff,
  cachedBinaryDiff,
  quickHash,
  quickBinaryHash,
} from './cache';

export type {
  LRUCacheConfig,
  EvictReason,
  CacheStats,
  CacheKeyStrategy,
  DiffCacheConfig,
  CachedTextDiff,
  CachedBinaryDiff,
  DiffCacheStats,
} from './cache';

// ================================
// Worker 支持
// ================================

export {
  // Worker Pool
  WorkerPool,
  createWorkerPool,
  createHighPerformancePool,
  createLightweightPool,
  getDefaultWorkerPool,
  closeDefaultWorkerPool,
  // Async Diff Engine
  AsyncDiffEngine,
  createAsyncDiffEngine,
  createHighPerformanceAsyncEngine,
  createIsolatedAsyncEngine,
  getDefaultAsyncDiffEngine,
  resetDefaultAsyncDiffEngine,
  quickAsyncDiff,
  quickAsyncBinaryDiff,
  quickAsyncHash,
  quickAsyncSimilarity,
} from './worker';

export type {
  WorkerMessageType,
  WorkerRequest,
  WorkerResponse,
  TextDiffRequest,
  BinaryDiffRequest,
  ApplyDiffRequest,
  ComputeHashRequest,
  SimilarityRequest,
  ChunkRequest,
  WorkerPoolConfig,
  TaskStatus,
  TaskInfo,
  WorkerStatus,
  PoolStats,
  AsyncDiffEngineConfig,
  AsyncTextDiffResult,
  AsyncBinaryDiffResult,
} from './worker';

// ================================
// 默认导出
// ================================

// 推荐使用统一差分引擎
export { DiffEngine as default } from './diff-engine';
