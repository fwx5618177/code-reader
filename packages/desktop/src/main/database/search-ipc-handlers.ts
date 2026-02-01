// ================================
// Semantic Search IPC Handlers
// Bridge between renderer and semantic search service
// ================================

import { ipcMain } from 'electron';
import {
  getSemanticSearchService,
  type SemanticSearchOptions,
  type SemanticSearchResult,
  type HybridSearchResult,
} from './semantic-search';

/**
 * Register all semantic search IPC handlers
 */
export function registerSearchHandlers(): void {
  const searchService = getSemanticSearchService();

  // ================================
  // Semantic Search Handlers
  // ================================

  /**
   * Semantic search
   */
  ipcMain.handle(
    'search:semantic',
    async (
      _event,
      query: string,
      options?: SemanticSearchOptions
    ): Promise<SemanticSearchResult[]> => {
      try {
        return await searchService.search(query, options);
      } catch (error) {
        console.error('[Search:IPC] Semantic search error:', error);
        throw error;
      }
    }
  );

  /**
   * Find similar items
   */
  ipcMain.handle(
    'search:findSimilar',
    async (
      _event,
      itemId: string,
      options?: SemanticSearchOptions
    ): Promise<SemanticSearchResult[]> => {
      try {
        return await searchService.findSimilar(itemId, options);
      } catch (error) {
        console.error('[Search:IPC] Find similar error:', error);
        throw error;
      }
    }
  );

  /**
   * Hybrid search (semantic + FTS)
   */
  ipcMain.handle(
    'search:hybrid',
    async (
      _event,
      query: string,
      options?: SemanticSearchOptions & { semanticWeight?: number }
    ): Promise<HybridSearchResult[]> => {
      try {
        return await searchService.hybridSearch(query, options);
      } catch (error) {
        console.error('[Search:IPC] Hybrid search error:', error);
        throw error;
      }
    }
  );

  /**
   * Clear search cache
   */
  ipcMain.handle('search:clearCache', async () => {
    try {
      searchService.clearCache();
      return { success: true };
    } catch (error) {
      console.error('[Search:IPC] Clear cache error:', error);
      throw error;
    }
  });

  console.log('[Search:IPC] Search handlers registered');
}

/**
 * Cleanup search handlers
 */
export function cleanupSearchHandlers(): void {
  const handlers = [
    'search:semantic',
    'search:findSimilar',
    'search:hybrid',
    'search:clearCache',
  ];

  handlers.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  console.log('[Search:IPC] Search handlers cleaned up');
}

export default registerSearchHandlers;
