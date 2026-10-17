// ================================
// 条目流的空状态：加载骨架、首次使用引导、范围为空、筛选无结果、加载错误
// ================================

import React from 'react';
import { AlertCircle, FilterX, Plus, RefreshCw } from 'lucide-react';
import type { KnowledgeItemType } from '../../types/knowledge';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';
import { ITEM_TYPES } from './filtering';
import styles from './ItemStream.module.scss';

const SKELETON_ROWS = 6;

const TYPE_DESCRIPTIONS: Record<KnowledgeItemType, string> = {
  note: 'Markdown 笔记，支持 [[双向链接]]',
  audio: '录音与音频，自动转写为文字',
  image: '截图、照片与图表',
  video: '视频文件，应用内播放',
  document: 'PDF、Word、表格等文档',
  webpage: '网页剪藏，保存正文',
  code: '代码片段',
  bookmark: '稍后阅读的链接',
  file: '其他任意文件',
};

export const StreamSkeleton: React.FC = () => (
  <div className={styles.skeleton} aria-busy="true" aria-label="正在加载条目">
    {Array.from({ length: SKELETON_ROWS }, (_, index) => (
      <div key={index} className={styles.skeletonRow}>
        <span />
        <span />
      </div>
    ))}
  </div>
);

export const Onboarding: React.FC<{ onQuickCapture: () => void }> = ({ onQuickCapture }) => (
  <div className={styles.placeholder}>
    <h3 className={styles.placeholderTitle}>开始建立你的知识库</h3>
    <p className={styles.placeholderText}>
      随手收集任何内容，AI 会自动生成摘要、提取标签、建立语义索引并发现条目之间的关联。
      知识库支持以下 9 种内容：
    </p>
    <ul className={styles.typeGrid}>
      {ITEM_TYPES.map((type) => {
        const Icon = ITEM_TYPE_ICONS[type];
        return (
          <li key={type} className={styles.typeCard}>
            <Icon size={14} />
            <div>
              <div className={styles.typeName}>{ITEM_TYPE_LABELS[type]}</div>
              <div className={styles.typeDesc}>{TYPE_DESCRIPTIONS[type]}</div>
            </div>
          </li>
        );
      })}
    </ul>
    <button type="button" className={styles.primaryButton} onClick={onQuickCapture}>
      <Plus size={14} />
      快速收集第一条内容
    </button>
  </div>
);

export const EmptyScope: React.FC<{ label: string; onQuickCapture: () => void }> = ({
  label,
  onQuickCapture,
}) => (
  <div className={styles.placeholder}>
    <h3 className={styles.placeholderTitle}>「{label}」中还没有条目</h3>
    <button type="button" className={styles.primaryButton} onClick={onQuickCapture}>
      <Plus size={14} />
      快速收集
    </button>
  </div>
);

export const NoMatches: React.FC<{ onClearFilters: () => void }> = ({ onClearFilters }) => (
  <div className={styles.placeholder}>
    <h3 className={styles.placeholderTitle}>没有匹配的条目</h3>
    <p className={styles.placeholderText}>换个关键词，或减少类型与标签筛选条件</p>
    <button type="button" className={styles.secondaryButton} onClick={onClearFilters}>
      <FilterX size={14} />
      清除筛选
    </button>
  </div>
);

export const LoadError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className={styles.errorBanner} role="alert">
    <AlertCircle size={14} />
    <span>知识库加载失败：{message}</span>
    <button type="button" className={styles.secondaryButton} onClick={onRetry}>
      <RefreshCw size={12} />
      重试
    </button>
  </div>
);
