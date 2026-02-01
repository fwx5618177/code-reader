// ================================
// 高性能对象池管理器
// 用于复用 AST 节点和渲染块对象，减少 GC 压力
// ================================

/**
 * 对象池配置
 */
export interface PoolConfig {
  /** 池的最大容量 */
  maxSize: number;
  /** 预分配数量 */
  preAllocate: number;
  /** 是否启用统计 */
  enableStats: boolean;
  /** 自动收缩阈值（空闲对象占比超过此值时收缩） */
  shrinkThreshold: number;
  /** 收缩检查间隔（毫秒） */
  shrinkInterval: number;
}

/**
 * 对象池统计信息
 */
export interface PoolStats {
  /** 池中对象总数 */
  totalObjects: number;
  /** 可用对象数 */
  availableObjects: number;
  /** 已借出对象数 */
  borrowedObjects: number;
  /** 创建次数 */
  createCount: number;
  /** 复用次数 */
  reuseCount: number;
  /** 释放次数 */
  releaseCount: number;
  /** 复用率 */
  reuseRate: number;
}

/**
 * 可池化对象接口
 */
export interface Poolable {
  /** 重置对象状态以便复用 */
  reset(): void;
  /** 对象是否可复用 */
  isReusable(): boolean;
}

/**
 * 默认池配置
 */
const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxSize: 1000,
  preAllocate: 50,
  enableStats: true,
  shrinkThreshold: 0.8,
  shrinkInterval: 30000, // 30秒
};

/**
 * 通用对象池
 * 使用工厂模式创建对象，支持自动收缩和统计
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private borrowed: Set<T> = new Set();
  private readonly config: PoolConfig;
  private readonly factory: () => T;
  private readonly reset: (obj: T) => void;
  private readonly validate: (obj: T) => boolean;

  // 统计信息
  private createCount = 0;
  private reuseCount = 0;
  private releaseCount = 0;

  // 自动收缩定时器
  private shrinkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    factory: () => T,
    reset: (obj: T) => void,
    validate: (obj: T) => boolean = () => true,
    config: Partial<PoolConfig> = {}
  ) {
    this.factory = factory;
    this.reset = reset;
    this.validate = validate;
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };

    // 预分配对象
    this.preAllocate();

    // 启动自动收缩
    if (this.config.shrinkInterval > 0) {
      this.startAutoShrink();
    }
  }

  /**
   * 预分配对象
   */
  private preAllocate(): void {
    for (let i = 0; i < this.config.preAllocate; i++) {
      this.pool.push(this.createNew());
    }
  }

  /**
   * 创建新对象
   */
  private createNew(): T {
    this.createCount++;
    return this.factory();
  }

  /**
   * 从池中获取对象
   */
  acquire(): T {
    let obj: T | undefined;

    // 尝试从池中获取可用对象
    while (this.pool.length > 0) {
      obj = this.pool.pop();
      if (obj && this.validate(obj)) {
        this.reuseCount++;
        this.borrowed.add(obj);
        return obj;
      }
      // 对象不可用，丢弃并继续
    }

    // 池为空或所有对象不可用，创建新对象
    obj = this.createNew();
    this.borrowed.add(obj);
    return obj;
  }

  /**
   * 归还对象到池中
   */
  release(obj: T): void {
    if (!this.borrowed.has(obj)) {
      // 对象不是从本池借出的，忽略
      return;
    }

    this.borrowed.delete(obj);
    this.releaseCount++;

    // 重置对象
    try {
      this.reset(obj);
    } catch (e) {
      // 重置失败，不放回池中
      console.warn('[ObjectPool] 对象重置失败:', e);
      return;
    }

    // 检查池是否已满
    if (this.pool.length < this.config.maxSize) {
      this.pool.push(obj);
    }
    // 否则丢弃对象（让 GC 回收）
  }

  /**
   * 批量获取对象
   */
  acquireBatch(count: number): T[] {
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.acquire());
    }
    return result;
  }

  /**
   * 批量归还对象
   */
  releaseBatch(objects: T[]): void {
    for (const obj of objects) {
      this.release(obj);
    }
  }

  /**
   * 清空池
   */
  clear(): void {
    this.pool.length = 0;
    this.borrowed.clear();
  }

  /**
   * 收缩池（释放多余对象）
   */
  shrink(): void {
    const total = this.pool.length + this.borrowed.size;
    if (total === 0) return;

    const idleRatio = this.pool.length / total;
    if (idleRatio > this.config.shrinkThreshold) {
      // 保留一半的空闲对象
      const targetSize = Math.max(
        this.config.preAllocate,
        Math.floor(this.pool.length / 2)
      );
      this.pool.length = targetSize;
    }
  }

  /**
   * 启动自动收缩
   */
  private startAutoShrink(): void {
    this.shrinkTimer = setInterval(() => {
      this.shrink();
    }, this.config.shrinkInterval);
  }

  /**
   * 停止自动收缩
   */
  private stopAutoShrink(): void {
    if (this.shrinkTimer) {
      clearInterval(this.shrinkTimer);
      this.shrinkTimer = null;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): PoolStats {
    const totalOperations = this.createCount + this.reuseCount;
    return {
      totalObjects: this.pool.length + this.borrowed.size,
      availableObjects: this.pool.length,
      borrowedObjects: this.borrowed.size,
      createCount: this.createCount,
      reuseCount: this.reuseCount,
      releaseCount: this.releaseCount,
      reuseRate: totalOperations > 0 ? this.reuseCount / totalOperations : 0,
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.createCount = 0;
    this.reuseCount = 0;
    this.releaseCount = 0;
  }

  /**
   * 销毁池
   */
  destroy(): void {
    this.stopAutoShrink();
    this.clear();
  }
}

// ================================
// AST 节点池
// ================================

/**
 * AST 节点对象（可池化）
 */
export interface PoolableASTNode {
  type: string;
  id: string;
  start: number;
  end: number;
  raw: string;
  hash: string;
  children?: PoolableASTNode[];
  content?: string;
  name?: string;
  // 其他可选属性...
  [key: string]: unknown;
}

/**
 * 创建 AST 节点对象
 */
function createASTNode(): PoolableASTNode {
  return {
    type: '',
    id: '',
    start: 0,
    end: 0,
    raw: '',
    hash: '',
    children: undefined,
    content: undefined,
    name: undefined,
  };
}

/**
 * 重置 AST 节点对象
 */
function resetASTNode(node: PoolableASTNode): void {
  node.type = '';
  node.id = '';
  node.start = 0;
  node.end = 0;
  node.raw = '';
  node.hash = '';
  node.children = undefined;
  node.content = undefined;
  node.name = undefined;

  // 清除其他动态属性
  const knownKeys = new Set([
    'type',
    'id',
    'start',
    'end',
    'raw',
    'hash',
    'children',
    'content',
    'name',
  ]);
  for (const key of Object.keys(node)) {
    if (!knownKeys.has(key)) {
      delete node[key];
    }
  }
}

/**
 * 验证 AST 节点对象
 */
function validateASTNode(node: PoolableASTNode): boolean {
  return node !== null && typeof node === 'object';
}

/**
 * AST 节点池（单例）
 */
class ASTNodePoolManager {
  private static instance: ASTNodePoolManager | null = null;
  private pool: ObjectPool<PoolableASTNode>;

  private constructor() {
    this.pool = new ObjectPool(
      createASTNode,
      resetASTNode,
      validateASTNode,
      {
        maxSize: 5000,
        preAllocate: 100,
        enableStats: true,
        shrinkThreshold: 0.7,
        shrinkInterval: 60000,
      }
    );
  }

  static getInstance(): ASTNodePoolManager {
    if (!ASTNodePoolManager.instance) {
      ASTNodePoolManager.instance = new ASTNodePoolManager();
    }
    return ASTNodePoolManager.instance;
  }

  /**
   * 获取一个 AST 节点
   */
  acquire(): PoolableASTNode {
    return this.pool.acquire();
  }

  /**
   * 归还一个 AST 节点
   */
  release(node: PoolableASTNode): void {
    // 递归释放子节点
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        this.release(child);
      }
    }
    this.pool.release(node);
  }

  /**
   * 批量获取 AST 节点
   */
  acquireBatch(count: number): PoolableASTNode[] {
    return this.pool.acquireBatch(count);
  }

  /**
   * 批量归还 AST 节点（不递归释放子节点）
   */
  releaseBatch(nodes: PoolableASTNode[]): void {
    this.pool.releaseBatch(nodes);
  }

  /**
   * 递归释放一棵 AST 树
   */
  releaseTree(root: PoolableASTNode): void {
    this.release(root);
  }

  /**
   * 获取统计信息
   */
  getStats(): PoolStats {
    return this.pool.getStats();
  }

  /**
   * 清空池
   */
  clear(): void {
    this.pool.clear();
  }

  /**
   * 销毁池
   */
  destroy(): void {
    this.pool.destroy();
    ASTNodePoolManager.instance = null;
  }
}

// ================================
// 渲染块池
// ================================

/**
 * 渲染块对象（可池化）
 */
export interface PoolableRenderBlock {
  id: string;
  nodeId: string;
  type: string;
  html: string;
  estimatedHeight: number;
  actualHeight: number;
  top: number;
  visible: boolean;
  dirty: boolean;
  priority: number;
  sourceStartLine: number;
  sourceEndLine: number;
  sourceStartOffset: number;
  sourceEndOffset: number;
}

/**
 * 创建渲染块对象
 */
function createRenderBlock(): PoolableRenderBlock {
  return {
    id: '',
    nodeId: '',
    type: '',
    html: '',
    estimatedHeight: 0,
    actualHeight: 0,
    top: 0,
    visible: false,
    dirty: true,
    priority: 0,
    sourceStartLine: 0,
    sourceEndLine: 0,
    sourceStartOffset: 0,
    sourceEndOffset: 0,
  };
}

/**
 * 重置渲染块对象
 */
function resetRenderBlock(block: PoolableRenderBlock): void {
  block.id = '';
  block.nodeId = '';
  block.type = '';
  block.html = '';
  block.estimatedHeight = 0;
  block.actualHeight = 0;
  block.top = 0;
  block.visible = false;
  block.dirty = true;
  block.priority = 0;
  block.sourceStartLine = 0;
  block.sourceEndLine = 0;
  block.sourceStartOffset = 0;
  block.sourceEndOffset = 0;
}

/**
 * 验证渲染块对象
 */
function validateRenderBlock(block: PoolableRenderBlock): boolean {
  return block !== null && typeof block === 'object';
}

/**
 * 渲染块池（单例）
 */
class RenderBlockPoolManager {
  private static instance: RenderBlockPoolManager | null = null;
  private pool: ObjectPool<PoolableRenderBlock>;

  private constructor() {
    this.pool = new ObjectPool(
      createRenderBlock,
      resetRenderBlock,
      validateRenderBlock,
      {
        maxSize: 2000,
        preAllocate: 50,
        enableStats: true,
        shrinkThreshold: 0.7,
        shrinkInterval: 60000,
      }
    );
  }

  static getInstance(): RenderBlockPoolManager {
    if (!RenderBlockPoolManager.instance) {
      RenderBlockPoolManager.instance = new RenderBlockPoolManager();
    }
    return RenderBlockPoolManager.instance;
  }

  acquire(): PoolableRenderBlock {
    return this.pool.acquire();
  }

  release(block: PoolableRenderBlock): void {
    this.pool.release(block);
  }

  acquireBatch(count: number): PoolableRenderBlock[] {
    return this.pool.acquireBatch(count);
  }

  releaseBatch(blocks: PoolableRenderBlock[]): void {
    this.pool.releaseBatch(blocks);
  }

  getStats(): PoolStats {
    return this.pool.getStats();
  }

  clear(): void {
    this.pool.clear();
  }

  destroy(): void {
    this.pool.destroy();
    RenderBlockPoolManager.instance = null;
  }
}

// ================================
// 字符串缓冲池
// ================================

/**
 * 字符串构建器（减少字符串拼接开销）
 */
export class StringBuilderPool {
  private static instance: StringBuilderPool | null = null;
  private pool: StringBuilder[] = [];
  private readonly maxSize = 50;

  private constructor() {
    // 预分配
    for (let i = 0; i < 10; i++) {
      this.pool.push(new StringBuilder());
    }
  }

  static getInstance(): StringBuilderPool {
    if (!StringBuilderPool.instance) {
      StringBuilderPool.instance = new StringBuilderPool();
    }
    return StringBuilderPool.instance;
  }

  acquire(): StringBuilder {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return new StringBuilder();
  }

  release(builder: StringBuilder): void {
    builder.clear();
    if (this.pool.length < this.maxSize) {
      this.pool.push(builder);
    }
  }

  destroy(): void {
    this.pool.length = 0;
    StringBuilderPool.instance = null;
  }
}

/**
 * 高效字符串构建器
 */
export class StringBuilder {
  private parts: string[] = [];
  private totalLength = 0;

  append(str: string): this {
    if (str) {
      this.parts.push(str);
      this.totalLength += str.length;
    }
    return this;
  }

  appendLine(str = ''): this {
    this.append(str);
    this.append('\n');
    return this;
  }

  toString(): string {
    return this.parts.join('');
  }

  clear(): void {
    this.parts.length = 0;
    this.totalLength = 0;
  }

  get length(): number {
    return this.totalLength;
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }
}

// ================================
// 内存压力监控
// ================================

/**
 * 内存压力级别
 */
export enum MemoryPressure {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 内存监控器
 */
export class MemoryMonitor {
  private static instance: MemoryMonitor | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(pressure: MemoryPressure) => void> = new Set();
  private currentPressure: MemoryPressure = MemoryPressure.LOW;

  // 阈值（以 MB 为单位）
  private readonly thresholds = {
    medium: 100,
    high: 200,
    critical: 400,
  };

  private constructor() {}

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  /**
   * 开始监控
   */
  start(intervalMs = 5000): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkMemory();
    }, intervalMs);
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * 注册压力变化监听器
   */
  onPressureChange(callback: (pressure: MemoryPressure) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * 获取当前压力级别
   */
  getCurrentPressure(): MemoryPressure {
    return this.currentPressure;
  }

  /**
   * 获取内存使用量（MB）
   */
  getMemoryUsage(): number {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      return memory.usedJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  /**
   * 检查内存状态
   */
  private checkMemory(): void {
    const usedMB = this.getMemoryUsage();
    let newPressure: MemoryPressure;

    if (usedMB >= this.thresholds.critical) {
      newPressure = MemoryPressure.CRITICAL;
    } else if (usedMB >= this.thresholds.high) {
      newPressure = MemoryPressure.HIGH;
    } else if (usedMB >= this.thresholds.medium) {
      newPressure = MemoryPressure.MEDIUM;
    } else {
      newPressure = MemoryPressure.LOW;
    }

    if (newPressure !== this.currentPressure) {
      this.currentPressure = newPressure;
      this.notifyListeners(newPressure);
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(pressure: MemoryPressure): void {
    for (const listener of this.listeners) {
      try {
        listener(pressure);
      } catch (e) {
        console.error('[MemoryMonitor] 监听器执行失败:', e);
      }
    }
  }

  /**
   * 强制触发 GC（如果可用）
   */
  triggerGC(): void {
    if (typeof globalThis !== 'undefined' && 'gc' in globalThis) {
      try {
        (globalThis as unknown as { gc: () => void }).gc();
      } catch (e) {
        // GC 不可用
      }
    }
  }

  /**
   * 销毁监控器
   */
  destroy(): void {
    this.stop();
    this.listeners.clear();
    MemoryMonitor.instance = null;
  }
}

// ================================
// 导出便捷函数
// ================================

/**
 * 获取 AST 节点池
 */
export function getASTNodePool(): ASTNodePoolManager {
  return ASTNodePoolManager.getInstance();
}

/**
 * 获取渲染块池
 */
export function getRenderBlockPool(): RenderBlockPoolManager {
  return RenderBlockPoolManager.getInstance();
}

/**
 * 获取字符串构建器池
 */
export function getStringBuilderPool(): StringBuilderPool {
  return StringBuilderPool.getInstance();
}

/**
 * 获取内存监控器
 */
export function getMemoryMonitor(): MemoryMonitor {
  return MemoryMonitor.getInstance();
}

/**
 * 清理所有池
 */
export function clearAllPools(): void {
  getASTNodePool().clear();
  getRenderBlockPool().clear();
}

/**
 * 销毁所有池
 */
export function destroyAllPools(): void {
  getASTNodePool().destroy();
  getRenderBlockPool().destroy();
  getStringBuilderPool().destroy();
  getMemoryMonitor().destroy();
}

/**
 * 获取所有池的统计信息
 */
export function getAllPoolStats(): {
  astNodePool: PoolStats;
  renderBlockPool: PoolStats;
  memoryUsageMB: number;
  memoryPressure: MemoryPressure;
} {
  return {
    astNodePool: getASTNodePool().getStats(),
    renderBlockPool: getRenderBlockPool().getStats(),
    memoryUsageMB: getMemoryMonitor().getMemoryUsage(),
    memoryPressure: getMemoryMonitor().getCurrentPressure(),
  };
}
