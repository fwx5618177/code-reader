// ================================
// Semantic Search Service
// Vector similarity search for knowledge items
// ================================

import { getSQLiteService } from './sqlite';
import { getAIService } from '../ai/ai-service';

// ================================
// Types
// ================================

export interface SemanticSearchResult {
  itemId: string;
  title: string;
  type: string;
  similarity: number;
  snippet?: string;
  createdAt: string;
}

export interface SemanticSearchOptions {
  /** Maximum number of results */
  limit?: number;
  /** Minimum similarity threshold (0-1) */
  threshold?: number;
  /** Filter by item types */
  types?: string[];
  /** Filter by folder ID */
  folderId?: string;
  /** Filter by project ID */
  projectId?: string;
  /** Include deleted items */
  includeDeleted?: boolean;
}

export interface HybridSearchResult extends SemanticSearchResult {
  /** FTS score if available */
  ftsScore?: number;
  /** Combined score (semantic + FTS) */
  combinedScore: number;
}

// ================================
// Semantic Search Service
// ================================

export class SemanticSearchService {
  private embeddingCache: Map<string, Float32Array> = new Map();
  private cacheMaxSize = 100;

  // ================================
  // Semantic Search
  // ================================

  /**
   * Search using semantic similarity
   */
  async search(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResult[]> {
    const aiService = getAIService();
    const sqlite = getSQLiteService();

    const limit = options?.limit ?? 20;
    const threshold = options?.threshold ?? 0.5;

    try {
      // Generate query embedding
      const embeddingResponse = await aiService.createEmbeddings({
        input: query,
      });

      const queryVector = new Float32Array(embeddingResponse.embeddings[0]);

      // Get all embeddings from database
      let sql = `
        SELECT
          e.item_id,
          e.vector,
          ki.title,
          ki.type,
          ki.summary,
          ki.content,
          ki.created_at
        FROM embeddings e
        INNER JOIN knowledge_items ki ON e.item_id = ki.id
        WHERE 1=1
      `;

      const params: unknown[] = [];

      if (!options?.includeDeleted) {
        sql += ` AND ki.is_deleted = 0`;
      }

      if (options?.types && options.types.length > 0) {
        sql += ` AND ki.type IN (${options.types.map(() => '?').join(', ')})`;
        params.push(...options.types);
      }

      if (options?.folderId) {
        sql += ` AND ki.folder_id = ?`;
        params.push(options.folderId);
      }

      if (options?.projectId) {
        sql += ` AND ki.project_id = ?`;
        params.push(options.projectId);
      }

      const rows = sqlite.all<{
        item_id: string;
        vector: Buffer;
        title: string;
        type: string;
        summary: string | null;
        content: string | null;
        created_at: string;
      }>(sql, params);

      // Calculate similarities
      const results: SemanticSearchResult[] = [];

      for (const row of rows) {
        const itemVector = new Float32Array(row.vector.buffer);
        const similarity = this.cosineSimilarity(queryVector, itemVector);

        if (similarity >= threshold) {
          results.push({
            itemId: row.item_id,
            title: row.title,
            type: row.type,
            similarity,
            snippet: this.generateSnippet(row.summary || row.content, query),
            createdAt: row.created_at,
          });
        }
      }

      // Sort by similarity and limit
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, limit);
    } catch (error) {
      console.error('[SemanticSearch] Search error:', error);
      throw error;
    }
  }

  /**
   * Find items similar to a given item
   */
  async findSimilar(
    itemId: string,
    options?: SemanticSearchOptions
  ): Promise<SemanticSearchResult[]> {
    const sqlite = getSQLiteService();

    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0.6;

    try {
      // Get source embedding
      const sourceEmbedding = sqlite.get<{ vector: Buffer }>(
        `SELECT vector FROM embeddings WHERE item_id = ?`,
        [itemId]
      );

      if (!sourceEmbedding) {
        return [];
      }

      const sourceVector = new Float32Array(sourceEmbedding.vector.buffer);

      // Get all other embeddings
      let sql = `
        SELECT
          e.item_id,
          e.vector,
          ki.title,
          ki.type,
          ki.summary,
          ki.content,
          ki.created_at
        FROM embeddings e
        INNER JOIN knowledge_items ki ON e.item_id = ki.id
        WHERE e.item_id != ?
      `;

      const params: unknown[] = [itemId];

      if (!options?.includeDeleted) {
        sql += ` AND ki.is_deleted = 0`;
      }

      if (options?.types && options.types.length > 0) {
        sql += ` AND ki.type IN (${options.types.map(() => '?').join(', ')})`;
        params.push(...options.types);
      }

      const rows = sqlite.all<{
        item_id: string;
        vector: Buffer;
        title: string;
        type: string;
        summary: string | null;
        content: string | null;
        created_at: string;
      }>(sql, params);

      // Calculate similarities
      const results: SemanticSearchResult[] = [];

      for (const row of rows) {
        const itemVector = new Float32Array(row.vector.buffer);
        const similarity = this.cosineSimilarity(sourceVector, itemVector);

        if (similarity >= threshold) {
          results.push({
            itemId: row.item_id,
            title: row.title,
            type: row.type,
            similarity,
            snippet: row.summary || undefined,
            createdAt: row.created_at,
          });
        }
      }

      // Sort by similarity and limit
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, limit);
    } catch (error) {
      console.error('[SemanticSearch] Find similar error:', error);
      throw error;
    }
  }

  // ================================
  // Hybrid Search (Semantic + FTS)
  // ================================

  /**
   * Hybrid search combining semantic and full-text search
   */
  async hybridSearch(
    query: string,
    options?: SemanticSearchOptions & { semanticWeight?: number }
  ): Promise<HybridSearchResult[]> {
    const sqlite = getSQLiteService();
    const limit = options?.limit ?? 20;
    const semanticWeight = options?.semanticWeight ?? 0.7; // 70% semantic, 30% FTS

    try {
      // Get semantic results
      const semanticResults = await this.search(query, {
        ...options,
        limit: limit * 2, // Get more for better mixing
        threshold: 0.3, // Lower threshold for hybrid
      });

      // Get FTS results
      const ftsResults = sqlite.search(query, {
        types: options?.types,
        limit: limit * 2,
      });

      // Merge results
      const resultMap = new Map<string, HybridSearchResult>();

      // Add semantic results
      for (const result of semanticResults) {
        resultMap.set(result.itemId, {
          ...result,
          combinedScore: result.similarity * semanticWeight,
        });
      }

      // Merge FTS results
      const maxFtsRank = Math.max(...ftsResults.map((r) => Math.abs(r.rank)), 1);

      for (const ftsResult of ftsResults) {
        const normalizedFtsScore = 1 - Math.abs(ftsResult.rank) / maxFtsRank; // Normalize to 0-1
        const ftsWeight = 1 - semanticWeight;

        if (resultMap.has(ftsResult.id)) {
          // Merge with existing semantic result
          const existing = resultMap.get(ftsResult.id)!;
          existing.ftsScore = normalizedFtsScore;
          existing.combinedScore += normalizedFtsScore * ftsWeight;
          if (ftsResult.snippet) {
            existing.snippet = ftsResult.snippet;
          }
        } else {
          // Add new FTS-only result
          resultMap.set(ftsResult.id, {
            itemId: ftsResult.id,
            title: ftsResult.title || '',
            type: ftsResult.type || 'note',
            similarity: 0,
            ftsScore: normalizedFtsScore,
            combinedScore: normalizedFtsScore * ftsWeight,
            snippet: ftsResult.snippet,
            createdAt: '',
          });
        }
      }

      // Sort by combined score and limit
      const results = Array.from(resultMap.values());
      results.sort((a, b) => b.combinedScore - a.combinedScore);

      return results.slice(0, limit);
    } catch (error) {
      console.error('[SemanticSearch] Hybrid search error:', error);
      // Fallback to FTS only
      const ftsResults = sqlite.search(query, {
        types: options?.types,
        limit,
      });

      return ftsResults.map((r) => ({
        itemId: r.id,
        title: r.title || '',
        type: r.type || 'note',
        similarity: 0,
        ftsScore: 1,
        combinedScore: 1,
        snippet: r.snippet,
        createdAt: '',
      }));
    }
  }

  // ================================
  // Utilities
  // ================================

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Generate a snippet from content containing the query
   */
  private generateSnippet(
    content: string | null | undefined,
    query: string,
    maxLength: number = 200
  ): string | undefined {
    if (!content) return undefined;

    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Find query position
    const queryPos = lowerContent.indexOf(lowerQuery);

    if (queryPos >= 0) {
      // Extract around the query
      const start = Math.max(0, queryPos - 50);
      const end = Math.min(content.length, queryPos + query.length + 150);

      let snippet = content.slice(start, end);

      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';

      return snippet;
    }

    // Return start of content
    if (content.length > maxLength) {
      return content.slice(0, maxLength) + '...';
    }

    return content;
  }

  /**
   * Cache an embedding for quick access
   */
  cacheEmbedding(itemId: string, vector: Float32Array): void {
    // Remove oldest entries if cache is full
    if (this.embeddingCache.size >= this.cacheMaxSize) {
      const firstKey = this.embeddingCache.keys().next().value;
      if (firstKey) {
        this.embeddingCache.delete(firstKey);
      }
    }

    this.embeddingCache.set(itemId, vector);
  }

  /**
   * Get cached embedding
   */
  getCachedEmbedding(itemId: string): Float32Array | undefined {
    return this.embeddingCache.get(itemId);
  }

  /**
   * Clear embedding cache
   */
  clearCache(): void {
    this.embeddingCache.clear();
  }
}

// ================================
// Singleton Export
// ================================

let semanticSearchService: SemanticSearchService | null = null;

export function getSemanticSearchService(): SemanticSearchService {
  if (!semanticSearchService) {
    semanticSearchService = new SemanticSearchService();
  }
  return semanticSearchService;
}

export default getSemanticSearchService;
