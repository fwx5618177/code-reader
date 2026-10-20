// ================================
// AI 整理记录：自动归类生成的待审阅建议摘要，保留到用户关闭；有建议时提供「去审阅」入口
// ================================

import React from 'react';
import { ClipboardCheck, FolderTree, X } from 'lucide-react';
import { agentActivity, type ChangeRecord } from '../../lib/agent/agentStore';
import { displayTitle } from '../../lib/links/link-index';
import styles from './AgentActivity.module.scss';

export interface ChangeRecordListProps {
  records: ChangeRecord[];
  resolveTitle: (itemId: string) => string | undefined;
  onOpenItem: (itemId: string) => void;
  /** 打开知识库中的「待审阅归类」面板 */
  onReview: () => void;
}

export const ChangeRecordList: React.FC<ChangeRecordListProps> = ({ records, resolveTitle, onOpenItem, onReview }) => (
  <ul className={styles.records} aria-label="AI 整理记录">
    {records.map((record) => {
      const itemTitle = record.itemId
        ? displayTitle(resolveTitle(record.itemId) ?? '') || '未命名条目'
        : null;
      return (
        <li key={record.taskId} className={styles.record}>
          <div className={styles.recordHeader}>
            <FolderTree size={13} className={styles.headerIcon} />
            {record.itemId && itemTitle ? (
              <button
                type="button"
                className={styles.recordTitle}
                title={`打开「${itemTitle}」`}
                onClick={() => onOpenItem(record.itemId!)}
              >
                自动归类 · {itemTitle}
              </button>
            ) : (
              <span className={styles.recordTitle}>整库自动归类</span>
            )}
            <button
              type="button"
              className={styles.iconButton}
              title="关闭记录"
              onClick={() => agentActivity.dismissRecord(record.taskId)}
            >
              <X size={12} />
            </button>
          </div>
          <p className={styles.recordSummary}>{record.summary}</p>
          {record.pendingReview > 0 && (
            <button type="button" className={styles.reviewLink} onClick={onReview}>
              <ClipboardCheck size={12} />
              去审阅
            </button>
          )}
        </li>
      );
    })}
  </ul>
);
