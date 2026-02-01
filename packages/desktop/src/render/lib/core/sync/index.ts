// ================================
// Sync Module
// Type definitions for future real-time collaboration
// Only interfaces are exported - implementations will be added when needed
// ================================

export type {
  // Sync Configuration
  SyncConfig,

  // Sync Messages
  SyncMessageType,
  SyncMessage,
  SyncRequestMessage,
  SyncResponseMessage,
  PushOperationsMessage,
  AckOperationsMessage,
  ErrorMessage,
  AnySyncMessage,

  // Sync Transport Interface
  ISyncTransport,

  // Conflict Resolution
  ConflictType,
  SyncConflict,
  ConflictResolutionStrategy,
  ConflictResolution,
  IConflictResolver,

  // Presence
  UserPresence,
  IPresenceManager,

  // Sync Engine Interface
  SyncEngineEventListener,
  ISyncEngine,

  // Offline Support Interface
  IOfflineStorage,
} from './types';

export {
  DEFAULT_SYNC_CONFIG,
  createInitialSyncState,
  createSyncRequest,
  createPushOperations,
} from './types';
