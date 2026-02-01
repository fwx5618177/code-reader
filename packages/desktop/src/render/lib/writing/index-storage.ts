// ================================
// Index Storage - IndexedDB Persistence
// 搜索索引持久化存储
// ================================

import type { IIndexStorage } from './types';

// ================================
// Constants
// ================================

const DEFAULT_DB_NAME = 'writing-index-storage';
const DEFAULT_DB_VERSION = 1;
const STORE_NAME = 'index-data';

// ================================
// Configuration
// ================================

export interface IndexStorageConfig {
  /** 数据库名称 */
  dbName?: string;
  /** 数据库版本 */
  dbVersion?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

const DEFAULT_CONFIG: Required<IndexStorageConfig> = {
  dbName: DEFAULT_DB_NAME,
  dbVersion: DEFAULT_DB_VERSION,
  debug: false,
};

// ================================
// IndexedDB Storage Implementation
// ================================

/**
 * IndexedDB 索引存储
 *
 * 用于持久化搜索索引，支持：
 * - 自动创建数据库和对象存储
 * - 错误恢复
 * - 版本升级
 */
export class IndexStorage implements IIndexStorage {
  private readonly config: Required<IndexStorageConfig>;
  private db: IDBDatabase | null = null;
  private isOpening = false;
  private openPromise: Promise<IDBDatabase> | null = null;

  constructor(config: IndexStorageConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // Public API
  // ================================

  /**
   * 保存数据
   */
  async save(key: string, data: unknown): Promise<void> {
    const db = await this.ensureOpen();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const request = store.put({
          key,
          data: JSON.stringify(data),
          updatedAt: Date.now(),
        });

        request.onsuccess = () => {
          this.log('Saved data for key:', key);
          resolve();
        };

        request.onerror = () => {
          reject(new Error(`Failed to save data: ${request.error?.message}`));
        };

        transaction.onerror = () => {
          reject(new Error(`Transaction failed: ${transaction.error?.message}`));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 加载数据
   */
  async load(key: string): Promise<unknown | null> {
    const db = await this.ensureOpen();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result;
          if (result && result.data) {
            try {
              const parsed = JSON.parse(result.data);
              this.log('Loaded data for key:', key);
              resolve(parsed);
            } catch {
              this.log('Failed to parse data for key:', key);
              resolve(null);
            }
          } else {
            this.log('No data found for key:', key);
            resolve(null);
          }
        };

        request.onerror = () => {
          reject(new Error(`Failed to load data: ${request.error?.message}`));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 删除数据
   */
  async delete(key: string): Promise<void> {
    const db = await this.ensureOpen();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => {
          this.log('Deleted data for key:', key);
          resolve();
        };

        request.onerror = () => {
          reject(new Error(`Failed to delete data: ${request.error?.message}`));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    const db = await this.ensureOpen();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          this.log('Cleared all data');
          resolve();
        };

        request.onerror = () => {
          reject(new Error(`Failed to clear data: ${request.error?.message}`));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 获取所有键
   */
  async getAllKeys(): Promise<string[]> {
    const db = await this.ensureOpen();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();

        request.onsuccess = () => {
          resolve(request.result.map((key) => String(key)));
        };

        request.onerror = () => {
          reject(new Error(`Failed to get keys: ${request.error?.message}`));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 检查数据库是否已打开
   */
  isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.openPromise = null;
      this.log('Database closed');
    }
  }

  /**
   * 删除整个数据库
   */
  async deleteDatabase(): Promise<void> {
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.config.dbName);

      request.onsuccess = () => {
        this.log('Database deleted');
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to delete database: ${request.error?.message}`));
      };

      request.onblocked = () => {
        this.log('Database deletion blocked - other connections open');
        // Still resolve, as the deletion will complete when other connections close
        resolve();
      };
    });
  }

  // ================================
  // Private Methods
  // ================================

  /**
   * 确保数据库已打开
   */
  private async ensureOpen(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.openPromise) {
      return this.openPromise;
    }

    this.openPromise = this.openDatabase();
    return this.openPromise;
  }

  /**
   * 打开数据库
   */
  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.isOpening) {
        // Wait for the current open operation
        const checkInterval = setInterval(() => {
          if (this.db) {
            clearInterval(checkInterval);
            resolve(this.db);
          }
        }, 50);
        return;
      }

      this.isOpening = true;

      const request = indexedDB.open(this.config.dbName, this.config.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.isOpening = false;

        // Handle unexpected closure
        this.db.onclose = () => {
          this.log('Database unexpectedly closed');
          this.db = null;
          this.openPromise = null;
        };

        this.db.onerror = (errorEvent) => {
          this.log('Database error:', errorEvent);
        };

        this.log('Database opened successfully');
        resolve(this.db);
      };

      request.onerror = () => {
        this.isOpening = false;
        this.openPromise = null;
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onblocked = () => {
        this.log('Database open blocked - other connections need to close');
      };
    });
  }

  /**
   * 创建对象存储
   */
  private createStores(db: IDBDatabase): void {
    // Create main store if it doesn't exist
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });

      // Create index for updatedAt for potential cleanup operations
      store.createIndex('updatedAt', 'updatedAt', { unique: false });

      this.log('Created object store:', STORE_NAME);
    }
  }

  /**
   * 调试日志
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[IndexStorage]', ...args);
    }
  }
}

// ================================
// Factory Functions
// ================================

/**
 * 创建索引存储实例
 */
export function createIndexStorage(config?: IndexStorageConfig): IndexStorage {
  return new IndexStorage(config);
}

/**
 * 创建内存索引存储（用于测试）
 */
export function createMemoryIndexStorage(): IIndexStorage {
  const storage = new Map<string, unknown>();

  return {
    async save(key: string, data: unknown): Promise<void> {
      storage.set(key, data);
    },

    async load(key: string): Promise<unknown | null> {
      return storage.get(key) ?? null;
    },

    async delete(key: string): Promise<void> {
      storage.delete(key);
    },

    async clear(): Promise<void> {
      storage.clear();
    },
  };
}

// ================================
// Singleton Instance
// ================================

let defaultStorage: IndexStorage | null = null;

/**
 * 获取默认索引存储实例
 */
export function getDefaultIndexStorage(): IndexStorage {
  if (!defaultStorage) {
    defaultStorage = createIndexStorage({ debug: false });
  }
  return defaultStorage;
}

/**
 * 关闭默认索引存储
 */
export function closeDefaultIndexStorage(): void {
  if (defaultStorage) {
    defaultStorage.close();
    defaultStorage = null;
  }
}
