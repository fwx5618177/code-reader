// ================================
// 实体图谱数据：把主进程返回的实体 / 条目 / 提及 / 关系转换为图谱组件使用的 GraphData
// ================================

import type { EntityGraphData, EntityRelation, EntityType, RelationType } from '../../types/electron';
import type { GraphData, GraphEdge, GraphNode } from '../links';

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: '人物',
  organization: '组织',
  place: '地点',
  concept: '概念',
  event: '事件',
  work: '作品',
  technology: '技术',
  other: '其他',
};

export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  'part-of': '属于',
  'member-of': '成员',
  created: '创建',
  'located-in': '位于',
  uses: '使用',
  influences: '影响',
  'related-to': '相关',
};

/** 关系的显示名称：优先使用模型给出的标签 */
export function relationLabel(relation: Pick<EntityRelation, 'type' | 'label'>): string {
  return relation.label || RELATION_TYPE_LABELS[relation.type];
}

/** 实体节点 ID 前缀，避免与条目 ID 冲突 */
const ENTITY_NODE_PREFIX = 'entity:';

export function entityNodeId(entityId: string): string {
  return `${ENTITY_NODE_PREFIX}${entityId}`;
}

/** 图谱节点 ID → 实体 ID（不是实体节点时返回 null） */
export function entityIdOfNode(nodeId: string): string | null {
  return nodeId.startsWith(ENTITY_NODE_PREFIX) ? nodeId.slice(ENTITY_NODE_PREFIX.length) : null;
}

export interface EntityGraphOptions {
  /** 只保留关联到至少两个条目的实体（这些实体才把条目连接起来） */
  sharedOnly: boolean;
  /** 显示来源条目节点及条目对实体的提及连线 */
  showItems: boolean;
}

/**
 * 构建实体图谱：实体关系为实线（同一对实体的多条关系合并为一条连线），
 * 显示来源条目时加入条目节点，条目对实体的提及为虚线
 */
export function buildEntityGraph(data: EntityGraphData, options: EntityGraphOptions): GraphData {
  const entities = options.sharedOnly ? data.entities.filter((entity) => entity.itemCount >= 2) : data.entities;
  const entityIds = new Set(entities.map((entity) => entity.id));

  const degree = new Map<string, number>();
  const edges: GraphEdge[] = [];
  const addEdge = (source: string, target: string, kind: GraphEdge['kind']) => {
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
    edges.push({ source, target, kind });
  };

  const pairs = new Set<string>();
  for (const relation of data.relations) {
    if (!entityIds.has(relation.sourceEntityId) || !entityIds.has(relation.targetEntityId)) continue;
    const pair = [relation.sourceEntityId, relation.targetEntityId].sort().join('\u0000');
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    addEdge(entityNodeId(relation.sourceEntityId), entityNodeId(relation.targetEntityId), 'link');
  }

  if (options.showItems) {
    for (const link of data.links) {
      if (entityIds.has(link.entityId)) addEdge(link.itemId, entityNodeId(link.entityId), 'related');
    }
  }

  const nodes: GraphNode[] = [
    ...(options.showItems ? data.items : [])
      .filter((item) => degree.has(item.id))
      .map((item) => ({ id: item.id, title: item.title, type: item.type, degree: degree.get(item.id)! })),
    ...entities.map((entity) => {
      const id = entityNodeId(entity.id);
      return { id, title: entity.name, type: 'entity' as const, degree: degree.get(id) ?? 0 };
    }),
  ];
  return { nodes, edges };
}

/** 涉及实体的关系（任一端），按置信度降序 */
export function relationsOfEntity(data: EntityGraphData, entityId: string): EntityRelation[] {
  return data.relations
    .filter((relation) => relation.sourceEntityId === entityId || relation.targetEntityId === entityId)
    .sort((a, b) => b.confidence - a.confidence);
}

/** 与实体关联的条目，按提及次数降序 */
export function itemsOfEntity(
  data: EntityGraphData,
  entityId: string
): Array<EntityGraphData['items'][number] & { mentionCount: number }> {
  const itemsById = new Map(data.items.map((item) => [item.id, item]));
  return data.links
    .filter((link) => link.entityId === entityId)
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .flatMap((link) => {
      const item = itemsById.get(link.itemId);
      return item ? [{ ...item, mentionCount: link.mentionCount }] : [];
    });
}
