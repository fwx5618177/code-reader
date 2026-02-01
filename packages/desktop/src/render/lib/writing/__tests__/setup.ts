// ================================
// Test Setup - Writing Module
// Mocks for browser APIs and test utilities
// ================================

// ================================
// IndexedDB Mock
// ================================

interface MockIDBRequest<T = unknown> {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  readyState: 'pending' | 'done';
}

interface MockIDBTransaction {
  objectStore: (name: string) => MockIDBObjectStore;
  oncomplete: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  error: DOMException | null;
}

interface MockIDBObjectStore {
  put: (value: unknown) => MockIDBRequest;
  get: (key: string) => MockIDBRequest;
  delete: (key: string) => MockIDBRequest;
  clear: () => MockIDBRequest;
  getAllKeys: () => MockIDBRequest<string[]>;
  createIndex: (name: string, keyPath: string, options?: IDBIndexParameters) => void;
}

interface MockIDBDatabase {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string, options?: IDBObjectStoreParameters) => MockIDBObjectStore;
  transaction: (storeNames: string | string[], mode?: IDBTransactionMode) => MockIDBTransaction;
  close: () => void;
  onclose: (() => void) | null;
  onerror: ((event: Event) => void) | null;
}

interface MockIDBOpenRequest extends MockIDBRequest<MockIDBDatabase> {
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null;
  onblocked: ((event: Event) => void) | null;
}

// In-memory storage for mock IndexedDB
const mockStorage = new Map<string, Map<string, unknown>>();

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

function createMockObjectStore(storeName: string): MockIDBObjectStore {
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
    createIndex: () => {
      // No-op for mock
    },
  };
}

function createMockTransaction(_db: MockIDBDatabase): MockIDBTransaction {
  return {
    objectStore: (name: string) => createMockObjectStore(name),
    oncomplete: null,
    onerror: null,
    error: null,
  };
}

function createMockDatabase(_name: string): MockIDBDatabase {
  const objectStoreNames = new Set<string>();

  return {
    objectStoreNames: {
      contains: (name: string) => objectStoreNames.has(name),
    },
    createObjectStore: (storeName: string) => {
      objectStoreNames.add(storeName);
      return createMockObjectStore(storeName);
    },
    transaction: (_storeNames: string | string[], _mode?: IDBTransactionMode) => {
      return createMockTransaction({} as MockIDBDatabase);
    },
    close: () => {},
    onclose: null,
    onerror: null,
  };
}

export function createMockIndexedDB(): IDBFactory {
  const databases = new Map<string, MockIDBDatabase>();

  return {
    open: (name: string, _version?: number): IDBOpenDBRequest => {
      const request: MockIDBOpenRequest = {
        result: null as unknown as MockIDBDatabase,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
        readyState: 'pending',
      };

      setTimeout(() => {
        let db = databases.get(name);
        const isNewDb = !db;

        if (!db) {
          db = createMockDatabase(name);
          databases.set(name, db);
        }

        request.result = db;
        request.readyState = 'done';

        if (isNewDb && request.onupgradeneeded) {
          request.onupgradeneeded({
            target: { result: db },
          } as unknown as IDBVersionChangeEvent);
        }

        request.onsuccess?.({ target: request } as unknown as Event);
      }, 0);

      return request as unknown as IDBOpenDBRequest;
    },
    deleteDatabase: (name: string): IDBOpenDBRequest => {
      databases.delete(name);
      mockStorage.clear();
      return createMockRequest(undefined) as unknown as IDBOpenDBRequest;
    },
    cmp: () => 0,
    databases: async () => [],
  } as IDBFactory;
}

// ================================
// Worker Mock
// ================================

export interface MockWorkerMessage {
  data: unknown;
}

export class MockWorker {
  public onmessage: ((event: MockWorkerMessage) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  private isTerminated = false;

  constructor(_scriptURL: string | URL) {
    // Mock worker initialization
  }

  postMessage(message: unknown, _transfer?: Transferable[]): void {
    if (this.isTerminated) return;

    // Simulate async message handling
    setTimeout(() => {
      if (this.isTerminated) return;

      const request = message as { id: string; type: string; payload: unknown };

      // Simulate worker response based on message type
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

// ================================
// URL Mock for Blob URLs
// ================================

let blobUrlCounter = 0;
const blobUrls = new Map<string, Blob>();

export const mockURL = {
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
// Performance Mock
// ================================

export const mockPerformance = {
  now: (): number => Date.now(),
  mark: (_name: string): void => {},
  measure: (_name: string, _startMark?: string, _endMark?: string): void => {},
  getEntriesByName: (_name: string): PerformanceEntry[] => [],
  getEntriesByType: (_type: string): PerformanceEntry[] => [],
  clearMarks: (_name?: string): void => {},
  clearMeasures: (_name?: string): void => {},
};

// ================================
// Test Utilities
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

/**
 * Create a mock document for testing
 */
export function createMockDocument(
  id: string,
  overrides: Partial<{
    title: string;
    content: string;
    path: string;
    type: 'document' | 'note' | 'code' | 'markdown';
    tags: string[];
    updatedAt: Date;
  }> = {}
): {
  id: string;
  title: string;
  content: string;
  path?: string;
  type?: 'document' | 'note' | 'code' | 'markdown';
  tags?: string[];
  updatedAt?: Date;
} {
  return {
    id,
    title: overrides.title ?? `Document ${id}`,
    content: overrides.content ?? `This is the content of document ${id}.`,
    path: overrides.path,
    type: overrides.type ?? 'document',
    tags: overrides.tags,
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

/**
 * Create multiple mock documents
 */
export function createMockDocuments(
  count: number,
  factory?: (index: number) => Partial<{
    title: string;
    content: string;
    path: string;
    type: 'document' | 'note' | 'code' | 'markdown';
    tags: string[];
  }>
): ReturnType<typeof createMockDocument>[] {
  return Array.from({ length: count }, (_, i) =>
    createMockDocument(`doc-${i + 1}`, factory?.(i) ?? {})
  );
}

/**
 * Generate random text content
 */
export function generateRandomContent(wordCount: number): string {
  const words = [
    'the',
    'quick',
    'brown',
    'fox',
    'jumps',
    'over',
    'lazy',
    'dog',
    'lorem',
    'ipsum',
    'dolor',
    'sit',
    'amet',
    'consectetur',
    'adipiscing',
    'elit',
    'sed',
    'do',
    'eiusmod',
    'tempor',
  ];

  const result: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    result.push(words[Math.floor(Math.random() * words.length)]);
  }
  return result.join(' ');
}

/**
 * Generate content of approximately the specified byte size
 */
export function generateContentBySize(bytes: number): string {
  // Each character is approximately 1 byte in UTF-8 for ASCII
  const content = 'x'.repeat(bytes);
  return content;
}

// ================================
// Setup Global Mocks
// ================================

export function setupGlobalMocks(): void {
  // Mock IndexedDB
  (globalThis as unknown as { indexedDB: ReturnType<typeof createMockIndexedDB> }).indexedDB =
    createMockIndexedDB();

  // Mock Worker
  (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;

  // Mock URL methods
  globalThis.URL.createObjectURL = mockURL.createObjectURL;
  globalThis.URL.revokeObjectURL = mockURL.revokeObjectURL;

  // Mock Blob
  if (typeof Blob === 'undefined') {
    globalThis.Blob = class MockBlob {
      constructor(
        public parts: BlobPart[],
        public options?: BlobPropertyBag
      ) {}
    } as unknown as typeof Blob;
  }
}

export function teardownGlobalMocks(): void {
  mockStorage.clear();
  blobUrls.clear();
  blobUrlCounter = 0;
}

// ================================
// Performance Metrics Collection
// ================================

export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
}

export class TestPerformanceCollector {
  private metrics: PerformanceMetric[] = [];
  private activeMarks = new Map<
    string,
    { startTime: number; metadata?: Record<string, unknown> }
  >();

  start(name: string, metadata?: Record<string, unknown>): void {
    this.activeMarks.set(name, {
      startTime: performance.now(),
      metadata,
    });
  }

  end(name: string): PerformanceMetric | null {
    const mark = this.activeMarks.get(name);
    if (!mark) return null;

    this.activeMarks.delete(name);

    const endTime = performance.now();
    const metric: PerformanceMetric = {
      name,
      startTime: mark.startTime,
      endTime,
      duration: endTime - mark.startTime,
      metadata: mark.metadata,
    };

    this.metrics.push(metric);
    return metric;
  }

  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  getMetricsByName(name: string): PerformanceMetric[] {
    return this.metrics.filter((m) => m.name === name);
  }

  getAverageDuration(name: string): number {
    const metrics = this.getMetricsByName(name);
    if (metrics.length === 0) return 0;
    return metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
  }

  clear(): void {
    this.metrics = [];
    this.activeMarks.clear();
  }
}
