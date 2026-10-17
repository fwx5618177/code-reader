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
 * 计算对比内容；versions 按版本号倒序（与历史列表一致）
 * 上一版本不在已加载列表中时返回 null
 */
export function buildVersionDiff(
  versions: readonly DocumentVersion[],
  index: number,
  mode: VersionDiffMode,
  currentContent: string
): VersionDiff | null {
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

  const previous = versions[index + 1];
  if (!previous) return null;
  return {
    version,
    source: previous.content ?? '',
    target: version.content ?? '',
    sourceTitle: versionLabel(previous),
    targetTitle: versionLabel(version),
  };
}
