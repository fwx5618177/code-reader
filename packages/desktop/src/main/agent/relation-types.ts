// ================================
// 实体关系类型
// 无依赖的独立模块：实体关系抽取与数据库表约束（entity_relations.relation_type CHECK）共用同一份定义
// ================================

export const RELATION_TYPES = [
  'part-of',
  'member-of',
  'created',
  'located-in',
  'uses',
  'influences',
  'related-to',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

/** 无方向的关系类型：两端互换含义不变，存储时按规范化名称排序端点以便去重 */
export const SYMMETRIC_RELATION_TYPE: RelationType = 'related-to';

export function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}
