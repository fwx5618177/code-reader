// ================================
// Document Actions
// Single responsibility: Action type definitions only
// ================================

import { Document, DocumentListItem } from './types';
import { AutoSaveState } from './state';

// ================================
// Action Types
// ================================

/**
 * List actions - for document list operations
 */
export type ListAction =
  | { type: 'LIST_LOAD_START' }
  | { type: 'LIST_LOAD_SUCCESS'; payload: DocumentListItem[] }
  | { type: 'LIST_LOAD_ERROR'; payload: string }
  | { type: 'LIST_ADD_ITEM'; payload: DocumentListItem }
  | { type: 'LIST_UPDATE_ITEM'; payload: DocumentListItem }
  | { type: 'LIST_REMOVE_ITEM'; payload: string };

/**
 * Save success metadata - only metadata, not content
 * Used for non-blocking auto-save that doesn't interrupt editing
 */
export interface SaveSuccessMetadata {
  documentId: string;
  updatedAt: Date;
}

/**
 * Editor actions - for currently active document
 */
export type EditorAction =
  | { type: 'EDITOR_LOAD_START'; payload: string } // documentId
  | { type: 'EDITOR_LOAD_SUCCESS'; payload: Document }
  | { type: 'EDITOR_LOAD_ERROR'; payload: string }
  | { type: 'EDITOR_UPDATE_LOCAL'; payload: { title?: string; content?: string } }
  | { type: 'EDITOR_SAVE_START' }
  | { type: 'EDITOR_SAVE_SUCCESS'; payload: Document }
  // Silent save success - only updates metadata, does NOT overwrite editor content
  // This is critical for non-blocking auto-save to prevent content loss
  | { type: 'EDITOR_SAVE_SUCCESS_SILENT'; payload: SaveSuccessMetadata }
  | { type: 'EDITOR_SAVE_ERROR'; payload: string }
  | { type: 'EDITOR_CLEAR' }
  | { type: 'EDITOR_SET_DIRTY'; payload: boolean }
  // Auto-save related actions
  | { type: 'EDITOR_AUTO_SAVE_STATE_CHANGED'; payload: AutoSaveState }
  | { type: 'EDITOR_VERSION_CREATED'; payload: { versionId: string; createdAt: Date } };

/**
 * Global actions - for initialization and reset
 */
export type GlobalAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; payload: { list: DocumentListItem[]; document?: Document } }
  | { type: 'INIT_ERROR'; payload: string }
  | { type: 'RESET' };

/**
 * All document actions combined
 */
export type DocumentAction = ListAction | EditorAction | GlobalAction;

// ================================
// Action Creators
// ================================

export const actions = {
  // List actions
  listLoadStart: (): ListAction => ({ type: 'LIST_LOAD_START' }),
  listLoadSuccess: (items: DocumentListItem[]): ListAction => ({
    type: 'LIST_LOAD_SUCCESS',
    payload: items,
  }),
  listLoadError: (error: string): ListAction => ({ type: 'LIST_LOAD_ERROR', payload: error }),
  listAddItem: (item: DocumentListItem): ListAction => ({ type: 'LIST_ADD_ITEM', payload: item }),
  listUpdateItem: (item: DocumentListItem): ListAction => ({
    type: 'LIST_UPDATE_ITEM',
    payload: item,
  }),
  listRemoveItem: (id: string): ListAction => ({ type: 'LIST_REMOVE_ITEM', payload: id }),

  // Editor actions
  editorLoadStart: (documentId: string): EditorAction => ({
    type: 'EDITOR_LOAD_START',
    payload: documentId,
  }),
  editorLoadSuccess: (document: Document): EditorAction => ({
    type: 'EDITOR_LOAD_SUCCESS',
    payload: document,
  }),
  editorLoadError: (error: string): EditorAction => ({ type: 'EDITOR_LOAD_ERROR', payload: error }),
  editorUpdateLocal: (updates: { title?: string; content?: string }): EditorAction => ({
    type: 'EDITOR_UPDATE_LOCAL',
    payload: updates,
  }),
  editorSaveStart: (): EditorAction => ({ type: 'EDITOR_SAVE_START' }),
  editorSaveSuccess: (document: Document): EditorAction => ({
    type: 'EDITOR_SAVE_SUCCESS',
    payload: document,
  }),
  /**
   * Silent save success - only updates metadata without overwriting editor content
   * Use this for auto-save to prevent interrupting user's editing
   */
  editorSaveSuccessSilent: (metadata: SaveSuccessMetadata): EditorAction => ({
    type: 'EDITOR_SAVE_SUCCESS_SILENT',
    payload: metadata,
  }),
  editorSaveError: (error: string): EditorAction => ({ type: 'EDITOR_SAVE_ERROR', payload: error }),
  editorClear: (): EditorAction => ({ type: 'EDITOR_CLEAR' }),
  editorSetDirty: (dirty: boolean): EditorAction => ({ type: 'EDITOR_SET_DIRTY', payload: dirty }),
  // Auto-save actions
  editorAutoSaveStateChanged: (state: AutoSaveState): EditorAction => ({
    type: 'EDITOR_AUTO_SAVE_STATE_CHANGED',
    payload: state,
  }),
  editorVersionCreated: (versionId: string, createdAt: Date): EditorAction => ({
    type: 'EDITOR_VERSION_CREATED',
    payload: { versionId, createdAt },
  }),

  // Global actions
  initStart: (): GlobalAction => ({ type: 'INIT_START' }),
  initSuccess: (list: DocumentListItem[], document?: Document): GlobalAction => ({
    type: 'INIT_SUCCESS',
    payload: { list, document },
  }),
  initError: (error: string): GlobalAction => ({ type: 'INIT_ERROR', payload: error }),
  reset: (): GlobalAction => ({ type: 'RESET' }),
};
