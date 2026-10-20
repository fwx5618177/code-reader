// ================================
// useEntityQuery：按需加载实体相关数据（图谱 / 条目的实体关系），实体抽取任务完成后自动刷新
// ================================

import { useEffect, useState } from 'react';
import { agentActivity } from '../agent/agentStore';

/** 批量抽取时完成事件密集，合并为一次刷新 */
const REFRESH_DEBOUNCE_MS = 800;

export interface EntityQueryState<T> {
  data: T | null;
  error: string | null;
}

/**
 * @param load 加载函数，需保持引用稳定；为 null 时不加载。函数变化（如切换条目）时清空旧数据重新加载
 * @param label 日志中的数据名称
 */
export function useEntityQuery<T>(load: (() => Promise<T>) | null, label: string): EntityQueryState<T> {
  const [state, setState] = useState<EntityQueryState<T>>({ data: null, error: null });

  useEffect(() => {
    setState({ data: null, error: null });
    if (!load) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      load().then(
        (data) => {
          if (!cancelled) setState({ data, error: null });
        },
        (error: unknown) => {
          console.error(`[Entities] ${label}加载失败:`, error);
          if (!cancelled) {
            setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
          }
        }
      );
    };

    refresh();
    // 任一条目的抽取都可能改变共享实体的关系，因此不限定条目
    const unsubscribe = agentActivity.onTaskCompleted((event) => {
      if (event.type !== 'extract-entities') return;
      clearTimeout(timer);
      timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [load, label]);

  return state;
}
