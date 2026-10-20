// ================================
// Folder Repository
// Single responsibility: Database operations for folders
// Uses the main `folders` table from the database schema
// No business logic, no state management
// ================================

import { databaseService, now } from '../../services/database';
import type { SqlStatement } from '../../types/electron';
import { generateUUID } from '../utils';
import {
  Folder,
  FolderListItem,
  FolderRow,
  CreateFolderInput,
  UpdateFolderInput,
  rowToFolder,
  folderToListItem,
  collectDescendantIds,
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
   * 文件夹内的条目不删除，变为未归档；子文件夹上移一级（挂到被删文件夹的父级下）
   * 三步在同一个事务中执行，中途失败不会留下指向已删除文件夹的数据
   */
  async delete(id: string): Promise<boolean> {
    const folder = await this.getById(id);
    if (!folder) return false;

    const timestamp = now();
    const [, , deleted] = await databaseService.transaction([
      {
        sql: `UPDATE knowledge_items SET folder_id = NULL, updated_at = ?
              WHERE folder_id = ? AND is_deleted = 0`,
        params: [timestamp, id],
      },
      {
        sql: `UPDATE folders SET parent_id = ?, updated_at = ?
              WHERE parent_id = ? AND is_deleted = 0`,
        params: [folder.parentId, timestamp, id],
      },
      {
        sql: `UPDATE folders SET is_deleted = 1, deleted_at = ?, updated_at = ?
              WHERE id = ?`,
        params: [timestamp, timestamp, id],
      },
    ]);

    return deleted.changes > 0;
  }

  /**
   * Delete a folder and all its descendants
   * 条目解除归档与文件夹软删除在同一个事务中执行
   */
  async deleteWithDescendants(id: string): Promise<boolean> {
    const timestamp = now();
    const allFolderIds = [id, ...collectDescendantIds(await this.getAll(), id)];
    const placeholders = allFolderIds.map(() => '?').join(',');

    await databaseService.transaction([
      {
        sql: `UPDATE knowledge_items SET folder_id = NULL, updated_at = ?
              WHERE folder_id IN (${placeholders}) AND is_deleted = 0`,
        params: [timestamp, ...allFolderIds],
      },
      {
        sql: `UPDATE folders SET is_deleted = 1, deleted_at = ?, updated_at = ?
              WHERE id IN (${placeholders})`,
        params: [timestamp, timestamp, ...allFolderIds],
      },
    ]);

    return true;
  }

  /**
   * Move a folder to a new parent
   * 只负责写入；目标是否存在、是否成环等校验由 folderService.moveFolder 完成
   */
  async move(id: string, newParentId: string | null): Promise<boolean> {
    const order = await this.getNextOrder(newParentId);
    return this.update(id, { parentId: newParentId, order });
  }

  /**
   * Reorder folders at the same level
   * 兄弟文件夹的顺序调整与自身顺序在同一个事务中写入
   */
  async reorder(folderId: string, newOrder: number): Promise<boolean> {
    const folder = await this.getById(folderId);
    if (!folder) return false;

    const timestamp = now();
    const movingDown = folder.order < newOrder;
    const siblings = await this.getChildren(folder.parentId);
    const statements: SqlStatement[] = siblings
      .filter(
        (sibling) =>
          sibling.id !== folderId &&
          (movingDown
            ? // 下移：旧位置与新位置之间的兄弟各上移一位
              sibling.order > folder.order && sibling.order <= newOrder
            : // 上移：新位置与旧位置之间的兄弟各下移一位
              sibling.order >= newOrder && sibling.order < folder.order)
      )
      .map((sibling) => ({
        sql: `UPDATE folders SET sort_order = sort_order ${movingDown ? '-' : '+'} 1, updated_at = ?
              WHERE id = ?`,
        params: [timestamp, sibling.id],
      }));

    statements.push({
      sql: `UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ? AND is_deleted = 0`,
      params: [newOrder, timestamp, folderId],
    });

    const results = await databaseService.transaction(statements);
    return results[results.length - 1].changes > 0;
  }
}

// ================================
// Singleton Export
// ================================

export const folderRepository = new FolderRepository();
