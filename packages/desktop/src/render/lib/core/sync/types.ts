// ================================
// Sync Types
// Foundation for real-time collaboration
// ================================

import { DocumentOperation, SyncStatus, SyncState, SyncEvent } from '../operations';

// ================================
// Sync Configuration
// ================================

/**
 * Sync engine configuration
 */
export interface SyncConfig {
  /** Unique client identifier */
  clientId: string;
  /** Document identifier */
  documentId: string;
  /** Sync interval in milliseconds (for polling mode) */
  syncIntervalMs?: number;
  /** Whether to use real-time sync (WebSocket) or polling */
  realtime?: boolean;
  /** Maximum retry attempts for failed syncs */
  maxRetries?: number;
  /** Retry delay in milliseconds */
  retryDelayMs?: number;
  /** Whether to enable offline support */
  offlineSupport?: boolean;
  /** Debug logging */
  debug?: boolean;
}

/**
 * Default sync configuration
 */
export const DEFAULT_SYNC_CONFIG: Required<SyncConfig> = {
  clientId: '',
  documentId: '',
  syncIntervalMs: 5000,
  realtime: false,
  maxRetries: 3,
  retryDelayMs: 1000,
  offlineSupport: true,
  debug: false,
};

// ================================
// Sync Transport
// ================================

/**
 * Message types for sync protocol
 */
export type SyncMessageType =
  | 'SYNC_REQUEST'      // Request to sync operations
  | 'SYNC_RESPONSE'     // Response with remote operations
  | 'PUSH_OPERATIONS'   // Push local operations to server
  | 'ACK_OPERATIONS'    // Acknowledge received operations
  | 'PRESENCE_UPDATE'   // Update presence information
  | 'ERROR';            // Error message

/**
 * Base sync message
 */
export interface SyncMessage {
  type: SyncMessageType;
  documentId: string;
  clientId: string;
  timestamp: number;
}

/**
 * Sync request message
 */
export interface SyncRequestMessage extends SyncMessage {
  type: 'SYNC_REQUEST';
  /** Last known version from server */
  lastKnownVersionId: number;
}

/**
 * Sync response message
 */
export interface SyncResponseMessage extends SyncMessage {
  type: 'SYNC_RESPONSE';
  /** Operations since lastKnownVersionId */
  operations: DocumentOperation[];
  /** Current server version */
  serverVersionId: number;
}

/**
 * Push operations message
 */
export interface PushOperationsMessage extends SyncMessage {
  type: 'PUSH_OPERATIONS';
  /** Operations to push */
  operations: DocumentOperation[];
  /** Base version these operations are based on */
  baseVersionId: number;
}

/**
 * Acknowledge operations message
 */
export interface AckOperationsMessage extends SyncMessage {
  type: 'ACK_OPERATIONS';
  /** Acknowledged operation IDs */
  operationIds: string[];
  /** New server version after applying operations */
  newVersionId: number;
}

/**
 * Error message
 */
export interface ErrorMessage extends SyncMessage {
  type: 'ERROR';
  /** Error code */
  code: string;
  /** Error message */
  message: string;
}

/**
 * All sync message types
 */
export type AnySyncMessage =
  | SyncRequestMessage
  | SyncResponseMessage
  | PushOperationsMessage
  | AckOperationsMessage
  | ErrorMessage;

// ================================
// Sync Transport Interface
// ================================

/**
 * Transport layer for sync communication
 * Can be implemented with WebSocket, HTTP, etc.
 */
export interface ISyncTransport {
  /**
   * Connect to the sync server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the sync server
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  /**
   * Send a message to the server
   */
  send(message: AnySyncMessage): Promise<void>;

  /**
   * Subscribe to incoming messages
   * @returns Unsubscribe function
   */
  onMessage(callback: (message: AnySyncMessage) => void): () => void;

  /**
   * Subscribe to connection state changes
   * @returns Unsubscribe function
   */
  onConnectionChange(callback: (connected: boolean) => void): () => void;

  /**
   * Subscribe to errors
   * @returns Unsubscribe function
   */
  onError(callback: (error: Error) => void): () => void;
}

// ================================
// Conflict Resolution
// ================================

/**
 * Conflict types that can occur during sync
 */
export type ConflictType =
  | 'CONCURRENT_EDIT'     // Both local and remote edited same region
  | 'DELETE_UPDATE'       // Local deleted what remote updated (or vice versa)
  | 'VERSION_MISMATCH'    // Versions are out of sync
  | 'SCHEMA_MISMATCH';    // Document schemas don't match

/**
 * Conflict information
 */
export interface SyncConflict {
  /** Type of conflict */
  type: ConflictType;
  /** Local operations involved */
  localOperations: DocumentOperation[];
  /** Remote operations involved */
  remoteOperations: DocumentOperation[];
  /** Local version when conflict occurred */
  localVersionId: number;
  /** Remote version when conflict occurred */
  remoteVersionId: number;
  /** Timestamp of conflict detection */
  timestamp: number;
}

/**
 * Conflict resolution strategy
 */
export type ConflictResolutionStrategy =
  | 'LOCAL_WINS'          // Keep local changes, discard remote
  | 'REMOTE_WINS'         // Keep remote changes, discard local
  | 'MERGE'               // Attempt to merge both
  | 'MANUAL'              // Require user intervention
  | 'LAST_WRITE_WINS';    // Use timestamp to decide

/**
 * Conflict resolution result
 */
export interface ConflictResolution {
  /** How the conflict was resolved */
  strategy: ConflictResolutionStrategy;
  /** Resulting operations to apply */
  resultOperations: DocumentOperation[];
  /** New version after resolution */
  newVersionId: number;
  /** Whether user intervention was required */
  userIntervention: boolean;
}

/**
 * Conflict resolver interface
 */
export interface IConflictResolver {
  /**
   * Resolve a sync conflict
   */
  resolve(
    conflict: SyncConflict,
    preferredStrategy?: ConflictResolutionStrategy
  ): Promise<ConflictResolution>;

  /**
   * Set the default resolution strategy
   */
  setDefaultStrategy(strategy: ConflictResolutionStrategy): void;

  /**
   * Get the default resolution strategy
   */
  getDefaultStrategy(): ConflictResolutionStrategy;
}

// ================================
// Presence
// ================================

/**
 * User presence information
 */
export interface UserPresence {
  /** User/client identifier */
  clientId: string;
  /** User display name */
  name?: string;
  /** User avatar URL */
  avatarUrl?: string;
  /** Cursor position in document */
  cursorPosition?: number;
  /** Selection range */
  selection?: {
    start: number;
    end: number;
  };
  /** Last activity timestamp */
  lastActiveAt: number;
  /** Whether user is currently active */
  isActive: boolean;
}

/**
 * Presence manager interface
 */
export interface IPresenceManager {
  /**
   * Update local presence
   */
  updateLocalPresence(presence: Partial<UserPresence>): void;

  /**
   * Get all active presences
   */
  getActivePresences(): UserPresence[];

  /**
   * Subscribe to presence changes
   * @returns Unsubscribe function
   */
  onPresenceChange(callback: (presences: UserPresence[]) => void): () => void;
}

// ================================
// Sync Engine Interface
// ================================

/**
 * Sync engine event listener
 */
export type SyncEngineEventListener = (event: SyncEvent) => void;

/**
 * Sync engine interface
 * Coordinates local and remote state synchronization
 */
export interface ISyncEngine {
  // ================================
  // Lifecycle
  // ================================

  /**
   * Start sync engine
   */
  start(): Promise<void>;

  /**
   * Stop sync engine
   */
  stop(): Promise<void>;

  /**
   * Check if engine is running
   */
  isRunning(): boolean;

  // ================================
  // Operations
  // ================================

  /**
   * Apply a local operation
   */
  applyLocalOperation(operation: DocumentOperation): void;

  /**
   * Force sync now
   */
  syncNow(): Promise<void>;

  // ================================
  // State
  // ================================

  /**
   * Get current sync state
   */
  getState(): SyncState;

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus;

  /**
   * Check if there are pending operations
   */
  hasPendingOperations(): boolean;

  // ================================
  // Events
  // ================================

  /**
   * Subscribe to sync events
   * @returns Unsubscribe function
   */
  addEventListener(listener: SyncEngineEventListener): () => void;

  // ================================
  // Cleanup
  // ================================

  /**
   * Destroy the engine and clean up resources
   */
  destroy(): void;
}

// ================================
// Offline Support
// ================================

/**
 * Offline storage interface
 */
export interface IOfflineStorage {
  /**
   * Store pending operations
   */
  storePendingOperations(documentId: string, operations: DocumentOperation[]): Promise<void>;

  /**
   * Get pending operations
   */
  getPendingOperations(documentId: string): Promise<DocumentOperation[]>;

  /**
   * Clear pending operations
   */
  clearPendingOperations(documentId: string): Promise<void>;

  /**
   * Store document snapshot for offline access
   */
  storeSnapshot(documentId: string, content: string, versionId: number): Promise<void>;

  /**
   * Get stored snapshot
   */
  getSnapshot(documentId: string): Promise<{ content: string; versionId: number } | null>;
}

// ================================
// Factory Functions
// ================================

/**
 * Create initial sync state
 */
export function createInitialSyncState(localVersionId: number = 0): SyncState {
  return {
    status: 'synced',
    pendingCount: 0,
    lastSyncAt: null,
    error: null,
    remoteVersionId: null,
    localVersionId,
  };
}

/**
 * Create a sync request message
 */
export function createSyncRequest(
  documentId: string,
  clientId: string,
  lastKnownVersionId: number
): SyncRequestMessage {
  return {
    type: 'SYNC_REQUEST',
    documentId,
    clientId,
    timestamp: Date.now(),
    lastKnownVersionId,
  };
}

/**
 * Create a push operations message
 */
export function createPushOperations(
  documentId: string,
  clientId: string,
  operations: DocumentOperation[],
  baseVersionId: number
): PushOperationsMessage {
  return {
    type: 'PUSH_OPERATIONS',
    documentId,
    clientId,
    timestamp: Date.now(),
    operations,
    baseVersionId,
  };
}
