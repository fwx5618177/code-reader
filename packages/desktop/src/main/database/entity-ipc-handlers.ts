// ================================
// Entity Graph IPC Handlers
// 实体图谱查询：实体、条目-实体关联、实体间关系，以及关联到实体的条目（仅未删除条目）
// ================================

import { ipcMain } from 'electron';
import { getSQLiteService } from './sqlite';
import type { EntityType } from '../agent/entity-types';
import type { RelationType } from '../agent/relation-types';

interface EntityRelation {
  id: string;
  sourceEntityId: string;
  sourceName: string;
  sourceType: EntityType;
  targetEntityId: string;
  targetName: string;
  targetType: EntityType;
  type: RelationType;
  label: string | null;
  evidence: string | null;
  confidence: number;
  /** 来源条目：关系从该条目的正文中抽取 */
  itemId: string;
  itemTitle: string;
}

interface EntityGraphData {
  entities: Array<{ id: string; name: string; type: EntityType; itemCount: number }>;
  links: Array<{ itemId: string; entityId: string; mentionCount: number }>;
  items: Array<{ id: string; title: string; type: string }>;
  relations: EntityRelation[];
}

interface RelationRow {
  id: string;
  source_entity_id: string;
  source_name: string;
  source_type: EntityType;
  target_entity_id: string;
  target_name: string;
  target_type: EntityType;
  relation_type: RelationType;
  label: string | null;
  evidence: string | null;
  confidence: number;
  item_id: string;
  item_title: string;
}

/** 查询来源条目未删除的实体关系；where / orderBy 为调用方给定的固定 SQL 片段 */
function queryRelations(where: string, orderBy: string, params: unknown[]): EntityRelation[] {
  return getSQLiteService()
    .all<RelationRow>(
      `SELECT r.id, r.source_entity_id, s.name AS source_name, s.type AS source_type,
              r.target_entity_id, t.name AS target_name, t.type AS target_type,
              r.relation_type, r.label, r.evidence, r.confidence, r.item_id, k.title AS item_title
       FROM entity_relations r
       JOIN entities s ON s.id = r.source_entity_id
       JOIN entities t ON t.id = r.target_entity_id
       JOIN knowledge_items k ON k.id = r.item_id AND k.is_deleted = 0
       WHERE ${where}
       ORDER BY ${orderBy}`,
      params
    )
    .map((row) => ({
      id: row.id,
      sourceEntityId: row.source_entity_id,
      sourceName: row.source_name,
      sourceType: row.source_type,
      targetEntityId: row.target_entity_id,
      targetName: row.target_name,
      targetType: row.target_type,
      type: row.relation_type,
      label: row.label,
      evidence: row.evidence,
      confidence: row.confidence,
      itemId: row.item_id,
      itemTitle: row.item_title,
    }));
}

function getEntityGraph(): EntityGraphData {
  const sqlite = getSQLiteService();
  const entities = sqlite.all<{ id: string; name: string; type: EntityType; item_count: number }>(
    `SELECT e.id, e.name, e.type, COUNT(*) as item_count
     FROM entities e
     JOIN item_entities ie ON ie.entity_id = e.id
     JOIN knowledge_items k ON k.id = ie.item_id AND k.is_deleted = 0
     GROUP BY e.id
     ORDER BY item_count DESC, e.name ASC`
  );
  const links = sqlite.all<{ item_id: string; entity_id: string; mention_count: number }>(
    `SELECT ie.item_id, ie.entity_id, ie.mention_count
     FROM item_entities ie
     JOIN knowledge_items k ON k.id = ie.item_id AND k.is_deleted = 0`
  );
  const items = sqlite.all<{ id: string; title: string; type: string }>(
    `SELECT k.id, k.title, k.type FROM knowledge_items k
     WHERE k.is_deleted = 0 AND EXISTS (SELECT 1 FROM item_entities ie WHERE ie.item_id = k.id)`
  );
  return {
    entities: entities.map((row) => ({ id: row.id, name: row.name, type: row.type, itemCount: row.item_count })),
    links: links.map((row) => ({ itemId: row.item_id, entityId: row.entity_id, mentionCount: row.mention_count })),
    items,
    relations: queryRelations('1 = 1', 'r.confidence DESC, r.created_at ASC', []),
  };
}

/**
 * 与条目相关的实体关系：任一端是该条目提及的实体，来源可以是任意条目；
 * 本条目抽取出的关系排在前面，其余按置信度降序
 */
function getItemRelations(itemId: string): EntityRelation[] {
  return queryRelations(
    `(r.source_entity_id IN (SELECT entity_id FROM item_entities WHERE item_id = ?)
      OR r.target_entity_id IN (SELECT entity_id FROM item_entities WHERE item_id = ?))`,
    `(r.item_id = ?) DESC, r.confidence DESC, r.created_at ASC`,
    [itemId, itemId, itemId]
  );
}

export function registerEntityHandlers(): void {
  ipcMain.handle('entities:getGraph', async (): Promise<EntityGraphData> => {
    try {
      return getEntityGraph();
    } catch (error) {
      console.error('[Entities:IPC] Get graph error:', error);
      throw error;
    }
  });

  ipcMain.handle('entities:getItemRelations', async (_event, itemId: string): Promise<EntityRelation[]> => {
    try {
      return getItemRelations(itemId);
    } catch (error) {
      console.error('[Entities:IPC] Get item relations error:', error);
      throw error;
    }
  });

  console.log('[Entities:IPC] Entity handlers registered');
}

export function cleanupEntityHandlers(): void {
  ipcMain.removeHandler('entities:getGraph');
  ipcMain.removeHandler('entities:getItemRelations');
  console.log('[Entities:IPC] Entity handlers cleaned up');
}
