// ================================
// 最近文档选取测试
// ================================

import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '../../../types/knowledge';
import { pickRecentDocuments, sortByRecentUpdate } from '../recent';

const item = (id: string, type: KnowledgeItem['type'], updated: string, extra: Partial<KnowledgeItem> = {}) =>
  ({ id, type, title: `${id}.md`, updatedAt: new Date(updated), ...extra }) as KnowledgeItem;

describe('pickRecentDocuments', () => {
  it('只取写作文档，按更新时间倒序并限制条数，标题去掉扩展名', () => {
    const items = [
      item('old', 'note', '2026-01-01'),
      item('web', 'webpage', '2026-03-01'),
      item('new', 'note', '2026-02-01'),
      item('gone', 'note', '2026-04-01', { isDeleted: true }),
      item('mid', 'note', '2026-01-15'),
    ];
    expect(pickRecentDocuments(items, 2)).toEqual([
      { id: 'new', title: 'new' },
      { id: 'mid', title: 'mid' },
    ]);
  });

  it('空标题显示占位标题', () => {
    expect(pickRecentDocuments([item('a', 'note', '2026-01-01', { title: '' })])).toEqual([
      { id: 'a', title: '无标题' },
    ]);
  });
});

describe('sortByRecentUpdate', () => {
  it('按更新时间倒序，不修改原数组', () => {
    const items = [item('a', 'audio', '2026-01-01'), item('b', 'note', '2026-03-01'), item('c', 'document', '2026-02-01')];
    expect(sortByRecentUpdate(items).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(items[0].id).toBe('a');
  });
});
