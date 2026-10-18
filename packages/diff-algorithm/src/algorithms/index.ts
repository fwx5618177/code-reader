// ================================
// 差分算法库 - 底层算法
// Histogram Diff：按行对齐（git diff --histogram），版本对比使用。
// 其他底层算法（滚动哈希、rsync、Patience、LCS、VCDIFF / BSDiff、CRDT 接口、流式差分）
// 见 @code-reader/diff-algorithm-extras
// ================================

// ================================
// Histogram Diff 算法
// Git 默认算法
// ================================

export {
  // 类
  HistogramDiffEngine,
  // 工厂函数
  createHistogramDiffEngine,
  createWhitespaceAgnosticDiffEngine,
  // 便捷函数
  quickHistogramDiff,
  quickHistogramFormatUnified,
  quickHistogramFormatHtml,
  quickLineChanges,
  resetDefaultHistogramDiffEngine,
} from './histogram-diff';

export type {
  HistogramDiffOp,
  DiffHunk,
  HistogramDiffResult,
  HistogramDiffStats,
  HistogramDiffConfig,
  LineChange,
} from './histogram-diff';
