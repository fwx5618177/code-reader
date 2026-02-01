// ================================
// Streaming 模块 - 统一导出
//
// 提供大文件流式处理功能：
// - 流式哈希计算
// - 流式差分处理
// ================================

// ================================
// 流式哈希
// ================================

export {
  // 核心类
  StreamingHasher,
  // 工厂函数
  createStreamingHasher,
  createFastStreamingHasher,
  createQualityStreamingHasher,
  createCryptoStreamingHasher,
  // 便捷函数
  quickFileHash,
  quickStringHash,
  quickBufferHash,
  quickStreamHash,
  compareFiles,
  calculateChecksum,
} from './streaming-hasher';

export type {
  HashAlgorithm,
  StreamingHasherConfig,
  HashResult,
  ChunkHashResult,
  StreamingHashResult,
} from './streaming-hasher';

// ================================
// 流式差分
// ================================

export {
  // 核心类
  StreamingDiffEngine,
  DiffAbortError,
  // 工厂函数
  createStreamingDiffEngine,
  createLargeFileDiffEngine,
  createFastStreamingDiffEngine,
  // 便捷函数
  quickStreamingDiff,
  quickApplyStreamingDelta,
  quickEstimateDiffEfficiency,
} from './streaming-diff';

export type {
  StreamingDiffConfig,
  DiffPhase,
  ChunkInfo,
  StreamingDiffResult,
  DeltaInstructionType,
  DeltaInstruction,
  StreamingDelta,
} from './streaming-diff';
