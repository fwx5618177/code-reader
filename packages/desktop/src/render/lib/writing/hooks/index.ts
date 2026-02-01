// ================================
// 写作模块 Hooks - 公共导出
// 提供搜索高亮和编辑器搜索相关的 React Hooks
// ================================

export {
  useSearchHighlight,
  SEARCH_HIGHLIGHT_STYLES,
  type HighlightRange,
  type SearchHighlightOptions,
  type UseSearchHighlightReturn,
} from './useSearchHighlight';

export {
  useEditorSearch,
  type EditorSearchMode,
  type EditorSearchMatch,
  type GlobalSearchResult,
  type UseEditorSearchConfig,
  type UseEditorSearchReturn,
} from './useEditorSearch';
