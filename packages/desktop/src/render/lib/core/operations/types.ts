// ================================
// Operations Types
// Type definitions for future CRDT/OT-based real-time collaboration
// Only interfaces are defined here - implementations will be added when needed
// ================================

/**
 * Base operation metadata
 * Every operation has these fields for ordering and conflict resolution
 */
export interface OperationMeta {
  /** Unique operation ID */
  readonly id: string;
  /** Timestamp when operation was created */
  readonly timestamp: number;
  /** Client/user ID that created this operation */
  readonly clientId: string;
  /** Logical clock value for ordering (Lamport timestamp) */
  readonly clock: number;
}

// ================================
// Text Operations
// ================================

/**
 * Insert text operation
 */
export interface InsertOperation extends OperationMeta {
  readonly type: 'insert';
  /** Position to insert at (character index) */
  readonly position: number;
  /** Content to insert */
  readonly content: string;
}

/**
 * Delete text operation
 */
export interface DeleteOperation extends OperationMeta {
  readonly type: 'delete';
  /** Position to delete from (character index) */
  readonly position: number;
  /** Number of characters to delete */
  readonly length: number;
}

/**
 * Retain operation (skip characters, used in OT)
 */
export interface RetainOperation extends OperationMeta {
  readonly type: 'retain';
  /** Number of characters to skip */
  readonly count: number;
}

/**
 * Replace operation (atomic delete + insert)
 */
export interface ReplaceOperation extends OperationMeta {
  readonly type: 'replace';
  /** Position to replace at */
  readonly position: number;
  /** Number of characters to replace */
  readonly length: number;
  /** New content */
  readonly content: string;
}

/**
 * All text operation types
 */
export type TextOperation = InsertOperation | DeleteOperation | RetainOperation | ReplaceOperation;

// ================================
// Document Operations
// ================================

/**
 * Set title operation
 */
export interface SetTitleOperation extends OperationMeta {
  readonly type: 'set_title';
  /** New title value */
  readonly title: string;
}

/**
 * Set metadata operation (for document properties)
 */
export interface SetMetadataOperation extends OperationMeta {
  readonly type: 'set_metadata';
  /** Metadata key */
  readonly key: string;
  /** Metadata value */
  readonly value: unknown;
}

/**
 * All document operation types
 */
export type DocumentOperation = TextOperation | SetTitleOperation | SetMetadataOperation;

// ================================
// Operation Log
// ================================

/**
 * Operation log entry with state info
 */
export interface OperationLogEntry<T extends DocumentOperation = DocumentOperation> {
  /** The operation */
  readonly operation: T;
  /** Document version before this operation */
  readonly beforeVersionId: number;
  /** Document version after this operation */
  readonly afterVersionId: number;
  /** Whether this operation has been acknowledged by server */
  readonly acknowledged: boolean;
}

/**
 * Operation log interface
 */
export interface IOperationLog {
  /**
   * Append an operation to the log
   */
  append(operation: DocumentOperation): OperationLogEntry;

  /**
   * Get all operations since a given version
   */
  getSince(versionId: number): OperationLogEntry[];

  /**
   * Get all unacknowledged operations
   */
  getUnacknowledged(): OperationLogEntry[];

  /**
   * Mark operations as acknowledged
   */
  acknowledge(operationIds: string[]): void;

  /**
   * Get the current operation count
   */
  getCount(): number;

  /**
   * Clear the log
   */
  clear(): void;

  /**
   * Compact the log (remove old acknowledged operations)
   */
  compact(keepCount?: number): void;
}

// ================================
// Operational Transform (OT)
// ================================

/**
 * Transform result - the transformed operation
 */
export interface TransformResult<T extends TextOperation = TextOperation> {
  /** Transformed operation */
  readonly operation: T;
  /** Whether the operation is still valid (not fully cancelled) */
  readonly valid: boolean;
}

/**
 * OT transformer interface
 */
export interface IOperationalTransformer {
  /**
   * Transform operation A against operation B
   * Returns A' such that apply(apply(doc, B), A') = apply(apply(doc, A), B')
   */
  transform<T extends TextOperation>(operationA: T, operationB: TextOperation): TransformResult<T>;

  /**
   * Transform a list of operations against another operation
   */
  transformAll<T extends TextOperation>(
    operations: T[],
    against: TextOperation
  ): TransformResult<T>[];

  /**
   * Compose two operations into one
   */
  compose(operationA: TextOperation, operationB: TextOperation): TextOperation | null;
}

// ================================
// CRDT Types
// ================================

/**
 * CRDT character ID (for RGA/Logoot style CRDTs)
 */
export interface CharacterId {
  /** Client that created this character */
  readonly clientId: string;
  /** Logical clock value when created */
  readonly clock: number;
}

/**
 * CRDT character with unique ID
 */
export interface CRDTCharacter {
  /** Unique identifier for this character */
  readonly id: CharacterId;
  /** The character value (or empty if deleted) */
  readonly value: string;
  /** Whether this character is deleted (tombstone) */
  readonly deleted: boolean;
  /** ID of the character this comes after (for ordering) */
  readonly afterId: CharacterId | null;
}

/**
 * CRDT document interface
 */
export interface ICRDTDocument {
  /**
   * Insert content at a position
   */
  insert(position: number, content: string): InsertOperation[];

  /**
   * Delete content at a position
   */
  delete(position: number, length: number): DeleteOperation[];

  /**
   * Merge remote operations into local state
   */
  merge(operations: TextOperation[]): void;

  /**
   * Get the current document content
   */
  getContent(): string;

  /**
   * Get the current document length
   */
  getLength(): number;

  /**
   * Get all operations needed to reconstruct the document
   */
  getOperations(): TextOperation[];
}

// ================================
// Sync State Types
// ================================

/**
 * Sync status for documents
 */
export type SyncStatus =
  | 'synced' // All changes saved/synced
  | 'pending' // Changes waiting to be synced
  | 'syncing' // Currently syncing
  | 'conflict' // Conflict detected
  | 'offline' // No connection
  | 'error'; // Error occurred

/**
 * Sync state for a document
 */
export interface SyncState {
  /** Current sync status */
  readonly status: SyncStatus;
  /** Number of pending operations */
  readonly pendingCount: number;
  /** Last sync timestamp */
  readonly lastSyncAt: number | null;
  /** Error message if status is 'error' */
  readonly error: string | null;
  /** Remote version we know about */
  readonly remoteVersionId: number | null;
  /** Local version */
  readonly localVersionId: number;
}

/**
 * Sync event types
 */
export type SyncEvent =
  | { type: 'LOCAL_CHANGE'; operation: DocumentOperation }
  | { type: 'REMOTE_CHANGE'; operations: DocumentOperation[] }
  | { type: 'SYNC_STARTED' }
  | { type: 'SYNC_COMPLETED'; newVersionId: number }
  | { type: 'SYNC_FAILED'; error: string }
  | { type: 'CONFLICT_DETECTED'; localVersion: number; remoteVersion: number }
  | { type: 'CONFLICT_RESOLVED'; resolution: 'local' | 'remote' | 'merged' }
  | { type: 'STATUS_CHANGED'; status: SyncStatus };

/**
 * Sync event listener
 */
export type SyncEventListener = (event: SyncEvent) => void;

// ================================
// Configuration Types
// ================================

/**
 * Operation log configuration
 */
export interface OperationLogConfig {
  /** Maximum number of operations to keep */
  maxOperations?: number;
  /** Whether to automatically compact when max is reached */
  autoCompact?: boolean;
  /** Debug logging */
  debug?: boolean;
}

/**
 * Operation log statistics
 */
export interface OperationLogStats {
  totalCount: number;
  acknowledgedCount: number;
  pendingCount: number;
  currentVersionId: number;
  operationsByType: Record<string, number>;
}

// ================================
// Initial States
// ================================

/**
 * Initial sync state
 */
export const initialSyncState: SyncState = {
  status: 'synced',
  pendingCount: 0,
  lastSyncAt: null,
  error: null,
  remoteVersionId: null,
  localVersionId: 0,
};
