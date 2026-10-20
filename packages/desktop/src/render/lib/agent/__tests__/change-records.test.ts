// ================================
// 自动归类变更记录测试：任务结果校验与可读说明
// ================================

import { describe, it, expect } from 'vitest';
import { describeCategorizeResult, isCategorizeResult } from '../change-records';

describe('change-records', () => {
  it('校验任务结果结构', () => {
    expect(isCategorizeResult(null)).toBe(false);
    // 旧版直接应用的结果结构不再识别
    expect(isCategorizeResult({ scope: 'item', analyzedCount: 1, moves: [], tagAdditions: [], tagMerges: [] })).toBe(
      false
    );
    expect(isCategorizeResult({ scope: 'item', analyzedCount: 1, itemProposals: 0, tagMergeProposals: 0 })).toBe(true);
  });

  it('整库归类：汇总生成的建议数并引导审阅', () => {
    expect(
      describeCategorizeResult({ scope: 'library', analyzedCount: 12, itemProposals: 5, tagMergeProposals: 2 })
    ).toEqual({
      summary: '分析了 12 个条目：生成 5 条归类建议、2 条标签合并建议，待审阅',
      pendingReview: 7,
    });
  });

  it('没有建议时说明无需调整', () => {
    expect(describeCategorizeResult({ scope: 'item', analyzedCount: 1, itemProposals: 0, tagMergeProposals: 0 })).toEqual({
      summary: '分析了该条目，没有需要调整的地方',
      pendingReview: 0,
    });
  });
});
