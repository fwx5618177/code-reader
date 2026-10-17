// ================================
// 实体类型
// 无依赖的独立模块：实体抽取任务与数据库表约束（entities.type CHECK）共用同一份定义
// ================================

export const ENTITY_TYPES = [
  'person',
  'organization',
  'place',
  'concept',
  'event',
  'work',
  'technology',
  'other',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}
