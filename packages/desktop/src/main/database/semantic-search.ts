// ================================
// Semantic Search Service
// Vector similarity search for knowledge items
// ================================

import { getSQLiteService } from './sqlite';
import { getAIService } from '../ai/ai-service';
import { bestChunkScores, decodeEmbedding, meanEmbedding } from './embedding-vector';

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

/** 向量打分后入选的条目及其得分 */
interface RankedItem {
  item: {
    id: string;
    title: string;
    type: string;
    summary: string | null;
    content: string | null;
    created_at: string;
  };
  similarity: number;
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
    try {
      // Generate query embedding
      const embeddingResponse = await getAIService().createEmbeddings({
        input: query,
      });
      const queryVector = new Float32Array(embeddingResponse.embeddings[0]);

      const ranked = this.rankItems(queryVector, null, {
        ...options,
        limit: options?.limit ?? 20,
        threshold: options?.threshold ?? 0.5,
      });
      return ranked.map(({ item, similarity }) => ({
        itemId: item.id,
        title: item.title,
        type: item.type,
        similarity,
        snippet: this.generateSnippet(item.summary || item.content, query),
        createdAt: item.created_at,
      }));
    } catch (error) {
      console.error('[SemanticSearch] Search error:', error);
      throw error;
    }
  }

  /**
   * Find items similar to a given item
   * 源条目以其各分段向量的均值作为整篇的代表向量，目标条目按最相近的一段打分
   */
  async findSimilar(
    itemId: string,
    options?: SemanticSearchOptions
  ): Promise<SemanticSearchResult[]> {
    try {
      const sourceChunks = getSQLiteService().all<{ vector: Buffer }>(
        `SELECT vector FROM item_embedding_chunks WHERE item_id = ?`,
        [itemId]
      );
      if (sourceChunks.length === 0) {
        return [];
      }
      const sourceVector = meanEmbedding(sourceChunks.map((chunk) => decodeEmbedding(chunk.vector)));

      const ranked = this.rankItems(sourceVector, itemId, {
        ...options,
        limit: options?.limit ?? 10,
        threshold: options?.threshold ?? 0.6,
      });
      return ranked.map(({ item, similarity }) => ({
        itemId: item.id,
        title: item.title,
        type: item.type,
        similarity,
        snippet: item.summary || undefined,
        createdAt: item.created_at,
      }));
    } catch (error) {
      console.error('[SemanticSearch] Find similar error:', error);
      throw error;
    }
  }

  /**
   * 按分段向量为条目打分（每个条目取最相近的一段），过滤阈值、排序并截取前 limit 个；
   * 逐段扫描时只读取向量，条目元数据与正文只为最终入选的条目读取
   */
  private rankItems(
    queryVector: Float32Array,
    excludeItemId: string | null,
    options: SemanticSearchOptions & { limit: number; threshold: number }
  ): RankedItem[] {
    const sqlite = getSQLiteService();

    let sql = `
      SELECT c.item_id, c.vector
      FROM item_embedding_chunks c
      INNER JOIN knowledge_items ki ON c.item_id = ki.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (excludeItemId !== null) {
      sql += ` AND c.item_id != ?`;
      params.push(excludeItemId);
    }

    if (!options.includeDeleted) {
      sql += ` AND ki.is_deleted = 0`;
    }

    if (options.types && options.types.length > 0) {
      sql += ` AND ki.type IN (${options.types.map(() => '?').join(', ')})`;
      params.push(...options.types);
    }

    if (options.folderId) {
      sql += ` AND ki.folder_id = ?`;
      params.push(options.folderId);
    }

    if (options.projectId) {
      sql += ` AND ki.project_id = ?`;
      params.push(options.projectId);
    }

    const scores = bestChunkScores(queryVector, sqlite.all<{ item_id: string; vector: Buffer }>(sql, params));
    const top = Array.from(scores)
      .filter(([, similarity]) => similarity >= options.threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, options.limit);
    if (top.length === 0) {
      return [];
    }

    const items = sqlite.all<RankedItem['item']>(
      `SELECT id, title, type, summary, content, created_at FROM knowledge_items
       WHERE id IN (${top.map(() => '?').join(', ')})`,
      top.map(([id]) => id)
    );
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return top.flatMap(([id, similarity]) => {
      const item = itemsById.get(id);
      return item ? [{ item, similarity }] : [];
    });
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
      // 全文结果已按相关度排序（bm25 越小越相关；短词回退的 LIKE 扫描 rank 恒为 0 但顺序有意义），
      // 因此按名次归一化：第一名为 1，依次递减
      const ftsWeight = 1 - semanticWeight;

      ftsResults.forEach((ftsResult, position) => {
        const normalizedFtsScore = 1 - position / ftsResults.length;

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
      });

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
