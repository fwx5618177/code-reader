// ================================
// Delta 模块
// 生产级增量差分、内容哈希、版本化快照和撤销/重做
//
// 核心差分算法已抽象到 lib/diff 目录
// 本模块提供业务层封装和扩展
// ================================

// ================================
// 统一差分引擎（核心导出）
// 整合 diff-match-patch、Myers diff、二进制差分、编辑距离、模糊匹配
// ================================

export {
  // 常量
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  // 核心类
  DiffEngine,
  TextDiffEngine,
  BinaryDiffEngine,
  LevenshteinEngine,
  FuzzyMatchEngine,
  // 工厂函数
  createDiffEngine,
  createCodeDiffEngine,
  createFastDiffEngine,
  createTextDiffEngine,
  createBinaryDiffEngine,
  createLevenshteinEngine,
  createSpellCheckEngine,
  createFuzzyMatchEngine,
  createFileSearchEngine,
  createCommandSearchEngine,
  // 业务层扩展
  createWritingDiffEngine,
  createAutoSaveDiffEngine,
  diffsToOperations,
  isIncrementalWorth,
  getDiffEfficiency,
  // 便捷函数
  quickDiff,
  quickApplyDiff,
  quickCreatePatch,
  quickApplyPatch,
  quickBinaryDiff,
  quickApplyBinaryDiff,
  quickDistance,
  quickSearch,
  quickSimilarity,
  quickFuzzyMatch,
  quickFuzzySearch,
  quickHighlight,
  quickSpellingSuggestions,
  resetDefaultDiffEngine,
} from './diff-engine';

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
  // 扩展类型
  DeltaEfficiency,
  IncrementalDecision,
  SimilarItem,
  SpellingSuggestion,
} from './diff-engine';

// ================================
// 历史管理器（生产级撤销/重做）
// ================================

export {
  // 工具函数
  createSelection,
  createEditorState,
  // 管理器
  HistoryManager,
  createHistoryManager,
  getDefaultHistoryManager,
  resetDefaultHistoryManager,
} from './history-manager';

export type {
  SelectionState,
  EditorState,
  HistoryEntry,
  Transaction,
  HistoryManagerConfig,
  HistoryEventType,
  HistoryEvent,
  HistoryEventListener,
  HistoryOperationResult,
} from './history-manager';

// ================================
// 内容哈希
// ================================

export {
  ContentHasher,
  createContentHasher,
  createFastHasher,
  createSecureHasher,
  hashContent,
  shortHashContent,
  compareContent,
} from './content-hasher';

export type { HashAlgorithm, ContentHasherConfig, HashResult } from './content-hasher';

// ================================
// 版本化快照
// ================================

export {
  VersionedSnapshotFactory,
  createSnapshotFactory,
  createSnapshot,
  compareSnapshots,
  validateSnapshot,
  hasSnapshotContentChanged,
} from './versioned-snapshot';

export type {
  VersionedSnapshot,
  SnapshotCompareResult,
  SnapshotValidationResult,
  VersionVectorEntry,
  VersionVector,
  SnapshotMetadata,
  SnapshotFactoryConfig,
} from './versioned-snapshot';
