// ================================
// LaTeX Worker 服务
//
// 统一管理 Web Worker 的解析和渲染任务
//
// 核心特性：
// 1. Worker 池管理，支持多 Worker 并行处理
// 2. 任务队列和优先级调度
// 3. 超时保护和自动重试
// 4. 任务取消和清理
// 5. 性能统计和监控
// ================================

import type {
  RootNode,
  LatexParserOptions,
  LatexRenderOptions,
  LatexRenderResult,
  DocumentChange,
  WorkerRequest,
  WorkerResponse,
} from './types';

// ================================
// 类型定义
// ================================

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 任务优先级 */
export type TaskPriority = 'high' | 'normal' | 'low';

/** 任务类型 */
export type TaskType = 'parse' | 'parse_incremental' | 'render' | 'render_block';

/** 任务配置 */
export interface TaskConfig {
  /** 任务 ID */
  readonly id: string;
  /** 任务类型 */
  readonly type: TaskType;
  /** 任务数据 */
  readonly data: unknown;
  /** 优先级 */
  readonly priority: TaskPriority;
  /** 超时时间（毫秒） */
  readonly timeoutMs: number;
  /** 重试次数 */
  readonly maxRetries: number;
  /** 创建时间 */
  readonly createdAt: number;
}

/** 任务结果 */
export interface TaskResult<T = unknown> {
  /** 任务 ID */
  readonly taskId: string;
  /** 是否成功 */
  readonly success: boolean;
  /** 结果数据 */
  readonly data?: T;
  /** 错误信息 */
  readonly error?: string;
  /** 执行时间（毫秒） */
  readonly executionTime: number;
  /** 重试次数 */
  readonly retryCount: number;
}

/** 解析任务数据 */
export interface ParseTaskData {
  /** 源码内容 */
  readonly content: string;
  /** 解析选项 */
  readonly options?: LatexParserOptions;
}

/** 增量解析任务数据 */
export interface IncrementalParseTaskData {
  /** 源码内容 */
  readonly content: string;
  /** 变更列表 */
  readonly changes: readonly DocumentChange[];
  /** 解析选项 */
  readonly options?: LatexParserOptions;
}

/** 渲染任务数据 */
export interface RenderTaskData {
  /** AST */
  readonly ast: RootNode;
  /** 渲染选项 */
  readonly options?: LatexRenderOptions;
}

/** 块渲染任务数据 */
export interface RenderBlockTaskData {
  /** 节点列表 */
  readonly nodes: readonly unknown[];
  /** 渲染选项 */
  readonly options?: LatexRenderOptions;
}

/** Worker 服务配置 */
export interface WorkerServiceConfig {
  /** Worker 数量 */
  workerCount?: number;
  /** 默认超时时间（毫秒） */
  defaultTimeoutMs?: number;
  /** 默认重试次数 */
  defaultMaxRetries?: number;
  /** 最大队列长度 */
  maxQueueSize?: number;
  /** 是否启用性能监控 */
  enableMonitoring?: boolean;
}

/** Worker 状态 */
interface WorkerState {
  /** Worker 实例 */
  readonly worker: Worker;
  /** 是否空闲 */
  idle: boolean;
  /** 当前任务 ID */
  currentTaskId: string | null;
  /** 已处理任务数 */
  processedCount: number;
  /** 错误次数 */
  errorCount: number;
}

/** 待处理任务 */
interface PendingTask {
  /** 任务配置 */
  readonly config: TaskConfig;
  /** 完成回调 */
  resolve: (result: TaskResult) => void;
  /** 错误回调 */
  reject: (error: Error) => void;
  /** 超时计时器 */
  timeoutId: ReturnType<typeof setTimeout> | null;
  /** 重试次数 */
  retryCount: number;
  /** 开始时间 */
  startTime: number | null;
}

/** 服务统计信息 */
export interface WorkerServiceStats {
  /** 总任务数 */
  readonly totalTasks: number;
  /** 完成任务数 */
  readonly completedTasks: number;
  /** 失败任务数 */
  readonly failedTasks: number;
  /** 取消任务数 */
  readonly cancelledTasks: number;
  /** 平均执行时间（毫秒） */
  readonly avgExecutionTime: number;
  /** 队列长度 */
  readonly queueLength: number;
  /** Worker 状态 */
  readonly workerStates: readonly {
    readonly idle: boolean;
    readonly processedCount: number;
    readonly errorCount: number;
  }[];
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<WorkerServiceConfig> = {
  workerCount: 2,
  defaultTimeoutMs: 30000,
  defaultMaxRetries: 2,
  maxQueueSize: 100,
  enableMonitoring: true,
};

// ================================
// Worker 服务
// ================================

/**
 * LaTeX Worker 服务
 *
 * 统一管理 Web Worker 的解析和渲染任务，
 * 提供任务队列、优先级调度、超时保护等功能。
 */
export class LatexWorkerService {
  private readonly config: Required<WorkerServiceConfig>;
  private readonly workers: WorkerState[];
  private readonly pendingTasks: Map<string, PendingTask>;
  private readonly taskQueue: TaskConfig[];
  private taskIdCounter: number;
  private isDestroyed: boolean;

  // 统计信息
  private totalTasks: number;
  private completedTasks: number;
  private failedTasks: number;
  private cancelledTasks: number;
  private totalExecutionTime: number;

  constructor(config?: WorkerServiceConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.workers = [];
    this.pendingTasks = new Map();
    this.taskQueue = [];
    this.taskIdCounter = 0;
    this.isDestroyed = false;

    // 统计初始化
    this.totalTasks = 0;
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.cancelledTasks = 0;
    this.totalExecutionTime = 0;

    // 初始化 Workers
    this.initWorkers();
  }

  // ================================
  // Worker 初始化
  // ================================

  /**
   * 初始化 Worker 池
   */
  private initWorkers(): void {
    for (let i = 0; i < this.config.workerCount; i++) {
      try {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), {
          type: 'module',
        });

        const state: WorkerState = {
          worker,
          idle: true,
          currentTaskId: null,
          processedCount: 0,
          errorCount: 0,
        };

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          this.handleWorkerMessage(state, event.data);
        };

        worker.onerror = (error) => {
          this.handleWorkerError(state, error);
        };

        this.workers.push(state);
      } catch (error) {
        console.warn(`[WorkerService] 创建 Worker ${i} 失败:`, error);
      }
    }

    if (this.workers.length === 0) {
      console.error('[WorkerService] 没有可用的 Worker，将回退到主线程处理');
    }
  }

  // ================================
  // 任务提交
  // ================================

  /**
   * 提交解析任务
   */
  async parse(
    content: string,
    options?: LatexParserOptions & { priority?: TaskPriority; timeoutMs?: number }
  ): Promise<TaskResult<{ ast: RootNode; parseTime: number }>> {
    const { priority = 'normal', timeoutMs = this.config.defaultTimeoutMs, ...parserOptions } = options || {};

    return this.submitTask<{ ast: RootNode; parseTime: number }>({
      type: 'parse',
      data: { content, options: parserOptions },
      priority,
      timeoutMs,
    });
  }

  /**
   * 提交增量解析任务
   */
  async parseIncremental(
    content: string,
    changes: readonly DocumentChange[],
    options?: LatexParserOptions & { priority?: TaskPriority; timeoutMs?: number }
  ): Promise<TaskResult<{ ast: RootNode; affectedNodeIds: string[]; fullReparse: boolean; parseTime: number }>> {
    const { priority = 'high', timeoutMs = this.config.defaultTimeoutMs, ...parserOptions } = options || {};

    return this.submitTask({
      type: 'parse_incremental',
      data: { content, changes, options: parserOptions },
      priority,
      timeoutMs,
    });
  }

  /**
   * 提交渲染任务
   */
  async render(
    ast: RootNode,
    options?: LatexRenderOptions & { priority?: TaskPriority; timeoutMs?: number }
  ): Promise<TaskResult<LatexRenderResult>> {
    const { priority = 'normal', timeoutMs = this.config.defaultTimeoutMs, ...renderOptions } = options || {};

    return this.submitTask<LatexRenderResult>({
      type: 'render',
      data: { ast, options: renderOptions },
      priority,
      timeoutMs,
    });
  }

  /**
   * 提交块渲染任务
   */
  async renderBlocks(
    nodes: readonly unknown[],
    options?: LatexRenderOptions & { priority?: TaskPriority; timeoutMs?: number }
  ): Promise<TaskResult<{ results: Array<{ id: string; html: string }>; renderTime: number }>> {
    const { priority = 'low', timeoutMs = this.config.defaultTimeoutMs, ...renderOptions } = options || {};

    return this.submitTask({
      type: 'render_block',
      data: { nodes, options: renderOptions },
      priority,
      timeoutMs,
    });
  }

  /**
   * 提交任务
   */
  private submitTask<T>(options: {
    type: TaskType;
    data: unknown;
    priority: TaskPriority;
    timeoutMs: number;
  }): Promise<TaskResult<T>> {
    return new Promise((resolve, reject) => {
      if (this.isDestroyed) {
        reject(new Error('Worker 服务已销毁'));
        return;
      }

      // 检查队列长度
      if (this.taskQueue.length >= this.config.maxQueueSize) {
        reject(new Error('任务队列已满'));
        return;
      }

      // 创建任务配置
      const config: TaskConfig = {
        id: `task_${++this.taskIdCounter}_${Date.now()}`,
        type: options.type,
        data: options.data,
        priority: options.priority,
        timeoutMs: options.timeoutMs,
        maxRetries: this.config.defaultMaxRetries,
        createdAt: Date.now(),
      };

      // 创建待处理任务
      const pendingTask: PendingTask = {
        config,
        resolve: resolve as (result: TaskResult) => void,
        reject,
        timeoutId: null,
        retryCount: 0,
        startTime: null,
      };

      // 添加到待处理映射
      this.pendingTasks.set(config.id, pendingTask);

      // 添加到队列
      this.addToQueue(config);

      // 统计
      this.totalTasks++;

      // 尝试处理
      this.processNextTask();
    });
  }

  /**
   * 添加任务到队列（按优先级排序）
   */
  private addToQueue(config: TaskConfig): void {
    const priorityOrder: Record<TaskPriority, number> = {
      high: 0,
      normal: 1,
      low: 2,
    };

    // 按优先级插入
    const insertIndex = this.taskQueue.findIndex(
      (task) => priorityOrder[task.priority] > priorityOrder[config.priority]
    );

    if (insertIndex === -1) {
      this.taskQueue.push(config);
    } else {
      this.taskQueue.splice(insertIndex, 0, config);
    }
  }

  // ================================
  // 任务处理
  // ================================

  /**
   * 处理下一个任务
   */
  private processNextTask(): void {
    if (this.isDestroyed || this.taskQueue.length === 0) {
      return;
    }

    // 查找空闲 Worker
    const idleWorker = this.workers.find((w) => w.idle);
    if (!idleWorker) {
      return;
    }

    // 取出队首任务
    const config = this.taskQueue.shift();
    if (!config) {
      return;
    }

    // 获取待处理任务
    const pendingTask = this.pendingTasks.get(config.id);
    if (!pendingTask) {
      // 任务可能已被取消
      this.processNextTask();
      return;
    }

    // 标记 Worker 为忙碌
    idleWorker.idle = false;
    idleWorker.currentTaskId = config.id;

    // 记录开始时间
    pendingTask.startTime = Date.now();

    // 设置超时
    pendingTask.timeoutId = setTimeout(() => {
      this.handleTaskTimeout(config.id, idleWorker);
    }, config.timeoutMs);

    // 发送请求到 Worker
    const request: WorkerRequest = {
      id: config.id,
      type: config.type,
      data: config.data,
    };

    try {
      idleWorker.worker.postMessage(request);
    } catch (error) {
      this.handleTaskError(config.id, idleWorker, error);
    }
  }

  /**
   * 处理 Worker 消息
   */
  private handleWorkerMessage(workerState: WorkerState, response: WorkerResponse): void {
    const taskId = response.id;
    const pendingTask = this.pendingTasks.get(taskId);

    // 清理 Worker 状态
    workerState.idle = true;
    workerState.currentTaskId = null;
    workerState.processedCount++;

    if (!pendingTask) {
      // 任务可能已被取消或超时
      this.processNextTask();
      return;
    }

    // 清除超时
    if (pendingTask.timeoutId) {
      clearTimeout(pendingTask.timeoutId);
      pendingTask.timeoutId = null;
    }

    // 计算执行时间
    const executionTime = pendingTask.startTime ? Date.now() - pendingTask.startTime : 0;

    // 从待处理映射移除
    this.pendingTasks.delete(taskId);

    if (response.success) {
      // 成功
      this.completedTasks++;
      this.totalExecutionTime += executionTime;

      pendingTask.resolve({
        taskId,
        success: true,
        data: response.data,
        executionTime,
        retryCount: pendingTask.retryCount,
      });
    } else {
      // 失败
      this.failedTasks++;
      workerState.errorCount++;

      pendingTask.resolve({
        taskId,
        success: false,
        error: response.error || '未知错误',
        executionTime,
        retryCount: pendingTask.retryCount,
      });
    }

    // 处理下一个任务
    this.processNextTask();
  }

  /**
   * 处理 Worker 错误
   */
  private handleWorkerError(workerState: WorkerState, error: ErrorEvent): void {
    console.error('[WorkerService] Worker 错误:', error);

    const taskId = workerState.currentTaskId;
    if (taskId) {
      this.handleTaskError(taskId, workerState, error);
    }

    workerState.errorCount++;
  }

  /**
   * 处理任务错误
   */
  private handleTaskError(taskId: string, workerState: WorkerState, error: unknown): void {
    const pendingTask = this.pendingTasks.get(taskId);
    if (!pendingTask) {
      return;
    }

    // 清理 Worker 状态
    workerState.idle = true;
    workerState.currentTaskId = null;

    // 清除超时
    if (pendingTask.timeoutId) {
      clearTimeout(pendingTask.timeoutId);
      pendingTask.timeoutId = null;
    }

    // 检查是否可以重试
    if (pendingTask.retryCount < pendingTask.config.maxRetries) {
      pendingTask.retryCount++;
      pendingTask.startTime = null;

      // 重新加入队列（高优先级）
      this.addToQueue({
        ...pendingTask.config,
        priority: 'high',
      });

      console.warn(`[WorkerService] 任务 ${taskId} 失败，重试第 ${pendingTask.retryCount} 次`);
    } else {
      // 超过重试次数，返回错误
      this.failedTasks++;
      this.pendingTasks.delete(taskId);

      const executionTime = pendingTask.startTime ? Date.now() - pendingTask.startTime : 0;
      const errorMessage = error instanceof Error ? error.message : String(error);

      pendingTask.resolve({
        taskId,
        success: false,
        error: `任务执行失败: ${errorMessage}`,
        executionTime,
        retryCount: pendingTask.retryCount,
      });
    }

    // 处理下一个任务
    this.processNextTask();
  }

  /**
   * 处理任务超时
   */
  private handleTaskTimeout(taskId: string, workerState: WorkerState): void {
    const pendingTask = this.pendingTasks.get(taskId);
    if (!pendingTask) {
      return;
    }

    console.warn(`[WorkerService] 任务 ${taskId} 超时`);

    // 发送取消信号
    try {
      workerState.worker.postMessage({ type: 'cancel', id: taskId });
    } catch {
      // 忽略发送失败
    }

    // 清理 Worker 状态
    workerState.idle = true;
    workerState.currentTaskId = null;

    // 检查是否可以重试
    if (pendingTask.retryCount < pendingTask.config.maxRetries) {
      pendingTask.retryCount++;
      pendingTask.startTime = null;
      pendingTask.timeoutId = null;

      // 重新加入队列
      this.addToQueue(pendingTask.config);

      console.warn(`[WorkerService] 任务 ${taskId} 超时，重试第 ${pendingTask.retryCount} 次`);
    } else {
      // 超过重试次数，返回错误
      this.failedTasks++;
      this.pendingTasks.delete(taskId);

      const executionTime = pendingTask.startTime ? Date.now() - pendingTask.startTime : 0;

      pendingTask.resolve({
        taskId,
        success: false,
        error: `任务超时 (${pendingTask.config.timeoutMs}ms)`,
        executionTime,
        retryCount: pendingTask.retryCount,
      });
    }

    // 处理下一个任务
    this.processNextTask();
  }

  // ================================
  // 任务取消
  // ================================

  /**
   * 取消指定任务
   */
  cancel(taskId: string): boolean {
    const pendingTask = this.pendingTasks.get(taskId);
    if (!pendingTask) {
      return false;
    }

    // 清除超时
    if (pendingTask.timeoutId) {
      clearTimeout(pendingTask.timeoutId);
    }

    // 从队列移除
    const queueIndex = this.taskQueue.findIndex((t) => t.id === taskId);
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1);
    }

    // 如果正在执行，发送取消信号
    const worker = this.workers.find((w) => w.currentTaskId === taskId);
    if (worker) {
      try {
        worker.worker.postMessage({ type: 'cancel', id: taskId });
      } catch {
        // 忽略发送失败
      }
      worker.idle = true;
      worker.currentTaskId = null;
    }

    // 从待处理映射移除
    this.pendingTasks.delete(taskId);

    // 返回取消结果
    const executionTime = pendingTask.startTime ? Date.now() - pendingTask.startTime : 0;

    pendingTask.resolve({
      taskId,
      success: false,
      error: '任务已取消',
      executionTime,
      retryCount: pendingTask.retryCount,
    });

    this.cancelledTasks++;

    return true;
  }

  /**
   * 取消所有任务
   */
  cancelAll(): number {
    const taskIds = Array.from(this.pendingTasks.keys());
    let cancelledCount = 0;

    for (const taskId of taskIds) {
      if (this.cancel(taskId)) {
        cancelledCount++;
      }
    }

    return cancelledCount;
  }

  // ================================
  // 统计信息
  // ================================

  /**
   * 获取服务统计信息
   */
  getStats(): WorkerServiceStats {
    return {
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      cancelledTasks: this.cancelledTasks,
      avgExecutionTime: this.completedTasks > 0 ? this.totalExecutionTime / this.completedTasks : 0,
      queueLength: this.taskQueue.length,
      workerStates: this.workers.map((w) => ({
        idle: w.idle,
        processedCount: w.processedCount,
        errorCount: w.errorCount,
      })),
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.totalTasks = 0;
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.cancelledTasks = 0;
    this.totalExecutionTime = 0;

    for (const worker of this.workers) {
      worker.processedCount = 0;
      worker.errorCount = 0;
    }
  }

  // ================================
  // 生命周期
  // ================================

  /**
   * 检查服务是否可用
   */
  isAvailable(): boolean {
    return !this.isDestroyed && this.workers.length > 0;
  }

  /**
   * 获取空闲 Worker 数量
   */
  getIdleWorkerCount(): number {
    return this.workers.filter((w) => w.idle).length;
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    // 取消所有待处理任务
    this.cancelAll();

    // 清空队列
    this.taskQueue.length = 0;

    // 终止所有 Worker
    for (const workerState of this.workers) {
      try {
        workerState.worker.terminate();
      } catch {
        // 忽略终止失败
      }
    }

    this.workers.length = 0;
  }
}

// ================================
// 全局实例管理
// ================================

let globalWorkerService: LatexWorkerService | null = null;

/**
 * 获取全局 Worker 服务实例
 */
export function getLatexWorkerService(config?: WorkerServiceConfig): LatexWorkerService {
  if (!globalWorkerService) {
    globalWorkerService = new LatexWorkerService(config);
  }
  return globalWorkerService;
}

/**
 * 销毁全局 Worker 服务实例
 */
export function destroyLatexWorkerService(): void {
  if (globalWorkerService) {
    globalWorkerService.destroy();
    globalWorkerService = null;
  }
}

/**
 * 创建新的 Worker 服务实例
 */
export function createLatexWorkerService(config?: WorkerServiceConfig): LatexWorkerService {
  return new LatexWorkerService(config);
}

// ================================
// 导出
// ================================

export default LatexWorkerService;
