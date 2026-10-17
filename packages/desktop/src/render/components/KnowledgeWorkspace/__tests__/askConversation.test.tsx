// ================================
// 问答上下文测试：只取目标轮之前已完成的最近几轮
// ================================

import { describe, expect, it, vi } from 'vitest';
import { buildHistory, type AskTurn } from '../useAskConversation';

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
});
