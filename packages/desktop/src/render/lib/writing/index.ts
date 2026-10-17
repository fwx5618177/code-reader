// ================================
// Writing Module - Unified Export
// 写作模块统一导出
//
// 提供写作相关的核心功能：
// - 全文搜索索引（自动持久化）
// - 文档差分计算（带缓存）
// - 搜索建议
// - Worker 后台计算
// - React Hooks 集成
// - 性能监控
// - UI 组件
// - 基准测试工具
// ================================

// ================================
// Types
// ================================

export type {
  // Document Types
  IndexableDocument,
  DocumentSearchResult,
  SearchSuggestion,

  // Diff Types
  CachedDiff,
  IncrementalOperation,
  IncrementalData,

  // Config Types
  WritingServiceConfig,
  WritingServiceState,
  WritingServiceEvent,
  WritingServiceEventType,
  WritingServiceEventListener,

  // Options Types
  DocumentSearchOptions,
  SuggestionOptions,
  DiffOptions,

  // Interface Types
  IWritingService,
  IIndexStorage,
} from './types';

// Constants
export {
  DEFAULT_WRITING_CONFIG,
  DEFAULT_SEARCH_OPTIONS,
  DEFAULT_SUGGESTION_OPTIONS,
  DEFAULT_DIFF_OPTIONS,
  initialWritingServiceState,
} from './types';

// ================================
// Index Storage
// ================================

export {
  IndexStorage,
  createIndexStorage,
  createMemoryIndexStorage,
  getDefaultIndexStorage,
  closeDefaultIndexStorage,
} from './index-storage';

export type { IndexStorageConfig } from './index-storage';

// ================================
// Writing Service
// ================================

export {
  WritingService,
  createWritingService,
  createHighPerformanceWritingService,
  createLightweightWritingService,
  getDefaultWritingService,
  resetDefaultWritingService,
} from './writing-service';

// ================================
// React Hooks
// ================================

export { useWritingService, useDocumentSearch, useContentDiff } from './useWritingService';

export type { UseWritingServiceConfig, UseWritingServiceReturn } from './useWritingService';

// ================================
// Performance Monitor
// ================================

export {
  PerformanceMonitor,
  createPerformanceMonitor,
  createDetailedMonitor,
  createLightweightMonitor,
  getDefaultPerformanceMonitor,
  resetDefaultPerformanceMonitor,
  formatReport,
  exportMetricsAsJSON,
} from './performance-monitor';

export type {
  MetricType,
  PerformanceMetric,
  MetricSummary,
  PerformanceReport,
  PerformanceMonitorConfig,
} from './performance-monitor';

// ================================
// 基准测试工具
// ================================

export {
  WritingBenchmark,
  formatBenchmarkReport,
  exportBenchmarkAsJSON,
  runQuickBenchmark,
  runFullBenchmark,
} from './benchmark';

export type { BenchmarkConfig, BenchmarkResult, BenchmarkReport } from './benchmark';

// ================================
// Worker (Complete Implementation)
// ================================

export {
  // Diff functions
  diffMain,
  diffCleanupSemantic,
  diffCleanupEfficiency,
  diffCleanupMerge,
  diffApply,
  computeDiffStats,

  // Hash functions
  fnv1aHash,
  xxHash32,
  adler32Hash,

  // Similarity
  levenshteinDistance,

  // Message handler
  handleMessage,

  // Constants
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from './diff-worker-complete';

export type {
  WorkerMessageType,
  WorkerRequest,
  WorkerResponse,
  Diff,
  DiffOp,
} from './diff-worker-complete';

// ================================
// Worker Script Generator
// ================================

export {
  generateCompleteWorkerScript,
  createWorkerBlobUrl,
  revokeWorkerBlobUrl,
} from './worker-script-generator';

// ================================
// Enhanced Worker Pool
// ================================

export {
  EnhancedWorkerPool,
  createEnhancedWorkerPool,
  createHighPerformanceEnhancedPool,
  createLightweightEnhancedPool,
  getDefaultEnhancedWorkerPool,
  closeDefaultEnhancedWorkerPool,
} from './enhanced-worker-pool';

export type {
  EnhancedWorkerPoolConfig,
  TextDiffPayload,
  ApplyDiffPayload,
  HashPayload,
  SimilarityPayload,
  CleanupPayload,
  TextDiffResult,
  HashResult,
  SimilarityResult,
  PoolStats,
} from './enhanced-worker-pool';
