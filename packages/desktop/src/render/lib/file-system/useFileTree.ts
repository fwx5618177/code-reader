// ================================
// useFileTree Hook
// React hook for managing file tree state and operations
// Provides a clean interface to the FileTreeModel
// ================================

import { useReducer, useCallback, useMemo, useEffect, useRef } from 'react';
import { Uri } from './uri';
import { FileType, IFileSystemProvider } from './types';
import {
  FileTreeState,
  FileTreeNode,
  FlatFileTreeNode,
  FileTreeSortConfig,
  DEFAULT_SORT_CONFIG,
  fileTreeReducer,
  initialFileTreeState,
  flattenFileTree,
  getVisibleNodes,
  getAncestorIds,
  findNodeByUri,
} from './file-tree-model';

// ================================
// Types
// ================================

export interface UseFileTreeConfig {
  /** File system provider to use */
  provider: IFileSystemProvider;
  /** Root URI to load */
  rootUri?: Uri;
  /** Whether to auto-load on mount */
  autoLoad?: boolean;
  /** Initial expanded node IDs */
  initialExpandedIds?: string[];
  /** Initial selected node ID */
  initialSelectedId?: string | null;
  /** Sort configuration */
  sortConfig?: Partial<FileTreeSortConfig>;
  /** Callback when a file is selected */
  onSelectFile?: (uri: Uri, node: FileTreeNode) => void;
  /** Callback when a folder is selected */
  onSelectFolder?: (uri: Uri, node: FileTreeNode) => void;
  /** Callback when selection is cleared */
  onClearSelection?: () => void;
  /** Callback when files change */
  onFilesChange?: (state: FileTreeState) => void;
}

export interface UseFileTreeReturn {
  // State
  state: FileTreeState;
  isLoading: boolean;
  error: string | null;

  // Computed values
  flatNodes: FlatFileTreeNode[];
  visibleNodes: FlatFileTreeNode[];
  selectedNodes: FileTreeNode[];
  selectedNode: FileTreeNode | null;
  focusedNode: FileTreeNode | null;

  // Node lookup
  getNode: (id: string) => FileTreeNode | null;
  getNodeByUri: (uri: Uri) => FileTreeNode | null;
  getAncestors: (id: string) => string[];

  // Loading
  loadRoot: (uri: Uri) => Promise<void>;
  loadChildren: (nodeId: string) => Promise<void>;
  refresh: () => Promise<void>;

  // Selection
  select: (id: string, options?: { multi?: boolean }) => void;
  deselect: (id: string) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;

  // Expansion
  expand: (id: string) => Promise<void>;
  collapse: (id: string) => void;
  toggle: (id: string) => Promise<void>;
  expandTo: (id: string) => Promise<void>;
  expandAll: () => void;
  collapseAll: () => void;
  isExpanded: (id: string) => boolean;

  // Focus
  setFocus: (id: string | null) => void;
  isFocused: (id: string) => boolean;

  // Editing (rename)
  startEditing: (id: string) => void;
  stopEditing: () => void;
  finishEditing: (newName: string) => Promise<void>;
  isEditing: (id: string) => boolean;

  // Drag & Drop
  startDrag: (id: string) => void;
  setDropTarget: (id: string | null) => void;
  endDrag: () => Promise<void>;
  isDragging: (id: string) => boolean;
  isDropTarget: (id: string) => boolean;
  canDrop: (sourceId: string, targetId: string) => boolean;

  // File operations
  createFile: (parentUri: Uri, name: string, content?: string) => Promise<Uri>;
  createFolder: (parentUri: Uri, name: string) => Promise<Uri>;
  rename: (uri: Uri, newName: string) => Promise<Uri>;
  move: (sourceUri: Uri, targetDirUri: Uri) => Promise<Uri>;
  deleteNode: (uri: Uri, recursive?: boolean) => Promise<void>;

  // Sort
  setSortConfig: (config: Partial<FileTreeSortConfig>) => void;
  sortConfig: FileTreeSortConfig;
}

// ================================
// Hook Implementation
// ================================

export function useFileTree(config: UseFileTreeConfig): UseFileTreeReturn {
  const {
    provider,
    rootUri,
    autoLoad = true,
    initialExpandedIds = [],
    initialSelectedId = null,
    sortConfig: initialSortConfig,
    onSelectFile,
    onSelectFolder,
    onClearSelection,
    onFilesChange,
  } = config;

  // Sort config state
  const sortConfigRef = useRef<FileTreeSortConfig>({
    ...DEFAULT_SORT_CONFIG,
    ...initialSortConfig,
  });

  // Create initial state with pre-expanded nodes
  const createInitialState = (): FileTreeState => {
    const state = { ...initialFileTreeState };
    if (initialExpandedIds.length > 0) {
      state.expandedIds = new Set(initialExpandedIds);
    }
    if (initialSelectedId) {
      state.selectedIds = new Set([initialSelectedId]);
      state.focusedId = initialSelectedId;
    }
    return state;
  };

  const [state, dispatch] = useReducer(fileTreeReducer, null, createInitialState);

  // Track previous selection for change detection
  const prevSelectionRef = useRef<Set<string>>(new Set());

  // File change listener
  useEffect(() => {
    const { dispose } = provider.onDidChangeFile((changes) => {
      // Handle file changes by refreshing affected nodes
      for (const change of changes) {
        const node = findNodeByUri(state, change.uri);
        if (node) {
          // Reload parent to reflect changes
          const parentUri = change.uri.parent;
          const parentNode = findNodeByUri(state, parentUri);
          if (parentNode) {
            loadChildren(parentNode.id);
          }
        }
      }
    });

    return dispose;
  }, [provider, state]);

  // Notify on state changes
  useEffect(() => {
    if (onFilesChange) {
      onFilesChange(state);
    }
  }, [state, onFilesChange]);

  // Selection change detection
  useEffect(() => {
    const prev = prevSelectionRef.current;
    const curr = state.selectedIds;

    // Check if selection changed
    if (prev.size !== curr.size || !Array.from(prev).every((id) => curr.has(id))) {
      prevSelectionRef.current = new Set(curr);

      if (curr.size === 0 && onClearSelection) {
        onClearSelection();
      } else if (curr.size === 1) {
        const selectedId = Array.from(curr)[0];
        const node = state.nodes.get(selectedId);
        if (node) {
          if (node.type === FileType.File && onSelectFile) {
            onSelectFile(node.uri, node);
          } else if (node.type === FileType.Directory && onSelectFolder) {
            onSelectFolder(node.uri, node);
          }
        }
      }
    }
  }, [state.selectedIds, state.nodes, onSelectFile, onSelectFolder, onClearSelection]);

  // ================================
  // Loading Operations
  // ================================

  const loadRoot = useCallback(
    async (uri: Uri): Promise<void> => {
      dispatch({ type: 'SET_LOADING', isLoading: true });

      try {
        const stat = await provider.stat(uri);

        // If root is a directory, make its children the top-level nodes
        // This hides the virtual root directory from the tree
        if (stat.type === FileType.Directory) {
          const children = await provider.readDirectory(uri);
          const nodes = new Map<string, FileTreeNode>();
          const rootIds: string[] = [];

          for (const [name, _type] of children) {
            const childUri = uri.joinPath(name);
            try {
              const childStat = await provider.stat(childUri);
              // Create child nodes at depth 0 with no parent (they are the new roots)
              const childNode = createNode(childUri, childStat, null, 0);
              rootIds.push(childNode.id);
              nodes.set(childNode.id, childNode);
            } catch {
              // Skip files that can't be stat'd
            }
          }

          dispatch({ type: 'SET_ROOTS', rootIds, nodes });
        } else {
          // If root is a file, just add it as the only node
          const rootNode = createNode(uri, stat, null, 0);
          const nodes = new Map<string, FileTreeNode>();
          nodes.set(rootNode.id, rootNode);
          dispatch({ type: 'SET_ROOTS', rootIds: [rootNode.id], nodes });
        }
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          error: error instanceof Error ? error.message : 'Failed to load',
        });
      }
    },
    [provider]
  );

  const loadChildren = useCallback(
    async (nodeId: string): Promise<void> => {
      const node = state.nodes.get(nodeId);
      if (!node || node.type !== FileType.Directory) return;

      dispatch({
        type: 'UPDATE_NODE',
        id: nodeId,
        updates: { isLoading: true },
      });

      try {
        const children = await provider.readDirectory(node.uri);
        const childNodes: FileTreeNode[] = [];
        const childIds: string[] = [];

        for (const [name, _type] of children) {
          const childUri = node.uri.joinPath(name);
          try {
            const childStat = await provider.stat(childUri);
            const childNode = createNode(childUri, childStat, nodeId, node.depth + 1);
            childNodes.push(childNode);
            childIds.push(childNode.id);
          } catch {
            // Skip files that can't be stat'd
          }
        }

        dispatch({
          type: 'SET_CHILDREN',
          parentId: nodeId,
          childIds,
          childNodes,
        });
      } catch (error) {
        dispatch({
          type: 'UPDATE_NODE',
          id: nodeId,
          updates: {
            isLoading: false,
            hasError: true,
            errorMessage: error instanceof Error ? error.message : 'Failed to load',
          },
        });
      }
    },
    [provider, state.nodes]
  );

  // Store the original rootUri for refresh
  const rootUriRef = useRef<Uri | undefined>(rootUri);
  useEffect(() => {
    if (rootUri) {
      rootUriRef.current = rootUri;
    }
  }, [rootUri]);

  const refresh = useCallback(async (): Promise<void> => {
    // Use the original rootUri since we no longer store the virtual root node
    if (rootUriRef.current) {
      await loadRoot(rootUriRef.current);
    }
  }, [loadRoot]);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad && rootUri && state.rootIds.length === 0) {
      loadRoot(rootUri);
    }
  }, [autoLoad, rootUri, state.rootIds.length, loadRoot]);

  // ================================
  // Selection Operations
  // ================================

  const select = useCallback((id: string, options?: { multi?: boolean }) => {
    dispatch({ type: 'SELECT', id, multi: options?.multi });
  }, []);

  const deselect = useCallback((id: string) => {
    dispatch({ type: 'DESELECT', id });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  const isSelected = useCallback(
    (id: string): boolean => {
      return state.selectedIds.has(id);
    },
    [state.selectedIds]
  );

  // ================================
  // Expansion Operations
  // ================================

  const expand = useCallback(
    async (id: string): Promise<void> => {
      const node = state.nodes.get(id);
      if (!node || node.type !== FileType.Directory) return;

      // Load children if not loaded
      if (node.childIds.length === 0 && !node.isLoading) {
        await loadChildren(id);
      }

      dispatch({ type: 'EXPAND', id });
    },
    [state.nodes, loadChildren]
  );

  const collapse = useCallback((id: string) => {
    dispatch({ type: 'COLLAPSE', id });
  }, []);

  const toggle = useCallback(
    async (id: string): Promise<void> => {
      if (state.expandedIds.has(id)) {
        collapse(id);
      } else {
        await expand(id);
      }
    },
    [state.expandedIds, expand, collapse]
  );

  const expandTo = useCallback(
    async (id: string): Promise<void> => {
      const ancestors = getAncestorIds(state.nodes, id);
      for (const ancestorId of ancestors) {
        await expand(ancestorId);
      }
    },
    [state.nodes, expand]
  );

  const expandAll = useCallback(() => {
    dispatch({ type: 'EXPAND_ALL' });
  }, []);

  const collapseAll = useCallback(() => {
    dispatch({ type: 'COLLAPSE_ALL' });
  }, []);

  const isExpanded = useCallback(
    (id: string): boolean => {
      return state.expandedIds.has(id);
    },
    [state.expandedIds]
  );

  // ================================
  // Focus Operations
  // ================================

  const setFocus = useCallback((id: string | null) => {
    dispatch({ type: 'SET_FOCUS', id });
  }, []);

  const isFocused = useCallback(
    (id: string): boolean => {
      return state.focusedId === id;
    },
    [state.focusedId]
  );

  // ================================
  // Editing Operations
  // ================================

  const startEditing = useCallback((id: string) => {
    dispatch({ type: 'START_EDITING', id });
  }, []);

  const stopEditing = useCallback(() => {
    dispatch({ type: 'STOP_EDITING' });
  }, []);

  const finishEditing = useCallback(
    async (newName: string): Promise<void> => {
      const { editingId } = state;
      if (!editingId) return;

      const node = state.nodes.get(editingId);
      if (!node) {
        stopEditing();
        return;
      }

      if (newName && newName !== node.name) {
        try {
          const newUri = node.uri.parent.joinPath(newName);
          await provider.rename(node.uri, newUri, { overwrite: false });

          // Reload parent to reflect the rename
          if (node.parentId) {
            await loadChildren(node.parentId);
          } else {
            await refresh();
          }
        } catch (error) {
          console.error('Failed to rename:', error);
        }
      }

      stopEditing();
    },
    [state, provider, stopEditing, loadChildren, refresh]
  );

  const isEditingFn = useCallback(
    (id: string): boolean => {
      return state.editingId === id;
    },
    [state.editingId]
  );

  // ================================
  // Drag & Drop Operations
  // ================================

  const startDrag = useCallback((id: string) => {
    dispatch({ type: 'START_DRAG', id });
  }, []);

  const setDropTarget = useCallback((id: string | null) => {
    dispatch({ type: 'SET_DROP_TARGET', id });
  }, []);

  const endDrag = useCallback(async (): Promise<void> => {
    const { draggingId, dropTargetId } = state;

    if (draggingId && dropTargetId && draggingId !== dropTargetId) {
      const source = state.nodes.get(draggingId);
      const target = state.nodes.get(dropTargetId);

      if (source && target && target.type === FileType.Directory) {
        try {
          const newUri = target.uri.joinPath(source.name);
          await provider.rename(source.uri, newUri, { overwrite: false });

          // Reload both old and new parent
          if (source.parentId) {
            await loadChildren(source.parentId);
          }
          await loadChildren(dropTargetId);
        } catch (error) {
          console.error('Failed to move:', error);
        }
      }
    }

    dispatch({ type: 'END_DRAG' });
  }, [state, provider, loadChildren]);

  const isDragging = useCallback(
    (id: string): boolean => {
      return state.draggingId === id;
    },
    [state.draggingId]
  );

  const isDropTargetFn = useCallback(
    (id: string): boolean => {
      return state.dropTargetId === id;
    },
    [state.dropTargetId]
  );

  const canDrop = useCallback(
    (sourceId: string, targetId: string): boolean => {
      if (sourceId === targetId) return false;

      const source = state.nodes.get(sourceId);
      const target = state.nodes.get(targetId);

      if (!source || !target) return false;
      if (target.type !== FileType.Directory) return false;

      // Can't drop into descendant
      const ancestors = getAncestorIds(state.nodes, targetId);
      if (ancestors.includes(sourceId)) return false;

      return true;
    },
    [state.nodes]
  );

  // ================================
  // File Operations
  // ================================

  const createFile = useCallback(
    async (parentUri: Uri, name: string, content = ''): Promise<Uri> => {
      const fileUri = parentUri.joinPath(name);
      const encoder = new TextEncoder();

      await provider.writeFile(fileUri, encoder.encode(content), {
        create: true,
        overwrite: false,
      });

      // Reload parent
      const parentNode = findNodeByUri(state, parentUri);
      if (parentNode) {
        await loadChildren(parentNode.id);
      }

      return fileUri;
    },
    [provider, state, loadChildren]
  );

  const createFolder = useCallback(
    async (parentUri: Uri, name: string): Promise<Uri> => {
      const dirUri = parentUri.joinPath(name);
      await provider.createDirectory(dirUri);

      // Reload parent
      const parentNode = findNodeByUri(state, parentUri);
      if (parentNode) {
        await loadChildren(parentNode.id);
      }

      return dirUri;
    },
    [provider, state, loadChildren]
  );

  const renameNode = useCallback(
    async (uri: Uri, newName: string): Promise<Uri> => {
      const newUri = uri.parent.joinPath(newName);
      await provider.rename(uri, newUri, { overwrite: false });

      // Reload parent
      const node = findNodeByUri(state, uri);
      if (node?.parentId) {
        await loadChildren(node.parentId);
      } else {
        await refresh();
      }

      return newUri;
    },
    [provider, state, loadChildren, refresh]
  );

  const moveNode = useCallback(
    async (sourceUri: Uri, targetDirUri: Uri): Promise<Uri> => {
      const newUri = targetDirUri.joinPath(sourceUri.name);
      await provider.rename(sourceUri, newUri, { overwrite: false });

      // Reload old parent
      const sourceNode = findNodeByUri(state, sourceUri);
      if (sourceNode?.parentId) {
        await loadChildren(sourceNode.parentId);
      }

      // Reload new parent
      const targetNode = findNodeByUri(state, targetDirUri);
      if (targetNode) {
        await loadChildren(targetNode.id);
      }

      return newUri;
    },
    [provider, state, loadChildren]
  );

  const deleteNode = useCallback(
    async (uri: Uri, recursive = true): Promise<void> => {
      await provider.delete(uri, { recursive, useTrash: true });

      // Reload parent
      const node = findNodeByUri(state, uri);
      if (node?.parentId) {
        await loadChildren(node.parentId);
      } else {
        await refresh();
      }
    },
    [provider, state, loadChildren, refresh]
  );

  // ================================
  // Sort Operations
  // ================================

  const setSortConfig = useCallback(
    (config: Partial<FileTreeSortConfig>) => {
      sortConfigRef.current = { ...sortConfigRef.current, ...config };
      // Force re-render by dispatching a no-op action
      dispatch({ type: 'SET_LOADING', isLoading: state.isLoading });
    },
    [state.isLoading]
  );

  // ================================
  // Computed Values
  // ================================

  const flatNodes = useMemo(() => {
    return flattenFileTree(state, sortConfigRef.current);
  }, [state]);

  const visibleNodes = useMemo(() => {
    return getVisibleNodes(flatNodes);
  }, [flatNodes]);

  const selectedNodes = useMemo(() => {
    return Array.from(state.selectedIds)
      .map((id) => state.nodes.get(id))
      .filter((n): n is FileTreeNode => !!n);
  }, [state.selectedIds, state.nodes]);

  const selectedNode = useMemo(() => {
    if (state.selectedIds.size === 1) {
      const id = Array.from(state.selectedIds)[0];
      return state.nodes.get(id) || null;
    }
    return null;
  }, [state.selectedIds, state.nodes]);

  const focusedNode = useMemo(() => {
    return state.focusedId ? state.nodes.get(state.focusedId) || null : null;
  }, [state.focusedId, state.nodes]);

  // ================================
  // Node Lookup
  // ================================

  const getNode = useCallback(
    (id: string): FileTreeNode | null => {
      return state.nodes.get(id) || null;
    },
    [state.nodes]
  );

  const getNodeByUri = useCallback(
    (uri: Uri): FileTreeNode | null => {
      return findNodeByUri(state, uri);
    },
    [state]
  );

  const getAncestorsForNode = useCallback(
    (id: string): string[] => {
      return getAncestorIds(state.nodes, id);
    },
    [state.nodes]
  );

  // ================================
  // Return
  // ================================

  return useMemo(
    () => ({
      // State
      state,
      isLoading: state.isLoading,
      error: state.error,

      // Computed values
      flatNodes,
      visibleNodes,
      selectedNodes,
      selectedNode,
      focusedNode,

      // Node lookup
      getNode,
      getNodeByUri,
      getAncestors: getAncestorsForNode,

      // Loading
      loadRoot,
      loadChildren,
      refresh,

      // Selection
      select,
      deselect,
      clearSelection,
      isSelected,

      // Expansion
      expand,
      collapse,
      toggle,
      expandTo,
      expandAll,
      collapseAll,
      isExpanded,

      // Focus
      setFocus,
      isFocused,

      // Editing
      startEditing,
      stopEditing,
      finishEditing,
      isEditing: isEditingFn,

      // Drag & Drop
      startDrag,
      setDropTarget,
      endDrag,
      isDragging,
      isDropTarget: isDropTargetFn,
      canDrop,

      // File operations
      createFile,
      createFolder,
      rename: renameNode,
      move: moveNode,
      deleteNode,

      // Sort
      setSortConfig,
      sortConfig: sortConfigRef.current,
    }),
    [
      state,
      flatNodes,
      visibleNodes,
      selectedNodes,
      selectedNode,
      focusedNode,
      getNode,
      getNodeByUri,
      getAncestorsForNode,
      loadRoot,
      loadChildren,
      refresh,
      select,
      deselect,
      clearSelection,
      isSelected,
      expand,
      collapse,
      toggle,
      expandTo,
      expandAll,
      collapseAll,
      isExpanded,
      setFocus,
      isFocused,
      startEditing,
      stopEditing,
      finishEditing,
      isEditingFn,
      startDrag,
      setDropTarget,
      endDrag,
      isDragging,
      isDropTargetFn,
      canDrop,
      createFile,
      createFolder,
      renameNode,
      moveNode,
      deleteNode,
      setSortConfig,
    ]
  );
}

// ================================
// Helper Functions
// ================================

function createNode(
  uri: Uri,
  stat: { type: FileType; ctime: number; mtime: number; size: number },
  parentId: string | null,
  depth: number
): FileTreeNode {
  return {
    id: uri.toString(),
    uri,
    name: uri.name || '/',
    type: stat.type,
    extension: uri.extension,
    parentId,
    childIds: [],
    depth,
    stat,
    isExpanded: false,
    isSelected: false,
    isEditing: false,
    isDragging: false,
    isDropTarget: false,
    isLoading: false,
    hasError: false,
  };
}
