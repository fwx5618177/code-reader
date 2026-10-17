// ================================
// Folder Service
// Single responsibility: Business logic for folders
// No state management, no UI concerns
// ================================

import { databaseService } from '../../services/database';
import { folderRepository } from './repository';
import {
  Folder,
  FolderListItem,
  FolderTreeNode,
  CreateFolderInput,
  buildFolderTree,
  folderToListItem,
  wouldCreateCycle,
} from './types';

// ================================
// Service Class
// ================================

class FolderService {
  private initialized = false;

  /**
   * Initialize the service (ensures database is ready)
   * The folders table is created by the main database schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await databaseService.initialize();
    this.initialized = true;

    console.log('[FolderService] Initialized');
  }

  /**
   * Get all folders as a flat list
   */
  async getFolderList(): Promise<FolderListItem[]> {
    await this.initialize();
    return folderRepository.getAllAsListItems();
  }

  /**
   * Get all folders as a tree structure
   */
  async getFolderTree(): Promise<FolderTreeNode[]> {
    await this.initialize();

    const [folders, documentCounts] = await Promise.all([
      folderRepository.getAll(),
      folderRepository.getDocumentCounts(),
    ]);

    return buildFolderTree(folders, documentCounts);
  }

  /**
   * Get a single folder by ID
   */
  async getFolder(id: string): Promise<Folder | null> {
    await this.initialize();
    return folderRepository.getById(id);
  }

  /**
   * Create a new folder
   */
  async createFolder(input: CreateFolderInput): Promise<Folder> {
    await this.initialize();

    // Validate name
    if (!input.name.trim()) {
      throw new Error('文件夹名称不能为空');
    }

    // Check for duplicate name at the same level
    const exists = await folderRepository.existsByName(input.name.trim(), input.parentId ?? null);

    if (exists) {
      throw new Error('同一层级已存在同名文件夹');
    }

    const folder = await folderRepository.create({
      name: input.name.trim(),
      parentId: input.parentId ?? null,
    });

    console.log('[FolderService] Folder created:', folder.id);

    return folder;
  }

  /**
   * Rename a folder
   */
  async renameFolder(id: string, newName: string): Promise<boolean> {
    await this.initialize();

    if (!newName.trim()) {
      throw new Error('文件夹名称不能为空');
    }

    const folder = await folderRepository.getById(id);
    if (!folder) {
      throw new Error('文件夹不存在');
    }

    // Check for duplicate name at the same level (excluding self)
    const exists = await folderRepository.existsByName(newName.trim(), folder.parentId);
    if (exists && folder.name !== newName.trim()) {
      throw new Error('同一层级已存在同名文件夹');
    }

    const success = await folderRepository.update(id, { name: newName.trim() });

    if (success) {
      console.log('[FolderService] Folder renamed:', id);
    }

    return success;
  }

  /**
   * Move a folder to a new parent
   * 校验：文件夹与目标存在、不移到自身或后代中（成环）、目标层级没有同名文件夹
   * 父级未变化时不写数据库
   */
  async moveFolder(id: string, newParentId: string | null): Promise<boolean> {
    await this.initialize();

    const folders = await folderRepository.getAll();
    const folder = folders.find((candidate) => candidate.id === id);
    if (!folder) {
      throw new Error('文件夹不存在');
    }
    if (folder.parentId === newParentId) {
      return true;
    }
    if (newParentId && !folders.some((candidate) => candidate.id === newParentId)) {
      throw new Error('目标文件夹不存在');
    }
    if (wouldCreateCycle(folders, id, newParentId)) {
      throw new Error('不能把文件夹移动到自身或其子文件夹中');
    }
    if (await folderRepository.existsByName(folder.name, newParentId)) {
      throw new Error('目标位置已存在同名文件夹');
    }

    const success = await folderRepository.move(id, newParentId);

    if (success) {
      console.log('[FolderService] Folder moved:', id, 'to', newParentId ?? 'root');
    }

    return success;
  }

  /**
   * Delete a folder (documents become unfiled, subfolders move up one level)
   */
  async deleteFolder(id: string): Promise<boolean> {
    await this.initialize();

    const success = await folderRepository.delete(id);

    if (success) {
      console.log('[FolderService] Folder deleted:', id);
    }

    return success;
  }

  /**
   * Delete a folder and all its subfolders
   */
  async deleteFolderWithDescendants(id: string): Promise<boolean> {
    await this.initialize();

    const success = await folderRepository.deleteWithDescendants(id);

    if (success) {
      console.log('[FolderService] Folder and descendants deleted:', id);
    }

    return success;
  }

  /**
   * Reorder a folder within its siblings
   */
  async reorderFolder(id: string, newOrder: number): Promise<boolean> {
    await this.initialize();
    return folderRepository.reorder(id, newOrder);
  }

  /**
   * Convert a folder to list item
   */
  toListItem(folder: Folder): FolderListItem {
    return folderToListItem(folder);
  }
}

// ================================
// Singleton Export
// ================================

export const folderService = new FolderService();
