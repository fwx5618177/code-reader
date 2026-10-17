// ================================
// 实体图谱数据：把主进程返回的实体 / 条目 / 关联转换为图谱组件使用的 GraphData
// ================================

import type { EntityGraphData, EntityType } from '../../types/electron';
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

/** 实体节点 ID 前缀，避免与条目 ID 冲突 */
const ENTITY_NODE_PREFIX = 'entity:';

export function entityNodeId(entityId: string): string {
  return `${ENTITY_NODE_PREFIX}${entityId}`;
}

/** 图谱节点 ID → 实体 ID（不是实体节点时返回 null） */
export function entityIdOfNode(nodeId: string): string | null {
  return nodeId.startsWith(ENTITY_NODE_PREFIX) ? nodeId.slice(ENTITY_NODE_PREFIX.length) : null;
}

/**
 * 构建「条目 - 实体」二部图
 * @param sharedOnly 只保留关联到至少两个条目的实体（这些实体才把条目连接起来）
 */
export function buildEntityGraph(data: EntityGraphData, sharedOnly: boolean): GraphData {
  const entities = sharedOnly ? data.entities.filter((entity) => entity.itemCount >= 2) : data.entities;
  const entityIds = new Set(entities.map((entity) => entity.id));
  const links = data.links.filter((link) => entityIds.has(link.entityId));

  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  const edges: GraphEdge[] = links.map((link) => {
    const target = entityNodeId(link.entityId);
    bump(link.itemId);
    bump(target);
    return { source: link.itemId, target, kind: 'link' };
  });

  const nodes: GraphNode[] = [
    ...data.items
      .filter((item) => degree.has(item.id))
      .map((item) => ({ id: item.id, title: item.title, type: item.type, degree: degree.get(item.id)! })),
    ...entities.map((entity) => {
      const id = entityNodeId(entity.id);
      return { id, title: entity.name, type: 'entity' as const, degree: degree.get(id) ?? 0 };
    }),
  ];
  return { nodes, edges };
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
