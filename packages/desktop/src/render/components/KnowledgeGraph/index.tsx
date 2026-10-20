// ================================
// 知识图谱视图
// 全局图谱：所有条目及其双向链接 / AI 关联
// 局部图谱：当前条目 depth 跳以内的邻域
// 图层：笔记图谱（双向链接与 AI 关联）/ 实体图谱（AI 抽取的人物、组织、概念等实体及其关系，可叠加来源条目）
// ================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Network, Search, SlidersHorizontal, X } from 'lucide-react';
import type { LinkIndex, RelatedLink } from '../../lib/links';
import { displayTitle } from '../../lib/links/link-index';
import {
  ENTITY_TYPE_LABELS,
  buildEntityGraph,
  entityIdOfNode,
  itemsOfEntity,
  relationsOfEntity,
} from '../../lib/entities/entity-graph';
import { useEntityGraph } from '../../lib/entities/useEntityGraph';
import { requestExtractAllEntities } from '../../lib/agent/actions';
import { LibraryAiButton } from '../AgentActivity/LibraryAiButton';
import { useTaskTypeRunning } from '../AgentActivity/activity';
import { EntityRelationList } from '../EntityRelations/EntityRelationList';
import GraphCanvas from './GraphCanvas';
import { localGraph, matchesQuery, normalizeQuery } from './graph-data';
import { LEGEND, NODE_COLOR_ROLE } from './graph-style';
import styles from './KnowledgeGraph.module.scss';

export type KnowledgeGraphMode = 'global' | 'local';

type GraphLayer = 'links' | 'entities';

export interface KnowledgeGraphProps {
  index: LinkIndex;
  /** Agent 发现的语义关联 */
  related: RelatedLink[];
  /** 当前条目：局部图谱的中心，全局图谱中高亮并居中 */
  focusId?: string;
  mode: KnowledgeGraphMode;
  /** 提供时显示全局 / 局部切换 */
  onModeChange?: (mode: KnowledgeGraphMode) => void;
  onOpenItem: (id: string) => void;
  /** 点击未创建的链接目标时创建同名笔记 */
  onCreateNote?: (title: string) => void;
  /** AI 不可用时引导打开设置 */
  onOpenSettings?: () => void;
  /** 嵌入侧边栏的紧凑样式：无图例、无实体图层，筛选项折叠 */
  compact?: boolean;
}

const DEPTHS = [1, 2, 3] as const;
type Depth = (typeof DEPTHS)[number];

const MODE_OPTIONS: { mode: KnowledgeGraphMode; label: string }[] = [
  { mode: 'global', label: '全局' },
  { mode: 'local', label: '局部' },
];

const LAYER_OPTIONS: { layer: GraphLayer; label: string }[] = [
  { layer: 'links', label: '笔记图谱' },
  { layer: 'entities', label: '实体图谱' },
];

const NO_RELATED: RelatedLink[] = [];

const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({
  index,
  related,
  focusId,
  mode,
  onModeChange,
  onOpenItem,
  onCreateNote,
  onOpenSettings,
  compact = false,
}) => {
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState<GraphLayer>('links');
  const [showOrphans, setShowOrphans] = useState(false);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [showRelated, setShowRelated] = useState(true);
  const [sharedEntitiesOnly, setSharedEntitiesOnly] = useState(false);
  const [showEntitySources, setShowEntitySources] = useState(false);
  const [depth, setDepth] = useState<Depth>(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** 搜索后按 Enter 定位到的节点（覆盖 focusId 的居中与描边） */
  const [searchFocusId, setSearchFocusId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** 实体图层中点击的实体，侧栏列出与其关联的条目 */
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  const showEntities = !compact && layer === 'entities';
  // 局部图谱以当前条目为中心，必须包含条目节点
  const showItemNodes = showEntitySources || mode === 'local';
  const entityGraph = useEntityGraph(showEntities);
  const extractingEntities = useTaskTypeRunning('extract-entities');

  useEffect(() => {
    setSearchFocusId(undefined);
  }, [focusId]);

  useEffect(() => {
    setSelectedEntityId(null);
  }, [layer]);

  // 局部图谱总是包含孤立条目，保证没有链接的当前条目也能显示
  const fullGraph = useMemo(() => {
    if (showEntities) {
      return entityGraph.data
        ? buildEntityGraph(entityGraph.data, { sharedOnly: sharedEntitiesOnly, showItems: showItemNodes })
        : null;
    }
    return index.graph(showRelated ? related : NO_RELATED, {
      includeOrphans: mode === 'local' || showOrphans,
      includeUnresolved: showUnresolved,
    });
  }, [
    showEntities,
    entityGraph.data,
    sharedEntitiesOnly,
    showItemNodes,
    index,
    related,
    showOrphans,
    showUnresolved,
    showRelated,
    mode,
  ]);

  const graph = useMemo(() => {
    if (!fullGraph || mode === 'global') return fullGraph;
    return focusId ? localGraph(fullGraph, focusId, depth) : null;
  }, [fullGraph, mode, focusId, depth]);

  const nodesById = useMemo(
    () => new Map(graph?.nodes.map((node) => [node.id, node])),
    [graph]
  );

  const legend = useMemo(() => {
    const present = new Set(graph?.nodes.map((node) => NODE_COLOR_ROLE[node.type]));
    return LEGEND.filter(({ role }) => present.has(role));
  }, [graph]);

  const handleNodeClick = useCallback(
    (id: string) => {
      const node = nodesById.get(id);
      if (!node) return;
      if (node.type === 'unresolved') onCreateNote?.(node.title);
      else if (node.type === 'entity') setSelectedEntityId(entityIdOfNode(id));
      else onOpenItem(id);
    },
    [nodesById, onCreateNote, onOpenItem]
  );

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const normalized = normalizeQuery(query);
      const match = graph?.nodes.find((node) => matchesQuery(node.title, normalized));
      if (match) setSearchFocusId(match.id);
    } else if (event.key === 'Escape') {
      setQuery('');
    }
  };

  const hovered = hoveredId ? nodesById.get(hoveredId) : undefined;
  const showFilters = !compact || filtersOpen;

  const selectedEntity =
    showEntities && selectedEntityId
      ? entityGraph.data?.entities.find((entity) => entity.id === selectedEntityId)
      : undefined;
  const entityItems =
    selectedEntity && entityGraph.data ? itemsOfEntity(entityGraph.data, selectedEntity.id) : [];
  const entityRelations =
    selectedEntity && entityGraph.data ? relationsOfEntity(entityGraph.data, selectedEntity.id) : [];

  let emptyHint: string | null = null;
  if (showEntities && !entityGraph.data) {
    emptyHint = entityGraph.error ? `实体加载失败：${entityGraph.error}` : '正在加载实体…';
  } else if (!graph) {
    emptyHint = showEntities ? '当前条目还没有实体。可在条目详情的「AI 解读」中提取' : '打开一个条目以查看它的局部图谱';
  } else if (graph.nodes.length === 0) {
    emptyHint = showEntities
      ? '还没有实体。点击「提取全部实体」，或在条目详情的「AI 解读」中提取'
      : '还没有链接。在笔记中输入 [[标题]] 建立双向链接';
  }

  let hoveredText: string | undefined;
  if (hovered?.type === 'unresolved') {
    hoveredText = `${hovered.title}（未创建${onCreateNote ? '，点击创建' : ''}）`;
  } else if (hovered?.type === 'entity') {
    hoveredText = `${hovered.title}（实体，点击查看关系与相关条目）`;
  } else {
    hoveredText = hovered?.title;
  }

  return (
    <div className={`${styles.graph} ${compact ? styles.compact : ''}`}>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={compact ? 12 : 14} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={query}
            placeholder="搜索节点，Enter 定位"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </label>

        {!compact && (
          <div className={styles.segmented} role="group" aria-label="图层">
            {LAYER_OPTIONS.map((option) => (
              <button
                key={option.layer}
                type="button"
                className={styles.segment}
                aria-pressed={layer === option.layer}
                onClick={() => setLayer(option.layer)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'local' && (
          <div className={styles.segmented} role="group" aria-label="局部图谱深度">
            <span className={styles.segmentedLabel}>深度</span>
            {DEPTHS.map((value) => (
              <button
                key={value}
                type="button"
                className={styles.segment}
                aria-pressed={depth === value}
                onClick={() => setDepth(value)}
              >
                {value}
              </button>
            ))}
          </div>
        )}

        {onModeChange && (
          <div className={styles.segmented} role="group" aria-label="图谱范围">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                className={styles.segment}
                aria-pressed={mode === option.mode}
                onClick={() => onModeChange(option.mode)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {showEntities && (
          <LibraryAiButton
            className={styles.actionButton}
            label="提取全部实体"
            icon={Network}
            confirmTitle="提取全部实体"
            confirmMessage="AI 将从所有新增或修改过的条目中抽取人物、组织、概念等实体，长文会分段分析后合并。条目较多时需要一些时间，进度见右下角的 AI 任务。"
            emptyHint="所有条目的实体都已是最新（没有新增或修改过的有文本条目）。"
            busy={extractingEntities}
            run={requestExtractAllEntities}
            onOpenSettings={onOpenSettings}
          />
        )}

        {compact && (
          <button
            type="button"
            className={styles.iconButton}
            aria-pressed={filtersOpen}
            title="筛选"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={12} />
          </button>
        )}
      </div>

      {showFilters && (
        <div className={styles.filters}>
          {showEntities ? (
            <>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={sharedEntitiesOnly}
                  onChange={(event) => setSharedEntitiesOnly(event.target.checked)}
                />
                只显示关联多个条目的实体
              </label>
              {mode === 'global' && (
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={showEntitySources}
                    onChange={(event) => setShowEntitySources(event.target.checked)}
                  />
                  显示来源条目
                </label>
              )}
            </>
          ) : (
            <>
              {mode === 'global' && (
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={showOrphans}
                    onChange={(event) => setShowOrphans(event.target.checked)}
                  />
                  显示孤立节点
                </label>
              )}
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={showUnresolved}
                  onChange={(event) => setShowUnresolved(event.target.checked)}
                />
                显示未创建的链接
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={showRelated}
                  onChange={(event) => setShowRelated(event.target.checked)}
                />
                显示 AI 关联
              </label>
            </>
          )}
        </div>
      )}

      <div className={styles.stage}>
        {graph && graph.nodes.length > 0 ? (
          <GraphCanvas
            data={graph}
            focusId={searchFocusId ?? focusId}
            highlightQuery={query}
            onNodeClick={handleNodeClick}
            onNodeHover={setHoveredId}
          />
        ) : (
          <div className={styles.empty}>{emptyHint}</div>
        )}

        {!compact && legend.length > 0 && (
          <ul className={styles.legend}>
            {legend.map(({ role, label }) => (
              <li key={role} className={styles.legendItem}>
                <span className={styles.swatch} data-role={role} />
                {label}
              </li>
            ))}
            {!showEntities && showRelated && (
              <li className={styles.legendItem}>
                <span className={styles.dashedLine} />
                AI 关联
              </li>
            )}
            {showEntities && (
              <li className={styles.legendItem}>
                <span className={styles.solidLine} />
                实体关系
              </li>
            )}
            {showEntities && showItemNodes && (
              <li className={styles.legendItem}>
                <span className={styles.dashedLine} />
                条目提及
              </li>
            )}
          </ul>
        )}

        {selectedEntity && (
          <aside className={styles.entityPanel} aria-label={`实体「${selectedEntity.name}」`}>
            <header className={styles.entityHeader}>
              <span className={styles.swatch} data-role="entity" />
              <span className={styles.entityName} title={selectedEntity.name}>
                {selectedEntity.name}
              </span>
              <span className={styles.entityType}>{ENTITY_TYPE_LABELS[selectedEntity.type]}</span>
              <button
                type="button"
                className={styles.iconButton}
                title="关闭"
                onClick={() => setSelectedEntityId(null)}
              >
                <X size={12} />
              </button>
            </header>
            <div className={styles.entityBody}>
              <p className={styles.entityCount}>{entityRelations.length} 条关系</p>
              {entityRelations.length > 0 && (
                <EntityRelationList
                  relations={entityRelations}
                  onOpenItem={onOpenItem}
                  onSelectEntity={setSelectedEntityId}
                />
              )}
              <p className={styles.entityCount}>出现在 {entityItems.length} 个条目中</p>
              <ul className={styles.entityItems}>
                {entityItems.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={styles.entityItem} onClick={() => onOpenItem(item.id)}>
                      <span className={styles.entityItemTitle}>{displayTitle(item.title) || '未命名条目'}</span>
                      <span className={styles.entityItemMentions}>{item.mentionCount} 次</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.hovered}>{hoveredText}</span>
        {graph && (
          <span className={styles.counts}>
            {graph.nodes.length} 个节点 · {graph.edges.length} 条连线
          </span>
        )}
      </div>
    </div>
  );
};

export default KnowledgeGraph;
