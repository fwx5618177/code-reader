// ================================
// 任务进度列表：状态图标、名称、进度条、错误信息
// 任务浮窗与知识库详情面板共用
// ================================

import React from 'react';
import { AlertCircle, Ban, Check, Clock, Loader2 } from 'lucide-react';
import { TASK_LABELS, type TaskActivity } from '../../lib/agent/agentStore';
import type { TaskStatus } from '../../types/electron';
import styles from './TaskProgressList.module.scss';

/** 单个任务行的高度，与样式中 .task 的高度一致（虚拟列表按此计算行高） */
export const TASK_ROW_HEIGHT = 36;

const STATUS_TEXT: Record<TaskStatus, string> = {
  pending: '等待中',
  processing: '进行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_ICONS: Record<TaskStatus, typeof Clock> = {
  pending: Clock,
  processing: Loader2,
  completed: Check,
  failed: AlertCircle,
  cancelled: Ban,
};

export const StatusIcon: React.FC<{ status: TaskStatus; size?: number }> = ({ status, size = 14 }) => {
  const Icon = STATUS_ICONS[status];
  return <Icon size={size} className={styles.statusIcon} data-status={status} aria-label={STATUS_TEXT[status]} />;
};

function clampProgress(progress: number): number {
  return Math.min(100, Math.max(0, Math.round(progress)));
}

export const TaskProgressList: React.FC<{ tasks: TaskActivity[] }> = ({ tasks }) => (
  <ul className={styles.tasks}>
    {tasks.map((task) => {
      const progress = clampProgress(task.progress);
      const detail = [task.error, task.message].filter(Boolean).join(' · ');
      return (
        <li key={task.taskId} className={styles.task} data-status={task.status}>
          <div className={styles.line}>
            <StatusIcon status={task.status} size={12} />
            <span className={styles.label}>{TASK_LABELS[task.type]}</span>
            <span className={styles.state}>
              {task.status === 'processing' ? `${progress}%` : STATUS_TEXT[task.status]}
            </span>
          </div>
          {detail ? (
            <div className={styles.detail} title={detail}>
              {detail}
            </div>
          ) : (
            <div
              className={styles.track}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={TASK_LABELS[task.type]}
            >
              <div className={styles.fill} style={{ width: `${progress}%` }} />
            </div>
          )}
        </li>
      );
    })}
  </ul>
);
