// ================================
// Agent Executor
// Background task processor for AI operations
// Handles transcription, summarization, tagging, embedding generation
// ================================

import { EventEmitter } from 'events';
import { getSQLiteService } from '../database/sqlite';
import { cosineSimilarity, decodeEmbedding, encodeEmbedding } from '../database/embedding-vector';
import { getAIService } from '../ai/ai-service';
import { BrowserWindow } from 'electron';
import { TASK_TYPES, type TaskType } from './task-types';
import { generateId } from './id';
import { runCategorize } from './categorize-task';
import { runExtractEntities } from './extract-entities-task';

// ================================
// Types
// ================================

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/** 由任务生命周期管理的条目状态（knowledge_items.status 的子集） */
export type ItemProcessingStatus = 'processing' | 'ready' | 'error';

export interface AgentTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  /** 为空表示面向整个知识库的任务 */
  targetItemId: string | null;
  priority: number;
  progress: number;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  result?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** agent:progress 事件载荷 */
export interface TaskProgress {
  taskId: string;
  targetItemId: string | null;
  type: TaskType;
  progress: number;
  status: TaskStatus;
  message?: string;
}

/** agent:taskCompleted 事件载荷 */
export interface TaskCompletedEvent {
  taskId: string;
  targetItemId: string | null;
  type: TaskType;
  result?: unknown;
}

/** agent:taskFailed 事件载荷；willRetry 为 true 时任务已重新排队，将在 retryDelay 之后重试 */
export interface TaskFailedEvent {
  taskId: string;
  targetItemId: string | null;
  type: TaskType;
  error: string;
  willRetry: boolean;
}

/** agent:itemStatusChanged 事件载荷；itemId 为空表示库级任务的状态（不对应任何条目） */
export interface ItemStatusChangedEvent {
  itemId: string | null;
  status: ItemProcessingStatus;
}

export interface ProcessItemOptions {
  transcribe?: boolean;
  summarize?: boolean;
  extractTags?: boolean;
  generateEmbedding?: boolean;
  findRelated?: boolean;
  extractEntities?: boolean;
  categorize?: boolean;
}

interface TaskRef {
  id: string;
  type: TaskType;
  targetItemId: string | null;
}

/** 面向单个条目的任务 */
type ItemTaskRef = TaskRef & { targetItemId: string };

interface TaskSpec {
  type: TaskType;
  priority?: number;
  maxRetries?: number;
}

/**
 * 任务执行产出：异步阶段只计算，不写库；写回条目的操作放在 commit 中，
 * 由 processTask 在确认任务未被取消后与任务完成状态在同一事务中执行
 */
export interface TaskOutput {
  result: unknown;
  commit?: () => void;
}

/** 任务执行中的进度回调：progress 为 0-100 */
export type ReportProgress = (progress: number, message: string) => void;

/** 归类放在摘要、标签之后执行，以便利用已生成的摘要 */
const CATEGORIZE_PRIORITY = 3;
const EXTRACT_ENTITIES_PRIORITY = 4;

// processItem 的处理步骤；同一条目内按优先级从高到低串行执行，后续步骤依赖前序步骤的产出
const PROCESS_ITEM_STEPS: ReadonlyArray<{
  option: keyof ProcessItemOptions;
  type: TaskType;
  priority: number;
}> = [
  { option: 'transcribe', type: 'transcribe', priority: 10 },
  { option: 'summarize', type: 'summarize', priority: 8 },
  { option: 'extractTags', type: 'extract-tags', priority: 7 },
  { option: 'generateEmbedding', type: 'generate-embedding', priority: 6 },
  { option: 'findRelated', type: 'find-related', priority: 5 },
  { option: 'extractEntities', type: 'extract-entities', priority: EXTRACT_ENTITIES_PRIORITY },
  { option: 'categorize', type: 'categorize', priority: CATEGORIZE_PRIORITY },
];

// ================================
// Agent Executor Configuration
// ================================

interface AgentExecutorConfig {
  /** Maximum concurrent tasks */
  maxConcurrent: number;
  /** Polling interval for new tasks (ms) */
  pollInterval: number;
  /** Default max retries for failed tasks */
  defaultMaxRetries: number;
  /** Delay between retries (ms) */
  retryDelay: number;
}

const DEFAULT_CONFIG: AgentExecutorConfig = {
  maxConcurrent: 2,
  pollInterval: 5000,
  defaultMaxRetries: 3,
  retryDelay: 10000,
};

function isTaskType(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}

/**
 * 生成 `AND column NOT IN (...)` 子句；values 为空时返回空子句
 */
function notInClause(column: string, values: string[]): { sql: string; params: string[] } {
  if (values.length === 0) return { sql: '', params: [] };
  return { sql: ` AND ${column} NOT IN (${values.map(() => '?').join(', ')})`, params: values };
}

// ================================
// Agent Executor Class
// ================================

export class AgentExecutor extends EventEmitter {
  private config: AgentExecutorConfig;
  private isRunning = false;
  // 进程内正在执行的任务；任务被取消后数据库状态变为 cancelled，但执行体仍会运行到结束，
  // 因此“条目是否忙碌”需要同时参考这里，而不能只看数据库
  private activeTasks: Map<string, { targetItemId: string | null; promise: Promise<void> }> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;

  constructor(config?: Partial<AgentExecutorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // Lifecycle
  // ================================

  /**
   * Set the main window for sending progress updates
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Start the agent executor
   */
  start(): void {
    if (this.isRunning) {
      console.log('[AgentExecutor] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[AgentExecutor] Starting...');

    this.recoverInterruptedTasks();

    // Start polling for new tasks
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.config.pollInterval);

    this.emit('started');
  }

  /**
   * Stop the agent executor
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[AgentExecutor] Stopping...');
    this.isRunning = false;

    // Stop polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active tasks to complete
    if (this.activeTasks.size > 0) {
      console.log(`[AgentExecutor] Waiting for ${this.activeTasks.size} active tasks...`);
      await Promise.all(Array.from(this.activeTasks.values(), (task) => task.promise));
    }

    this.emit('stopped');
    console.log('[AgentExecutor] Stopped');
  }

  /**
   * Check if executor is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  // ================================
  // Task Management
  // ================================

  /**
   * Create a new task
   */
  async createTask(
    type: TaskType,
    targetItemId: string,
    options?: {
      priority?: number;
      maxRetries?: number;
    }
  ): Promise<string> {
    return this.enqueueTasks(targetItemId, [{ type, ...options }])[0];
  }

  /**
   * 按选项为条目批量创建处理任务，返回创建的任务 ID（未选择任何步骤时返回空数组）
   */
  processItem(targetItemId: string, options?: ProcessItemOptions): string[] {
    const specs = PROCESS_ITEM_STEPS.filter((step) => options?.[step.option]).map((step) => ({
      type: step.type,
      priority: step.priority,
    }));
    if (specs.length === 0) return [];
    return this.enqueueTasks(targetItemId, specs);
  }

  /**
   * 整库自动归类（target_item_id 为空的库级任务）；已有未结束的整库归类时返回其任务 ID，不重复创建
   */
  categorizeLibrary(): string {
    const pending = getSQLiteService().get<{ id: string }>(
      `SELECT id FROM agent_tasks
       WHERE target_item_id IS NULL AND type = 'categorize'
         AND status IN ('pending', 'processing') AND is_deleted = 0
       LIMIT 1`
    );
    if (pending) return pending.id;
    return this.enqueueTasks(null, [{ type: 'categorize', priority: CATEGORIZE_PRIORITY }])[0];
  }

  /**
   * 为有文本的条目批量抽取实体，返回新提交的条目数。跳过：
   * - 已有未结束抽取任务的条目；
   * - 最近一次抽取完成后没有再修改过的条目（实体已是最新）
   */
  extractAllEntities(): number {
    const items = getSQLiteService().all<{ id: string }>(
      `SELECT k.id FROM knowledge_items k
       WHERE k.is_deleted = 0
         AND (TRIM(COALESCE(k.content, '')) != '' OR TRIM(COALESCE(k.transcript, '')) != ''
              OR TRIM(COALESCE(k.summary, '')) != '')
         AND NOT EXISTS (
           SELECT 1 FROM agent_tasks t
           WHERE t.target_item_id = k.id AND t.type = 'extract-entities' AND t.is_deleted = 0
             AND (t.status IN ('pending', 'processing')
                  OR (t.status = 'completed' AND t.completed_at >= k.updated_at))
         )
       ORDER BY k.created_at ASC`
    );
    for (const item of items) {
      this.enqueueTasks(item.id, [{ type: 'extract-entities', priority: EXTRACT_ENTITIES_PRIORITY }]);
    }
    return items.length;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const sqlite = getSQLiteService();
    const now = new Date().toISOString();

    const task = this.getTaskRef(taskId);
    if (!task) return false;

    const result = sqlite.run(
      `UPDATE agent_tasks SET status = 'cancelled', next_attempt_at = NULL, updated_at = ?
       WHERE id = ? AND status IN ('pending', 'processing')`,
      [now, taskId]
    );

    if (result.changes === 0) return false;

    console.log(`[AgentExecutor] Cancelled task ${taskId}`);
    this.emit('taskCancelled', { taskId });
    this.sendProgress(task, 0, 'cancelled', 'Cancelled');

    // 正在执行的任务会在执行体结束时自行结算条目状态
    if (!this.activeTasks.has(taskId)) {
      this.onItemTaskSettled(task.targetItemId);
    }

    return true;
  }

  /**
   * Get task status
   */
  getTask(taskId: string): AgentTask | undefined {
    const sqlite = getSQLiteService();
    const row = sqlite.get<AgentTask>(
      `SELECT id, type, status, target_item_id as targetItemId, priority, progress,
              error_message as errorMessage, retry_count as retryCount, max_retries as maxRetries,
              result, started_at as startedAt, completed_at as completedAt,
              created_at as createdAt, updated_at as updatedAt
       FROM agent_tasks WHERE id = ?`,
      [taskId]
    );
    return row;
  }

  /**
   * Get pending tasks count
   */
  getPendingCount(): number {
    const sqlite = getSQLiteService();
    const result = sqlite.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM agent_tasks WHERE status = 'pending'`
    );
    return result?.count ?? 0;
  }

  /**
   * Get all tasks for an item
   */
  getTasksForItem(itemId: string): AgentTask[] {
    const sqlite = getSQLiteService();
    return sqlite.all<AgentTask>(
      `SELECT id, type, status, target_item_id as targetItemId, priority, progress,
              error_message as errorMessage, retry_count as retryCount, max_retries as maxRetries,
              result, started_at as startedAt, completed_at as completedAt,
              created_at as createdAt, updated_at as updatedAt
       FROM agent_tasks WHERE target_item_id = ? ORDER BY created_at DESC`,
      [itemId]
    );
  }

  /**
   * 在一个事务内创建任务并把条目标记为 processing（库级任务没有条目状态，只通知界面）。
   * 若目标已有未结束的任务，新任务并入同一批次，最终状态由整批任务的结果决定。
   */
  private enqueueTasks(targetItemId: string | null, specs: TaskSpec[]): string[] {
    for (const spec of specs) {
      if (!isTaskType(spec.type)) {
        throw new Error(`Unsupported task type: ${spec.type}`);
      }
    }

    const sqlite = getSQLiteService();
    const now = new Date().toISOString();

    const { taskIds, statusChanged } = sqlite.transaction(() => {
      const openBatch = sqlite.get<{ batch_id: string | null }>(
        `SELECT batch_id FROM agent_tasks
         WHERE target_item_id IS ? AND status IN ('pending', 'processing') AND is_deleted = 0
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
        [targetItemId]
      );
      const batchId = openBatch?.batch_id ?? generateId();

      const ids = specs.map((spec) => {
        const taskId = generateId();
        sqlite.run(
          `INSERT INTO agent_tasks (id, type, status, target_item_id, priority, max_retries, batch_id, created_at, updated_at)
           VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
          [
            taskId,
            spec.type,
            targetItemId,
            spec.priority ?? 5,
            spec.maxRetries ?? this.config.defaultMaxRetries,
            batchId,
            now,
            now,
          ]
        );
        return taskId;
      });

      if (targetItemId === null) return { taskIds: ids, statusChanged: true };
      const statusUpdate = sqlite.run(
        `UPDATE knowledge_items SET status = 'processing' WHERE id = ? AND status != 'processing'`,
        [targetItemId]
      );

      return { taskIds: ids, statusChanged: statusUpdate.changes > 0 };
    });

    taskIds.forEach((taskId, index) => {
      const type = specs[index].type;
      console.log(`[AgentExecutor] Created task ${taskId} (${type}) for ${targetItemId === null ? 'library' : `item ${targetItemId}`}`);
      this.emit('taskCreated', { taskId, type, targetItemId });
    });

    if (statusChanged) {
      this.sendItemStatusChanged(targetItemId, 'processing');
    }

    this.schedulePoll();

    return taskIds;
  }

  private getTaskRef(taskId: string): TaskRef | undefined {
    const sqlite = getSQLiteService();
    return sqlite.get<TaskRef>(
      `SELECT id, type, target_item_id as targetItemId FROM agent_tasks WHERE id = ?`,
      [taskId]
    );
  }

  // ================================
  // Task Processing
  // ================================

  /**
   * 启动时当前进程没有任何执行中的任务（stop 可能尚未等完的除外），
   * 残留的 processing 记录来自上次异常退出，重置为 pending 以便重新执行；
   * 否则它们会永久阻塞同一条目的后续任务
   */
  private recoverInterruptedTasks(): void {
    const sqlite = getSQLiteService();
    const now = new Date().toISOString();
    const running = notInClause('id', Array.from(this.activeTasks.keys()));

    const result = sqlite.run(
      `UPDATE agent_tasks SET status = 'pending', progress = 0, updated_at = ?
       WHERE status = 'processing'${running.sql}`,
      [now, ...running.params]
    );

    if (result.changes > 0) {
      console.log(`[AgentExecutor] Re-queued ${result.changes} interrupted task(s)`);
    }
  }

  private schedulePoll(): void {
    if (this.isRunning) {
      setImmediate(() => this.poll());
    }
  }

  /**
   * Poll for and process new tasks
   */
  private poll(): void {
    if (!this.isRunning) return;

    // Check if we can take more tasks
    const availableSlots = this.config.maxConcurrent - this.activeTasks.size;
    if (availableSlots <= 0) return;

    const sqlite = getSQLiteService();
    const now = new Date().toISOString();
    const busyTargets = new Set(Array.from(this.activeTasks.values(), (task) => task.targetItemId));
    const busyItemIds = [...busyTargets].filter((id): id is string => id !== null);
    // target_item_id 为空的库级任务自成一个队列；NOT IN 对 NULL 不成立，需要单独放行
    const busyClause =
      (busyTargets.has(null) ? ' AND t.target_item_id IS NOT NULL' : '') +
      (busyItemIds.length > 0
        ? ` AND (t.target_item_id IS NULL OR t.target_item_id NOT IN (${busyItemIds.map(() => '?').join(', ')}))`
        : '');

    // 同一条目（或库级队列）的任务严格串行，且按 priority DESC, created_at ASC 的顺序执行：
    // 1. 条目已有 processing 任务（或进程内仍在运行的已取消任务）时不可运行；
    // 2. 只有条目的“队首”待执行任务可运行，处于重试等待中的队首同样会阻塞后续任务；
    // 3. 重试任务需等到 next_attempt_at 之后。
    // 每个条目至多产出一个候选，不同条目之间并发执行，总数不超过 maxConcurrent。
    // 队列归属用 IS 比较，使库级任务（NULL）之间同样互斥
    const tasks = sqlite.all<{ id: string; type: TaskType; target_item_id: string | null }>(
      `SELECT t.id, t.type, t.target_item_id
       FROM agent_tasks t
       WHERE t.status = 'pending' AND t.is_deleted = 0
         AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= ?)
         AND NOT EXISTS (
           SELECT 1 FROM agent_tasks p
           WHERE p.target_item_id IS t.target_item_id
             AND p.status = 'processing' AND p.is_deleted = 0
         )
         AND NOT EXISTS (
           SELECT 1 FROM agent_tasks o
           WHERE o.target_item_id IS t.target_item_id
             AND o.status = 'pending' AND o.is_deleted = 0
             AND (
               o.priority > t.priority
               OR (o.priority = t.priority AND (
                 o.created_at < t.created_at
                 OR (o.created_at = t.created_at AND o.rowid < t.rowid)
               ))
             )
         )${busyClause}
       ORDER BY t.priority DESC, t.created_at ASC, t.rowid ASC
       LIMIT ?`,
      [now, ...busyItemIds, availableSlots]
    );

    for (const task of tasks) {
      this.startTask({ id: task.id, type: task.type, targetItemId: task.target_item_id });
    }
  }

  private startTask(task: TaskRef): void {
    const promise = this.processTask(task)
      .catch((error) => {
        console.error(
          `[AgentExecutor] Failed to record outcome of task ${task.id} (${task.type}) for item ${task.targetItemId}:`,
          error
        );
      })
      .finally(() => {
        this.activeTasks.delete(task.id);
        this.onItemTaskSettled(task.targetItemId);
      });

    this.activeTasks.set(task.id, { targetItemId: task.targetItemId, promise });
  }

  /**
   * Process a single task
   */
  private async processTask(task: TaskRef): Promise<void> {
    const sqlite = getSQLiteService();
    const startedAt = new Date().toISOString();

    // 仅认领仍处于 pending 的任务
    const claimed = sqlite.run(
      `UPDATE agent_tasks SET status = 'processing', progress = 0, started_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      [startedAt, startedAt, task.id]
    );
    if (claimed.changes === 0) return;

    this.sendProgress(task, 0, 'processing', 'Starting...');
    this.emit('taskStarted', { taskId: task.id, type: task.type });

    let output: TaskOutput;
    try {
      output = await this.executeTask(task);
    } catch (error) {
      this.handleTaskError(task, error);
      return;
    }
    const { result, commit } = output;

    // 执行期间任务可能已被取消：先把状态从 processing 转为 completed，
    // 成功后才写回条目，两者在同一事务中，已取消的任务不会产生任何副作用
    const completedAt = new Date().toISOString();
    let completed: boolean;
    try {
      completed = sqlite.transaction(() => {
        const updated = sqlite.run(
          `UPDATE agent_tasks
           SET status = 'completed', progress = 100, result = ?, error_message = NULL,
               next_attempt_at = NULL, completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'processing'`,
          [JSON.stringify(result), completedAt, completedAt, task.id]
        );
        if (updated.changes === 0) return false;
        commit?.();
        return true;
      });
    } catch (error) {
      // 写回失败时事务已回滚，任务仍为 processing，按普通失败处理（重试或失败）
      this.handleTaskError(task, error);
      return;
    }

    if (!completed) {
      console.log(`[AgentExecutor] Task ${task.id} was cancelled while running; result not recorded`);
      return;
    }

    this.sendProgress(task, 100, 'completed', 'Done');
    this.emit('taskCompleted', { taskId: task.id, type: task.type, result });
    this.send<TaskCompletedEvent>('agent:taskCompleted', {
      taskId: task.id,
      targetItemId: task.targetItemId,
      type: task.type,
      result,
    });

    console.log(`[AgentExecutor] Task ${task.id} completed successfully`);
  }

  private executeTask(task: TaskRef): Promise<TaskOutput> {
    const report: ReportProgress = (progress, message) =>
      this.sendProgress(task, progress, 'processing', message);
    if (task.type === 'categorize') {
      return runCategorize(task.targetItemId, report);
    }

    const targetItemId = task.targetItemId;
    if (targetItemId === null) {
      return Promise.reject(new Error(`Task type ${task.type} requires a target item`));
    }
    const itemTask: ItemTaskRef = { ...task, targetItemId };
    switch (itemTask.type) {
      case 'transcribe':
        return this.executeTranscribe(itemTask);
      case 'summarize':
        return this.executeSummarize(itemTask);
      case 'extract-tags':
        return this.executeExtractTags(itemTask);
      case 'generate-embedding':
        return this.executeGenerateEmbedding(itemTask);
      case 'find-related':
        return this.executeFindRelated(itemTask);
      case 'extract-entities':
        return runExtractEntities(targetItemId, report);
      default:
        // 旧版本数据库中可能残留已移除类型的任务
        return Promise.reject(new Error(`Unknown task type: ${String(itemTask.type)}`));
    }
  }

  /**
   * Handle task error with retry logic
   */
  private handleTaskError(task: TaskRef, error: unknown): void {
    const sqlite = getSQLiteService();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();

    const row = sqlite.get<{ retry_count: number; max_retries: number }>(
      `SELECT retry_count, max_retries FROM agent_tasks WHERE id = ?`,
      [task.id]
    );
    if (!row) return;

    const newRetryCount = row.retry_count + 1;
    const willRetry = newRetryCount < row.max_retries;

    // 与完成分支相同：仅在任务仍为 processing 时写入，避免覆盖 cancelled
    const updated = willRetry
      ? sqlite.run(
          `UPDATE agent_tasks
           SET status = 'pending', progress = 0, retry_count = ?, error_message = ?,
               next_attempt_at = ?, updated_at = ?
           WHERE id = ? AND status = 'processing'`,
          [
            newRetryCount,
            errorMessage,
            new Date(Date.now() + this.config.retryDelay).toISOString(),
            now,
            task.id,
          ]
        )
      : sqlite.run(
          `UPDATE agent_tasks
           SET status = 'failed', retry_count = ?, error_message = ?, next_attempt_at = NULL,
               completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'processing'`,
          [newRetryCount, errorMessage, now, now, task.id]
        );

    if (updated.changes === 0) {
      console.log(`[AgentExecutor] Task ${task.id} was cancelled while running (error ignored: ${errorMessage})`);
      return;
    }

    if (willRetry) {
      console.log(
        `[AgentExecutor] Task ${task.id} failed, retry ${newRetryCount}/${row.max_retries} in ${this.config.retryDelay}ms: ${errorMessage}`
      );
      this.sendProgress(task, 0, 'pending', `Retrying (${newRetryCount}/${row.max_retries})...`);
      this.emit('taskRetry', { taskId: task.id, retryCount: newRetryCount, error: errorMessage });
    } else {
      console.error(`[AgentExecutor] Task ${task.id} failed permanently:`, errorMessage);
      this.sendProgress(task, 0, 'failed', errorMessage);
      this.emit('taskFailed', { taskId: task.id, error: errorMessage });
    }

    this.send<TaskFailedEvent>('agent:taskFailed', {
      taskId: task.id,
      targetItemId: task.targetItemId,
      type: task.type,
      error: errorMessage,
      willRetry,
    });
  }

  /**
   * 条目（或库级队列）的某个任务结束（完成/失败/取消）后调用：
   * 若已无待执行或执行中的任务，按最近一批任务是否存在永久失败将其置为 error 或 ready
   */
  private onItemTaskSettled(itemId: string | null): void {
    try {
      this.updateItemStatusIfIdle(itemId);
    } catch (error) {
      console.error(`[AgentExecutor] Failed to update status of ${itemId === null ? 'library tasks' : `item ${itemId}`}:`, error);
    }
    this.schedulePoll();
  }

  private updateItemStatusIfIdle(itemId: string | null): void {
    const isRunningInProcess = Array.from(this.activeTasks.values()).some(
      (task) => task.targetItemId === itemId
    );
    if (isRunningInProcess) return;

    // 用 IS 比较，使库级任务（target_item_id 为空）同样适用
    const sqlite = getSQLiteService();
    const remaining = sqlite.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM agent_tasks
       WHERE target_item_id IS ? AND status IN ('pending', 'processing') AND is_deleted = 0`,
      [itemId]
    );
    if ((remaining?.count ?? 0) > 0) return;

    // 新批次只会在条目空闲时开启，因此最近创建的任务所在批次就是刚结束的批次
    const latest = sqlite.get<{ batch_id: string | null }>(
      `SELECT batch_id FROM agent_tasks
       WHERE target_item_id IS ? AND is_deleted = 0
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
      [itemId]
    );
    if (!latest) return;

    // batch_id 为空的是迁移前创建的任务，用 IS 比较使其归为同一批
    const hasFailure =
      sqlite.get(
        `SELECT 1 FROM agent_tasks
         WHERE target_item_id IS ? AND batch_id IS ? AND status = 'failed' AND is_deleted = 0
         LIMIT 1`,
        [itemId, latest.batch_id]
      ) !== undefined;

    const status: ItemProcessingStatus = hasFailure ? 'error' : 'ready';
    // 库级任务没有对应的条目状态，只通知界面结束
    if (itemId === null) {
      this.sendItemStatusChanged(null, status);
      return;
    }
    const updated = sqlite.run(
      `UPDATE knowledge_items SET status = ? WHERE id = ? AND status != ?`,
      [status, itemId, status]
    );

    if (updated.changes > 0) {
      this.sendItemStatusChanged(itemId, status);
    }
  }

  // ================================
  // Task Executors
  // ================================

  /**
   * Execute transcription task
   */
  private async executeTranscribe(task: ItemTaskRef): Promise<TaskOutput> {
    const sqlite = getSQLiteService();
    const aiService = getAIService();

    // Get item details
    const item = sqlite.get<{ file_path: string }>(
      `SELECT file_path FROM knowledge_items WHERE id = ?`,
      [task.targetItemId]
    );

    if (!item?.file_path) {
      throw new Error('No audio file path found');
    }

    this.sendProgress(task, 10, 'processing', 'Starting transcription...');

    // Transcribe
    const result = await aiService.transcribe({
      audioPath: item.file_path,
    });

    this.sendProgress(task, 80, 'processing', 'Saving transcript...');

    // 条目状态由任务生命周期统一管理
    const commit = () => {
      sqlite.run(
        `UPDATE knowledge_items SET transcript = ?, transcript_timestamps = ?, updated_at = ? WHERE id = ?`,
        [
          result.text,
          JSON.stringify(result.segments || []),
          new Date().toISOString(),
          task.targetItemId,
        ]
      );
    };

    return { result, commit };
  }

  /**
   * Execute summarization task
   */
  private async executeSummarize(task: ItemTaskRef): Promise<TaskOutput> {
    const sqlite = getSQLiteService();
    const aiService = getAIService();

    // Get item content
    const item = sqlite.get<{ content: string; transcript: string }>(
      `SELECT content, transcript FROM knowledge_items WHERE id = ?`,
      [task.targetItemId]
    );

    const textContent = item?.content || item?.transcript;
    if (!textContent) {
      throw new Error('No content to summarize');
    }

    this.sendProgress(task, 10, 'processing', 'Generating summary...');

    // Summarize
    const result = await aiService.summarize({
      content: textContent,
    });

    this.sendProgress(task, 80, 'processing', 'Saving summary...');

    const commit = () => {
      sqlite.run(
        `UPDATE knowledge_items SET summary = ?, key_points = ?, updated_at = ? WHERE id = ?`,
        [
          result.summary,
          JSON.stringify(result.keyPoints),
          new Date().toISOString(),
          task.targetItemId,
        ]
      );
    };

    return { result, commit };
  }

  /**
   * Execute tag extraction task
   */
  private async executeExtractTags(task: ItemTaskRef): Promise<TaskOutput> {
    const sqlite = getSQLiteService();
    const aiService = getAIService();

    // Get item content
    const item = sqlite.get<{ content: string; transcript: string; summary: string }>(
      `SELECT content, transcript, summary FROM knowledge_items WHERE id = ?`,
      [task.targetItemId]
    );

    const textContent = item?.content || item?.transcript || item?.summary;
    if (!textContent) {
      throw new Error('No content for tag extraction');
    }

    // Get existing tags for context
    const existingTags = sqlite.all<{ name: string }>(
      `SELECT name FROM tags WHERE is_deleted = 0 ORDER BY usage_count DESC LIMIT 50`
    );

    this.sendProgress(task, 10, 'processing', 'Extracting tags...');

    // Extract tags
    const result = await aiService.extractTags({
      content: textContent,
      existingTags: existingTags.map((t) => t.name),
    });

    this.sendProgress(task, 60, 'processing', 'Saving tags...');

    // Create/update tags and link to item
    const commit = () => {
      const now = new Date().toISOString();

      for (const tag of result.tags) {
        // Get or create tag
        let tagRow = sqlite.get<{ id: string }>(`SELECT id FROM tags WHERE name = ?`, [tag.name]);

        if (!tagRow) {
          const tagId = generateId();
          sqlite.run(
            `INSERT INTO tags (id, name, is_auto_generated, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
            [tagId, tag.name, now, now]
          );
          tagRow = { id: tagId };
        }

        // Link tag to item
        sqlite.run(
          `INSERT OR IGNORE INTO item_tags (item_id, tag_id, created_at) VALUES (?, ?, ?)`,
          [task.targetItemId, tagRow.id, now]
        );

        // Update usage count
        sqlite.run(`UPDATE tags SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?`, [
          now,
          tagRow.id,
        ]);
      }
    };

    return { result, commit };
  }

  /**
   * Execute embedding generation task
   */
  private async executeGenerateEmbedding(task: ItemTaskRef): Promise<TaskOutput> {
    const sqlite = getSQLiteService();
    const aiService = getAIService();

    // Get item content
    const item = sqlite.get<{ title: string; content: string; transcript: string; summary: string }>(
      `SELECT title, content, transcript, summary FROM knowledge_items WHERE id = ?`,
      [task.targetItemId]
    );

    if (!item) {
      throw new Error('Item not found');
    }

    // Combine content for embedding
    const textParts = [item.title];
    if (item.summary) textParts.push(item.summary);
    if (item.content) textParts.push(item.content.slice(0, 8000)); // Limit content length
    if (item.transcript) textParts.push(item.transcript.slice(0, 8000));

    const textContent = textParts.join('\n\n');

    this.sendProgress(task, 10, 'processing', 'Generating embedding...');

    // Generate embedding
    const result = await aiService.createEmbeddings({
      input: textContent,
    });

    this.sendProgress(task, 80, 'processing', 'Saving embedding...');

    const embeddingId = generateId();
    const commit = () => {
      const now = new Date().toISOString();

      // Delete old embeddings for this item
      sqlite.run(`DELETE FROM embeddings WHERE item_id = ?`, [task.targetItemId]);

      // Insert new embedding
      sqlite.run(
        `INSERT INTO embeddings (id, item_id, model, dimensions, vector, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          embeddingId,
          task.targetItemId,
          result.model,
          result.dimensions,
          encodeEmbedding(result.embeddings[0]),
          now,
        ]
      );

      // Mark item as indexed
      sqlite.run(`UPDATE knowledge_items SET is_indexed = 1, updated_at = ? WHERE id = ?`, [
        now,
        task.targetItemId,
      ]);
    };

    return {
      result: { embeddingId, dimensions: result.dimensions, model: result.model },
      commit,
    };
  }

  /**
   * Execute find related items task
   */
  private async executeFindRelated(task: ItemTaskRef): Promise<TaskOutput> {
    const sqlite = getSQLiteService();

    // Get source embedding
    const sourceEmbedding = sqlite.get<{ vector: Buffer; dimensions: number }>(
      `SELECT vector, dimensions FROM embeddings WHERE item_id = ?`,
      [task.targetItemId]
    );

    if (!sourceEmbedding) {
      throw new Error('Source item has no embedding');
    }

    this.sendProgress(task, 10, 'processing', 'Finding similar items...');

    // Get all other embeddings
    const embeddings = sqlite.all<{ item_id: string; vector: Buffer }>(
      `SELECT item_id, vector FROM embeddings WHERE item_id != ?`,
      [task.targetItemId]
    );

    // Calculate cosine similarity
    const sourceVector = decodeEmbedding(sourceEmbedding.vector);
    const similarities: Array<{ itemId: string; similarity: number }> = [];

    for (const emb of embeddings) {
      const similarity = cosineSimilarity(sourceVector, decodeEmbedding(emb.vector));
      if (similarity > 0.5) {
        // Threshold
        similarities.push({ itemId: emb.item_id, similarity });
      }
    }

    // Sort by similarity and take top 10
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topRelated = similarities.slice(0, 10);

    this.sendProgress(task, 80, 'processing', 'Creating links...');

    const commit = () => {
      const now = new Date().toISOString();
      for (const related of topRelated) {
        sqlite.run(
          `INSERT OR REPLACE INTO links (id, source_id, target_id, type, strength, created_at, updated_at)
           VALUES (?, ?, ?, 'ai-suggested', ?, ?, ?)`,
          [generateId(), task.targetItemId, related.itemId, related.similarity, now, now]
        );
      }
    };

    return { result: { relatedCount: topRelated.length, related: topRelated }, commit };
  }

  // ================================
  // Utilities
  // ================================

  /**
   * 向主窗口发送事件
   */
  private send<T>(channel: string, payload: T): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
  }

  /**
   * Send progress update to renderer
   */
  private sendProgress(task: TaskRef, progress: number, status: TaskStatus, message?: string): void {
    const payload: TaskProgress = {
      taskId: task.id,
      targetItemId: task.targetItemId,
      type: task.type,
      progress,
      status,
      message,
    };
    this.emit('progress', payload);
    this.send('agent:progress', payload);
  }

  private sendItemStatusChanged(itemId: string | null, status: ItemProcessingStatus): void {
    this.emit('itemStatusChanged', { itemId, status });
    this.send<ItemStatusChangedEvent>('agent:itemStatusChanged', { itemId, status });
  }
}

// ================================
// Singleton Export
// ================================

let agentExecutor: AgentExecutor | null = null;

export function getAgentExecutor(): AgentExecutor {
  if (!agentExecutor) {
    agentExecutor = new AgentExecutor();
  }
  return agentExecutor;
}

export default getAgentExecutor;
