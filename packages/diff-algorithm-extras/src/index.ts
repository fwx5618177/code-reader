// ================================
// @code-reader/diff-algorithm-extras
// 从 @code-reader/diff-algorithm 中分出的、桌面端当前没有用到的差分算法。
// 与正在使用的核心差分库解耦：核心库不依赖本包，需要时单独引入。
//
// - 底层算法（./algorithms）：滚动哈希与内容分块、rsync 增量同步、Patience Diff、LCS、
//   VCDIFF / BSDiff 适配器、CRDT 协作接口定义
// - 流式处理（./streaming）：大文件流式哈希、流式差分
// - 独立 DMP 实现（./dmp-standalone）：不依赖 diff-match-patch 包的完整差分 / 清理 / 应用 /
//   哈希 / 相似度实现，以及可内联为 Blob Worker 的脚本生成器与 Worker 池
// ================================

export * from './algorithms';

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

export * as dmpStandalone from './dmp-standalone';
