// ================================
// AST 缓存管理器
//
// 统一的 AST 和内容缓存管理，解决多处重复缓存导致的 OOM 问题
//
// 核心特性：
// 1. 单例模式：全局唯一缓存实例，消除重复缓存
// 2. 零拷贝字符串引用：AST 节点不存储 raw 字符串，只存储偏移量
// 3. 弱引用支持：对于大型对象使用 WeakRef，允许 GC 回收
// 4. 流式处理：支持分块处理，及时释放中间结果
// 5. 内存压力感知：根据内存压力自动调整缓存策略
// ================================

// TypeScript 类型声明（ES2021+ 内置，但需要显式声明以兼容旧目标）
declare class WeakRef<T extends object> {
  constructor(target: T);
  deref(): T | undefined;
}

declare class FinalizationRegistry<T> {
  constructor(callback: (heldValue: T) => void);
  register(target: object, heldValue: T, unregisterToken?: object): void;
  unregister(unregisterToken: object): void;
}

import type { RootNode, LatexNode, PreambleNode } from './types';

// ================================
// 类型定义
// ================================

/**
 * 零拷贝字符串切片
 * 不存储实际字符串内容，只存储在源文档中的位置引用
 */
export interface StringSlice {
  /** 起始偏移量 */
  start: number;
  /** 结束偏移量 */
  end: number;
}

/**
 * 轻量级 AST 节点
 * 不存储 raw 字符串，使用 StringSlice 引用源文档
 */
export interface LightweightNode {
  /** 节点类型 */
  type: string;
  /** 节点 ID */
  id: string;
  /** 源码位置（零拷贝引用） */
  slice: StringSlice;
  /** 节点哈希（基于位置和类型计算，不需要 raw 内容） */
  hash: string;
  /** 子节点 ID 列表（不直接存储子节点，避免重复引用） */
  childIds?: string[];
  /** 其他属性（不包含 raw） */
  props?: Record<string, unknown>;
}

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  /** 内容哈希 */
  contentHash: string;
  /** 缓存数据 */
  data: T;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后访问时间 */
  lastAccessAt: number;
  /** 访问次数 */
  accessCount: number;
  /** 估算内存大小（字节） */
  estimatedSize: number;
}

/**
 * 弱引用缓存条目
 */
interface WeakCacheEntry<T extends object> {
  /** 内容哈希 */
  contentHash: string;
  /** 弱引用数据 */
  ref: WeakRef<T>;
  /** 创建时间戳 */
  createdAt: number;
  /** 终结器注册表 */
  registry?: FinalizationRegistry<string>;
}

/**
 * 缓存配置
 */
export interface ASTCacheConfig {
  /** 最大 AST 缓存数 */
  maxASTCount: number;
  /** 最大节点缓存数 */
  maxNodeCount: number;
  /** 最大内存使用（字节） */
  maxMemoryBytes: number;
  /** 缓存过期时间（毫秒） */
  ttlMs: number;
  /** 是否启用弱引用 */
  useWeakRefs: boolean;
  /** 是否启用零拷贝 */
  useZeroCopy: boolean;
  /** 调试模式 */
  debug: boolean;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  /** AST 缓存数量 */
  astCount: number;
  /** 节点缓存数量 */
  nodeCount: number;
  /** 估算内存使用（字节） */
  estimatedMemory: number;
  /** 缓存命中次数 */
  hits: number;
  /** 缓存未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 被 GC 回收的弱引用数量 */
  weakRefCollected: number;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: ASTCacheConfig = {
  maxASTCount: 3, // 最多缓存 3 个 AST（当前、上一个、上上个）
  maxNodeCount: 200, // 最多缓存 200 个节点
  maxMemoryBytes: 10 * 1024 * 1024, // 10MB
  ttlMs: 60 * 1000, // 1 分钟过期
  useWeakRefs: true, // 启用弱引用
  useZeroCopy: true, // 启用零拷贝
  debug: false,
};

// ================================
// 工具函数
// ================================

/**
 * 快速哈希计算（FNV-1a）
 */
function fnv1aHash(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/**
 * 计算内容哈希
 *
 * 策略说明：
 * - 小文件 (< 50KB)：完整哈希，确保任何微小变化都能被检测到
 * - 中等文件 (50KB - 200KB)：密集采样 + 完整尾部，确保大部分变化能被检测到
 * - 大文件 (> 200KB)：稀疏采样，平衡性能和准确性
 *
 * 注意：之前对 10-100KB 文件使用稀疏采样导致了渲染不更新的问题
 * （例如 &=4 改成 &=3 不会更新），因为变化可能落在采样间隙中
 */
function computeContentHash(content: string): string {
  const len = content.length;

  // 对于小文件（< 50KB），直接计算完整哈希以确保准确性
  // 这是最重要的修复：之前阈值太低（10KB），导致中等文件使用采样哈希
  // 而采样间隙可能跳过用户的修改
  if (len < 50 * 1024) {
    return fnv1aHash(content);
  }

  // 对于中等文件（50KB - 200KB），使用更密集的采样
  // 每 256 字节采样 128 字节（50% 覆盖率），确保能检测到大部分变化
  if (len < 200 * 1024) {
    const samples: string[] = [];
    const sampleInterval = 256;
    const sampleSize = 128;

    for (let i = 0; i < len; i += sampleInterval) {
      samples.push(content.slice(i, Math.min(i + sampleSize, len)));
    }
    // 添加完整的尾部（最后 1KB）和长度
    samples.push(content.slice(-1024));
    samples.push(len.toString());

    return fnv1aHash(samples.join('|'));
  }

  // 对于大文件（> 200KB），使用稀疏采样但仍保证合理覆盖
  // 头部 1KB + 每 2KB 采样 128 字节 + 尾部 1KB + 长度
  const samples: string[] = [content.slice(0, 1024)];
  const sampleInterval = 2048;
  const sampleSize = 128;

  for (let i = sampleInterval; i < len - 1024; i += sampleInterval) {
    samples.push(content.slice(i, i + sampleSize));
  }

  samples.push(content.slice(-1024));
  samples.push(len.toString());

  return fnv1aHash(samples.join('|'));
}

/**
 * 估算对象内存大小（粗略估算）
 */
function estimateObjectSize(obj: unknown, visited = new WeakSet<object>()): number {
  if (obj === null || obj === undefined) return 0;

  const type = typeof obj;

  switch (type) {
    case 'boolean':
      return 4;
    case 'number':
      return 8;
    case 'string':
      return (obj as string).length * 2; // UTF-16
    case 'object': {
      const objRef = obj as object;

      // 避免循环引用
      if (visited.has(objRef)) return 0;
      visited.add(objRef);

      if (Array.isArray(objRef)) {
        let size = 32; // 数组开销
        for (const item of objRef) {
          size += estimateObjectSize(item, visited);
        }
        return size;
      }

      let size = 64; // 对象开销
      for (const key in objRef) {
        if (Object.prototype.hasOwnProperty.call(objRef, key)) {
          size += key.length * 2; // 键名
          size += estimateObjectSize((objRef as Record<string, unknown>)[key], visited);
        }
      }
      return size;
    }
    default:
      return 8;
  }
}

// ================================
// 零拷贝源文档管理器
// ================================

/**
 * 源文档管理器
 * 只存储一份源文档，所有 AST 节点通过 slice 引用
 */
class SourceDocumentManager {
  private currentContent: string = '';
  private contentHash: string = '';
  private lineOffsets: number[] = [];

  /**
   * 设置当前文档内容
   */
  setContent(content: string): string {
    if (content === this.currentContent) {
      return this.contentHash;
    }

    this.currentContent = content;
    this.contentHash = computeContentHash(content);
    this.computeLineOffsets();

    return this.contentHash;
  }

  /**
   * 获取当前内容
   */
  getContent(): string {
    return this.currentContent;
  }

  /**
   * 获取当前内容哈希
   */
  getContentHash(): string {
    return this.contentHash;
  }

  /**
   * 获取切片内容（零拷贝读取）
   */
  getSlice(slice: StringSlice): string {
    return this.currentContent.slice(slice.start, slice.end);
  }

  /**
   * 获取指定偏移量对应的行号
   */
  getLineFromOffset(offset: number): number {
    if (this.lineOffsets.length === 0) return 1;

    let low = 0;
    let high = this.lineOffsets.length - 1;

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.lineOffsets[mid] > offset) {
        high = mid - 1;
      } else {
        low = mid;
      }
    }

    return low + 1;
  }

  /**
   * 获取总行数
   */
  getLineCount(): number {
    return this.lineOffsets.length;
  }

  /**
   * 获取内容长度
   */
  getLength(): number {
    return this.currentContent.length;
  }

  /**
   * 清空
   */
  clear(): void {
    this.currentContent = '';
    this.contentHash = '';
    this.lineOffsets = [];
  }

  /**
   * 计算行偏移量
   */
  private computeLineOffsets(): void {
    this.lineOffsets = [0];
    for (let i = 0; i < this.currentContent.length; i++) {
      if (this.currentContent[i] === '\n') {
        this.lineOffsets.push(i + 1);
      }
    }
  }
}

// ================================
// AST 缓存管理器（单例）
// ================================

/** 转换轻量级节点时不进入 props 的字段（基础字段已单独存储，raw 不存储以节省内存） */
const LIGHTWEIGHT_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  'type',
  'id',
  'start',
  'end',
  'raw',
  'hash',
  'children',
]);

/**
 * AST 缓存管理器
 *
 * 统一管理所有 AST 和节点缓存，避免重复缓存导致 OOM
 */
class ASTCacheManagerImpl {
  private config: ASTCacheConfig;

  // 源文档管理器（零拷贝）
  private sourceManager: SourceDocumentManager;

  // AST 缓存（强引用，LRU）
  private astCache: Map<string, CacheEntry<RootNode>>;

  // AST 弱引用缓存
  private weakASTCache: Map<string, WeakCacheEntry<RootNode>>;

  // 节点缓存（基于哈希的去重）
  private nodeCache: Map<string, CacheEntry<LightweightNode>>;

  // Preamble 缓存（通常不变，单独缓存）
  private preambleCache: CacheEntry<PreambleNode> | null = null;

  // 终结器注册表（用于追踪弱引用被回收）
  private finalizationRegistry: FinalizationRegistry<string>;

  // 统计
  private hits: number = 0;
  private misses: number = 0;
  private weakRefCollected: number = 0;

  constructor(config?: Partial<ASTCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.sourceManager = new SourceDocumentManager();
    this.astCache = new Map();
    this.weakASTCache = new Map();
    this.nodeCache = new Map();

    // 创建终结器注册表
    this.finalizationRegistry = new FinalizationRegistry((hash: string) => {
      this.weakRefCollected++;
      this.weakASTCache.delete(hash);
      if (this.config.debug) {
        console.log(`[ASTCacheManager] 弱引用被 GC 回收: ${hash}`);
      }
    });
  }

  // ================================
  // 源文档管理
  // ================================

  /**
   * 设置源文档内容
   * @returns 内容哈希
   */
  setSourceContent(content: string): string {
    return this.sourceManager.setContent(content);
  }

  /**
   * 获取源文档内容
   */
  getSourceContent(): string {
    return this.sourceManager.getContent();
  }

  /**
   * 获取源文档哈希
   */
  getSourceHash(): string {
    return this.sourceManager.getContentHash();
  }

  /**
   * 从源文档获取切片（零拷贝）
   */
  getSlice(start: number, end: number): string {
    return this.sourceManager.getSlice({ start, end });
  }

  /**
   * 获取节点的 raw 内容（零拷贝）
   */
  getNodeRaw(node: LatexNode): string {
    return this.sourceManager.getSlice({ start: node.start, end: node.end });
  }

  /**
   * 获取行号
   */
  getLineFromOffset(offset: number): number {
    return this.sourceManager.getLineFromOffset(offset);
  }

  /**
   * 获取总行数
   */
  getLineCount(): number {
    return this.sourceManager.getLineCount();
  }

  // ================================
  // AST 缓存
  // ================================

  /**
   * 缓存 AST
   */
  cacheAST(contentHash: string, ast: RootNode): void {
    const now = Date.now();
    const estimatedSize = estimateObjectSize(ast);

    // 检查是否需要驱逐
    this.evictIfNeeded(estimatedSize);

    // 从旧 AST 移动到弱引用（如果启用）
    if (this.config.useWeakRefs && this.astCache.size >= this.config.maxASTCount) {
      const oldestKey = this.astCache.keys().next().value;
      if (oldestKey) {
        const oldEntry = this.astCache.get(oldestKey);
        if (oldEntry) {
          // 移动到弱引用缓存
          const weakRef = new WeakRef(oldEntry.data);
          this.weakASTCache.set(oldestKey, {
            contentHash: oldEntry.contentHash,
            ref: weakRef,
            createdAt: oldEntry.createdAt,
          });
          this.finalizationRegistry.register(oldEntry.data, oldestKey);
          this.astCache.delete(oldestKey);

          if (this.config.debug) {
            console.log(`[ASTCacheManager] AST 降级为弱引用: ${oldestKey}`);
          }
        }
      }
    }

    // 添加新缓存
    this.astCache.set(contentHash, {
      contentHash,
      data: ast,
      createdAt: now,
      lastAccessAt: now,
      accessCount: 1,
      estimatedSize,
    });

    // 如果超出限制，删除最老的
    while (this.astCache.size > this.config.maxASTCount) {
      const firstKey = this.astCache.keys().next().value;
      if (firstKey) {
        this.astCache.delete(firstKey);
      }
    }

    if (this.config.debug) {
      console.log(
        `[ASTCacheManager] 缓存 AST: ${contentHash}, 大小: ${(estimatedSize / 1024).toFixed(1)}KB`
      );
    }
  }

  /**
   * 获取缓存的 AST
   */
  getAST(contentHash: string): RootNode | null {
    // 首先检查强引用缓存
    const entry = this.astCache.get(contentHash);
    if (entry) {
      entry.lastAccessAt = Date.now();
      entry.accessCount++;
      this.hits++;
      return entry.data;
    }

    // 检查弱引用缓存
    const weakEntry = this.weakASTCache.get(contentHash);
    if (weakEntry) {
      const ast = weakEntry.ref.deref();
      if (ast) {
        this.hits++;
        // 提升回强引用
        this.cacheAST(contentHash, ast);
        this.weakASTCache.delete(contentHash);
        return ast;
      } else {
        // 已被 GC 回收
        this.weakASTCache.delete(contentHash);
      }
    }

    this.misses++;
    return null;
  }

  /**
   * 检查是否有缓存的 AST
   */
  hasAST(contentHash: string): boolean {
    if (this.astCache.has(contentHash)) return true;

    const weakEntry = this.weakASTCache.get(contentHash);
    if (weakEntry) {
      return weakEntry.ref.deref() !== undefined;
    }

    return false;
  }

  // ================================
  // Preamble 缓存
  // ================================

  /**
   * 缓存 Preamble
   */
  cachePreamble(preamble: PreambleNode, contentHash: string): void {
    const now = Date.now();
    this.preambleCache = {
      contentHash,
      data: preamble,
      createdAt: now,
      lastAccessAt: now,
      accessCount: 1,
      estimatedSize: estimateObjectSize(preamble),
    };
  }

  /**
   * 获取缓存的 Preamble
   */
  getPreamble(contentHash: string): PreambleNode | null {
    if (this.preambleCache && this.preambleCache.contentHash === contentHash) {
      this.preambleCache.lastAccessAt = Date.now();
      this.preambleCache.accessCount++;
      return this.preambleCache.data;
    }
    return null;
  }

  // ================================
  // 节点缓存（轻量级）
  // ================================

  /**
   * 将普通节点转换为轻量级节点
   */
  toLightweightNode(node: LatexNode): LightweightNode {
    const lightweight: LightweightNode = {
      type: node.type,
      id: node.id,
      slice: { start: node.start, end: node.end },
      hash: fnv1aHash(`${node.type}:${node.start}:${node.end}`),
    };

    // 收集子节点 ID
    if (node.children) {
      lightweight.childIds = node.children.map((c) => c.id);
    }

    // 保存非 raw 的属性（各具体节点类型的扩展字段，如 content、level、args 等）
    const props: Record<string, unknown> = {};
    const entries: Array<[string, unknown]> = Object.entries(node);
    for (const [key, value] of entries) {
      if (!LIGHTWEIGHT_EXCLUDED_KEYS.has(key)) {
        props[key] = value;
      }
    }
    if (Object.keys(props).length > 0) {
      lightweight.props = props;
    }

    return lightweight;
  }

  /**
   * 缓存轻量级节点
   */
  cacheNode(node: LightweightNode): void {
    const now = Date.now();

    // 检查是否需要驱逐
    if (this.nodeCache.size >= this.config.maxNodeCount) {
      // 删除最老的条目
      const firstKey = this.nodeCache.keys().next().value;
      if (firstKey) {
        this.nodeCache.delete(firstKey);
      }
    }

    this.nodeCache.set(node.id, {
      contentHash: node.hash,
      data: node,
      createdAt: now,
      lastAccessAt: now,
      accessCount: 1,
      estimatedSize: 100, // 轻量级节点大约 100 字节
    });
  }

  /**
   * 获取缓存的轻量级节点
   */
  getNode(nodeId: string): LightweightNode | null {
    const entry = this.nodeCache.get(nodeId);
    if (entry) {
      entry.lastAccessAt = Date.now();
      entry.accessCount++;
      return entry.data;
    }
    return null;
  }

  // ================================
  // 内存管理
  // ================================

  /**
   * 检查并驱逐缓存
   */
  private evictIfNeeded(additionalSize: number): void {
    const stats = this.getStats();
    const targetMemory = stats.estimatedMemory + additionalSize;

    if (targetMemory <= this.config.maxMemoryBytes) {
      return;
    }

    if (this.config.debug) {
      console.log(
        `[ASTCacheManager] 内存超限，开始驱逐: ${(targetMemory / 1024 / 1024).toFixed(1)}MB > ${(this.config.maxMemoryBytes / 1024 / 1024).toFixed(1)}MB`
      );
    }

    // 按最后访问时间排序，删除最老的
    const entries = Array.from(this.astCache.entries()).sort(
      (a, b) => a[1].lastAccessAt - b[1].lastAccessAt
    );

    let freedMemory = 0;
    const targetFree = targetMemory - this.config.maxMemoryBytes * 0.8; // 释放到 80%

    for (const [key, entry] of entries) {
      if (freedMemory >= targetFree) break;

      // 移动到弱引用而不是直接删除
      if (this.config.useWeakRefs) {
        const weakRef = new WeakRef(entry.data);
        this.weakASTCache.set(key, {
          contentHash: entry.contentHash,
          ref: weakRef,
          createdAt: entry.createdAt,
        });
        this.finalizationRegistry.register(entry.data, key);
      }

      this.astCache.delete(key);
      freedMemory += entry.estimatedSize;
    }

    // 如果还不够，清理节点缓存
    if (freedMemory < targetFree) {
      const nodeEntries = Array.from(this.nodeCache.entries()).sort(
        (a, b) => a[1].lastAccessAt - b[1].lastAccessAt
      );

      for (const [key, entry] of nodeEntries) {
        if (freedMemory >= targetFree) break;
        this.nodeCache.delete(key);
        freedMemory += entry.estimatedSize;
      }
    }

    if (this.config.debug) {
      console.log(`[ASTCacheManager] 释放内存: ${(freedMemory / 1024).toFixed(1)}KB`);
    }
  }

  /**
   * 激进清理（内存压力大时调用）
   */
  aggressiveCleanup(): void {
    if (this.config.debug) {
      console.log('[ASTCacheManager] 执行激进清理');
    }

    // 只保留最新的 AST
    const entries = Array.from(this.astCache.entries()).sort(
      (a, b) => b[1].lastAccessAt - a[1].lastAccessAt
    );

    // 保留最新的一个
    for (let i = 1; i < entries.length; i++) {
      const [key, entry] = entries[i];
      if (this.config.useWeakRefs) {
        const weakRef = new WeakRef(entry.data);
        this.weakASTCache.set(key, {
          contentHash: entry.contentHash,
          ref: weakRef,
          createdAt: entry.createdAt,
        });
        this.finalizationRegistry.register(entry.data, key);
      }
      this.astCache.delete(key);
    }

    // 清理 80% 的节点缓存
    const nodesToRemove = Math.floor(this.nodeCache.size * 0.8);
    let removed = 0;
    for (const key of this.nodeCache.keys()) {
      if (removed >= nodesToRemove) break;
      this.nodeCache.delete(key);
      removed++;
    }

    // 清理 preamble 缓存
    this.preambleCache = null;
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.astCache.clear();
    this.weakASTCache.clear();
    this.nodeCache.clear();
    this.preambleCache = null;
    this.sourceManager.clear();
    this.hits = 0;
    this.misses = 0;

    if (this.config.debug) {
      console.log('[ASTCacheManager] 所有缓存已清空');
    }
  }

  /**
   * 清理过期缓存
   */
  cleanupExpired(): void {
    const now = Date.now();
    const ttl = this.config.ttlMs;

    // 清理过期的 AST
    for (const [key, entry] of this.astCache.entries()) {
      if (now - entry.lastAccessAt > ttl) {
        if (this.config.useWeakRefs) {
          const weakRef = new WeakRef(entry.data);
          this.weakASTCache.set(key, {
            contentHash: entry.contentHash,
            ref: weakRef,
            createdAt: entry.createdAt,
          });
          this.finalizationRegistry.register(entry.data, key);
        }
        this.astCache.delete(key);
      }
    }

    // 清理过期的节点
    for (const [key, entry] of this.nodeCache.entries()) {
      if (now - entry.lastAccessAt > ttl) {
        this.nodeCache.delete(key);
      }
    }

    // 清理过期的 preamble
    if (this.preambleCache && now - this.preambleCache.lastAccessAt > ttl) {
      this.preambleCache = null;
    }
  }

  // ================================
  // 统计
  // ================================

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    let estimatedMemory = 0;

    for (const entry of this.astCache.values()) {
      estimatedMemory += entry.estimatedSize;
    }

    for (const entry of this.nodeCache.values()) {
      estimatedMemory += entry.estimatedSize;
    }

    if (this.preambleCache) {
      estimatedMemory += this.preambleCache.estimatedSize;
    }

    // 源文档内存
    estimatedMemory += this.sourceManager.getLength() * 2;

    const total = this.hits + this.misses;

    return {
      astCount: this.astCache.size,
      nodeCount: this.nodeCache.size,
      estimatedMemory,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      weakRefCollected: this.weakRefCollected,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): ASTCacheConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ASTCacheConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ================================
// 单例管理
// ================================

let globalCacheManager: ASTCacheManagerImpl | null = null;

/**
 * 获取全局 AST 缓存管理器
 */
export function getASTCacheManager(config?: Partial<ASTCacheConfig>): ASTCacheManagerImpl {
  if (!globalCacheManager) {
    globalCacheManager = new ASTCacheManagerImpl(config);
  }
  return globalCacheManager;
}

/**
 * 销毁全局缓存管理器
 */
export function destroyASTCacheManager(): void {
  if (globalCacheManager) {
    globalCacheManager.clear();
    globalCacheManager = null;
  }
}

/**
 * 重置缓存管理器（用于测试）
 */
export function resetASTCacheManager(config?: Partial<ASTCacheConfig>): ASTCacheManagerImpl {
  destroyASTCacheManager();
  return getASTCacheManager(config);
}

// ================================
// 导出类型
// ================================

export type ASTCacheManager = ASTCacheManagerImpl;
