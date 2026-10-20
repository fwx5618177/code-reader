// ================================
// 帧预算调度器 (Frame Scheduler)
//
// 渲染管线的 DOM 提交都经此调度，避免大文档一次性提交阻塞主线程
// 核心特性：
// 1. 帧预算控制：每帧只处理固定时间（至少执行一个任务，保证不会饥饿）
// 2. 优先级队列：可视区优先，同优先级先入先出
// 3. 内存压力响应：内存紧张时缩小每帧预算与批量，并推迟下一帧
// ================================

/**
 * 任务优先级（数值越小越先执行）
 */
export enum TaskPriority {
  /** 关键任务（可视区） */
  CRITICAL = 0,
  /** 普通优先级 */
  NORMAL = 1,
  /** 低优先级（后台任务） */
  LOW = 2,
}

/**
 * 调度任务
 */
interface ScheduledTask {
  /** 任务名称（用于错误日志） */
  name: string;
  priority: TaskPriority;
  /** 入队序号：同优先级按入队顺序执行 */
  seq: number;
  execute: () => void;
}

/**
 * 帧预算配置
 */
interface FrameBudgetConfig {
  /** 每帧最大处理时间（毫秒） */
  maxFrameTime: number;
  /** 每帧最多执行的任务数 */
  batchSize: number;
}

const DEFAULT_CONFIG: FrameBudgetConfig = {
  maxFrameTime: 8, // 8ms，留出 ~8ms 给渲染
  batchSize: 5,
};

/**
 * 内存压力等级
 */
enum MemoryPressure {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// ================================
// 优先级队列
// ================================

/**
 * 优先级队列实现（最小堆）
 */
class PriorityQueue {
  private heap: ScheduledTask[] = [];

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  enqueue(item: ScheduledTask): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  dequeue(): ScheduledTask | undefined {
    const item = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return item;
  }

  clear(): void {
    this.heap = [];
  }

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

  private compare(a: ScheduledTask, b: ScheduledTask): number {
    return a.priority !== b.priority ? a.priority - b.priority : a.seq - b.seq;
  }
}

// ================================
// 帧预算调度器
// ================================

export class FrameScheduler {
  private readonly config: FrameBudgetConfig;
  private readonly queue = new PriorityQueue();
  private seq = 0;
  private isRunning = false;
  private rafId: number | null = null;
  private memoryPressure = MemoryPressure.LOW;
  private memoryCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<FrameBudgetConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startMemoryMonitoring();
  }

  /**
   * 调度任务（自动启动调度循环）
   */
  schedule(name: string, execute: () => void, options: { priority?: TaskPriority } = {}): void {
    this.queue.enqueue({
      name,
      priority: options.priority ?? TaskPriority.NORMAL,
      seq: ++this.seq,
      execute,
    });

    if (!this.isRunning) {
      this.isRunning = true;
      this.scheduleNextFrame();
    }
  }

  /**
   * 取消所有尚未执行的任务
   */
  cancelAll(): void {
    this.queue.clear();
  }

  /**
   * 销毁调度器
   */
  destroy(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.queue.clear();
    if (this.memoryCheckInterval !== null) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  }

  // ================================
  // 私有方法
  // ================================

  private scheduleNextFrame(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.queue.isEmpty) {
      this.isRunning = false;
      return;
    }

    // 内存压力高时推迟下一帧，给 GC 留出时间
    if (this.memoryPressure === MemoryPressure.CRITICAL) {
      setTimeout(() => this.processFrame(), 100);
      return;
    }
    if (this.memoryPressure === MemoryPressure.HIGH) {
      setTimeout(() => this.processFrame(), 50);
      return;
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.processFrame();
    });
  }

  /**
   * 在帧预算内处理任务
   */
  private processFrame(): void {
    if (!this.isRunning) {
      return;
    }

    const frameStart = performance.now();
    const maxTime = this.getAdjustedMaxFrameTime();
    const batchSize = this.getAdjustedBatchSize();
    let processedCount = 0;

    // 每帧至少执行一个任务，否则持续繁忙时队列会永远饥饿
    while (
      processedCount < batchSize &&
      !this.queue.isEmpty &&
      (processedCount === 0 || performance.now() - frameStart < maxTime)
    ) {
      const task = this.queue.dequeue()!;
      try {
        task.execute();
      } catch (error) {
        console.error(`[FrameScheduler] 任务失败: ${task.name}`, error);
      }
      processedCount++;
    }

    this.scheduleNextFrame();
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
   * 启动内存监控（每 5 秒检查一次，并立即检查一次）
   */
  private startMemoryMonitoring(): void {
    this.memoryCheckInterval = setInterval(() => this.checkMemoryPressure(), 5000);
    this.checkMemoryPressure();
  }

  /**
   * 检查内存压力（performance.memory 仅 Chromium 支持）
   */
  private checkMemoryPressure(): void {
    const memory = (
      performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
    ).memory;
    if (!memory) return;

    const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
    if (usageRatio > 0.9) {
      this.memoryPressure = MemoryPressure.CRITICAL;
    } else if (usageRatio > 0.75) {
      this.memoryPressure = MemoryPressure.HIGH;
    } else if (usageRatio > 0.5) {
      this.memoryPressure = MemoryPressure.MEDIUM;
    } else {
      this.memoryPressure = MemoryPressure.LOW;
    }
  }
}
