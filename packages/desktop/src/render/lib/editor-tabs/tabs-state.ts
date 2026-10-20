// ================================
// 写作模式标签页与分栏状态（纯逻辑）
// 一个或两个窗格，每个窗格是一组标签（文档 id）及其活动标签与视图模式（与 Obsidian 相同，每栏各自编辑或预览）。
// 标题、脏状态等展示信息由文档列表与编辑会话派生，不在此存储。
// ================================

export type PaneIndex = 0 | 1;

/** 窗格的视图模式：编辑、预览、编辑与预览并排 */
export type PaneView = 'edit' | 'preview' | 'split';

export const PANE_VIEWS: readonly PaneView[] = ['edit', 'preview', 'split'];

export interface TabGroup {
  /** 标签顺序（文档 id，不重复） */
  tabs: string[];
  /** 活动标签；为 null 表示窗格为空 */
  activeId: string | null;
  /** 视图模式（切换标签时保持） */
  view: PaneView;
}

/** 最近关闭的标签：记录所在窗格与位置，重新打开时放回原处 */
export interface ClosedTab {
  docId: string;
  pane: PaneIndex;
  index: number;
}

export interface EditorTabsState {
  /** 窗格列表：长度为 2 即处于分栏 */
  panes: TabGroup[];
  /** 聚焦窗格：接收侧边栏打开的文档，其活动标签即当前编辑的文档 */
  focusedPane: PaneIndex;
  /** 最近关闭的标签，末尾为最近一次 */
  closed: ClosedTab[];
}

export type EditorTabsAction =
  /** 在聚焦窗格中打开（已打开则激活） */
  | { type: 'open'; docId: string }
  | { type: 'activate'; pane: PaneIndex; docId: string }
  | { type: 'close'; pane: PaneIndex; docId: string }
  /** 重新打开最近关闭的标签 */
  | { type: 'reopen' }
  /** 在聚焦窗格中循环切换 */
  | { type: 'cycle'; offset: 1 | -1 }
  /** 拖动标签：同窗格内重排或移动到另一窗格；toIndex 表示插入到目标窗格中该位置的标签之前 */
  | { type: 'move'; docId: string; from: PaneIndex; to: PaneIndex; toIndex: number }
  | { type: 'focusPane'; pane: PaneIndex }
  /** 切换窗格的视图模式 */
  | { type: 'setView'; pane: PaneIndex; view: PaneView }
  /** 向右分栏：新窗格打开当前活动文档（沿用当前窗格的视图模式） */
  | { type: 'split' }
  /** 关闭分栏：两个窗格的标签合并（保留聚焦窗格的视图模式） */
  | { type: 'unsplit' }
  /** 移除已删除文档的标签（含最近关闭记录） */
  | { type: 'prune'; docIds: string[] };

export const MAX_CLOSED_TABS = 20;

export const INITIAL_EDITOR_TABS_STATE: EditorTabsState = {
  panes: [{ tabs: [], activeId: null, view: 'edit' }],
  focusedPane: 0,
  closed: [],
};

// ================================
// 选择器
// ================================

export function selectActiveDocId(state: EditorTabsState): string | null {
  return state.panes[state.focusedPane]?.activeId ?? null;
}

export function isSplitView(state: EditorTabsState): boolean {
  return state.panes.length === 2;
}

/** 状态中引用到的全部文档 id（窗格与最近关闭记录） */
export function referencedDocIds(state: EditorTabsState): string[] {
  const ids = new Set<string>();
  for (const group of state.panes) group.tabs.forEach((id) => ids.add(id));
  for (const entry of state.closed) ids.add(entry.docId);
  return [...ids];
}

// ================================
// 辅助函数
// ================================

function insertAt(list: string[], index: number, item: string): string[] {
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

function replacePane(panes: TabGroup[], index: PaneIndex, group: TabGroup): TabGroup[] {
  return panes.map((current, i) => (i === index ? group : current));
}

/** 从窗格移除标签；移除的是活动标签时激活右侧相邻标签（没有则左侧） */
function removeTab(group: TabGroup, docId: string): TabGroup {
  const index = group.tabs.indexOf(docId);
  if (index === -1) return group;
  const tabs = group.tabs.filter((id) => id !== docId);
  const activeId =
    group.activeId === docId ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : group.activeId;
  return { ...group, tabs, activeId };
}

/**
 * 规范化窗格：分栏时某个窗格已空则收起分栏，剩下的窗格获得焦点
 * （reducer 与持久化读取共用）
 */
export function normalizePanes(
  panes: TabGroup[],
  focusedPane: PaneIndex
): Pick<EditorTabsState, 'panes' | 'focusedPane'> {
  if (panes.length === 0) return { panes: INITIAL_EDITOR_TABS_STATE.panes, focusedPane: 0 };
  if (panes.length === 1) return { panes, focusedPane: 0 };
  const pair = panes.slice(0, 2);
  const emptyIndex = pair.findIndex((group) => group.tabs.length === 0);
  if (emptyIndex !== -1) return { panes: [pair[1 - emptyIndex]], focusedPane: 0 };
  return { panes: pair, focusedPane };
}

// ================================
// Reducer
// ================================

export function editorTabsReducer(
  state: EditorTabsState,
  action: EditorTabsAction
): EditorTabsState {
  switch (action.type) {
    case 'open': {
      const pane = state.focusedPane;
      const group = state.panes[pane];
      if (group.activeId === action.docId) return state;
      // 新标签插在活动标签右侧
      const tabs = group.tabs.includes(action.docId)
        ? group.tabs
        : insertAt(
            group.tabs,
            group.activeId ? group.tabs.indexOf(group.activeId) + 1 : group.tabs.length,
            action.docId
          );
      return {
        ...state,
        panes: replacePane(state.panes, pane, { ...group, tabs, activeId: action.docId }),
        closed: state.closed.filter((entry) => entry.docId !== action.docId),
      };
    }

    case 'activate': {
      const group = state.panes[action.pane];
      if (!group?.tabs.includes(action.docId)) return state;
      if (group.activeId === action.docId && state.focusedPane === action.pane) return state;
      return {
        ...state,
        panes: replacePane(state.panes, action.pane, { ...group, activeId: action.docId }),
        focusedPane: action.pane,
      };
    }

    case 'close': {
      const group = state.panes[action.pane];
      const index = group ? group.tabs.indexOf(action.docId) : -1;
      if (!group || index === -1) return state;
      const closed = [
        ...state.closed.filter(
          (entry) => !(entry.docId === action.docId && entry.pane === action.pane)
        ),
        { docId: action.docId, pane: action.pane, index },
      ].slice(-MAX_CLOSED_TABS);
      return {
        ...state,
        ...normalizePanes(
          replacePane(state.panes, action.pane, removeTab(group, action.docId)),
          state.focusedPane
        ),
        closed,
      };
    }

    case 'reopen': {
      const last = state.closed[state.closed.length - 1];
      if (!last) return state;
      // 原窗格已随分栏关闭而不存在时，放回聚焦窗格
      const pane = last.pane < state.panes.length ? last.pane : state.focusedPane;
      const group = state.panes[pane];
      const tabs = group.tabs.includes(last.docId)
        ? group.tabs
        : insertAt(group.tabs, last.index, last.docId);
      return {
        ...state,
        panes: replacePane(state.panes, pane, { ...group, tabs, activeId: last.docId }),
        focusedPane: pane,
        closed: state.closed.slice(0, -1),
      };
    }

    case 'cycle': {
      const group = state.panes[state.focusedPane];
      if (group.tabs.length < 2) return state;
      const current = group.activeId ? group.tabs.indexOf(group.activeId) : 0;
      const next = (current + action.offset + group.tabs.length) % group.tabs.length;
      return {
        ...state,
        panes: replacePane(state.panes, state.focusedPane, { ...group, activeId: group.tabs[next] }),
      };
    }

    case 'move': {
      const source = state.panes[action.from];
      const target = state.panes[action.to];
      if (!source?.tabs.includes(action.docId) || !target) return state;

      // toIndex 按移除被拖动标签之前的位置计算，若该标签原本排在插入点之前需回退一位
      const reposition = (tabs: string[]) => {
        const current = tabs.indexOf(action.docId);
        const rest = tabs.filter((id) => id !== action.docId);
        const at = current !== -1 && current < action.toIndex ? action.toIndex - 1 : action.toIndex;
        return insertAt(rest, at, action.docId);
      };

      if (action.from === action.to) {
        return {
          ...state,
          panes: replacePane(state.panes, action.to, {
            ...source,
            tabs: reposition(source.tabs),
            activeId: action.docId,
          }),
          focusedPane: action.to,
        };
      }

      const panes = replacePane(
        replacePane(state.panes, action.from, removeTab(source, action.docId)),
        action.to,
        { ...target, tabs: reposition(target.tabs), activeId: action.docId }
      );
      return { ...state, ...normalizePanes(panes, action.to) };
    }

    case 'focusPane':
      if (action.pane >= state.panes.length || action.pane === state.focusedPane) return state;
      return { ...state, focusedPane: action.pane };

    case 'setView': {
      const group = state.panes[action.pane];
      if (!group || group.view === action.view) return state;
      return { ...state, panes: replacePane(state.panes, action.pane, { ...group, view: action.view }) };
    }

    case 'split': {
      const activeId = selectActiveDocId(state);
      if (isSplitView(state) || !activeId) return state;
      return {
        ...state,
        panes: [state.panes[0], { tabs: [activeId], activeId, view: state.panes[0].view }],
        focusedPane: 1,
      };
    }

    case 'unsplit': {
      if (!isSplitView(state)) return state;
      const [first, second] = state.panes;
      return {
        ...state,
        panes: [
          {
            tabs: [...first.tabs, ...second.tabs.filter((id) => !first.tabs.includes(id))],
            // 保留聚焦窗格的活动文档与视图模式，编辑会话不因关闭分栏而切换
            activeId: selectActiveDocId(state),
            view: state.panes[state.focusedPane].view,
          },
        ],
        focusedPane: 0,
      };
    }

    case 'prune': {
      const removed = new Set(action.docIds);
      const affected =
        state.panes.some((group) => group.tabs.some((id) => removed.has(id))) ||
        state.closed.some((entry) => removed.has(entry.docId));
      if (!affected) return state;
      const panes = state.panes.map((group) => action.docIds.reduce(removeTab, group));
      return {
        ...state,
        ...normalizePanes(panes, state.focusedPane),
        closed: state.closed.filter((entry) => !removed.has(entry.docId)),
      };
    }
  }
}
