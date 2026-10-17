// ================================
// useEntityGraph：按需加载实体图谱数据，实体抽取任务完成后自动刷新
// ================================

import { useEffect, useState } from 'react';
import type { EntityGraphData } from '../../types/electron';
import { agentActivity } from '../agent/agentStore';

/** 批量抽取时完成事件密集，合并为一次刷新 */
const REFRESH_DEBOUNCE_MS = 800;

export interface EntityGraphState {
  data: EntityGraphData | null;
  error: string | null;
}

/**
 * @param enabled 为 false 时不加载（实体图层未显示）
 */
export function useEntityGraph(enabled: boolean): EntityGraphState {
  const [state, setState] = useState<EntityGraphState>({ data: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      window.electron.entities.getGraph().then(
        (data) => {
          if (!cancelled) setState({ data, error: null });
        },
        (error: unknown) => {
          console.error('[EntityGraph] 加载失败:', error);
          if (!cancelled) {
            setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
          }
        }
      );
    };

    load();
    const unsubscribe = agentActivity.onTaskCompleted((event) => {
      if (event.type !== 'extract-entities') return;
      clearTimeout(timer);
      timer = setTimeout(load, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled]);

  return state;
}
