// ================================
// Agent 活动状态（渲染进程）
// 订阅主进程 Agent 的任务事件，汇总为"每个条目的处理进度"，
// 供知识库条目流、详情面板与任务浮窗共用。
// itemId 为 null 的活动表示面向整个知识库的任务（如整库自动归类）。
// ================================

import { useSyncExternalStore } from 'react';
import type {
  ItemProcessingStatus,
  ProcessItemOptions,
  TaskCompletedEvent,
  TaskStatus,
  TaskType,
} from '../../types/electron';
import { describeCategorizeResult, isCategorizeResult, type ChangeDescription } from './change-records';

/** 任务显示名称 */
export const TASK_LABELS: Record<TaskType, string> = {
  transcribe: '语音转写',
  summarize: '生成摘要',
  'extract-tags': '提取标签',
  'generate-embedding': '建立语义索引',
  'find-related': '发现关联',
  categorize: '自动归类',
  'extract-entities': '提取实体',
};

/** 单个任务的进度 */
export interface TaskActivity {
  taskId: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  message?: string;
  error?: string;
}

/** 一个条目（或整个知识库）的处理状态 */
export interface ItemActivity {
  /** 为 null 表示整个知识库 */
  itemId: string | null;
  status: ItemProcessingStatus;
  tasks: TaskActivity[];
  updatedAt: number;
}

/** 自动归类生成建议的记录，保留到用户关闭 */
export interface ChangeRecord extends ChangeDescription {
  taskId: string;
  /** 为 null 表示整库任务 */
  itemId: string | null;
  createdAt: number;
}

/** 处理完成的条目在活动列表中保留的时长 */
const FINISHED_RETENTION_MS = 8000;

class AgentActivityStore {
  private readonly activities = new Map<string | null, ItemActivity>();
  private snapshot: ItemActivity[] = [];
  private records: ChangeRecord[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly itemListeners = new Set<(itemId: string) => void>();
  private readonly completedListeners = new Set<(event: TaskCompletedEvent) => void>();
  private attached = false;

  /** 订阅主进程事件（幂等） */
  attach(): void {
    if (this.attached || !window.electron?.agent) return;
    this.attached = true;
    const agent = window.electron.agent;

    agent.onProgress((event) => {
      this.upsertTask(event.targetItemId, {
        taskId: event.taskId,
        type: event.type,
        status: event.status,
        progress: event.progress,
        message: event.message,
      });
    });

    agent.onTaskCompleted((event) => {
      this.upsertTask(event.targetItemId, {
        taskId: event.taskId,
        type: event.type,
        status: 'completed',
        progress: 100,
      });
      if (event.type === 'categorize' && isCategorizeResult(event.result)) {
        this.records = [
          {
            taskId: event.taskId,
            itemId: event.targetItemId,
            createdAt: Date.now(),
            ...describeCategorizeResult(event.result),
          },
          ...this.records,
        ];
        this.publish();
      }
      // 库级任务（整库归类）只生成待审阅建议，不修改条目；接受建议时由审阅面板刷新知识库
      if (event.targetItemId !== null) this.notifyItem(event.targetItemId);
      for (const listener of this.completedListeners) listener(event);
    });

    agent.onTaskFailed((event) => {
      this.upsertTask(event.targetItemId, {
        taskId: event.taskId,
        type: event.type,
        status: event.willRetry ? 'pending' : 'failed',
        progress: 0,
        error: event.error,
        message: event.willRetry ? '稍后自动重试' : undefined,
      });
    });

    agent.onItemStatusChanged((event) => {
      const activity = this.ensureActivity(event.itemId);
      activity.status = event.status;
      activity.updatedAt = Date.now();
      this.publish();
      if (event.itemId !== null) this.notifyItem(event.itemId);
      if (event.status !== 'processing') {
        setTimeout(() => this.pruneFinished(), FINISHED_RETENTION_MS);
      }
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ItemActivity[] => this.snapshot;

  getRecords = (): ChangeRecord[] => this.records;

  /**
   * 知识库条目被 Agent 更新时回调（摘要、标签、状态）
   */
  onItemChanged(listener: (itemId: string) => void): () => void {
    this.itemListeners.add(listener);
    return () => this.itemListeners.delete(listener);
  }

  /** 任意任务完成时回调（如实体抽取完成后刷新实体图谱） */
  onTaskCompleted(listener: (event: TaskCompletedEvent) => void): () => void {
    this.attach();
    this.completedListeners.add(listener);
    return () => this.completedListeners.delete(listener);
  }

  /**
   * 提交条目处理
   */
  async process(itemId: string, options: ProcessItemOptions): Promise<void> {
    this.markProcessing(itemId);
    await window.electron.agent.processItem(itemId, options);
  }

  /** 提交整库自动归类 */
  async categorizeLibrary(): Promise<void> {
    this.markProcessing(null);
    await window.electron.agent.categorizeLibrary();
  }

  /** 为所有条目抽取实体，返回提交的条目数（各条目的活动由主进程事件创建） */
  async extractAllEntities(): Promise<number> {
    this.attach();
    return window.electron.agent.extractAllEntities();
  }

  /** 为语义索引过期的条目重建向量，返回提交的条目数（各条目的活动由主进程事件创建） */
  async reindexEmbeddings(): Promise<number> {
    this.attach();
    return window.electron.agent.reindexEmbeddings();
  }

  /** 关闭一条变更记录 */
  dismissRecord(taskId: string): void {
    this.records = this.records.filter((record) => record.taskId !== taskId);
    this.publish();
  }

  private markProcessing(itemId: string | null): void {
    this.attach();
    const activity = this.ensureActivity(itemId);
    activity.status = 'processing';
    activity.updatedAt = Date.now();
    this.publish();
  }

  private ensureActivity(itemId: string | null): ItemActivity {
    let activity = this.activities.get(itemId);
    if (!activity) {
      activity = { itemId, status: 'processing', tasks: [], updatedAt: Date.now() };
      this.activities.set(itemId, activity);
    }
    return activity;
  }

  private upsertTask(itemId: string | null, task: TaskActivity): void {
    const activity = this.ensureActivity(itemId);
    const index = activity.tasks.findIndex((t) => t.taskId === task.taskId);
    if (index === -1) activity.tasks = [...activity.tasks, task];
    else activity.tasks = activity.tasks.map((t, i) => (i === index ? { ...t, ...task } : t));
    activity.updatedAt = Date.now();
    this.publish();
  }

  private pruneFinished(): void {
    const cutoff = Date.now() - FINISHED_RETENTION_MS;
    let changed = false;
    for (const [id, activity] of this.activities) {
      if (activity.status !== 'processing' && activity.updatedAt <= cutoff) {
        this.activities.delete(id);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  private publish(): void {
    // 每次生成新的数组与对象，保证 useSyncExternalStore 能感知变化
    this.snapshot = [...this.activities.values()]
      .map((activity) => ({ ...activity }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const listener of this.listeners) listener();
  }

  private notifyItem(itemId: string): void {
    for (const listener of this.itemListeners) listener(itemId);
  }
}

export const agentActivity = new AgentActivityStore();

/** 当前所有条目的处理活动 */
export function useAgentActivity(): ItemActivity[] {
  return useSyncExternalStore(agentActivity.subscribe, agentActivity.getSnapshot);
}

/** 尚未关闭的变更记录（最新在前） */
export function useChangeRecords(): ChangeRecord[] {
  return useSyncExternalStore(agentActivity.subscribe, agentActivity.getRecords);
}
