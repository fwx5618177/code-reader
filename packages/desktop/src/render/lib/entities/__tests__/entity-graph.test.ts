// ================================
// 实体图谱数据转换测试
// ================================

import { describe, it, expect } from 'vitest';
import type { EntityGraphData } from '../../../types/electron';
import { buildEntityGraph, entityIdOfNode, entityNodeId, itemsOfEntity } from '../entity-graph';

const data: EntityGraphData = {
  entities: [
    { id: 'e1', name: 'OpenAI', type: 'organization', itemCount: 2 },
    { id: 'e2', name: '张三', type: 'person', itemCount: 1 },
  ],
  links: [
    { itemId: 'a', entityId: 'e1', mentionCount: 2 },
    { itemId: 'b', entityId: 'e1', mentionCount: 5 },
    { itemId: 'c', entityId: 'e2', mentionCount: 1 },
  ],
  items: [
    { id: 'a', title: 'A', type: 'note' },
    { id: 'b', title: 'B', type: 'webpage' },
    { id: 'c', title: 'C', type: 'audio' },
  ],
};

describe('buildEntityGraph', () => {
  it('构建条目 - 实体二部图，度数来自关联数', () => {
    const graph = buildEntityGraph(data, false);
    expect(graph.nodes).toEqual([
      { id: 'a', title: 'A', type: 'note', degree: 1 },
      { id: 'b', title: 'B', type: 'webpage', degree: 1 },
      { id: 'c', title: 'C', type: 'audio', degree: 1 },
      { id: 'entity:e1', title: 'OpenAI', type: 'entity', degree: 2 },
      { id: 'entity:e2', title: '张三', type: 'entity', degree: 1 },
    ]);
    expect(graph.edges).toContainEqual({ source: 'a', target: 'entity:e1', kind: 'link' });
  });

  it('只看共享实体时，去掉只关联一个条目的实体及因此孤立的条目', () => {
    const graph = buildEntityGraph(data, true);
    expect(graph.nodes.map((node) => node.id)).toEqual(['a', 'b', 'entity:e1']);
    expect(graph.edges).toHaveLength(2);
  });
});

describe('实体节点 ID 与相关条目', () => {
  it('节点 ID 往返转换', () => {
    expect(entityIdOfNode(entityNodeId('e1'))).toBe('e1');
    expect(entityIdOfNode('a')).toBeNull();
  });

  it('相关条目按提及次数降序', () => {
    expect(itemsOfEntity(data, 'e1').map((item) => [item.id, item.mentionCount])).toEqual([
      ['b', 5],
      ['a', 2],
    ]);
    expect(itemsOfEntity(data, 'missing')).toEqual([]);
  });
});
