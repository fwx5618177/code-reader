// ================================
// Operations 模块
// CRDT/OT 实时协作的类型定义和实现
// ================================

// 类型导出
export type {
  // 操作元数据
  OperationMeta,

  // 文本操作
  InsertOperation,
  DeleteOperation,
  RetainOperation,
  ReplaceOperation,
  TextOperation,

  // 文档操作
  SetTitleOperation,
  SetMetadataOperation,
  DocumentOperation,

  // 操作日志
  OperationLogEntry,
  IOperationLog,
  OperationLogConfig,
  OperationLogStats,

  // 操作变换
  TransformResult,
  IOperationalTransformer,

  // CRDT
  CharacterId,
  CRDTCharacter,
  ICRDTDocument,

  // 同步状态
  SyncStatus,
  SyncState,
  SyncEvent,
  SyncEventListener,
} from './types';

export { initialSyncState } from './types';

// 操作日志实现
export {
  OperationLog,
  createOperationLog,
  getDefaultOperationLog,
  resetDefaultOperationLog,
} from './operation-log';
