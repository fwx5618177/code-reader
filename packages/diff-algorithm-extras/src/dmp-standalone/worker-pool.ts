// ================================
// Enhanced Worker Pool
// 使用完整 diff-match-patch 算法的 Worker 池
// ================================

import { createWorkerBlobUrl, revokeWorkerBlobUrl } from './worker-script-generator';

// ================================
// Types
// ================================

export type WorkerMessageType =
  | 'TEXT_DIFF'
  | 'APPLY_TEXT_DIFF'
  | 'SEMANTIC_CLEANUP'
  | 'EFFICIENCY_CLEANUP'
  | 'COMPUTE_HASH'
  | 'COMPUTE_SIMILARITY'
  | 'PING';

export interface WorkerRequest {
  id: string;
  type: WorkerMessageType;
  payload: unknown;
}

export interface WorkerResponse {
  id: string;
  type: WorkerMessageType;
  success: boolean;
  result?: unknown;
  error?: string;
  computeTimeMs?: number;
}

export interface TextDiffPayload {
  source: string;
  target: string;
  options?: {
    timeout?: number;
    semanticCleanup?: boolean;
    efficiencyCleanup?: boolean;
    editCost?: number;
    checklines?: boolean;
  };
}

export interface ApplyDiffPayload {
  source: string;
  diffs: Array<[number, string]>;
}

export interface HashPayload {
  data: string | ArrayBuffer;
  algorithm?: 'fnv1a' | 'xxhash' | 'adler32';
}

export interface SimilarityPayload {
  source: string;
  target: string;
  caseSensitive?: boolean;
}

export interface CleanupPayload {
  diffs: Array<[number, string]>;
  editCost?: number;
}

export interface TextDiffResult {
  diffs: Array<[number, string]>;
  stats: {
    insertions: number;
    deletions: number;
    unchanged: number;
    totalChars: number;
    changeRatio: number;
    levenshtein: number;
  };
  sourceLength: number;
  targetLength: number;
  algorithm: string;
}

export interface HashResult {
  hash: number;
  algorithm: string;
  bytesProcessed: number;
}

export interface SimilarityResult {
  distance: number;
  similarity: number;
}

// ================================
// Configuration
// ================================

export interface EnhancedWorkerPoolConfig {
  /** 最小 Worker 数量 */
  minWorkers?: number;
  /** 最大 Worker 数量 */
  maxWorkers?: number;
  /** 任务超时（毫秒） */
  taskTimeout?: number;
  /** 空闲 Worker 超时（毫秒） */
  idleTimeout?: number;
  /** 健康检查间隔（毫秒） */
  healthCheckInterval?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

const DEFAULT_CONFIG: Required<EnhancedWorkerPoolConfig> = {
  minWorkers: 1,
  maxWorkers: navigator.hardwareConcurrency || 4,
  taskTimeout: 30000,
  idleTimeout: 60000,
  healthCheckInterval: 30000,
  debug: false,
};

// ================================
// Internal Types
// ================================

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

/** 任务信息，用于追踪和调试 */
export interface TaskInfo {
  /** 任务 ID */
  id: string;
  /** 任务类型 */
  type: WorkerMessageType;
  /** 任务状态 */
  status: TaskStatus;
  /** 任务创建时间 */
  createdAt: number;
  /** 任务开始执行时间 */
  startedAt?: number;
  /** 任务完成时间 */
  completedAt?: number;
  /** 执行该任务的 Worker ID */
  workerId?: number;
  /** 错误信息（如果失败） */
  error?: string;
  /** 任务耗时（毫秒） */
  durationMs?: number;
}

type WorkerStatus = 'idle' | 'busy' | 'error';

interface WorkerInfo {
  id: number;
  worker: Worker;
  status: WorkerStatus;
  currentTaskId: string | null;
  tasksCompleted: number;
  lastActiveAt: number;
  createdAt: number;
}

interface PendingTask {
  request: WorkerRequest;
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  createdAt: number;
}

export interface PoolStats {
  workerCount: number;
  idleWorkers: number;
  busyWorkers: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  timeoutTasks: number;
  avgTaskTimeMs: number;
}

/** 任务历史记录配置 */
interface TaskHistoryConfig {
  /** 最大保留任务数 */
  maxSize: number;
  /** 是否启用历史记录 */
  enabled: boolean;
}

const DEFAULT_TASK_HISTORY_CONFIG: TaskHistoryConfig = {
  maxSize: 100,
  enabled: true,
};

// ================================
// Enhanced Worker Pool Implementation
// ================================

/**
 * Enhanced Worker Pool
 *
 * 使用完整 diff-match-patch 算法的 Worker 池
 * 支持动态扩缩容、任务队列、超时处理
 */
export class EnhancedWorkerPool {
  private readonly config: Required<EnhancedWorkerPoolConfig>;
  private workers: Map<number, WorkerInfo> = new Map();
  private pendingTasks: Map<string, PendingTask> = new Map();
  private taskQueue: WorkerRequest[] = [];
  private nextWorkerId = 1;
  private nextTaskId = 1;
  private isInitialized = false;
  private isTerminated = false;

  // Statistics
  private completedTasks = 0;
  private failedTasks = 0;
  private timeoutTasks = 0;
  private totalTaskTimeMs = 0;

  // 任务追踪
  private taskHistory: TaskInfo[] = [];
  private activeTaskMap: Map<string, TaskInfo> = new Map();
  private taskHistoryConfig: TaskHistoryConfig = DEFAULT_TASK_HISTORY_CONFIG;

  // Timers
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Worker script
  private workerBlobUrl: string | null = null;

  constructor(config: EnhancedWorkerPoolConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // Lifecycle
  // ================================

  /**
   * 初始化 Worker 池
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isTerminated) {
      throw new Error('Worker pool has been terminated');
    }

    this.log('Initializing worker pool...');

    // 创建 Worker Blob URL
    this.workerBlobUrl = createWorkerBlobUrl();

    // 创建最小数量的 Worker
    for (let i = 0; i < this.config.minWorkers; i++) {
      this.createWorker();
    }

    // 启动健康检查
    this.startHealthCheck();

    // 启动空闲检查
    this.startIdleCheck();

    this.isInitialized = true;
    this.log('Worker pool initialized with', this.workers.size, 'workers');
  }

  /**
   * 终止 Worker 池
   */
  terminate(): void {
    if (this.isTerminated) return;

    this.log('Terminating worker pool...');
    this.isTerminated = true;

    // 停止定时器
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }

    // 拒绝所有待处理的任务
    for (const [taskId, task] of this.pendingTasks) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      task.reject(new Error('Worker pool terminated'));
      this.pendingTasks.delete(taskId);
    }

    // 终止所有 Worker
    for (const [id, info] of this.workers) {
      info.worker.terminate();
      this.workers.delete(id);
    }

    // 清理 Blob URL
    if (this.workerBlobUrl) {
      revokeWorkerBlobUrl(this.workerBlobUrl);
      this.workerBlobUrl = null;
    }

    // 清空任务队列
    this.taskQueue = [];

    this.log('Worker pool terminated');
  }

  /**
   * 检查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized && !this.isTerminated;
  }

  // ================================
  // Public API
  // ================================

  /**
   * 计算文本差分
   */
  async textDiff(
    source: string,
    target: string,
    options?: TextDiffPayload['options']
  ): Promise<TextDiffResult> {
    const response = await this.submitTask({
      id: this.generateTaskId(),
      type: 'TEXT_DIFF',
      payload: { source, target, options },
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Text diff failed');
    }

    return response.result as TextDiffResult;
  }

  /**
   * 应用文本差分
   */
  async applyTextDiff(source: string, diffs: Array<[number, string]>): Promise<string> {
    const response = await this.submitTask({
      id: this.generateTaskId(),
      type: 'APPLY_TEXT_DIFF',
      payload: { source, diffs },
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Apply diff failed');
    }

    return (response.result as { text: string }).text;
  }

  /**
   * 语义清理
   */
  async semanticCleanup(diffs: Array<[number, string]>): Promise<Array<[number, string]>> {
    const response = await this.submitTask({
      id: this.generateTaskId(),
      type: 'SEMANTIC_CLEANUP',
      payload: { diffs },
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Semantic cleanup failed');
    }

    return (response.result as { diffs: Array<[number, string]> }).diffs;
  }

  /**
   * 效率清理
   */
  async efficiencyCleanup(
    diffs: Array<[number, string]>,
    editCost?: number
  ): Promise<Array<[number, string]>> {
    const response = await this.submitTask({
      id: this.generateTaskId(),
      type: 'EFFICIENCY_CLEANUP',
      payload: { diffs, editCost },
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Efficiency cleanup failed');
    }

    return (response.result as { diffs: Array<[number, string]> }).diffs;
  }

  /**
   * 计算哈希
   */
  async computeHash(
    data: string | ArrayBuffer,
    algorithm: 'fnv1a' | 'xxhash' | 'adler32' = 'fnv1a'
  ): Promise<HashResult> {
    const response = await this.submitTask({
      id: this.generateTaskId(),
      type: 'COMPUTE_HASH',
      payload: { data, algorithm },
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Hash computation failed');
    }

    return response.result as HashResult;
  }

  /**
   * 计算相似度
   */
  async computeSimilarity(
    source: string,
    target: string,
    caseSensitive: boolean = true
  ): Promise<SimilarityResult> {
    const response = await this.submitTask({
      id: this.generateTaskId(),
      type: 'COMPUTE_SIMILARITY',
      payload: { source, target, caseSensitive },
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Similarity computation failed');
    }

    return response.result as SimilarityResult;
  }

  /**
   * 批量执行任务
   */
  async batch<T>(requests: Array<{ type: WorkerMessageType; payload: unknown }>): Promise<T[]> {
    const promises = requests.map((req) =>
      this.submitTask({
        id: this.generateTaskId(),
        type: req.type,
        payload: req.payload,
      })
    );

    const responses = await Promise.all(promises);
    return responses.map((r) => {
      if (!r.success) {
        throw new Error(r.error ?? 'Batch task failed');
      }
      return r.result as T;
    });
  }

  /**
   * 获取池统计信息
   */
  getStats(): PoolStats {
    let idleWorkers = 0;
    let busyWorkers = 0;

    for (const info of this.workers.values()) {
      if (info.status === 'idle') idleWorkers++;
      else if (info.status === 'busy') busyWorkers++;
    }

    const totalTasks = this.completedTasks + this.failedTasks + this.timeoutTasks;
    const avgTaskTimeMs = totalTasks > 0 ? this.totalTaskTimeMs / totalTasks : 0;

    return {
      workerCount: this.workers.size,
      idleWorkers,
      busyWorkers,
      pendingTasks: this.pendingTasks.size + this.taskQueue.length,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      timeoutTasks: this.timeoutTasks,
      avgTaskTimeMs,
    };
  }

  // ================================
  // Private Methods
  // ================================

  private async submitTask(request: WorkerRequest): Promise<WorkerResponse> {
    if (!this.isReady()) {
      await this.initialize();
    }

    return new Promise<WorkerResponse>((resolve, reject) => {
      const task: PendingTask = {
        request,
        resolve,
        reject,
        timeoutId: null,
        createdAt: Date.now(),
      };

      // 设置超时
      task.timeoutId = setTimeout(() => {
        this.handleTaskTimeout(request.id);
      }, this.config.taskTimeout);

      this.pendingTasks.set(request.id, task);

      // 尝试分配给空闲 Worker
      const idleWorker = this.findIdleWorker();
      if (idleWorker) {
        this.assignTaskToWorker(request, idleWorker);
      } else {
        // 加入队列
        this.taskQueue.push(request);
        // 尝试扩容
        this.maybeScaleUp();
      }
    });
  }

  private findIdleWorker(): WorkerInfo | null {
    for (const info of this.workers.values()) {
      if (info.status === 'idle') {
        return info;
      }
    }
    return null;
  }

  private assignTaskToWorker(request: WorkerRequest, workerInfo: WorkerInfo): void {
    workerInfo.status = 'busy';
    workerInfo.currentTaskId = request.id;
    workerInfo.lastActiveAt = Date.now();

    // 记录任务开始
    this.trackTaskStart(request.id, request.type, workerInfo.id);

    // 处理 Transferable 对象
    const transferables: Transferable[] = [];
    const payload = request.payload as Record<string, unknown>;
    if (payload && payload.data instanceof ArrayBuffer) {
      transferables.push(payload.data);
    }

    if (transferables.length > 0) {
      workerInfo.worker.postMessage(request, transferables);
    } else {
      workerInfo.worker.postMessage(request);
    }
  }

  private handleWorkerResponse(workerId: number, response: WorkerResponse): void {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    const task = this.pendingTasks.get(response.id);
    if (!task) return;

    // 清除超时
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }

    // 更新统计
    // 记录任务完成
    this.trackTaskComplete(response.id);

    const taskTime = Date.now() - task.createdAt;
    this.totalTaskTimeMs += taskTime;

    if (response.success) {
      this.completedTasks++;
    } else {
      this.failedTasks++;
    }

    // 更新 Worker 状态
    workerInfo.status = 'idle';
    workerInfo.currentTaskId = null;
    workerInfo.tasksCompleted++;
    workerInfo.lastActiveAt = Date.now();

    // 解析任务
    this.pendingTasks.delete(response.id);
    task.resolve(response);

    // 处理队列中的下一个任务
    this.processNextTask(workerInfo);
  }

  private handleTaskTimeout(taskId: string): void {
    // 记录任务超时
    this.trackTaskTimeout(taskId);

    const task = this.pendingTasks.get(taskId);
    if (!task) return;

    this.timeoutTasks++;
    this.pendingTasks.delete(taskId);

    task.reject(new Error(`Task timeout after ${this.config.taskTimeout}ms`));

    // 找到执行该任务的 Worker 并重置
    for (const info of this.workers.values()) {
      if (info.currentTaskId === taskId) {
        // 终止并重建 Worker
        info.worker.terminate();
        this.workers.delete(info.id);
        this.createWorker();
        break;
      }
    }
  }

  private processNextTask(workerInfo: WorkerInfo): void {
    if (this.taskQueue.length === 0) return;
    if (workerInfo.status !== 'idle') return;

    const request = this.taskQueue.shift();
    if (request) {
      this.assignTaskToWorker(request, workerInfo);
    }
  }

  private createWorker(): WorkerInfo {
    if (!this.workerBlobUrl) {
      throw new Error('Worker Blob URL not created');
    }

    const worker = new Worker(this.workerBlobUrl, { type: 'classic' });
    const workerId = this.nextWorkerId++;

    const workerInfo: WorkerInfo = {
      id: workerId,
      worker,
      status: 'idle',
      currentTaskId: null,
      tasksCompleted: 0,
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleWorkerResponse(workerId, event.data);
    };

    worker.onerror = (error: ErrorEvent) => {
      this.handleWorkerError(workerId, error);
    };

    this.workers.set(workerId, workerInfo);
    this.log('Created worker', workerId);

    return workerInfo;
  }

  private handleWorkerError(workerId: number, error: ErrorEvent): void {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    this.log('Worker error:', workerId, error.message);

    // 如果有正在执行的任务，拒绝它
    if (workerInfo.currentTaskId) {
      const taskId = workerInfo.currentTaskId;
      const task = this.pendingTasks.get(taskId);
      if (task) {
        if (task.timeoutId) {
          clearTimeout(task.timeoutId);
        }
        // 记录任务失败
        this.trackTaskFailed(taskId, `Worker error: ${error.message}`);
        this.failedTasks++;
        this.pendingTasks.delete(taskId);
        task.reject(new Error(`Worker error: ${error.message}`));
      }
    }

    // 重建 Worker
    workerInfo.worker.terminate();
    this.workers.delete(workerId);

    if (this.workers.size < this.config.minWorkers) {
      this.createWorker();
    }
  }

  private maybeScaleUp(): void {
    if (this.workers.size >= this.config.maxWorkers) return;
    if (this.taskQueue.length === 0) return;

    // 检查是否所有 Worker 都在忙
    const allBusy = Array.from(this.workers.values()).every((info) => info.status === 'busy');

    if (allBusy) {
      const newWorker = this.createWorker();
      this.processNextTask(newWorker);
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      if (!this.isReady()) return;

      for (const info of this.workers.values()) {
        if (info.status !== 'idle') continue;

        try {
          const response = await Promise.race([
            new Promise<WorkerResponse>((resolve) => {
              const taskId = this.generateTaskId();
              const handler = (event: MessageEvent<WorkerResponse>) => {
                if (event.data.id === taskId) {
                  info.worker.removeEventListener('message', handler);
                  resolve(event.data);
                }
              };
              info.worker.addEventListener('message', handler);
              info.worker.postMessage({ id: taskId, type: 'PING', payload: {} });
            }),
            new Promise<WorkerResponse>((_, reject) =>
              setTimeout(() => reject(new Error('Health check timeout')), 5000)
            ),
          ]);

          if (!response.success) {
            throw new Error('Health check failed');
          }
        } catch {
          this.log('Worker', info.id, 'failed health check, replacing...');
          info.worker.terminate();
          this.workers.delete(info.id);
          this.createWorker();
        }
      }
    }, this.config.healthCheckInterval);
  }

  private startIdleCheck(): void {
    this.idleCheckTimer = setInterval(() => {
      if (!this.isReady()) return;

      const now = Date.now();
      const workersToRemove: number[] = [];

      for (const [id, info] of this.workers) {
        if (
          info.status === 'idle' &&
          this.workers.size > this.config.minWorkers &&
          now - info.lastActiveAt > this.config.idleTimeout
        ) {
          workersToRemove.push(id);
        }
      }

      for (const id of workersToRemove) {
        const info = this.workers.get(id);
        if (info) {
          info.worker.terminate();
          this.workers.delete(id);
          this.log('Removed idle worker', id);
        }
      }
    }, 10000);
  }

  private generateTaskId(): string {
    return `task-${this.nextTaskId++}-${Date.now()}`;
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[EnhancedWorkerPool]', ...args);
    }
  }

  // ================================
  // 任务追踪方法
  // ================================

  /**
   * 记录任务开始
   */
  private trackTaskStart(taskId: string, type: WorkerMessageType, workerId: number): void {
    if (!this.taskHistoryConfig.enabled) return;

    const taskInfo: TaskInfo = {
      id: taskId,
      type,
      status: 'running',
      createdAt: Date.now(),
      startedAt: Date.now(),
      workerId,
    };

    this.activeTaskMap.set(taskId, taskInfo);
    this.log('任务开始:', taskId, type);
  }

  /**
   * 记录任务完成
   */
  private trackTaskComplete(taskId: string): void {
    if (!this.taskHistoryConfig.enabled) return;

    const taskInfo = this.activeTaskMap.get(taskId);
    if (taskInfo) {
      const completedAt = Date.now();
      taskInfo.status = 'completed';
      taskInfo.completedAt = completedAt;
      taskInfo.durationMs = taskInfo.startedAt ? completedAt - taskInfo.startedAt : 0;

      this.addToHistory(taskInfo);
      this.activeTaskMap.delete(taskId);
      this.log('任务完成:', taskId, `耗时 ${taskInfo.durationMs}ms`);
    }
  }

  /**
   * 记录任务失败
   */
  private trackTaskFailed(taskId: string, error: string): void {
    if (!this.taskHistoryConfig.enabled) return;

    const taskInfo = this.activeTaskMap.get(taskId);
    if (taskInfo) {
      const completedAt = Date.now();
      taskInfo.status = 'failed';
      taskInfo.completedAt = completedAt;
      taskInfo.error = error;
      taskInfo.durationMs = taskInfo.startedAt ? completedAt - taskInfo.startedAt : 0;

      this.addToHistory(taskInfo);
      this.activeTaskMap.delete(taskId);
      this.log('任务失败:', taskId, error);
    }
  }

  /**
   * 记录任务超时
   */
  private trackTaskTimeout(taskId: string): void {
    if (!this.taskHistoryConfig.enabled) return;

    const taskInfo = this.activeTaskMap.get(taskId);
    if (taskInfo) {
      const completedAt = Date.now();
      taskInfo.status = 'timeout';
      taskInfo.completedAt = completedAt;
      taskInfo.error = `任务超时 (>${this.config.taskTimeout}ms)`;
      taskInfo.durationMs = taskInfo.startedAt ? completedAt - taskInfo.startedAt : 0;

      this.addToHistory(taskInfo);
      this.activeTaskMap.delete(taskId);
      this.log('任务超时:', taskId);
    }
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(taskInfo: TaskInfo): void {
    this.taskHistory.push(taskInfo);

    // 限制历史记录大小
    if (this.taskHistory.length > this.taskHistoryConfig.maxSize) {
      this.taskHistory.shift();
    }
  }

  /**
   * 获取任务历史记录
   * @param options 查询选项
   */
  getTaskHistory(options?: {
    status?: TaskStatus;
    type?: WorkerMessageType;
    limit?: number;
  }): readonly TaskInfo[] {
    let result = [...this.taskHistory];

    if (options?.status) {
      result = result.filter((t) => t.status === options.status);
    }

    if (options?.type) {
      result = result.filter((t) => t.type === options.type);
    }

    if (options?.limit) {
      result = result.slice(-options.limit);
    }

    return result;
  }

  /**
   * 获取活跃任务列表
   */
  getActiveTasks(): readonly TaskInfo[] {
    return Array.from(this.activeTaskMap.values());
  }

  /**
   * 获取指定任务信息
   */
  getTaskInfo(taskId: string): TaskInfo | undefined {
    // 先查活跃任务
    const active = this.activeTaskMap.get(taskId);
    if (active) return active;

    // 再查历史记录
    return this.taskHistory.find((t) => t.id === taskId);
  }

  /**
   * 清空任务历史
   */
  clearTaskHistory(): void {
    this.taskHistory = [];
    this.log('任务历史已清空');
  }

  /**
   * 配置任务历史记录
   */
  configureTaskHistory(config: Partial<TaskHistoryConfig>): void {
    this.taskHistoryConfig = { ...this.taskHistoryConfig, ...config };
  }
}

// ================================
// Factory Functions
// ================================

/**
 * 创建增强型 Worker 池
 */
export function createEnhancedWorkerPool(config?: EnhancedWorkerPoolConfig): EnhancedWorkerPool {
  return new EnhancedWorkerPool(config);
}

/**
 * 创建高性能 Worker 池
 */
export function createHighPerformanceEnhancedPool(): EnhancedWorkerPool {
  return new EnhancedWorkerPool({
    minWorkers: 2,
    maxWorkers: navigator.hardwareConcurrency || 8,
    taskTimeout: 60000,
    idleTimeout: 120000,
    debug: false,
  });
}

/**
 * 创建轻量级 Worker 池
 */
export function createLightweightEnhancedPool(): EnhancedWorkerPool {
  return new EnhancedWorkerPool({
    minWorkers: 1,
    maxWorkers: 2,
    taskTimeout: 15000,
    idleTimeout: 30000,
    debug: false,
  });
}

// ================================
// Singleton Instance
// ================================

let defaultPool: EnhancedWorkerPool | null = null;

/**
 * 获取默认 Worker 池
 */
export async function getDefaultEnhancedWorkerPool(): Promise<EnhancedWorkerPool> {
  if (!defaultPool) {
    defaultPool = createEnhancedWorkerPool();
    await defaultPool.initialize();
  }
  return defaultPool;
}

/**
 * 关闭默认 Worker 池
 */
export function closeDefaultEnhancedWorkerPool(): void {
  if (defaultPool) {
    defaultPool.terminate();
    defaultPool = null;
  }
}
