// ================================
// 图谱数据处理测试
// ================================

import { describe, expect, it } from 'vitest';
import type { GraphData } from '../../../lib/links';
import { localGraph, matchesQuery, normalizeQuery } from '../graph-data';

const node = (id: string) => ({ id, title: id, type: 'note' as const, degree: 0 });

// a - b - c - d，a ~ e（AI 关联），f 孤立
const data: GraphData = {
  nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)),
  edges: [
    { source: 'a', target: 'b', kind: 'link' },
    { source: 'c', target: 'b', kind: 'link' },
    { source: 'c', target: 'd', kind: 'link' },
    { source: 'e', target: 'a', kind: 'related' },
  ],
};

const ids = (graph: GraphData | null) => graph?.nodes.map((n) => n.id).sort();

describe('localGraph', () => {
  it('按跳数保留邻居（双向遍历边）', () => {
    expect(ids(localGraph(data, 'a', 1))).toEqual(['a', 'b', 'e']);
    expect(ids(localGraph(data, 'a', 2))).toEqual(['a', 'b', 'c', 'e']);
    expect(ids(localGraph(data, 'a', 3))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids(localGraph(data, 'd', 1))).toEqual(['c', 'd']);
  });

  it('只保留两端都在局部图中的边', () => {
    const graph = localGraph(data, 'a', 1)!;
    expect(graph.edges).toEqual([
      { source: 'a', target: 'b', kind: 'link' },
      { source: 'e', target: 'a', kind: 'related' },
    ]);
  });

  it('孤立的焦点节点只包含自身；不在图中返回 null', () => {
    expect(localGraph(data, 'f', 2)).toEqual({ nodes: [node('f')], edges: [] });
    expect(localGraph(data, 'missing', 1)).toBeNull();
  });
});

describe('搜索匹配', () => {
  it('忽略大小写与首尾空白，空搜索词不匹配', () => {
    const q = normalizeQuery('  Graph ');
    expect(matchesQuery('Knowledge graph', q)).toBe(true);
    expect(matchesQuery('Notes', q)).toBe(false);
    expect(matchesQuery('anything', normalizeQuery('   '))).toBe(false);
  });
});
