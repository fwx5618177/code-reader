// ================================
// IndexedDB 离线存储模块
// 支持增量操作队列和快照存储
// 为未来协同办公做准备
// ================================

import { VersionedSnapshot } from '../delta/versioned-snapshot';
// 从统一的 diff 库导入类型
import type { DiffOperation } from '@code-reader/diff-algorithm';

// 重新导出以保持向后兼容
export type { DiffOperation };

/**
 * 待同步操作
 */
export interface PendingOperation {
  /** 操作 ID */
  readonly id: string;
  /** 文档 ID */
  readonly documentId: string;
  /** 基于的版本 ID */
  readonly baseVersionId: number;
  /** 基于的内容哈希 */
  readonly baseContentHash: string;
  /** 差分操作 */
  readonly operations: ReadonlyArray<DiffOperation>;
  /** 创建时间戳 */
  readonly timestamp: number;
  /** 重试次数 */
  retryCount: number;
  /** 最后重试时间 */
  lastRetryAt: number | null;
  /** 状态 */
  status: 'pending' | 'syncing' | 'failed' | 'acknowledged';
  /** 错误信息 */
  error?: string;
}

/**
 * 存储的快照
 */
export interface StoredSnapshot extends VersionedSnapshot {
  /** 存储时间戳 */
  readonly storedAt: number;
  /** 是否为最新版本 */
  isLatest: boolean;
}

/**
 * 存储统计信息
 */
export interface StorageStats {
  /** 快照数量 */
  snapshotCount: number;
  /** 待同步操作数量 */
  pendingOperationCount: number;
  /** 估算存储大小（字节） */
  estimatedSize: number;
  /** 最后更新时间 */
  lastUpdatedAt: number | null;
}

/**
 * 离线存储配置
 */
export interface OfflineStorageConfig {
  /** 数据库名称 */
  dbName: string;
  /** 数据库版本 */
  dbVersion: number;
  /** 每个文档保留的最大快照数 */
  maxSnapshotsPerDocument: number;
  /** 每个文档保留的最大待同步操作数 */
  maxPendingOperationsPerDocument: number;
  /** 是否启用调试日志 */
  debug: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: OfflineStorageConfig = {
  dbName: 'code-reader-offline',
  dbVersion: 1,
  maxSnapshotsPerDocument: 10,
  maxPendingOperationsPerDocument: 100,
  debug: false,
};

// ================================
// 对象存储名称
// ================================

const STORE_SNAPSHOTS = 'snapshots';
const STORE_PENDING_OPERATIONS = 'pending_operations';
const STORE_METADATA = 'metadata';

// ================================
// IndexedDB 离线存储类
// ================================

/**
 * IndexedDBStorage - 基于 IndexedDB 的离线存储
 *
 * 核心特性：
 * 1. **快照存储**：存储文档的版本化快照
 * 2. **操作队列**：存储待同步的增量操作
 * 3. **自动清理**：限制存储大小，自动删除旧数据
 * 4. **事务支持**：保证数据一致性
 *
 * 使用示例：
 * ```typescript
 * const storage = new IndexedDBStorage();
 * await storage.open();
 *
 * // 存储快照
 * await storage.storeSnapshot(snapshot);
 *
 * // 获取最新快照
 * const latest = await storage.getLatestSnapshot('doc-123');
 *
 * // 添加待同步操作
 * await storage.addPendingOperation(operation);
 *
 * // 获取待同步操作
 * const pending = await storage.getPendingOperations('doc-123');
 *
 * await storage.close();
 * ```
 */
export class IndexedDBStorage {
  private readonly config: OfflineStorageConfig;
  private db: IDBDatabase | null = null;
  private isOpening: boolean = false;
  private openPromise: Promise<void> | null = null;

  constructor(config: Partial<OfflineStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 数据库生命周期
  // ================================

  /**
   * 打开数据库连接
   */
  async open(): Promise<void> {
    if (this.db) {
      return;
    }

    if (this.isOpening && this.openPromise) {
      return this.openPromise;
    }

    this.isOpening = true;
    this.openPromise = this.openDatabase();

    try {
      await this.openPromise;
    } finally {
      this.isOpening = false;
      this.openPromise = null;
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.log('数据库已关闭');
    }
  }

  /**
   * 检查数据库是否已打开
   */
  isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * 删除数据库
   */
  async deleteDatabase(): Promise<void> {
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.config.dbName);

      request.onsuccess = () => {
        this.log('数据库已删除');
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`删除数据库失败: ${request.error?.message}`));
      };

      request.onblocked = () => {
        this.log('数据库删除被阻塞，等待其他连接关闭');
      };
    });
  }

  // ================================
  // 快照存储
  // ================================

  /**
   * 存储快照
   *
   * @param snapshot 要存储的快照
   */
  async storeSnapshot(snapshot: VersionedSnapshot): Promise<void> {
    await this.ensureOpen();

    const storedSnapshot: StoredSnapshot = {
      ...snapshot,
      storedAt: Date.now(),
      isLatest: true,
    };

    await this.runTransaction([STORE_SNAPSHOTS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_SNAPSHOTS);

      // 将同一文档的其他快照标记为非最新
      const index = store.index('by_document_latest');
      const range = IDBKeyRange.only([snapshot.documentId, 1]);
      const existingRequest = index.openCursor(range);

      await new Promise<void>((resolve, reject) => {
        existingRequest.onsuccess = () => {
          const cursor = existingRequest.result;
          if (cursor) {
            const existing = cursor.value as StoredSnapshot;
            if (existing.versionId !== snapshot.versionId) {
              existing.isLatest = false;
              cursor.update(existing);
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        existingRequest.onerror = () => reject(existingRequest.error);
      });

      // 存储新快照
      const key = `${snapshot.documentId}:${snapshot.versionId}`;
      store.put(storedSnapshot, key);

      // 清理旧快照
      await this.cleanupOldSnapshots(store, snapshot.documentId);
    });

    this.log(`快照已存储: ${snapshot.documentId} v${snapshot.versionId}`);
  }

  /**
   * 获取最新快照
   *
   * @param documentId 文档 ID
   * @returns 最新快照或 null
   */
  async getLatestSnapshot(documentId: string): Promise<StoredSnapshot | null> {
    await this.ensureOpen();

    return this.runTransaction([STORE_SNAPSHOTS], 'readonly', async (transaction) => {
      const store = transaction.objectStore(STORE_SNAPSHOTS);
      const index = store.index('by_document_latest');
      const range = IDBKeyRange.only([documentId, 1]);

      return new Promise<StoredSnapshot | null>((resolve, reject) => {
        const request = index.openCursor(range, 'prev');

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            resolve(cursor.value as StoredSnapshot);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * 获取指定版本的快照
   *
   * @param documentId 文档 ID
   * @param versionId 版本 ID
   * @returns 快照或 null
   */
  async getSnapshot(documentId: string, versionId: number): Promise<StoredSnapshot | null> {
    await this.ensureOpen();

    return this.runTransaction([STORE_SNAPSHOTS], 'readonly', async (transaction) => {
      const store = transaction.objectStore(STORE_SNAPSHOTS);
      const key = `${documentId}:${versionId}`;

      return new Promise<StoredSnapshot | null>((resolve, reject) => {
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result as StoredSnapshot | null);
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * 获取文档的所有快照
   *
   * @param documentId 文档 ID
   * @returns 快照列表（按版本降序）
   */
  async getSnapshots(documentId: string): Promise<StoredSnapshot[]> {
    await this.ensureOpen();

    return this.runTransaction([STORE_SNAPSHOTS], 'readonly', async (transaction) => {
      const store = transaction.objectStore(STORE_SNAPSHOTS);
      const index = store.index('by_document');
      const range = IDBKeyRange.only(documentId);
      const snapshots: StoredSnapshot[] = [];

      return new Promise<StoredSnapshot[]>((resolve, reject) => {
        const request = index.openCursor(range, 'prev');

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            snapshots.push(cursor.value as StoredSnapshot);
            cursor.continue();
          } else {
            resolve(snapshots);
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * 删除文档的所有快照
   *
   * @param documentId 文档 ID
   */
  async deleteSnapshots(documentId: string): Promise<void> {
    await this.ensureOpen();

    await this.runTransaction([STORE_SNAPSHOTS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_SNAPSHOTS);
      const index = store.index('by_document');
      const range = IDBKeyRange.only(documentId);

      return new Promise<void>((resolve, reject) => {
        const request = index.openCursor(range);

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };

        request.onerror = () => reject(request.error);
      });
    });

    this.log(`已删除文档 ${documentId} 的所有快照`);
  }

  // ================================
  // 待同步操作存储
  // ================================

  /**
   * 添加待同步操作
   *
   * @param operation 待同步操作
   */
  async addPendingOperation(
    operation: Omit<PendingOperation, 'retryCount' | 'lastRetryAt' | 'status'>
  ): Promise<void> {
    await this.ensureOpen();

    const pendingOp: PendingOperation = {
      ...operation,
      retryCount: 0,
      lastRetryAt: null,
      status: 'pending',
    };

    await this.runTransaction([STORE_PENDING_OPERATIONS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_PENDING_OPERATIONS);
      store.add(pendingOp);

      // 清理旧操作
      await this.cleanupOldPendingOperations(store, operation.documentId);
    });

    this.log(`待同步操作已添加: ${operation.id}`);
  }

  /**
   * 获取文档的所有待同步操作
   *
   * @param documentId 文档 ID
   * @returns 待同步操作列表（按时间戳升序）
   */
  async getPendingOperations(documentId: string): Promise<PendingOperation[]> {
    await this.ensureOpen();

    return this.runTransaction([STORE_PENDING_OPERATIONS], 'readonly', async (transaction) => {
      const store = transaction.objectStore(STORE_PENDING_OPERATIONS);
      const index = store.index('by_document_status');
      const range = IDBKeyRange.only([documentId, 'pending']);
      const operations: PendingOperation[] = [];

      return new Promise<PendingOperation[]>((resolve, reject) => {
        const request = index.openCursor(range);

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            operations.push(cursor.value as PendingOperation);
            cursor.continue();
          } else {
            // 按时间戳排序
            operations.sort((a, b) => a.timestamp - b.timestamp);
            resolve(operations);
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * 更新待同步操作的状态
   *
   * @param operationId 操作 ID
   * @param updates 更新内容
   */
  async updatePendingOperation(
    operationId: string,
    updates: Partial<Pick<PendingOperation, 'status' | 'retryCount' | 'lastRetryAt' | 'error'>>
  ): Promise<void> {
    await this.ensureOpen();

    await this.runTransaction([STORE_PENDING_OPERATIONS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_PENDING_OPERATIONS);
      const index = store.index('by_id');

      return new Promise<void>((resolve, reject) => {
        const request = index.get(operationId);

        request.onsuccess = () => {
          const operation = request.result as PendingOperation | undefined;
          if (operation) {
            Object.assign(operation, updates);
            store.put(operation);
          }
          resolve();
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * 标记操作为已确认并删除
   *
   * @param operationIds 操作 ID 列表
   */
  async acknowledgeOperations(operationIds: string[]): Promise<void> {
    await this.ensureOpen();

    await this.runTransaction([STORE_PENDING_OPERATIONS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_PENDING_OPERATIONS);
      const index = store.index('by_id');

      for (const operationId of operationIds) {
        await new Promise<void>((resolve, reject) => {
          const request = index.getKey(operationId);

          request.onsuccess = () => {
            if (request.result) {
              store.delete(request.result);
            }
            resolve();
          };

          request.onerror = () => reject(request.error);
        });
      }
    });

    this.log(`${operationIds.length} 个操作已确认并删除`);
  }

  /**
   * 删除文档的所有待同步操作
   *
   * @param documentId 文档 ID
   */
  async clearPendingOperations(documentId: string): Promise<void> {
    await this.ensureOpen();

    await this.runTransaction([STORE_PENDING_OPERATIONS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_PENDING_OPERATIONS);
      const index = store.index('by_document');
      const range = IDBKeyRange.only(documentId);

      return new Promise<void>((resolve, reject) => {
        const request = index.openCursor(range);

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };

        request.onerror = () => reject(request.error);
      });
    });

    this.log(`已删除文档 ${documentId} 的所有待同步操作`);
  }

  /**
   * 获取待同步操作数量
   *
   * @param documentId 可选的文档 ID
   * @returns 待同步操作数量
   */
  async getPendingOperationCount(documentId?: string): Promise<number> {
    await this.ensureOpen();

    return this.runTransaction([STORE_PENDING_OPERATIONS], 'readonly', async (transaction) => {
      const store = transaction.objectStore(STORE_PENDING_OPERATIONS);

      if (documentId) {
        const index = store.index('by_document_status');
        const range = IDBKeyRange.only([documentId, 'pending']);

        return new Promise<number>((resolve, reject) => {
          const request = index.count(range);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } else {
        return new Promise<number>((resolve, reject) => {
          const request = store.count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    });
  }

  // ================================
  // 统计信息
  // ================================

  /**
   * 获取存储统计信息
   *
   * @param documentId 可选的文档 ID
   * @returns 统计信息
   */
  async getStats(documentId?: string): Promise<StorageStats> {
    await this.ensureOpen();

    const [snapshotCount, pendingOperationCount] = await Promise.all([
      this.getSnapshotCount(documentId),
      this.getPendingOperationCount(documentId),
    ]);

    // 估算存储大小（简化计算）
    const estimatedSize = snapshotCount * 10000 + pendingOperationCount * 500;

    return {
      snapshotCount,
      pendingOperationCount,
      estimatedSize,
      lastUpdatedAt: Date.now(),
    };
  }

  /**
   * 获取快照数量
   */
  private async getSnapshotCount(documentId?: string): Promise<number> {
    return this.runTransaction([STORE_SNAPSHOTS], 'readonly', async (transaction) => {
      const store = transaction.objectStore(STORE_SNAPSHOTS);

      if (documentId) {
        const index = store.index('by_document');
        const range = IDBKeyRange.only(documentId);

        return new Promise<number>((resolve, reject) => {
          const request = index.count(range);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } else {
        return new Promise<number>((resolve, reject) => {
          const request = store.count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
    });
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 打开数据库
   */
  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.dbVersion);

      request.onerror = () => {
        reject(new Error(`打开数据库失败: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.log('数据库已打开');

        // 处理版本变更（其他标签页升级数据库）
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          this.log('数据库版本已更改，连接已关闭');
        };

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };
    });
  }

  /**
   * 创建对象存储
   */
  private createStores(db: IDBDatabase): void {
    // 快照存储
    if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
      const snapshotStore = db.createObjectStore(STORE_SNAPSHOTS);
      snapshotStore.createIndex('by_document', 'documentId', { unique: false });
      snapshotStore.createIndex('by_document_latest', ['documentId', 'isLatest'], {
        unique: false,
      });
      snapshotStore.createIndex('by_version', ['documentId', 'versionId'], { unique: true });
    }

    // 待同步操作存储
    if (!db.objectStoreNames.contains(STORE_PENDING_OPERATIONS)) {
      const pendingStore = db.createObjectStore(STORE_PENDING_OPERATIONS, { autoIncrement: true });
      pendingStore.createIndex('by_id', 'id', { unique: true });
      pendingStore.createIndex('by_document', 'documentId', { unique: false });
      pendingStore.createIndex('by_document_status', ['documentId', 'status'], { unique: false });
      pendingStore.createIndex('by_timestamp', 'timestamp', { unique: false });
    }

    // 元数据存储
    if (!db.objectStoreNames.contains(STORE_METADATA)) {
      db.createObjectStore(STORE_METADATA);
    }

    this.log('对象存储已创建');
  }

  /**
   * 确保数据库已打开
   */
  private async ensureOpen(): Promise<void> {
    if (!this.db) {
      await this.open();
    }
  }

  /**
   * 运行事务
   */
  private async runTransaction<T>(
    storeNames: string[],
    mode: IDBTransactionMode,
    callback: (transaction: IDBTransaction) => Promise<T>
  ): Promise<T> {
    if (!this.db) {
      throw new Error('数据库未打开');
    }

    const transaction = this.db.transaction(storeNames, mode);

    return new Promise<T>((resolve, reject) => {
      transaction.onerror = () => {
        reject(transaction.error);
      };

      transaction.oncomplete = () => {
        // 事务完成后 resolve 结果
      };

      callback(transaction).then(resolve).catch(reject);
    });
  }

  /**
   * 清理旧快照
   */
  private async cleanupOldSnapshots(store: IDBObjectStore, documentId: string): Promise<void> {
    const index = store.index('by_document');
    const range = IDBKeyRange.only(documentId);
    const snapshots: { key: IDBValidKey; versionId: number }[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(range);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const snapshot = cursor.value as StoredSnapshot;
          snapshots.push({ key: cursor.primaryKey, versionId: snapshot.versionId });
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });

    // 按版本降序排序
    snapshots.sort((a, b) => b.versionId - a.versionId);

    // 删除超出限制的旧快照
    const toDelete = snapshots.slice(this.config.maxSnapshotsPerDocument);
    for (const item of toDelete) {
      store.delete(item.key);
    }

    if (toDelete.length > 0) {
      this.log(`已清理 ${toDelete.length} 个旧快照`);
    }
  }

  /**
   * 清理旧的待同步操作
   */
  private async cleanupOldPendingOperations(
    store: IDBObjectStore,
    documentId: string
  ): Promise<void> {
    const index = store.index('by_document');
    const range = IDBKeyRange.only(documentId);
    const operations: { key: IDBValidKey; timestamp: number; status: string }[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(range);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const op = cursor.value as PendingOperation;
          operations.push({ key: cursor.primaryKey, timestamp: op.timestamp, status: op.status });
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });

    // 只清理已确认的操作，按时间升序排序
    const acknowledged = operations
      .filter((op) => op.status === 'acknowledged')
      .sort((a, b) => a.timestamp - b.timestamp);

    // 删除超出限制的旧操作
    const totalCount = operations.length;
    const toDeleteCount = Math.max(0, totalCount - this.config.maxPendingOperationsPerDocument);

    const toDelete = acknowledged.slice(0, toDeleteCount);
    for (const item of toDelete) {
      store.delete(item.key);
    }

    if (toDelete.length > 0) {
      this.log(`已清理 ${toDelete.length} 个旧操作`);
    }
  }

  /**
   * 输出调试日志
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[IndexedDBStorage]', ...args);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 IndexedDBStorage 实例
 */
export function createIndexedDBStorage(config?: Partial<OfflineStorageConfig>): IndexedDBStorage {
  return new IndexedDBStorage(config);
}

// ================================
// 便捷函数
// ================================

// 默认实例（延迟初始化）
let defaultStorage: IndexedDBStorage | null = null;

/**
 * 获取默认存储实例
 */
export async function getDefaultStorage(): Promise<IndexedDBStorage> {
  if (!defaultStorage) {
    defaultStorage = createIndexedDBStorage();
    await defaultStorage.open();
  }
  return defaultStorage;
}

/**
 * 关闭默认存储实例
 */
export function closeDefaultStorage(): void {
  if (defaultStorage) {
    defaultStorage.close();
    defaultStorage = null;
  }
}
