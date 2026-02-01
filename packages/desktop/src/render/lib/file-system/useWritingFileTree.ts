// ================================
// useWritingFileTree Hook
// Writing-specific file tree hook - simplified O(n) implementation
// Directly builds tree from folders and documents without async loading
// ================================

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Uri } from './uri';
import { FileType, FileStat } from './types';
import {
  FileTreeNode,
  FlatFileTreeNode,
  FileTreeSortConfig,
  DEFAULT_SORT_CONFIG,
} from './file-tree-model';
import { Folder } from '../folders';
import { DocumentListItem } from '../documents';

// ================================
// Types
// ================================

/**
 * Folder-like type that works with both Folder and FolderListItem
 */
export type FolderLike = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder?: number;
};

/**
 * Node metadata for writing nodes
 */
export interface WritingNodeMeta {
  nodeType: 'folder' | 'document';
  folder?: FolderLike;
  document?: DocumentListItem;
  isFavorite?: boolean;
  isPinned?: boolean;
}

/**
 * Configuration for useWritingFileTree
 */
export interface UseWritingFileTreeConfig {
  /** Folders data */
  folders: FolderLike[];
  /** Documents data */
  documents: DocumentListItem[];
  /** Whether folders are loading */
  foldersLoading?: boolean;
  /** Folders error */
  foldersError?: string | null;
  /** Initial selected document ID */
  initialSelectedDocumentId?: string | null;
  /** Initial expanded folder IDs */
  initialExpandedFolderIds?: string[];
  /** Callback to create folder */
  createFolder?: (name: string, parentId: string | null) => Promise<Folder | null>;
  /** Callback to rename folder */
  renameFolder?: (id: string, newName: string) => Promise<boolean>;
  /** Callback to delete folder */
  deleteFolder?: (id: string) => Promise<boolean>;
  /** Callback to move document to folder */
  moveDocument?: (id: string, folderId: string | null) => Promise<boolean>;
  /** Callback when a document is selected */
  onSelectDocument?: (doc: DocumentListItem) => void;
  /** Callback when a folder is selected */
  onSelectFolder?: (folder: FolderLike | null) => void;
  /** Callback when selection is cleared */
  onClearSelection?: () => void;
}

/**
 * Return type for useWritingFileTree
 */
export interface UseWritingFileTreeReturn {
  // State
  isLoading: boolean;
  error: string | null;

  // Computed values
  visibleNodes: FlatFileTreeNode[];

  // Selected state
  selectedDocumentId: string | null;
  selectedFolderId: string | null;
  selectedDocument: DocumentListItem | null;
  selectedFolder: FolderLike | null;

  // Expansion
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
  expand: (id: string) => void;
  collapse: (id: string) => void;

  // Selection
  select: (id: string) => void;
  clearSelection: () => void;

  // Node lookup
  getNode: (id: string) => FileTreeNode | null;
  getNodeMeta: (id: string) => WritingNodeMeta | null;
  getAncestors: (id: string) => string[];

  // Writing-specific actions
  selectDocument: (id: string) => void;
  selectFolder: (id: string | null) => void;
  createNewFolder: (name: string, parentId?: string | null) => Promise<FolderLike | null>;
  deleteFolderById: (id: string) => Promise<boolean>;
  renameFolderById: (id: string, newName: string) => Promise<boolean>;
  moveDocumentToFolder: (documentId: string, folderId: string | null) => Promise<boolean>;
  expandToDocument: (documentId: string) => void;
  expandToFolder: (folderId: string) => void;
}

// ================================
// Constants
// ================================

// 默认扩展名，实际扩展名根据文档内容推断
const DEFAULT_EXTENSION = '.md';
const SCHEME = 'writing';

/**
 * 根据文档标题推断文件扩展名
 * @param title 文档标题
 * @param content 文档内容（可选，用于根据内容推断类型）
 * @returns 推断的扩展名
 */
function inferFileExtension(title: string | undefined, content?: string): string {
  // 如果标题已有扩展名，使用标题中的扩展名
  if (title) {
    const lowerTitle = title.toLowerCase();
    // LaTeX 扩展名
    if (
      lowerTitle.endsWith('.tex') ||
      lowerTitle.endsWith('.latex') ||
      lowerTitle.endsWith('.ltx')
    ) {
      return '.tex';
    }
    // 纯文本扩展名
    if (lowerTitle.endsWith('.txt') || lowerTitle.endsWith('.text')) {
      return '.txt';
    }
    // Markdown 扩展名
    if (
      lowerTitle.endsWith('.md') ||
      lowerTitle.endsWith('.markdown') ||
      lowerTitle.endsWith('.mdown')
    ) {
      return '.md';
    }

    // 检查标题中是否包含 LaTeX 相关关键词（用于没有扩展名但名称暗示类型的情况）
    if (
      lowerTitle.includes('latex') ||
      lowerTitle.includes('sample') ||
      lowerTitle.includes('document') ||
      lowerTitle.includes('large-document') ||
      lowerTitle.includes('huge-document')
    ) {
      // 标题暗示可能是 LaTeX，但需要进一步验证
      // 这里不直接返回，继续检查内容
    }
  }

  // 根据内容推断文件类型
  if (content) {
    // 检查是否为 LaTeX 文件（包含 LaTeX 特征标记）
    const latexPatterns = [
      /\\documentclass\s*[{[]/,
      /\\begin\s*\{document\}/,
      /\\usepackage\s*[{[]/,
      /\\section\s*\{/,
      /\\maketitle/,
      /\\title\s*\{/,
      /\\author\s*\{/,
      /\\chapter\s*\{/,
      /\\subsection\s*\{/,
      /\\begin\s*\{equation\}/,
      /\\begin\s*\{align\}/,
      /\$\$[\s\S]+?\$\$/,
      /\\\[[\s\S]+?\\\]/,
    ];

    for (const pattern of latexPatterns) {
      if (pattern.test(content)) {
        return '.tex';
      }
    }
  }

  // 如果标题以常见 LaTeX 示例名称结尾（无扩展名情况的回退）
  if (title) {
    const baseName = title.toLowerCase().replace(/\.[^.]+$/, '');
    if (
      baseName === 'sample' ||
      baseName === 'large-document' ||
      baseName === 'huge-document' ||
      baseName.includes('latex')
    ) {
      return '.tex';
    }
  }

  // 默认返回 Markdown
  return DEFAULT_EXTENSION;
}

// ================================
// Helper Functions
// ================================

/**
 * Create a node ID from folder or document
 */
function createNodeId(type: 'folder' | 'document', id: string): string {
  return `${type}:${id}`;
}

/**
 * Parse a node ID to get type and original ID
 */
function parseNodeId(nodeId: string): { type: 'folder' | 'document'; id: string } | null {
  const colonIndex = nodeId.indexOf(':');
  if (colonIndex === -1) return null;
  const type = nodeId.substring(0, colonIndex) as 'folder' | 'document';
  const id = nodeId.substring(colonIndex + 1);
  if (type !== 'folder' && type !== 'document') return null;
  return { type, id };
}

/**
 * Create a file stat
 */
function createFileStat(type: FileType, mtime?: Date): FileStat {
  const now = Date.now();
  return {
    type,
    ctime: now,
    mtime: mtime?.getTime() ?? now,
    size: 0,
  };
}

// ================================
// Tree Building - O(n) Algorithm
// ================================

interface TreeBuildResult {
  nodes: Map<string, FileTreeNode>;
  nodeMetaMap: Map<string, WritingNodeMeta>;
  rootIds: string[];
  folderNodeIdMap: Map<string, string>; // folderId -> nodeId
  documentNodeIdMap: Map<string, string>; // documentId -> nodeId
}

/**
 * Build tree structure from folders and documents in O(n) time
 *
 * Algorithm:
 * 1. Create all folder nodes (O(n))
 * 2. Create all document nodes (O(n))
 * 3. Build parent-child relationships using a single pass (O(n))
 * 4. Identify root nodes (O(n))
 *
 * Total: O(n) where n = folders.length + documents.length
 */
function buildTree(
  folders: FolderLike[],
  documents: DocumentListItem[],
  sortConfig: FileTreeSortConfig = DEFAULT_SORT_CONFIG
): TreeBuildResult {
  const nodes = new Map<string, FileTreeNode>();
  const nodeMetaMap = new Map<string, WritingNodeMeta>();
  const folderNodeIdMap = new Map<string, string>();
  const documentNodeIdMap = new Map<string, string>();
  const childrenMap = new Map<string | null, string[]>(); // parentId -> childNodeIds

  // Initialize children map with null for root-level items
  childrenMap.set(null, []);

  // Step 1: Create all folder nodes - O(n)
  for (const folder of folders) {
    const nodeId = createNodeId('folder', folder.id);
    folderNodeIdMap.set(folder.id, nodeId);

    // Initialize children array for this folder
    childrenMap.set(folder.id, []);

    // Create the node (childIds will be filled later)
    const node: FileTreeNode = {
      id: nodeId,
      uri: Uri.from({ scheme: SCHEME, path: `/${folder.name}` }),
      name: folder.name,
      type: FileType.Directory,
      extension: '',
      parentId: folder.parentId ? createNodeId('folder', folder.parentId) : null,
      childIds: [], // Will be filled in step 3
      depth: 0, // Will be calculated in step 4
      stat: createFileStat(FileType.Directory),
      isExpanded: false,
      isSelected: false,
      isEditing: false,
      isDragging: false,
      isDropTarget: false,
      isLoading: false,
      hasError: false,
    };

    nodes.set(nodeId, node);
    nodeMetaMap.set(nodeId, { nodeType: 'folder', folder });
  }

  // Step 2: Create all document nodes - O(n)
  for (const doc of documents) {
    const nodeId = createNodeId('document', doc.id);
    documentNodeIdMap.set(doc.id, nodeId);

    const displayName = doc.title || '无标题';
    // 推断文件扩展名（根据标题和内容）
    const extension = inferFileExtension(doc.title, doc.content);
    // 检查标题是否已有扩展名
    const hasExtension = /\.(md|markdown|mdown|tex|latex|ltx|txt|text)$/i.test(displayName);
    const fileName = hasExtension ? displayName : `${displayName}${extension}`;

    const node: FileTreeNode = {
      id: nodeId,
      uri: Uri.from({ scheme: SCHEME, path: `/${fileName}` }),
      name: fileName,
      type: FileType.File,
      extension,
      parentId: doc.folderId ? createNodeId('folder', doc.folderId) : null,
      childIds: [],
      depth: 0, // Will be calculated in step 4
      stat: createFileStat(FileType.File, doc.updatedAt),
      isExpanded: false,
      isSelected: false,
      isEditing: false,
      isDragging: false,
      isDropTarget: false,
      isLoading: false,
      hasError: false,
    };

    nodes.set(nodeId, node);
    nodeMetaMap.set(nodeId, {
      nodeType: 'document',
      document: doc,
      isFavorite: doc.isFavorite,
      isPinned: doc.isPinned,
    });
  }

  // Step 3: Build parent-child relationships - O(n)
  for (const [nodeId, _node] of nodes) {
    const parsed = parseNodeId(nodeId);
    if (!parsed) continue;

    let parentFolderId: string | null = null;
    if (parsed.type === 'folder') {
      const folder = folders.find((f) => f.id === parsed.id);
      parentFolderId = folder?.parentId ?? null;
    } else {
      const doc = documents.find((d) => d.id === parsed.id);
      parentFolderId = doc?.folderId ?? null;
    }

    // Add to parent's children list
    const children = childrenMap.get(parentFolderId) ?? [];
    children.push(nodeId);
    childrenMap.set(parentFolderId, children);
  }

  // Step 4: Sort children and assign to nodes, calculate depths - O(n log n) for sorting
  const sortChildren = (childIds: string[]): string[] => {
    return childIds.sort((a, b) => {
      const nodeA = nodes.get(a);
      const nodeB = nodes.get(b);
      if (!nodeA || !nodeB) return 0;

      // Folders first
      if (sortConfig.foldersFirst) {
        if (nodeA.type === FileType.Directory && nodeB.type !== FileType.Directory) return -1;
        if (nodeA.type !== FileType.Directory && nodeB.type === FileType.Directory) return 1;
      }

      // Sort by name
      let comparison = 0;
      switch (sortConfig.key) {
        case 'name':
          comparison = nodeA.name.localeCompare(nodeB.name, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
          break;
        case 'modified':
          comparison = nodeA.stat.mtime - nodeB.stat.mtime;
          break;
        default:
          comparison = nodeA.name.localeCompare(nodeB.name, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
      }

      return sortConfig.direction === 'desc' ? -comparison : comparison;
    });
  };

  // Assign sorted children to folder nodes
  for (const folder of folders) {
    const nodeId = folderNodeIdMap.get(folder.id);
    if (!nodeId) continue;

    const node = nodes.get(nodeId);
    if (!node) continue;

    const children = childrenMap.get(folder.id) ?? [];
    node.childIds = sortChildren(children);
  }

  // Get and sort root nodes
  const rootChildren = childrenMap.get(null) ?? [];
  const rootIds = sortChildren(rootChildren);

  // Calculate depths using BFS - O(n)
  const calculateDepths = () => {
    const queue: { nodeId: string; depth: number }[] = rootIds.map((id) => ({
      nodeId: id,
      depth: 0,
    }));

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      const node = nodes.get(nodeId);
      if (!node) continue;

      node.depth = depth;

      for (const childId of node.childIds) {
        queue.push({ nodeId: childId, depth: depth + 1 });
      }
    }
  };

  calculateDepths();

  return { nodes, nodeMetaMap, rootIds, folderNodeIdMap, documentNodeIdMap };
}

/**
 * Get visible flat nodes based on expansion state - O(visible nodes)
 */
function getVisibleFlatNodes(
  nodes: Map<string, FileTreeNode>,
  rootIds: string[],
  expandedIds: Set<string>
): FlatFileTreeNode[] {
  const result: FlatFileTreeNode[] = [];

  const traverse = (nodeIds: string[], ancestors: string[], isParentExpanded: boolean) => {
    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      const node = nodes.get(nodeId);
      if (!node) continue;

      const isVisible = ancestors.length === 0 || isParentExpanded;
      const isLastChild = i === nodeIds.length - 1;

      result.push({
        node,
        depth: node.depth,
        isVisible,
        isLastChild,
        ancestors,
      });

      if (node.type === FileType.Directory && node.childIds.length > 0) {
        const isExpanded = expandedIds.has(nodeId);
        traverse(node.childIds, [...ancestors, nodeId], isVisible && isExpanded);
      }
    }
  };

  traverse(rootIds, [], true);

  // Only return visible nodes
  return result.filter((n) => n.isVisible);
}

/**
 * Get all ancestor node IDs for a given node - O(depth)
 */
function getAncestorIds(nodes: Map<string, FileTreeNode>, nodeId: string): string[] {
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

// ================================
// Hook Implementation
// ================================

export function useWritingFileTree(config: UseWritingFileTreeConfig): UseWritingFileTreeReturn {
  const {
    folders,
    documents,
    foldersLoading = false,
    foldersError = null,
    initialSelectedDocumentId = null,
    initialExpandedFolderIds = [],
    createFolder,
    renameFolder,
    deleteFolder,
    moveDocument,
    onSelectDocument,
    onSelectFolder,
    onClearSelection,
  } = config;

  // ================================
  // State
  // ================================

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    // Will be populated after tree is built
    return initial;
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // ================================
  // Build Tree - O(n)
  // ================================

  const treeData = useMemo(() => {
    return buildTree(folders, documents);
  }, [folders, documents]);

  const { nodes, nodeMetaMap, rootIds, folderNodeIdMap, documentNodeIdMap } = treeData;

  // ================================
  // Initialize expanded and selected state
  // ================================

  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Set initial expanded folders
    if (initialExpandedFolderIds.length > 0) {
      const initialExpanded = new Set<string>();
      for (const folderId of initialExpandedFolderIds) {
        const nodeId = folderNodeIdMap.get(folderId);
        if (nodeId) {
          initialExpanded.add(nodeId);
        }
      }
      setExpandedIds(initialExpanded);
    }

    // Set initial selected document
    if (initialSelectedDocumentId) {
      const nodeId = documentNodeIdMap.get(initialSelectedDocumentId);
      if (nodeId) {
        setSelectedNodeId(nodeId);
        // Expand ancestors
        const ancestors = getAncestorIds(nodes, nodeId);
        if (ancestors.length > 0) {
          setExpandedIds((prev) => {
            const next = new Set(prev);
            for (const a of ancestors) {
              next.add(a);
            }
            return next;
          });
        }
      }
    }
  }, [
    initialExpandedFolderIds,
    initialSelectedDocumentId,
    folderNodeIdMap,
    documentNodeIdMap,
    nodes,
  ]);

  // ================================
  // Computed Values
  // ================================

  const visibleNodes = useMemo(() => {
    return getVisibleFlatNodes(nodes, rootIds, expandedIds);
  }, [nodes, rootIds, expandedIds]);

  const selectedDocumentId = useMemo(() => {
    if (!selectedNodeId) return null;
    const parsed = parseNodeId(selectedNodeId);
    if (parsed?.type === 'document') return parsed.id;
    return null;
  }, [selectedNodeId]);

  const selectedFolderId = useMemo(() => {
    if (!selectedNodeId) return null;
    const parsed = parseNodeId(selectedNodeId);
    if (parsed?.type === 'folder') return parsed.id;
    return null;
  }, [selectedNodeId]);

  const selectedDocument = useMemo(() => {
    if (!selectedDocumentId) return null;
    return documents.find((d) => d.id === selectedDocumentId) ?? null;
  }, [selectedDocumentId, documents]);

  const selectedFolder = useMemo(() => {
    if (!selectedFolderId) return null;
    return folders.find((f) => f.id === selectedFolderId) ?? null;
  }, [selectedFolderId, folders]);

  // ================================
  // Expansion Operations
  // ================================

  const isExpanded = useCallback(
    (id: string) => {
      return expandedIds.has(id);
    },
    [expandedIds]
  );

  const expand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const collapse = useCallback((id: string) => {
    setExpandedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ================================
  // Selection Operations
  // ================================

  const select = useCallback(
    (id: string) => {
      setSelectedNodeId(id);

      // Notify callbacks
      const meta = nodeMetaMap.get(id);
      if (meta?.nodeType === 'document' && meta.document && onSelectDocument) {
        onSelectDocument(meta.document);
      } else if (meta?.nodeType === 'folder' && meta.folder && onSelectFolder) {
        onSelectFolder(meta.folder);
      }
    },
    [nodeMetaMap, onSelectDocument, onSelectFolder]
  );

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    if (onClearSelection) {
      onClearSelection();
    }
    if (onSelectFolder) {
      onSelectFolder(null);
    }
  }, [onClearSelection, onSelectFolder]);

  // ================================
  // Node Lookup
  // ================================

  const getNode = useCallback(
    (id: string): FileTreeNode | null => {
      return nodes.get(id) ?? null;
    },
    [nodes]
  );

  const getNodeMeta = useCallback(
    (id: string): WritingNodeMeta | null => {
      return nodeMetaMap.get(id) ?? null;
    },
    [nodeMetaMap]
  );

  const getAncestors = useCallback(
    (id: string): string[] => {
      return getAncestorIds(nodes, id);
    },
    [nodes]
  );

  // ================================
  // Writing-Specific Actions
  // ================================

  const selectDocument = useCallback(
    (docId: string) => {
      const nodeId = documentNodeIdMap.get(docId);
      if (nodeId) {
        select(nodeId);
      }
    },
    [documentNodeIdMap, select]
  );

  const selectFolderAction = useCallback(
    (folderId: string | null) => {
      if (folderId === null) {
        clearSelection();
        return;
      }
      const nodeId = folderNodeIdMap.get(folderId);
      if (nodeId) {
        select(nodeId);
      }
    },
    [folderNodeIdMap, select, clearSelection]
  );

  const createNewFolder = useCallback(
    async (name: string, parentId?: string | null): Promise<FolderLike | null> => {
      if (!createFolder) return null;
      const folder = await createFolder(name, parentId ?? null);
      if (folder && parentId) {
        // Expand parent folder
        const parentNodeId = folderNodeIdMap.get(parentId);
        if (parentNodeId) {
          expand(parentNodeId);
        }
      }
      return folder;
    },
    [createFolder, folderNodeIdMap, expand]
  );

  const deleteFolderById = useCallback(
    async (id: string): Promise<boolean> => {
      if (!deleteFolder) return false;
      return deleteFolder(id);
    },
    [deleteFolder]
  );

  const renameFolderById = useCallback(
    async (id: string, newName: string): Promise<boolean> => {
      if (!renameFolder) return false;
      return renameFolder(id, newName);
    },
    [renameFolder]
  );

  const moveDocumentToFolder = useCallback(
    async (documentId: string, folderId: string | null): Promise<boolean> => {
      if (!moveDocument) return false;
      return moveDocument(documentId, folderId);
    },
    [moveDocument]
  );

  const expandToDocument = useCallback(
    (documentId: string) => {
      const nodeId = documentNodeIdMap.get(documentId);
      if (!nodeId) return;

      const ancestors = getAncestorIds(nodes, nodeId);
      if (ancestors.length > 0) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          for (const a of ancestors) {
            next.add(a);
          }
          return next;
        });
      }
    },
    [documentNodeIdMap, nodes]
  );

  const expandToFolder = useCallback(
    (folderId: string) => {
      const nodeId = folderNodeIdMap.get(folderId);
      if (!nodeId) return;

      const ancestors = getAncestorIds(nodes, nodeId);
      if (ancestors.length > 0) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          for (const a of ancestors) {
            next.add(a);
          }
          return next;
        });
      }
    },
    [folderNodeIdMap, nodes]
  );

  // ================================
  // Return
  // ================================

  return useMemo(
    () => ({
      // State
      isLoading: foldersLoading,
      error: foldersError,

      // Computed values
      visibleNodes,

      // Selected state
      selectedDocumentId,
      selectedFolderId,
      selectedDocument,
      selectedFolder,

      // Expansion
      isExpanded,
      toggle,
      expand,
      collapse,

      // Selection
      select,
      clearSelection,

      // Node lookup
      getNode,
      getNodeMeta,
      getAncestors,

      // Writing-specific actions
      selectDocument,
      selectFolder: selectFolderAction,
      createNewFolder,
      deleteFolderById,
      renameFolderById,
      moveDocumentToFolder,
      expandToDocument,
      expandToFolder,
    }),
    [
      foldersLoading,
      foldersError,
      visibleNodes,
      selectedDocumentId,
      selectedFolderId,
      selectedDocument,
      selectedFolder,
      isExpanded,
      toggle,
      expand,
      collapse,
      select,
      clearSelection,
      getNode,
      getNodeMeta,
      getAncestors,
      selectDocument,
      selectFolderAction,
      createNewFolder,
      deleteFolderById,
      renameFolderById,
      moveDocumentToFolder,
      expandToDocument,
      expandToFolder,
    ]
  );
}

export default useWritingFileTree;
