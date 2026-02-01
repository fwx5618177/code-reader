// ================================
// Agent Executor
// Background task processor for AI operations
// Handles transcription, summarization, tagging, embedding generation
// ================================

import { EventEmitter } from 'events';
import { getSQLiteService } from '../database/sqlite';
import { getAIService } from '../ai/ai-service';
import { BrowserWindow } from 'electron';

// ================================
// Types
// ================================

export type TaskType =
  | 'transcribe'
  | 'summarize'
  | 'extract-tags'
  | 'categorize'
  | 'extract-entities'
  | 'generate-embedding'
  | 'find-related';

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface AgentTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  targetItemId: string;
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

export interface TaskProgress {
  taskId: string;
  progress: number;
  status: TaskStatus;
  message?: string;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

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
  /** Whether to auto-start processing */
  autoStart: boolean;
}

const DEFAULT_CONFIG: AgentExecutorConfig = {
  maxConcurrent: 2,
  pollInterval: 5000,
  defaultMaxRetries: 3,
  retryDelay: 10000,
  autoStart: true,
};

// ================================
// Agent Executor Class
// ================================

export class AgentExecutor extends EventEmitter {
  private config: AgentExecutorConfig;
  private isRunning = false;
  private activeTasks: Map<string, Promise<void>> = new Map();
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
      await Promise.all(this.activeTasks.values());
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
    const sqlite = getSQLiteService();
    const taskId = this.generateId();
    const now = new Date().toISOString();

    sqlite.run(
      `INSERT INTO agent_tasks (id, type, status, target_item_id, priority, max_retries, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        taskId,
        type,
        targetItemId,
        options?.priority ?? 5,
        options?.maxRetries ?? this.config.defaultMaxRetries,
        now,
        now,
      ]
    );

    console.log(`[AgentExecutor] Created task ${taskId} (${type}) for item ${targetItemId}`);
    this.emit('taskCreated', { taskId, type, targetItemId });

    // Trigger immediate poll if running
    if (this.isRunning) {
      setImmediate(() => this.poll());
    }

    return taskId;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const sqlite = getSQLiteService();
    const now = new Date().toISOString();

    const result = sqlite.run(
      `UPDATE agent_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending', 'processing')`,
      [now, taskId]
    );

    if (result.changes > 0) {
      console.log(`[AgentExecutor] Cancelled task ${taskId}`);
      this.emit('taskCancelled', { taskId });
      return true;
    }

    return false;
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

  // ================================
  // Task Processing
  // ================================

  /**
   * Poll for and process new tasks
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    // Check if we can take more tasks
    const availableSlots = this.config.maxConcurrent - this.activeTasks.size;
    if (availableSlots <= 0) return;

    const sqlite = getSQLiteService();

    // Get pending tasks ordered by priority and creation time
    const tasks = sqlite.all<{ id: string; type: TaskType; target_item_id: string }>(
      `SELECT id, type, target_item_id
       FROM agent_tasks
       WHERE status = 'pending' AND is_deleted = 0
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`,
      [availableSlots]
    );

    for (const task of tasks) {
      if (!this.isRunning) break;
      if (this.activeTasks.has(task.id)) continue;

      // Start processing task
      const promise = this.processTask(task.id, task.type, task.target_item_id);
      this.activeTasks.set(task.id, promise);

      promise.finally(() => {
        this.activeTasks.delete(task.id);
      });
    }
  }

  /**
   * Process a single task
   */
  private async processTask(
    taskId: string,
    type: TaskType,
    targetItemId: string
  ): Promise<void> {
    const sqlite = getSQLiteService();
    const now = new Date().toISOString();

    // Mark as processing
    sqlite.run(
      `UPDATE agent_tasks SET status = 'processing', started_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, taskId]
    );

    this.sendProgress({ taskId, progress: 0, status: 'processing', message: 'Starting...' });
    this.emit('taskStarted', { taskId, type });

    try {
      let result: unknown;

      switch (type) {
        case 'transcribe':
          result = await this.executeTranscribe(taskId, targetItemId);
          break;
        case 'summarize':
          result = await this.executeSummarize(taskId, targetItemId);
          break;
        case 'extract-tags':
          result = await this.executeExtractTags(taskId, targetItemId);
          break;
        case 'generate-embedding':
          result = await this.executeGenerateEmbedding(taskId, targetItemId);
          break;
        case 'find-related':
          result = await this.executeFindRelated(taskId, targetItemId);
          break;
        default:
          throw new Error(`Unknown task type: ${type}`);
      }

      // Mark as completed
      const completedAt = new Date().toISOString();
      sqlite.run(
        `UPDATE agent_tasks SET status = 'completed', progress = 100, result = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(result), completedAt, completedAt, taskId]
      );

      this.sendProgress({ taskId, progress: 100, status: 'completed', message: 'Done' });
      this.emit('taskCompleted', { taskId, type, result });

      console.log(`[AgentExecutor] Task ${taskId} completed successfully`);
    } catch (error) {
      await this.handleTaskError(taskId, error);
    }
  }

  /**
   * Handle task error with retry logic
   */
  private async handleTaskError(taskId: string, error: unknown): Promise<void> {
    const sqlite = getSQLiteService();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const now = new Date().toISOString();

    // Get current retry count
    const task = sqlite.get<{ retry_count: number; max_retries: number }>(
      `SELECT retry_count, max_retries FROM agent_tasks WHERE id = ?`,
      [taskId]
    );

    if (!task) return;

    const newRetryCount = task.retry_count + 1;

    if (newRetryCount < task.max_retries) {
      // Schedule retry
      sqlite.run(
        `UPDATE agent_tasks SET status = 'pending', retry_count = ?, error_message = ?, updated_at = ? WHERE id = ?`,
        [newRetryCount, errorMessage, now, taskId]
      );

      console.log(
        `[AgentExecutor] Task ${taskId} failed, scheduling retry ${newRetryCount}/${task.max_retries}`
      );

      this.sendProgress({
        taskId,
        progress: 0,
        status: 'pending',
        message: `Retrying (${newRetryCount}/${task.max_retries})...`,
      });

      this.emit('taskRetry', { taskId, retryCount: newRetryCount, error: errorMessage });
    } else {
      // Mark as failed
      sqlite.run(
        `UPDATE agent_tasks SET status = 'failed', retry_count = ?, error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        [newRetryCount, errorMessage, now, now, taskId]
      );

      console.error(`[AgentExecutor] Task ${taskId} failed permanently:`, errorMessage);

      this.sendProgress({
        taskId,
        progress: 0,
        status: 'failed',
        message: errorMessage,
      });

      this.emit('taskFailed', { taskId, error: errorMessage });
    }
  }

  // ================================
  // Task Executors
  // ================================

  /**
   * Execute transcription task
   */
  private async executeTranscribe(taskId: string, targetItemId: string): Promise<unknown> {
    const sqlite = getSQLiteService();
    const aiService = getAIService();

    // Get item details
    const item = sqlite.get<{ file_path: string }>(
      `SELECT file_path FROM knowledge_items WHERE id = ?`,
      [targetItemId]
    );

    if (!item?.file_path) {
      throw new Error('No audio file path found');
    }

    this.sendProgress({ taskId, progress: 10, status: 'processing', message: 'Starting transcription...' });

    // Transcribe
    const result = await aiService.transcribe({
      audioPath: item.file_path,
    });

    this.sendProgress({ taskId, progress: 80, status: 'processing', message: 'Saving transcript...' });

    // Update item with transcript
    const now = new Date().toISOString();
    sqlite.run(
      `UPDATE knowledge_items SET transcript = ?, transcript_timestamps = ?, status = 'ready', updated_at = ? WHERE id = ?`,
      [result.text, JSON.stringify(result.segments || []), now, targetItemId]
    );

    return result;
  }

  /**
   * Execute summarization task
   */
  private async executeSummarize(taskId: string, targetItemId: string): Promise<unknown> {
    const sqlite = getSQLiteService();
    const aiService = getAIService();

    // Get item content
    const item = sqlite.get<{ content: string; transcript: string }>(
      `SELECT content, transcript FROM knowledge_items WHERE id = ?`,
      [targetItemId]
    );

    const textContent = item?.content || item?.transcript;
    if (!textContent) {
      throw new Error('No content to summarize');
    }

    this.sendProgress({ taskId, progress: 10, status: 'processing', message: 'Generating summary...' });

    // Summarize
    const result = await aiService.summarize({
      content: textContent,
    });

    this.sendProgress({ taskId, progress: 80, status: 'processing', message: 'Saving summary...' });

    // Update item with summary
    const now = new Date().toISOString();
    sqlite.run(
      `UPDATE knowledge_items SET summary = ?, key_points = ?, updated_at = ? WHERE id = ?`,
      [result.summary, JSON.stringify(result.keyPoints), now, targetItemId]
    );

    return result;
  }

  /**
   * Execute tag extraction task
   */
  private async executeExtractTags(taskId: string, targetItemId: string): Promise<unknown> {
    const sqlite = getSQLiteService();
    const aiService = getAIService();

    // Get item content
    const item = sqlite.get<{ content: string; transcript: string; summary: string }>(
      `SELECT content, transcript, summary FROM knowledge_items WHERE id = ?`,
      [targetItemId]
    );

    const textContent = item?.content || item?.transcript || item?.summary;
    if (!textContent) {
      throw new Error('No content for tag extraction');
    }

    // Get existing tags for context
    const existingTags = sqlite.all<{ name: string }>(
      `SELECT name FROM tags WHERE is_deleted = 0 ORDER BY usage_count DESC LIMIT 50`
    );

    this.sendProgress({ taskId, progress: 10, status: 'processing', message: 'Extracting tags...' });

    // Extract tags
    const result = await aiService.extractTags({
      content: textContent,
      existingTags: existingTags.map((t) => t.name),
    });

    this.sendProgress({ taskId, progress: 60, status: 'processing', message: 'Saving tags...' });

    // Create/update tags and link to item
    const now = new Date().toISOString();

    for (const tag of result.tags) {
      // Get or create tag
      let tagRow = sqlite.get<{ id: string }>(
        `SELECT id FROM tags WHERE name = ?`,
        [tag.name]
      );

      if (!tagRow) {
        const tagId = this.generateId();
        sqlite.run(
          `INSERT INTO tags (id, name, is_auto_generated, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
          [tagId, tag.name, now, now]
        );
        tagRow = { id: tagId };
      }

      // Link tag to item
      sqlite.run(
        `INSERT OR IGNORE INTO item_tags (item_id, tag_id, created_at) VALUES (?, ?, ?)`,
        [targetItemId, tagRow.id, now]
      );

      // Update usage count
      sqlite.run(
        `UPDATE tags SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?`,
        [now, tagRow.id]
      );
    }

    return result;
  }

  /**
   * Execute embedding generation task
   */
  private async executeGenerateEmbedding(taskId: string, targetItemId: string): Promise<unknown> {
    const sqlite = getSQLiteService();
    const aiService = getAIService();

    // Get item content
    const item = sqlite.get<{ title: string; content: string; transcript: string; summary: string }>(
      `SELECT title, content, transcript, summary FROM knowledge_items WHERE id = ?`,
      [targetItemId]
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

    this.sendProgress({ taskId, progress: 10, status: 'processing', message: 'Generating embedding...' });

    // Generate embedding
    const result = await aiService.createEmbeddings({
      input: textContent,
    });

    this.sendProgress({ taskId, progress: 80, status: 'processing', message: 'Saving embedding...' });

    // Save embedding
    const embeddingId = this.generateId();
    const now = new Date().toISOString();
    const embeddingBuffer = Buffer.from(new Float32Array(result.embeddings[0]).buffer);

    // Delete old embeddings for this item
    sqlite.run(`DELETE FROM embeddings WHERE item_id = ?`, [targetItemId]);

    // Insert new embedding
    sqlite.run(
      `INSERT INTO embeddings (id, item_id, model, dimensions, vector, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [embeddingId, targetItemId, result.model, result.dimensions, embeddingBuffer, now]
    );

    // Mark item as indexed
    sqlite.run(
      `UPDATE knowledge_items SET is_indexed = 1, updated_at = ? WHERE id = ?`,
      [now, targetItemId]
    );

    return { embeddingId, dimensions: result.dimensions, model: result.model };
  }

  /**
   * Execute find related items task
   */
  private async executeFindRelated(taskId: string, targetItemId: string): Promise<unknown> {
    const sqlite = getSQLiteService();

    // Get source embedding
    const sourceEmbedding = sqlite.get<{ vector: Buffer; dimensions: number }>(
      `SELECT vector, dimensions FROM embeddings WHERE item_id = ?`,
      [targetItemId]
    );

    if (!sourceEmbedding) {
      throw new Error('Source item has no embedding');
    }

    this.sendProgress({ taskId, progress: 10, status: 'processing', message: 'Finding similar items...' });

    // Get all other embeddings
    const embeddings = sqlite.all<{ item_id: string; vector: Buffer }>(
      `SELECT item_id, vector FROM embeddings WHERE item_id != ?`,
      [targetItemId]
    );

    // Calculate cosine similarity
    const sourceVector = new Float32Array(sourceEmbedding.vector.buffer);
    const similarities: Array<{ itemId: string; similarity: number }> = [];

    for (const emb of embeddings) {
      const vector = new Float32Array(emb.vector.buffer);
      const similarity = this.cosineSimilarity(sourceVector, vector);
      if (similarity > 0.5) {
        // Threshold
        similarities.push({ itemId: emb.item_id, similarity });
      }
    }

    // Sort by similarity and take top 10
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topRelated = similarities.slice(0, 10);

    this.sendProgress({ taskId, progress: 80, status: 'processing', message: 'Creating links...' });

    // Create links
    const now = new Date().toISOString();
    for (const related of topRelated) {
      const linkId = this.generateId();
      sqlite.run(
        `INSERT OR REPLACE INTO links (id, source_id, target_id, type, strength, created_at, updated_at)
         VALUES (?, ?, ?, 'ai-suggested', ?, ?, ?)`,
        [linkId, targetItemId, related.itemId, related.similarity, now, now]
      );
    }

    return { relatedCount: topRelated.length, related: topRelated };
  }

  // ================================
  // Utilities
  // ================================

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Send progress update to renderer
   */
  private sendProgress(progress: TaskProgress): void {
    this.emit('progress', progress);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('agent:progress', progress);
    }
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
