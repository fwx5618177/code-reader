// ================================
// Delta 模块
// 内容哈希、版本化快照和撤销/重做
//
// 差分算法请直接从 @code-reader/diff-algorithm 导入
// ================================

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
