// ================================
// Agent 活动的派生数据（任务浮窗与知识库工作区共用）
// ================================

import { useMemo } from 'react';
import { TASK_LABELS, useAgentActivity, type ItemActivity } from '../../lib/agent/agentStore';

/** 条目当前正在执行（或即将执行）的任务名称 */
export function activeTaskLabel(activity: ItemActivity): string {
  const task =
    activity.tasks.find((t) => t.status === 'processing') ??
    activity.tasks.find((t) => t.status === 'pending');
  if (task) return TASK_LABELS[task.type];
  return activity.tasks.length === 0 ? '排队中' : 'AI 处理中';
}

/** 条目 ID → 处理活动 */
export function useActivityByItem(): Map<string, ItemActivity> {
  const activities = useAgentActivity();
  return useMemo(
    () => new Map(activities.map((activity) => [activity.itemId, activity])),
    [activities]
  );
}
