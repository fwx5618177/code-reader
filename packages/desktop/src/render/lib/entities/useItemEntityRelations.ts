// ================================
// useItemEntityRelations：条目提及的实体所涉及的关系（含其他条目抽取出的关系）
// ================================

import { useCallback } from 'react';
import type { EntityRelation } from '../../types/electron';
import { useEntityQuery, type EntityQueryState } from './useEntityQuery';

export function useItemEntityRelations(itemId: string): EntityQueryState<EntityRelation[]> {
  const load = useCallback(() => window.electron.entities.getItemRelations(itemId), [itemId]);
  return useEntityQuery(load, '条目实体关系');
}
