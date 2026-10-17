// ================================
// 实体抽取任务（extract-entities）
// 计算阶段：长文按段落切分 → 逐段请求模型 → 校验并合并各段的实体与关系
// 写回阶段：在任务完成的同一事务中替换条目的实体关联与以该条目为来源的关系，并清理不再被引用的实体
// ================================

import { getSQLiteService } from '../database/sqlite';
import { getAIService } from '../ai/ai-service';
import type { ReportProgress, TaskOutput } from './agent-executor';
import { generateId } from './id';
import { parseJsonObject } from './json-output';
import { chunkText } from './text-chunks';
import {
  ENTITY_CHUNK_CHARS,
  ENTITY_SYSTEM_PROMPT,
  mergeEntityChunks,
  mergeRelations,
  normalizeEntityName,
  parseEntityResponse,
  parseRelationResponse,
  type ExtractEntitiesResult,
  type ExtractedEntity,
  type ExtractedRelation,
} from './entities';

export async function runExtractEntities(itemId: string, report: ReportProgress): Promise<TaskOutput> {
  const item = getSQLiteService().get<{
    title: string;
    content: string | null;
    transcript: string | null;
    summary: string | null;
  }>(`SELECT title, content, transcript, summary FROM knowledge_items WHERE id = ?`, [itemId]);
  if (!item) throw new Error('Item not found');

  // 正文与转写都参与抽取；两者皆无时退回摘要
  const text =
    [item.content, item.transcript]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join('\n\n') || item.summary?.trim();
  if (!text) throw new Error('No content for entity extraction');

  const chunks = chunkText(text, ENTITY_CHUNK_CHARS);
  const entityChunks: ExtractedEntity[][] = [];
  const relationChunks: ExtractedRelation[][] = [];
  for (const [index, chunk] of chunks.entries()) {
    report(5 + Math.round((index / chunks.length) * 80), `抽取实体（${index + 1}/${chunks.length}）...`);
    const response = await getAIService().chatCompletion({
      messages: [
        { role: 'system', content: ENTITY_SYSTEM_PROMPT },
        { role: 'user', content: `标题：${item.title}\n\n${chunk}` },
      ],
      temperature: 0.2,
    });
    const json = parseJsonObject(response.content);
    const chunkEntities = parseEntityResponse(json);
    entityChunks.push(chunkEntities);
    // 关系只在同一片段的实体之间成立，证据需出现在该片段中
    relationChunks.push(parseRelationResponse(json, chunkEntities, chunk));
  }

  const entities = mergeEntityChunks(entityChunks);
  const relations = mergeRelations(relationChunks);
  const result: ExtractEntitiesResult = { chunkCount: chunks.length, entities, relations };
  return { result, commit: () => replaceItemEntities(itemId, entities, relations) };
}

/**
 * 替换条目的实体关联与以该条目为来源的关系：实体按规范化名称复用，原类型为 other 时更新为更具体的类型；
 * 关系端点均来自本次实体集合，已由 mergeRelations 去重
 */
function replaceItemEntities(itemId: string, entities: ExtractedEntity[], relations: ExtractedRelation[]): void {
  const sqlite = getSQLiteService();
  const now = new Date().toISOString();

  const previousIds = sqlite
    .all<{ entity_id: string }>(`SELECT entity_id FROM item_entities WHERE item_id = ?`, [itemId])
    .map((row) => row.entity_id);
  sqlite.run(`DELETE FROM entity_relations WHERE item_id = ?`, [itemId]);
  sqlite.run(`DELETE FROM item_entities WHERE item_id = ?`, [itemId]);

  const entityIdByKey = new Map<string, string>();
  for (const entity of entities) {
    const normalized = normalizeEntityName(entity.name);
    sqlite.run(
      `INSERT INTO entities (id, name, type, normalized_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(normalized_name) DO UPDATE SET
         type = CASE WHEN entities.type = 'other' THEN excluded.type ELSE entities.type END,
         updated_at = excluded.updated_at`,
      [generateId(), entity.name, entity.type, normalized, now, now]
    );
    const row = sqlite.get<{ id: string }>(`SELECT id FROM entities WHERE normalized_name = ?`, [normalized])!;
    entityIdByKey.set(normalized, row.id);
    sqlite.run(
      `INSERT INTO item_entities (item_id, entity_id, mention_count, created_at) VALUES (?, ?, ?, ?)`,
      [itemId, row.id, entity.mentions, now]
    );
  }

  for (const relation of relations) {
    sqlite.run(
      `INSERT INTO entity_relations
         (id, source_entity_id, target_entity_id, relation_type, label, item_id, evidence, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId(),
        entityIdByKey.get(normalizeEntityName(relation.source))!,
        entityIdByKey.get(normalizeEntityName(relation.target))!,
        relation.type,
        relation.label,
        itemId,
        relation.evidence,
        relation.confidence,
        now,
      ]
    );
  }

  if (previousIds.length > 0) {
    sqlite.run(
      `DELETE FROM entities
       WHERE id IN (${previousIds.map(() => '?').join(', ')})
         AND NOT EXISTS (SELECT 1 FROM item_entities ie WHERE ie.entity_id = entities.id)`,
      previousIds
    );
  }
}
