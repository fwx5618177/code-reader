// ================================
// IndexStorage Unit Tests
// Tests for IndexedDB and Memory storage implementations
// ================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  IndexStorage,
  createIndexStorage,
  createMemoryIndexStorage,
  getDefaultIndexStorage,
  closeDefaultIndexStorage,
} from '../index-storage';
import { setupGlobalMocks, teardownGlobalMocks } from './setup';

// ================================
// Test Suite: IndexStorage (IndexedDB)
// ================================

describe('IndexStorage (IndexedDB)', () => {
  beforeEach(() => {
    setupGlobalMocks();
  });

  afterEach(() => {
    teardownGlobalMocks();
    closeDefaultIndexStorage();
  });

  // ================================
  // Factory Tests
  // ================================

  describe('Factory Functions', () => {
    it('should create a new IndexStorage instance', () => {
      const storage = createIndexStorage();
      expect(storage).toBeInstanceOf(IndexStorage);
    });

    it('should create IndexStorage with custom config', () => {
      const storage = createIndexStorage({
        dbName: 'custom-db',
        dbVersion: 2,
        debug: true,
      });
      expect(storage).toBeInstanceOf(IndexStorage);
    });

    it('should return singleton from getDefaultIndexStorage', () => {
      const storage1 = getDefaultIndexStorage();
      const storage2 = getDefaultIndexStorage();
      expect(storage1).toBe(storage2);
    });

    it('should create new instance after closeDefaultIndexStorage', () => {
      const storage1 = getDefaultIndexStorage();
      closeDefaultIndexStorage();
      const storage2 = getDefaultIndexStorage();
      expect(storage1).not.toBe(storage2);
    });
  });

  // ================================
  // CRUD Operations Tests
  // ================================

  describe('CRUD Operations', () => {
    let storage: IndexStorage;

    beforeEach(() => {
      storage = createIndexStorage({ dbName: 'test-db', debug: false });
    });

    afterEach(async () => {
      try {
        await storage.deleteDatabase();
      } catch {
        // Ignore errors during cleanup
      }
    });

    it('should save data with a key', async () => {
      await expect(storage.save('test-key', { data: 'value' })).resolves.not.toThrow();
    });

    it('should load saved data', async () => {
      const testData = { name: 'test', value: 42, nested: { array: [1, 2, 3] } };

      await storage.save('my-key', testData);
      const loaded = await storage.load('my-key');

      expect(loaded).toEqual(testData);
    });

    it('should return null for non-existent key', async () => {
      const result = await storage.load('non-existent-key');
      expect(result).toBeNull();
    });

    it('should overwrite existing data on save', async () => {
      await storage.save('key', { version: 1 });
      await storage.save('key', { version: 2 });

      const loaded = await storage.load('key');
      expect(loaded).toEqual({ version: 2 });
    });

    it('should delete data by key', async () => {
      await storage.save('to-delete', { data: 'value' });
      await storage.delete('to-delete');

      const loaded = await storage.load('to-delete');
      expect(loaded).toBeNull();
    });

    it('should handle deleting non-existent key gracefully', async () => {
      await expect(storage.delete('non-existent')).resolves.not.toThrow();
    });

    it('should clear all data', async () => {
      await storage.save('key1', { a: 1 });
      await storage.save('key2', { b: 2 });
      await storage.save('key3', { c: 3 });

      await storage.clear();

      const loaded1 = await storage.load('key1');
      const loaded2 = await storage.load('key2');
      const loaded3 = await storage.load('key3');

      expect(loaded1).toBeNull();
      expect(loaded2).toBeNull();
      expect(loaded3).toBeNull();
    });

    it('should get all keys', async () => {
      await storage.save('key-a', { a: 1 });
      await storage.save('key-b', { b: 2 });
      await storage.save('key-c', { c: 3 });

      const keys = await storage.getAllKeys();

      expect(keys).toContain('key-a');
      expect(keys).toContain('key-b');
      expect(keys).toContain('key-c');
      expect(keys.length).toBe(3);
    });

    it('should return empty array when no keys exist', async () => {
      await storage.clear();
      const keys = await storage.getAllKeys();
      expect(keys).toEqual([]);
    });
  });

  // ================================
  // Data Types Tests
  // ================================

  describe('Data Types', () => {
    let storage: IndexStorage;

    beforeEach(() => {
      storage = createIndexStorage({ dbName: 'types-test-db' });
    });

    afterEach(async () => {
      try {
        await storage.deleteDatabase();
      } catch {
        // Ignore
      }
    });

    it('should handle string data', async () => {
      await storage.save('string-key', 'simple string value');
      const result = await storage.load('string-key');
      expect(result).toBe('simple string value');
    });

    it('should handle number data', async () => {
      await storage.save('number-key', 42);
      const result = await storage.load('number-key');
      expect(result).toBe(42);
    });

    it('should handle boolean data', async () => {
      await storage.save('bool-true', true);
      await storage.save('bool-false', false);

      expect(await storage.load('bool-true')).toBe(true);
      expect(await storage.load('bool-false')).toBe(false);
    });

    it('should handle null data', async () => {
      await storage.save('null-key', null);
      const result = await storage.load('null-key');
      expect(result).toBeNull();
    });

    it('should handle array data', async () => {
      const array = [1, 'two', { three: 3 }, [4, 5]];
      await storage.save('array-key', array);
      const result = await storage.load('array-key');
      expect(result).toEqual(array);
    });

    it('should handle nested object data', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
              array: [1, 2, 3],
            },
          },
        },
      };
      await storage.save('nested-key', nested);
      const result = await storage.load('nested-key');
      expect(result).toEqual(nested);
    });

    it('should handle large data', async () => {
      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          data: 'x'.repeat(100),
        })),
      };
      await storage.save('large-key', largeData);
      const result = await storage.load('large-key');
      expect(result).toEqual(largeData);
    });
  });

  // ================================
  // Connection Management Tests
  // ================================

  describe('Connection Management', () => {
    let storage: IndexStorage;

    beforeEach(() => {
      storage = createIndexStorage({ dbName: 'connection-test-db' });
    });

    afterEach(async () => {
      try {
        storage.close();
        await storage.deleteDatabase();
      } catch {
        // Ignore
      }
    });

    it('should report isOpen status correctly', async () => {
      expect(storage.isOpen()).toBe(false);

      await storage.save('key', 'value');
      expect(storage.isOpen()).toBe(true);
    });

    it('should close connection', async () => {
      await storage.save('key', 'value');
      expect(storage.isOpen()).toBe(true);

      storage.close();
      expect(storage.isOpen()).toBe(false);
    });

    it('should auto-reopen after close', async () => {
      await storage.save('key1', 'value1');
      storage.close();

      await storage.save('key2', 'value2');
      expect(storage.isOpen()).toBe(true);

      const result = await storage.load('key2');
      expect(result).toBe('value2');
    });

    it('should delete database', async () => {
      await storage.save('key', 'value');
      await storage.deleteDatabase();

      // After delete, loading should return null
      const result = await storage.load('key');
      expect(result).toBeNull();
    });
  });

  // ================================
  // Concurrent Operations Tests
  // ================================

  describe('Concurrent Operations', () => {
    let storage: IndexStorage;

    beforeEach(() => {
      storage = createIndexStorage({ dbName: 'concurrent-test-db' });
    });

    afterEach(async () => {
      try {
        await storage.deleteDatabase();
      } catch {
        // Ignore
      }
    });

    it('should handle concurrent saves', async () => {
      const operations = Array.from({ length: 10 }, (_, i) =>
        storage.save(`concurrent-key-${i}`, { index: i })
      );

      await expect(Promise.all(operations)).resolves.not.toThrow();

      const keys = await storage.getAllKeys();
      expect(keys.length).toBe(10);
    });

    it('should handle concurrent loads', async () => {
      // Save some data first
      await Promise.all([
        storage.save('key1', 'value1'),
        storage.save('key2', 'value2'),
        storage.save('key3', 'value3'),
      ]);

      // Concurrent loads
      const [result1, result2, result3] = await Promise.all([
        storage.load('key1'),
        storage.load('key2'),
        storage.load('key3'),
      ]);

      expect(result1).toBe('value1');
      expect(result2).toBe('value2');
      expect(result3).toBe('value3');
    });

    it('should handle mixed concurrent operations', async () => {
      await storage.save('existing', 'initial');

      const operations = [
        storage.save('new1', 'value1'),
        storage.load('existing'),
        storage.save('new2', 'value2'),
        storage.delete('non-existent'),
        storage.getAllKeys(),
      ];

      await expect(Promise.all(operations)).resolves.not.toThrow();
    });
  });
});

// ================================
// Test Suite: Memory Index Storage
// ================================

describe('Memory Index Storage', () => {
  // ================================
  // Factory Tests
  // ================================

  describe('Factory', () => {
    it('should create a memory storage instance', () => {
      const storage = createMemoryIndexStorage();
      expect(storage).toBeDefined();
      expect(storage).toHaveProperty('save');
      expect(storage).toHaveProperty('load');
      expect(storage).toHaveProperty('delete');
      expect(storage).toHaveProperty('clear');
    });
  });

  // ================================
  // CRUD Operations Tests
  // ================================

  describe('CRUD Operations', () => {
    it('should save and load data', async () => {
      const storage = createMemoryIndexStorage();
      const testData = { key: 'value', number: 42 };

      await storage.save('test', testData);
      const result = await storage.load('test');

      expect(result).toEqual(testData);
    });

    it('should return null for non-existent key', async () => {
      const storage = createMemoryIndexStorage();
      const result = await storage.load('missing');
      expect(result).toBeNull();
    });

    it('should overwrite existing data', async () => {
      const storage = createMemoryIndexStorage();

      await storage.save('key', { version: 1 });
      await storage.save('key', { version: 2 });

      const result = await storage.load('key');
      expect(result).toEqual({ version: 2 });
    });

    it('should delete data', async () => {
      const storage = createMemoryIndexStorage();

      await storage.save('to-delete', 'value');
      await storage.delete('to-delete');

      const result = await storage.load('to-delete');
      expect(result).toBeNull();
    });

    it('should clear all data', async () => {
      const storage = createMemoryIndexStorage();

      await storage.save('key1', 'value1');
      await storage.save('key2', 'value2');
      await storage.clear();

      expect(await storage.load('key1')).toBeNull();
      expect(await storage.load('key2')).toBeNull();
    });
  });

  // ================================
  // Data Isolation Tests
  // ================================

  describe('Data Isolation', () => {
    it('should isolate data between instances', async () => {
      const storage1 = createMemoryIndexStorage();
      const storage2 = createMemoryIndexStorage();

      await storage1.save('key', 'value1');
      await storage2.save('key', 'value2');

      expect(await storage1.load('key')).toBe('value1');
      expect(await storage2.load('key')).toBe('value2');
    });

    it('should not affect other instances on clear', async () => {
      const storage1 = createMemoryIndexStorage();
      const storage2 = createMemoryIndexStorage();

      await storage1.save('key', 'value1');
      await storage2.save('key', 'value2');

      await storage1.clear();

      expect(await storage1.load('key')).toBeNull();
      expect(await storage2.load('key')).toBe('value2');
    });
  });

  // ================================
  // Various Data Types Tests
  // ================================

  describe('Data Types', () => {
    let storage: ReturnType<typeof createMemoryIndexStorage>;

    beforeEach(() => {
      storage = createMemoryIndexStorage();
    });

    it('should handle primitives', async () => {
      await storage.save('string', 'hello');
      await storage.save('number', 123);
      await storage.save('boolean', true);
      await storage.save('null', null);

      expect(await storage.load('string')).toBe('hello');
      expect(await storage.load('number')).toBe(123);
      expect(await storage.load('boolean')).toBe(true);
      expect(await storage.load('null')).toBeNull();
    });

    it('should handle arrays', async () => {
      const arr = [1, 2, 3, 'four', { five: 5 }];
      await storage.save('array', arr);

      const result = await storage.load('array');
      expect(result).toEqual(arr);
    });

    it('should handle complex objects', async () => {
      const complex = {
        string: 'value',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: 'found',
          },
        },
      };

      await storage.save('complex', complex);
      const result = await storage.load('complex');
      expect(result).toEqual(complex);
    });

    it('should handle undefined as deletion', async () => {
      await storage.save('key', undefined);
      // undefined is typically treated as setting a value, but load should handle it
      const result = await storage.load('key');
      // Behavior depends on implementation - either undefined or the stored value
      expect(result === undefined || result === null || result === undefined).toBe(true);
    });
  });

  // ================================
  // Async Behavior Tests
  // ================================

  describe('Async Behavior', () => {
    it('should return promises', () => {
      const storage = createMemoryIndexStorage();

      const saveResult = storage.save('key', 'value');
      const loadResult = storage.load('key');
      const deleteResult = storage.delete('key');
      const clearResult = storage.clear();

      expect(saveResult).toBeInstanceOf(Promise);
      expect(loadResult).toBeInstanceOf(Promise);
      expect(deleteResult).toBeInstanceOf(Promise);
      expect(clearResult).toBeInstanceOf(Promise);
    });

    it('should work with async/await', async () => {
      const storage = createMemoryIndexStorage();

      await storage.save('async-key', 'async-value');
      const result = await storage.load('async-key');

      expect(result).toBe('async-value');
    });

    it('should handle concurrent operations', async () => {
      const storage = createMemoryIndexStorage();

      await Promise.all([
        storage.save('key1', 'value1'),
        storage.save('key2', 'value2'),
        storage.save('key3', 'value3'),
      ]);

      const results = await Promise.all([
        storage.load('key1'),
        storage.load('key2'),
        storage.load('key3'),
      ]);

      expect(results).toEqual(['value1', 'value2', 'value3']);
    });
  });
});

// ================================
// IIndexStorage Interface Compliance Tests
// ================================

describe('IIndexStorage Interface Compliance', () => {
  const implementations = [
    { name: 'IndexStorage', factory: () => createIndexStorage({ dbName: 'interface-test-db' }) },
    { name: 'MemoryIndexStorage', factory: () => createMemoryIndexStorage() },
  ];

  beforeEach(() => {
    setupGlobalMocks();
  });

  afterEach(() => {
    teardownGlobalMocks();
  });

  implementations.forEach(({ name, factory }) => {
    describe(`${name}`, () => {
      it('should implement save method', () => {
        const storage = factory();
        expect(typeof storage.save).toBe('function');
      });

      it('should implement load method', () => {
        const storage = factory();
        expect(typeof storage.load).toBe('function');
      });

      it('should implement delete method', () => {
        const storage = factory();
        expect(typeof storage.delete).toBe('function');
      });

      it('should implement clear method', () => {
        const storage = factory();
        expect(typeof storage.clear).toBe('function');
      });

      it('should persist and retrieve data correctly', async () => {
        const storage = factory();
        const testKey = `test-${Date.now()}`;
        const testData = { timestamp: Date.now(), data: 'test' };

        await storage.save(testKey, testData);
        const result = await storage.load(testKey);

        expect(result).toEqual(testData);

        // Cleanup
        await storage.delete(testKey);
      });
    });
  });
});
