// ================================
// Agent 活动状态（渲染进程）
// 订阅主进程 Agent 的任务事件，汇总为"每个条目的处理进度"，
// 供知识库条目流、详情面板与任务浮窗共用。
// ================================

import { useSyncExternalStore } from 'react';
import type {
  ItemProcessingStatus,
  ProcessItemOptions,
  TaskStatus,
  TaskType,
} from '../../types/electron';

/** 任务显示名称 */
export const TASK_LABELS: Record<TaskType, string> = {
  transcribe: '语音转写',
  summarize: '生成摘要',
  'extract-tags': '提取标签',
  'generate-embedding': '建立语义索引',
  'find-related': '发现关联',
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

/** 一个条目的处理状态 */
export interface ItemActivity {
  itemId: string;
  status: ItemProcessingStatus;
  tasks: TaskActivity[];
  updatedAt: number;
}

/** 处理完成的条目在活动列表中保留的时长 */
const FINISHED_RETENTION_MS = 8000;

class AgentActivityStore {
  private readonly activities = new Map<string, ItemActivity>();
  private snapshot: ItemActivity[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly itemListeners = new Set<(itemId: string) => void>();
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
      this.notifyItem(event.targetItemId);
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
      this.notifyItem(event.itemId);
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

  /** 条目数据被 Agent 更新（摘要、标签、状态）时回调 */
  onItemChanged(listener: (itemId: string) => void): () => void {
    this.itemListeners.add(listener);
    return () => this.itemListeners.delete(listener);
  }

  /**
   * 提交条目处理
   */
  async process(itemId: string, options: ProcessItemOptions): Promise<void> {
    this.attach();
    const activity = this.ensureActivity(itemId);
    activity.status = 'processing';
    activity.updatedAt = Date.now();
    this.publish();
    await window.electron.agent.processItem(itemId, options);
  }

  private ensureActivity(itemId: string): ItemActivity {
    let activity = this.activities.get(itemId);
    if (!activity) {
      activity = { itemId, status: 'processing', tasks: [], updatedAt: Date.now() };
      this.activities.set(itemId, activity);
    }
    return activity;
  }

  private upsertTask(itemId: string, task: TaskActivity): void {
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
