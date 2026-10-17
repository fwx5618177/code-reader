// ================================
// 托盘“最近打开”子菜单测试
// ================================

import { describe, expect, it, vi } from 'vitest';
import { buildRecentSubmenu, normalizeRecentDocuments, RECENT_DOCUMENTS_LIMIT } from '../recent-menu';

describe('normalizeRecentDocuments', () => {
  it('非数组或非法项被丢弃，重复 id 只保留第一项', () => {
    expect(normalizeRecentDocuments('x')).toEqual([]);
    expect(
      normalizeRecentDocuments([
        { id: 'a', title: '第一篇' },
        null,
        { id: 1, title: '错误 id' },
        { id: '', title: '空 id' },
        { id: 'a', title: '重复' },
        { id: 'b' },
      ])
    ).toEqual([
      { id: 'a', title: '第一篇' },
      { id: 'b', title: '无标题' },
    ]);
  });

  it('限制条数并截断过长标题', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, title: '长'.repeat(60) }));
    const documents = normalizeRecentDocuments(many);
    expect(documents).toHaveLength(RECENT_DOCUMENTS_LIMIT);
    expect(documents[0].title).toHaveLength(40);
    expect(documents[0].title.endsWith('…')).toBe(true);
  });
});

describe('buildRecentSubmenu', () => {
  it('没有文档时显示不可点击的提示', () => {
    expect(buildRecentSubmenu([], vi.fn())).toEqual([{ label: '暂无文档', enabled: false }]);
  });

  it('点击菜单项回调对应文档 id', () => {
    const onOpen = vi.fn();
    const items = buildRecentSubmenu(
      [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
      onOpen
    );
    expect(items.map((item) => item.label)).toEqual(['A', 'B']);
    items[1].click?.(undefined as never, undefined, undefined as never);
    expect(onOpen).toHaveBeenCalledWith('b');
  });
});
