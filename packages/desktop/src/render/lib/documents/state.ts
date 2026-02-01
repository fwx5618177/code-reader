// ================================
// Document State
// Single responsibility: State types and initial values
// ================================

import { Document, DocumentListItem } from './types';

// ================================
// Auto-Save State (local definition)
// ================================

/**
 * Auto-save state for tracking save status
 */
export interface AutoSaveState {
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Timestamp of last content change */
  lastChangeAt: number | null;
  /** Timestamp of last successful save */
  lastSaveAt: number | null;
  /** Timestamp of last version creation */
  lastVersionAt: number | null;
  /** Whether a save is currently in progress */
  isSaving: boolean;
  /** Number of pending changes since last save */
  pendingChanges: number;
}

/**
 * Initial auto-save state
 */
export const initialAutoSaveState: AutoSaveState = {
  isDirty: false,
  lastChangeAt: null,
  lastSaveAt: null,
  lastVersionAt: null,
  isSaving: false,
  pendingChanges: 0,
};

// ================================
// State Types
// ================================

/**
 * List state - for document list in sidebar
 */
export interface ListState {
  items: DocumentListItem[];
  loading: boolean;
  error: string | null;
}

/**
 * Editor state - for currently active document
 */
export interface EditorState {
  documentId: string | null;
  document: Document | null;
  /** Loading state - true when loading a document from database */
  loading: boolean;
  /** Saving state - true when saving document (separate from loading to prevent UI flicker) */
  saving: boolean;
  error: string | null;
  dirty: boolean;

  // Auto-save integration
  autoSave: AutoSaveState;

  // Save timestamps for UI display
  lastSavedAt: Date | null;

  // Version history support
  lastVersionAt: Date | null;
}

/**
 * Complete document state
 */
export interface DocumentState {
  list: ListState;
  editor: EditorState;
  initialized: boolean;
}

// ================================
// Initial State
// ================================

export const initialListState: ListState = {
  items: [],
  loading: false,
  error: null,
};

export const initialEditorState: EditorState = {
  documentId: null,
  document: null,
  loading: false,
  saving: false,
  error: null,
  dirty: false,

  // Auto-save integration
  autoSave: initialAutoSaveState,

  // Save timestamps
  lastSavedAt: null,
  lastVersionAt: null,
};

export const initialDocumentState: DocumentState = {
  list: initialListState,
  editor: initialEditorState,
  initialized: false,
};
