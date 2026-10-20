// ================================
// Document Service
// Single responsibility: Business logic only
// No state management, no UI concerns
// ================================

import { databaseService } from '../../services/database';
import { documentRepository } from './repository';
import {
  Document,
  DocumentListItem,
  CreateDocumentInput,
  UpdateDocumentInput,
  documentToListItem,
} from './types';
import { getEditorManager } from '../core';

// ================================
// Service Class
// ================================

class DocumentService {
  private initialized = false;

  /**
   * Initialize the service (ensures database is ready)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await databaseService.initialize();
    this.initialized = true;

    console.log('[DocumentService] Initialized');
  }

  /**
   * Get all documents as list items
   */
  async getDocumentList(): Promise<DocumentListItem[]> {
    await this.initialize();
    return documentRepository.getAll();
  }

  /**
   * Get a single document by ID with full content
   */
  async getDocument(id: string): Promise<Document | null> {
    await this.initialize();
    return documentRepository.getById(id);
  }

  /**
   * Create a new document
   */
  async createDocument(input: CreateDocumentInput = {}): Promise<Document> {
    await this.initialize();

    const document = await documentRepository.create({
      title: input.title ?? '',
      content: input.content ?? '',
      folderId: input.folderId,
    });

    console.log('[DocumentService] Document created:', document.id);

    return document;
  }

  /**
   * Save/update a document
   */
  async saveDocument(id: string, input: UpdateDocumentInput): Promise<Document | null> {
    await this.initialize();

    const success = await documentRepository.update(id, input);

    if (!success) {
      console.error('[DocumentService] Failed to save document:', id);
      return null;
    }

    console.log('[DocumentService] Document saved:', id);

    // Return the updated document
    return documentRepository.getById(id);
  }

  /**
   * Delete a document (soft delete)
   */
  async deleteDocument(id: string): Promise<boolean> {
    await this.initialize();

    // 先销毁托管编辑实例：取消排队中的自动保存，仍挂着该文档的编辑栏不再写入
    getEditorManager().forceDestroy(id);
    const success = await documentRepository.delete(id);

    if (success) {
      console.log('[DocumentService] Document deleted:', id);
    }

    return success;
  }

  /**
   * Search documents
   */
  async searchDocuments(query: string): Promise<DocumentListItem[]> {
    await this.initialize();
    return documentRepository.search(query);
  }

  /**
   * Convert a full document to a list item
   */
  toListItem(doc: Document): DocumentListItem {
    return documentToListItem(doc);
  }
}

// ================================
// Singleton Export
// ================================

export const documentService = new DocumentService();
