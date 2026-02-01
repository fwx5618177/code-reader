// ================================
// Folder Types
// Single responsibility: Type definitions for folders/directories
// ================================

/**
 * Folder entity for document organization
 */
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  order: number;
}

/**
 * Folder with children for tree structure
 */
export interface FolderTreeNode extends Folder {
  children: FolderTreeNode[];
  /** Count of documents directly in this folder */
  documentCount: number;
}

/**
 * Lightweight folder item for list display
 */
export interface FolderListItem {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}

/**
 * Input for creating a new folder
 */
export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
}

/**
 * Input for updating an existing folder
 */
export interface UpdateFolderInput {
  name?: string;
  parentId?: string | null;
  order?: number;
}

/**
 * Database row type for folders table
 */
export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  display_order: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to Folder entity
 */
export function rowToFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name || '',
    parentId: row.parent_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    order: row.display_order,
  };
}

/**
 * Convert Folder to FolderListItem
 */
export function folderToListItem(folder: Folder): FolderListItem {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    order: folder.order,
  };
}

/**
 * Build a tree structure from a flat list of folders
 * @param folders Flat list of folders
 * @param documentCounts Map of folderId -> document count
 * @returns Array of root-level folder tree nodes
 */
export function buildFolderTree(
  folders: Folder[],
  documentCounts: Map<string, number> = new Map()
): FolderTreeNode[] {
  // Create a map for quick lookup
  const folderMap = new Map<string, FolderTreeNode>();

  // Initialize all folders as tree nodes
  for (const folder of folders) {
    folderMap.set(folder.id, {
      ...folder,
      children: [],
      documentCount: documentCounts.get(folder.id) ?? 0,
    });
  }

  // Build the tree by linking children to parents
  const roots: FolderTreeNode[] = [];

  for (const folder of folders) {
    const node = folderMap.get(folder.id)!;

    if (folder.parentId && folderMap.has(folder.parentId)) {
      // Has a valid parent - add as child
      const parent = folderMap.get(folder.parentId)!;
      parent.children.push(node);
    } else {
      // No parent or parent not found - this is a root
      roots.push(node);
    }
  }

  // Sort children by order at each level
  const sortChildren = (nodes: FolderTreeNode[]): void => {
    nodes.sort((a, b) => a.order - b.order);
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortChildren(node.children);
      }
    }
  };

  sortChildren(roots);

  return roots;
}

/**
 * Flatten a folder tree back to a list (depth-first)
 * Useful for rendering with indentation
 */
export interface FlattenedFolderNode {
  folder: FolderTreeNode;
  depth: number;
}

export function flattenFolderTree(
  tree: FolderTreeNode[],
  depth: number = 0
): FlattenedFolderNode[] {
  const result: FlattenedFolderNode[] = [];

  for (const node of tree) {
    result.push({ folder: node, depth });
    if (node.children.length > 0) {
      result.push(...flattenFolderTree(node.children, depth + 1));
    }
  }

  return result;
}
