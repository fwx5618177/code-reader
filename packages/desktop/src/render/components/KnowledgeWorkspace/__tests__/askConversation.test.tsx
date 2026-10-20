// ================================
// 问答上下文测试：只取目标轮之前已完成的最近几轮
// ================================

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { askKnowledgeBase, type AskHandlers, type AskResult } from '../../../lib/agent/askService';
import { buildHistory, useAskConversation, type AskTurn } from '../useAskConversation';

vi.mock('../../../lib/agent/askService', () => ({ askKnowledgeBase: vi.fn() }));

const done = (n: number): AskTurn => ({ id: `t${n}`, question: `问${n}`, status: 'done', answer: `答${n}` });

describe('buildHistory', () => {
  it('展开为 user / assistant 消息，跳过未完成与失败的轮次', () => {
    const turns: AskTurn[] = [
      done(1),
      { id: 't2', question: '问2', status: 'error', error: '超时' },
      done(3),
      { id: 't4', question: '问4', status: 'pending' },
    ];
    expect(buildHistory(turns, 't4')).toEqual([
      { role: 'user', content: '问1' },
      { role: 'assistant', content: '答1' },
      { role: 'user', content: '问3' },
      { role: 'assistant', content: '答3' },
    ]);
  });

  it('重试时只使用该轮之前的对话，最多 6 轮', () => {
    const turns = Array.from({ length: 9 }, (_, i) => done(i + 1));
    const history = buildHistory(turns, 't9');
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ role: 'user', content: '问3' });
    expect(history[history.length - 1]).toEqual({ role: 'assistant', content: '答8' });
  });

  it('新提问（不在列表中）使用全部已完成轮次', () => {
    expect(buildHistory([done(1)], 'new')).toHaveLength(2);
  });

  it('被停止的不完整回答不作为上下文', () => {
    expect(buildHistory([{ ...done(1), stopped: true }, done(2)], 'new')).toEqual([
      { role: 'user', content: '问2' },
      { role: 'assistant', content: '答2' },
    ]);
  });
});

describe('useAskConversation 流式回答', () => {
  const source = { index: 1, itemId: 'a', title: '笔记', type: 'note' as const };

  it('来源到达后进入 streaming，增量逐步累积，结束后为 done', async () => {
    let handlers: AskHandlers = {};
    let finish: (value: AskResult) => void = () => {};
    vi.mocked(askKnowledgeBase).mockImplementation((_q, _h, h = {}) => {
      handlers = h;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    const { result } = renderHook(() => useAskConversation());
    act(() => result.current.ask('问题'));
    expect(result.current.turns[0].status).toBe('pending');
    expect(result.current.pending).toBe(true);

    act(() => handlers.onSources?.([source]));
    expect(result.current.turns[0]).toMatchObject({ status: 'streaming', sources: [source] });

    act(() => {
      handlers.onDelta?.('答案');
      handlers.onDelta?.('[1]');
    });
    await waitFor(() => expect(result.current.turns[0].answer).toBe('答案[1]'));
    expect(result.current.pending).toBe(true);

    await act(async () => finish({ answer: '答案[1]。', sources: [source], stopped: false }));
    expect(result.current.turns[0]).toMatchObject({ status: 'done', answer: '答案[1]。' });
    expect(result.current.pending).toBe(false);
  });

  it('生成中途失败时丢弃部分回答并可重试', async () => {
    let handlers: AskHandlers = {};
    let fail: (error: Error) => void = () => {};
    vi.mocked(askKnowledgeBase).mockImplementation((_q, _h, h = {}) => {
      handlers = h;
      return new Promise((_resolve, reject) => {
        fail = reject;
      });
    });

    const { result } = renderHook(() => useAskConversation());
    act(() => result.current.ask('问题'));
    act(() => {
      handlers.onSources?.([]);
      handlers.onDelta?.('部分');
    });
    await act(async () => fail(new Error('连接中断')));
    expect(result.current.turns[0]).toMatchObject({ status: 'error', error: '连接中断' });
    expect(result.current.turns[0].answer).toBeUndefined();

    vi.mocked(askKnowledgeBase).mockResolvedValue({ answer: '完整', sources: [], stopped: false });
    await act(async () => result.current.retry(result.current.turns[0].id));
    await waitFor(() => expect(result.current.turns[0].status).toBe('done'));
    expect(result.current.turns[0].answer).toBe('完整');
  });

  it('停止生成：中止信号传给问答服务，保留部分回答并标记为已停止而非失败', async () => {
    let handlers: AskHandlers = {};
    let signal: AbortSignal | undefined;
    vi.mocked(askKnowledgeBase).mockImplementation((_q, _h, h = {}, s) => {
      handlers = h;
      signal = s;
      // 模拟服务：收到中止后以已生成的部分正常返回
      return new Promise((resolve) => {
        s?.addEventListener('abort', () => resolve({ answer: '部分', sources: [source], stopped: true }));
      });
    });

    const { result } = renderHook(() => useAskConversation());
    act(() => result.current.ask('问题'));
    act(() => {
      handlers.onSources?.([source]);
      handlers.onDelta?.('部分');
    });
    expect(signal?.aborted).toBe(false);

    await act(async () => result.current.stop());
    expect(signal?.aborted).toBe(true);
    expect(result.current.turns[0]).toMatchObject({ status: 'done', answer: '部分', stopped: true });
    expect(result.current.turns[0].error).toBeUndefined();
    expect(result.current.pending).toBe(false);

    // 重新生成清除停止标记
    vi.mocked(askKnowledgeBase).mockResolvedValue({ answer: '完整', sources: [], stopped: false });
    await act(async () => result.current.retry(result.current.turns[0].id));
    await waitFor(() => expect(result.current.turns[0]).toMatchObject({ status: 'done', answer: '完整' }));
    expect(result.current.turns[0].stopped).toBe(false);
  });
});
