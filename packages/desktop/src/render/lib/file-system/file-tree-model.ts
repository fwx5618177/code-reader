// ================================
// File Tree Model
// Monaco-style ExplorerModel for rendering file trees
// Manages UI state and provides operations for the file explorer
// ================================

import { Uri } from './uri';
import { IFileSystemProvider, FileStat, FileType, FileChange, FileChangeType } from './types';

// ================================
// Types
// ================================

/**
 * File tree node for UI rendering
 */
export interface FileTreeNode {
  /** Unique identifier */
  id: string;
  /** Node URI */
  uri: Uri;
  /** Display name */
  name: string;
  /** File type */
  type: FileType;
  /** File extension (for files) */
  extension: string;
  /** Parent node ID (null for root) */
  parentId: string | null;
  /** Child node IDs */
  childIds: string[];
  /** Depth in tree */
  depth: number;
  /** File stat */
  stat: FileStat;
  /** Is expanded (for directories) */
  isExpanded: boolean;
  /** Is selected */
  isSelected: boolean;
  /** Is being renamed */
  isEditing: boolean;
  /** Is being dragged */
  isDragging: boolean;
  /** Is drop target */
  isDropTarget: boolean;
  /** Is loading children */
  isLoading: boolean;
  /** Has error */
  hasError: boolean;
  /** Error message */
  errorMessage?: string;
}

/**
 * Flat node for virtualized rendering
 */
export interface FlatFileTreeNode {
  node: FileTreeNode;
  depth: number;
  isVisible: boolean;
  isLastChild: boolean;
  /** Path of parent IDs from root */
  ancestors: string[];
}

/**
 * File tree state
 */
export interface FileTreeState {
  /** Root node IDs */
  rootIds: string[];
  /** All nodes by ID */
  nodes: Map<string, FileTreeNode>;
  /** Selected node IDs */
  selectedIds: Set<string>;
  /** Expanded node IDs */
  expandedIds: Set<string>;
  /** Currently focused node ID */
  focusedId: string | null;
  /** Node being edited */
  editingId: string | null;
  /** Node being dragged */
  draggingId: string | null;
  /** Current drop target */
  dropTargetId: string | null;
  /** Highlighted nodes (e.g., search results) */
  highlightedIds: Set<string>;
  /** Is loading */
  isLoading: boolean;
  /** Error message */
  error: string | null;
}

/**
 * File tree action types
 */
export type FileTreeAction =
  | { type: 'SET_ROOTS'; rootIds: string[]; nodes: Map<string, FileTreeNode> }
  | { type: 'ADD_NODE'; node: FileTreeNode }
  | { type: 'REMOVE_NODE'; id: string }
  | { type: 'UPDATE_NODE'; id: string; updates: Partial<FileTreeNode> }
  | { type: 'SET_CHILDREN'; parentId: string; childIds: string[]; childNodes: FileTreeNode[] }
  | { type: 'SELECT'; id: string; multi?: boolean; range?: boolean }
  | { type: 'DESELECT'; id: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'EXPAND'; id: string }
  | { type: 'COLLAPSE'; id: string }
  | { type: 'TOGGLE_EXPAND'; id: string }
  | { type: 'EXPAND_ALL' }
  | { type: 'COLLAPSE_ALL' }
  | { type: 'EXPAND_TO'; id: string }
  | { type: 'SET_FOCUS'; id: string | null }
  | { type: 'START_EDITING'; id: string }
  | { type: 'STOP_EDITING' }
  | { type: 'START_DRAG'; id: string }
  | { type: 'SET_DROP_TARGET'; id: string | null }
  | { type: 'END_DRAG' }
  | { type: 'HIGHLIGHT'; ids: string[] }
  | { type: 'CLEAR_HIGHLIGHT' }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' };

/**
 * Sort configuration
 */
export interface FileTreeSortConfig {
  key: 'name' | 'type' | 'modified' | 'size';
  direction: 'asc' | 'desc';
  foldersFirst: boolean;
}

/**
 * Default sort config
 */
export const DEFAULT_SORT_CONFIG: FileTreeSortConfig = {
  key: 'name',
  direction: 'asc',
  foldersFirst: true,
};

// ================================
// Initial State
// ================================

export const initialFileTreeState: FileTreeState = {
  rootIds: [],
  nodes: new Map(),
  selectedIds: new Set(),
  expandedIds: new Set(),
  focusedId: null,
  editingId: null,
  draggingId: null,
  dropTargetId: null,
  highlightedIds: new Set(),
  isLoading: false,
  error: null,
};

// ================================
// Reducer
// ================================

export function fileTreeReducer(state: FileTreeState, action: FileTreeAction): FileTreeState {
  switch (action.type) {
    case 'SET_ROOTS': {
      return {
        ...state,
        rootIds: action.rootIds,
        nodes: action.nodes,
        isLoading: false,
        error: null,
      };
    }

    case 'ADD_NODE': {
      const nodes = new Map(state.nodes);
      nodes.set(action.node.id, action.node);

      // Update parent's childIds if parent exists
      if (action.node.parentId) {
        const parent = nodes.get(action.node.parentId);
        if (parent && !parent.childIds.includes(action.node.id)) {
          nodes.set(action.node.parentId, {
            ...parent,
            childIds: [...parent.childIds, action.node.id],
          });
        }
      }

      return { ...state, nodes };
    }

    case 'REMOVE_NODE': {
      const nodes = new Map(state.nodes);
      const node = nodes.get(action.id);

      if (!node) return state;

      // Remove from parent's childIds
      if (node.parentId) {
        const parent = nodes.get(node.parentId);
        if (parent) {
          nodes.set(node.parentId, {
            ...parent,
            childIds: parent.childIds.filter((id) => id !== action.id),
          });
        }
      }

      // Remove node and all descendants
      const removeDescendants = (id: string) => {
        const n = nodes.get(id);
        if (n) {
          for (const childId of n.childIds) {
            removeDescendants(childId);
          }
          nodes.delete(id);
        }
      };
      removeDescendants(action.id);

      // Update rootIds if this was a root
      const rootIds = state.rootIds.filter((id) => id !== action.id);

      // Update selection
      const selectedIds = new Set(state.selectedIds);
      selectedIds.delete(action.id);

      return { ...state, nodes, rootIds, selectedIds };
    }

    case 'UPDATE_NODE': {
      const node = state.nodes.get(action.id);
      if (!node) return state;

      const nodes = new Map(state.nodes);
      nodes.set(action.id, { ...node, ...action.updates });
      return { ...state, nodes };
    }

    case 'SET_CHILDREN': {
      const nodes = new Map(state.nodes);

      // Add child nodes
      for (const childNode of action.childNodes) {
        nodes.set(childNode.id, childNode);
      }

      // Update parent
      const parent = nodes.get(action.parentId);
      if (parent) {
        nodes.set(action.parentId, {
          ...parent,
          childIds: action.childIds,
          isLoading: false,
        });
      }

      return { ...state, nodes };
    }

    case 'SELECT': {
      const selectedIds = new Set(action.multi ? state.selectedIds : []);
      selectedIds.add(action.id);
      return { ...state, selectedIds, focusedId: action.id };
    }

    case 'DESELECT': {
      const selectedIds = new Set(state.selectedIds);
      selectedIds.delete(action.id);
      return { ...state, selectedIds };
    }

    case 'CLEAR_SELECTION': {
      return { ...state, selectedIds: new Set() };
    }

    case 'EXPAND': {
      if (state.expandedIds.has(action.id)) return state;
      const expandedIds = new Set(state.expandedIds);
      expandedIds.add(action.id);
      return { ...state, expandedIds };
    }

    case 'COLLAPSE': {
      if (!state.expandedIds.has(action.id)) return state;
      const expandedIds = new Set(state.expandedIds);
      expandedIds.delete(action.id);
      return { ...state, expandedIds };
    }

    case 'TOGGLE_EXPAND': {
      const expandedIds = new Set(state.expandedIds);
      if (expandedIds.has(action.id)) {
        expandedIds.delete(action.id);
      } else {
        expandedIds.add(action.id);
      }
      return { ...state, expandedIds };
    }

    case 'EXPAND_ALL': {
      const expandedIds = new Set<string>();
      for (const [id, node] of Array.from(state.nodes.entries())) {
        if (node.type === FileType.Directory) {
          expandedIds.add(id);
        }
      }
      return { ...state, expandedIds };
    }

    case 'COLLAPSE_ALL': {
      return { ...state, expandedIds: new Set() };
    }

    case 'EXPAND_TO': {
      const expandedIds = new Set(state.expandedIds);
      const ancestors = getAncestorIds(state.nodes, action.id);
      for (const ancestorId of ancestors) {
        expandedIds.add(ancestorId);
      }
      return { ...state, expandedIds };
    }

    case 'SET_FOCUS': {
      return { ...state, focusedId: action.id };
    }

    case 'START_EDITING': {
      return { ...state, editingId: action.id };
    }

    case 'STOP_EDITING': {
      return { ...state, editingId: null };
    }

    case 'START_DRAG': {
      const nodes = new Map(state.nodes);
      const node = nodes.get(action.id);
      if (node) {
        nodes.set(action.id, { ...node, isDragging: true });
      }
      return { ...state, nodes, draggingId: action.id };
    }

    case 'SET_DROP_TARGET': {
      const nodes = new Map(state.nodes);

      // Clear previous drop target
      if (state.dropTargetId) {
        const prev = nodes.get(state.dropTargetId);
        if (prev) {
          nodes.set(state.dropTargetId, { ...prev, isDropTarget: false });
        }
      }

      // Set new drop target
      if (action.id) {
        const next = nodes.get(action.id);
        if (next) {
          nodes.set(action.id, { ...next, isDropTarget: true });
        }
      }

      return { ...state, nodes, dropTargetId: action.id };
    }

    case 'END_DRAG': {
      const nodes = new Map(state.nodes);

      if (state.draggingId) {
        const node = nodes.get(state.draggingId);
        if (node) {
          nodes.set(state.draggingId, { ...node, isDragging: false });
        }
      }

      if (state.dropTargetId) {
        const node = nodes.get(state.dropTargetId);
        if (node) {
          nodes.set(state.dropTargetId, { ...node, isDropTarget: false });
        }
      }

      return { ...state, nodes, draggingId: null, dropTargetId: null };
    }

    case 'HIGHLIGHT': {
      return { ...state, highlightedIds: new Set(action.ids) };
    }

    case 'CLEAR_HIGHLIGHT': {
      return { ...state, highlightedIds: new Set() };
    }

    case 'SET_LOADING': {
      return { ...state, isLoading: action.isLoading };
    }

    case 'SET_ERROR': {
      return { ...state, error: action.error, isLoading: false };
    }

    case 'RESET': {
      return initialFileTreeState;
    }

    default:
      return state;
  }
}

// ================================
// Helper Functions
// ================================

/**
 * Get ancestor IDs for a node
 */
export function getAncestorIds(nodes: Map<string, FileTreeNode>, nodeId: string): string[] {
  const ancestors: string[] = [];
  let currentId: string | null = nodeId;

  while (currentId) {
    const node = nodes.get(currentId);
    if (!node || !node.parentId) break;
    ancestors.unshift(node.parentId);
    currentId = node.parentId;
  }

  return ancestors;
}

/**
 * Get descendant IDs for a node
 */
export function getDescendantIds(nodes: Map<string, FileTreeNode>, nodeId: string): string[] {
  const descendants: string[] = [];
  const node = nodes.get(nodeId);

  if (!node) return descendants;

  const collect = (id: string) => {
    const n = nodes.get(id);
    if (!n) return;
    for (const childId of n.childIds) {
      descendants.push(childId);
      collect(childId);
    }
  };

  collect(nodeId);
  return descendants;
}

/**
 * Flatten tree for virtualized rendering
 */
export function flattenFileTree(
  state: FileTreeState,
  sortConfig: FileTreeSortConfig = DEFAULT_SORT_CONFIG
): FlatFileTreeNode[] {
  const result: FlatFileTreeNode[] = [];

  const sortNodes = (nodeIds: string[]): string[] => {
    return [...nodeIds].sort((a, b) => {
      const nodeA = state.nodes.get(a);
      const nodeB = state.nodes.get(b);

      if (!nodeA || !nodeB) return 0;

      // Folders first
      if (sortConfig.foldersFirst) {
        if (nodeA.type === FileType.Directory && nodeB.type !== FileType.Directory) {
          return -1;
        }
        if (nodeA.type !== FileType.Directory && nodeB.type === FileType.Directory) {
          return 1;
        }
      }

      // Sort by key
      let comparison = 0;
      switch (sortConfig.key) {
        case 'name':
          comparison = nodeA.name.localeCompare(nodeB.name);
          break;
        case 'type':
          comparison = nodeA.extension.localeCompare(nodeB.extension);
          break;
        case 'modified':
          comparison = nodeA.stat.mtime - nodeB.stat.mtime;
          break;
        case 'size':
          comparison = nodeA.stat.size - nodeB.stat.size;
          break;
      }

      return sortConfig.direction === 'desc' ? -comparison : comparison;
    });
  };

  const traverse = (
    nodeIds: string[],
    depth: number,
    ancestors: string[],
    isParentExpanded: boolean
  ) => {
    const sortedIds = sortNodes(nodeIds);

    for (let i = 0; i < sortedIds.length; i++) {
      const nodeId = sortedIds[i];
      const node = state.nodes.get(nodeId);

      if (!node) continue;

      const isVisible = depth === 0 || isParentExpanded;
      const isLastChild = i === sortedIds.length - 1;

      result.push({
        node,
        depth,
        isVisible,
        isLastChild,
        ancestors,
      });

      if (node.type === FileType.Directory && node.childIds.length > 0) {
        const isExpanded = state.expandedIds.has(nodeId);
        traverse(node.childIds, depth + 1, [...ancestors, nodeId], isVisible && isExpanded);
      }
    }
  };

  traverse(state.rootIds, 0, [], true);
  return result;
}

/**
 * Get visible nodes only
 */
export function getVisibleNodes(flatNodes: FlatFileTreeNode[]): FlatFileTreeNode[] {
  return flatNodes.filter((n) => n.isVisible);
}

/**
 * Find node by path
 */
export function findNodeByPath(state: FileTreeState, path: string): FileTreeNode | null {
  for (const node of Array.from(state.nodes.values())) {
    if (node.uri.path === path) {
      return node;
    }
  }
  return null;
}

/**
 * Find node by URI
 */
export function findNodeByUri(state: FileTreeState, uri: Uri): FileTreeNode | null {
  for (const node of Array.from(state.nodes.values())) {
    if (node.uri.equals(uri)) {
      return node;
    }
  }
  return null;
}

// ================================
// File Tree Model Class
// ================================

export class FileTreeModel {
  private state: FileTreeState = initialFileTreeState;
  private provider: IFileSystemProvider;
  private sortConfig: FileTreeSortConfig = DEFAULT_SORT_CONFIG;
  private listeners: Set<(state: FileTreeState) => void> = new Set();
  private disposeWatcher: (() => void) | null = null;

  constructor(provider: IFileSystemProvider) {
    this.provider = provider;

    // Listen to file changes
    const { dispose } = provider.onDidChangeFile((changes) => {
      this.handleFileChanges(changes);
    });
    this.disposeWatcher = dispose;
  }

  // ================================
  // State Management
  // ================================

  getState(): FileTreeState {
    return this.state;
  }

  dispatch(action: FileTreeAction): void {
    this.state = fileTreeReducer(this.state, action);
    this.notifyListeners();
  }

  subscribe(listener: (state: FileTreeState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(this.state);
      } catch (e) {
        console.error('Error in file tree listener:', e);
      }
    }
  }

  // ================================
  // Loading
  // ================================

  async loadRoot(rootUri: Uri): Promise<void> {
    this.dispatch({ type: 'SET_LOADING', isLoading: true });

    try {
      const stat = await this.provider.stat(rootUri);
      const rootNode = this.createNode(rootUri, stat, null, 0);

      const nodes = new Map<string, FileTreeNode>();
      nodes.set(rootNode.id, rootNode);

      // Load first level children
      if (stat.type === FileType.Directory) {
        const children = await this.provider.readDirectory(rootUri);
        const childNodes: FileTreeNode[] = [];
        const childIds: string[] = [];

        for (const [name, _type] of children) {
          const childUri = rootUri.joinPath(name);
          const childStat = await this.provider.stat(childUri);
          const childNode = this.createNode(childUri, childStat, rootNode.id, 1);

          childNodes.push(childNode);
          childIds.push(childNode.id);
          nodes.set(childNode.id, childNode);
        }

        rootNode.childIds = childIds;
      }

      this.dispatch({ type: 'SET_ROOTS', rootIds: [rootNode.id], nodes });
    } catch (error) {
      this.dispatch({
        type: 'SET_ERROR',
        error: error instanceof Error ? error.message : 'Failed to load',
      });
    }
  }

  async loadChildren(nodeId: string): Promise<void> {
    const node = this.state.nodes.get(nodeId);
    if (!node || node.type !== FileType.Directory) return;

    // Mark as loading
    this.dispatch({
      type: 'UPDATE_NODE',
      id: nodeId,
      updates: { isLoading: true },
    });

    try {
      const children = await this.provider.readDirectory(node.uri);
      const childNodes: FileTreeNode[] = [];
      const childIds: string[] = [];

      for (const [name, _type] of children) {
        const childUri = node.uri.joinPath(name);
        const childStat = await this.provider.stat(childUri);
        const childNode = this.createNode(childUri, childStat, nodeId, node.depth + 1);

        childNodes.push(childNode);
        childIds.push(childNode.id);
      }

      this.dispatch({
        type: 'SET_CHILDREN',
        parentId: nodeId,
        childIds,
        childNodes,
      });
    } catch (error) {
      this.dispatch({
        type: 'UPDATE_NODE',
        id: nodeId,
        updates: {
          isLoading: false,
          hasError: true,
          errorMessage: error instanceof Error ? error.message : 'Failed to load',
        },
      });
    }
  }

  // ================================
  // Operations
  // ================================

  async createFile(parentUri: Uri, name: string, content = ''): Promise<Uri> {
    const fileUri = parentUri.joinPath(name);
    const encoder = new TextEncoder();

    await this.provider.writeFile(fileUri, encoder.encode(content), {
      create: true,
      overwrite: false,
    });

    return fileUri;
  }

  async createDirectory(parentUri: Uri, name: string): Promise<Uri> {
    const dirUri = parentUri.joinPath(name);
    await this.provider.createDirectory(dirUri);
    return dirUri;
  }

  async rename(uri: Uri, newName: string): Promise<Uri> {
    const newUri = uri.parent.joinPath(newName);
    await this.provider.rename(uri, newUri, { overwrite: false });
    return newUri;
  }

  async move(sourceUri: Uri, targetDirUri: Uri): Promise<Uri> {
    const newUri = targetDirUri.joinPath(sourceUri.name);
    await this.provider.rename(sourceUri, newUri, { overwrite: false });
    return newUri;
  }

  async delete(uri: Uri, recursive = true): Promise<void> {
    await this.provider.delete(uri, { recursive, useTrash: true });
  }

  // ================================
  // Selection & Expansion
  // ================================

  select(id: string, multi = false): void {
    this.dispatch({ type: 'SELECT', id, multi });
  }

  deselect(id: string): void {
    this.dispatch({ type: 'DESELECT', id });
  }

  clearSelection(): void {
    this.dispatch({ type: 'CLEAR_SELECTION' });
  }

  async expand(id: string): Promise<void> {
    const node = this.state.nodes.get(id);
    if (!node || node.type !== FileType.Directory) return;

    // Load children if not loaded
    if (node.childIds.length === 0 && !node.isLoading) {
      await this.loadChildren(id);
    }

    this.dispatch({ type: 'EXPAND', id });
  }

  collapse(id: string): void {
    this.dispatch({ type: 'COLLAPSE', id });
  }

  async toggle(id: string): Promise<void> {
    if (this.state.expandedIds.has(id)) {
      this.collapse(id);
    } else {
      await this.expand(id);
    }
  }

  async expandTo(id: string): Promise<void> {
    const ancestors = getAncestorIds(this.state.nodes, id);
    for (const ancestorId of ancestors) {
      await this.expand(ancestorId);
    }
  }

  // ================================
  // Drag & Drop
  // ================================

  startDrag(id: string): void {
    this.dispatch({ type: 'START_DRAG', id });
  }

  setDropTarget(id: string | null): void {
    this.dispatch({ type: 'SET_DROP_TARGET', id });
  }

  async endDrag(): Promise<void> {
    const { draggingId, dropTargetId } = this.state;

    if (draggingId && dropTargetId && draggingId !== dropTargetId) {
      const source = this.state.nodes.get(draggingId);
      const target = this.state.nodes.get(dropTargetId);

      if (source && target && target.type === FileType.Directory) {
        try {
          await this.move(source.uri, target.uri);
        } catch (error) {
          console.error('Failed to move:', error);
        }
      }
    }

    this.dispatch({ type: 'END_DRAG' });
  }

  // ================================
  // Editing
  // ================================

  startEditing(id: string): void {
    this.dispatch({ type: 'START_EDITING', id });
  }

  stopEditing(): void {
    this.dispatch({ type: 'STOP_EDITING' });
  }

  async finishEditing(newName: string): Promise<void> {
    const { editingId } = this.state;
    if (!editingId) return;

    const node = this.state.nodes.get(editingId);
    if (!node) {
      this.stopEditing();
      return;
    }

    if (newName && newName !== node.name) {
      try {
        await this.rename(node.uri, newName);
      } catch (error) {
        console.error('Failed to rename:', error);
      }
    }

    this.stopEditing();
  }

  // ================================
  // File Change Handling
  // ================================

  private handleFileChanges(changes: FileChange[]): void {
    for (const change of changes) {
      switch (change.type) {
        case FileChangeType.Added:
          this.handleFileAdded(change.uri);
          break;
        case FileChangeType.Deleted:
          this.handleFileDeleted(change.uri);
          break;
        case FileChangeType.Updated:
          this.handleFileUpdated(change.uri);
          break;
      }
    }
  }

  private async handleFileAdded(uri: Uri): Promise<void> {
    // Find parent node
    const parentUri = uri.parent;
    const parentNode = findNodeByUri(this.state, parentUri);

    if (parentNode) {
      // Reload parent's children
      await this.loadChildren(parentNode.id);
    }
  }

  private handleFileDeleted(uri: Uri): void {
    const node = findNodeByUri(this.state, uri);
    if (node) {
      this.dispatch({ type: 'REMOVE_NODE', id: node.id });
    }
  }

  private async handleFileUpdated(uri: Uri): Promise<void> {
    const node = findNodeByUri(this.state, uri);
    if (node) {
      try {
        const stat = await this.provider.stat(uri);
        this.dispatch({
          type: 'UPDATE_NODE',
          id: node.id,
          updates: { stat },
        });
      } catch {
        // File may have been deleted
      }
    }
  }

  // ================================
  // Helpers
  // ================================

  private createNode(
    uri: Uri,
    stat: FileStat,
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

  // ================================
  // Computed Values
  // ================================

  getFlatNodes(): FlatFileTreeNode[] {
    return flattenFileTree(this.state, this.sortConfig);
  }

  getVisibleNodes(): FlatFileTreeNode[] {
    return getVisibleNodes(this.getFlatNodes());
  }

  getSelectedNodes(): FileTreeNode[] {
    return Array.from(this.state.selectedIds)
      .map((id) => this.state.nodes.get(id))
      .filter((n): n is FileTreeNode => !!n);
  }

  setSortConfig(config: Partial<FileTreeSortConfig>): void {
    this.sortConfig = { ...this.sortConfig, ...config };
    this.notifyListeners();
  }

  // ================================
  // Cleanup
  // ================================

  dispose(): void {
    if (this.disposeWatcher) {
      this.disposeWatcher();
      this.disposeWatcher = null;
    }
    this.listeners.clear();
    this.dispatch({ type: 'RESET' });
  }
}

// ================================
// Factory Function
// ================================

export function createFileTreeModel(provider: IFileSystemProvider): FileTreeModel {
  return new FileTreeModel(provider);
}
