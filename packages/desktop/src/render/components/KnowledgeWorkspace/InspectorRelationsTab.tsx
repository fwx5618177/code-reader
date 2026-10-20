// ================================
// 详情面板「关联」：反向链接、出链、AI 相似条目、实体关系、局部图谱
// ================================

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import type { KnowledgeItem } from '../../types/knowledge';
import {
  displayTitle,
  normalizeLinkTarget,
  type LinkIndex,
  type RelatedLink,
} from '../../lib/links/link-index';
import { useItemEntityRelations } from '../../lib/entities/useItemEntityRelations';
import KnowledgeGraph from '../KnowledgeGraph';
import { EntityRelationList } from '../EntityRelations/EntityRelationList';
import { ITEM_TYPE_ICONS } from '../ReadingWorkspace/item-type';
import styles from './Inspector.module.scss';

const SIMILAR_LIMIT = 10;

interface SimilarEntry {
  item: KnowledgeItem;
  similarity: number;
}

type QueryState<T> =
  | { status: 'loading' }
  | { status: 'done'; entries: T[] }
  | { status: 'error'; message: string };

type SimilarState = QueryState<SimilarEntry>;

/**
 * 语义相似条目；条目状态变化（如处理完成、生成了向量）后重新查询
 */
function useSimilarItems(
  item: KnowledgeItem,
  itemsById: ReadonlyMap<string, KnowledgeItem>
): SimilarState {
  const [state, setState] = useState<QueryState<{ itemId: string; similarity: number }>>({
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    window.electron.search
      .findSimilar(item.id, { limit: SIMILAR_LIMIT })
      .then((found) => {
        if (!cancelled) setState({ status: 'done', entries: found });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.status]);

  // 与最新的条目列表对照：排除已删除的条目与自身，标题随条目更新
  return useMemo<SimilarState>(() => {
    if (state.status !== 'done') return state;
    const entries = state.entries.flatMap(({ itemId, similarity }) => {
      const target = itemsById.get(itemId);
      return target && itemId !== item.id ? [{ item: target, similarity }] : [];
    });
    return { status: 'done', entries };
  }, [state, itemsById, item.id]);
}

const ItemLink: React.FC<{ item: KnowledgeItem; onSelect: (id: string) => void }> = ({
  item,
  onSelect,
}) => {
  const Icon = ITEM_TYPE_ICONS[item.type];
  const title = displayTitle(item.title) || '未命名';
  return (
    <button type="button" className={styles.relationTitle} title={title} onClick={() => onSelect(item.id)}>
      <Icon size={13} />
      <span>{title}</span>
    </button>
  );
};

export interface InspectorRelationsTabProps {
  item: KnowledgeItem;
  linkIndex: LinkIndex;
  related: RelatedLink[];
  itemsById: ReadonlyMap<string, KnowledgeItem>;
  onSelectItem: (id: string) => void;
  onCreateNote: (title: string) => void;
}

export const InspectorRelationsTab: React.FC<InspectorRelationsTabProps> = ({
  item,
  linkIndex,
  related,
  itemsById,
  onSelectItem,
  onCreateNote,
}) => {
  const backlinks = useMemo(() => linkIndex.backlinks(item.id), [linkIndex, item]);

  // 同一目标的多处引用合并为一项，保留首次出现的上下文
  const outgoing = useMemo(() => {
    const seen = new Set<string>();
    return linkIndex.outgoingLinks(item.id).flatMap((link) => {
      const key = normalizeLinkTarget(link.target);
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{ ...link, resolved: linkIndex.resolve(link.target) }];
    });
  }, [linkIndex, item]);

  const similar = useSimilarItems(item, itemsById);
  const entityRelations = useItemEntityRelations(item.id);

  return (
    <div className={styles.tabBody}>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>
          反向链接 <span className={styles.sectionCount}>{backlinks.length}</span>
        </h4>
        {backlinks.length === 0 ? (
          <p className={styles.emptyText}>还没有笔记通过 [[{displayTitle(item.title)}]] 引用它。</p>
        ) : (
          <ul className={styles.relationList}>
            {backlinks.map((link, index) => {
              const source = itemsById.get(link.sourceId);
              return (
                <li key={`${link.sourceId}:${index}`} className={styles.relation}>
                  {source ? (
                    <ItemLink item={source} onSelect={onSelectItem} />
                  ) : (
                    <span className={styles.relationTitle}>{link.sourceTitle}</span>
                  )}
                  {link.context && <p className={styles.relationContext}>{link.context}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>
          出链 <span className={styles.sectionCount}>{outgoing.length}</span>
        </h4>
        {outgoing.length === 0 ? (
          <p className={styles.emptyText}>正文中没有 [[双向链接]]。</p>
        ) : (
          <ul className={styles.relationList}>
            {outgoing.map((link) => (
              <li key={normalizeLinkTarget(link.target)} className={styles.relation}>
                {link.resolved ? (
                  <ItemLink item={link.resolved} onSelect={onSelectItem} />
                ) : (
                  <div className={styles.unresolved}>
                    <span className={styles.relationTitle} data-unresolved="true">
                      {link.alias || link.target}
                    </span>
                    <button
                      type="button"
                      className={styles.linkButton}
                      title={`创建笔记「${link.target}」`}
                      onClick={() => onCreateNote(link.target.trim())}
                    >
                      <Plus size={12} />
                      创建
                    </button>
                  </div>
                )}
                {link.context && <p className={styles.relationContext}>{link.context}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>
          AI 相似条目
          {similar.status === 'done' && <span className={styles.sectionCount}>{similar.entries.length}</span>}
        </h4>
        {similar.status === 'loading' && (
          <p className={styles.emptyText}>
            <Loader2 size={12} className={styles.spin} /> 正在查找…
          </p>
        )}
        {similar.status === 'error' && (
          <p className={styles.hint} data-kind="error">
            <AlertCircle size={13} />
            查找失败：{similar.message}
          </p>
        )}
        {similar.status === 'done' &&
          (similar.entries.length === 0 ? (
            <p className={styles.emptyText}>
              没有找到相似条目。需要先在「AI 解读」中处理条目以建立语义索引。
            </p>
          ) : (
            <ul className={styles.relationList}>
              {similar.entries.map(({ item: target, similarity }) => (
                <li key={target.id} className={styles.relation} data-inline="true">
                  <ItemLink item={target} onSelect={onSelectItem} />
                  <span className={styles.similarity} title="语义相似度">
                    {Math.round(similarity * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>
          实体关系
          {entityRelations.data && <span className={styles.sectionCount}>{entityRelations.data.length}</span>}
        </h4>
        {entityRelations.error ? (
          <p className={styles.hint} data-kind="error">
            <AlertCircle size={13} />
            加载失败：{entityRelations.error}
          </p>
        ) : !entityRelations.data ? (
          <p className={styles.emptyText}>
            <Loader2 size={12} className={styles.spin} /> 正在加载…
          </p>
        ) : entityRelations.data.length === 0 ? (
          <p className={styles.emptyText}>
            还没有实体关系。在「AI 解读」中提取实体时会一并抽取实体之间的关系。
          </p>
        ) : (
          <EntityRelationList relations={entityRelations.data} currentItemId={item.id} onOpenItem={onSelectItem} />
        )}
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>局部图谱</h4>
        <div className={styles.graphBox}>
          <KnowledgeGraph
            index={linkIndex}
            related={related}
            focusId={item.id}
            mode="local"
            onOpenItem={onSelectItem}
            onCreateNote={onCreateNote}
            compact
          />
        </div>
      </section>
    </div>
  );
};
