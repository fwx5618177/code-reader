// ================================
// AI 任务浮窗测试：无活动时隐藏、折叠徽标、展开后的任务进度与打开条目、整库任务与归类记录（去审阅）
// ================================

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeRecord, ItemActivity } from '../../../lib/agent/agentStore';
import AgentActivityPanel from '..';

const state = vi.hoisted(() => ({
  activities: [] as ItemActivity[],
  records: [] as ChangeRecord[],
  dismissRecord: (_taskId: string) => undefined as void,
}));

vi.mock('../../../lib/agent/agentStore', () => ({
  useAgentActivity: () => state.activities,
  useChangeRecords: () => state.records,
  agentActivity: { dismissRecord: (taskId: string) => state.dismissRecord(taskId) },
  TASK_LABELS: {
    transcribe: '语音转写',
    summarize: '生成摘要',
    'extract-tags': '提取标签',
    'generate-embedding': '建立语义索引',
    'find-related': '发现关联',
    categorize: '自动归类',
    'extract-entities': '提取实体',
  },
}));

const TITLES: Record<string, string> = { a: '会议录音', b: '读书笔记.md' };
const resolveTitle = (id: string) => TITLES[id];

describe('AgentActivityPanel', () => {
  beforeEach(() => {
    state.records = [];
    state.activities = [
      {
        itemId: 'a',
        status: 'processing',
        updatedAt: Date.now(),
        tasks: [
          { taskId: 't1', type: 'transcribe', status: 'completed', progress: 100 },
          { taskId: 't2', type: 'summarize', status: 'processing', progress: 42 },
        ],
      },
      {
        itemId: 'b',
        status: 'error',
        updatedAt: Date.now(),
        tasks: [{ taskId: 't3', type: 'extract-tags', status: 'failed', progress: 0, error: '模型超时' }],
      },
    ] as ItemActivity[];
  });

  it('没有活动时不渲染', () => {
    state.activities = [];
    const { container } = render(<AgentActivityPanel resolveTitle={resolveTitle} onOpenItem={vi.fn()} onReviewCategorization={vi.fn()} />);
    expect(container.childElementCount).toBe(0);
  });

  it('默认折叠，显示汇总状态与条目数徽标', () => {
    render(<AgentActivityPanel resolveTitle={resolveTitle} onOpenItem={vi.fn()} onReviewCategorization={vi.fn()} />);
    const pill = screen.getByRole('button', { name: /AI 处理中/ });
    expect(pill.textContent).toContain('2');
    expect(screen.queryByText('生成摘要')).toBeNull();
  });

  it('展开后列出条目、任务进度与错误，点击条目打开', () => {
    const onOpenItem = vi.fn();
    render(<AgentActivityPanel resolveTitle={resolveTitle} onOpenItem={onOpenItem} onReviewCategorization={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 处理中/ }));

    expect(screen.getByText('会议录音')).toBeTruthy();
    expect(screen.getByText('生成摘要')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '生成摘要' }).getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText('模型超时')).toBeTruthy();

    fireEvent.click(screen.getByTitle('打开「读书笔记」'));
    expect(onOpenItem).toHaveBeenCalledWith('b');

    fireEvent.click(screen.getByTitle('收起'));
    expect(screen.queryByText('会议录音')).toBeNull();
  });

  it('整库任务显示为「整个知识库」，不可打开', () => {
    const onOpenItem = vi.fn();
    state.activities = [
      {
        itemId: null,
        status: 'processing',
        updatedAt: Date.now(),
        tasks: [{ taskId: 'lib', type: 'categorize', status: 'processing', progress: 30, message: '分析条目' }],
      },
    ];
    render(<AgentActivityPanel resolveTitle={resolveTitle} onOpenItem={onOpenItem} onReviewCategorization={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /AI 处理中/ }));
    expect(screen.getByText('整个知识库')).toBeTruthy();
    expect(screen.getByText('自动归类')).toBeTruthy();
    expect(screen.queryByTitle(/打开/)).toBeNull();
  });

  it('没有活动时仍显示归类记录，可打开条目、去审阅与关闭记录', () => {
    const onOpenItem = vi.fn();
    const onReview = vi.fn();
    const dismissed: string[] = [];
    state.dismissRecord = (taskId) => {
      dismissed.push(taskId);
    };
    state.activities = [];
    state.records = [
      {
        taskId: 'r1',
        itemId: 'a',
        createdAt: Date.now(),
        summary: '分析了该条目：生成 1 条归类建议，待审阅',
        pendingReview: 1,
      },
      { taskId: 'r2', itemId: null, createdAt: Date.now(), summary: '分析了 3 个条目，没有需要调整的地方', pendingReview: 0 },
    ];
    render(<AgentActivityPanel resolveTitle={resolveTitle} onOpenItem={onOpenItem} onReviewCategorization={onReview} />);
    const pill = screen.getByRole('button', { name: /AI 整理记录/ });
    expect(pill.textContent).toContain('2');
    fireEvent.click(pill);

    expect(screen.getByText('分析了该条目：生成 1 条归类建议，待审阅')).toBeTruthy();
    expect(screen.getByText('整库自动归类')).toBeTruthy();
    fireEvent.click(screen.getByTitle('打开「会议录音」'));
    expect(onOpenItem).toHaveBeenCalledWith('a');

    // 只有生成了建议的记录显示「去审阅」
    const reviewLinks = screen.getAllByRole('button', { name: '去审阅' });
    expect(reviewLinks).toHaveLength(1);
    fireEvent.click(reviewLinks[0]);
    expect(onReview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByTitle('关闭记录')[1]);
    expect(dismissed).toEqual(['r2']);
  });
});
