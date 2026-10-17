// ================================
// 工作区偏好（排序、分组、布局、详情面板开关），保存在同一个 localStorage 键下
// ================================

import { GROUP_LABELS, SORT_LABELS, type GroupBy, type SortKey } from './filtering';

export type StreamLayout = 'list' | 'card';

export interface WorkspacePrefs {
  sort: SortKey;
  groupBy: GroupBy;
  layout: StreamLayout;
  inspectorOpen: boolean;
}

export const PREFS_STORAGE_KEY = 'knowledge-workspace:prefs';

export const DEFAULT_PREFS: WorkspacePrefs = {
  sort: 'updated',
  groupBy: 'none',
  layout: 'list',
  inspectorOpen: true,
};

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** 读取偏好；缺失或损坏的字段回退到默认值 */
export function loadPrefs(): WorkspacePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return {
      sort: pick(raw.sort, Object.keys(SORT_LABELS) as SortKey[], DEFAULT_PREFS.sort),
      groupBy: pick(raw.groupBy, Object.keys(GROUP_LABELS) as GroupBy[], DEFAULT_PREFS.groupBy),
      layout: pick(raw.layout, ['list', 'card'] as const, DEFAULT_PREFS.layout),
      inspectorOpen:
        typeof raw.inspectorOpen === 'boolean' ? raw.inspectorOpen : DEFAULT_PREFS.inspectorOpen,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: WorkspacePrefs): void {
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
}
