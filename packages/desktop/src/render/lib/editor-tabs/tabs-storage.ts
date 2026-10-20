// ================================
// 标签页持久化：整体保存在 localStorage 的单个键中，读取时校验结构
// ================================

import {
  INITIAL_EDITOR_TABS_STATE,
  MAX_CLOSED_TABS,
  PANE_VIEWS,
  normalizePanes,
  type ClosedTab,
  type EditorTabsState,
  type PaneIndex,
  type PaneView,
  type TabGroup,
} from './tabs-state';

export const EDITOR_TABS_STORAGE_KEY = 'writing-editor-tabs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPaneIndex(value: unknown): value is PaneIndex {
  return value === 0 || value === 1;
}

function normalizeGroup(value: unknown): TabGroup | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
  const tabs = [
    ...new Set(value.tabs.filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  const activeId =
    typeof value.activeId === 'string' && tabs.includes(value.activeId)
      ? value.activeId
      : (tabs[0] ?? null);
  // 旧版本没有视图模式：按编辑
  const view = PANE_VIEWS.includes(value.view as PaneView) ? (value.view as PaneView) : 'edit';
  return { tabs, activeId, view };
}

function normalizeClosed(value: unknown): ClosedTab | null {
  if (!isRecord(value)) return null;
  const { docId, pane, index } = value;
  if (typeof docId !== 'string' || !isPaneIndex(pane) || typeof index !== 'number') return null;
  return { docId, pane, index: Math.max(0, Math.floor(index)) };
}

/** 校验并修正任意来源的标签状态，非法部分回退为默认值 */
export function normalizeEditorTabsState(value: unknown): EditorTabsState {
  if (!isRecord(value)) return INITIAL_EDITOR_TABS_STATE;
  const panes = Array.isArray(value.panes)
    ? value.panes.map(normalizeGroup).filter((group): group is TabGroup => group !== null)
    : [];
  const closed = Array.isArray(value.closed)
    ? value.closed
        .map(normalizeClosed)
        .filter((entry): entry is ClosedTab => entry !== null)
        .slice(-MAX_CLOSED_TABS)
    : [];
  return {
    ...normalizePanes(panes, isPaneIndex(value.focusedPane) ? value.focusedPane : 0),
    closed,
  };
}

export function loadEditorTabsState(storage: Storage = localStorage): EditorTabsState {
  try {
    const stored = storage.getItem(EDITOR_TABS_STORAGE_KEY);
    return normalizeEditorTabsState(stored ? JSON.parse(stored) : null);
  } catch {
    return INITIAL_EDITOR_TABS_STATE;
  }
}

export function saveEditorTabsState(state: EditorTabsState, storage: Storage = localStorage): void {
  storage.setItem(EDITOR_TABS_STORAGE_KEY, JSON.stringify(state));
}
