// ================================
// Document Repository
// Single responsibility: Database operations only
// No business logic, no state management
// ================================

import { databaseService, now } from '../../services/database';
import { generateDocumentId } from '../utils';
import {
  Document,
  DocumentListItem,
  DocumentRow,
  DocumentListRow,
  CreateDocumentInput,
  UpdateDocumentInput,
  rowToDocument,
  rowToListItem,
} from './types';
import { DOCUMENT_TYPE, DOCUMENT_STATUS } from './constants';

// ================================
// Repository Class
// ================================

class DocumentRepository {
  /**
   * Get all documents as list items (sorted by pinned, then updated)
   */
  async getAll(): Promise<DocumentListItem[]> {
    const rows = await databaseService.all<DocumentListRow>(
      `SELECT id, title, updated_at, is_favorite, is_pinned, folder_id
       FROM knowledge_items
       WHERE type = ? AND is_deleted = 0
       ORDER BY is_pinned DESC, updated_at DESC`,
      [DOCUMENT_TYPE]
    );

    return rows.map(rowToListItem);
  }

  /**
   * Get a single document by ID with full content
   */
  async getById(id: string): Promise<Document | null> {
    const row = await databaseService.get<DocumentRow>(
      `SELECT id, title, content, type, status, folder_id,
              is_favorite, is_pinned, is_deleted, created_at, updated_at
       FROM knowledge_items
       WHERE id = ? AND type = ? AND is_deleted = 0`,
      [id, DOCUMENT_TYPE]
    );

    if (!row) return null;
    return rowToDocument(row);
  }

  /**
   * Check if a document with the given title exists
   */
  async existsByTitle(title: string): Promise<boolean> {
    const row = await databaseService.get<{ id: string }>(
      `SELECT id FROM knowledge_items
       WHERE title = ? AND type = ? AND is_deleted = 0
       LIMIT 1`,
      [title, DOCUMENT_TYPE]
    );

    return row !== undefined;
  }

  /**
   * Create a new document
   */
  async create(input: CreateDocumentInput): Promise<Document> {
    const title = input.title ?? '';
    const content = input.content ?? '';
    const id = generateDocumentId(content);
    const timestamp = now();

    await databaseService.run(
      `INSERT INTO knowledge_items
       (id, title, content, type, status, folder_id, created_at, updated_at, is_favorite, is_pinned, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
      [
        id,
        title,
        content,
        DOCUMENT_TYPE,
        DOCUMENT_STATUS,
        input.folderId || null,
        timestamp,
        timestamp,
      ]
    );

    return {
      id,
      title,
      content,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      isFavorite: false,
      isPinned: false,
      folderId: input.folderId,
    };
  }

  /**
   * Update an existing document
   */
  async update(id: string, input: UpdateDocumentInput): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      params.push(input.title);
    }

    if (input.content !== undefined) {
      updates.push('content = ?');
      params.push(input.content);
    }

    if (input.folderId !== undefined) {
      updates.push('folder_id = ?');
      params.push(input.folderId || null);
    }

    if (input.isFavorite !== undefined) {
      updates.push('is_favorite = ?');
      params.push(input.isFavorite ? 1 : 0);
    }

    if (input.isPinned !== undefined) {
      updates.push('is_pinned = ?');
      params.push(input.isPinned ? 1 : 0);
    }

    if (updates.length === 0) {
      return true; // Nothing to update
    }

    // Always update timestamp
    updates.push('updated_at = ?');
    params.push(now());

    // Add WHERE clause params
    params.push(id);
    params.push(DOCUMENT_TYPE);

    // 已删除的文档不再接受写入（删除前排队的自动保存不会把它写回）
    const result = await databaseService.run(
      `UPDATE knowledge_items SET ${updates.join(', ')} WHERE id = ? AND type = ? AND is_deleted = 0`,
      params
    );

    return result.changes > 0;
  }

  /**
   * Soft delete a document
   */
  async delete(id: string): Promise<boolean> {
    const result = await databaseService.run(
      `UPDATE knowledge_items SET is_deleted = 1, deleted_at = ? WHERE id = ? AND type = ?`,
      [now(), id, DOCUMENT_TYPE]
    );

    return result.changes > 0;
  }

  /**
   * Search documents by title or content
   */
  async search(query: string): Promise<DocumentListItem[]> {
    if (!query.trim()) {
      return this.getAll();
    }

    const searchPattern = `%${query}%`;
    const rows = await databaseService.all<DocumentListRow>(
      `SELECT id, title, updated_at, is_favorite, is_pinned, folder_id
       FROM knowledge_items
       WHERE type = ? AND is_deleted = 0
         AND (title LIKE ? OR content LIKE ?)
       ORDER BY is_pinned DESC, updated_at DESC`,
      [DOCUMENT_TYPE, searchPattern, searchPattern]
    );

    return rows.map(rowToListItem);
  }
}

// ================================
// Singleton Export
// ================================

export const documentRepository = new DocumentRepository();
