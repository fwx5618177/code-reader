// ================================
// 帧预算调度器 (Frame Scheduler)
//
// 高性能任务调度器，用于大文件增量解析时避免主线程阻塞和 OOM
// 核心特性：
// 1. 帧预算控制：每帧只处理固定时间，避免阻塞 UI
// 2. 优先级队列：可见区域优先处理
// 3. 内存压力响应：根据内存状态调整策略
// 4. 支持任务取消和暂停
// ================================

/**
 * 任务优先级
 */
export enum TaskPriority {
  /** 关键任务（立即执行） */
  CRITICAL = 0,
  /** 高优先级（可见区域） */
  HIGH = 1,
  /** 普通优先级 */
  NORMAL = 2,
  /** 低优先级（后台任务） */
  LOW = 3,
  /** 空闲时执行 */
  IDLE = 4,
}

/**
 * 任务状态
 */
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

/**
 * 调度任务
 */
export interface ScheduledTask<T = unknown> {
  /** 任务 ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 优先级 */
  priority: TaskPriority;
  /** 任务状态 */
  status: TaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 开始执行时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 执行函数（返回 true 表示任务完成，false 表示需要继续） */
  execute: () => boolean | Promise<boolean>;
  /** 取消回调 */
  onCancel?: () => void;
  /** 完成回调 */
  onComplete?: (result: T) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 任务结果 */
  result?: T;
  /** 错误信息 */
  error?: Error;
}

/**
 * 帧预算配置
 */
export interface FrameBudgetConfig {
  /** 每帧最大处理时间（毫秒） */
  maxFrameTime: number;
  /** 空闲阈值：当帧时间小于此值时认为有空闲时间（毫秒） */
  idleThreshold: number;
  /** 是否使用 requestIdleCallback */
  useIdleCallback: boolean;
  /** 空闲回调超时时间（毫秒） */
  idleCallbackTimeout: number;
  /** 最大并发任务数 */
  maxConcurrentTasks: number;
  /** 任务批处理大小 */
  batchSize: number;
  /** 调试模式 */
  debug: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: FrameBudgetConfig = {
  maxFrameTime: 8, // 8ms，留出 ~8ms 给渲染
  idleThreshold: 4, // 4ms
  useIdleCallback: true,
  idleCallbackTimeout: 50, // 50ms
  maxConcurrentTasks: 1,
  batchSize: 5,
  debug: false,
};

/**
 * 内存压力等级
 */
export enum MemoryPressure {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 调度器统计信息
 */
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
  /** 帧丢弃次数（超时） */
  droppedFrames: number;
  /** 当前内存压力 */
  memoryPressure: MemoryPressure;
}

// ================================
// 任务 ID 生成
// ================================

let taskIdCounter = 0;

/**
 * 生成任务 ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${++taskIdCounter}`;
}

// ================================
// 优先级队列
// ================================

/**
 * 优先级队列实现（最小堆）
 */
class PriorityQueue<T extends { priority: number; createdAt: number }> {
  private heap: T[] = [];

  /**
   * 获取队列大小
   */
  get size(): number {
    return this.heap.length;
  }

  /**
   * 检查队列是否为空
   */
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

    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return item;
  }

  /**
   * 查看队首元素
   */
  peek(): T | undefined {
    return this.heap[0];
  }

  /**
   * 移除指定元素
   */
  remove(predicate: (item: T) => boolean): T | undefined {
    const index = this.heap.findIndex(predicate);
    if (index === -1) {
      return undefined;
    }

    const item = this.heap[index];
    const last = this.heap.pop();

    if (index < this.heap.length && last) {
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
   * 获取所有元素
   */
  toArray(): T[] {
    return [...this.heap];
  }

  /**
   * 向上冒泡
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex]!;
      const current = this.heap[index]!;

      if (this.compare(current, parent) >= 0) {
        break;
      }

      this.heap[parentIndex] = current;
      this.heap[index] = parent;
      index = parentIndex;
    }
  }

  /**
   * 向下冒泡
   */
  private bubbleDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.compare(this.heap[leftChild]!, this.heap[smallest]!) < 0) {
        smallest = leftChild;
      }

      if (rightChild < length && this.compare(this.heap[rightChild]!, this.heap[smallest]!) < 0) {
        smallest = rightChild;
      }

      if (smallest === index) {
        break;
      }

      const temp = this.heap[index]!;
      this.heap[index] = this.heap[smallest]!;
      this.heap[smallest] = temp;
      index = smallest;
    }
  }

  /**
   * 比较函数：优先级相同时，先创建的任务优先
   */
  private compare(a: T, b: T): number {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.createdAt - b.createdAt;
  }
}

// ================================
// 帧预算调度器
// ================================

/**
 * 帧预算调度器
 *
 * 用于在主线程上高效调度任务，避免阻塞 UI
 */
export class FrameScheduler {
  /** 配置 */
  private config: FrameBudgetConfig;

  /** 任务队列 */
  private queue: PriorityQueue<ScheduledTask>;

  /** 正在执行的任务 */
  private runningTasks: Map<string, ScheduledTask> = new Map();

  /** 所有任务索引 */
  private taskIndex: Map<string, ScheduledTask> = new Map();

  /** 是否正在运行 */
  private isRunning: boolean = false;

  /** 是否暂停 */
  private isPaused: boolean = false;

  /** 当前帧开始时间 */
  private frameStartTime: number = 0;

  /** requestAnimationFrame ID */
  private rafId: number | null = null;

  /** requestIdleCallback ID */
  private idleCallbackId: number | null = null;

  /** 统计信息 */
  private stats: {
    completedTasks: number;
    cancelledTasks: number;
    failedTasks: number;
    totalExecutionTime: number;
    droppedFrames: number;
    taskTimes: number[];
  } = {
    completedTasks: 0,
    cancelledTasks: 0,
    failedTasks: 0,
    totalExecutionTime: 0,
    droppedFrames: 0,
    taskTimes: [],
  };

  /** 内存压力 */
  private memoryPressure: MemoryPressure = MemoryPressure.LOW;

  /** 内存检查定时器 */
  private memoryCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<FrameBudgetConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queue = new PriorityQueue();

    // 启动内存监控
    this.startMemoryMonitoring();
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 调度任务
   */
  schedule(
    name: string,
    execute: () => boolean | Promise<boolean>,
    options: {
      priority?: TaskPriority;
      onComplete?: (result: unknown) => void;
      onError?: (error: Error) => void;
      onCancel?: () => void;
    } = {}
  ): string {
    const task: ScheduledTask = {
      id: generateTaskId(),
      name,
      priority: options.priority ?? TaskPriority.NORMAL,
      status: TaskStatus.PENDING,
      createdAt: performance.now(),
      execute,
      onComplete: options.onComplete,
      onError: options.onError,
      onCancel: options.onCancel,
    };

    this.queue.enqueue(task);
    this.taskIndex.set(task.id, task);

    if (this.config.debug) {
      console.log(`[FrameScheduler] 任务已调度: ${name} (${task.id}), 优先级: ${task.priority}`);
    }

    // 自动启动
    if (!this.isRunning && !this.isPaused) {
      this.start();
    }

    return task.id;
  }

  /**
   * 批量调度任务
   */
  scheduleBatch(
    tasks: Array<{
      name: string;
      execute: () => boolean | Promise<boolean>;
      priority?: TaskPriority;
    }>
  ): string[] {
    return tasks.map((t) => this.schedule(t.name, t.execute, { priority: t.priority }));
  }

  /**
   * 取消任务
   */
  cancel(taskId: string): boolean {
    const task = this.taskIndex.get(taskId);
    if (!task) {
      return false;
    }

    if (task.status === TaskStatus.PENDING) {
      this.queue.remove((t) => t.id === taskId);
      task.status = TaskStatus.CANCELLED;
      task.onCancel?.();
      this.stats.cancelledTasks++;

      if (this.config.debug) {
        console.log(`[FrameScheduler] 任务已取消: ${task.name} (${taskId})`);
      }

      return true;
    }

    if (task.status === TaskStatus.RUNNING) {
      // 标记为已取消，执行循环会检查
      task.status = TaskStatus.CANCELLED;
      return true;
    }

    return false;
  }

  /**
   * 取消所有任务
   */
  cancelAll(): number {
    let cancelled = 0;

    // 取消队列中的任务
    while (!this.queue.isEmpty) {
      const task = this.queue.dequeue();
      if (task && task.status === TaskStatus.PENDING) {
        task.status = TaskStatus.CANCELLED;
        task.onCancel?.();
        cancelled++;
      }
    }

    // 取消正在执行的任务
    for (const task of this.runningTasks.values()) {
      task.status = TaskStatus.CANCELLED;
      task.onCancel?.();
      cancelled++;
    }

    this.stats.cancelledTasks += cancelled;

    if (this.config.debug) {
      console.log(`[FrameScheduler] 已取消 ${cancelled} 个任务`);
    }

    return cancelled;
  }

  /**
   * 开始调度
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.isPaused = false;

    if (this.config.debug) {
      console.log('[FrameScheduler] 调度器已启动');
    }

    this.scheduleNextFrame();
  }

  /**
   * 暂停调度
   */
  pause(): void {
    this.isPaused = true;
    this.cancelScheduledCallbacks();

    if (this.config.debug) {
      console.log('[FrameScheduler] 调度器已暂停');
    }
  }

  /**
   * 恢复调度
   */
  resume(): void {
    if (!this.isPaused) {
      return;
    }

    this.isPaused = false;

    if (this.isRunning) {
      this.scheduleNextFrame();
    }

    if (this.config.debug) {
      console.log('[FrameScheduler] 调度器已恢复');
    }
  }

  /**
   * 停止调度器
   */
  stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.cancelScheduledCallbacks();

    if (this.config.debug) {
      console.log('[FrameScheduler] 调度器已停止');
    }
  }

  /**
   * 销毁调度器
   */
  destroy(): void {
    this.stop();
    this.cancelAll();
    this.taskIndex.clear();
    this.stopMemoryMonitoring();

    if (this.config.debug) {
      console.log('[FrameScheduler] 调度器已销毁');
    }
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.taskIndex.get(taskId)?.status;
  }

  /**
   * 获取待处理任务数
   */
  getPendingCount(): number {
    return this.queue.size;
  }

  /**
   * 检查是否有任务在执行
   */
  isProcessing(): boolean {
    return this.isRunning && (this.queue.size > 0 || this.runningTasks.size > 0);
  }

  /**
   * 获取统计信息
   */
  getStats(): SchedulerStats {
    const taskTimes = this.stats.taskTimes;
    const averageTaskTime =
      taskTimes.length > 0 ? taskTimes.reduce((a, b) => a + b, 0) / taskTimes.length : 0;

    return {
      totalTasks: this.taskIndex.size,
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
  updateConfig(config: Partial<FrameBudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前内存压力
   */
  getMemoryPressure(): MemoryPressure {
    return this.memoryPressure;
  }

  /**
   * 让出主线程
   */
  async yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof MessageChannel !== 'undefined') {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
      } else {
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

    // 如果没有待处理任务，停止调度
    if (this.queue.isEmpty && this.runningTasks.size === 0) {
      this.isRunning = false;
      return;
    }

    // 根据内存压力调整策略
    if (this.memoryPressure === MemoryPressure.CRITICAL) {
      // 危急状态：使用 setTimeout，给更多时间恢复
      setTimeout(() => this.processFrame(), 100);
      return;
    }

    if (this.memoryPressure === MemoryPressure.HIGH) {
      // 高压力：使用较长延迟
      setTimeout(() => this.processFrame(), 50);
      return;
    }

    // 使用 requestIdleCallback（如果可用且启用）
    if (this.config.useIdleCallback && typeof requestIdleCallback !== 'undefined') {
      this.idleCallbackId = requestIdleCallback((deadline) => this.processIdleFrame(deadline), {
        timeout: this.config.idleCallbackTimeout,
      });
    } else {
      // 使用 requestAnimationFrame
      this.rafId = requestAnimationFrame(() => this.processFrame());
    }
  }

  /**
   * 处理帧（使用 requestAnimationFrame）
   */
  private processFrame(): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    this.frameStartTime = performance.now();
    const maxTime = this.getAdjustedMaxFrameTime();

    this.processTasksWithBudget(maxTime);

    // 调度下一帧
    this.scheduleNextFrame();
  }

  /**
   * 处理空闲帧（使用 requestIdleCallback）
   */
  private processIdleFrame(deadline: IdleDeadline): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    this.frameStartTime = performance.now();

    // 使用 deadline 提供的剩余时间
    const remainingTime = deadline.timeRemaining();
    const maxTime = Math.min(remainingTime, this.getAdjustedMaxFrameTime());

    this.processTasksWithBudget(maxTime);

    // 调度下一帧
    this.scheduleNextFrame();
  }

  /**
   * 在预算内处理任务
   */
  private processTasksWithBudget(maxTime: number): void {
    let processedCount = 0;
    const batchSize = this.getAdjustedBatchSize();

    while (processedCount < batchSize && this.hasTimeBudget(maxTime) && !this.queue.isEmpty) {
      const task = this.queue.dequeue();
      if (!task) {
        break;
      }

      // 检查任务是否已取消
      if (task.status === TaskStatus.CANCELLED) {
        continue;
      }

      // 执行任务
      this.executeTask(task);
      processedCount++;
    }

    // 检查是否超时
    const elapsed = performance.now() - this.frameStartTime;
    if (elapsed > maxTime) {
      this.stats.droppedFrames++;

      if (this.config.debug) {
        console.warn(`[FrameScheduler] 帧超时: ${elapsed.toFixed(2)}ms > ${maxTime}ms`);
      }
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    task.status = TaskStatus.RUNNING;
    task.startedAt = performance.now();
    this.runningTasks.set(task.id, task);

    try {
      const result = task.execute();
      const completed = result instanceof Promise ? await result : result;

      // 检查任务是否在执行期间被取消（通过外部标记）
      const currentTask = this.taskIndex.get(task.id);
      if (currentTask && currentTask.status === TaskStatus.CANCELLED) {
        this.runningTasks.delete(task.id);
        task.onCancel?.();
        return;
      }

      if (completed) {
        // 任务完成
        task.status = TaskStatus.COMPLETED;
        task.completedAt = performance.now();

        const taskTime = task.completedAt - task.startedAt!;
        this.stats.taskTimes.push(taskTime);
        this.stats.totalExecutionTime += taskTime;
        this.stats.completedTasks++;

        // 限制统计数组大小
        if (this.stats.taskTimes.length > 100) {
          this.stats.taskTimes.shift();
        }

        task.onComplete?.(task.result);

        if (this.config.debug) {
          console.log(
            `[FrameScheduler] 任务完成: ${task.name} (${task.id}), 耗时: ${taskTime.toFixed(2)}ms`
          );
        }
      } else {
        // 任务需要继续，重新入队
        task.status = TaskStatus.PENDING;
        this.queue.enqueue(task);
      }
    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.error = error instanceof Error ? error : new Error(String(error));
      task.completedAt = performance.now();
      this.stats.failedTasks++;

      task.onError?.(task.error);

      if (this.config.debug) {
        console.error(`[FrameScheduler] 任务失败: ${task.name} (${task.id})`, error);
      }
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  /**
   * 检查是否有剩余时间预算
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
      case MemoryPressure.CRITICAL:
        return this.config.maxFrameTime * 0.25;
      case MemoryPressure.HIGH:
        return this.config.maxFrameTime * 0.5;
      case MemoryPressure.MEDIUM:
        return this.config.maxFrameTime * 0.75;
      default:
        return this.config.maxFrameTime;
    }
  }

  /**
   * 获取调整后的批处理大小（根据内存压力）
   */
  private getAdjustedBatchSize(): number {
    switch (this.memoryPressure) {
      case MemoryPressure.CRITICAL:
        return 1;
      case MemoryPressure.HIGH:
        return Math.max(1, Math.floor(this.config.batchSize / 4));
      case MemoryPressure.MEDIUM:
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

    if (this.idleCallbackId !== null && typeof cancelIdleCallback !== 'undefined') {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
  }

  /**
   * 启动内存监控
   */
  private startMemoryMonitoring(): void {
    // 每 5 秒检查一次内存
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryPressure();
    }, 5000);

    // 立即检查一次
    this.checkMemoryPressure();
  }

  /**
   * 停止内存监控
   */
  private stopMemoryMonitoring(): void {
    if (this.memoryCheckInterval !== null) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  }

  /**
   * 检查内存压力
   */
  private checkMemoryPressure(): void {
    // 使用 performance.memory（仅 Chrome 支持）
    const memory = (
      performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
    ).memory;

    if (memory) {
      const usedMB = memory.usedJSHeapSize / (1024 * 1024);
      const limitMB = memory.jsHeapSizeLimit / (1024 * 1024);
      const usageRatio = usedMB / limitMB;

      let newPressure: MemoryPressure;
      if (usageRatio > 0.9) {
        newPressure = MemoryPressure.CRITICAL;
      } else if (usageRatio > 0.75) {
        newPressure = MemoryPressure.HIGH;
      } else if (usageRatio > 0.5) {
        newPressure = MemoryPressure.MEDIUM;
      } else {
        newPressure = MemoryPressure.LOW;
      }

      if (newPressure !== this.memoryPressure) {
        const oldPressure = this.memoryPressure;
        this.memoryPressure = newPressure;

        if (this.config.debug) {
          console.log(
            `[FrameScheduler] 内存压力变化: ${oldPressure} -> ${newPressure} ` +
              `(${usedMB.toFixed(1)}MB / ${limitMB.toFixed(1)}MB, ${(usageRatio * 100).toFixed(1)}%)`
          );
        }
      }
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建帧调度器
 */
export function createFrameScheduler(config: Partial<FrameBudgetConfig> = {}): FrameScheduler {
  return new FrameScheduler(config);
}

/**
 * 创建高性能帧调度器（针对大文件优化）
 */
export function createHighPerformanceScheduler(): FrameScheduler {
  return new FrameScheduler({
    maxFrameTime: 4, // 更短的帧时间
    idleThreshold: 2,
    useIdleCallback: true,
    idleCallbackTimeout: 30,
    maxConcurrentTasks: 1,
    batchSize: 3,
    debug: false,
  });
}

/**
 * 全局调度器单例
 */
let globalScheduler: FrameScheduler | null = null;

/**
 * 获取全局调度器
 */
export function getGlobalScheduler(): FrameScheduler {
  if (!globalScheduler) {
    globalScheduler = createFrameScheduler();
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
