// ================================
// 知识库问答服务测试：中止信号转为取消流式请求，停止后以部分回答正常返回
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askKnowledgeBase } from '../askService';
import { knowledgeRepository } from '../../knowledge/repository';
import type { ChatStreamHandle } from '../../../types/electron';
import type { KnowledgeItem } from '../../../types/knowledge';

type ChatCompletionResponse = Awaited<ChatStreamHandle['result']>;

vi.mock('../../knowledge/repository', () => ({ knowledgeRepository: { getByIds: vi.fn() } }));

const item = { id: 'a', title: '笔记', type: 'note', content: '正文' } as KnowledgeItem;

/** 模拟主进程流式接口：cancel 后以已生成的部分返回 aborted */
function mockElectron() {
  let resolve: (response: ChatCompletionResponse) => void = () => {};
  let partial = '';
  const cancel = vi.fn(async () => resolve({ id: '', content: partial, model: 'm', aborted: true }));
  const chatStream = vi.fn((_request: unknown, onDelta: (delta: string) => void) => ({
    result: new Promise<ChatCompletionResponse>((r) => {
      resolve = r;
      partial = '部分';
      onDelta(partial);
    }),
    cancel,
  }));
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      search: { hybrid: vi.fn(async () => [{ itemId: 'a' }]) },
      ai: { chatStream },
    },
  });
  return { chatStream, cancel, finish: (content: string) => resolve({ id: '1', content, model: 'm' }) };
}

describe('askKnowledgeBase', () => {
  beforeEach(() => {
    vi.mocked(knowledgeRepository.getByIds).mockResolvedValue([item]);
  });

  it('正常完成时 stopped 为 false', async () => {
    const { finish } = mockElectron();
    const onSources = vi.fn();
    const promise = askKnowledgeBase('问题', [], { onSources });
    await vi.waitFor(() => expect(onSources).toHaveBeenCalled());
    finish('完整回答');
    await expect(promise).resolves.toMatchObject({ answer: '完整回答', stopped: false });
  });

  it('中止时取消流式请求，保留部分回答并标记 stopped', async () => {
    const { chatStream, cancel } = mockElectron();
    const controller = new AbortController();
    const onDelta = vi.fn();
    const promise = askKnowledgeBase('问题', [], { onDelta }, controller.signal);
    await vi.waitFor(() => expect(chatStream).toHaveBeenCalled());
    expect(onDelta).toHaveBeenCalledWith('部分');

    controller.abort();
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toEqual({
      answer: '部分',
      sources: [{ index: 1, itemId: 'a', title: '笔记', type: 'note' }],
      stopped: true,
    });
  });

  it('检索期间已中止则不请求模型', async () => {
    const { chatStream } = mockElectron();
    const controller = new AbortController();
    const onSources = vi.fn();
    const promise = askKnowledgeBase('问题', [], { onSources }, controller.signal);
    controller.abort();
    await expect(promise).resolves.toMatchObject({ answer: '', stopped: true });
    expect(chatStream).not.toHaveBeenCalled();
    expect(onSources).not.toHaveBeenCalled();
  });
});
