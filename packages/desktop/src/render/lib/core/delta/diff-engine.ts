// ================================
// DiffEngine - 核心差分引擎（业务层封装）
//
// 本模块是对 @code-reader/diff-algorithm 的业务层封装，提供：
// - 向后兼容的 API
// - 业务相关的便捷方法
// - 与 core 模块其他组件的集成
//
// 底层算法实现位于 @code-reader/diff-algorithm 包
// ================================

// 从底层库重新导出所有内容
export {
  // 常量
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  // 核心类
  DiffEngine,
  TextDiffEngine,
  BinaryDiffEngine,
  LevenshteinEngine,
  FuzzyMatchEngine,
  // 工厂函数
  createDiffEngine,
  createCodeDiffEngine,
  createFastDiffEngine,
  createTextDiffEngine,
  createBinaryDiffEngine,
  createLevenshteinEngine,
  createSpellCheckEngine,
  createFuzzyMatchEngine,
  createFileSearchEngine,
  createCommandSearchEngine,
  // 便捷函数
  quickDiff,
  quickApplyDiff,
  quickCreatePatch,
  quickApplyPatch,
  quickBinaryDiff,
  quickApplyBinaryDiff,
  quickDistance,
  quickSearch,
  quickSimilarity,
  quickFuzzyMatch,
  quickFuzzySearch,
  quickHighlight,
  quickSpellingSuggestions,
  resetDefaultDiffEngine,
} from '@code-reader/diff-algorithm';

// 类型导出
export type {
  // 基础类型
  DiffAlgorithm,
  DiffOpType,
  TextDiff,
  // 文本差分类型
  TextDiffResult,
  Patch,
  PatchResult,
  DiffStats,
  TextDiffConfig,
  // 二进制差分类型
  BinaryDelta,
  // 编辑距离类型
  EditOperation,
  EditStep,
  LevenshteinResult,
  LevenshteinConfig,
  // 模糊匹配类型
  MatchResult,
  SearchResultItem,
  MatchHighlight,
  FuzzyMatchConfig,
  FuzzySearchConfig,
  // 差分引擎类型
  DiffEngineConfig,
  AlgorithmHints,
  DiffOperation,
  IncrementalSaveData,
  // 接口类型
  ITextDiffAlgorithm,
  IBinaryDiffAlgorithm,
  ILevenshteinAlgorithm,
  IFuzzyMatchAlgorithm,
  IDiffEngine,
  // 扩展类型
  DeltaEfficiency,
  IncrementalDecision,
  SimilarItem,
  SpellingSuggestion,
} from '@code-reader/diff-algorithm';

// ================================
// 业务层扩展（如果需要）
// ================================

import {
  DiffEngine,
  createDiffEngine as createBaseDiffEngine,
  type TextDiff,
  type DiffStats,
  type DiffOperation,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from '@code-reader/diff-algorithm';

/**
 * 为写作模块优化的差分引擎
 *
 * 特点：
 * - 启用语义清理（合并相邻的微小差异）
 * - 启用效率清理（减少差分数量）
 * - 适合文档编辑场景
 */
export function createWritingDiffEngine(): DiffEngine {
  return createBaseDiffEngine({
    semanticCleanup: true,
    efficiencyCleanup: true,
    timeout: 1.0,
  });
}

/**
 * 为自动保存优化的差分引擎
 *
 * 特点：
 * - 快速计算
 * - 禁用语义清理（保持原始差分）
 */
export function createAutoSaveDiffEngine(): DiffEngine {
  return createBaseDiffEngine({
    semanticCleanup: false,
    efficiencyCleanup: false,
    timeout: 0.5,
  });
}

/**
 * 将差分转换为增量保存操作格式
 *
 * @param diffs 差分操作列表
 * @returns 操作列表
 */
export function diffsToOperations(diffs: readonly TextDiff[]): DiffOperation[] {
  return diffs.map(([op, value]) => ({
    type: op === DIFF_INSERT ? 'insert' : op === DIFF_DELETE ? 'delete' : 'retain',
    value: op === DIFF_EQUAL ? value.length : value,
  }));
}

/**
 * 判断差分是否值得使用增量保存
 *
 * @param stats 差分统计
 * @param threshold 变化率阈值（默认 0.5）
 * @returns 是否值得
 */
export function isIncrementalWorth(stats: DiffStats, threshold: number = 0.5): boolean {
  return stats.changeRatio < threshold;
}

/**
 * 计算差分的压缩效率
 *
 * @param stats 差分统计
 * @returns 效率指标
 */
export function getDiffEfficiency(stats: DiffStats): {
  worthIncremental: boolean;
  savings: number;
  changeRatio: number;
} {
  const worthIncremental = stats.changeRatio < 0.5;
  const savings = 1 - stats.changeRatio;

  return {
    worthIncremental,
    savings,
    changeRatio: stats.changeRatio,
  };
}

// ================================
// 默认导出
// ================================

export { DiffEngine as default } from '@code-reader/diff-algorithm';
