// ================================
// 差分算法库 - 算法模块索引
// 导出所有底层算法实现
// ================================

// ================================
// 滚动哈希算法
// rsync 和 CDC 的基础
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
} from './rolling-hash';

export type {
  IRollingHash,
  RollingHashConfig,
  ChunkConfig,
  Chunk,
  ChunkStats,
} from './rolling-hash';

// ================================
// Rsync 算法
// 基于签名的增量同步
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
} from './rsync';

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
} from './rsync';

// ================================
// Patience Diff 算法
// 更易读的差分结果
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
} from './patience-diff';

export type {
  PatienceDiffOp,
  DiffLine,
  PatienceDiffResult,
  PatienceDiffStats,
} from './patience-diff';

// ================================
// Histogram Diff 算法
// Git 默认算法
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
} from './histogram-diff';

export type {
  HistogramDiffOp,
  DiffHunk,
  HistogramDiffResult,
  HistogramDiffStats,
  HistogramDiffConfig,
  LineChange,
} from './histogram-diff';

// ================================
// LCS (最长公共子序列) 算法
// 多种差分算法的基础
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
  quickLineDiff,
} from './lcs';

export type { LCSResult, DiffItem, LCSConfig } from './lcs';

// ================================
// VCDIFF/XDelta 适配器
// RFC 3284 标准增量编码
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
} from './vcdiff-adapter';

export type {
  IVCDiffEncoder,
  VCDiffDelta,
  VCDiffOptions,
  VCDiffStats,
  IncrementalDecision as VCDiffIncrementalDecision,
} from './vcdiff-adapter';

// ================================
// BSDiff 适配器
// 软件更新优化
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
} from './bsdiff-adapter';

export type {
  IBSDiffEncoder,
  BSDiffPatch,
  BSDiffOptions,
  BSDiffStats,
  BSDiffEfficiencyEstimate,
  UpdateChainResult,
} from './bsdiff-adapter';

// ================================
// CRDT 接口
// 实时协作支持（仅接口）
// ================================

export {
  // 状态
  CRDTFeatureStatus,
  // 辅助函数
  generateClientId,
  compareVersionVectors,
  mergeVersionVectors,
  createEmptyVersionVector,
} from './crdt-interface';

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
} from './crdt-interface';
