// ================================
// Version State
// Single responsibility: State types and initial values for version history
// ================================

import { DocumentVersion } from './types';

// ================================
// State Types
// ================================

/**
 * State for version list (history panel)
 */
export interface VersionListState {
  /** List of versions for the current document */
  versions: DocumentVersion[];
  /** Total count of versions */
  totalCount: number;
  /** Whether more versions are available to load */
  hasMore: boolean;
  /** Whether versions are loading */
  loading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Current offset for pagination */
  offset: number;
}

/**
 * State for version preview/detail view
 */
export interface VersionPreviewState {
  /** The version being previewed */
  version: DocumentVersion | null;
  /** Whether the preview is loading */
  loading: boolean;
  /** Error message if loading failed */
  error: string | null;
}

/**
 * State for version restore operation
 */
export interface VersionRestoreState {
  /** Whether a restore operation is in progress */
  restoring: boolean;
  /** The version being restored */
  versionId: string | null;
  /** Error message if restore failed */
  error: string | null;
  /** Last successfully restored version */
  lastRestoredVersion: DocumentVersion | null;
}

/**
 * State for version comparison
 */
export interface VersionCompareState {
  /** First version (older) */
  versionA: DocumentVersion | null;
  /** Second version (newer) */
  versionB: DocumentVersion | null;
  /** Whether comparison is loading */
  loading: boolean;
  /** Error message if comparison failed */
  error: string | null;
}

/**
 * Complete version state
 */
export interface VersionState {
  /** Current document ID for which versions are loaded */
  documentId: string | null;
  /** Whether the version history panel is open */
  isOpen: boolean;
  /** Version list state */
  list: VersionListState;
  /** Version preview state */
  preview: VersionPreviewState;
  /** Version restore state */
  restore: VersionRestoreState;
  /** Version comparison state */
  compare: VersionCompareState;
  /** Last created version (for auto-save tracking) */
  lastCreatedVersion: DocumentVersion | null;
  /** Timestamp of last version creation */
  lastVersionCreatedAt: Date | null;
}

// ================================
// Initial State
// ================================

export const initialVersionListState: VersionListState = {
  versions: [],
  totalCount: 0,
  hasMore: false,
  loading: false,
  error: null,
  offset: 0,
};

export const initialVersionPreviewState: VersionPreviewState = {
  version: null,
  loading: false,
  error: null,
};

export const initialVersionRestoreState: VersionRestoreState = {
  restoring: false,
  versionId: null,
  error: null,
  lastRestoredVersion: null,
};

export const initialVersionCompareState: VersionCompareState = {
  versionA: null,
  versionB: null,
  loading: false,
  error: null,
};

export const initialVersionState: VersionState = {
  documentId: null,
  isOpen: false,
  list: initialVersionListState,
  preview: initialVersionPreviewState,
  restore: initialVersionRestoreState,
  compare: initialVersionCompareState,
  lastCreatedVersion: null,
  lastVersionCreatedAt: null,
};

// ================================
// State Helpers
// ================================

/**
 * Create a fresh version list state for a new document
 */
export function createVersionListState(
  documentId: string
): Pick<VersionState, 'documentId' | 'list'> {
  return {
    documentId,
    list: { ...initialVersionListState },
  };
}

/**
 * Check if versions need to be reloaded (different document or stale)
 */
export function shouldReloadVersions(
  state: VersionState,
  documentId: string,
  staleAfterMs: number = 60000
): boolean {
  // Different document
  if (state.documentId !== documentId) {
    return true;
  }

  // No versions loaded yet
  if (state.list.versions.length === 0 && !state.list.loading) {
    return true;
  }

  // Check if stale (last version creation was too long ago)
  if (state.lastVersionCreatedAt) {
    const timeSinceLastVersion = Date.now() - state.lastVersionCreatedAt.getTime();
    if (timeSinceLastVersion > staleAfterMs) {
      return true;
    }
  }

  return false;
}
