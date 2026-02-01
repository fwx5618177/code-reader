// ================================
// 帧调度解析器
// 将解析任务分帧执行，避免阻塞主线程
//
// 核心特性：
// 1. 基于 requestAnimationFrame 的任务调度
// 2. 智能时间切片，每帧预算 8ms
// 3. 优先级队列，关键任务优先执行
// 4. 内存压力感知，自动调整批量大小
// 5. 支持任务取消和暂停
// ================================

// ================================
// 类型定义
// ================================

/** 任务优先级 */
export enum ParseTaskPriority {
  /** 关键任务（用户输入响应） */
  CRITICAL = 0,
  /** 高优先级（可见区域解析） */
  HIGH = 1,
  /** 普通优先级 */
  NORMAL = 2,
  /** 低优先级（预解析） */
  LOW = 3,
  /** 空闲任务 */
  IDLE = 4,
}

/** 任务状态 */
export enum ParseTaskStatus {
  /** 待执行 */
  PENDING = 'pending',
  /** 执行中 */
  RUNNING = 'running',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 已取消 */
  CANCELLED = 'cancelled',
  /** 失败 */
  FAILED = 'failed',
}

/** 解析任务 */
export interface ParseTask<T = unknown> {
  /** 任务 ID */
  id: string;
  /** 优先级 */
  priority: ParseTaskPriority;
  /** 执行函数 */
  execute: () => T | Promise<T>;
  /** 状态 */
  status: ParseTaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 完成回调 */
  onComplete?: (result: T) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 估计执行时间（毫秒） */
  estimatedTime?: number;
  /** 任务标签（用于批量取消） */
  tag?: string;
}

/** 调度器配置 */
export interface FrameParseSchedulerConfig {
  /** 每帧最大执行时间（毫秒） */
  maxFrameTime: number;
  /** 空闲回调超时（毫秒） */
  idleCallbackTimeout: number;
  /** 是否使用 requestIdleCallback */
  useIdleCallback: boolean;
  /** 最大并行任务数 */
  maxConcurrentTasks: number;
  /** 每帧最大任务数 */
  batchSize: number;
  /** 是否启用调试日志 */
  debug: boolean;
  /** 内存压力阈值（MB） */
  memoryThreshold: number;
}

/** 调度器统计信息 */
export interface SchedulerStats {
  /** 总任务数 */
  totalTasks: number;
  /** 已完成任务数 */
  completedTasks: number;
  /** 已取消任务数 */
  cancelledTasks: number;
  /** 失败任务数 */
  failedTasks: number;
  /** 待处理任务数 */
  pendingTasks: number;
  /** 平均任务执行时间（毫秒） */
  averageTaskTime: number;
  /** 总执行时间（毫秒） */
  totalExecutionTime: number;
  /** 丢帧数 */
  droppedFrames: number;
  /** 当前内存压力等级 */
  memoryPressure: MemoryPressureLevel;
}

/** 内存压力等级 */
export enum MemoryPressureLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: FrameParseSchedulerConfig = {
  maxFrameTime: 8, // 预留时间给渲染，确保 60fps
  idleCallbackTimeout: 50,
  useIdleCallback: true,
  maxConcurrentTasks: 4,
  batchSize: 10,
  debug: false,
  memoryThreshold: 500, // 500MB
};

// ================================
// 任务 ID 生成
// ================================

let taskIdCounter = 0;

/**
 * 生成唯一任务 ID
 */
function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${(taskIdCounter++).toString(36)}`;
}

// ================================
// 优先级队列
// ================================

/**
 * 基于堆的优先级队列
 */
class PriorityQueue<T extends { priority: number; createdAt: number }> {
  private heap: T[] = [];

  /** 队列大小 */
  get size(): number {
    return this.heap.length;
  }

  /** 是否为空 */
  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * 入队
   */
  enqueue(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * 出队
   */
  dequeue(): T | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }

    const item = this.heap[0];
    const last = this.heap.pop();

    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return item;
  }

  /**
   * 查看队首
   */
  peek(): T | undefined {
    return this.heap[0];
  }

  /**
   * 移除指定项
   */
  remove(predicate: (item: T) => boolean): T | undefined {
    const index = this.heap.findIndex(predicate);
    if (index === -1) {
      return undefined;
    }

    const item = this.heap[index];
    const last = this.heap.pop();

    if (index < this.heap.length && last !== undefined) {
      this.heap[index] = last;
      this.bubbleUp(index);
      this.bubbleDown(index);
    }

    return item;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.heap = [];
  }

  /**
   * 转换为数组
   */
  toArray(): T[] {
    return [...this.heap];
  }

  /**
   * 上浮
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];
      const current = this.heap[index];

      if (this.compare(current, parent) >= 0) {
        break;
      }

      this.heap[parentIndex] = current;
      this.heap[index] = parent;
      index = parentIndex;
    }
  }

  /**
   * 下沉
   */
  private bubbleDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.compare(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild;
      }

      if (rightChild < length && this.compare(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild;
      }

      if (smallest === index) {
        break;
      }

      const temp = this.heap[index];
      this.heap[index] = this.heap[smallest];
      this.heap[smallest] = temp;
      index = smallest;
    }
  }

  /**
   * 比较两个项（优先级越小越优先，相同优先级按创建时间排序）
   */
  private compare(a: T, b: T): number {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.createdAt - b.createdAt;
  }
}

// ================================
// 帧调度解析器
// ================================

/**
 * 帧调度解析器
 * 将解析任务分帧执行，避免阻塞主线程
 */
export class FrameParseScheduler {
  private config: FrameParseSchedulerConfig;
  private queue: PriorityQueue<ParseTask>;
  private runningTasks: Map<string, ParseTask>;
  private taskIndex: Map<string, ParseTask>;
  private isRunning: boolean;
  private isPaused: boolean;
  private frameStartTime: number;
  private rafId: number | null;
  private idleCallbackId: number | null;
  private memoryPressure: MemoryPressureLevel;
  private memoryCheckInterval: ReturnType<typeof setInterval> | null;

  // 统计信息
  private stats: {
    completedTasks: number;
    cancelledTasks: number;
    failedTasks: number;
    totalExecutionTime: number;
    droppedFrames: number;
    taskTimes: number[];
  };

  constructor(config: Partial<FrameParseSchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queue = new PriorityQueue();
    this.runningTasks = new Map();
    this.taskIndex = new Map();
    this.isRunning = false;
    this.isPaused = false;
    this.frameStartTime = 0;
    this.rafId = null;
    this.idleCallbackId = null;
    this.memoryPressure = MemoryPressureLevel.LOW;
    this.memoryCheckInterval = null;

    this.stats = {
      completedTasks: 0,
      cancelledTasks: 0,
      failedTasks: 0,
      totalExecutionTime: 0,
      droppedFrames: 0,
      taskTimes: [],
    };

    // 启动内存监控
    this.startMemoryMonitoring();
  }

  /**
   * 调度任务
   */
  schedule<T>(
    execute: () => T | Promise<T>,
    options: Partial<Omit<ParseTask<T>, 'id' | 'execute' | 'status' | 'createdAt'>> = {}
  ): string {
    const task: ParseTask<T> = {
      id: generateTaskId(),
      execute,
      priority: options.priority ?? ParseTaskPriority.NORMAL,
      status: ParseTaskStatus.PENDING,
      createdAt: performance.now(),
      onComplete: options.onComplete,
      onError: options.onError,
      onCancel: options.onCancel,
      estimatedTime: options.estimatedTime,
      tag: options.tag,
    };

    this.queue.enqueue(task as ParseTask);
    this.taskIndex.set(task.id, task as ParseTask);

    // 启动调度器
    if (!this.isRunning && !this.isPaused) {
      this.start();
    }

    if (this.config.debug) {
      console.log(`[FrameParseScheduler] 任务已调度: ${task.id}, 优先级: ${task.priority}`);
    }

    return task.id;
  }

  /**
   * 批量调度任务
   */
  scheduleBatch<T>(
    executes: Array<() => T | Promise<T>>,
    options: Partial<Omit<ParseTask<T>, 'id' | 'execute' | 'status' | 'createdAt'>> = {}
  ): string[] {
    return executes.map((execute) => this.schedule(execute, options));
  }

  /**
   * 取消任务
   */
  cancel(taskId: string): boolean {
    const task = this.taskIndex.get(taskId);
    if (!task) {
      return false;
    }

    // 如果任务正在运行，无法取消
    if (task.status === ParseTaskStatus.RUNNING) {
      if (this.config.debug) {
        console.log(`[FrameParseScheduler] 任务正在执行，无法取消: ${taskId}`);
      }
      return false;
    }

    // 从队列中移除
    this.queue.remove((t) => t.id === taskId);
    this.taskIndex.delete(taskId);

    // 更新状态
    task.status = ParseTaskStatus.CANCELLED;
    this.stats.cancelledTasks++;

    // 调用取消回调
    if (task.onCancel) {
      try {
        task.onCancel();
      } catch (e) {
        console.error(`[FrameParseScheduler] 取消回调执行失败:`, e);
      }
    }

    if (this.config.debug) {
      console.log(`[FrameParseScheduler] 任务已取消: ${taskId}`);
    }

    return true;
  }

  /**
   * 按标签批量取消任务
   */
  cancelByTag(tag: string): number {
    let cancelled = 0;
    const tasksToCancel: string[] = [];

    for (const [id, task] of this.taskIndex) {
      if (task.tag === tag && task.status === ParseTaskStatus.PENDING) {
        tasksToCancel.push(id);
      }
    }

    for (const id of tasksToCancel) {
      if (this.cancel(id)) {
        cancelled++;
      }
    }

    return cancelled;
  }

  /**
   * 取消所有任务
   */
  cancelAll(): number {
    let cancelled = 0;
    const allTasks = Array.from(this.taskIndex.keys());

    for (const id of allTasks) {
      if (this.cancel(id)) {
        cancelled++;
      }
    }

    return cancelled;
  }

  /**
   * 暂停调度器
   */
  pause(): void {
    this.isPaused = true;
    this.cancelScheduledCallbacks();

    if (this.config.debug) {
      console.log(`[FrameParseScheduler] 调度器已暂停`);
    }
  }

  /**
   * 恢复调度器
   */
  resume(): void {
    this.isPaused = false;

    if (this.queue.size > 0 && !this.isRunning) {
      this.start();
    }

    if (this.config.debug) {
      console.log(`[FrameParseScheduler] 调度器已恢复`);
    }
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning || this.isPaused) {
      return;
    }

    this.isRunning = true;
    this.scheduleNextFrame();

    if (this.config.debug) {
      console.log(`[FrameParseScheduler] 调度器已启动`);
    }
  }

  /**
   * 停止调度器
   */
  stop(): void {
    this.isRunning = false;
    this.cancelScheduledCallbacks();

    if (this.config.debug) {
      console.log(`[FrameParseScheduler] 调度器已停止`);
    }
  }

  /**
   * 销毁调度器
   */
  destroy(): void {
    this.stop();
    this.cancelAll();
    this.stopMemoryMonitoring();
    this.queue.clear();
    this.taskIndex.clear();
    this.runningTasks.clear();

    if (this.config.debug) {
      console.log(`[FrameParseScheduler] 调度器已销毁`);
    }
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): ParseTaskStatus | undefined {
    return this.taskIndex.get(taskId)?.status;
  }

  /**
   * 获取待处理任务数
   */
  getPendingCount(): number {
    return this.queue.size;
  }

  /**
   * 检查是否正在运行
   */
  isProcessing(): boolean {
    return this.isRunning && !this.isPaused;
  }

  /**
   * 获取统计信息
   */
  getStats(): SchedulerStats {
    const taskTimes = this.stats.taskTimes;
    const averageTaskTime =
      taskTimes.length > 0 ? taskTimes.reduce((a, b) => a + b, 0) / taskTimes.length : 0;

    return {
      totalTasks:
        this.stats.completedTasks +
        this.stats.cancelledTasks +
        this.stats.failedTasks +
        this.queue.size,
      completedTasks: this.stats.completedTasks,
      cancelledTasks: this.stats.cancelledTasks,
      failedTasks: this.stats.failedTasks,
      pendingTasks: this.queue.size,
      averageTaskTime,
      totalExecutionTime: this.stats.totalExecutionTime,
      droppedFrames: this.stats.droppedFrames,
      memoryPressure: this.memoryPressure,
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      completedTasks: 0,
      cancelledTasks: 0,
      failedTasks: 0,
      totalExecutionTime: 0,
      droppedFrames: 0,
      taskTimes: [],
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<FrameParseSchedulerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前内存压力
   */
  getMemoryPressure(): MemoryPressureLevel {
    return this.memoryPressure;
  }

  /**
   * 让出主线程（使用 scheduler.yield 如果可用）
   */
  async yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      // 检查 Scheduler API
      if (
        'scheduler' in globalThis &&
        'yield' in (globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler
      ) {
        (
          (globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler
            .yield as () => Promise<void>
        )().then(resolve);
      } else {
        // 回退到 setTimeout
        setTimeout(resolve, 0);
      }
    });
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 调度下一帧
   */
  private scheduleNextFrame(): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    // 根据是否有空闲时间选择调度方式
    if (
      this.config.useIdleCallback &&
      'requestIdleCallback' in window &&
      this.queue.peek()?.priority === ParseTaskPriority.IDLE
    ) {
      this.idleCallbackId = requestIdleCallback(
        (deadline) => this.processIdleFrame(deadline),
        { timeout: this.config.idleCallbackTimeout }
      );
    } else {
      this.rafId = requestAnimationFrame(() => this.processFrame());
    }
  }

  /**
   * 处理一帧（使用 requestAnimationFrame）
   */
  private processFrame(): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    this.frameStartTime = performance.now();
    const maxTime = this.getAdjustedMaxFrameTime();

    this.processTasksWithBudget(maxTime);

    // 如果还有任务，继续调度
    if (this.queue.size > 0 || this.runningTasks.size > 0) {
      this.scheduleNextFrame();
    } else {
      this.isRunning = false;
    }
  }

  /**
   * 处理空闲帧（使用 requestIdleCallback）
   */
  private processIdleFrame(deadline: IdleDeadline): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    this.frameStartTime = performance.now();
    const remainingTime = deadline.timeRemaining();
    const maxTime = Math.min(remainingTime, this.config.maxFrameTime);

    this.processTasksWithBudget(maxTime);

    // 如果还有任务，继续调度
    if (this.queue.size > 0 || this.runningTasks.size > 0) {
      this.scheduleNextFrame();
    } else {
      this.isRunning = false;
    }
  }

  /**
   * 在时间预算内处理任务
   */
  private processTasksWithBudget(maxTime: number): void {
    let processedCount = 0;
    const batchSize = this.getAdjustedBatchSize();

    while (
      this.queue.size > 0 &&
      this.hasTimeBudget(maxTime) &&
      processedCount < batchSize &&
      this.runningTasks.size < this.config.maxConcurrentTasks
    ) {
      const task = this.queue.dequeue();
      if (!task || task.status === ParseTaskStatus.CANCELLED) {
        continue;
      }

      // 执行任务
      this.executeTask(task);
      processedCount++;
    }

    // 检查是否丢帧
    const elapsed = performance.now() - this.frameStartTime;
    if (elapsed > 16.67) {
      // 超过 60fps 的帧时间
      this.stats.droppedFrames++;
      if (this.config.debug) {
        console.warn(`[FrameParseScheduler] 帧超时: ${elapsed.toFixed(2)}ms`);
      }
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: ParseTask): Promise<void> {
    task.status = ParseTaskStatus.RUNNING;
    this.runningTasks.set(task.id, task);

    const startTime = performance.now();

    try {
      const result = await task.execute();
      const completed = this.taskIndex.get(task.id);

      if (completed && completed.status !== ParseTaskStatus.CANCELLED) {
        completed.status = ParseTaskStatus.COMPLETED;
        this.stats.completedTasks++;

        const taskTime = performance.now() - startTime;
        this.stats.taskTimes.push(taskTime);
        this.stats.totalExecutionTime += taskTime;

        // 保持 taskTimes 数组大小合理
        if (this.stats.taskTimes.length > 100) {
          this.stats.taskTimes.shift();
        }

        if (task.onComplete) {
          task.onComplete(result);
        }
      }
    } catch (error) {
      const failed = this.taskIndex.get(task.id);
      if (failed) {
        failed.status = ParseTaskStatus.FAILED;
        this.stats.failedTasks++;

        if (task.onError) {
          task.onError(error instanceof Error ? error : new Error(String(error)));
        }
      }

      if (this.config.debug) {
        console.error(`[FrameParseScheduler] 任务执行失败: ${task.id}`, error);
      }
    } finally {
      this.runningTasks.delete(task.id);
      this.taskIndex.delete(task.id);
    }
  }

  /**
   * 检查是否还有时间预算
   */
  private hasTimeBudget(maxTime: number): boolean {
    const elapsed = performance.now() - this.frameStartTime;
    return elapsed < maxTime;
  }

  /**
   * 获取调整后的最大帧时间（根据内存压力）
   */
  private getAdjustedMaxFrameTime(): number {
    switch (this.memoryPressure) {
      case MemoryPressureLevel.CRITICAL:
        return this.config.maxFrameTime * 0.5; // 减半
      case MemoryPressureLevel.HIGH:
        return this.config.maxFrameTime * 0.75;
      case MemoryPressureLevel.MEDIUM:
        return this.config.maxFrameTime * 0.9;
      default:
        return this.config.maxFrameTime;
    }
  }

  /**
   * 获取调整后的批量大小（根据内存压力）
   */
  private getAdjustedBatchSize(): number {
    switch (this.memoryPressure) {
      case MemoryPressureLevel.CRITICAL:
        return 1; // 每帧只处理一个
      case MemoryPressureLevel.HIGH:
        return Math.max(1, Math.floor(this.config.batchSize / 4));
      case MemoryPressureLevel.MEDIUM:
        return Math.max(1, Math.floor(this.config.batchSize / 2));
      default:
        return this.config.batchSize;
    }
  }

  /**
   * 取消已调度的回调
   */
  private cancelScheduledCallbacks(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.idleCallbackId !== null && 'cancelIdleCallback' in window) {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
  }

  /**
   * 启动内存监控
   */
  private startMemoryMonitoring(): void {
    if (this.memoryCheckInterval) {
      return;
    }

    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryPressure();
    }, 3000); // 每 3 秒检查一次
  }

  /**
   * 停止内存监控
   */
  private stopMemoryMonitoring(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  }

  /**
   * 检查内存压力
   */
  private checkMemoryPressure(): void {
    if (!('performance' in globalThis) || !('memory' in performance)) {
      return;
    }

    const memory = (performance as unknown as { memory: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const usedMB = memory.usedJSHeapSize / (1024 * 1024);
    const limitMB = memory.jsHeapSizeLimit / (1024 * 1024);
    const usageRatio = usedMB / limitMB;

    let newPressure: MemoryPressureLevel;

    if (usageRatio > 0.9 || usedMB > this.config.memoryThreshold * 1.5) {
      newPressure = MemoryPressureLevel.CRITICAL;
    } else if (usageRatio > 0.7 || usedMB > this.config.memoryThreshold) {
      newPressure = MemoryPressureLevel.HIGH;
    } else if (usageRatio > 0.5 || usedMB > this.config.memoryThreshold * 0.7) {
      newPressure = MemoryPressureLevel.MEDIUM;
    } else {
      newPressure = MemoryPressureLevel.LOW;
    }

    const oldPressure = this.memoryPressure;
    this.memoryPressure = newPressure;

    if (oldPressure !== newPressure && this.config.debug) {
      console.log(
        `[FrameParseScheduler] 内存压力变化: ${oldPressure} -> ${newPressure} (${usedMB.toFixed(0)}MB / ${limitMB.toFixed(0)}MB)`
      );
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建帧调度解析器
 */
export function createFrameParseScheduler(
  config?: Partial<FrameParseSchedulerConfig>
): FrameParseScheduler {
  return new FrameParseScheduler(config);
}

/**
 * 创建高性能配置的调度器
 */
export function createHighPerformanceScheduler(): FrameParseScheduler {
  return new FrameParseScheduler({
    maxFrameTime: 6, // 更严格的帧时间
    idleCallbackTimeout: 30,
    useIdleCallback: true,
    maxConcurrentTasks: 2,
    batchSize: 5,
    debug: false,
    memoryThreshold: 300, // 更低的内存阈值
  });
}

// ================================
// 全局单例
// ================================

let globalScheduler: FrameParseScheduler | null = null;

/**
 * 获取全局调度器
 */
export function getGlobalScheduler(): FrameParseScheduler {
  if (!globalScheduler) {
    globalScheduler = new FrameParseScheduler();
  }
  return globalScheduler;
}

/**
 * 销毁全局调度器
 */
export function destroyGlobalScheduler(): void {
  if (globalScheduler) {
    globalScheduler.destroy();
    globalScheduler = null;
  }
}

// ================================
// 导出
// ================================

export default FrameParseScheduler;
