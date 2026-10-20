// ================================
// 知识库工作区工具栏：范围、视图切换、搜索、类型 / 标签筛选、排序、分组、布局
// ================================

import React from 'react';
import {
  ClipboardCheck,
  FolderTree,
  LayoutGrid,
  List as ListIcon,
  MessageSquare,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Tags,
  X,
} from 'lucide-react';
import type { KnowledgeItemType, Tag } from '../../types/knowledge';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';
import {
  GROUP_LABELS,
  ITEM_TYPES,
  SORT_LABELS,
  type GroupBy,
  type ItemFilters,
  type SortKey,
} from './filtering';
import type { StreamLayout, WorkspacePrefs } from './preferences';
import { TagFilter } from './TagFilter';
import { TagDot } from './TagColor';
import { LibraryAiButton } from '../AgentActivity/LibraryAiButton';
import { requestCategorizeLibrary } from '../../lib/agent/actions';
import styles from './Toolbar.module.scss';

export type WorkspaceView = 'items' | 'graph' | 'ask';

const VIEW_OPTIONS: { view: WorkspaceView; label: string; icon: typeof ListIcon }[] = [
  { view: 'items', label: '条目', icon: ListIcon },
  { view: 'graph', label: '图谱', icon: Network },
  { view: 'ask', label: '问答', icon: MessageSquare },
];

const LAYOUT_OPTIONS: { layout: StreamLayout; label: string; icon: typeof ListIcon }[] = [
  { layout: 'list', label: '列表', icon: ListIcon },
  { layout: 'card', label: '卡片', icon: LayoutGrid },
];

export interface ToolbarProps {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  scopeLabel: string;
  /** 范围内条目数 */
  scopeCount: number;
  /** 筛选后条目数 */
  resultCount: number;
  filters: ItemFilters;
  onFiltersChange: (filters: ItemFilters) => void;
  typeCounts: Map<KnowledgeItemType, number>;
  tags: Tag[];
  tagCounts: Map<string, number>;
  prefs: WorkspacePrefs;
  onPrefsChange: (patch: Partial<WorkspacePrefs>) => void;
  onQuickCapture: () => void;
  /** 打开标签管理 */
  onManageTags: () => void;
  /** 整库自动归类正在执行 */
  categorizing: boolean;
  /** 待审阅的归类建议数；大于 0 时显示「待审阅」入口 */
  pendingReviewCount: number;
  /** 打开待审阅归类面板 */
  onOpenReview: () => void;
  /** 打开设置（AI 不可用时引导配置） */
  onOpenSettings: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  view,
  onViewChange,
  scopeLabel,
  scopeCount,
  resultCount,
  filters,
  onFiltersChange,
  typeCounts,
  tags,
  tagCounts,
  prefs,
  onPrefsChange,
  onQuickCapture,
  onManageTags,
  categorizing,
  pendingReviewCount,
  onOpenReview,
  onOpenSettings,
}) => {
  const isItems = view === 'items';
  const filtered = resultCount !== scopeCount;
  const typeTotal = [...typeCounts.values()].reduce((sum, n) => sum + n, 0);
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));

  const toggleType = (type: KnowledgeItemType) =>
    onFiltersChange({
      ...filters,
      types: filters.types.includes(type)
        ? filters.types.filter((t) => t !== type)
        : [...filters.types, type],
    });

  return (
    <div className={styles.toolbar}>
      <div className={styles.row}>
        <div className={styles.scope}>
          <h2 className={styles.scopeLabel} title={scopeLabel}>
            {scopeLabel}
          </h2>
          <span className={styles.scopeCount}>
            {isItems && filtered ? `${resultCount} / ${scopeCount}` : scopeCount} 条
          </span>
        </div>

        <div className={styles.segmented} role="tablist" aria-label="视图">
          {VIEW_OPTIONS.map(({ view: value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              className={styles.segment}
              onClick={() => onViewChange(value)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <div className={styles.spacer} />

        {isItems && (
          <label className={styles.search}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              value={filters.query}
              placeholder="搜索标题、正文、摘要、转写、标签"
              aria-label="搜索条目"
              onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onFiltersChange({ ...filters, query: '' });
              }}
            />
            {filters.query && (
              <button
                type="button"
                className={styles.clearSearch}
                title="清除搜索"
                onClick={() => onFiltersChange({ ...filters, query: '' })}
              >
                <X size={12} />
              </button>
            )}
          </label>
        )}

        <LibraryAiButton
          className={styles.control}
          label="自动归类"
          icon={FolderTree}
          confirmTitle="自动归类整个知识库"
          confirmMessage="AI 将为所有条目建议文件夹（必要时新建）、补充规范化的标签，并找出近似重复的标签。建议不会直接应用，完成后在「待审阅」中逐条接受或拒绝；未审阅的旧建议会被新结果取代。"
          busy={categorizing}
          run={requestCategorizeLibrary}
          onOpenSettings={onOpenSettings}
        />

        {pendingReviewCount > 0 && (
          <button
            type="button"
            className={styles.control}
            data-active="true"
            title="审阅 AI 归类建议"
            onClick={onOpenReview}
          >
            <ClipboardCheck size={13} />
            待审阅
            <span className={styles.controlBadge}>{pendingReviewCount}</span>
          </button>
        )}

        <button type="button" className={styles.primaryButton} onClick={onQuickCapture}>
          <Plus size={14} />
          快速收集
        </button>

        <button
          type="button"
          className={styles.iconButton}
          aria-pressed={prefs.inspectorOpen}
          title={prefs.inspectorOpen ? '隐藏详情面板' : '显示详情面板'}
          onClick={() => onPrefsChange({ inspectorOpen: !prefs.inspectorOpen })}
        >
          {prefs.inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>

      {isItems && (
        <div className={styles.row}>
          <div className={styles.chips} role="group" aria-label="按类型筛选">
            <button
              type="button"
              className={styles.chip}
              aria-pressed={filters.types.length === 0}
              onClick={() => onFiltersChange({ ...filters, types: [] })}
            >
              全部 <span className={styles.chipCount}>{typeTotal}</span>
            </button>
            {ITEM_TYPES.filter(
              (type) => (typeCounts.get(type) ?? 0) > 0 || filters.types.includes(type)
            ).map((type) => {
              const Icon = ITEM_TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  className={styles.chip}
                  aria-pressed={filters.types.includes(type)}
                  onClick={() => toggleType(type)}
                >
                  <Icon size={12} />
                  {ITEM_TYPE_LABELS[type]}
                  <span className={styles.chipCount}>{typeCounts.get(type) ?? 0}</span>
                </button>
              );
            })}
          </div>

          <TagFilter
            tags={tags}
            counts={tagCounts}
            selected={filters.tagIds}
            onChange={(tagIds) => onFiltersChange({ ...filters, tagIds })}
          />
          <button type="button" className={styles.control} onClick={onManageTags}>
            <Tags size={13} />
            管理标签
          </button>
          {filters.tagIds.map((id) => (
            <span key={id} className={styles.tagChip}>
              <TagDot color={tagById.get(id)?.color} />#{tagById.get(id)?.name ?? id}
              <button
                type="button"
                title="移除标签筛选"
                onClick={() =>
                  onFiltersChange({ ...filters, tagIds: filters.tagIds.filter((t) => t !== id) })
                }
              >
                <X size={10} />
              </button>
            </span>
          ))}

          <div className={styles.spacer} />

          <label className={styles.selectLabel}>
            排序
            <select
              className={styles.select}
              value={prefs.sort}
              onChange={(event) => onPrefsChange({ sort: event.target.value as SortKey })}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.selectLabel}>
            分组
            <select
              className={styles.select}
              value={prefs.groupBy}
              onChange={(event) => onPrefsChange({ groupBy: event.target.value as GroupBy })}
            >
              {(Object.keys(GROUP_LABELS) as GroupBy[]).map((key) => (
                <option key={key} value={key}>
                  {GROUP_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.segmented} role="group" aria-label="布局">
            {LAYOUT_OPTIONS.map(({ layout, label, icon: Icon }) => (
              <button
                key={layout}
                type="button"
                className={styles.segment}
                aria-pressed={prefs.layout === layout}
                title={label}
                aria-label={label}
                onClick={() => onPrefsChange({ layout })}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
