// ================================
// 标签云：字号与字重随使用次数变化，点击标签筛选知识库主区条目流
// 有层级标签（“父/子”）时默认以层级视图显示，可折叠；选中父标签时包含其全部子标签
// ================================

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { Tag } from '../../types/knowledge';
import { buildTagTree, flattenTagTree } from '../../lib/knowledge/tag-tree';
import { TAG_PATH_SEPARATOR } from '../../../shared/tag-path';
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

type TagView = 'cloud' | 'tree';

export const TagCloud: React.FC<TagCloudProps> = ({ tags, selectedTagIds, onToggleTag, onClearTags }) => {
  const cloud = useMemo(() => buildTagCloud(tags), [tags]);
  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const hierarchical = useMemo(() => tags.some((tag) => tag.name.includes(TAG_PATH_SEPARATOR)), [tags]);
  const [chosenView, setChosenView] = useState<TagView | null>(null);
  const view = chosenView ?? (hierarchical ? 'tree' : 'cloud');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => flattenTagTree(tree, collapsed), [tree, collapsed]);
  const selected = new Set(selectedTagIds);

  const toggleCollapsed = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

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
          <span>点击标签筛选条目，可多选；父标签包含子标签</span>
        )}
      </div>
      <div className={styles.viewSwitch} role="group" aria-label="标签视图">
        <button type="button" aria-pressed={view === 'tree'} onClick={() => setChosenView('tree')}>
          层级
        </button>
        <button type="button" aria-pressed={view === 'cloud'} onClick={() => setChosenView('cloud')}>
          云
        </button>
      </div>

      {view === 'cloud' ? (
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
      ) : (
        <ul className={styles.tree} aria-label="标签层级">
          {rows.map(({ node, depth }) => {
            const hasChildren = node.children.length > 0;
            const isCollapsed = collapsed.has(node.path);
            const tag = node.tag;
            return (
              <li
                key={node.path}
                className={styles.treeRow}
                style={{ '--tree-depth': depth } as React.CSSProperties}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className={styles.caret}
                    aria-label={`${isCollapsed ? '展开' : '折叠'}「${node.path}」`}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapsed(node.path)}
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                ) : (
                  <span className={styles.caretSpacer} />
                )}
                {tag ? (
                  <button
                    type="button"
                    aria-pressed={selected.has(tag.id)}
                    className={`${styles.treeTag} ${selected.has(tag.id) ? styles.tagSelected : ''}`}
                    style={tagColorStyle(tag.color)}
                    title={hasChildren ? `${node.path}（含子标签）` : node.path}
                    onClick={() => onToggleTag(tag.id)}
                  >
                    {node.label}
                  </button>
                ) : (
                  <span className={styles.treeGroup} title={`${node.path}：没有同名标签，展开选择子标签`}>
                    {node.label}
                  </span>
                )}
                <span className={styles.treeCount}>{node.totalUsage}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
