// ================================
// 待审阅归类状态（渲染进程）：待审阅提议列表与审阅面板的开关
// 归类任务完成后自动刷新；知识库工具栏的「待审阅」按钮与 AI 任务浮窗的「去审阅」都通过它打开面板
// ================================

import { useEffect, useSyncExternalStore } from 'react';
import type { CategorizationProposal } from '../../types/electron';
import { agentActivity } from '../agent/agentStore';
import { applyReview, type ReviewReport, type ReviewRequest } from './review-actions';

export interface CategorizationReviewState {
  proposals: CategorizationProposal[];
  /** 首次加载完成前为 false */
  loaded: boolean;
  error: string | null;
  open: boolean;
  /** 正在应用审阅结果 */
  busy: boolean;
}

class CategorizationReviewStore {
  private state: CategorizationReviewState = { proposals: [], loaded: false, error: null, open: false, busy: false };
  private readonly listeners = new Set<() => void>();
  private attached = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CategorizationReviewState => this.state;

  /** 首次使用时加载，并在归类任务完成后刷新（幂等） */
  attach(): void {
    if (this.attached || !window.electron?.categorization) return;
    this.attached = true;
    agentActivity.onTaskCompleted((event) => {
      if (event.type === 'categorize') void this.refresh();
    });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const proposals = await window.electron.categorization.listPending();
      this.update({ proposals, loaded: true, error: null });
    } catch (error) {
      console.error('[CategorizationReview] 加载待审阅归类失败:', error);
      this.update({ loaded: true, error: error instanceof Error ? error.message : String(error) });
    }
  }

  open(): void {
    this.attach();
    this.update({ open: true });
    void this.refresh();
  }

  close(): void {
    this.update({ open: false });
  }

  /** 应用审阅结果并刷新列表；记录审阅结果失败时抛出错误 */
  async review(requests: ReviewRequest[]): Promise<ReviewReport> {
    this.update({ busy: true });
    try {
      return await applyReview(requests);
    } finally {
      await this.refresh();
      this.update({ busy: false });
    }
  }

  private update(patch: Partial<CategorizationReviewState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const categorizationReview = new CategorizationReviewStore();

export function useCategorizationReview(): CategorizationReviewState {
  useEffect(() => categorizationReview.attach(), []);
  return useSyncExternalStore(categorizationReview.subscribe, categorizationReview.getSnapshot);
}
