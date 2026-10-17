// ================================
// 录音时长元数据：MediaRecorder 录出的 WebM 不含时长（读取为 Infinity），
// 录音结束时把已知时长写入条目 metadata.durationMs，列表优先读取；
// 旧录音与导入的音频没有记录时，列表读取音频文件得到时长后回填，之后不再读取文件
// ================================

import type { KnowledgeItem } from '../../types/knowledge';

/** 录音时长对应的条目 metadata 片段；时长无效时为空 */
export function durationMetadata(durationMs: number | undefined): { durationMs?: number } {
  return durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0
    ? { durationMs: Math.round(durationMs) }
    : {};
}

/** 条目 metadata 中记录的录音时长（秒）；没有记录或无效时为 null */
export function recordedDurationSeconds(item: Pick<KnowledgeItem, 'metadata'>): number | null {
  const value = item.metadata?.durationMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value / 1000 : null;
}

/**
 * 回填时长后的完整 metadata（保留其他字段）；已有记录或读取到的时长无效时为 null（无需写入）
 */
export function backfilledDurationMetadata(
  item: Pick<KnowledgeItem, 'metadata'>,
  probedSeconds: number | null
): Record<string, unknown> | null {
  if (recordedDurationSeconds(item) !== null || probedSeconds === null) return null;
  const fragment = durationMetadata(probedSeconds * 1000);
  return fragment.durationMs === undefined ? null : { ...item.metadata, ...fragment };
}
