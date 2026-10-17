// ================================
// 知识图谱视图
// 全局图谱：所有条目及其双向链接 / AI 关联
// 局部图谱：当前条目 depth 跳以内的邻域
// ================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { LinkIndex, RelatedLink } from '../../lib/links';
import GraphCanvas from './GraphCanvas';
import { localGraph, matchesQuery, normalizeQuery } from './graph-data';
import { LEGEND, NODE_COLOR_ROLE } from './graph-style';
import styles from './KnowledgeGraph.module.scss';

export type KnowledgeGraphMode = 'global' | 'local';

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
  /** 嵌入侧边栏的紧凑样式：无图例，筛选项折叠 */
  compact?: boolean;
}

const DEPTHS = [1, 2, 3] as const;
type Depth = (typeof DEPTHS)[number];

const MODE_OPTIONS: { mode: KnowledgeGraphMode; label: string }[] = [
  { mode: 'global', label: '全局' },
  { mode: 'local', label: '局部' },
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
  compact = false,
}) => {
  const [query, setQuery] = useState('');
  const [showOrphans, setShowOrphans] = useState(false);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [showRelated, setShowRelated] = useState(true);
  const [depth, setDepth] = useState<Depth>(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** 搜索后按 Enter 定位到的节点（覆盖 focusId 的居中与描边） */
  const [searchFocusId, setSearchFocusId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    setSearchFocusId(undefined);
  }, [focusId]);

  // 局部图谱总是包含孤立条目，保证没有链接的当前条目也能显示
  const graph = useMemo(() => {
    const full = index.graph(showRelated ? related : NO_RELATED, {
      includeOrphans: mode === 'local' || showOrphans,
      includeUnresolved: showUnresolved,
    });
    if (mode === 'global') return full;
    return focusId ? localGraph(full, focusId, depth) : null;
  }, [index, related, showOrphans, showUnresolved, showRelated, mode, focusId, depth]);

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

  let emptyHint: string | null = null;
  if (!graph) emptyHint = '打开一个条目以查看它的局部图谱';
  else if (graph.nodes.length === 0) emptyHint = '还没有链接。在笔记中输入 [[标题]] 建立双向链接';

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
            {showRelated && (
              <li className={styles.legendItem}>
                <span className={styles.dashedLine} />
                AI 关联
              </li>
            )}
          </ul>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.hovered}>
          {hovered &&
            (hovered.type === 'unresolved'
              ? `${hovered.title}（未创建${onCreateNote ? '，点击创建' : ''}）`
              : hovered.title)}
        </span>
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
