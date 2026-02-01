// ================================
// Folder Repository
// Single responsibility: Database operations for folders
// Uses the main `folders` table from the database schema
// No business logic, no state management
// ================================

import { databaseService, now } from '../../services/database';
import { generateUUID } from '../utils';
import {
  Folder,
  FolderListItem,
  FolderRow,
  CreateFolderInput,
  UpdateFolderInput,
  rowToFolder,
  folderToListItem,
} from './types';

// ================================
// Constants
// ================================

const FOLDER_TYPE = 'manual'; // Default folder type for document folders

// ================================
// Repository Class
// ================================

class FolderRepository {
  /**
   * Get all folders (sorted by order)
   */
  async getAll(): Promise<Folder[]> {
    const rows = await databaseService.all<FolderRow>(
      `SELECT id, name, parent_id, sort_order as display_order, is_deleted, created_at, updated_at
       FROM folders
       WHERE is_deleted = 0 AND type = ?
       ORDER BY sort_order ASC, created_at ASC`,
      [FOLDER_TYPE]
    );

    return rows.map(rowToFolder);
  }

  /**
   * Get all folders as list items
   */
  async getAllAsListItems(): Promise<FolderListItem[]> {
    const folders = await this.getAll();
    return folders.map(folderToListItem);
  }

  /**
   * Get a single folder by ID
   */
  async getById(id: string): Promise<Folder | null> {
    const row = await databaseService.get<FolderRow>(
      `SELECT id, name, parent_id, sort_order as display_order, is_deleted, created_at, updated_at
       FROM folders
       WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (!row) return null;
    return rowToFolder(row);
  }

  /**
   * Get children of a folder
   */
  async getChildren(parentId: string | null): Promise<Folder[]> {
    const query = parentId
      ? `SELECT id, name, parent_id, sort_order as display_order, is_deleted, created_at, updated_at
         FROM folders
         WHERE parent_id = ? AND is_deleted = 0 AND type = ?
         ORDER BY sort_order ASC, created_at ASC`
      : `SELECT id, name, parent_id, sort_order as display_order, is_deleted, created_at, updated_at
         FROM folders
         WHERE parent_id IS NULL AND is_deleted = 0 AND type = ?
         ORDER BY sort_order ASC, created_at ASC`;

    const params = parentId ? [parentId, FOLDER_TYPE] : [FOLDER_TYPE];
    const rows = await databaseService.all<FolderRow>(query, params);

    return rows.map(rowToFolder);
  }

  /**
   * Get document counts for all folders
   * Returns a map of folderId -> count
   */
  async getDocumentCounts(): Promise<Map<string, number>> {
    const rows = await databaseService.all<{ folder_id: string; count: number }>(
      `SELECT folder_id, COUNT(*) as count
       FROM knowledge_items
       WHERE type = 'note' AND is_deleted = 0 AND folder_id IS NOT NULL
       GROUP BY folder_id`
    );

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.folder_id, row.count);
    }
    return counts;
  }

  /**
   * Check if a folder with the given name exists at the same level
   */
  async existsByName(name: string, parentId: string | null): Promise<boolean> {
    const query = parentId
      ? `SELECT id FROM folders
         WHERE name = ? AND parent_id = ? AND is_deleted = 0 AND type = ?
         LIMIT 1`
      : `SELECT id FROM folders
         WHERE name = ? AND parent_id IS NULL AND is_deleted = 0 AND type = ?
         LIMIT 1`;

    const params = parentId ? [name, parentId, FOLDER_TYPE] : [name, FOLDER_TYPE];
    const row = await databaseService.get<{ id: string }>(query, params);

    return row !== undefined;
  }

  /**
   * Get the next order number for a new folder at the given level
   */
  async getNextOrder(parentId: string | null): Promise<number> {
    const query = parentId
      ? `SELECT MAX(sort_order) as max_order
         FROM folders
         WHERE parent_id = ? AND is_deleted = 0 AND type = ?`
      : `SELECT MAX(sort_order) as max_order
         FROM folders
         WHERE parent_id IS NULL AND is_deleted = 0 AND type = ?`;

    const params = parentId ? [parentId, FOLDER_TYPE] : [FOLDER_TYPE];
    const row = await databaseService.get<{ max_order: number | null }>(query, params);

    return (row?.max_order ?? -1) + 1;
  }

  /**
   * Create a new folder
   */
  async create(input: CreateFolderInput): Promise<Folder> {
    const id = generateUUID();
    const timestamp = now();
    const order = await this.getNextOrder(input.parentId ?? null);

    await databaseService.run(
      `INSERT INTO folders
       (id, name, type, parent_id, sort_order, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, input.name, FOLDER_TYPE, input.parentId ?? null, order, timestamp, timestamp]
    );

    return {
      id,
      name: input.name,
      parentId: input.parentId ?? null,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      order,
    };
  }

  /**
   * Update an existing folder
   */
  async update(id: string, input: UpdateFolderInput): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }

    if (input.parentId !== undefined) {
      updates.push('parent_id = ?');
      params.push(input.parentId);
    }

    if (input.order !== undefined) {
      updates.push('sort_order = ?');
      params.push(input.order);
    }

    if (updates.length === 0) {
      return true; // Nothing to update
    }

    // Always update timestamp
    updates.push('updated_at = ?');
    params.push(now());

    // Add WHERE clause params
    params.push(id);

    const result = await databaseService.run(
      `UPDATE folders SET ${updates.join(', ')} WHERE id = ? AND is_deleted = 0`,
      params
    );

    return result.changes > 0;
  }

  /**
   * Soft delete a folder
   * Note: This doesn't delete documents in the folder, they become "unfiled"
   */
  async delete(id: string): Promise<boolean> {
    const timestamp = now();

    // First, set folder_id to null for all documents in this folder
    await databaseService.run(
      `UPDATE knowledge_items SET folder_id = NULL, updated_at = ?
       WHERE folder_id = ? AND is_deleted = 0`,
      [timestamp, id]
    );

    // Then soft delete the folder
    const result = await databaseService.run(
      `UPDATE folders SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE id = ?`,
      [timestamp, timestamp, id]
    );

    return result.changes > 0;
  }

  /**
   * Delete a folder and all its descendants (recursive)
   */
  async deleteWithDescendants(id: string): Promise<boolean> {
    const timestamp = now();

    // Get all descendant folder IDs
    const descendants = await this.getAllDescendantIds(id);
    const allFolderIds = [id, ...descendants];

    // Set folder_id to null for all documents in these folders
    for (const folderId of allFolderIds) {
      await databaseService.run(
        `UPDATE knowledge_items SET folder_id = NULL, updated_at = ?
         WHERE folder_id = ? AND is_deleted = 0`,
        [timestamp, folderId]
      );
    }

    // Soft delete all folders
    for (const folderId of allFolderIds) {
      await databaseService.run(
        `UPDATE folders SET is_deleted = 1, deleted_at = ?, updated_at = ?
         WHERE id = ?`,
        [timestamp, timestamp, folderId]
      );
    }

    return true;
  }

  /**
   * Get all descendant folder IDs (recursive)
   */
  private async getAllDescendantIds(parentId: string): Promise<string[]> {
    const children = await this.getChildren(parentId);
    const descendantIds: string[] = [];

    for (const child of children) {
      descendantIds.push(child.id);
      const childDescendants = await this.getAllDescendantIds(child.id);
      descendantIds.push(...childDescendants);
    }

    return descendantIds;
  }

  /**
   * Move a folder to a new parent
   */
  async move(id: string, newParentId: string | null): Promise<boolean> {
    // Prevent moving a folder into itself or its descendants
    if (newParentId) {
      const descendants = await this.getAllDescendantIds(id);
      if (descendants.includes(newParentId) || id === newParentId) {
        console.error('[FolderRepository] Cannot move folder into itself or its descendants');
        return false;
      }
    }

    const order = await this.getNextOrder(newParentId);
    return this.update(id, { parentId: newParentId, order });
  }

  /**
   * Reorder folders at the same level
   */
  async reorder(folderId: string, newOrder: number): Promise<boolean> {
    const folder = await this.getById(folderId);
    if (!folder) return false;

    const timestamp = now();

    // Get siblings at the same level
    const siblings = await this.getChildren(folder.parentId);

    // Update order for affected siblings
    for (const sibling of siblings) {
      if (sibling.id === folderId) continue;

      if (folder.order < newOrder) {
        // Moving down: decrement order for items between old and new position
        if (sibling.order > folder.order && sibling.order <= newOrder) {
          await databaseService.run(
            `UPDATE folders SET sort_order = sort_order - 1, updated_at = ?
             WHERE id = ?`,
            [timestamp, sibling.id]
          );
        }
      } else {
        // Moving up: increment order for items between new and old position
        if (sibling.order >= newOrder && sibling.order < folder.order) {
          await databaseService.run(
            `UPDATE folders SET sort_order = sort_order + 1, updated_at = ?
             WHERE id = ?`,
            [timestamp, sibling.id]
          );
        }
      }
    }

    // Update the folder's order
    return this.update(folderId, { order: newOrder });
  }
}

// ================================
// Singleton Export
// ================================

export const folderRepository = new FolderRepository();
