// ================================
// 版本对比内容测试
// ================================

import { describe, expect, it, vi } from 'vitest';
import type { DocumentVersion } from '../../../lib/documents/versions';
import { resolveVersionDiff } from '../diff-target';

const v = (n: number, content: string | null): DocumentVersion =>
  ({ id: `v${n}`, itemId: 'doc', versionNumber: n, content }) as DocumentVersion;

// 与历史列表一致：按版本号倒序
const versions = [v(3, '三'), v(2, '二'), v(1, null)];

const noFetch = () => vi.fn(async (): Promise<DocumentVersion | null> => null);

describe('resolveVersionDiff', () => {
  it('对比当前：版本内容 → 当前编辑内容', async () => {
    await expect(resolveVersionDiff(versions, 1, 'current', '现在', noFetch())).resolves.toEqual({
      version: versions[1],
      source: '二',
      target: '现在',
      sourceTitle: '版本 2',
      targetTitle: '当前内容',
    });
  });

  it('对比上一版：已加载时直接使用相邻条目，空内容视为空串', async () => {
    const fetchPrevious = noFetch();
    await expect(resolveVersionDiff(versions, 1, 'previous', '', fetchPrevious)).resolves.toMatchObject({
      source: '',
      target: '二',
      sourceTitle: '版本 1',
      targetTitle: '版本 2',
    });
    expect(fetchPrevious).not.toHaveBeenCalled();
  });

  it('对比上一版：上一版本尚未分页加载时按需读取', async () => {
    const loaded = [v(30, '三十'), v(29, '二十九')];
    const fetchPrevious = vi.fn(async () => v(28, '二十八'));
    await expect(resolveVersionDiff(loaded, 1, 'previous', '', fetchPrevious)).resolves.toMatchObject({
      version: loaded[1],
      source: '二十八',
      target: '二十九',
      sourceTitle: '版本 28',
      targetTitle: '版本 29',
    });
    expect(fetchPrevious).toHaveBeenCalledWith(loaded[1]);
  });

  it('上一版本不存在或索引越界时返回 null', async () => {
    await expect(resolveVersionDiff(versions, 2, 'previous', '', noFetch())).resolves.toBeNull();
    await expect(resolveVersionDiff(versions, 5, 'current', '', noFetch())).resolves.toBeNull();
  });
});
