// ================================
// useEditorTabs
// 写作模式的标签页与分栏
//
// 编辑会话说明：useDocuments 只维护一个编辑会话（一个文档的内容、脏状态与自动保存），
// 切换文档时先保存再加载。标签页不另建会话，而是让"聚焦窗格的活动标签"驱动这个唯一会话：
// - 标签 → 会话：活动标签变化时切换会话文档（切换前由 useDocuments 保存，不会丢失编辑）
// - 会话 → 标签：会话被其他途径切换（如新建文档）时，在聚焦窗格中打开对应标签
// 因此只有会话文档可能有未保存的修改，其余标签的内容都已落盘。
// ================================

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  editorTabsReducer,
  isSplitView,
  loadEditorTabsState,
  referencedDocIds,
  saveEditorTabsState,
  selectActiveDocId,
  type EditorTabsAction,
  type PaneIndex,
  type TabGroup,
} from '../lib/editor-tabs';
import { PLACEHOLDERS, type Document, type DocumentListItem } from '../lib/documents';
import { displayTitle } from '../lib/links';

export interface UseEditorTabsOptions {
  /** 文档列表（标签标题来源，也用于发现被删除的文档） */
  documents: DocumentListItem[];
  /** 文档列表是否已完成首次加载 */
  isInitialized: boolean;
  /** 编辑会话的文档 id 与文档（文档内容随编辑实时更新） */
  sessionDocId: string | null;
  sessionDocument: Document | null;
  /** 编辑会话是否有未保存的修改 */
  isDirty: boolean;
  /** 切换编辑会话（会先保存当前文档） */
  selectSessionDocument: (id: string) => Promise<void>;
  /** 立即保存编辑会话 */
  saveSessionDocument: () => Promise<boolean>;
  refreshList: () => Promise<void>;
  /** 是否响应标签快捷键（写作模式且不在专注模式） */
  shortcutsEnabled: boolean;
  onError: (message: string) => void;
}

export interface EditorTabsController {
  panes: TabGroup[];
  focusedPane: PaneIndex;
  isSplit: boolean;
  /** 聚焦窗格的活动文档，即当前编辑的文档 */
  activeDocId: string | null;
  canReopen: boolean;
  getTitle: (docId: string) => string;
  isTabDirty: (docId: string) => boolean;
  /** 在聚焦窗格中打开文档（所有"打开文档"入口共用） */
  openDocument: (docId: string) => Promise<void>;
  activateTab: (pane: PaneIndex, docId: string) => void;
  /** 关闭标签；关闭有未保存修改的文档前先保存，保存失败则不关闭 */
  closeTab: (pane: PaneIndex, docId: string) => Promise<void>;
  moveTab: (docId: string, from: PaneIndex, to: PaneIndex, toIndex: number) => void;
  focusPane: (pane: PaneIndex) => void;
  toggleSplit: () => void;
  reopenClosedTab: () => void;
}

export function useEditorTabs({
  documents,
  isInitialized,
  sessionDocId,
  sessionDocument,
  isDirty,
  selectSessionDocument,
  saveSessionDocument,
  refreshList,
  shortcutsEnabled,
  onError,
}: UseEditorTabsOptions): EditorTabsController {
  const [state, dispatch] = useReducer(editorTabsReducer, undefined, loadEditorTabsState);
  const activeDocId = selectActiveDocId(state);
  const isSplit = isSplitView(state);

  useEffect(() => {
    saveEditorTabsState(state);
  }, [state]);

  // 上一次同步时的活动标签与会话文档；为 null 表示尚未从持久化状态恢复
  const syncRef = useRef<{ active: string | null; session: string | null } | null>(null);
  // 上一次看到的文档 id，用于发现被删除的文档
  const knownDocIdsRef = useRef<Set<string>>(new Set());

  // 文档从列表中消失（被删除）时关闭其标签
  useEffect(() => {
    const current = new Set(documents.map((doc) => doc.id));
    const removed = [...knownDocIdsRef.current].filter((id) => !current.has(id));
    knownDocIdsRef.current = current;
    if (syncRef.current && removed.length > 0) dispatch({ type: 'prune', docIds: removed });
  }, [documents]);

  // 标签与会话双向同步：只响应各自的变化，避免两者互相覆盖
  useEffect(() => {
    const previous = syncRef.current;
    if (!previous) return;
    syncRef.current = { active: activeDocId, session: sessionDocId };
    if (activeDocId !== previous.active) {
      if (activeDocId && activeDocId !== sessionDocId) void selectSessionDocument(activeDocId);
    } else if (sessionDocId !== previous.session && sessionDocId && sessionDocId !== activeDocId) {
      dispatch({ type: 'open', docId: sessionDocId });
    }
  }, [activeDocId, sessionDocId, selectSessionDocument]);

  // 文档列表首次加载后恢复：剔除已删除文档的标签，会话跟随恢复的活动标签；
  // 没有任何标签时（首次使用）把会话文档作为第一个标签
  useEffect(() => {
    if (!isInitialized || syncRef.current) return;
    const existing = new Set(documents.map((doc) => doc.id));
    knownDocIdsRef.current = existing;
    const prune: EditorTabsAction = {
      type: 'prune',
      docIds: referencedDocIds(state).filter((id) => !existing.has(id)),
    };
    dispatch(prune);
    const restoredActive = selectActiveDocId(editorTabsReducer(state, prune));
    if (restoredActive) {
      if (restoredActive !== sessionDocId) void selectSessionDocument(restoredActive);
    } else if (sessionDocId) {
      dispatch({ type: 'open', docId: sessionDocId });
    }
    syncRef.current = { active: restoredActive ?? sessionDocId, session: sessionDocId };
  }, [isInitialized, documents, state, sessionDocId, selectSessionDocument]);

  const titles = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc.title])),
    [documents]
  );
  // 会话文档的标题随编辑实时变化，其余文档取列表中的标题（重命名后列表刷新即更新）
  const sessionTitleId = sessionDocument?.id;
  const sessionTitle = sessionDocument?.title;
  const getTitle = useCallback(
    (docId: string) => {
      const title = docId === sessionTitleId ? sessionTitle : titles.get(docId);
      return displayTitle(title ?? '') || PLACEHOLDERS.TITLE;
    },
    [titles, sessionTitleId, sessionTitle]
  );

  const isTabDirty = useCallback(
    (docId: string) => isDirty && docId === sessionDocId,
    [isDirty, sessionDocId]
  );

  const openDocument = useCallback(
    async (docId: string) => {
      dispatch({ type: 'open', docId });
      // 不在列表中的文档（如刚在知识库中创建的笔记）刷新列表后才有标题
      if (isInitialized && !titles.has(docId)) await refreshList();
    },
    [isInitialized, titles, refreshList]
  );

  const closeTab = useCallback(
    async (pane: PaneIndex, docId: string) => {
      if (docId === sessionDocId && isDirty && !(await saveSessionDocument())) {
        onError('保存失败，标签未关闭');
        return;
      }
      dispatch({ type: 'close', pane, docId });
    },
    [sessionDocId, isDirty, saveSessionDocument, onError]
  );

  const activateTab = useCallback((pane: PaneIndex, docId: string) => {
    dispatch({ type: 'activate', pane, docId });
  }, []);

  const moveTab = useCallback((docId: string, from: PaneIndex, to: PaneIndex, toIndex: number) => {
    dispatch({ type: 'move', docId, from, to, toIndex });
  }, []);

  const focusPane = useCallback((pane: PaneIndex) => {
    dispatch({ type: 'focusPane', pane });
  }, []);

  const toggleSplit = useCallback(() => {
    dispatch({ type: isSplit ? 'unsplit' : 'split' });
  }, [isSplit]);

  const reopenClosedTab = useCallback(() => {
    dispatch({ type: 'reopen' });
  }, []);

  // 快捷键：⌘W 关闭、⌘⇧T 重新打开、⌃Tab / ⌃⇧Tab 切换、⌘\ 分栏
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && key === 'tab') {
        e.preventDefault();
        dispatch({ type: 'cycle', offset: e.shiftKey ? -1 : 1 });
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      // 没有打开的标签时不拦截 ⌘W，保留关闭窗口的默认行为
      if (key === 'w' && !e.shiftKey && activeDocId) {
        e.preventDefault();
        void closeTab(state.focusedPane, activeDocId);
      } else if (key === 't' && e.shiftKey) {
        e.preventDefault();
        reopenClosedTab();
      } else if (key === '\\') {
        e.preventDefault();
        toggleSplit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutsEnabled, activeDocId, state.focusedPane, closeTab, reopenClosedTab, toggleSplit]);

  return {
    panes: state.panes,
    focusedPane: state.focusedPane,
    isSplit,
    activeDocId,
    canReopen: state.closed.length > 0,
    getTitle,
    isTabDirty,
    openDocument,
    activateTab,
    closeTab,
    moveTab,
    focusPane,
    toggleSplit,
    reopenClosedTab,
  };
}
