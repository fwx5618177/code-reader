// ================================
// 版本对比的两侧内容：旧 → 新
// ================================

import type { DocumentVersion } from '../../lib/documents/versions';

/** current：与当前编辑内容对比；previous：与上一个版本对比 */
export type VersionDiffMode = 'current' | 'previous';

export interface VersionDiff {
  version: DocumentVersion;
  source: string;
  target: string;
  sourceTitle: string;
  targetTitle: string;
}

const versionLabel = (version: DocumentVersion) => `版本 ${version.versionNumber}`;

/**
 * 计算对比内容；versions 按版本号倒序（与历史列表一致）。
 * 对比上一版时优先使用已加载的相邻条目，上一版本尚未分页加载时通过 fetchPrevious 按需读取；
 * 索引越界或上一版本不存在（第一版、已被清理）时返回 null
 */
export async function resolveVersionDiff(
  versions: readonly DocumentVersion[],
  index: number,
  mode: VersionDiffMode,
  currentContent: string,
  fetchPrevious: (version: DocumentVersion) => Promise<DocumentVersion | null>
): Promise<VersionDiff | null> {
  const version = versions[index];
  if (!version) return null;

  if (mode === 'current') {
    return {
      version,
      source: version.content ?? '',
      target: currentContent,
      sourceTitle: versionLabel(version),
      targetTitle: '当前内容',
    };
  }

  const previous = versions[index + 1] ?? (await fetchPrevious(version));
  if (!previous) return null;
  return {
    version,
    source: previous.content ?? '',
    target: version.content ?? '',
    sourceTitle: versionLabel(previous),
    targetTitle: versionLabel(version),
  };
}
