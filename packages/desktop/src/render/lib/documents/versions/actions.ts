// ================================
// Version Actions
// Single responsibility: Action type definitions for version history
// ================================

import { DocumentVersion } from './types';

// ================================
// List Actions
// ================================

export type VersionListAction =
  | { type: 'VERSION_LIST_LOAD_START' }
  | {
      type: 'VERSION_LIST_LOAD_SUCCESS';
      payload: { versions: DocumentVersion[]; totalCount: number; hasMore: boolean };
    }
  | {
      type: 'VERSION_LIST_LOAD_MORE_SUCCESS';
      payload: { versions: DocumentVersion[]; hasMore: boolean };
    }
  | { type: 'VERSION_LIST_LOAD_ERROR'; payload: string }
  | { type: 'VERSION_LIST_RESET' }
  | { type: 'VERSION_LIST_ADD_VERSION'; payload: DocumentVersion };

// ================================
// Preview Actions
// ================================

export type VersionPreviewAction =
  | { type: 'VERSION_PREVIEW_LOAD_START'; payload: string } // versionId
  | { type: 'VERSION_PREVIEW_LOAD_SUCCESS'; payload: DocumentVersion }
  | { type: 'VERSION_PREVIEW_LOAD_ERROR'; payload: string }
  | { type: 'VERSION_PREVIEW_CLOSE' };

// ================================
// Restore Actions
// ================================

export type VersionRestoreAction =
  | { type: 'VERSION_RESTORE_START'; payload: string } // versionId
  | { type: 'VERSION_RESTORE_SUCCESS'; payload: DocumentVersion }
  | { type: 'VERSION_RESTORE_ERROR'; payload: string }
  | { type: 'VERSION_RESTORE_RESET' };

// ================================
// Compare Actions
// ================================

export type VersionCompareAction =
  | { type: 'VERSION_COMPARE_START' }
  | {
      type: 'VERSION_COMPARE_SET_VERSIONS';
      payload: { versionA: DocumentVersion; versionB: DocumentVersion };
    }
  | { type: 'VERSION_COMPARE_LOAD_ERROR'; payload: string }
  | { type: 'VERSION_COMPARE_CLOSE' };

// ================================
// Panel Actions
// ================================

export type VersionPanelAction =
  | { type: 'VERSION_PANEL_OPEN'; payload: string } // documentId
  | { type: 'VERSION_PANEL_CLOSE' }
  | { type: 'VERSION_PANEL_SET_DOCUMENT'; payload: string };

// ================================
// Version Creation Actions
// ================================

export type VersionCreationAction =
  | { type: 'VERSION_CREATED'; payload: DocumentVersion }
  | { type: 'VERSION_CREATION_FAILED'; payload: string };

// ================================
// Combined Action Type
// ================================

export type VersionAction =
  | VersionListAction
  | VersionPreviewAction
  | VersionRestoreAction
  | VersionCompareAction
  | VersionPanelAction
  | VersionCreationAction;

// ================================
// Action Creators
// ================================

export const versionActions = {
  // List actions
  listLoadStart: (): VersionListAction => ({ type: 'VERSION_LIST_LOAD_START' }),
  listLoadSuccess: (
    versions: DocumentVersion[],
    totalCount: number,
    hasMore: boolean
  ): VersionListAction => ({
    type: 'VERSION_LIST_LOAD_SUCCESS',
    payload: { versions, totalCount, hasMore },
  }),
  listLoadMoreSuccess: (versions: DocumentVersion[], hasMore: boolean): VersionListAction => ({
    type: 'VERSION_LIST_LOAD_MORE_SUCCESS',
    payload: { versions, hasMore },
  }),
  listLoadError: (error: string): VersionListAction => ({
    type: 'VERSION_LIST_LOAD_ERROR',
    payload: error,
  }),
  listReset: (): VersionListAction => ({ type: 'VERSION_LIST_RESET' }),
  listAddVersion: (version: DocumentVersion): VersionListAction => ({
    type: 'VERSION_LIST_ADD_VERSION',
    payload: version,
  }),

  // Preview actions
  previewLoadStart: (versionId: string): VersionPreviewAction => ({
    type: 'VERSION_PREVIEW_LOAD_START',
    payload: versionId,
  }),
  previewLoadSuccess: (version: DocumentVersion): VersionPreviewAction => ({
    type: 'VERSION_PREVIEW_LOAD_SUCCESS',
    payload: version,
  }),
  previewLoadError: (error: string): VersionPreviewAction => ({
    type: 'VERSION_PREVIEW_LOAD_ERROR',
    payload: error,
  }),
  previewClose: (): VersionPreviewAction => ({ type: 'VERSION_PREVIEW_CLOSE' }),

  // Restore actions
  restoreStart: (versionId: string): VersionRestoreAction => ({
    type: 'VERSION_RESTORE_START',
    payload: versionId,
  }),
  restoreSuccess: (restoredVersion: DocumentVersion): VersionRestoreAction => ({
    type: 'VERSION_RESTORE_SUCCESS',
    payload: restoredVersion,
  }),
  restoreError: (error: string): VersionRestoreAction => ({
    type: 'VERSION_RESTORE_ERROR',
    payload: error,
  }),
  restoreReset: (): VersionRestoreAction => ({ type: 'VERSION_RESTORE_RESET' }),

  // Compare actions
  compareStart: (): VersionCompareAction => ({ type: 'VERSION_COMPARE_START' }),
  compareSetVersions: (
    versionA: DocumentVersion,
    versionB: DocumentVersion
  ): VersionCompareAction => ({
    type: 'VERSION_COMPARE_SET_VERSIONS',
    payload: { versionA, versionB },
  }),
  compareLoadError: (error: string): VersionCompareAction => ({
    type: 'VERSION_COMPARE_LOAD_ERROR',
    payload: error,
  }),
  compareClose: (): VersionCompareAction => ({ type: 'VERSION_COMPARE_CLOSE' }),

  // Panel actions
  panelOpen: (documentId: string): VersionPanelAction => ({
    type: 'VERSION_PANEL_OPEN',
    payload: documentId,
  }),
  panelClose: (): VersionPanelAction => ({ type: 'VERSION_PANEL_CLOSE' }),
  panelSetDocument: (documentId: string): VersionPanelAction => ({
    type: 'VERSION_PANEL_SET_DOCUMENT',
    payload: documentId,
  }),

  // Version creation actions
  versionCreated: (version: DocumentVersion): VersionCreationAction => ({
    type: 'VERSION_CREATED',
    payload: version,
  }),
  versionCreationFailed: (error: string): VersionCreationAction => ({
    type: 'VERSION_CREATION_FAILED',
    payload: error,
  }),
};
