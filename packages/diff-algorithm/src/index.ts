// ================================
// Diff 算法库 - 统一导出
//
// 提供高性能、生产就绪的差分算法：
// - 文本差分 (diff-match-patch)
// - 二进制差分 (fossil-delta)
// - 编辑距离 (Levenshtein)
// - 模糊匹配 (Fuzzy Search)
// - Rsync 同步算法
// - Patience Diff / Histogram Diff
// - VCDIFF / BSDiff 适配器
// - CRDT 协作接口
// - 缓存层（LRU 缓存、diff 结果缓存）
// - 流式处理（大文件流式哈希、流式差分）
// - Worker 支持（后台线程差分计算）
//
// 使用场景：
// - 写作模块：自动保存、版本对比、撤销/重做
// - 代码阅读：代码差分、Git 对比
// - 搜索功能：拼写检查、模糊搜索、文件查找
// - 同步功能：增量同步、冲突检测
// - 软件更新：二进制增量更新
// - 实时协作：CRDT 支持（接口）
// - 大文件处理：Worker 后台计算、流式哈希
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
// 底层算法 - 滚动哈希
// ================================

export {
  // 类
  Adler32RollingHash,
  RabinRollingHash,
  ContentDefinedChunker,
  // 工厂函数
  createAdler32Hash,
  createRabinHash,
  createChunker,
  // 便捷函数
  quickAdler32,
  quickRabin,
  quickChunk,
} from './algorithms';

export type { IRollingHash, RollingHashConfig, ChunkConfig, Chunk, ChunkStats } from './algorithms';

// ================================
// 底层算法 - Rsync
// ================================

export {
  // 类
  RsyncEngine,
  // 工厂函数
  createRsyncEngine,
  createFastRsyncEngine,
  createPreciseRsyncEngine,
  createCDCRsyncEngine,
  // 便捷函数
  quickSignature,
  quickRsyncDelta,
  quickApplyRsyncDelta,
  quickRsync,
  quickRsyncEfficiency,
  resetDefaultRsyncEngine,
} from './algorithms';

export type {
  BlockSignature,
  FileSignature,
  DeltaInstructionType,
  DeltaInstruction,
  RsyncDelta,
  RsyncStats,
  RsyncConfig,
  RsyncSyncResult,
  RsyncEfficiencyEstimate,
} from './algorithms';

// ================================
// 底层算法 - Patience Diff
// ================================

export {
  // 类
  PatienceDiffEngine,
  // 工厂函数
  createPatienceDiffEngine,
  // 便捷函数
  quickPatienceDiff,
  quickFormatUnified,
  quickFormatHtml,
  resetDefaultPatienceDiffEngine,
} from './algorithms';

export type { PatienceDiffOp, DiffLine, PatienceDiffResult, PatienceDiffStats } from './algorithms';

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
// 底层算法 - LCS
// ================================

export {
  // 类
  LCSEngine,
  StringLCSEngine,
  LineLCSEngine,
  // 工厂函数
  createLCSEngine,
  createStringLCSEngine,
  createLineLCSEngine,
  // 便捷函数
  quickStringLCS,
  quickArrayLCS,
  quickLCSSimilarity,
  quickLineDiff as quickLCSLineDiff,
} from './algorithms';

export type { LCSResult, DiffItem, LCSConfig } from './algorithms';

// ================================
// 适配器 - VCDIFF/XDelta
// ================================

export {
  // 类
  VCDiffEngine,
  // 工厂函数
  createVCDiffEngine,
  createOptimalVCDiffEngine,
  // 便捷函数
  quickVCDiffEncode,
  quickVCDiffDecode,
  quickVCDiffString,
  quickVCDiffDecodeString,
  resetDefaultVCDiffEngine,
  // WASM 支持
  createWasmEncoder,
} from './algorithms';

export type {
  IVCDiffEncoder,
  VCDiffDelta,
  VCDiffOptions,
  VCDiffStats,
  VCDiffIncrementalDecision,
} from './algorithms';

// ================================
// 适配器 - BSDiff
// ================================

export {
  // 类
  BSDiffEngine,
  // 工厂函数
  createBSDiffEngine,
  createOptimalBSDiffEngine,
  createSoftwareUpdateEngine,
  // 便捷函数
  quickBSDiffPatch,
  quickBSDiffApply,
  quickBSDiffValidate,
  quickBSDiffEstimate,
  resetDefaultBSDiffEngine,
  // WASM 支持
  createWasmBSDiffEncoder,
} from './algorithms';

export type {
  IBSDiffEncoder,
  BSDiffPatch,
  BSDiffOptions,
  BSDiffStats,
  BSDiffEfficiencyEstimate,
  UpdateChainResult,
} from './algorithms';

// ================================
// CRDT 协作接口
// ================================

export {
  // 状态
  CRDTFeatureStatus,
  // 辅助函数
  generateClientId,
  compareVersionVectors,
  mergeVersionVectors,
  createEmptyVersionVector,
} from './algorithms';

export type {
  // 基础类型
  ClientId,
  Clock,
  VersionVector,
  CRDTOperationType,
  CRDTOperation,
  StateUpdate,
  SyncState,
  SemanticConflict,
  // 事件类型
  DocumentChangeEvent,
  SyncEvent,
  AwarenessEvent,
  AwarenessState,
  // 监听器类型
  DocumentChangeListener,
  SyncListener,
  AwarenessListener,
  // 接口类型
  ICRDTDocument,
  IAwareness,
  ISyncProvider,
  ICRDTEngine,
  // 配置类型
  SyncProviderConfig,
  ConnectionState,
  CRDTEngineConfig,
  // 适配器类型
  IYjsAdapter,
  IAutomergeAdapter,
  // 工厂类型
  CRDTEngineFactory,
  RegisterCRDTEngine,
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
// 流式处理
// ================================

export {
  // 流式哈希
  StreamingHasher,
  createStreamingHasher,
  createFastStreamingHasher,
  createQualityStreamingHasher,
  createCryptoStreamingHasher,
  quickFileHash,
  quickStringHash,
  quickBufferHash,
  quickStreamHash,
  compareFiles,
  calculateChecksum,
  // 流式差分
  StreamingDiffEngine,
  DiffAbortError,
  createStreamingDiffEngine,
  createLargeFileDiffEngine,
  createFastStreamingDiffEngine,
  quickStreamingDiff,
  quickApplyStreamingDelta,
  quickEstimateDiffEfficiency,
} from './streaming';

export type {
  HashAlgorithm,
  StreamingHasherConfig,
  HashResult,
  ChunkHashResult,
  StreamingHashResult,
  StreamingDiffConfig,
  DiffPhase,
  ChunkInfo,
  StreamingDiffResult,
  DeltaInstructionType as StreamingDeltaInstructionType,
  DeltaInstruction as StreamingDeltaInstruction,
  StreamingDelta,
} from './streaming';

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
