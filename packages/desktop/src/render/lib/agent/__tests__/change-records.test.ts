// ================================
// 自动归类变更记录测试：任务结果校验与可读说明
// ================================

import { describe, it, expect } from 'vitest';
import { describeCategorizeResult, isCategorizeResult } from '../change-records';

describe('change-records', () => {
  it('校验任务结果结构', () => {
    expect(isCategorizeResult(null)).toBe(false);
    expect(isCategorizeResult({ moves: [] })).toBe(false);
    expect(
      isCategorizeResult({ scope: 'item', analyzedCount: 1, createdFolders: [], moves: [], tagAdditions: [], tagMerges: [] })
    ).toBe(true);
  });

  it('整库归类：汇总计数并逐条列出改动', () => {
    const description = describeCategorizeResult({
      scope: 'library',
      analyzedCount: 12,
      createdFolders: ['读书'],
      moves: [{ itemId: 'a', title: '三体笔记.md', folder: '读书' }],
      tagAdditions: [{ itemId: 'b', title: '', tags: ['AI', '机器学习'] }],
      tagMerges: [{ from: 'react', into: 'React' }],
    });
    expect(description.summary).toBe('整理了 12 个条目：移动 1 个条目，为 1 个条目添加标签，合并 1 个重复标签');
    expect(description.details).toEqual([
      '新建文件夹：读书',
      '「三体笔记」 移入「读书」',
      '「未命名条目」 添加标签 #AI #机器学习',
      '标签 #react 合并到 #React',
    ]);
  });

  it('没有改动时说明无需调整', () => {
    const description = describeCategorizeResult({
      scope: 'item',
      analyzedCount: 1,
      createdFolders: [],
      moves: [],
      tagAdditions: [],
      tagMerges: [],
    });
    expect(description).toEqual({ summary: '整理了该条目，没有需要调整的地方', details: [] });
  });
});
