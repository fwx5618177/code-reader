// ================================
// Worker Pool - 多 Worker 管理器
//
// 管理多个 Diff Worker 实例，提供：
// - 任务队列和负载均衡
// - 自动扩缩容
// - 超时处理
// - 健康检查
// ================================

import type {
  WorkerRequest,
  WorkerResponse,
  WorkerMessageType,
  TextDiffRequest,
  BinaryDiffRequest,
  ApplyDiffRequest,
  ComputeHashRequest,
  SimilarityRequest,
  ChunkRequest,
} from './diff-worker';

// ================================
// 类型定义
// ================================

/**
 * Worker 池配置
 */
export interface WorkerPoolConfig {
  /** 最小 Worker 数量 */
  minWorkers: number;
  /** 最大 Worker 数量 */
  maxWorkers: number;
  /** 任务超时时间（毫秒） */
  taskTimeout: number;
  /** 空闲 Worker 存活时间（毫秒） */
  idleTimeout: number;
  /** Worker 脚本 URL */
  workerUrl?: string;
  /** 是否使用 Module Worker */
  useModuleWorker?: boolean;
  /** 健康检查间隔（毫秒） */
  healthCheckInterval?: number;
}

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

/**
 * 任务信息
 */
export interface TaskInfo {
  id: string;
  type: WorkerMessageType;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  workerId?: number;
  error?: string;
}

/**
 * Worker 状态
 */
export type WorkerStatus = 'idle' | 'busy' | 'terminated' | 'error';

/**
 * Worker 信息
 */
interface WorkerInfo {
  id: number;
  worker: Worker;
  status: WorkerStatus;
  currentTaskId: string | null;
  tasksCompleted: number;
  lastActiveAt: number;
  createdAt: number;
}

/**
 * 待处理任务
 */
interface PendingTask<T> {
  request: WorkerRequest;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  createdAt: number;
}

/**
 * 池统计信息
 */
export interface PoolStats {
  /** 当前 Worker 数量 */
  workerCount: number;
  /** 空闲 Worker 数量 */
  idleWorkers: number;
  /** 繁忙 Worker 数量 */
  busyWorkers: number;
  /** 待处理任务数量 */
  pendingTasks: number;
  /** 已完成任务数量 */
  completedTasks: number;
  /** 失败任务数量 */
  failedTasks: number;
  /** 超时任务数量 */
  timeoutTasks: number;
  /** 平均任务时间（毫秒） */
  avgTaskTimeMs: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<WorkerPoolConfig> = {
  minWorkers: 1,
  maxWorkers: navigator?.hardwareConcurrency || 4,
  taskTimeout: 30000, // 30 秒
  idleTimeout: 60000, // 60 秒
  workerUrl: '',
  useModuleWorker: false,
  healthCheckInterval: 30000, // 30 秒
};

// ================================
// WorkerPool 类
// ================================

/**
 * Worker 池
 *
 * 管理多个 Web Worker，提供任务分发和负载均衡。
 *
 * @example
 * ```typescript
 * const pool = new WorkerPool({ minWorkers: 2, maxWorkers: 4 });
 * await pool.initialize();
 *
 * // 提交任务
 * const result = await pool.textDiff(source, target);
 *
 * // 批量任务
 * const results = await pool.batch([
 *   { type: 'TEXT_DIFF', payload: { source: 'a', target: 'b' } },
 *   { type: 'TEXT_DIFF', payload: { source: 'c', target: 'd' } },
 * ]);
 *
 * // 关闭池
 * pool.terminate();
 * ```
 */
export class WorkerPool {
  private readonly config: Required<WorkerPoolConfig>;
  private workers: Map<number, WorkerInfo> = new Map();
  private pendingTasks: Map<string, PendingTask<unknown>> = new Map();
  private taskQueue: WorkerRequest[] = [];
  private nextWorkerId: number = 0;
  private nextTaskId: number = 0;
  private isInitialized: boolean = false;
  private isTerminated: boolean = false;

  // 统计
  private completedTasks: number = 0;
  private failedTasks: number = 0;
  private timeoutTasks: number = 0;
  private totalTaskTimeMs: number = 0;

  // 健康检查定时器
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Worker Blob URL
  private workerBlobUrl: string | null = null;

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 初始化和生命周期
  // ================================

  /**
   * 初始化 Worker 池
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isTerminated) {
      throw new Error('Worker pool has been terminated');
    }

    // 创建 Worker 脚本
    await this.createWorkerScript();

    // 创建最小数量的 Worker
    for (let i = 0; i < this.config.minWorkers; i++) {
      this.createWorker();
    }

    // 启动健康检查
    if (this.config.healthCheckInterval > 0) {
      this.healthCheckTimer = setInterval(
        () => this.performHealthCheck(),
        this.config.healthCheckInterval
      );
    }

    // 启动空闲检查
    this.idleCheckTimer = setInterval(
      () => this.checkIdleWorkers(),
      Math.min(this.config.idleTimeout / 2, 30000)
    );

    this.isInitialized = true;
  }

  /**
   * 终止 Worker 池
   */
  terminate(): void {
    if (this.isTerminated) return;

    this.isTerminated = true;

    // 清理定时器
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }

    // 拒绝所有待处理任务
    for (const [taskId, task] of this.pendingTasks) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      task.reject(new Error('Worker pool terminated'));
      this.pendingTasks.delete(taskId);
    }

    // 终止所有 Worker
    for (const [, workerInfo] of this.workers) {
      workerInfo.worker.terminate();
      workerInfo.status = 'terminated';
    }
    this.workers.clear();

    // 清理队列
    this.taskQueue = [];

    // 清理 Blob URL
    if (this.workerBlobUrl) {
      URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;
    }
  }

  /**
   * 检查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized && !this.isTerminated;
  }

  // ================================
  // 任务提交 API
  // ================================

  /**
   * 提交文本差分任务
   */
  async textDiff(
    source: string,
    target: string,
    options?: TextDiffRequest['options']
  ): Promise<{
    diffs: Array<[number, string]>;
    stats: {
      insertions: number;
      deletions: number;
      unchanged: number;
      totalChars: number;
      changeRatio: number;
    };
    sourceLength: number;
    targetLength: number;
    computeTimeMs: number;
  }> {
    const response = await this.submitTask<WorkerResponse>({
      id: this.generateTaskId(),
      type: 'TEXT_DIFF',
      payload: { source, target, options } as TextDiffRequest,
    });

    return {
      ...(response.result as {
        diffs: Array<[number, string]>;
        stats: {
          insertions: number;
          deletions: number;
          unchanged: number;
          totalChars: number;
          changeRatio: number;
        };
        sourceLength: number;
        targetLength: number;
      }),
      computeTimeMs: response.computeTimeMs || 0,
    };
  }

  /**
   * 提交二进制差分任务
   */
  async binaryDiff(
    source: ArrayBuffer,
    target: ArrayBuffer
  ): Promise<{
    delta: number[];
    sourceLength: number;
    targetLength: number;
    deltaSize: number;
    compressionRatio: number;
    computeTimeMs: number;
  }> {
    const response = await this.submitTask<WorkerResponse>({
      id: this.generateTaskId(),
      type: 'BINARY_DIFF',
      payload: { source, target } as BinaryDiffRequest,
    });

    return {
      ...(response.result as {
        delta: number[];
        sourceLength: number;
        targetLength: number;
        deltaSize: number;
        compressionRatio: number;
      }),
      computeTimeMs: response.computeTimeMs || 0,
    };
  }

  /**
   * 应用文本差分
   */
  async applyTextDiff(source: string, diffs: Array<[number, string]>): Promise<string> {
    const response = await this.submitTask<WorkerResponse>({
      id: this.generateTaskId(),
      type: 'APPLY_TEXT_DIFF',
      payload: { source, diffs } as ApplyDiffRequest,
    });

    return response.result as string;
  }

  /**
   * 应用二进制差分
   */
  async applyBinaryDiff(source: ArrayBuffer, delta: number[]): Promise<ArrayBuffer> {
    const response = await this.submitTask<WorkerResponse>({
      id: this.generateTaskId(),
      type: 'APPLY_BINARY_DIFF',
      payload: { source, diffs: delta } as ApplyDiffRequest,
    });

    return response.result as ArrayBuffer;
  }

  /**
   * 计算哈希
   */
  async computeHash(
    data: string | ArrayBuffer,
    algorithm: 'fnv1a' | 'xxhash' | 'adler32' = 'fnv1a'
  ): Promise<{
    hash: string;
    algorithm: string;
    bytesProcessed: number;
    computeTimeMs: number;
  }> {
    const response = await this.submitTask<WorkerResponse>({
      id: this.generateTaskId(),
      type: 'COMPUTE_HASH',
      payload: { data, algorithm } as ComputeHashRequest,
    });

    return {
      ...(response.result as {
        hash: string;
        algorithm: string;
        bytesProcessed: number;
      }),
      computeTimeMs: response.computeTimeMs || 0,
    };
  }

  /**
   * 计算相似度
   */
  async computeSimilarity(
    source: string,
    target: string,
    caseSensitive: boolean = false
  ): Promise<{
    distance: number;
    similarity: number;
    computeTimeMs: number;
  }> {
    const response = await this.submitTask<WorkerResponse>({
      id: this.generateTaskId(),
      type: 'COMPUTE_SIMILARITY',
      payload: { source, target, caseSensitive } as SimilarityRequest,
    });

    return {
      ...(response.result as {
        distance: number;
        similarity: number;
      }),
      computeTimeMs: response.computeTimeMs || 0,
    };
  }

  /**
   * 分块文件
   */
  async chunkFile(
    data: ArrayBuffer,
    chunkSize?: number,
    useContentDefinedChunking?: boolean
  ): Promise<
    Array<{
      offset: number;
      size: number;
      hash: number;
    }>
  > {
    const response = await this.submitTask<WorkerResponse>({
      id: this.generateTaskId(),
      type: 'CHUNK_FILE',
      payload: { data, chunkSize, useContentDefinedChunking } as ChunkRequest,
    });

    return response.result as Array<{
      offset: number;
      size: number;
      hash: number;
    }>;
  }

  /**
   * 批量提交任务
   */
  async batch<T>(
    requests: Array<{
      type: WorkerMessageType;
      payload: unknown;
    }>
  ): Promise<T[]> {
    const promises = requests.map((req) =>
      this.submitTask<WorkerResponse>({
        id: this.generateTaskId(),
        type: req.type,
        payload: req.payload,
      })
    );

    const responses = await Promise.all(promises);
    return responses.map((r) => r.result as T);
  }

  // ================================
  // 核心任务调度
  // ================================

  /**
   * 提交任务到池
   */
  private async submitTask<T extends WorkerResponse>(request: WorkerRequest): Promise<T> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isTerminated) {
      throw new Error('Worker pool has been terminated');
    }

    return new Promise<T>((resolve, reject) => {
      const task: PendingTask<T> = {
        request,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId: null,
        createdAt: Date.now(),
      };

      // 设置超时
      if (this.config.taskTimeout > 0) {
        task.timeoutId = setTimeout(() => {
          this.handleTaskTimeout(request.id);
        }, this.config.taskTimeout);
      }

      this.pendingTasks.set(request.id, task as PendingTask<unknown>);

      // 尝试立即分配给空闲 Worker
      const idleWorker = this.findIdleWorker();
      if (idleWorker) {
        this.assignTaskToWorker(request, idleWorker);
      } else {
        // 没有空闲 Worker，加入队列
        this.taskQueue.push(request);

        // 尝试创建新 Worker
        this.maybeScaleUp();
      }
    });
  }

  /**
   * 查找空闲 Worker
   */
  private findIdleWorker(): WorkerInfo | null {
    for (const [, workerInfo] of this.workers) {
      if (workerInfo.status === 'idle') {
        return workerInfo;
      }
    }
    return null;
  }

  /**
   * 分配任务给 Worker
   */
  private assignTaskToWorker(request: WorkerRequest, workerInfo: WorkerInfo): void {
    workerInfo.status = 'busy';
    workerInfo.currentTaskId = request.id;
    workerInfo.lastActiveAt = Date.now();

    // 准备 Transferable 对象
    const transferables: Transferable[] = [];
    const payload = request.payload as Record<string, unknown>;

    if (payload.source instanceof ArrayBuffer) {
      transferables.push(payload.source);
    }
    if (payload.target instanceof ArrayBuffer) {
      transferables.push(payload.target as ArrayBuffer);
    }
    if (payload.data instanceof ArrayBuffer) {
      transferables.push(payload.data);
    }

    workerInfo.worker.postMessage(request, transferables);
  }

  /**
   * 处理 Worker 响应
   */
  private handleWorkerResponse(workerId: number, response: WorkerResponse): void {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    const task = this.pendingTasks.get(response.id);
    if (!task) return;

    // 清理超时定时器
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = null;
    }

    // 更新统计
    const taskTime = Date.now() - task.createdAt;
    this.totalTaskTimeMs += taskTime;

    if (response.success) {
      this.completedTasks++;
      task.resolve(response);
    } else {
      this.failedTasks++;
      task.reject(new Error(response.error || 'Task failed'));
    }

    this.pendingTasks.delete(response.id);

    // 更新 Worker 状态
    workerInfo.status = 'idle';
    workerInfo.currentTaskId = null;
    workerInfo.tasksCompleted++;
    workerInfo.lastActiveAt = Date.now();

    // 处理队列中的下一个任务
    this.processNextTask(workerInfo);
  }

  /**
   * 处理任务超时
   */
  private handleTaskTimeout(taskId: string): void {
    const task = this.pendingTasks.get(taskId);
    if (!task) return;

    this.timeoutTasks++;
    task.reject(new Error('Task timeout'));
    this.pendingTasks.delete(taskId);

    // 查找执行该任务的 Worker
    for (const [workerId, workerInfo] of this.workers) {
      if (workerInfo.currentTaskId === taskId) {
        // 终止并替换这个 Worker
        workerInfo.worker.terminate();
        this.workers.delete(workerId);

        // 创建新 Worker
        this.createWorker();
        break;
      }
    }
  }

  /**
   * 处理队列中的下一个任务
   */
  private processNextTask(workerInfo: WorkerInfo): void {
    if (this.taskQueue.length === 0) return;
    if (workerInfo.status !== 'idle') return;

    const request = this.taskQueue.shift();
    if (request) {
      this.assignTaskToWorker(request, workerInfo);
    }
  }

  // ================================
  // Worker 管理
  // ================================

  /**
   * 创建 Worker 脚本
   */
  private async createWorkerScript(): Promise<void> {
    if (this.config.workerUrl) {
      // 使用外部 Worker 脚本
      return;
    }

    // 创建内联 Worker 脚本
    // 这里我们创建一个简化的内联脚本
    const workerCode = `
// 简化的 Worker 脚本
const DIFF_DELETE = -1;
const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;

function fnv1aHash(data) {
  let hash = 2166136261;
  if (typeof data === 'string') {
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i];
      hash = (hash * 16777619) >>> 0;
    }
  }
  return hash;
}

function computeTextDiff(source, target) {
  if (source === target) {
    return source.length > 0 ? [[DIFF_EQUAL, source]] : [];
  }
  if (source.length === 0) return [[DIFF_INSERT, target]];
  if (target.length === 0) return [[DIFF_DELETE, source]];

  let commonPrefixLength = 0;
  const minLength = Math.min(source.length, target.length);
  while (commonPrefixLength < minLength && source[commonPrefixLength] === target[commonPrefixLength]) {
    commonPrefixLength++;
  }

  let commonSuffixLength = 0;
  while (
    commonSuffixLength < minLength - commonPrefixLength &&
    source[source.length - 1 - commonSuffixLength] === target[target.length - 1 - commonSuffixLength]
  ) {
    commonSuffixLength++;
  }

  const diffs = [];
  if (commonPrefixLength > 0) {
    diffs.push([DIFF_EQUAL, source.substring(0, commonPrefixLength)]);
  }

  const sourceMiddle = source.substring(commonPrefixLength, source.length - commonSuffixLength);
  const targetMiddle = target.substring(commonPrefixLength, target.length - commonSuffixLength);

  if (sourceMiddle.length > 0 && targetMiddle.length > 0) {
    diffs.push([DIFF_DELETE, sourceMiddle]);
    diffs.push([DIFF_INSERT, targetMiddle]);
  } else if (sourceMiddle.length > 0) {
    diffs.push([DIFF_DELETE, sourceMiddle]);
  } else if (targetMiddle.length > 0) {
    diffs.push([DIFF_INSERT, targetMiddle]);
  }

  if (commonSuffixLength > 0) {
    diffs.push([DIFF_EQUAL, source.substring(source.length - commonSuffixLength)]);
  }

  return diffs;
}

function computeDiffStats(diffs) {
  let insertions = 0, deletions = 0, unchanged = 0;
  for (const [op, text] of diffs) {
    if (op === DIFF_INSERT) insertions += text.length;
    else if (op === DIFF_DELETE) deletions += text.length;
    else unchanged += text.length;
  }
  const totalChars = insertions + deletions + unchanged;
  return { insertions, deletions, unchanged, totalChars, changeRatio: totalChars > 0 ? (insertions + deletions) / totalChars : 0 };
}

function levenshteinDistance(source, target, caseSensitive) {
  const s = caseSensitive ? source : source.toLowerCase();
  const t = caseSensitive ? target : target.toLowerCase();
  const m = s.length, n = t.length;
  if (m === 0) return { distance: n, similarity: n === 0 ? 1 : 0 };
  if (n === 0) return { distance: m, similarity: 0 };
  let prev = new Array(n + 1), curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  const distance = prev[n];
  const maxLen = Math.max(m, n);
  return { distance, similarity: maxLen > 0 ? 1 - distance / maxLen : 1 };
}

self.onmessage = function(event) {
  const request = event.data;
  const startTime = performance.now();
  let result, error;

  try {
    switch (request.type) {
      case 'TEXT_DIFF': {
        const { source, target } = request.payload;
        const diffs = computeTextDiff(source, target);
        const stats = computeDiffStats(diffs);
        result = { diffs, stats, sourceLength: source.length, targetLength: target.length };
        break;
      }
      case 'COMPUTE_HASH': {
        const { data, algorithm } = request.payload;
        let bytes;
        if (typeof data === 'string') {
          bytes = new TextEncoder().encode(data);
        } else {
          bytes = new Uint8Array(data);
        }
        const hash = fnv1aHash(bytes);
        result = { hash: hash.toString(36), algorithm: algorithm || 'fnv1a', bytesProcessed: bytes.length };
        break;
      }
      case 'COMPUTE_SIMILARITY': {
        const { source, target, caseSensitive } = request.payload;
        result = levenshteinDistance(source, target, caseSensitive);
        break;
      }
      case 'PING': {
        result = { pong: true, timestamp: Date.now() };
        break;
      }
      default:
        throw new Error('Unknown message type: ' + request.type);
    }
  } catch (e) {
    error = e.message || String(e);
  }

  const endTime = performance.now();
  self.postMessage({
    id: request.id,
    type: request.type,
    success: !error,
    result,
    error,
    computeTimeMs: endTime - startTime
  });
};
`;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.workerBlobUrl = URL.createObjectURL(blob);
  }

  /**
   * 创建新 Worker
   */
  private createWorker(): WorkerInfo | null {
    if (this.workers.size >= this.config.maxWorkers) {
      return null;
    }

    try {
      const workerUrl = this.config.workerUrl || this.workerBlobUrl;
      if (!workerUrl) {
        throw new Error('Worker URL not available');
      }

      const worker = new Worker(workerUrl, {
        type: this.config.useModuleWorker ? 'module' : 'classic',
      });

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

      // 设置消息处理
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerResponse(workerId, event.data);
      };

      worker.onerror = (error) => {
        console.error(`Worker ${workerId} error:`, error);
        this.handleWorkerError(workerId);
      };

      this.workers.set(workerId, workerInfo);
      return workerInfo;
    } catch (error) {
      console.error('Failed to create worker:', error);
      return null;
    }
  }

  /**
   * 处理 Worker 错误
   */
  private handleWorkerError(workerId: number): void {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    // 处理当前任务
    if (workerInfo.currentTaskId) {
      const task = this.pendingTasks.get(workerInfo.currentTaskId);
      if (task) {
        if (task.timeoutId) {
          clearTimeout(task.timeoutId);
        }
        task.reject(new Error('Worker error'));
        this.pendingTasks.delete(workerInfo.currentTaskId);
        this.failedTasks++;
      }
    }

    // 终止并移除 Worker
    workerInfo.worker.terminate();
    this.workers.delete(workerId);

    // 确保最小 Worker 数量
    if (this.workers.size < this.config.minWorkers) {
      this.createWorker();
    }
  }

  /**
   * 尝试扩容
   */
  private maybeScaleUp(): void {
    if (this.workers.size >= this.config.maxWorkers) return;
    if (this.taskQueue.length === 0) return;

    // 如果所有 Worker 都繁忙且有待处理任务，创建新 Worker
    const allBusy = Array.from(this.workers.values()).every((w) => w.status === 'busy');

    if (allBusy) {
      const newWorker = this.createWorker();
      if (newWorker) {
        this.processNextTask(newWorker);
      }
    }
  }

  /**
   * 检查空闲 Worker
   */
  private checkIdleWorkers(): void {
    if (this.isTerminated) return;

    const now = Date.now();
    const workersToRemove: number[] = [];

    for (const [workerId, workerInfo] of this.workers) {
      // 保持最小 Worker 数量
      if (this.workers.size - workersToRemove.length <= this.config.minWorkers) {
        break;
      }

      // 检查是否超过空闲时间
      if (workerInfo.status === 'idle' && now - workerInfo.lastActiveAt > this.config.idleTimeout) {
        workersToRemove.push(workerId);
      }
    }

    // 移除空闲 Worker
    for (const workerId of workersToRemove) {
      const workerInfo = this.workers.get(workerId);
      if (workerInfo) {
        workerInfo.worker.terminate();
        this.workers.delete(workerId);
      }
    }
  }

  /**
   * 执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    if (this.isTerminated) return;

    const pingRequests: Array<{
      workerId: number;
      promise: Promise<void>;
    }> = [];

    for (const [workerId, workerInfo] of this.workers) {
      if (workerInfo.status === 'idle') {
        const promise = new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error('Ping timeout'));
          }, 5000);

          const taskId = this.generateTaskId();
          const handler = (event: MessageEvent<WorkerResponse>) => {
            if (event.data.id === taskId) {
              clearTimeout(timeoutId);
              workerInfo.worker.removeEventListener('message', handler);
              if (event.data.success) {
                resolve();
              } else {
                reject(new Error('Ping failed'));
              }
            }
          };

          workerInfo.worker.addEventListener('message', handler);
          workerInfo.worker.postMessage({
            id: taskId,
            type: 'PING',
            payload: {},
          });
        });

        pingRequests.push({ workerId, promise });
      }
    }

    // 等待所有健康检查完成
    for (const { workerId, promise } of pingRequests) {
      try {
        await promise;
      } catch {
        console.warn(`Worker ${workerId} health check failed`);
        this.handleWorkerError(workerId);
      }
    }
  }

  // ================================
  // 工具方法
  // ================================

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${this.nextTaskId++}`;
  }

  /**
   * 获取统计信息
   */
  getStats(): PoolStats {
    let idleWorkers = 0;
    let busyWorkers = 0;

    for (const [, workerInfo] of this.workers) {
      if (workerInfo.status === 'idle') {
        idleWorkers++;
      } else if (workerInfo.status === 'busy') {
        busyWorkers++;
      }
    }

    const totalTasks = this.completedTasks + this.failedTasks;
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

  /**
   * 获取详细 Worker 信息
   */
  getWorkerInfos(): Array<{
    id: number;
    status: WorkerStatus;
    tasksCompleted: number;
    lastActiveAt: number;
    createdAt: number;
  }> {
    return Array.from(this.workers.values()).map((w) => ({
      id: w.id,
      status: w.status,
      tasksCompleted: w.tasksCompleted,
      lastActiveAt: w.lastActiveAt,
      createdAt: w.createdAt,
    }));
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Worker 池
 */
export function createWorkerPool(config?: Partial<WorkerPoolConfig>): WorkerPool {
  return new WorkerPool(config);
}

/**
 * 创建高性能 Worker 池
 */
export function createHighPerformancePool(): WorkerPool {
  return new WorkerPool({
    minWorkers: 2,
    maxWorkers: Math.max(4, navigator?.hardwareConcurrency || 4),
    taskTimeout: 60000,
    idleTimeout: 120000,
  });
}

/**
 * 创建轻量级 Worker 池
 */
export function createLightweightPool(): WorkerPool {
  return new WorkerPool({
    minWorkers: 1,
    maxWorkers: 2,
    taskTimeout: 15000,
    idleTimeout: 30000,
  });
}

// ================================
// 默认实例
// ================================

let defaultPool: WorkerPool | null = null;

/**
 * 获取默认 Worker 池
 */
export async function getDefaultWorkerPool(): Promise<WorkerPool> {
  if (!defaultPool) {
    defaultPool = new WorkerPool();
    await defaultPool.initialize();
  }
  return defaultPool;
}

/**
 * 关闭默认 Worker 池
 */
export function closeDefaultWorkerPool(): void {
  if (defaultPool) {
    defaultPool.terminate();
    defaultPool = null;
  }
}
