// ================================
// Worker 模块 - 统一导出
//
// 提供后台线程差分计算功能：
// - Diff Worker（后台差分计算）
// - Worker Pool（多 Worker 管理）
// - Async Diff Engine（异步差分引擎）
// ================================

// ================================
// Diff Worker
// ================================

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
} from './diff-worker';

export {
  handleMessage,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from './diff-worker';

// ================================
// Worker Pool
// ================================

export {
  // 核心类
  WorkerPool,
  // 工厂函数
  createWorkerPool,
  createHighPerformancePool,
  createLightweightPool,
  // 默认实例
  getDefaultWorkerPool,
  closeDefaultWorkerPool,
} from './worker-pool';

export type {
  WorkerPoolConfig,
  TaskStatus,
  TaskInfo,
  WorkerStatus,
  PoolStats,
} from './worker-pool';

// ================================
// Async Diff Engine
// ================================

export {
  // 核心类
  AsyncDiffEngine,
  // 工厂函数
  createAsyncDiffEngine,
  createHighPerformanceAsyncEngine,
  createIsolatedAsyncEngine,
  // 默认实例
  getDefaultAsyncDiffEngine,
  resetDefaultAsyncDiffEngine,
  // 便捷函数
  quickAsyncDiff,
  quickAsyncBinaryDiff,
  quickAsyncHash,
  quickAsyncSimilarity,
} from './async-diff-engine';

export type {
  AsyncDiffEngineConfig,
  AsyncTextDiffResult,
  AsyncBinaryDiffResult,
} from './async-diff-engine';
