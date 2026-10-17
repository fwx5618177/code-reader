// ================================
// Agent 活动的派生数据（任务浮窗与知识库工作区共用）
// ================================

import { useMemo } from 'react';
import { TASK_LABELS, useAgentActivity, type ItemActivity } from '../../lib/agent/agentStore';
import type { TaskType } from '../../types/electron';

/** 条目当前正在执行（或即将执行）的任务名称 */
export function activeTaskLabel(activity: ItemActivity): string {
  const task =
    activity.tasks.find((t) => t.status === 'processing') ??
    activity.tasks.find((t) => t.status === 'pending');
  if (task) return TASK_LABELS[task.type];
  return activity.tasks.length === 0 ? '排队中' : 'AI 处理中';
}

/** 条目 ID → 处理活动（不含整库任务） */
export function useActivityByItem(): Map<string, ItemActivity> {
  const activities = useAgentActivity();
  return useMemo(
    () =>
      new Map(
        activities.flatMap((activity): Array<[string, ItemActivity]> =>
          activity.itemId === null ? [] : [[activity.itemId, activity]]
        )
      ),
    [activities]
  );
}

/** 整库任务（如整库自动归类）是否正在执行 */
export function useLibraryTaskRunning(): boolean {
  const activities = useAgentActivity();
  return activities.some((activity) => activity.itemId === null && activity.status === 'processing');
}

/** 是否有指定类型的任务在排队或执行 */
export function useTaskTypeRunning(type: TaskType): boolean {
  const activities = useAgentActivity();
  return activities.some((activity) =>
    activity.tasks.some((task) => task.type === type && (task.status === 'pending' || task.status === 'processing'))
  );
}
