// ================================
// Hooks 模块索引
//
// 导出所有自定义 React Hooks
// ================================

// ================================
// LaTeX 管道集成 Hooks
// ================================

export { useLatexPipeline } from './useLatexPipeline';

export type {
  LatexPipelineConfig,
  ParseState,
  FileSizeType,
  LatexPipelineResult,
} from './useLatexPipeline';

// ================================
// 滚动同步 Hooks
// ================================

export {
  useScrollSync,
  useDebouncedScrollHandler,
  useThrottledScrollHandler,
} from './useScrollSync';

export type {
  ScrollSyncSource,
  ScrollSyncMode,
  ScrollState,
  SyncResult,
  ScrollSyncConfig,
  ScrollSyncCallback,
  ScrollSyncResult,
} from './useScrollSync';

// ================================
// 主题 Hooks
// ================================

export { useTheme } from './useTheme';

// ================================
// 页面样式 Hooks
// ================================

export { usePageStyles } from './usePageStyles';
