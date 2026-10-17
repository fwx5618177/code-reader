// ================================
// AskPanel：空对话时提供“重建语义索引”入口，确认后提交整库重建
// ================================

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AskPanel } from '../AskPanel';
import type { AskConversation } from '../useAskConversation';

const requestReindexEmbeddings = vi.fn();

vi.mock('../../../services/aiConfigService', () => ({
  default: { hasUsableProvider: () => Promise.resolve(true) },
}));
vi.mock('../../../lib/agent/actions', () => ({
  AI_UNAVAILABLE_HINTS: { 'no-provider': '未配置', 'ai-disabled': '已关闭' },
  requestReindexEmbeddings: () => requestReindexEmbeddings(),
}));
vi.mock('../../AgentActivity/activity', () => ({ useTaskTypeRunning: () => false }));

const conversation = {
  turns: [],
  pending: false,
  ask: vi.fn(),
  retry: vi.fn(),
  stop: vi.fn(),
} as unknown as AskConversation;

describe('AskPanel 重建语义索引', () => {
  it('确认后提交重建；没有过期条目时给出提示', async () => {
    requestReindexEmbeddings.mockResolvedValue('nothing-to-do');
    render(<AskPanel conversation={conversation} onSelectItem={vi.fn()} onOpenSettings={vi.fn()} />);

    fireEvent.click(screen.getByText('重建语义索引'));
    await act(async () => {
      fireEvent.click(screen.getByText('开始'));
    });

    expect(requestReindexEmbeddings).toHaveBeenCalledTimes(1);
    expect(screen.getByText('所有有文本的条目语义索引都已是最新。')).toBeTruthy();
  });
});
