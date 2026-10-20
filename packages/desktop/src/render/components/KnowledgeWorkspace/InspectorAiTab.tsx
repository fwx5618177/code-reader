// ================================
// 详情面板「AI 解读」：处理进度、摘要、要点，以及重新处理入口
// ================================

import React, { useState } from 'react';
import { AlertCircle, FolderTree, Network, Settings, Sparkles } from 'lucide-react';
import type { KnowledgeItem } from '../../types/knowledge';
import type { ItemActivity } from '../../lib/agent/agentStore';
import {
  requestProcessing,
  type AiUnavailableReason,
  type ProcessingRequestResult,
} from '../../lib/knowledge/service';
import { AI_UNAVAILABLE_HINTS, requestItemTask } from '../../lib/agent/actions';
import { TaskProgressList } from '../AgentActivity/TaskProgressList';
import { activeTaskLabel } from '../AgentActivity/activity';
import styles from './Inspector.module.scss';

export interface InspectorAiTabProps {
  item: KnowledgeItem;
  activity?: ItemActivity;
  onOpenSettings: () => void;
}

export const InspectorAiTab: React.FC<InspectorAiTabProps> = ({ item, activity, onOpenSettings }) => {
  const [submitting, setSubmitting] = useState(false);
  const [rejected, setRejected] = useState<AiUnavailableReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = activity?.status ?? item.status;
  const processing = status === 'processing';
  const keyPoints = item.keyPoints?.filter((point) => point.trim()) ?? [];
  const hasResult = !!item.summary?.trim() || keyPoints.length > 0;
  const hasText = !!(item.content?.trim() || item.transcript?.trim() || item.summary?.trim());

  const submit = async (request: () => Promise<ProcessingRequestResult>) => {
    setSubmitting(true);
    setRejected(null);
    setError(null);
    try {
      const result = await request();
      if (result !== 'submitted') setRejected(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.tabBody}>
      {activity && activity.tasks.length > 0 ? (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>处理进度</h4>
          <TaskProgressList tasks={activity.tasks} />
        </section>
      ) : (
        processing && (
          <p className={styles.hint} data-kind="info">
            {activity ? activeTaskLabel(activity) : 'AI 处理中'}…
          </p>
        )
      )}

      {status === 'error' && (
        <p className={styles.hint} data-kind="error">
          <AlertCircle size={13} />
          上次 AI 处理失败，可以重新处理。
        </p>
      )}

      {item.summary?.trim() && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>摘要</h4>
          <p className={styles.summary}>{item.summary}</p>
        </section>
      )}

      {keyPoints.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>要点</h4>
          <ul className={styles.keyPoints}>
            {keyPoints.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      {!hasResult && !processing && (
        <p className={styles.emptyText}>还没有 AI 解读。处理后将生成摘要、要点、标签，并建立语义索引用于发现关联。</p>
      )}

      {rejected && (
        <div className={styles.hint} data-kind="warning">
          <span>{AI_UNAVAILABLE_HINTS[rejected]}</span>
          <button type="button" className={styles.linkButton} onClick={onOpenSettings}>
            <Settings size={12} />
            前往设置
          </button>
        </div>
      )}
      {error && (
        <p className={styles.hint} data-kind="error" role="alert">
          <AlertCircle size={13} />
          提交失败：{error}
        </p>
      )}

      <div className={styles.tabActions}>
        <button
          type="button"
          className={styles.button}
          disabled={processing || submitting}
          onClick={() => void submit(() => requestProcessing(item))}
        >
          <Sparkles size={13} />
          {processing ? 'AI 处理中…' : hasResult || status === 'error' ? '重新处理' : '开始 AI 解读'}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={processing || submitting}
          title="由 AI 建议文件夹与规范化的标签，建议需在「待审阅归类」中接受后才会应用"
          onClick={() => void submit(() => requestItemTask(item, { categorize: true }))}
        >
          <FolderTree size={13} />
          自动归类
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={processing || submitting || !hasText}
          title={hasText ? '抽取人物、组织、概念等实体及其关系，完成后可在「关联 → 实体关系」与「图谱 → 实体图谱」中查看' : '条目没有可分析的文本'}
          onClick={() => void submit(() => requestItemTask(item, { extractEntities: true }))}
        >
          <Network size={13} />
          提取实体
        </button>
      </div>
    </div>
  );
};
