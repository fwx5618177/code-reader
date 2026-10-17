// ================================
// 写作模式标签页与分栏
// ================================

export {
  editorTabsReducer,
  selectActiveDocId,
  isSplitView,
  referencedDocIds,
} from './tabs-state';
export type { PaneIndex, TabGroup, EditorTabsState, EditorTabsAction } from './tabs-state';
export { loadEditorTabsState, saveEditorTabsState } from './tabs-storage';
