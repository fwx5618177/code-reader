// ================================
// Global Test Setup
// Vitest 全局测试配置
// ================================

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// ================================
// Mock Browser APIs
// ================================

// IndexedDB Mock
const mockStorage = new Map<string, Map<string, unknown>>();

interface MockIDBRequest<T = unknown> {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  readyState: 'pending' | 'done';
}

function createMockRequest<T>(result: T, delay = 0): MockIDBRequest<T> {
  const request: MockIDBRequest<T> = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
    readyState: 'pending',
  };

  setTimeout(() => {
    request.readyState = 'done';
    request.onsuccess?.({ target: request } as unknown as Event);
  }, delay);

  return request;
}

function createMockObjectStore(storeName: string) {
  if (!mockStorage.has(storeName)) {
    mockStorage.set(storeName, new Map());
  }
  const store = mockStorage.get(storeName)!;

  return {
    put: (value: unknown) => {
      const key = (value as { key: string }).key;
      store.set(key, value);
      return createMockRequest(undefined);
    },
    get: (key: string) => {
      return createMockRequest(store.get(key));
    },
    delete: (key: string) => {
      store.delete(key);
      return createMockRequest(undefined);
    },
    clear: () => {
      store.clear();
      return createMockRequest(undefined);
    },
    getAllKeys: () => {
      return createMockRequest(Array.from(store.keys()));
    },
    createIndex: () => {},
  };
}

function createMockDatabase(_name: string) {
  const objectStoreNames = new Set<string>();

  return {
    objectStoreNames: {
      contains: (storeName: string) => objectStoreNames.has(storeName),
    },
    createObjectStore: (storeName: string) => {
      objectStoreNames.add(storeName);
      return createMockObjectStore(storeName);
    },
    transaction: () => ({
      objectStore: (storeName: string) => createMockObjectStore(storeName),
      oncomplete: null,
      onerror: null,
      error: null,
    }),
    close: () => {},
    onclose: null,
    onerror: null,
  };
}

const mockIndexedDB = {
  _databases: new Map<string, ReturnType<typeof createMockDatabase>>(),

  open: function (name: string) {
    const request = {
      result: null as ReturnType<typeof createMockDatabase> | null,
      error: null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
      readyState: 'pending' as const,
    };

    setTimeout(() => {
      let db = this._databases.get(name);
      const isNewDb = !db;

      if (!db) {
        db = createMockDatabase(name);
        this._databases.set(name, db);
      }

      request.result = db;

      if (isNewDb && request.onupgradeneeded) {
        request.onupgradeneeded({
          target: { result: db },
        } as unknown as IDBVersionChangeEvent);
      }

      request.onsuccess?.({ target: request } as unknown as Event);
    }, 0);

    return request as unknown as IDBOpenDBRequest;
  },

  deleteDatabase: function (name: string) {
    this._databases.delete(name);
    mockStorage.clear();
    return createMockRequest(undefined) as unknown as IDBOpenDBRequest;
  },

  cmp: () => 0,
  databases: async () => [],
};

// Worker Mock
class MockWorker {
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  private isTerminated = false;

  constructor(_scriptURL: string | URL) {}

  postMessage(message: unknown): void {
    if (this.isTerminated) return;

    setTimeout(() => {
      if (this.isTerminated) return;

      const request = message as { id: string; type: string; payload: unknown };
      const response = this.handleMessage(request);
      this.onmessage?.({ data: response });
    }, 10);
  }

  private handleMessage(request: { id: string; type: string; payload: unknown }): unknown {
    switch (request.type) {
      case 'TEXT_DIFF': {
        const payload = request.payload as { source: string; target: string };
        return {
          id: request.id,
          type: 'TEXT_DIFF',
          success: true,
          result: {
            diffs: [
              [-1, payload.source],
              [1, payload.target],
            ],
            sourceLength: payload.source.length,
            targetLength: payload.target.length,
            computeTimeMs: 5,
            algorithm: 'mock',
          },
          computeTimeMs: 5,
        };
      }
      case 'HASH': {
        const payload = request.payload as { data: string };
        return {
          id: request.id,
          type: 'HASH',
          success: true,
          result: {
            hash: `mock-hash-${payload.data.length}`,
            algorithm: 'mock',
            bytesProcessed: payload.data.length,
          },
          computeTimeMs: 1,
        };
      }
      case 'PING':
        return {
          id: request.id,
          type: 'PING',
          success: true,
          result: { pong: true, timestamp: Date.now() },
          computeTimeMs: 0,
        };
      default:
        return {
          id: request.id,
          type: request.type,
          success: false,
          error: `Unknown message type: ${request.type}`,
          computeTimeMs: 0,
        };
    }
  }

  terminate(): void {
    this.isTerminated = true;
    this.onmessage = null;
    this.onerror = null;
  }
}

// URL Mock
let blobUrlCounter = 0;
const blobUrls = new Map<string, Blob>();

const mockURL = {
  createObjectURL: (blob: Blob): string => {
    const url = `blob:mock-${++blobUrlCounter}`;
    blobUrls.set(url, blob);
    return url;
  },
  revokeObjectURL: (url: string): void => {
    blobUrls.delete(url);
  },
};

// ================================
// Setup and Teardown
// ================================

beforeAll(() => {
  // Mock IndexedDB
  (globalThis as unknown as { indexedDB: typeof mockIndexedDB }).indexedDB = mockIndexedDB;

  // Mock Worker
  (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;

  // Mock URL methods
  const originalURL = globalThis.URL;
  (globalThis as unknown as { URL: typeof originalURL }).URL = class extends originalURL {
    static override createObjectURL = mockURL.createObjectURL;
    static override revokeObjectURL = mockURL.revokeObjectURL;
  };

  // Mock performance.now if needed
  if (typeof performance === 'undefined') {
    (globalThis as unknown as { performance: { now: () => number } }).performance = {
      now: () => Date.now(),
    };
  }

  // Mock requestAnimationFrame
  if (typeof requestAnimationFrame === 'undefined') {
    (
      globalThis as unknown as { requestAnimationFrame: (callback: FrameRequestCallback) => number }
    ).requestAnimationFrame = (callback: FrameRequestCallback) => {
      return setTimeout(() => callback(Date.now()), 16) as unknown as number;
    };
    (globalThis as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame =
      (id: number) => {
        clearTimeout(id);
      };
  }
});

afterAll(() => {
  // Cleanup
  mockStorage.clear();
  blobUrls.clear();
  blobUrlCounter = 0;
});

beforeEach(() => {
  // Reset mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  // Cleanup after each test
  vi.restoreAllMocks();
});

// ================================
// Global Test Utilities
// ================================

/**
 * Wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50 } = options;
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('waitFor timeout exceeded');
    }
    await wait(interval);
  }
}
