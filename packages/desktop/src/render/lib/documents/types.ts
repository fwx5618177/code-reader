// ================================
// Document Types
// Single responsibility: Type definitions only
// ================================

import { DocumentTypeId, getFileTypeId } from './file-types';

/**
 * Full document entity with all fields
 */
export interface Document {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  isFavorite: boolean;
  isPinned: boolean;
  folderId?: string;
}

/**
 * Lightweight document item for list display
 */
export interface DocumentListItem {
  id: string;
  title: string;
  updatedAt: Date;
  isFavorite: boolean;
  isPinned: boolean;
  folderId?: string;
}

/**
 * Input for creating a new document
 */
export interface CreateDocumentInput {
  title?: string;
  content?: string;
  folderId?: string;
}

/**
 * Input for updating an existing document
 */
export interface UpdateDocumentInput {
  title?: string;
  content?: string;
  folderId?: string;
  isFavorite?: boolean;
  isPinned?: boolean;
}

/**
 * Database row type for knowledge_items table
 */
export interface DocumentRow {
  id: string;
  title: string;
  content: string;
  type: string;
  status: string;
  folder_id: string | null;
  is_favorite: number;
  is_pinned: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for list queries (minimal fields)
 */
export interface DocumentListRow {
  id: string;
  title: string;
  updated_at: string;
  is_favorite: number;
  is_pinned: number;
  folder_id: string | null;
}

/**
 * Convert database row to Document entity
 */
export function rowToDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    title: row.title || '',
    content: row.content || '',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    isFavorite: row.is_favorite === 1,
    isPinned: row.is_pinned === 1,
    folderId: row.folder_id || undefined,
  };
}

/**
 * Convert database row to DocumentListItem
 */
export function rowToListItem(row: DocumentListRow): DocumentListItem {
  return {
    id: row.id,
    title: row.title || '无标题',
    updatedAt: new Date(row.updated_at),
    isFavorite: row.is_favorite === 1,
    isPinned: row.is_pinned === 1,
    folderId: row.folder_id || undefined,
  };
}

/**
 * Convert Document to DocumentListItem
 */
export function documentToListItem(doc: Document): DocumentListItem {
  return {
    id: doc.id,
    title: doc.title || '无标题',
    updatedAt: doc.updatedAt,
    isFavorite: doc.isFavorite,
    isPinned: doc.isPinned,
    folderId: doc.folderId,
  };
}

/**
 * 根据文档标题推断文件类型
 * @param title 文档标题（可能包含扩展名）
 * @returns 文件类型 ID
 */
export function inferDocumentFileType(title: string): DocumentTypeId {
  return getFileTypeId(title);
}
