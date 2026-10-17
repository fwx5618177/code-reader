// ================================
// AI 任务浮窗测试：无活动时隐藏、折叠徽标、展开后的任务进度与打开条目
// ================================

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemActivity } from '../../../lib/agent/agentStore';
import AgentActivityPanel from '..';

const state = vi.hoisted(() => ({ activities: [] as ItemActivity[] }));

vi.mock('../../../lib/agent/agentStore', () => ({
  useAgentActivity: () => state.activities,
  TASK_LABELS: {
    transcribe: '语音转写',
    summarize: '生成摘要',
    'extract-tags': '提取标签',
    'generate-embedding': '建立语义索引',
    'find-related': '发现关联',
  },
}));

const TITLES: Record<string, string> = { a: '会议录音', b: '读书笔记.md' };
const resolveTitle = (id: string) => TITLES[id];

describe('AgentActivityPanel', () => {
  beforeEach(() => {
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
    const { container } = render(<AgentActivityPanel resolveTitle={resolveTitle} onOpenItem={vi.fn()} />);
    expect(container.childElementCount).toBe(0);
  });

  it('默认折叠，显示汇总状态与条目数徽标', () => {
    render(<AgentActivityPanel resolveTitle={resolveTitle} onOpenItem={vi.fn()} />);
    const pill = screen.getByRole('button', { name: /AI 处理中/ });
    expect(pill.textContent).toContain('2');
    expect(screen.queryByText('生成摘要')).toBeNull();
  });

  it('展开后列出条目、任务进度与错误，点击条目打开', () => {
    const onOpenItem = vi.fn();
    render(<AgentActivityPanel resolveTitle={resolveTitle} onOpenItem={onOpenItem} />);
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
});
