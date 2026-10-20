// ================================
// WritingService Unit Tests
// Comprehensive tests for core writing service functionality
// ================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WritingService, createWritingService } from '../writing-service';
import type { IndexableDocument, WritingServiceConfig } from '../types';
import {
  setupGlobalMocks,
  teardownGlobalMocks,
  createMockDocument,
  createMockDocuments,
  wait,
} from './setup';
import { perfBudget } from '@code-reader/test-support';

// ================================
// Test Configuration
// ================================

const createTestConfig = (overrides: Partial<WritingServiceConfig> = {}): WritingServiceConfig => ({
  enableSearchIndex: true,
  enableDiffCache: true,
  enableWorker: false, // Disable worker for unit tests
  enableIndexPersistence: false, // Use memory storage for tests
  diffCacheMaxSize: 100,
  diffCacheTTL: 60000,
  workerThreshold: 1024,
  debug: false,
  ...overrides,
});

// ================================
// Test Suite
// ================================

describe('WritingService', () => {
  beforeEach(() => {
    setupGlobalMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    teardownGlobalMocks();
    vi.useRealTimers();
  });

  // ================================
  // Lifecycle Tests
  // ================================

  describe('Lifecycle', () => {
    it('should create a new instance with default config', () => {
      const service = createWritingService();
      expect(service).toBeInstanceOf(WritingService);
    });

    it('should create a new instance with custom config', () => {
      const config = createTestConfig({ debug: true });
      const service = createWritingService(config);
      expect(service).toBeInstanceOf(WritingService);
    });

    it('should initialize successfully', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      const state = service.getState();
      expect(state.isInitialized).toBe(true);
    });

    it('should not initialize twice', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();
      await service.initialize(); // Second call should be no-op

      const state = service.getState();
      expect(state.isInitialized).toBe(true);
    });

    it('should destroy and cleanup resources', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      service.destroy();

      // State should reset after destroy
      const state = service.getState();
      expect(state.isInitialized).toBe(false);
    });

    it('should emit INITIALIZED event on initialize', async () => {
      const service = createWritingService(createTestConfig());
      const eventHandler = vi.fn();

      service.addEventListener(eventHandler);
      await service.initialize();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INITIALIZED',
          timestamp: expect.any(Number),
        })
      );
    });
  });

  // ================================
  // Event System Tests
  // ================================

  describe('Event System', () => {
    it('should add event listener and receive events', async () => {
      const service = createWritingService(createTestConfig());
      const eventHandler = vi.fn();

      service.addEventListener(eventHandler);
      await service.initialize();

      expect(eventHandler).toHaveBeenCalled();
    });

    it('should remove event listener correctly', async () => {
      const service = createWritingService(createTestConfig());
      const eventHandler = vi.fn();

      const unsubscribe = service.addEventListener(eventHandler);
      unsubscribe();

      await service.initialize();

      // Should not receive events after unsubscribe
      expect(eventHandler).not.toHaveBeenCalled();
    });

    it('should emit DOCUMENT_INDEXED event when indexing', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      const eventHandler = vi.fn();
      service.addEventListener(eventHandler);

      const doc = createMockDocument('test-1');
      await service.indexDocument(doc);

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DOCUMENT_INDEXED',
          data: expect.objectContaining({ documentId: 'test-1' }),
        })
      );
    });

    it('should emit DOCUMENT_REMOVED event when removing', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      const doc = createMockDocument('test-1');
      await service.indexDocument(doc);

      const eventHandler = vi.fn();
      service.addEventListener(eventHandler);

      await service.removeDocument('test-1');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DOCUMENT_REMOVED',
          data: expect.objectContaining({ documentId: 'test-1' }),
        })
      );
    });
  });

  // ================================
  // Index Operations Tests
  // ================================

  describe('Index Operations', () => {
    let service: WritingService;

    beforeEach(async () => {
      service = createWritingService(createTestConfig());
      await service.initialize();
    });

    afterEach(() => {
      service.destroy();
    });

    it('should index a single document', async () => {
      const doc = createMockDocument('doc-1', {
        title: 'Test Document',
        content: 'This is test content for searching.',
      });

      await service.indexDocument(doc);

      const state = service.getState();
      expect(state.indexedDocumentCount).toBe(1);
    });

    it('should index multiple documents', async () => {
      const docs = createMockDocuments(5);
      await service.indexDocuments(docs);

      const state = service.getState();
      expect(state.indexedDocumentCount).toBe(5);
    });

    it('should update indexed document count correctly', async () => {
      const docs = createMockDocuments(3);
      await service.indexDocuments(docs);

      expect(service.getState().indexedDocumentCount).toBe(3);

      await service.indexDocument(createMockDocument('doc-new'));
      expect(service.getState().indexedDocumentCount).toBe(4);
    });

    it('should remove a document from index', async () => {
      const doc = createMockDocument('doc-to-remove');
      await service.indexDocument(doc);
      expect(service.getState().indexedDocumentCount).toBe(1);

      await service.removeDocument('doc-to-remove');
      expect(service.getState().indexedDocumentCount).toBe(0);
    });

    it('should update an existing document', async () => {
      const doc = createMockDocument('doc-1', { content: 'Original content' });
      await service.indexDocument(doc);

      const updatedDoc = createMockDocument('doc-1', { content: 'Updated content' });
      await service.updateDocument(updatedDoc);

      // Count should remain the same
      expect(service.getState().indexedDocumentCount).toBe(1);
    });

    it('should clear all indexed documents', async () => {
      const docs = createMockDocuments(10);
      await service.indexDocuments(docs);
      expect(service.getState().indexedDocumentCount).toBe(10);

      await service.clearIndex();
      expect(service.getState().indexedDocumentCount).toBe(0);
    });

    it('should update lastIndexUpdateAt timestamp', async () => {
      const before = service.getState().lastIndexUpdateAt;

      await wait(10);
      await service.indexDocument(createMockDocument('doc-1'));

      const after = service.getState().lastIndexUpdateAt;
      expect(after).not.toBe(before);
      expect(after).toBeInstanceOf(Date);
    });
  });

  // ================================
  // Search Tests
  // ================================

  describe('Search', () => {
    let service: WritingService;

    beforeEach(async () => {
      service = createWritingService(createTestConfig());
      await service.initialize();

      // Index some test documents
      const docs: IndexableDocument[] = [
        createMockDocument('doc-1', {
          title: 'Introduction to JavaScript',
          content: 'JavaScript is a programming language used for web development.',
        }),
        createMockDocument('doc-2', {
          title: 'Python Basics',
          content: 'Python is a popular programming language for data science.',
        }),
        createMockDocument('doc-3', {
          title: 'Web Development Guide',
          content: 'Learn HTML, CSS, and JavaScript for web development.',
        }),
        createMockDocument('doc-4', {
          title: 'Data Science with Python',
          content: 'Use Python for machine learning and data analysis.',
        }),
      ];
      await service.indexDocuments(docs);
    });

    afterEach(() => {
      service.destroy();
    });

    it('should search documents by content', async () => {
      const results = await service.search('programming language');

      expect(results.length).toBeGreaterThan(0);
    });

    it('should search documents by title', async () => {
      const results = await service.search('JavaScript');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.documentId === 'doc-1')).toBe(true);
    });

    it('should return empty array for no matches', async () => {
      const results = await service.search('nonexistent term xyz123');

      expect(results).toEqual([]);
    });

    it('should respect limit option', async () => {
      const results = await service.search('web', { limit: 1 });

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should include highlights when enabled', async () => {
      const results = await service.search('JavaScript', { highlight: true });

      expect(results.length).toBeGreaterThan(0);
      // Results should have highlights array
      results.forEach((result) => {
        expect(result).toHaveProperty('highlights');
      });
    });

    it('should include snippet in results', async () => {
      const results = await service.search('Python');

      results.forEach((result) => {
        expect(result).toHaveProperty('snippet');
        expect(typeof result.snippet).toBe('string');
      });
    });

    it('should return results with scores', async () => {
      const results = await service.search('web development');

      results.forEach((result) => {
        expect(result).toHaveProperty('score');
        expect(typeof result.score).toBe('number');
        expect(result.score).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ================================
  // Suggestion Tests
  // ================================

  describe('Suggestions', () => {
    let service: WritingService;

    beforeEach(async () => {
      service = createWritingService(createTestConfig());
      await service.initialize();

      const docs = createMockDocuments(5, (i) => ({
        title: `Document ${i + 1}`,
        content: `Content about topic ${i + 1} with various keywords.`,
      }));
      await service.indexDocuments(docs);
    });

    afterEach(() => {
      service.destroy();
    });

    it('should return suggestions for prefix', async () => {
      const suggestions = await service.suggest('Doc');

      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should return suggestions with correct structure', async () => {
      const suggestions = await service.suggest('top');

      suggestions.forEach((suggestion) => {
        expect(suggestion).toHaveProperty('text');
        expect(suggestion).toHaveProperty('type');
        expect(suggestion).toHaveProperty('score');
      });
    });

    it('should respect limit option', async () => {
      const suggestions = await service.suggest('a', { limit: 3 });

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });

    it('should return empty array for empty prefix', async () => {
      const suggestions = await service.suggest('');

      expect(suggestions).toEqual([]);
    });
  });

  // ================================
  // Diff Computation Tests
  // ================================

  describe('Diff Computation', () => {
    let service: WritingService;

    beforeEach(async () => {
      service = createWritingService(createTestConfig());
      await service.initialize();
    });

    afterEach(() => {
      service.destroy();
    });

    it('should compute diff between two strings', async () => {
      const source = 'Hello World';
      const target = 'Hello World!';

      const result = await service.computeDiff(source, target);

      expect(result).toHaveProperty('diffs');
      expect(result).toHaveProperty('sourceLength');
      expect(result).toHaveProperty('targetLength');
      expect(result.sourceLength).toBe(source.length);
      expect(result.targetLength).toBe(target.length);
    });

    it('should return identical diff for same strings', async () => {
      const text = 'Same text content';
      const result = await service.computeDiff(text, text);

      expect(result.diffs.length).toBeGreaterThan(0);
      // All diffs should be equal (0)
      result.diffs.forEach((diff) => {
        expect(diff[0]).toBe(0); // DIFF_EQUAL
      });
    });

    it('should compute diff stats', async () => {
      const source = 'Hello World';
      const target = 'Hello there World';

      const stats = await service.computeDiffStats(source, target);

      expect(stats).toHaveProperty('insertions');
      expect(stats).toHaveProperty('deletions');
      expect(stats).toHaveProperty('unchanged');
      expect(typeof stats.insertions).toBe('number');
      expect(typeof stats.deletions).toBe('number');
      expect(typeof stats.unchanged).toBe('number');
    });

    it('should determine if incremental save should be used', async () => {
      const source = 'Short text';
      const target = 'Short text with small change';

      const shouldUseIncremental = await service.shouldUseIncremental(source, target);

      expect(typeof shouldUseIncremental).toBe('boolean');
    });

    it('should use cache for repeated diff computations', async () => {
      const source = 'Cached source';
      const target = 'Cached target';

      // First computation
      await service.computeDiff(source, target, { useCache: true });
      const statsAfterFirst = service.getState();

      // Second computation (should hit cache)
      await service.computeDiff(source, target, { useCache: true });
      const statsAfterSecond = service.getState();

      // Cache hits should increase
      expect(statsAfterSecond.cacheHits).toBeGreaterThan(statsAfterFirst.cacheHits);
    });

    it('should handle empty strings', async () => {
      const result = await service.computeDiff('', 'New content');

      expect(result).toHaveProperty('diffs');
      expect(result.sourceLength).toBe(0);
      expect(result.targetLength).toBe('New content'.length);
    });

    it('should handle large strings efficiently', async () => {
      const source = 'a'.repeat(10000);
      const target = 'a'.repeat(9990) + 'b'.repeat(10);

      const startTime = Date.now();
      const result = await service.computeDiff(source, target);
      const duration = Date.now() - startTime;

      expect(result).toHaveProperty('diffs');
      expect(duration).toBeLessThan(perfBudget(5000));
    });
  });

  // ================================
  // Cache Tests
  // ================================

  describe('Diff Cache', () => {
    let service: WritingService;

    beforeEach(async () => {
      service = createWritingService(
        createTestConfig({
          enableDiffCache: true,
          diffCacheMaxSize: 10,
          diffCacheTTL: 60000,
        })
      );
      await service.initialize();
    });

    afterEach(() => {
      service.destroy();
    });

    it('should return cache stats', () => {
      const stats = service.getDiffCacheStats();

      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('size');
    });

    it('should track cache misses', async () => {
      await service.computeDiff('a', 'b', { useCache: true });

      const stats = service.getDiffCacheStats();
      expect(stats.misses).toBeGreaterThan(0);
    });

    it('should track cache hits on repeated calls', async () => {
      await service.computeDiff('cached', 'value', { useCache: true });
      await service.computeDiff('cached', 'value', { useCache: true });

      const stats = service.getDiffCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should clear cache', async () => {
      await service.computeDiff('test', 'data', { useCache: true });

      service.clearDiffCache();

      const stats = service.getDiffCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should bypass cache when useCache is false', async () => {
      await service.computeDiff('source', 'target', { useCache: true });
      const statsAfterFirst = service.getDiffCacheStats();

      await service.computeDiff('source', 'target', { useCache: false });
      const statsAfterSecond = service.getDiffCacheStats();

      // Hits should not increase when cache is bypassed
      expect(statsAfterSecond.hits).toBe(statsAfterFirst.hits);
    });
  });

  // ================================
  // Persistence Tests
  // ================================

  describe('Index Persistence', () => {
    it('should persist index data', async () => {
      const service = createWritingService(
        createTestConfig({
          enableIndexPersistence: true,
        })
      );
      await service.initialize();

      await service.indexDocument(createMockDocument('persist-test'));
      await service.persistIndex();

      const state = service.getState();
      expect(state.lastPersistAt).toBeInstanceOf(Date);

      service.destroy();
    });

    it('should emit INDEX_PERSISTED event', async () => {
      const service = createWritingService(
        createTestConfig({
          enableIndexPersistence: true,
        })
      );
      await service.initialize();

      const eventHandler = vi.fn();
      service.addEventListener(eventHandler);

      await service.indexDocument(createMockDocument('doc-1'));
      await service.persistIndex();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INDEX_PERSISTED',
        })
      );

      service.destroy();
    });

    it('should load persisted index', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      const loaded = await service.loadIndex();

      // Loading returns boolean indicating success
      expect(typeof loaded).toBe('boolean');

      service.destroy();
    });
  });

  // ================================
  // State Management Tests
  // ================================

  describe('State Management', () => {
    it('should return current state', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      const state = service.getState();

      expect(state).toHaveProperty('isInitialized');
      expect(state).toHaveProperty('indexedDocumentCount');
      expect(state).toHaveProperty('cacheHits');
      expect(state).toHaveProperty('cacheMisses');
      expect(state).toHaveProperty('isWorkerReady');
      expect(state).toHaveProperty('lastIndexUpdateAt');
      expect(state).toHaveProperty('lastPersistAt');

      service.destroy();
    });

    it('should have correct initial state', () => {
      const service = createWritingService(createTestConfig());
      const state = service.getState();

      expect(state.isInitialized).toBe(false);
      expect(state.indexedDocumentCount).toBe(0);
      expect(state.cacheHits).toBe(0);
      expect(state.cacheMisses).toBe(0);
    });

    it('should update state after operations', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      const initialState = service.getState();
      expect(initialState.isInitialized).toBe(true);

      await service.indexDocument(createMockDocument('doc-1'));
      const afterIndex = service.getState();
      expect(afterIndex.indexedDocumentCount).toBe(1);

      service.destroy();
    });
  });

  // ================================
  // Error Handling Tests
  // ================================

  describe('Error Handling', () => {
    it('should throw when operating before initialization', async () => {
      const service = createWritingService(createTestConfig());

      await expect(service.indexDocument(createMockDocument('doc-1'))).rejects.toThrow();
    });

    it('should throw when searching before initialization', async () => {
      const service = createWritingService(createTestConfig());

      await expect(service.search('test')).rejects.toThrow();
    });

    it('should handle null/undefined content gracefully', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      const doc = {
        id: 'doc-1',
        title: 'Test',
        content: '',
      };

      // Should not throw
      await expect(service.indexDocument(doc)).resolves.not.toThrow();

      service.destroy();
    });
  });

  // ================================
  // Integration Tests
  // ================================

  describe('Integration', () => {
    it('should handle full workflow: index, search, diff', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      // Index documents
      const docs = [
        createMockDocument('doc-1', { title: 'First', content: 'Original content here' }),
        createMockDocument('doc-2', { title: 'Second', content: 'Another document' }),
      ];
      await service.indexDocuments(docs);

      // Search
      const searchResults = await service.search('content');
      expect(searchResults.length).toBeGreaterThan(0);

      // Compute diff
      const diffResult = await service.computeDiff(
        'Original content here',
        'Modified content here'
      );
      expect(diffResult.diffs.length).toBeGreaterThan(0);

      // Verify state
      const state = service.getState();
      expect(state.indexedDocumentCount).toBe(2);

      service.destroy();
    });

    it('should handle concurrent operations', async () => {
      const service = createWritingService(createTestConfig());
      await service.initialize();

      // Run multiple operations concurrently
      const operations = [
        service.indexDocument(createMockDocument('doc-1')),
        service.indexDocument(createMockDocument('doc-2')),
        service.indexDocument(createMockDocument('doc-3')),
        service.computeDiff('a', 'b'),
        service.computeDiff('c', 'd'),
      ];

      await expect(Promise.all(operations)).resolves.not.toThrow();

      const state = service.getState();
      expect(state.indexedDocumentCount).toBe(3);

      service.destroy();
    });
  });
});
