// ================================
// useFolders Hook
// Single responsibility: React state management for folders
// Connects UI to service layer
// ================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { folderService } from './service';
import { documentService } from '../documents/service';
import { Folder, FolderListItem, FolderTreeNode, CreateFolderInput } from './types';

// ================================
// Hook Return Type
// ================================

export interface UseFoldersReturn {
  // State
  folders: FolderListItem[];
  folderTree: FolderTreeNode[];
  loading: boolean;
  error: string | null;
  isInitialized: boolean;

  // Expanded folders state (for tree UI)
  expandedFolderIds: Set<string>;

  // Actions
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  createFolder: (input: CreateFolderInput) => Promise<Folder | null>;
  renameFolder: (id: string, newName: string) => Promise<boolean>;
  moveFolder: (id: string, newParentId: string | null) => Promise<boolean>;
  deleteFolder: (id: string) => Promise<boolean>;
  toggleFolderExpanded: (id: string) => void;
  setFolderExpanded: (id: string, expanded: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;

  // Document-folder operations
  moveDocumentToFolder: (documentId: string, folderId: string | null) => Promise<boolean>;
}

// ================================
// Hook Implementation
// ================================

export function useFolders(): UseFoldersReturn {
  // State
  const [folders, setFolders] = useState<FolderListItem[]>([]);
  const [folderTree, setFolderTree] = useState<FolderTreeNode[]>([]);
  const [loading, setLoading] = useState(true); // Start with loading true
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());

  // Refs to prevent race conditions and track mount state
  const initializingRef = useRef(false);
  const mountedRef = useRef(true);

  // ================================
  // Initialize - defined before useEffect
  // ================================

  const initialize = useCallback(async (): Promise<void> => {
    if (initializingRef.current || isInitialized) {
      return;
    }

    initializingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const [list, tree] = await Promise.all([
        folderService.getFolderList(),
        folderService.getFolderTree(),
      ]);

      // Only update state if still mounted
      if (mountedRef.current) {
        setFolders(list);
        setFolderTree(tree);
        setIsInitialized(true);

        // By default, expand root folders
        const rootIds = new Set(tree.map((node) => node.id));
        setExpandedFolderIds(rootIds);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to initialize folders';
        setError(message);
        console.error('[useFolders] Initialize failed:', err);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      initializingRef.current = false;
    }
  }, [isInitialized]);

  // ================================
  // Auto-initialize on mount
  // ================================

  useEffect(() => {
    mountedRef.current = true;

    // Auto-initialize
    initialize();

    // Cleanup on unmount
    return () => {
      mountedRef.current = false;
    };
  }, [initialize]);

  // ================================
  // Refresh
  // ================================

  const refresh = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const [list, tree] = await Promise.all([
        folderService.getFolderList(),
        folderService.getFolderTree(),
      ]);

      if (mountedRef.current) {
        setFolders(list);
        setFolderTree(tree);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to refresh folders';
        setError(message);
        console.error('[useFolders] Refresh failed:', err);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // ================================
  // Create Folder
  // ================================

  const createFolder = useCallback(
    async (input: CreateFolderInput): Promise<Folder | null> => {
      try {
        const folder = await folderService.createFolder(input);

        // Auto-expand parent if creating a subfolder
        if (input.parentId && mountedRef.current) {
          setExpandedFolderIds((prev) => {
            const next = new Set(prev);
            next.add(input.parentId!);
            return next;
          });
        }

        // Refresh to get updated tree
        await refresh();

        return folder;
      } catch (err) {
        if (mountedRef.current) {
          const message = err instanceof Error ? err.message : 'Failed to create folder';
          setError(message);
          console.error('[useFolders] Create folder failed:', err);
        }
        return null;
      }
    },
    [refresh]
  );

  // ================================
  // Rename Folder
  // ================================

  const renameFolder = useCallback(
    async (id: string, newName: string): Promise<boolean> => {
      try {
        const success = await folderService.renameFolder(id, newName);

        if (success) {
          await refresh();
        }

        return success;
      } catch (err) {
        if (mountedRef.current) {
          const message = err instanceof Error ? err.message : 'Failed to rename folder';
          setError(message);
          console.error('[useFolders] Rename folder failed:', err);
        }
        return false;
      }
    },
    [refresh]
  );

  // ================================
  // Move Folder
  // ================================

  const moveFolder = useCallback(
    async (id: string, newParentId: string | null): Promise<boolean> => {
      try {
        const success = await folderService.moveFolder(id, newParentId);

        if (success && mountedRef.current) {
          // Expand new parent if moving to a folder
          if (newParentId) {
            setExpandedFolderIds((prev) => {
              const next = new Set(prev);
              next.add(newParentId);
              return next;
            });
          }

          await refresh();
        }

        return success;
      } catch (err) {
        if (mountedRef.current) {
          const message = err instanceof Error ? err.message : 'Failed to move folder';
          setError(message);
          console.error('[useFolders] Move folder failed:', err);
        }
        return false;
      }
    },
    [refresh]
  );

  // ================================
  // Delete Folder
  // ================================

  const deleteFolder = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const success = await folderService.deleteFolder(id);

        if (success && mountedRef.current) {
          // Remove from expanded set
          setExpandedFolderIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });

          await refresh();
        }

        return success;
      } catch (err) {
        if (mountedRef.current) {
          const message = err instanceof Error ? err.message : 'Failed to delete folder';
          setError(message);
          console.error('[useFolders] Delete folder failed:', err);
        }
        return false;
      }
    },
    [refresh]
  );

  // ================================
  // Expand/Collapse Controls
  // ================================

  const toggleFolderExpanded = useCallback((id: string): void => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const setFolderExpanded = useCallback((id: string, expanded: boolean): void => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (expanded) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback((): void => {
    const allIds = new Set(folders.map((f) => f.id));
    setExpandedFolderIds(allIds);
  }, [folders]);

  const collapseAll = useCallback((): void => {
    setExpandedFolderIds(new Set());
  }, []);

  // ================================
  // Document-Folder Operations
  // ================================

  const moveDocumentToFolder = useCallback(
    async (documentId: string, folderId: string | null): Promise<boolean> => {
      try {
        const result = await documentService.saveDocument(documentId, {
          folderId: folderId ?? undefined,
        });

        if (result && mountedRef.current) {
          // Expand target folder if moving to a folder
          if (folderId) {
            setExpandedFolderIds((prev) => {
              const next = new Set(prev);
              next.add(folderId);
              return next;
            });
          }
        }

        return result !== null;
      } catch (err) {
        if (mountedRef.current) {
          const message = err instanceof Error ? err.message : 'Failed to move document';
          setError(message);
          console.error('[useFolders] Move document to folder failed:', err);
        }
        return false;
      }
    },
    []
  );

  // ================================
  // Return
  // ================================

  return {
    // State
    folders,
    folderTree,
    loading,
    error,
    isInitialized,
    expandedFolderIds,

    // Actions
    initialize,
    refresh,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    toggleFolderExpanded,
    setFolderExpanded,
    expandAll,
    collapseAll,

    // Document-folder operations
    moveDocumentToFolder,
  };
}

export default useFolders;
