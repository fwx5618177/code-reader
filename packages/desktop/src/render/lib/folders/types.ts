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
 * 按树顺序列出文件夹及其完整路径（如「工作 / 项目」），用于下拉选择
 * 不同父级下的同名子文件夹在列表中可以区分
 */
export function listFolderPaths(folders: Folder[]): { id: string; path: string }[] {
  const result: { id: string; path: string }[] = [];
  const visit = (nodes: FolderTreeNode[], prefix: string): void => {
    for (const node of nodes) {
      const path = prefix ? `${prefix} / ${node.name}` : node.name;
      result.push({ id: node.id, path });
      visit(node.children, path);
    }
  };
  visit(buildFolderTree(folders), '');
  return result;
}

/**
 * 收集某文件夹的全部后代 ID（不含自身）
 * 即使数据中已存在环也能正常结束
 */
export function collectDescendantIds(
  folders: Pick<Folder, 'id' | 'parentId'>[],
  id: string
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const siblings = childrenByParent.get(folder.parentId);
    if (siblings) siblings.push(folder.id);
    else childrenByParent.set(folder.parentId, [folder.id]);
  }

  const result: string[] = [];
  const visited = new Set<string>([id]);
  const pending = [...(childrenByParent.get(id) ?? [])];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    pending.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
}

/**
 * 把文件夹移到 newParentId 下是否会形成环（移到自身或自己的后代中）
 * newParentId 为 null 表示移到根级，永远不会形成环
 */
export function wouldCreateCycle(
  folders: Pick<Folder, 'id' | 'parentId'>[],
  id: string,
  newParentId: string | null
): boolean {
  if (newParentId === null) return false;
  return newParentId === id || collectDescendantIds(folders, id).includes(newParentId);
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
