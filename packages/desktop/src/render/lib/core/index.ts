// ================================
// Core 模块
// 版本化编辑和自动保存的基础架构
//
// 本模块提供成熟的、生产就绪的抽象：
// - 版本化内容追踪（VS Code 风格）
// - 拉取式自动保存引擎
// - 增量差分压缩
// - 离线存储支持
// - 操作日志
//
// 未来模块（当前仅接口）：
// - CRDT/OT 协作操作
// - 同步状态管理
// ================================

// ================================
// Editor Model
// 版本化内容管理
// ================================

export type {
  VersionedContent,
  ContentSnapshot,
  ContentChangeEvent,
  ContentChangeListener,
  EditorModelConfig,
  IEditorModel,
  VersionTrackerConfig,
  VersionSnapshot,
  VersionChangeEvent,
  VersionChangeListener,
  // 可撤销编辑器模型
  UndoableEditorModelConfig,
  UndoRedoState,
} from './editor-model';

export {
  createVersionedContent,
  areVersionsEqual,
  hasContentChanged,
  VersionTracker,
  createVersionTracker,
  EditorModel,
  createEditorModel,
  createEditorModelFromDocument,
  useEditorModel,
  // 可撤销编辑器模型
  UndoableEditorModel,
  createUndoableEditorModel,
  createUndoableEditorModelFromDocument,
  // 编辑器管理器（单例）
  DocumentEditorManager,
  getEditorManager,
  acquireEditor,
  releaseEditor,
  getEditor,
  // 托管编辑器 Hook
  useManagedEditor,
} from './editor-model';

export type { UseEditorModelConfig, UseEditorModelReturn } from './editor-model';

// 编辑器管理器类型
export type {
  ManagedEditorInstance,
  EditorManagerConfig,
  CreateEditorOptions,
  AcquireResult,
} from './editor-model';

// 托管编辑器 Hook 类型
export type { UseManagedEditorConfig, UseManagedEditorReturn } from './editor-model';

// ================================
// Save Engine
// 拉取式版本感知自动保存
// ================================

export type {
  SaveResult,
  ISaveStrategy,
  IContentProvider,
  ISaveExecutor,
  SaveEngineState,
  SaveEngineEvent,
  SaveEngineEventListener,
  SaveEngineConfig,
  ISaveEngine,
  DebouncedStrategyConfig,
  ImmediateStrategyConfig,
} from './save-engine';

export {
  createSuccessResult,
  createFailedResult,
  initialSaveEngineState,
  DebouncedSaveStrategy,
  createDebouncedStrategy,
  createTypingOptimizedStrategy,
  createResponsiveStrategy,
  DEFAULT_DEBOUNCED_CONFIG,
  ImmediateSaveStrategy,
  createImmediateStrategy,
  DEFAULT_IMMEDIATE_CONFIG,
  SaveEngine,
  createSaveEngine,
  createAutoSaveEngine,
  useSaveEngine,
} from './save-engine';

// ================================
// Delta
// 内容哈希、版本化快照和撤销/重做（差分算法直接使用 @code-reader/diff-algorithm）
// ================================

export type {
  // 历史管理器（生产级撤销/重做）
  SelectionState,
  EditorState,
  HistoryEntry,
  Transaction,
  HistoryManagerConfig,
  HistoryEventType,
  HistoryEvent,
  HistoryEventListener,
  HistoryOperationResult,
  // 内容哈希
  HashAlgorithm,
  ContentHasherConfig,
  HashResult,
  // 版本化快照
  VersionedSnapshot,
  SnapshotCompareResult,
  SnapshotValidationResult,
  VersionVectorEntry,
  VersionVector,
  SnapshotMetadata,
  SnapshotFactoryConfig,
} from './delta';

export {
  // 历史管理器（生产级撤销/重做）
  createSelection,
  createEditorState,
  HistoryManager,
  createHistoryManager,
  getDefaultHistoryManager,
  resetDefaultHistoryManager,
  // 内容哈希
  ContentHasher,
  createContentHasher,
  createFastHasher,
  createSecureHasher,
  hashContent,
  shortHashContent,
  compareContent,
  // 版本化快照
  VersionedSnapshotFactory,
  createSnapshotFactory,
  createSnapshot,
  compareSnapshots,
  validateSnapshot,
  hasSnapshotContentChanged,
} from './delta';

// ================================
// Storage
// 离线存储和持久化
// ================================

export type {
  PendingOperation,
  StoredSnapshot,
  StorageStats,
  OfflineStorageConfig,
} from './storage';

export {
  IndexedDBStorage,
  createIndexedDBStorage,
  getDefaultStorage,
  closeDefaultStorage,
} from './storage';

// ================================
// Operations
// CRDT/OT 协作基础
// ================================

export type {
  OperationMeta,
  InsertOperation,
  DeleteOperation,
  RetainOperation,
  ReplaceOperation,
  TextOperation,
  SetTitleOperation,
  SetMetadataOperation,
  DocumentOperation,
  OperationLogEntry,
  IOperationLog,
  TransformResult,
  IOperationalTransformer,
  CharacterId,
  CRDTCharacter,
  ICRDTDocument,
  SyncStatus,
  SyncState,
  SyncEvent,
  SyncEventListener,
  OperationLogConfig,
  OperationLogStats,
} from './operations';

export {
  initialSyncState,
  // 操作日志实现
  OperationLog,
  createOperationLog,
  getDefaultOperationLog,
  resetDefaultOperationLog,
} from './operations';

// ================================
// Sync
// 实时协作支持（仅类型）
// ================================

export type {
  SyncConfig,
  SyncMessageType,
  SyncMessage,
  SyncRequestMessage,
  SyncResponseMessage,
  PushOperationsMessage,
  AckOperationsMessage,
  ErrorMessage,
  AnySyncMessage,
  ISyncTransport,
  ConflictType,
  SyncConflict,
  ConflictResolutionStrategy,
  ConflictResolution,
  IConflictResolver,
  UserPresence,
  IPresenceManager,
  SyncEngineEventListener,
  ISyncEngine,
  IOfflineStorage,
} from './sync';

export {
  DEFAULT_SYNC_CONFIG,
  createInitialSyncState,
  createSyncRequest,
  createPushOperations,
} from './sync';
