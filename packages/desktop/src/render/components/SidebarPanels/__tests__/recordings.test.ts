import { describe, it, expect } from 'vitest';
import type { KnowledgeItem } from '../../../types/knowledge';
import type { ItemActivity } from '../../../lib/agent/agentStore';
import { formatDuration, listRecordings, transcriptState } from '../recordings';

function item(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    title: id,
    type: 'audio',
    status: 'ready',
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
    ...overrides,
  };
}

function activity(status: 'pending' | 'processing' | 'completed' | 'failed'): ItemActivity {
  return {
    itemId: 'a',
    status: 'processing',
    tasks: [{ taskId: 't', type: 'transcribe', status, progress: 0 }],
    updatedAt: 0,
  };
}

describe('listRecordings', () => {
  it('只保留音频条目，按创建时间倒序', () => {
    const items = [
      item('old', { createdAt: new Date(2026, 0, 1) }),
      item('note', { type: 'note' }),
      item('new', { createdAt: new Date(2026, 9, 17) }),
    ];
    expect(listRecordings(items).map((i) => i.id)).toEqual(['new', 'old']);
  });
});

describe('formatDuration', () => {
  it('不足一小时为 m:ss，否则为 h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(3600 + 2 * 60 + 3)).toBe('1:02:03');
  });
});

describe('transcriptState', () => {
  it('进行中的转写任务优先', () => {
    expect(transcriptState(item('a', { transcript: '旧文本' }), activity('processing'))).toBe('running');
    expect(transcriptState(item('a'), activity('pending'))).toBe('running');
  });

  it('有转写文本为已转写；任务失败或条目出错为失败；否则未转写', () => {
    expect(transcriptState(item('a', { transcript: '你好' }), undefined)).toBe('done');
    expect(transcriptState(item('a', { transcript: '  ' }), undefined)).toBe('none');
    expect(transcriptState(item('a'), activity('failed'))).toBe('failed');
    expect(transcriptState(item('a', { status: 'error' }), undefined)).toBe('failed');
  });
});
