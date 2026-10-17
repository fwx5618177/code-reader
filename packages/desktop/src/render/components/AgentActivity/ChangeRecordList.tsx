// ================================
// AI 整理记录：自动归类实际做出的改动（新建文件夹、移动条目、添加 / 合并标签），保留到用户关闭
// ================================

import React from 'react';
import { FolderTree, X } from 'lucide-react';
import { agentActivity, type ChangeRecord } from '../../lib/agent/agentStore';
import { displayTitle } from '../../lib/links/link-index';
import styles from './AgentActivity.module.scss';

export interface ChangeRecordListProps {
  records: ChangeRecord[];
  resolveTitle: (itemId: string) => string | undefined;
  onOpenItem: (itemId: string) => void;
}

export const ChangeRecordList: React.FC<ChangeRecordListProps> = ({ records, resolveTitle, onOpenItem }) => (
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
          {record.details.length > 0 && (
            <ul className={styles.recordDetails}>
              {record.details.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </li>
      );
    })}
  </ul>
);
