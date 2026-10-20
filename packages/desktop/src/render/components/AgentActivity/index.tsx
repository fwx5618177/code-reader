// ================================
// AI 任务浮窗：右下角显示 Agent 正在处理的条目（或整个知识库）与各任务进度，以及自动归类生成的待审阅建议记录
// 没有活动且没有记录时不渲染；条目较多时使用虚拟列表
// ================================

import React, { useMemo, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { ChevronDown, Library, Sparkles } from 'lucide-react';
import { useAgentActivity, useChangeRecords, type ItemActivity } from '../../lib/agent/agentStore';
import { displayTitle } from '../../lib/links/link-index';
import type { ItemProcessingStatus, TaskStatus } from '../../types/electron';
import { StatusIcon, TaskProgressList, TASK_ROW_HEIGHT } from './TaskProgressList';
import { ChangeRecordList } from './ChangeRecordList';
import styles from './AgentActivity.module.scss';

export interface AgentActivityPanelProps {
  /** 条目 ID → 标题（条目不在当前数据中时返回 undefined） */
  resolveTitle: (itemId: string) => string | undefined;
  onOpenItem: (itemId: string) => void;
  /** 打开知识库的「待审阅归类」面板 */
  onReviewCategorization: () => void;
}

/** 与样式中 .itemButton / .row 的尺寸一致 */
const ITEM_HEADER_HEIGHT = 30;
const ROW_PADDING = 12;
const MAX_LIST_HEIGHT = 320;

const ITEM_STATUS: Record<ItemProcessingStatus, { icon: TaskStatus; text: string }> = {
  processing: { icon: 'processing', text: '处理中' },
  ready: { icon: 'completed', text: '已完成' },
  error: { icon: 'failed', text: '失败' },
};

function rowHeight(activity: ItemActivity): number {
  return ITEM_HEADER_HEIGHT + Math.max(1, activity.tasks.length) * TASK_ROW_HEIGHT + ROW_PADDING;
}

interface ActivityRowProps {
  activities: ItemActivity[];
  resolveTitle: (itemId: string) => string | undefined;
  onOpenItem: (itemId: string) => void;
}

function activityRowHeight(index: number, props: ActivityRowProps): number {
  return rowHeight(props.activities[index]);
}

function ActivityRow({
  index,
  style,
  ariaAttributes,
  activities,
  resolveTitle,
  onOpenItem,
}: RowComponentProps<ActivityRowProps>): React.ReactElement {
  const activity = activities[index];
  const status = ITEM_STATUS[activity.status];
  const itemId = activity.itemId;
  const title =
    itemId === null ? '整个知识库' : displayTitle(resolveTitle(itemId) ?? '') || '未命名条目';
  return (
    <div style={style} className={styles.row} {...ariaAttributes}>
      {itemId === null ? (
        <div className={styles.itemButton}>
          <Library size={14} className={styles.headerIcon} />
          <span className={styles.itemTitle}>{title}</span>
          <span className={styles.itemStatus} data-status={activity.status}>
            {status.text}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={styles.itemButton}
          title={`打开「${title}」`}
          onClick={() => onOpenItem(itemId)}
        >
          <StatusIcon status={status.icon} />
          <span className={styles.itemTitle}>{title}</span>
          <span className={styles.itemStatus} data-status={activity.status}>
            {status.text}
          </span>
        </button>
      )}
      {activity.tasks.length > 0 ? (
        <TaskProgressList tasks={activity.tasks} />
      ) : (
        <div className={styles.queued}>排队中…</div>
      )}
    </div>
  );
}

const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({ resolveTitle, onOpenItem, onReviewCategorization }) => {
  const activities = useAgentActivity();
  const records = useChangeRecords();
  const [expanded, setExpanded] = useState(false);

  const rowProps = useMemo(
    () => ({ activities, resolveTitle, onOpenItem }),
    [activities, resolveTitle, onOpenItem]
  );
  const listHeight = useMemo(
    () => Math.min(MAX_LIST_HEIGHT, activities.reduce((sum, a) => sum + rowHeight(a), 0)),
    [activities]
  );

  if (activities.length === 0 && records.length === 0) return null;

  const processingCount = activities.filter((a) => a.status === 'processing').length;
  const errorCount = activities.filter((a) => a.status === 'error').length;
  let summaryStatus: TaskStatus = 'completed';
  let summaryText = activities.length > 0 ? 'AI 处理完成' : 'AI 整理记录';
  if (processingCount > 0) {
    summaryStatus = 'processing';
    summaryText = 'AI 处理中';
  } else if (errorCount > 0) {
    summaryStatus = 'failed';
    summaryText = 'AI 处理失败';
  }
  const badgeCount = activities.length + records.length;

  if (!expanded) {
    return (
      <button
        type="button"
        className={styles.pill}
        aria-expanded={false}
        title="展开 AI 任务"
        onClick={() => setExpanded(true)}
      >
        <StatusIcon status={summaryStatus} />
        <span>{summaryText}</span>
        <span className={styles.badge}>{badgeCount}</span>
      </button>
    );
  }

  return (
    <section className={styles.panel} aria-label="AI 任务">
      <header className={styles.header}>
        <Sparkles size={14} className={styles.headerIcon} />
        <span className={styles.headerTitle}>AI 任务</span>
        <span className={styles.badge}>{badgeCount}</span>
        <span className={styles.headerSummary}>
          {processingCount > 0 ? `${processingCount} 个处理中` : summaryText}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          aria-expanded
          title="收起"
          onClick={() => setExpanded(false)}
        >
          <ChevronDown size={14} />
        </button>
      </header>
      {records.length > 0 && (
        <ChangeRecordList
          records={records}
          resolveTitle={resolveTitle}
          onOpenItem={onOpenItem}
          onReview={onReviewCategorization}
        />
      )}
      {activities.length > 0 && (
        <List
          className={styles.list}
          style={{ height: listHeight }}
          rowComponent={ActivityRow}
          rowCount={activities.length}
          rowHeight={activityRowHeight}
          rowProps={rowProps}
          overscanCount={2}
        />
      )}
    </section>
  );
};

export default AgentActivityPanel;
