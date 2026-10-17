// ================================
// 版本对比内容测试
// ================================

import { describe, expect, it } from 'vitest';
import type { DocumentVersion } from '../../../lib/documents/versions';
import { buildVersionDiff } from '../diff-target';

const v = (n: number, content: string | null): DocumentVersion =>
  ({ id: `v${n}`, versionNumber: n, content }) as DocumentVersion;

// 与历史列表一致：按版本号倒序
const versions = [v(3, '三'), v(2, '二'), v(1, null)];

describe('buildVersionDiff', () => {
  it('对比当前：版本内容 → 当前编辑内容', () => {
    expect(buildVersionDiff(versions, 1, 'current', '现在')).toEqual({
      version: versions[1],
      source: '二',
      target: '现在',
      sourceTitle: '版本 2',
      targetTitle: '当前内容',
    });
  });

  it('对比上一版：上一版本 → 该版本，空内容视为空串', () => {
    expect(buildVersionDiff(versions, 1, 'previous', '')).toMatchObject({
      source: '',
      target: '二',
      sourceTitle: '版本 1',
      targetTitle: '版本 2',
    });
  });

  it('上一版本未加载或索引越界时返回 null', () => {
    expect(buildVersionDiff(versions, 2, 'previous', '')).toBeNull();
    expect(buildVersionDiff(versions, 5, 'current', '')).toBeNull();
  });
});
