// ================================
// 写作标签：文档上的标签及文档数，点选（可多选，需全部命中）筛选文档列表
// 计数与筛选复用知识库条目流的 applyFilters
// ================================

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { KnowledgeItem, Tag } from '../../types/knowledge';
import { applyFilters, EMPTY_FILTERS } from '../KnowledgeWorkspace/filtering';
import { tagColorStyle } from '../KnowledgeWorkspace/TagColor';
import { sortByRecentUpdate } from '../../lib/documents/recent';
import { describeUpdated } from './describe';
import { PanelEmpty } from './PanelEmpty';
import { SidebarItemList } from './SidebarItemList';
import styles from './DocumentTags.module.scss';

export interface DocumentTagsProps {
  /** 写作文档 */
  documents: KnowledgeItem[];
  tags: Tag[];
  selectedDocId?: string | null;
  onOpenDocument: (id: string) => void;
}

/** 只按标签筛选，不需要全文 */
const noSearchText = () => '';

export const DocumentTags: React.FC<DocumentTagsProps> = ({ documents, tags, selectedDocId, onOpenDocument }) => {
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // 已不存在的标签（被合并或删除）不参与筛选
  const activeTagIds = useMemo(
    () => selectedTagIds.filter((id) => tags.some((tag) => tag.id === id)),
    [selectedTagIds, tags]
  );
  const result = useMemo(
    () => applyFilters(documents, { ...EMPTY_FILTERS, tagIds: activeTagIds }, noSearchText),
    [documents, activeTagIds]
  );
  const sortedDocuments = useMemo(() => sortByRecentUpdate(result.items), [result.items]);

  // 已选标签始终显示；其余显示当前结果中出现的标签，按文档数降序
  const visibleTags = useMemo(
    () =>
      tags
        .filter((tag) => activeTagIds.includes(tag.id) || (result.tagCounts.get(tag.id) ?? 0) > 0)
        .sort((a, b) => (result.tagCounts.get(b.id) ?? 0) - (result.tagCounts.get(a.id) ?? 0)),
    [tags, activeTagIds, result.tagCounts]
  );

  const toggleTag = (id: string) =>
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  if (visibleTags.length === 0) return <PanelEmpty>写作文档还没有标签。可在知识库详情面板中为文档添加标签</PanelEmpty>;
  return (
    <div className={styles.panel}>
      <div className={styles.chips}>
        {visibleTags.map((tag) => {
          const selected = activeTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={selected}
              className={`${styles.chip} ${selected ? styles.chipSelected : ''}`}
              style={tagColorStyle(tag.color)}
              onClick={() => toggleTag(tag.id)}
            >
              <span className={styles.chipName}>#{tag.name}</span>
              <span className={styles.chipCount}>{result.tagCounts.get(tag.id) ?? 0}</span>
            </button>
          );
        })}
        {activeTagIds.length > 0 && (
          <button type="button" className={styles.clear} onClick={() => setSelectedTagIds([])}>
            <X size={12} />
            清除
          </button>
        )}
      </div>
      {activeTagIds.length === 0 ? (
        <PanelEmpty>选择标签查看对应的文档，多选时显示同时带有这些标签的文档</PanelEmpty>
      ) : (
        <SidebarItemList
          items={sortedDocuments}
          selectedId={selectedDocId}
          onOpen={onOpenDocument}
          describe={describeUpdated}
          emptyText="没有同时带有所选标签的文档"
          ariaLabel="带有所选标签的文档"
        />
      )}
    </div>
  );
};
