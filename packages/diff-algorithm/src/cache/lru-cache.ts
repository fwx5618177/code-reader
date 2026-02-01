// ================================
// LRU Cache - 高性能 LRU 缓存实现
//
// 特性：
// - O(1) 时间复杂度的 get/set/delete
// - 双向链表 + HashMap 实现
// - 支持 TTL 过期
// - 支持最大容量限制
// - 支持内存大小限制
// - 线程安全（单线程环境）
// ================================

/**
 * LRU 缓存配置
 */
export interface LRUCacheConfig<K = unknown, V = unknown> {
  /** 最大条目数 */
  maxSize: number;
  /** 条目过期时间（毫秒），0 表示不过期 */
  ttl?: number;
  /** 最大内存占用（字节），0 表示不限制 */
  maxMemory?: number;
  /** 当条目被驱逐时的回调 */
  onEvict?: (key: K, value: V, reason: EvictReason) => void;
  /** 计算值大小的函数（用于内存限制） */
  sizeCalculator?: (value: V) => number;
}

/**
 * 驱逐原因
 */
export type EvictReason = 'capacity' | 'ttl' | 'manual' | 'memory';

/**
 * 缓存条目
 */
interface CacheEntry<K, V> {
  key: K;
  value: V;
  size: number;
  createdAt: number;
  accessedAt: number;
  prev: CacheEntry<K, V> | null;
  next: CacheEntry<K, V> | null;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  /** 当前条目数 */
  size: number;
  /** 最大条目数 */
  maxSize: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 驱逐次数 */
  evictions: number;
  /** 当前内存占用（字节） */
  memoryUsage: number;
  /** 最大内存限制（字节） */
  maxMemory: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<LRUCacheConfig<unknown, unknown>> = {
  maxSize: 1000,
  ttl: 0,
  maxMemory: 0,
  onEvict: () => {},
  sizeCalculator: () => 1,
};

/**
 * LRU 缓存
 *
 * 使用双向链表 + HashMap 实现，所有操作都是 O(1) 时间复杂度。
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<string, object>({ maxSize: 100, ttl: 60000 });
 *
 * cache.set('key1', { data: 'value1' });
 * const value = cache.get('key1'); // { data: 'value1' }
 *
 * // 获取统计
 * const stats = cache.getStats();
 * console.log(`命中率: ${stats.hitRate * 100}%`);
 * ```
 */
export class LRUCache<K, V> {
  private readonly config: Required<LRUCacheConfig<K, V>>;
  private readonly map: Map<K, CacheEntry<K, V>>;
  private head: CacheEntry<K, V> | null = null;
  private tail: CacheEntry<K, V> | null = null;
  private currentMemory: number = 0;

  // 统计
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;

  constructor(config: LRUCacheConfig<K, V>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<LRUCacheConfig<K, V>>;
    this.map = new Map();
  }

  // ================================
  // 核心操作
  // ================================

  /**
   * 获取缓存值
   *
   * @param key 键
   * @returns 值，如果不存在或已过期则返回 undefined
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // 检查是否过期
    if (this.isExpired(entry)) {
      this.deleteEntry(entry, 'ttl');
      this.misses++;
      return undefined;
    }

    // 移动到链表头部（最近使用）
    this.moveToHead(entry);
    entry.accessedAt = Date.now();

    this.hits++;
    return entry.value;
  }

  /**
   * 设置缓存值
   *
   * @param key 键
   * @param value 值
   * @returns this（支持链式调用）
   */
  set(key: K, value: V): this {
    const now = Date.now();
    const size = this.config.sizeCalculator(value);

    // 检查是否已存在
    const existing = this.map.get(key);
    if (existing) {
      // 更新现有条目
      this.currentMemory -= existing.size;
      existing.value = value;
      existing.size = size;
      existing.accessedAt = now;
      this.currentMemory += size;
      this.moveToHead(existing);
    } else {
      // 创建新条目
      const entry: CacheEntry<K, V> = {
        key,
        value,
        size,
        createdAt: now,
        accessedAt: now,
        prev: null,
        next: null,
      };

      // 添加到 map 和链表头部
      this.map.set(key, entry);
      this.addToHead(entry);
      this.currentMemory += size;
    }

    // 驱逐超出容量的条目
    this.evictIfNecessary();

    return this;
  }

  /**
   * 检查键是否存在
   *
   * @param key 键
   * @returns 是否存在（不更新访问时间）
   */
  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;

    // 检查是否过期
    if (this.isExpired(entry)) {
      this.deleteEntry(entry, 'ttl');
      return false;
    }

    return true;
  }

  /**
   * 删除缓存条目
   *
   * @param key 键
   * @returns 是否删除成功
   */
  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;

    this.deleteEntry(entry, 'manual');
    return true;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    // 通知所有条目被驱逐
    for (const entry of this.map.values()) {
      this.config.onEvict(entry.key, entry.value, 'manual');
    }

    this.map.clear();
    this.head = null;
    this.tail = null;
    this.currentMemory = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  // ================================
  // 批量操作
  // ================================

  /**
   * 批量获取
   *
   * @param keys 键列表
   * @returns 值映射（只包含存在的键）
   */
  getMany(keys: readonly K[]): Map<K, V> {
    const result = new Map<K, V>();
    for (const key of keys) {
      const value = this.get(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  }

  /**
   * 批量设置
   *
   * @param entries 键值对列表
   * @returns this
   */
  setMany(entries: readonly [K, V][]): this {
    for (const [key, value] of entries) {
      this.set(key, value);
    }
    return this;
  }

  /**
   * 批量删除
   *
   * @param keys 键列表
   * @returns 删除的条目数
   */
  deleteMany(keys: readonly K[]): number {
    let count = 0;
    for (const key of keys) {
      if (this.delete(key)) {
        count++;
      }
    }
    return count;
  }

  // ================================
  // 查询操作
  // ================================

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * 获取所有键
   */
  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  /**
   * 获取所有值
   */
  values(): V[] {
    const values: V[] = [];
    let current = this.head;
    while (current) {
      if (!this.isExpired(current)) {
        values.push(current.value);
      }
      current = current.next;
    }
    return values;
  }

  /**
   * 获取所有键值对
   */
  entries(): [K, V][] {
    const entries: [K, V][] = [];
    let current = this.head;
    while (current) {
      if (!this.isExpired(current)) {
        entries.push([current.key, current.value]);
      }
      current = current.next;
    }
    return entries;
  }

  /**
   * 获取最近使用的条目
   */
  peek(): V | undefined {
    if (!this.head) return undefined;
    if (this.isExpired(this.head)) {
      this.deleteEntry(this.head, 'ttl');
      return this.peek();
    }
    return this.head.value;
  }

  /**
   * 获取最久未使用的条目
   */
  peekLast(): V | undefined {
    if (!this.tail) return undefined;
    if (this.isExpired(this.tail)) {
      this.deleteEntry(this.tail, 'ttl');
      return this.peekLast();
    }
    return this.tail.value;
  }

  // ================================
  // 统计与维护
  // ================================

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      maxSize: this.config.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
      memoryUsage: this.currentMemory,
      maxMemory: this.config.maxMemory,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * 清理过期条目
   *
   * @returns 清理的条目数
   */
  prune(): number {
    if (this.config.ttl === 0) return 0;

    let count = 0;
    const now = Date.now();

    let current = this.tail;
    while (current) {
      const prev = current.prev;
      if (now - current.createdAt > this.config.ttl) {
        this.deleteEntry(current, 'ttl');
        count++;
      }
      current = prev;
    }

    return count;
  }

  /**
   * 调整缓存大小
   *
   * @param newMaxSize 新的最大大小
   */
  resize(newMaxSize: number): void {
    this.config.maxSize = newMaxSize;
    this.evictIfNecessary();
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 检查条目是否过期
   */
  private isExpired(entry: CacheEntry<K, V>): boolean {
    if (this.config.ttl === 0) return false;
    return Date.now() - entry.createdAt > this.config.ttl;
  }

  /**
   * 添加条目到链表头部
   */
  private addToHead(entry: CacheEntry<K, V>): void {
    entry.prev = null;
    entry.next = this.head;

    if (this.head) {
      this.head.prev = entry;
    }

    this.head = entry;

    if (!this.tail) {
      this.tail = entry;
    }
  }

  /**
   * 从链表中移除条目
   */
  private removeFromList(entry: CacheEntry<K, V>): void {
    if (entry.prev) {
      entry.prev.next = entry.next;
    } else {
      this.head = entry.next;
    }

    if (entry.next) {
      entry.next.prev = entry.prev;
    } else {
      this.tail = entry.prev;
    }

    entry.prev = null;
    entry.next = null;
  }

  /**
   * 移动条目到链表头部
   */
  private moveToHead(entry: CacheEntry<K, V>): void {
    if (entry === this.head) return;
    this.removeFromList(entry);
    this.addToHead(entry);
  }

  /**
   * 删除条目
   */
  private deleteEntry(entry: CacheEntry<K, V>, reason: EvictReason): void {
    this.removeFromList(entry);
    this.map.delete(entry.key);
    this.currentMemory -= entry.size;

    if (reason !== 'manual') {
      this.evictions++;
    }

    this.config.onEvict(entry.key, entry.value, reason);
  }

  /**
   * 必要时驱逐条目
   */
  private evictIfNecessary(): void {
    // 按容量驱逐
    while (this.map.size > this.config.maxSize && this.tail) {
      this.deleteEntry(this.tail, 'capacity');
    }

    // 按内存驱逐
    if (this.config.maxMemory > 0) {
      while (this.currentMemory > this.config.maxMemory && this.tail) {
        this.deleteEntry(this.tail, 'memory');
      }
    }
  }

  // ================================
  // 迭代器
  // ================================

  /**
   * 迭代器（按 LRU 顺序，最近使用的在前）
   */
  *[Symbol.iterator](): IterableIterator<[K, V]> {
    let current = this.head;
    while (current) {
      if (!this.isExpired(current)) {
        yield [current.key, current.value];
      }
      current = current.next;
    }
  }

  /**
   * forEach 遍历
   */
  forEach(callback: (value: V, key: K, cache: LRUCache<K, V>) => void): void {
    for (const [key, value] of this) {
      callback(value, key, this);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 LRU 缓存
 */
export function createLRUCache<K, V>(config: LRUCacheConfig<K, V>): LRUCache<K, V> {
  return new LRUCache<K, V>(config);
}

/**
 * 创建带 TTL 的 LRU 缓存
 */
export function createTTLCache<K, V>(maxSize: number, ttlMs: number): LRUCache<K, V> {
  return new LRUCache<K, V>({ maxSize, ttl: ttlMs });
}

/**
 * 创建内存限制的 LRU 缓存
 */
export function createMemoryLimitedCache<K, V>(
  maxMemoryBytes: number,
  sizeCalculator: (value: V) => number
): LRUCache<K, V> {
  return new LRUCache<K, V>({
    maxSize: Number.MAX_SAFE_INTEGER,
    maxMemory: maxMemoryBytes,
    sizeCalculator,
  });
}

// ================================
// 便捷函数
// ================================

/**
 * 创建字符串值缓存（自动计算字符串大小）
 */
export function createStringCache(
  maxSize: number,
  maxMemoryBytes?: number
): LRUCache<string, string> {
  return new LRUCache<string, string>({
    maxSize,
    maxMemory: maxMemoryBytes,
    sizeCalculator: (value: string) => value.length * 2, // UTF-16 编码
  });
}

/**
 * 创建 JSON 对象缓存（自动计算序列化大小）
 */
export function createJSONCache<V>(maxSize: number, maxMemoryBytes?: number): LRUCache<string, V> {
  return new LRUCache<string, V>({
    maxSize,
    maxMemory: maxMemoryBytes,
    sizeCalculator: (value: V) => {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 1024; // 默认 1KB
      }
    },
  });
}

/**
 * 计算对象的估算内存大小
 */
export function estimateObjectSize(obj: unknown): number {
  const seen = new WeakSet();

  function sizeOf(value: unknown): number {
    if (value === null || value === undefined) return 0;

    const type = typeof value;

    switch (type) {
      case 'boolean':
        return 4;
      case 'number':
        return 8;
      case 'string':
        return (value as string).length * 2;
      case 'symbol':
        return 0;
      case 'function':
        return 0;
      case 'object': {
        if (seen.has(value as object)) return 0;
        seen.add(value as object);

        if (Array.isArray(value)) {
          return value.reduce((acc, item) => acc + sizeOf(item), 0);
        }

        if (value instanceof ArrayBuffer) {
          return value.byteLength;
        }

        if (ArrayBuffer.isView(value)) {
          return (value as ArrayBufferView).byteLength;
        }

        if (value instanceof Map || value instanceof Set) {
          let size = 0;
          for (const item of value) {
            size += sizeOf(item);
          }
          return size;
        }

        // 普通对象
        let size = 0;
        for (const key of Object.keys(value as object)) {
          size += key.length * 2;
          size += sizeOf((value as Record<string, unknown>)[key]);
        }
        return size;
      }
      default:
        return 0;
    }
  }

  return sizeOf(obj);
}
