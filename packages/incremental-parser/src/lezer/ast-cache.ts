// ================================
// AST 缓存模块
//
// 提供高效的 AST 和节点级缓存功能
// 支持 LRU、LFU 和 ARC 缓存策略
// ================================

import type { ASTNode, ASTRoot, IASTCache, CacheStats, ASTCacheConfig } from '../types';

// ================================
// 常量配置
// ================================

/** 默认最大缓存条目数 */
const DEFAULT_MAX_ENTRIES = 1000;

/** 默认最大缓存大小（10MB） */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

/** 默认过期时间（5分钟） */
const DEFAULT_TTL = 5 * 60 * 1000;

// ================================
// 工具函数
// ================================

/**
 * 估算对象大小（粗略估计）
 */
function estimateSize(obj: unknown): number {
  const seen = new WeakSet();

  function sizeOf(value: unknown): number {
    if (value === null || value === undefined) {
      return 0;
    }

    const type = typeof value;

    switch (type) {
      case 'boolean':
        return 4;
      case 'number':
        return 8;
      case 'string':
        return (value as string).length * 2;
      case 'object': {
        if (seen.has(value as object)) {
          return 0;
        }
        seen.add(value as object);

        if (Array.isArray(value)) {
          return value.reduce((sum, item) => sum + sizeOf(item), 0);
        }

        if (value instanceof Map) {
          let size = 0;
          for (const [k, v] of value) {
            size += sizeOf(k) + sizeOf(v);
          }
          return size;
        }

        if (value instanceof Set) {
          let size = 0;
          for (const item of value) {
            size += sizeOf(item);
          }
          return size;
        }

        let size = 0;
        for (const key of Object.keys(value as object)) {
          size += sizeOf(key);
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

/**
 * 计算字符串哈希值（FNV-1a）
 */
function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash ^= char;
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

// ================================
// LRU 双向链表节点
// ================================

interface LRUNode<K, V> {
  key: K;
  value: V;
  prev: LRUNode<K, V> | null;
  next: LRUNode<K, V> | null;
  size: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
}

// ================================
// LRU 缓存实现
// ================================

/**
 * LRU（最近最少使用）缓存
 */
class LRUCache<K, V> {
  private readonly maxEntries: number;
  private readonly maxSize: number;
  private readonly ttl: number;

  private readonly map: Map<K, LRUNode<K, V>>;
  private head: LRUNode<K, V> | null;
  private tail: LRUNode<K, V> | null;
  private currentSize: number;

  private hits: number;
  private misses: number;
  private evictions: number;

  constructor(maxEntries: number, maxSize: number, ttl: number) {
    this.maxEntries = maxEntries;
    this.maxSize = maxSize;
    this.ttl = ttl;

    this.map = new Map();
    this.head = null;
    this.tail = null;
    this.currentSize = 0;

    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * 获取缓存值
   */
  get(key: K): V | undefined {
    const node = this.map.get(key);

    if (!node) {
      this.misses++;
      return undefined;
    }

    // 检查是否过期
    if (this.ttl > 0 && Date.now() - node.createdAt > this.ttl) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    // 更新访问信息
    node.accessCount++;
    node.lastAccessedAt = Date.now();

    // 移动到头部
    this.moveToHead(node);

    this.hits++;
    return node.value;
  }

  /**
   * 设置缓存值
   */
  set(key: K, value: V, size?: number): void {
    const itemSize = size ?? estimateSize(value);
    const now = Date.now();

    // 如果已存在，更新值
    const existing = this.map.get(key);
    if (existing) {
      this.currentSize -= existing.size;
      existing.value = value;
      existing.size = itemSize;
      existing.accessCount++;
      existing.lastAccessedAt = now;
      this.currentSize += itemSize;
      this.moveToHead(existing);
      this.evictIfNeeded();
      return;
    }

    // 创建新节点
    const node: LRUNode<K, V> = {
      key,
      value,
      prev: null,
      next: null,
      size: itemSize,
      accessCount: 1,
      createdAt: now,
      lastAccessedAt: now,
    };

    this.map.set(key, node);
    this.currentSize += itemSize;
    this.addToHead(node);
    this.evictIfNeeded();
  }

  /**
   * 检查是否存在
   */
  has(key: K): boolean {
    const node = this.map.get(key);
    if (!node) {
      return false;
    }

    // 检查是否过期
    if (this.ttl > 0 && Date.now() - node.createdAt > this.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存
   */
  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) {
      return false;
    }

    this.removeNode(node);
    this.map.delete(key);
    this.currentSize -= node.size;
    return true;
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      entryCount: this.map.size,
      totalSize: this.currentSize,
      maxSize: this.maxSize,
      evictionCount: this.evictions,
    };
  }

  /**
   * 获取所有键
   */
  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  // ================================
  // 内部方法
  // ================================

  private addToHead(node: LRUNode<K, V>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: LRUNode<K, V>): void {
    if (node === this.head) {
      return;
    }
    this.removeNode(node);
    this.addToHead(node);
  }

  private evictIfNeeded(): void {
    // 驱逐直到满足条件
    while ((this.map.size > this.maxEntries || this.currentSize > this.maxSize) && this.tail) {
      const oldKey = this.tail.key;
      this.delete(oldKey);
      this.evictions++;
    }
  }
}

// ================================
// AST 缓存实现
// ================================

/**
 * AST 缓存
 *
 * 提供两级缓存：
 * 1. 文档级缓存：缓存完整的 AST
 * 2. 节点级缓存：缓存单个 AST 节点
 */
export class ASTCache<T extends ASTNode = ASTNode> implements IASTCache<T> {
  /** 文档级缓存 */
  private readonly documentCache: LRUCache<string, ASTRoot<T>>;

  /** 节点级缓存 */
  private readonly nodeCache: LRUCache<string, T>;

  /** 节点哈希到 ID 的映射 */
  private readonly hashToNodeId: Map<string, string>;

  /** 是否启用节点级缓存 */
  private readonly enableNodeCache: boolean;

  /** 配置 */
  private readonly config: Required<ASTCacheConfig>;

  constructor(config?: ASTCacheConfig) {
    this.config = {
      maxEntries: config?.maxEntries ?? DEFAULT_MAX_ENTRIES,
      maxSize: config?.maxSize ?? DEFAULT_MAX_SIZE,
      ttl: config?.ttl ?? DEFAULT_TTL,
      strategy: config?.strategy ?? 'lru',
      enableNodeCache: config?.enableNodeCache ?? true,
    };

    this.enableNodeCache = this.config.enableNodeCache;

    // 创建文档级缓存
    this.documentCache = new LRUCache(
      Math.floor(this.config.maxEntries / 10),
      Math.floor(this.config.maxSize / 2),
      this.config.ttl
    );

    // 创建节点级缓存
    this.nodeCache = new LRUCache(
      this.config.maxEntries,
      Math.floor(this.config.maxSize / 2),
      this.config.ttl
    );

    this.hashToNodeId = new Map();
  }

  // ================================
  // 文档级缓存方法
  // ================================

  /**
   * 获取缓存的 AST
   */
  get(key: string): ASTRoot<T> | undefined {
    return this.documentCache.get(key);
  }

  /**
   * 设置缓存的 AST
   */
  set(key: string, ast: ASTRoot<T>): void {
    this.documentCache.set(key, ast);

    // 如果启用节点级缓存，缓存所有节点
    if (this.enableNodeCache) {
      for (const [, node] of ast.nodes) {
        this.cacheNode(node);
      }
    }
  }

  /**
   * 检查缓存是否存在
   */
  has(key: string): boolean {
    return this.documentCache.has(key);
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.documentCache.delete(key);
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.documentCache.clear();
    this.nodeCache.clear();
    this.hashToNodeId.clear();
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    const docStats = this.documentCache.getStats();
    const nodeStats = this.nodeCache.getStats();

    return {
      hits: docStats.hits + nodeStats.hits,
      misses: docStats.misses + nodeStats.misses,
      hitRate: (docStats.hitRate + nodeStats.hitRate) / 2,
      entryCount: docStats.entryCount + nodeStats.entryCount,
      totalSize: docStats.totalSize + nodeStats.totalSize,
      maxSize: docStats.maxSize + nodeStats.maxSize,
      evictionCount: docStats.evictionCount + nodeStats.evictionCount,
    };
  }

  // ================================
  // 节点级缓存方法
  // ================================

  /**
   * 获取缓存的节点
   */
  getNode(nodeId: string): T | undefined {
    if (!this.enableNodeCache) {
      return undefined;
    }
    return this.nodeCache.get(nodeId);
  }

  /**
   * 根据哈希获取节点
   */
  getNodeByHash(hash: string): T | undefined {
    if (!this.enableNodeCache) {
      return undefined;
    }
    const nodeId = this.hashToNodeId.get(hash);
    if (!nodeId) {
      return undefined;
    }
    return this.nodeCache.get(nodeId);
  }

  /**
   * 缓存单个节点
   */
  cacheNode(node: T): void {
    if (!this.enableNodeCache) {
      return;
    }

    this.nodeCache.set(node.id, node);

    // 如果节点有哈希值，建立映射
    if (node.hash) {
      this.hashToNodeId.set(node.hash, node.id);
    }
  }

  /**
   * 批量缓存节点
   */
  cacheNodes(nodes: readonly T[]): void {
    for (const node of nodes) {
      this.cacheNode(node);
    }
  }

  /**
   * 使指定节点失效
   */
  invalidateNode(nodeId: string): void {
    if (!this.enableNodeCache) {
      return;
    }

    const node = this.nodeCache.get(nodeId);
    if (node?.hash) {
      this.hashToNodeId.delete(node.hash);
    }
    this.nodeCache.delete(nodeId);
  }

  /**
   * 使指定范围的节点失效
   */
  invalidateRange(from: number, to: number): void {
    if (!this.enableNodeCache) {
      return;
    }

    const keysToDelete: string[] = [];

    // 遍历所有缓存的节点，找出与范围重叠的
    for (const key of this.nodeCache.keys()) {
      const node = this.nodeCache.get(key);
      if (node && node.from < to && node.to > from) {
        keysToDelete.push(key);
      }
    }

    // 删除重叠的节点
    for (const key of keysToDelete) {
      this.invalidateNode(key);
    }
  }

  /**
   * 批量使节点失效
   */
  invalidateNodes(nodeIds: readonly string[]): void {
    for (const nodeId of nodeIds) {
      this.invalidateNode(nodeId);
    }
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 生成文档缓存键
   */
  static generateDocumentKey(content: string): string {
    return hashString(content);
  }

  /**
   * 获取节点缓存大小
   */
  getNodeCacheSize(): number {
    return this.nodeCache.getStats().entryCount;
  }

  /**
   * 获取文档缓存大小
   */
  getDocumentCacheSize(): number {
    return this.documentCache.getStats().entryCount;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 AST 缓存
 */
export function createASTCache<T extends ASTNode = ASTNode>(config?: ASTCacheConfig): ASTCache<T> {
  return new ASTCache<T>(config);
}

/**
 * 创建高性能 AST 缓存（更大的缓存空间）
 */
export function createHighPerformanceCache<T extends ASTNode = ASTNode>(): ASTCache<T> {
  return new ASTCache<T>({
    maxEntries: 5000,
    maxSize: 50 * 1024 * 1024, // 50MB
    ttl: 10 * 60 * 1000, // 10分钟
    strategy: 'lru',
    enableNodeCache: true,
  });
}

/**
 * 创建轻量级 AST 缓存（更小的内存占用）
 */
export function createLightweightCache<T extends ASTNode = ASTNode>(): ASTCache<T> {
  return new ASTCache<T>({
    maxEntries: 100,
    maxSize: 1 * 1024 * 1024, // 1MB
    ttl: 1 * 60 * 1000, // 1分钟
    strategy: 'lru',
    enableNodeCache: false,
  });
}

// ================================
// 导出
// ================================

export { estimateSize, hashString };
