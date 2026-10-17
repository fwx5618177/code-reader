// ================================
// Entity Graph IPC Handlers
// 实体图谱查询：实体、条目-实体关联，以及关联到实体的条目（仅未删除条目）
// ================================

import { ipcMain } from 'electron';
import { getSQLiteService } from './sqlite';
import type { EntityType } from '../agent/entity-types';

interface EntityGraphData {
  entities: Array<{ id: string; name: string; type: EntityType; itemCount: number }>;
  links: Array<{ itemId: string; entityId: string; mentionCount: number }>;
  items: Array<{ id: string; title: string; type: string }>;
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
  };
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

  console.log('[Entities:IPC] Entity handlers registered');
}

export function cleanupEntityHandlers(): void {
  ipcMain.removeHandler('entities:getGraph');
  console.log('[Entities:IPC] Entity handlers cleaned up');
}
