// ================================
// 录音管理：录音列表、时长格式化与转写状态
// ================================

import type { KnowledgeItem } from '../../types/knowledge';
import type { ItemActivity } from '../../lib/agent/agentStore';

/** 录音条目：音频类型，按创建时间倒序（新录的在前） */
export function listRecordings(items: readonly KnowledgeItem[]): KnowledgeItem[] {
  return items
    .filter((item) => item.type === 'audio')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** 秒数 → m:ss 或 h:mm:ss */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export type TranscriptState = 'done' | 'running' | 'failed' | 'none';

export const TRANSCRIPT_LABELS: Record<TranscriptState, string> = {
  done: '已转写',
  running: '转写中',
  failed: '转写失败',
  none: '未转写',
};

/**
 * 转写状态：正在排队 / 执行的转写任务优先，其次看是否已有转写文本，
 * 最近一次转写失败或条目处理出错时为失败
 */
export function transcriptState(
  item: Pick<KnowledgeItem, 'transcript' | 'status'>,
  activity: ItemActivity | undefined
): TranscriptState {
  const task = activity?.tasks.find((t) => t.type === 'transcribe');
  if (task && (task.status === 'pending' || task.status === 'processing')) return 'running';
  if (item.transcript?.trim()) return 'done';
  if (task?.status === 'failed' || item.status === 'error') return 'failed';
  return 'none';
}
