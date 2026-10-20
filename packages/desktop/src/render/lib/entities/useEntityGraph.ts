// ================================
// useEntityGraph：按需加载实体图谱数据（实体、条目提及、实体关系）
// ================================

import type { EntityGraphData } from '../../types/electron';
import { useEntityQuery, type EntityQueryState } from './useEntityQuery';

const loadGraph = () => window.electron.entities.getGraph();

/**
 * @param enabled 为 false 时不加载（实体图谱未显示）
 */
export function useEntityGraph(enabled: boolean): EntityQueryState<EntityGraphData> {
  return useEntityQuery(enabled ? loadGraph : null, '实体图谱');
}
