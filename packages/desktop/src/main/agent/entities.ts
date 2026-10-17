// ================================
// 实体抽取：提示词、模型输出校验、实体名规范化、多段结果合并
// 纯函数模块（不访问数据库与 AI），由 extract-entities-task.ts 组合使用
// ================================

import { ENTITY_TYPES, isEntityType, type EntityType } from './entity-types';
import { isRecord, normalizeText } from './json-output';

/** 单次请求的正文片段上限；长文按段落切分后逐段抽取再合并 */
export const ENTITY_CHUNK_CHARS = 6000;
/** 实体名长度上限：更长的通常是整句而不是实体 */
const MAX_ENTITY_NAME_LENGTH = 60;

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  mentions: number;
}

export const ENTITY_SYSTEM_PROMPT = `你是知识图谱构建助手。请从用户提供的文本中抽取重要的命名实体与核心概念。

实体类型（type）只能是：${ENTITY_TYPES.join(' / ')}
- person 人物；organization 组织/公司/机构；place 地点；concept 概念/理论/方法；
  event 事件；work 作品/书籍/论文/产品；technology 技术/工具/编程语言；other 其他

要求：
1. 只抽取对理解文本有意义的实体，忽略泛泛的普通词
2. name 使用文本中最完整、最规范的写法，同一实体只出现一次
3. mentions 为该实体在文本中出现的大致次数（正整数）
4. 只返回 JSON：{"entities": [{"name": "实体名", "type": "person", "mentions": 1}]}`;

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
}
