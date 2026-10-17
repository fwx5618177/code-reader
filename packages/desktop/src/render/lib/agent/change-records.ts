// ================================
// Agent 变更记录：自动归类会移动条目、新建文件夹、修改标签，
// 结果转为可读的变更说明并在 AI 任务浮窗中保留到用户手动关闭，便于核对 AI 做了哪些改动
// ================================

import type { CategorizeResult } from '../../types/electron';
import { displayTitle } from '../links/link-index';

export interface ChangeDescription {
  summary: string;
  details: string[];
}

export function isCategorizeResult(value: unknown): value is CategorizeResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    Array.isArray(result.createdFolders) &&
    Array.isArray(result.moves) &&
    Array.isArray(result.tagAdditions) &&
    Array.isArray(result.tagMerges)
  );
}

const titleOf = (title: string) => `「${displayTitle(title) || '未命名条目'}」`;

export function describeCategorizeResult(result: CategorizeResult): ChangeDescription {
  const details = [
    ...(result.createdFolders.length > 0 ? [`新建文件夹：${result.createdFolders.join('、')}`] : []),
    ...result.moves.map((move) => `${titleOf(move.title)} 移入「${move.folder}」`),
    ...result.tagAdditions.map(
      (addition) => `${titleOf(addition.title)} 添加标签 ${addition.tags.map((tag) => `#${tag}`).join(' ')}`
    ),
    ...result.tagMerges.map((merge) => `标签 #${merge.from} 合并到 #${merge.into}`),
  ];
  const scope = result.scope === 'library' ? `整理了 ${result.analyzedCount} 个条目` : '整理了该条目';
  const counts = [
    result.moves.length > 0 ? `移动 ${result.moves.length} 个条目` : '',
    result.tagAdditions.length > 0 ? `为 ${result.tagAdditions.length} 个条目添加标签` : '',
    result.tagMerges.length > 0 ? `合并 ${result.tagMerges.length} 个重复标签` : '',
  ].filter(Boolean);
  return {
    summary: counts.length > 0 ? `${scope}：${counts.join('，')}` : `${scope}，没有需要调整的地方`,
    details,
  };
}
