// ================================
// 录音时长元数据：MediaRecorder 录出的 WebM 不含时长（读取为 Infinity），
// 录音结束时把已知时长写入条目 metadata.durationMs，列表优先读取
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
