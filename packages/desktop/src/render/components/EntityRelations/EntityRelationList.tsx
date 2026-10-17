// ================================
// 实体关系列表：「实体 关系 实体」三元组、证据片段与来源条目跳转
// 知识库详情面板的「实体关系」与实体图谱的实体侧栏共用
// ================================

import React from 'react';
import type { EntityRelation } from '../../types/electron';
import { ENTITY_TYPE_LABELS, RELATION_TYPE_LABELS, relationLabel } from '../../lib/entities/entity-graph';
import { displayTitle } from '../../lib/links/link-index';
import styles from './EntityRelationList.module.scss';

export interface EntityRelationListProps {
  relations: EntityRelation[];
  /** 打开来源条目 */
  onOpenItem: (itemId: string) => void;
  /** 当前条目：来源为当前条目时显示「本条目」而不是跳转按钮 */
  currentItemId?: string;
  /** 提供时实体名可点击（实体图谱中切换选中的实体） */
  onSelectEntity?: (entityId: string) => void;
}

interface EntityNameProps {
  id: string;
  name: string;
  typeLabel: string;
  onSelect?: (entityId: string) => void;
}

const EntityName: React.FC<EntityNameProps> = ({ id, name, typeLabel, onSelect }) =>
  onSelect ? (
    <button type="button" className={styles.entity} title={`${name}（${typeLabel}）`} onClick={() => onSelect(id)}>
      {name}
    </button>
  ) : (
    <span className={styles.entity} title={`${name}（${typeLabel}）`}>
      {name}
    </span>
  );

export const EntityRelationList: React.FC<EntityRelationListProps> = ({
  relations,
  onOpenItem,
  currentItemId,
  onSelectEntity,
}) => (
  <ul className={styles.list}>
    {relations.map((relation) => {
      const sourceTitle = displayTitle(relation.itemTitle) || '未命名条目';
      return (
        <li key={relation.id} className={styles.relation}>
          <div className={styles.triple}>
            <EntityName
              id={relation.sourceEntityId}
              name={relation.sourceName}
              typeLabel={ENTITY_TYPE_LABELS[relation.sourceType]}
              onSelect={onSelectEntity}
            />
            <span className={styles.predicate} title={RELATION_TYPE_LABELS[relation.type]}>
              {relationLabel(relation)}
            </span>
            <EntityName
              id={relation.targetEntityId}
              name={relation.targetName}
              typeLabel={ENTITY_TYPE_LABELS[relation.targetType]}
              onSelect={onSelectEntity}
            />
            <span className={styles.confidence} title="置信度">
              {Math.round(relation.confidence * 100)}%
            </span>
          </div>
          {relation.evidence && <blockquote className={styles.evidence}>{relation.evidence}</blockquote>}
          <div className={styles.source}>
            来源：
            {relation.itemId === currentItemId ? (
              <span>本条目</span>
            ) : (
              <button
                type="button"
                className={styles.sourceLink}
                title={`打开「${sourceTitle}」`}
                onClick={() => onOpenItem(relation.itemId)}
              >
                {sourceTitle}
              </button>
            )}
          </div>
        </li>
      );
    })}
  </ul>
);
