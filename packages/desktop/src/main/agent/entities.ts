// ================================
// 实体抽取：提示词、模型输出校验、实体名规范化、多段结果合并
// 纯函数模块（不访问数据库与 AI），由 extract-entities-task.ts 组合使用
// ================================

import { ENTITY_TYPES, isEntityType, type EntityType } from './entity-types';
import { isRelationType, SYMMETRIC_RELATION_TYPE, type RelationType } from './relation-types';
import { isRecord, normalizeText, parseConfidence } from './json-output';

/** 单次请求的正文片段上限；长文按段落切分后逐段抽取再合并 */
export const ENTITY_CHUNK_CHARS = 6000;
/** 实体名长度上限：更长的通常是整句而不是实体 */
const MAX_ENTITY_NAME_LENGTH = 60;
/** 关系标签长度上限：标签是简短的谓语，更长的丢弃 */
const MAX_RELATION_LABEL_LENGTH = 20;
/** 证据片段长度上限 */
const MAX_EVIDENCE_LENGTH = 200;
/** 模型未给出置信度时的默认值 */
const DEFAULT_RELATION_CONFIDENCE = 0.5;

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  mentions: number;
}

/** 实体间的一条关系：source / target 为本次抽取结果中的实体名 */
export interface ExtractedRelation {
  source: string;
  target: string;
  type: RelationType;
  label: string | null;
  /** 原文中支持该关系的片段（已确认出现在正文中） */
  evidence: string | null;
  confidence: number;
}

export const ENTITY_SYSTEM_PROMPT = `你是知识图谱构建助手。请从用户提供的文本中抽取重要的命名实体与核心概念，以及实体之间的关系。

实体类型（type）只能是：${ENTITY_TYPES.join(' / ')}
- person 人物；organization 组织/公司/机构；place 地点；concept 概念/理论/方法；
  event 事件；work 作品/书籍/论文/产品；technology 技术/工具/编程语言；other 其他

关系类型（relations[].type）只能是：
- part-of source 是 target 的组成部分；member-of source 是 target 的成员；created source 创建/提出/编写了 target；
  located-in source 位于 target；uses source 使用/基于 target；influences source 影响/启发了 target；
  related-to 其他明确的关联

要求：
1. 只抽取对理解文本有意义的实体，忽略泛泛的普通词
2. name 使用文本中最完整、最规范的写法，同一实体只出现一次
3. mentions 为该实体在文本中出现的大致次数（正整数）
4. 只抽取文本明确陈述的关系；source / target 必须与 entities 中的 name 完全一致；
   label 是简短的关系描述（如“创立”“提出”）；evidence 是原文中支持该关系的一句话，必须原样摘录；
   confidence 为 0-1 之间的置信度
5. 只返回 JSON：{"entities": [{"name": "实体名", "type": "person", "mentions": 1}], "relations": [{"source": "实体名", "target": "实体名", "type": "created", "label": "创立", "evidence": "原文句子", "confidence": 0.8}]}`;

/** 去掉实体名两侧成对的引号、书名号、括号 */
function stripWrapping(name: string): string {
  return name.replace(/^["'“”‘’《「『【(\[]+|["'“”‘’》」』】)\]]+$/g, '').trim();
}

/** 实体显示名 */
export function cleanEntityName(name: string): string {
  return stripWrapping(normalizeText(name));
}

/** 实体去重键（entities.normalized_name）：大小写不敏感，忽略包裹符号与空白差异 */
export function normalizeEntityName(name: string): string {
  return cleanEntityName(name).toLowerCase();
}

/** 校验模型返回的实体列表：缺少 entities 数组时抛出错误；未知类型归为 other，无效条目丢弃 */
export function parseEntityResponse(json: Record<string, unknown>): ExtractedEntity[] {
  if (!Array.isArray(json.entities)) {
    throw new Error('AI 实体抽取结果缺少 entities 数组');
  }
  const entities: ExtractedEntity[] = [];
  for (const entry of json.entities) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue;
    const name = cleanEntityName(entry.name);
    if (!name || name.length > MAX_ENTITY_NAME_LENGTH) continue;
    const type = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
    const mentions = typeof entry.mentions === 'number' && Number.isFinite(entry.mentions) ? Math.round(entry.mentions) : 1;
    entities.push({
      name,
      type: isEntityType(type) ? type : 'other',
      mentions: Math.max(1, mentions),
    });
  }
  return entities;
}

/**
 * 合并各片段的抽取结果：按规范化名称去重，出现次数累加；
 * 显示名取出现次数最多的写法，类型取加权票数最多的具体类型（全部为 other 时才是 other）。
 * 结果按出现次数降序
 */
export function mergeEntityChunks(chunks: ExtractedEntity[][]): ExtractedEntity[] {
  const groups = new Map<
    string,
    { names: Map<string, number>; types: Map<EntityType, number>; mentions: number; order: number }
  >();
  for (const entity of chunks.flat()) {
    const key = normalizeEntityName(entity.name);
    let group = groups.get(key);
    if (!group) {
      group = { names: new Map(), types: new Map(), mentions: 0, order: groups.size };
      groups.set(key, group);
    }
    group.mentions += entity.mentions;
    group.names.set(entity.name, (group.names.get(entity.name) ?? 0) + entity.mentions);
    group.types.set(entity.type, (group.types.get(entity.type) ?? 0) + entity.mentions);
  }

  // Map 按插入顺序迭代，取最大值时保留先出现者
  const top = <K>(counts: Map<K, number>): K =>
    [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];

  return [...groups.values()]
    .sort((a, b) => b.mentions - a.mentions || a.order - b.order)
    .map((group) => {
      const specific = new Map([...group.types].filter(([type]) => type !== 'other'));
      return {
        name: top(group.names),
        type: specific.size > 0 ? top(specific) : 'other',
        mentions: group.mentions,
      };
    });
}

export interface ExtractEntitiesResult {
  chunkCount: number;
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * 校验模型返回的实体关系：缺少 relations 视为没有关系，不是数组时抛出错误。
 * - 只保留两端都在本次 entities 中的关系（按规范化名称匹配，端点改用实体的写法），丢弃自环
 * - 未知类型归为 related-to；无方向的 related-to 按规范化名称排序端点，保证 A–B 与 B–A 去重为一条
 * - evidence 必须是正文（规范化后）的子串，否则视为模型编造而丢弃；过长的 label 丢弃
 */
export function parseRelationResponse(
  json: Record<string, unknown>,
  entities: ExtractedEntity[],
  chunk: string
): ExtractedRelation[] {
  if (json.relations === undefined) return [];
  if (!Array.isArray(json.relations)) {
    throw new Error('AI 实体抽取结果中的 relations 不是数组');
  }
  const nameByKey = new Map(entities.map((entity) => [normalizeEntityName(entity.name), entity.name]));
  const text = normalizeText(chunk);
  const relations: ExtractedRelation[] = [];
  for (const entry of json.relations) {
    if (!isRecord(entry) || typeof entry.source !== 'string' || typeof entry.target !== 'string') continue;
    let sourceKey = normalizeEntityName(entry.source);
    let targetKey = normalizeEntityName(entry.target);
    if (sourceKey === targetKey || !nameByKey.has(sourceKey) || !nameByKey.has(targetKey)) continue;

    const rawType = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
    const type = isRelationType(rawType) ? rawType : SYMMETRIC_RELATION_TYPE;
    if (type === SYMMETRIC_RELATION_TYPE && sourceKey > targetKey) {
      [sourceKey, targetKey] = [targetKey, sourceKey];
    }
    const label = typeof entry.label === 'string' ? normalizeText(entry.label) : '';
    const evidence = typeof entry.evidence === 'string' ? normalizeText(entry.evidence) : '';
    relations.push({
      source: nameByKey.get(sourceKey)!,
      target: nameByKey.get(targetKey)!,
      type,
      label: label && label.length <= MAX_RELATION_LABEL_LENGTH ? label : null,
      evidence: evidence && text.includes(evidence) ? truncate(evidence, MAX_EVIDENCE_LENGTH) : null,
      confidence: parseConfidence(entry.confidence) ?? DEFAULT_RELATION_CONFIDENCE,
    });
  }
  return relations;
}

/** 关系去重键：与 entity_relations 的唯一约束（同一来源条目内 source + target + type）一致 */
export function relationKey(relation: Pick<ExtractedRelation, 'source' | 'target' | 'type'>): string {
  return [normalizeEntityName(relation.source), normalizeEntityName(relation.target), relation.type].join('\u0000');
}

/** 合并各片段的关系：同一键只保留置信度最高的一条（置信度相同时保留先出现者），按首次出现顺序返回 */
export function mergeRelations(chunks: ExtractedRelation[][]): ExtractedRelation[] {
  const byKey = new Map<string, ExtractedRelation>();
  for (const relation of chunks.flat()) {
    const key = relationKey(relation);
    const existing = byKey.get(key);
    if (!existing || relation.confidence > existing.confidence) byKey.set(key, relation);
  }
  return [...byKey.values()];
}
