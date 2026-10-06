// ================================
// 解析调度器
//
// 高性能增量解析调度，解决大文件 OOM 问题
//
// 核心策略：
// 1. 帧调度 - 使用 requestIdleCallback/requestAnimationFrame 分帧执行
// 2. 优先级队列 - 可视区域优先解析
// 3. 内存控制 - 监控内存使用，自动降级
// 4. 取消机制 - 支持任务取消，避免无用计算
// 5. 批量处理 - 合并小任务减少调度开销
//
// 行业最佳实践：
// - 使用 requestIdleCallback 在空闲时处理
// - 使用 MessageChannel 实现微任务调度
// - 增量解析只处理变化部分
// ================================

import type { LatexNode } from './types';

// ================================
// 类型定义
// ================================

/** 任务优先级 */
export enum TaskPriority {
  /** 关键任务：立即执行 */
  CRITICAL = 0,
  /** 高优先级：可视区域内 */
  HIGH = 1,
  /** 普通优先级：预加载 */
  NORMAL = 2,
  /** 低优先级：后台处理 */
  LOW = 3,
  /** 空闲任务：空闲时执行 */
  IDLE = 4,
}

/** 任务状态 */
export enum TaskStatus {
  /** 等待执行 */
  PENDING = 'pending',
  /** 正在执行 */
  RUNNING = 'running',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 已取消 */
  CANCELLED = 'cancelled',
  /** 执行失败 */
  FAILED = 'failed',
}

/** 任务类型 */
export type TaskType =
  | 'parse-chunk' // 解析单个块
  | 'render-chunk' // 渲染单个块
  | 'update-sourcemap' // 更新 Source Map
  | 'build-index' // 构建索引
  | 'gc'; // 垃圾回收

/** 解析任务 */
export interface ParseTask<T = unknown> {
  /** 任务 ID */
  id: string;
  /** 任务类型 */
  type: TaskType;
  /** 优先级 */
  priority: TaskPriority;
  /** 状态 */
  status: TaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 开始执行时间 */
  startedAt: number | null;
  /** 完成时间 */
  completedAt: number | null;
  /** 相关的块 ID（如果有） */
  chunkId: string | null;
  /** 任务数据 */
  data: T;
  /** 执行函数 */
  execute: () => Promise<unknown> | unknown;
  /** 结果 */
  result: unknown;
  /** 错误信息 */
  error: string | null;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 预估执行时间（毫秒） */
  estimatedTime: number;
}

/** 调度器配置 */
export interface SchedulerConfig {
  /** 每帧最大执行时间（毫秒） */
  maxFrameTime: number;
  /** 任务超时时间（毫秒） */
  defaultTimeout: number;
  /** 最大并发任务数 */
  maxConcurrent: number;
  /** 是否使用 Worker */
  useWorker: boolean;
  /** 空闲检测阈值（毫秒） */
  idleThreshold: number;
  /** 是否启用性能监控 */
  enableMetrics: boolean;
  /** 内存警告阈值（MB） */
  memoryWarningThreshold: number;
  /** 内存危险阈值（MB） */
  memoryCriticalThreshold: number;
  /** 最大队列长度 */
  maxQueueLength: number;
}

/** 调度器统计 */
export interface SchedulerStats {
  /** 总任务数 */
  totalTasks: number;
  /** 已完成任务数 */
  completedTasks: number;
  /** 失败任务数 */
  failedTasks: number;
  /** 取消任务数 */
  cancelledTasks: number;
  /** 平均执行时间（毫秒） */
  avgExecutionTime: number;
  /** 队列长度 */
  queueLength: number;
  /** 当前运行任务数 */
  runningTasks: number;
  /** 内存使用（MB） */
  memoryUsage: number;
  /** 是否处于降级模式 */
  degradedMode: boolean;
}

/** 任务完成回调 */
export type TaskCallback<T = unknown> = (error: Error | null, result: T | null) => void;

/** 帧时间分配 */
interface FrameBudget {
  /** 开始时间 */
  startTime: number;
  /** 剩余时间 */
  remaining: number;
  /** 是否是空闲帧 */
  isIdle: boolean;
  /** 是否已超时 */
  expired: boolean;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: SchedulerConfig = {
  maxFrameTime: 8, // 8ms，保留时间给渲染
  defaultTimeout: 10000, // 10秒
  maxConcurrent: 2, // 降低并发以减少内存压力
  useWorker: true,
  idleThreshold: 50,
  enableMetrics: true,
  memoryWarningThreshold: 200, // 200MB
  memoryCriticalThreshold: 500, // 500MB
  maxQueueLength: 100,
};

// ================================
// 工具函数
// ================================

/** 任务 ID 计数器 */
let taskIdCounter = 0;

/** 生成任务 ID */
function generateTaskId(): string {
  return `task_${++taskIdCounter}`;
}

/**
 * 检测是否支持 requestIdleCallback
 */
const hasIdleCallback = typeof requestIdleCallback !== 'undefined';

/**
 * 检测是否支持 performance.memory（非标准，仅 Chrome）
 */
const hasMemoryAPI =
  typeof performance !== 'undefined' &&
  'memory' in performance &&
  typeof (performance as unknown as { memory: { usedJSHeapSize: number } }).memory === 'object';

/**
 * requestIdleCallback polyfill
 */
function scheduleIdle(callback: IdleRequestCallback, options?: IdleRequestOptions): number {
  if (hasIdleCallback) {
    return requestIdleCallback(callback, options);
  }

  const start = performance.now();
  return window.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 50 - (performance.now() - start)),
    });
  }, 1) as unknown as number;
}

/**
 * cancelIdleCallback polyfill
 */
function cancelIdle(id: number): void {
  if (hasIdleCallback) {
    cancelIdleCallback(id);
  } else {
    window.clearTimeout(id);
  }
}

/**
 * 获取当前内存使用（MB）
 */
function getMemoryUsage(): number {
  if (hasMemoryAPI) {
    const memory = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
    return memory.usedJSHeapSize / (1024 * 1024);
  }
  return 0; // 无法检测
}

/**
 * 使用 MessageChannel 实现微任务调度
 */
function scheduleMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback);
  } else if (typeof MessageChannel !== 'undefined') {
    const channel = new MessageChannel();
    channel.port1.onmessage = callback;
    channel.port2.postMessage(null);
  } else {
    Promise.resolve().then(callback);
  }
}

/**
 * 创建帧时间预算
 */
function createFrameBudget(maxTime: number, isIdle: boolean = false): FrameBudget {
  return {
    startTime: performance.now(),
    remaining: maxTime,
    isIdle,
    get expired() {
      return performance.now() - this.startTime >= maxTime;
    },
  };
}

// ================================
// 优先级队列
// ================================

/**
 * 最小堆优先级队列
 * 高效的任务调度数据结构
 */
class PriorityQueue<T extends { priority: number }> {
  private heap: T[] = [];

  get length(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /** 入队 */
  enqueue(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  /** 出队 */
  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const result = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.bubbleDown(0);
    return result;
  }

  /** 查看队首 */
  peek(): T | undefined {
    return this.heap[0];
  }

  /** 清空队列 */
  clear(): void {
    this.heap.length = 0;
  }

  /** 移除指定元素 */
  remove(predicate: (item: T) => boolean): T | undefined {
    const index = this.heap.findIndex(predicate);
    if (index === -1) return undefined;

    const item = this.heap[index];

    if (index === this.heap.length - 1) {
      this.heap.pop();
    } else {
      this.heap[index] = this.heap.pop()!;
      this.bubbleUp(index);
      this.bubbleDown(index);
    }

    return item;
  }

  /** 获取所有元素（按优先级排序） */
  toArray(): T[] {
    return [...this.heap].sort((a, b) => a.priority - b.priority);
  }

  /** 检查是否包含满足条件的元素 */
  has(predicate: (item: T) => boolean): boolean {
    return this.heap.some(predicate);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].priority <= this.heap[index].priority) break;

      [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.heap[leftChild].priority < this.heap[smallest].priority) {
        smallest = leftChild;
      }

      if (rightChild < length && this.heap[rightChild].priority < this.heap[smallest].priority) {
        smallest = rightChild;
      }

      if (smallest === index) break;

      [this.heap[smallest], this.heap[index]] = [this.heap[index], this.heap[smallest]];
      index = smallest;
    }
  }
}

// ================================
// 解析调度器
// ================================

/**
 * 解析调度器
 *
 * 管理解析任务的执行，确保：
 * 1. 不阻塞主线程
 * 2. 高优先级任务先执行
 * 3. 内存使用可控
 * 4. 支持取消和重试
 */
export class ParseScheduler {
  /** 配置 */
  private config: SchedulerConfig;

  /** 任务队列（优先级队列） */
  private taskQueue: PriorityQueue<ParseTask>;

  /** 正在执行的任务 */
  private runningTasks: Map<string, ParseTask>;

  /** 任务结果缓存 */
  private taskResults: Map<string, { result: unknown; timestamp: number }>;

  /** 任务回调 */
  private taskCallbacks: Map<string, TaskCallback[]>;

  /** 是否正在调度 */
  private isScheduling: boolean = false;

  /** 空闲回调 ID */
  private idleCallbackId: number | null = null;

  /** RAF ID */
  private rafId: number | null = null;

  /** 统计信息 */
  private stats: SchedulerStats;

  /** 执行时间记录（滑动窗口） */
  private executionTimes: number[] = [];
  private readonly executionTimesMaxSize = 50;

  /** 是否已销毁 */
  private destroyed: boolean = false;

  /** 是否暂停 */
  private paused: boolean = false;

  /** 降级模式 */
  private degradedMode: boolean = false;

  /** 上次内存检查时间 */
  private lastMemoryCheck: number = 0;
  private readonly memoryCheckInterval = 1000; // 1秒检查一次

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.taskQueue = new PriorityQueue();
    this.runningTasks = new Map();
    this.taskResults = new Map();
    this.taskCallbacks = new Map();

    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      cancelledTasks: 0,
      avgExecutionTime: 0,
      queueLength: 0,
      runningTasks: 0,
      memoryUsage: 0,
      degradedMode: false,
    };
  }

  // ================================
  // 公共 API
  // ================================

  /**
   * 调度解析块任务
   */
  scheduleParseChunk(
    chunkId: string,
    execute: () => Promise<LatexNode | null>,
    priority: TaskPriority = TaskPriority.NORMAL
  ): string {
    return this.schedule({
      type: 'parse-chunk',
      chunkId,
      data: { chunkId },
      execute,
      priority,
    });
  }

  /**
   * 调度渲染块任务
   */
  scheduleRenderChunk(
    chunkId: string,
    execute: () => Promise<string>,
    priority: TaskPriority = TaskPriority.NORMAL
  ): string {
    return this.schedule({
      type: 'render-chunk',
      chunkId,
      data: { chunkId },
      execute,
      priority,
    });
  }

  /**
   * 通用任务调度
   */
  schedule<T>(options: {
    type: TaskType;
    chunkId?: string;
    data?: T;
    execute: () => Promise<unknown> | unknown;
    priority?: TaskPriority;
    timeout?: number;
    estimatedTime?: number;
  }): string {
    // 检查队列长度限制
    if (this.taskQueue.length >= this.config.maxQueueLength) {
      // 移除最低优先级的任务
      const tasks = this.taskQueue.toArray();
      const lowestPriority = tasks[tasks.length - 1];
      if (lowestPriority && lowestPriority.priority > (options.priority ?? TaskPriority.NORMAL)) {
        this.taskQueue.remove((t) => t.id === lowestPriority.id);
        this.notifyCallbacks(lowestPriority.id, new Error('任务被移除：队列已满'), null);
      } else {
        console.warn('[ParseScheduler] 队列已满，任务被拒绝');
        return '';
      }
    }

    const task = this.createTask(options);

    this.taskQueue.enqueue(task);
    this.stats.totalTasks++;
    this.stats.queueLength = this.taskQueue.length;

    // 启动调度
    if (!this.isScheduling && !this.paused && !this.destroyed) {
      this.startScheduling();
    }

    return task.id;
  }

  /**
   * 批量调度（用于优化大量小任务）
   */
  scheduleBatch(
    chunks: Array<{
      chunkId: string;
      execute: () => Promise<unknown>;
      priority?: TaskPriority;
    }>
  ): string[] {
    // 按优先级排序
    const sortedChunks = [...chunks].sort(
      (a, b) => (a.priority ?? TaskPriority.NORMAL) - (b.priority ?? TaskPriority.NORMAL)
    );

    const taskIds: string[] = [];

    for (const chunk of sortedChunks) {
      const taskId = this.scheduleParseChunk(
        chunk.chunkId,
        chunk.execute as () => Promise<LatexNode | null>,
        chunk.priority
      );
      if (taskId) {
        taskIds.push(taskId);
      }
    }

    return taskIds;
  }

  /**
   * 取消任务
   */
  cancel(taskId: string): boolean {
    // 从队列中移除
    const task = this.taskQueue.remove((t) => t.id === taskId);
    if (task) {
      task.status = TaskStatus.CANCELLED;
      this.stats.cancelledTasks++;
      this.stats.queueLength = this.taskQueue.length;
      this.notifyCallbacks(taskId, new Error('任务已取消'), null);
      return true;
    }

    // 标记正在运行的任务为取消
    const runningTask = this.runningTasks.get(taskId);
    if (runningTask) {
      runningTask.status = TaskStatus.CANCELLED;
      return true;
    }

    return false;
  }

  /**
   * 按块 ID 取消任务
   */
  cancelByChunk(chunkId: string): number {
    let cancelled = 0;

    // 从队列中移除
    const tasks = this.taskQueue.toArray().filter((t) => t.chunkId === chunkId);
    for (const task of tasks) {
      if (this.cancel(task.id)) {
        cancelled++;
      }
    }

    // 标记正在运行的任务
    for (const [, task] of this.runningTasks) {
      if (task.chunkId === chunkId && task.status === TaskStatus.RUNNING) {
        task.status = TaskStatus.CANCELLED;
        cancelled++;
      }
    }

    return cancelled;
  }

  /**
   * 取消所有任务
   */
  cancelAll(): void {
    // 清空队列
    const tasks = this.taskQueue.toArray();
    this.taskQueue.clear();

    for (const task of tasks) {
      task.status = TaskStatus.CANCELLED;
      this.stats.cancelledTasks++;
      this.notifyCallbacks(task.id, new Error('任务已取消'), null);
    }

    // 标记所有运行中的任务
    for (const [, task] of this.runningTasks) {
      task.status = TaskStatus.CANCELLED;
    }

    this.stats.queueLength = 0;
  }

  /**
   * 提升任务优先级
   */
  prioritize(taskId: string, newPriority: TaskPriority): boolean {
    const task = this.taskQueue.remove((t) => t.id === taskId);
    if (task) {
      task.priority = newPriority;
      this.taskQueue.enqueue(task);
      return true;
    }
    return false;
  }

  /**
   * 批量提升块优先级
   */
  prioritizeChunks(chunkIds: string[], priority: TaskPriority = TaskPriority.HIGH): void {
    const chunkIdSet = new Set(chunkIds);

    const tasks = this.taskQueue.toArray().filter((t) => t.chunkId && chunkIdSet.has(t.chunkId));

    for (const task of tasks) {
      this.prioritize(task.id, priority);
    }
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): TaskStatus | null {
    // 检查队列
    const queueTask = this.taskQueue.toArray().find((t) => t.id === taskId);
    if (queueTask) return queueTask.status;

    // 检查运行中
    const runningTask = this.runningTasks.get(taskId);
    if (runningTask) return runningTask.status;

    // 检查结果缓存
    if (this.taskResults.has(taskId)) {
      return TaskStatus.COMPLETED;
    }

    return null;
  }

  /**
   * 获取任务结果
   */
  getTaskResult<T>(taskId: string): T | null {
    const cached = this.taskResults.get(taskId);
    return cached ? (cached.result as T) : null;
  }

  /**
   * 注册任务回调
   */
  registerCallback(taskId: string, callback: TaskCallback): void {
    const callbacks = this.taskCallbacks.get(taskId) ?? [];
    callbacks.push(callback);
    this.taskCallbacks.set(taskId, callbacks);
  }

  /**
   * 等待任务完成
   */
  waitForTask<T>(taskId: string): Promise<T> {
    return new Promise((resolve, reject) => {
      // 检查是否已完成
      const result = this.taskResults.get(taskId);
      if (result) {
        resolve(result.result as T);
        return;
      }

      // 注册回调
      this.registerCallback(taskId, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result as T);
        }
      });
    });
  }

  /**
   * 获取统计信息
   */
  getStats(): SchedulerStats {
    return {
      ...this.stats,
      queueLength: this.taskQueue.length,
      runningTasks: this.runningTasks.size,
      memoryUsage: getMemoryUsage(),
      degradedMode: this.degradedMode,
    };
  }

  /**
   * 清理过期结果
   */
  cleanup(maxAge: number = 60000): void {
    const now = Date.now();

    for (const [taskId, { timestamp }] of this.taskResults) {
      if (now - timestamp > maxAge) {
        this.taskResults.delete(taskId);
        this.taskCallbacks.delete(taskId);
      }
    }
  }

  /**
   * 暂停调度
   */
  pause(): void {
    this.paused = true;
    this.stopScheduling();
  }

  /**
   * 恢复调度
   */
  resume(): void {
    this.paused = false;
    if (!this.destroyed && this.taskQueue.length > 0) {
      this.startScheduling();
    }
  }

  /**
   * 销毁调度器
   */
  destroy(): void {
    this.destroyed = true;
    this.cancelAll();
    this.stopScheduling();
    this.taskQueue.clear();
    this.runningTasks.clear();
    this.taskResults.clear();
    this.taskCallbacks.clear();
    this.executionTimes.length = 0;
  }

  /**
   * 是否正在调度
   */
  get isActive(): boolean {
    return this.isScheduling && !this.paused && !this.destroyed;
  }

  /**
   * 队列是否为空
   */
  get isEmpty(): boolean {
    return this.taskQueue.isEmpty && this.runningTasks.size === 0;
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 创建任务
   */
  private createTask<T>(options: {
    type: TaskType;
    chunkId?: string;
    data?: T;
    execute: () => Promise<unknown> | unknown;
    priority?: TaskPriority;
    timeout?: number;
    estimatedTime?: number;
  }): ParseTask<T> {
    return {
      id: generateTaskId(),
      type: options.type,
      priority: options.priority ?? TaskPriority.NORMAL,
      status: TaskStatus.PENDING,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      chunkId: options.chunkId ?? null,
      data: options.data as T,
      execute: options.execute,
      result: null,
      error: null,
      timeout: options.timeout ?? this.config.defaultTimeout,
      retryCount: 0,
      maxRetries: 2,
      estimatedTime: options.estimatedTime ?? 5,
    };
  }

  /**
   * 启动调度
   */
  private startScheduling(): void {
    if (this.isScheduling || this.destroyed || this.paused) return;

    this.isScheduling = true;
    this.scheduleNextFrame();
  }

  /**
   * 停止调度
   */
  private stopScheduling(): void {
    this.isScheduling = false;

    if (this.idleCallbackId !== null) {
      cancelIdle(this.idleCallbackId);
      this.idleCallbackId = null;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 调度下一帧
   */
  private scheduleNextFrame(): void {
    if (this.destroyed || this.paused || this.taskQueue.isEmpty) {
      this.isScheduling = false;
      return;
    }

    // 检查是否有高优先级任务
    const nextTask = this.taskQueue.peek();
    const hasCritical = nextTask && nextTask.priority === TaskPriority.CRITICAL;

    if (hasCritical) {
      // 高优先级任务立即执行
      scheduleMicrotask(() => this.processFrame(createFrameBudget(16, false)));
    } else {
      // 使用 requestIdleCallback 在空闲时执行
      this.idleCallbackId = scheduleIdle(
        (deadline) => {
          const budget = createFrameBudget(
            Math.min(deadline.timeRemaining(), this.config.maxFrameTime),
            true
          );
          this.processFrame(budget);
        },
        { timeout: 100 }
      );
    }
  }

  /**
   * 处理一帧
   */
  private processFrame(budget: FrameBudget): void {
    if (this.destroyed || this.paused) {
      this.isScheduling = false;
      return;
    }

    // 检查内存
    this.checkMemory();

    // 在时间预算内处理任务
    while (!budget.expired && !this.taskQueue.isEmpty) {
      // 检查并发限制
      if (this.runningTasks.size >= this.config.maxConcurrent) {
        break;
      }

      // 在降级模式下更保守
      if (this.degradedMode && this.runningTasks.size >= 1) {
        break;
      }

      const task = this.taskQueue.dequeue();
      if (!task) break;

      // 检查任务是否已被取消
      if (task.status === TaskStatus.CANCELLED) {
        continue;
      }

      // 如果任务预估时间超过剩余时间，且不是关键任务，则延迟
      const remaining = budget.remaining - (performance.now() - budget.startTime);
      if (remaining < task.estimatedTime && task.priority !== TaskPriority.CRITICAL) {
        this.taskQueue.enqueue(task);
        break;
      }

      // 执行任务
      this.executeTask(task);
    }

    // 如果还有任务，继续调度
    if (!this.taskQueue.isEmpty || this.runningTasks.size > 0) {
      this.scheduleNextFrame();
    } else {
      this.isScheduling = false;
    }
  }

  /**
   * 判断任务是否已被取消
   * 以方法调用读取最新状态，避免 await 之后沿用赋值时收窄的类型
   */
  private isTaskCancelled(task: ParseTask): boolean {
    return task.status === TaskStatus.CANCELLED;
  }

  /**
   * 执行任务
   */
  private async executeTask(task: ParseTask): Promise<void> {
    task.status = TaskStatus.RUNNING;
    task.startedAt = performance.now();
    this.runningTasks.set(task.id, task);
    this.stats.runningTasks = this.runningTasks.size;

    try {
      // 创建超时 Promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('任务超时')), task.timeout);
      });

      // 执行任务
      const result = await Promise.race([Promise.resolve(task.execute()), timeoutPromise]);

      // 检查是否被取消（await 期间 cancel 可能修改状态，需重新读取）
      if (this.isTaskCancelled(task)) {
        return;
      }

      // 任务完成
      task.status = TaskStatus.COMPLETED;
      task.result = result;
      task.completedAt = performance.now();

      this.stats.completedTasks++;
      this.recordExecutionTime(task.completedAt - task.startedAt!);

      // 缓存结果
      this.taskResults.set(task.id, {
        result,
        timestamp: Date.now(),
      });

      // 通知回调
      this.notifyCallbacks(task.id, null, result);
    } catch (error) {
      // 检查是否被取消（await 期间 cancel 可能修改状态，需重新读取）
      if (this.isTaskCancelled(task)) {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // 重试逻辑
      if (task.retryCount < task.maxRetries && !errorMessage.includes('超时')) {
        task.retryCount++;
        task.status = TaskStatus.PENDING;
        this.taskQueue.enqueue(task);
        console.warn(
          `[ParseScheduler] 任务 ${task.id} 重试 (${task.retryCount}/${task.maxRetries})`
        );
      } else {
        task.status = TaskStatus.FAILED;
        task.error = errorMessage;
        task.completedAt = performance.now();
        this.stats.failedTasks++;

        // 通知回调
        this.notifyCallbacks(task.id, new Error(errorMessage), null);
      }
    } finally {
      this.runningTasks.delete(task.id);
      this.stats.runningTasks = this.runningTasks.size;
      this.stats.queueLength = this.taskQueue.length;
    }
  }

  /**
   * 记录执行时间
   */
  private recordExecutionTime(time: number): void {
    this.executionTimes.push(time);
    if (this.executionTimes.length > this.executionTimesMaxSize) {
      this.executionTimes.shift();
    }

    // 更新平均执行时间
    if (this.executionTimes.length > 0) {
      this.stats.avgExecutionTime =
        this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length;
    }
  }

  /**
   * 通知回调
   */
  private notifyCallbacks(taskId: string, error: Error | null, result: unknown): void {
    const callbacks = this.taskCallbacks.get(taskId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(error, result);
        } catch (e) {
          console.error('[ParseScheduler] 回调执行错误:', e);
        }
      }
      this.taskCallbacks.delete(taskId);
    }
  }

  /**
   * 检查内存使用
   */
  private checkMemory(): void {
    const now = Date.now();
    if (now - this.lastMemoryCheck < this.memoryCheckInterval) {
      return;
    }
    this.lastMemoryCheck = now;

    const memoryUsage = getMemoryUsage();
    this.stats.memoryUsage = memoryUsage;

    if (memoryUsage >= this.config.memoryCriticalThreshold) {
      // 危险级别：取消低优先级任务
      console.warn(`[ParseScheduler] 内存危险 (${memoryUsage.toFixed(1)}MB)，取消低优先级任务`);

      const tasks = this.taskQueue.toArray();
      for (const task of tasks) {
        if (task.priority >= TaskPriority.LOW) {
          this.cancel(task.id);
        }
      }

      this.degradedMode = true;
      this.triggerGC();
    } else if (memoryUsage >= this.config.memoryWarningThreshold) {
      // 警告级别：进入降级模式
      if (!this.degradedMode) {
        console.warn(`[ParseScheduler] 内存警告 (${memoryUsage.toFixed(1)}MB)，进入降级模式`);
        this.degradedMode = true;
      }
    } else if (this.degradedMode && memoryUsage < this.config.memoryWarningThreshold * 0.7) {
      // 恢复正常模式
      console.log('[ParseScheduler] 内存恢复，退出降级模式');
      this.degradedMode = false;
    }

    this.stats.degradedMode = this.degradedMode;
  }

  /**
   * 尝试触发垃圾回收
   */
  private triggerGC(): void {
    // 清理过期结果
    this.cleanup(10000);

    // 在 Node.js 环境中可以使用 global.gc()
    if (typeof global !== 'undefined' && typeof (global as { gc?: () => void }).gc === 'function') {
      (global as { gc: () => void }).gc();
    }
  }
}

// ================================
// 内存控制器
// ================================

/**
 * 内存控制器
 * 监控内存使用，在必要时触发清理
 */
export class MemoryController {
  /** 警告阈值（字节） */
  private threshold: number;

  /** 检查间隔（毫秒） */
  private checkInterval: number;

  /** 定时器 ID */
  private timerId: number | null = null;

  /** 清理回调 */
  private onCleanup: (() => void) | null = null;

  /** 是否支持内存 API */
  private hasMemoryAPI: boolean;

  /** 是否已销毁 */
  private destroyed: boolean = false;

  constructor(thresholdMB: number = 200, checkIntervalMs: number = 5000, onCleanup?: () => void) {
    this.threshold = thresholdMB * 1024 * 1024;
    this.checkInterval = checkIntervalMs;
    this.onCleanup = onCleanup ?? null;
    this.hasMemoryAPI = hasMemoryAPI;
  }

  /**
   * 开始监控
   */
  start(): void {
    if (this.destroyed) return;

    this.stop();
    this.timerId = window.setInterval(() => this.check(), this.checkInterval);
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * 检查内存
   */
  private check(): void {
    if (!this.hasMemoryAPI || this.destroyed) return;

    const memory = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
    if (memory.usedJSHeapSize > this.threshold) {
      console.warn(
        `[MemoryController] 内存使用超过阈值: ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB`
      );
      this.onCleanup?.();
    }
  }

  /**
   * 获取当前内存使用（MB）
   */
  getMemoryUsage(): number {
    return getMemoryUsage();
  }

  /**
   * 手动触发 GC（仅在支持的环境中有效）
   */
  forceGC(): void {
    if (typeof global !== 'undefined' && typeof (global as { gc?: () => void }).gc === 'function') {
      (global as { gc: () => void }).gc();
    }
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.onCleanup = null;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建解析调度器
 */
export function createParseScheduler(config?: Partial<SchedulerConfig>): ParseScheduler {
  return new ParseScheduler(config);
}

/**
 * 创建内存控制器
 */
export function createMemoryController(
  thresholdMB?: number,
  checkIntervalMs?: number,
  onCleanup?: () => void
): MemoryController {
  return new MemoryController(thresholdMB, checkIntervalMs, onCleanup);
}

/**
 * 创建高性能调度器（针对大文件优化）
 */
export function createHighPerformanceScheduler(): ParseScheduler {
  return new ParseScheduler({
    maxFrameTime: 5, // 更短的帧时间
    maxConcurrent: 1, // 更低的并发
    memoryWarningThreshold: 100,
    memoryCriticalThreshold: 300,
    maxQueueLength: 50,
    enableMetrics: true,
  });
}
