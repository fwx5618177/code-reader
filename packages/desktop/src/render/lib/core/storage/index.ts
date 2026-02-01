// ================================
// Storage 模块
// 离线存储和持久化
// ================================

// IndexedDB 离线存储
export {
  IndexedDBStorage,
  createIndexedDBStorage,
  getDefaultStorage,
  closeDefaultStorage,
} from './indexed-db-storage';

export type {
  DiffOperation,
  PendingOperation,
  StoredSnapshot,
  StorageStats,
  OfflineStorageConfig,
} from './indexed-db-storage';
