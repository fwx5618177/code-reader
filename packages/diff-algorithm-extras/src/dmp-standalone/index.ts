// ================================
// 独立的 diff-match-patch 实现（原桌面端 lib/writing 中的差分 Worker）
// 不依赖 diff-match-patch 包：差分、语义 / 效率清理、合并、应用、统计，
// 以及 FNV-1a / xxHash32 / Adler-32 哈希与 Levenshtein 相似度；
// 可作为模块 Worker 入口，也可经脚本生成器内联为 Blob Worker 由 EnhancedWorkerPool 调度
// ================================

export {
  diffMain,
  diffCleanupSemantic,
  diffCleanupEfficiency,
  diffCleanupMerge,
  diffApply,
  computeDiffStats,
  fnv1aHash,
  xxHash32,
  adler32Hash,
  levenshteinDistance,
  handleMessage,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from './diff-worker';

export type { WorkerMessageType, WorkerRequest, WorkerResponse, Diff, DiffOp } from './diff-worker';

export { generateCompleteWorkerScript, createWorkerBlobUrl, revokeWorkerBlobUrl } from './worker-script-generator';

export {
  EnhancedWorkerPool,
  createEnhancedWorkerPool,
  createHighPerformanceEnhancedPool,
  createLightweightEnhancedPool,
  getDefaultEnhancedWorkerPool,
  closeDefaultEnhancedWorkerPool,
} from './worker-pool';

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
} from './worker-pool';
