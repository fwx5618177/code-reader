// ================================
// 标签云：字号与字重随使用次数变化，点击标签筛选知识库主区条目流
// ================================

import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import type { Tag } from '../../types/knowledge';
import { tagColorStyle } from '../KnowledgeWorkspace/TagColor';
import { PanelEmpty } from './PanelEmpty';
import { buildTagCloud } from './tag-cloud';
import styles from './TagCloud.module.scss';

export interface TagCloudProps {
  tags: Tag[];
  /** 当前用于筛选的标签 */
  selectedTagIds: readonly string[];
  onToggleTag: (tagId: string) => void;
  onClearTags: () => void;
}

export const TagCloud: React.FC<TagCloudProps> = ({ tags, selectedTagIds, onToggleTag, onClearTags }) => {
  const cloud = useMemo(() => buildTagCloud(tags), [tags]);
  const selected = new Set(selectedTagIds);

  if (cloud.length === 0) return <PanelEmpty>还没有标签。为条目添加标签，或开启 AI 自动打标签</PanelEmpty>;
  return (
    <div className={styles.panel}>
      <div className={styles.status}>
        {selected.size > 0 ? (
          <>
            <span>主区显示同时带有 {selected.size} 个所选标签的条目</span>
            <button type="button" className={styles.clear} onClick={onClearTags}>
              <X size={12} />
              清除
            </button>
          </>
        ) : (
          <span>点击标签筛选条目，可多选</span>
        )}
      </div>
      <div className={styles.cloud}>
        {cloud.map(({ tag, level }) => (
          <button
            key={tag.id}
            type="button"
            aria-pressed={selected.has(tag.id)}
            className={`${styles.tag} ${selected.has(tag.id) ? styles.tagSelected : ''}`}
            data-level={level}
            style={{ ...tagColorStyle(tag.color), '--cloud-level': level } as React.CSSProperties}
            onClick={() => onToggleTag(tag.id)}
            title={`${tag.name} · ${tag.usageCount} 个条目`}
          >
            {tag.name}
          </button>
        ))}
      </div>
    </div>
  );
};
