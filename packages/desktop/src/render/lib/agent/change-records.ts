// ================================
// Agent 变更记录：自动归类只生成待审阅的建议，任务结果转为可读说明，
// 在 AI 任务浮窗中保留到用户手动关闭，并提供「去审阅」入口
// ================================

import type { CategorizeResult } from '../../types/electron';

export interface ChangeDescription {
  summary: string;
  /** 本次生成的待审阅建议数；为 0 时不显示审阅入口 */
  pendingReview: number;
}

export function isCategorizeResult(value: unknown): value is CategorizeResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    (result.scope === 'item' || result.scope === 'library') &&
    typeof result.analyzedCount === 'number' &&
    typeof result.itemProposals === 'number' &&
    typeof result.tagMergeProposals === 'number'
  );
}

export function describeCategorizeResult(result: CategorizeResult): ChangeDescription {
  const scope = result.scope === 'library' ? `分析了 ${result.analyzedCount} 个条目` : '分析了该条目';
  const counts = [
    result.itemProposals > 0 ? `${result.itemProposals} 条归类建议` : '',
    result.tagMergeProposals > 0 ? `${result.tagMergeProposals} 条标签合并建议` : '',
  ].filter(Boolean);
  return {
    summary: counts.length > 0 ? `${scope}：生成 ${counts.join('、')}，待审阅` : `${scope}，没有需要调整的地方`,
    pendingReview: result.itemProposals + result.tagMergeProposals,
  };
}
