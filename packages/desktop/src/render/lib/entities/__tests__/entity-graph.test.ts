// ================================
// 实体图谱数据转换测试
// ================================

import { describe, it, expect } from 'vitest';
import type { EntityGraphData, EntityRelation } from '../../../types/electron';
import {
  buildEntityGraph,
  entityIdOfNode,
  entityNodeId,
  itemsOfEntity,
  relationLabel,
  relationsOfEntity,
} from '../entity-graph';

const relation = (
  id: string,
  source: string,
  target: string,
  overrides: Partial<EntityRelation> = {}
): EntityRelation => ({
  id,
  sourceEntityId: source,
  sourceName: source,
  sourceType: 'other',
  targetEntityId: target,
  targetName: target,
  targetType: 'other',
  type: 'uses',
  label: null,
  evidence: null,
  confidence: 0.5,
  itemId: 'a',
  itemTitle: 'A',
  ...overrides,
});

const data: EntityGraphData = {
  entities: [
    { id: 'e1', name: 'OpenAI', type: 'organization', itemCount: 2 },
    { id: 'e2', name: '张三', type: 'person', itemCount: 1 },
    { id: 'e3', name: 'GPT', type: 'work', itemCount: 2 },
  ],
  links: [
    { itemId: 'a', entityId: 'e1', mentionCount: 2 },
    { itemId: 'b', entityId: 'e1', mentionCount: 5 },
    { itemId: 'c', entityId: 'e2', mentionCount: 1 },
    { itemId: 'a', entityId: 'e3', mentionCount: 1 },
    { itemId: 'b', entityId: 'e3', mentionCount: 1 },
  ],
  items: [
    { id: 'a', title: 'A', type: 'note' },
    { id: 'b', title: 'B', type: 'webpage' },
    { id: 'c', title: 'C', type: 'audio' },
  ],
  relations: [
    relation('r1', 'e1', 'e3', { type: 'created', label: '发布', confidence: 0.6 }),
    // 同一对实体的反向 / 其他类型关系只画一条连线
    relation('r2', 'e3', 'e1', { type: 'related-to', confidence: 0.9, itemId: 'b', itemTitle: 'B' }),
    relation('r3', 'e2', 'e1', { type: 'member-of' }),
  ],
};

describe('buildEntityGraph', () => {
  it('实体图谱：关系为实线且每对实体一条，不显示条目', () => {
    const graph = buildEntityGraph(data, { sharedOnly: false, showItems: false });
    expect(graph.nodes).toEqual([
      { id: 'entity:e1', title: 'OpenAI', type: 'entity', degree: 2 },
      { id: 'entity:e2', title: '张三', type: 'entity', degree: 1 },
      { id: 'entity:e3', title: 'GPT', type: 'entity', degree: 1 },
    ]);
    expect(graph.edges).toEqual([
      { source: 'entity:e1', target: 'entity:e3', kind: 'link' },
      { source: 'entity:e2', target: 'entity:e1', kind: 'link' },
    ]);
  });

  it('显示来源条目时加入条目节点，提及为虚线', () => {
    const graph = buildEntityGraph(data, { sharedOnly: false, showItems: true });
    expect(graph.nodes.slice(0, 3)).toEqual([
      { id: 'a', title: 'A', type: 'note', degree: 2 },
      { id: 'b', title: 'B', type: 'webpage', degree: 2 },
      { id: 'c', title: 'C', type: 'audio', degree: 1 },
    ]);
    expect(graph.edges).toContainEqual({ source: 'a', target: 'entity:e1', kind: 'related' });
    expect(graph.edges.filter((edge) => edge.kind === 'related')).toHaveLength(5);
  });

  it('只看共享实体时，去掉只关联一个条目的实体及其关系和因此孤立的条目', () => {
    const graph = buildEntityGraph(data, { sharedOnly: true, showItems: true });
    expect(graph.nodes.map((node) => node.id)).toEqual(['a', 'b', 'entity:e1', 'entity:e3']);
    expect(graph.edges).toHaveLength(5);
  });
});

describe('实体关系', () => {
  it('涉及实体的关系按置信度降序；显示名优先用标签', () => {
    expect(relationsOfEntity(data, 'e1').map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
    expect(relationsOfEntity(data, 'e2').map((r) => r.id)).toEqual(['r3']);
    expect(relationLabel(data.relations[0])).toBe('发布');
    expect(relationLabel(data.relations[2])).toBe('成员');
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
