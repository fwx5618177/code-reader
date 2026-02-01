// ================================
// 写作模块组件 - 统一导出
// 可复用的搜索框、差分查看器等 UI 组件
// ================================

// ================================
// 组件
// ================================

export { SearchBox } from './SearchBox';
export type { SearchBoxProps, SearchBoxHandle } from './SearchBox';

export { DiffViewer } from './DiffViewer';
export type { DiffViewerProps, DiffViewerHandle, DiffViewMode } from './DiffViewer';

// ================================
// 从 hooks 目录重新导出
// ================================

export { useSearchHighlight, SEARCH_HIGHLIGHT_STYLES } from '../hooks/useSearchHighlight';
export type {
  HighlightRange,
  SearchHighlightOptions,
  UseSearchHighlightReturn,
} from '../hooks/useSearchHighlight';
