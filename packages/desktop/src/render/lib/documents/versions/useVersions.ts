// ================================
// useVersions Hook
// Single responsibility: React state management for version history
// Connects UI to service layer via reducer
// ================================

import { useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import { versionReducer } from './reducer';
import { versionService } from './service';
import { initialVersionState } from './state';
import { versionActions } from './actions';
import { DocumentVersion, ChangeType } from './types';

// ================================
// Constants
// ================================

const ITEMS_PER_PAGE = 20;

// ================================
// Hook Configuration
// ================================

export interface UseVersionsConfig {
  /** Document ID to load versions for */
  documentId: string | null;
  /** Auto-load versions when documentId changes */
  autoLoad?: boolean;
  /** Callback when a version is restored */
  onRestore?: (restoredVersion: DocumentVersion) => void;
  /** Callback when a version is created */
  onVersionCreated?: (version: DocumentVersion) => void;
}

// ================================
// Hook Return Type
// ================================

export interface UseVersionsReturn {
  // Panel state
  isOpen: boolean;
  documentId: string | null;

  // List state
  versions: DocumentVersion[];
  totalCount: number;
  hasMore: boolean;
  listLoading: boolean;
  listError: string | null;

  // Preview state
  previewVersionData: DocumentVersion | null;
  previewLoading: boolean;
  previewError: string | null;

  // Restore state
  restoring: boolean;
  restoreError: string | null;
  lastRestoredVersion: DocumentVersion | null;

  // Compare state
  compareVersionA: DocumentVersion | null;
  compareVersionB: DocumentVersion | null;
  compareLoading: boolean;
  compareError: string | null;

  // Last created version
  lastCreatedVersion: DocumentVersion | null;
  lastVersionCreatedAt: Date | null;

  // Panel actions
  openPanel: (documentId?: string) => void;
  closePanel: () => void;

  // List actions
  loadVersions: (documentId?: string) => Promise<void>;
  loadMoreVersions: () => Promise<void>;
  refreshVersions: () => Promise<void>;

  // Preview actions
  loadPreviewVersion: (versionId: string) => Promise<void>;
  closePreview: () => void;

  // Restore actions
  restoreVersion: (versionId: string) => Promise<DocumentVersion | null>;
  restoreToVersionNumber: (versionNumber: number) => Promise<DocumentVersion | null>;

  // Compare actions
  startCompare: (versionAId: string, versionBId: string) => Promise<void>;
  closeCompare: () => void;

  // Version creation (for external callers)
  createVersion: (
    content: string,
    options?: { title?: string; changeType?: ChangeType; changeDescription?: string }
  ) => Promise<DocumentVersion | null>;
  createAutoSaveVersion: (
    content: string,
    options?: { title?: string }
  ) => Promise<DocumentVersion | null>;
}

// ================================
// Hook Implementation
// ================================

export function useVersions(config: UseVersionsConfig): UseVersionsReturn {
  const { documentId, autoLoad = false, onRestore, onVersionCreated } = config;

  const [state, dispatch] = useReducer(versionReducer, initialVersionState);

  // Track loading state to prevent concurrent loads
  const loadingRef = useRef(false);

  // ================================
  // Panel Actions
  // ================================

  const openPanel = useCallback(
    (docId?: string) => {
      const targetDocId = docId || documentId;
      if (targetDocId) {
        dispatch(versionActions.panelOpen(targetDocId));
      }
    },
    [documentId]
  );

  const closePanel = useCallback(() => {
    dispatch(versionActions.panelClose());
  }, []);

  // ================================
  // List Actions
  // ================================

  const loadVersions = useCallback(
    async (docId?: string) => {
      const targetDocId = docId || state.documentId || documentId;
      if (!targetDocId) {
        console.warn('[useVersions] No document ID to load versions for');
        return;
      }

      if (loadingRef.current) {
        return;
      }

      loadingRef.current = true;
      dispatch(versionActions.listLoadStart());

      try {
        const [versions, totalCount] = await Promise.all([
          versionService.getVersionHistory(targetDocId, { limit: ITEMS_PER_PAGE, offset: 0 }),
          versionService.getVersionCount(targetDocId),
        ]);

        const hasMore = versions.length < totalCount;
        dispatch(versionActions.listLoadSuccess(versions, totalCount, hasMore));
      } catch (error) {
        const message = error instanceof Error ? error.message : '加载版本历史失败';
        dispatch(versionActions.listLoadError(message));
        console.error('[useVersions] Load versions failed:', error);
      } finally {
        loadingRef.current = false;
      }
    },
    [state.documentId, documentId]
  );

  const loadMoreVersions = useCallback(async () => {
    const targetDocId = state.documentId || documentId;
    if (!targetDocId || !state.list.hasMore || loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    dispatch(versionActions.listLoadStart());

    try {
      const versions = await versionService.getVersionHistory(targetDocId, {
        limit: ITEMS_PER_PAGE,
        offset: state.list.offset,
      });

      const hasMore = state.list.offset + versions.length < state.list.totalCount;
      dispatch(versionActions.listLoadMoreSuccess(versions, hasMore));
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载更多版本失败';
      dispatch(versionActions.listLoadError(message));
      console.error('[useVersions] Load more versions failed:', error);
    } finally {
      loadingRef.current = false;
    }
  }, [state.documentId, state.list.hasMore, state.list.offset, state.list.totalCount, documentId]);

  const refreshVersions = useCallback(async () => {
    dispatch(versionActions.listReset());
    await loadVersions();
  }, [loadVersions]);

  // ================================
  // Preview Actions
  // ================================

  const handlePreviewVersion = useCallback(async (versionId: string) => {
    dispatch(versionActions.previewLoadStart(versionId));

    try {
      const version = await versionService.getVersion(versionId);
      if (version) {
        dispatch(versionActions.previewLoadSuccess(version));
      } else {
        dispatch(versionActions.previewLoadError('版本不存在'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载版本详情失败';
      dispatch(versionActions.previewLoadError(message));
      console.error('[useVersions] Preview version failed:', error);
    }
  }, []);

  const closePreview = useCallback(() => {
    dispatch(versionActions.previewClose());
  }, []);

  // ================================
  // Restore Actions
  // ================================

  const handleRestoreVersion = useCallback(
    async (versionId: string): Promise<DocumentVersion | null> => {
      const targetDocId = state.documentId || documentId;
      if (!targetDocId) {
        console.warn('[useVersions] No document ID for restore');
        return null;
      }

      dispatch(versionActions.restoreStart(versionId));

      try {
        const restoredVersion = await versionService.restoreVersion(targetDocId, versionId);
        dispatch(versionActions.restoreSuccess(restoredVersion));

        // Close preview after successful restore
        dispatch(versionActions.previewClose());

        // Notify callback
        if (onRestore) {
          onRestore(restoredVersion);
        }

        return restoredVersion;
      } catch (error) {
        const message = error instanceof Error ? error.message : '恢复版本失败';
        dispatch(versionActions.restoreError(message));
        console.error('[useVersions] Restore version failed:', error);
        return null;
      }
    },
    [state.documentId, documentId, onRestore]
  );

  const restoreToVersionNumber = useCallback(
    async (versionNumber: number): Promise<DocumentVersion | null> => {
      const targetDocId = state.documentId || documentId;
      if (!targetDocId) {
        console.warn('[useVersions] No document ID for restore');
        return null;
      }

      // First get the version by number
      const version = await versionService.getVersionByNumber(targetDocId, versionNumber);
      if (!version) {
        dispatch(versionActions.restoreError('版本不存在'));
        return null;
      }

      return handleRestoreVersion(version.id);
    },
    [state.documentId, documentId, handleRestoreVersion]
  );

  // ================================
  // Compare Actions
  // ================================

  const startCompare = useCallback(async (versionAId: string, versionBId: string) => {
    dispatch(versionActions.compareStart());

    try {
      const [versionA, versionB] = await Promise.all([
        versionService.getVersion(versionAId),
        versionService.getVersion(versionBId),
      ]);

      if (!versionA || !versionB) {
        dispatch(versionActions.compareLoadError('版本不存在'));
        return;
      }

      dispatch(versionActions.compareSetVersions(versionA, versionB));
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载版本对比失败';
      dispatch(versionActions.compareLoadError(message));
      console.error('[useVersions] Compare versions failed:', error);
    }
  }, []);

  const closeCompare = useCallback(() => {
    dispatch(versionActions.compareClose());
  }, []);

  // ================================
  // Version Creation
  // ================================

  const createVersion = useCallback(
    async (
      content: string,
      options: { title?: string; changeType?: ChangeType; changeDescription?: string } = {}
    ): Promise<DocumentVersion | null> => {
      const targetDocId = state.documentId || documentId;
      if (!targetDocId) {
        console.warn('[useVersions] No document ID for version creation');
        return null;
      }

      try {
        const version = await versionService.createVersion({
          itemId: targetDocId,
          content,
          title: options.title,
          changeType: options.changeType || 'edit',
          changeDescription: options.changeDescription,
          authorType: 'user',
        });

        dispatch(versionActions.versionCreated(version));

        if (onVersionCreated) {
          onVersionCreated(version);
        }

        return version;
      } catch (error) {
        const message = error instanceof Error ? error.message : '创建版本失败';
        dispatch(versionActions.versionCreationFailed(message));
        console.error('[useVersions] Create version failed:', error);
        return null;
      }
    },
    [state.documentId, documentId, onVersionCreated]
  );

  const createAutoSaveVersion = useCallback(
    async (content: string, options: { title?: string } = {}): Promise<DocumentVersion | null> => {
      const targetDocId = state.documentId || documentId;
      if (!targetDocId) {
        return null;
      }

      try {
        const version = await versionService.createAutoSaveVersion(targetDocId, content, options);

        if (version) {
          dispatch(versionActions.versionCreated(version));

          if (onVersionCreated) {
            onVersionCreated(version);
          }
        }

        return version;
      } catch (error) {
        console.error('[useVersions] Create auto-save version failed:', error);
        return null;
      }
    },
    [state.documentId, documentId, onVersionCreated]
  );

  // ================================
  // Effects
  // ================================

  // Auto-load versions when documentId changes
  useEffect(() => {
    if (autoLoad && documentId && state.isOpen) {
      loadVersions(documentId);
    }
  }, [autoLoad, documentId, state.isOpen, loadVersions]);

  // Update document ID in state when prop changes
  useEffect(() => {
    if (documentId && state.isOpen && state.documentId !== documentId) {
      dispatch(versionActions.panelSetDocument(documentId));
    }
  }, [documentId, state.isOpen, state.documentId]);

  // ================================
  // Return
  // ================================

  return useMemo(
    () => ({
      // Panel state
      isOpen: state.isOpen,
      documentId: state.documentId,

      // List state
      versions: state.list.versions,
      totalCount: state.list.totalCount,
      hasMore: state.list.hasMore,
      listLoading: state.list.loading,
      listError: state.list.error,

      // Preview state
      previewVersionData: state.preview.version,
      previewLoading: state.preview.loading,
      previewError: state.preview.error,

      // Restore state
      restoring: state.restore.restoring,
      restoreError: state.restore.error,
      lastRestoredVersion: state.restore.lastRestoredVersion,

      // Compare state
      compareVersionA: state.compare.versionA,
      compareVersionB: state.compare.versionB,
      compareLoading: state.compare.loading,
      compareError: state.compare.error,

      // Last created version
      lastCreatedVersion: state.lastCreatedVersion,
      lastVersionCreatedAt: state.lastVersionCreatedAt,

      // Panel actions
      openPanel,
      closePanel,

      // List actions
      loadVersions,
      loadMoreVersions,
      refreshVersions,

      // Preview actions
      loadPreviewVersion: handlePreviewVersion,
      closePreview,

      // Restore actions
      restoreVersion: handleRestoreVersion,
      restoreToVersionNumber,

      // Compare actions
      startCompare,
      closeCompare,

      // Version creation
      createVersion,
      createAutoSaveVersion,
    }),
    [
      state.isOpen,
      state.documentId,
      state.list.versions,
      state.list.totalCount,
      state.list.hasMore,
      state.list.loading,
      state.list.error,
      state.preview.version,
      state.preview.loading,
      state.preview.error,
      state.restore.restoring,
      state.restore.error,
      state.restore.lastRestoredVersion,
      state.compare.versionA,
      state.compare.versionB,
      state.compare.loading,
      state.compare.error,
      state.lastCreatedVersion,
      state.lastVersionCreatedAt,
      openPanel,
      closePanel,
      loadVersions,
      loadMoreVersions,
      refreshVersions,
      handlePreviewVersion,
      closePreview,
      handleRestoreVersion,
      restoreToVersionNumber,
      startCompare,
      closeCompare,
      createVersion,
      createAutoSaveVersion,
    ]
  );
}

export default useVersions;
