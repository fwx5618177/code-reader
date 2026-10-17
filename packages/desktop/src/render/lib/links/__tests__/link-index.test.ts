// ================================
// 双向链接索引测试
// ================================

import { describe, expect, it } from 'vitest';
import { LinkIndex, normalizeLinkTarget, type LinkParseCache } from '../link-index';
import type { KnowledgeItem } from '../../../types/knowledge';

function note(id: string, title: string, content: string, updatedAt = 1): KnowledgeItem {
  return {
    id,
    title,
    type: 'note',
    status: 'ready',
    content,
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(updatedAt),
  };
}

const ITEMS = [
  note('a', '机器学习.md', '入门见 [[线性代数]]，进阶见 [[概率论|概率]]。'),
  note('b', '线性代数.md', '矩阵是 [[机器学习]] 的基础。\n\n还可参考 [[不存在的笔记]]'),
  note('c', '概率论.md', '没有链接'),
  note('d', '日记.md', '今天读了线性代数'),
];

describe('LinkIndex', () => {
  it('标题解析忽略扩展名与大小写', () => {
    expect(normalizeLinkTarget('线性代数.md')).toBe('线性代数');
    expect(normalizeLinkTarget(' Note.MD ')).toBe('note');
    const index = new LinkIndex();
    index.update(ITEMS);
    expect(index.resolve('线性代数')?.id).toBe('b');
    expect(index.resolve('概率论.md')?.id).toBe('c');
  });

  it('反向链接带上下文', () => {
    const index = new LinkIndex();
    index.update(ITEMS);
    expect(index.backlinks('b')).toEqual([
      { sourceId: 'a', sourceTitle: '机器学习', context: '入门见 线性代数，进阶见 概率。' },
    ]);
    expect(index.backlinks('a').map((l) => l.sourceId)).toEqual(['b']);
  });

  it('未解析链接与解析后的目标', () => {
    const index = new LinkIndex();
    index.update(ITEMS);
    expect([...index.unresolvedLinks()]).toEqual([['不存在的笔记', ['b']]]);
    expect(index.resolvedTargets('a').sort()).toEqual(['b', 'c']);
  });

  it('图谱：孤立节点、未创建节点与 AI 关联可选', () => {
    const index = new LinkIndex();
    index.update(ITEMS);
    const base = index.graph([], { includeOrphans: false, includeUnresolved: false });
    expect(base.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    // a↔b 双向链接只算一条边
    expect(base.edges).toHaveLength(2);

    const full = index.graph([{ sourceId: 'c', targetId: 'd' }], {
      includeOrphans: true,
      includeUnresolved: true,
    });
    expect(full.nodes.some((n) => n.type === 'unresolved')).toBe(true);
    expect(full.edges.some((e) => e.kind === 'related')).toBe(true);
  });

  it('未修改的笔记复用解析缓存', () => {
    const cache: LinkParseCache = new Map();
    const first = new LinkIndex(cache);
    first.update(ITEMS);
    const cachedLinks = cache.get('a')!.links;

    const second = new LinkIndex(cache);
    second.update(ITEMS);
    expect(cache.get('a')!.links).toBe(cachedLinks);

    const edited = [note('a', '机器学习.md', '改为链接 [[日记]]', 2), ...ITEMS.slice(1)];
    second.update(edited);
    expect(cache.get('a')!.links).not.toBe(cachedLinks);
    expect(second.backlinks('d').map((l) => l.sourceId)).toEqual(['a']);
  });

  it('删除的条目从缓存中移除', () => {
    const cache: LinkParseCache = new Map();
    const index = new LinkIndex(cache);
    index.update(ITEMS);
    index.update(ITEMS.slice(1));
    expect(cache.has('a')).toBe(false);
  });
});
