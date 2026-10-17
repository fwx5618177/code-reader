// ================================
// 整库 AI 动作按钮（自动归类、提取全部实体）：确认后提交，
// AI 不可用或没有可处理的条目时在按钮下方给出提示
// ================================

import React, { useState } from 'react';
import { Loader, Settings, X, type LucideIcon } from 'lucide-react';
import { ConfirmDialog } from '../InputDialog';
import { AI_UNAVAILABLE_HINTS, type LibraryActionResult } from '../../lib/agent/actions';
import styles from './LibraryAiButton.module.scss';

export interface LibraryAiButtonProps {
  label: string;
  icon: LucideIcon;
  /** 确认对话框的说明 */
  confirmTitle: string;
  confirmMessage: string;
  /** 没有可处理的条目时的提示 */
  emptyHint?: string;
  /** 对应任务正在执行 */
  busy: boolean;
  run: () => Promise<LibraryActionResult>;
  onOpenSettings?: () => void;
  /** 按钮样式，由所在工具栏提供 */
  className?: string;
}

type Feedback =
  | { kind: 'unavailable'; reason: keyof typeof AI_UNAVAILABLE_HINTS }
  | { kind: 'info' | 'error'; text: string };

export const LibraryAiButton: React.FC<LibraryAiButtonProps> = ({
  label,
  icon: Icon,
  confirmTitle,
  confirmMessage,
  emptyHint,
  busy,
  run,
  onOpenSettings,
  className,
}) => {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const handleConfirm = async () => {
    setConfirming(false);
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await run();
      if (result === 'nothing-to-do') setFeedback({ kind: 'info', text: emptyHint ?? '没有需要处理的条目' });
      else if (result !== 'submitted') setFeedback({ kind: 'unavailable', reason: result });
    } catch (error) {
      setFeedback({ kind: 'error', text: `提交失败：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setSubmitting(false);
    }
  };

  const working = busy || submitting;

  return (
    <span className={styles.wrapper}>
      <button
        type="button"
        className={className}
        disabled={working}
        title={working ? `${label}进行中，进度见右下角 AI 任务` : confirmMessage}
        onClick={() => setConfirming(true)}
      >
        {working ? <Loader size={13} className={styles.spin} /> : <Icon size={13} />}
        {label}
      </button>

      {feedback && (
        <div className={styles.feedback} data-kind={feedback.kind} role="status">
          <span className={styles.feedbackText}>
            {feedback.kind === 'unavailable' ? AI_UNAVAILABLE_HINTS[feedback.reason] : feedback.text}
          </span>
          {feedback.kind === 'unavailable' && onOpenSettings && (
            <button type="button" className={styles.linkButton} onClick={onOpenSettings}>
              <Settings size={12} />
              前往设置
            </button>
          )}
          <button type="button" className={styles.closeButton} title="关闭" onClick={() => setFeedback(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirming}
        title={confirmTitle}
        message={confirmMessage}
        confirmText="开始"
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirming(false)}
      />
    </span>
  );
};
