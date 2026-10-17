// ================================
// 知识库主工作区：工具栏 + 条目流 / 图谱 / 问答 + 条目详情面板
// ================================

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { KnowledgeItem } from '../../types/knowledge';
import type { UseKnowledgeBaseReturn } from '../../lib/knowledge/useKnowledgeBase';
import type { LinkIndex, RelatedLink } from '../../lib/links/link-index';
import KnowledgeGraph, { type KnowledgeGraphMode } from '../KnowledgeGraph';
import { ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';
import { useActivityByItem } from '../AgentActivity/activity';
import {
  EMPTY_FILTERS,
  applyFilters,
  buildSearchText,
  filterByScope,
  groupItems,
  hasActiveFilters,
  sortItems,
  type ItemFilters,
  type WorkspaceScope,
} from './filtering';
import { loadPrefs, savePrefs, type WorkspacePrefs } from './preferences';
import { Toolbar, type WorkspaceView } from './Toolbar';
import { ItemStream } from './ItemStream';
import { EmptyScope, LoadError, NoMatches, Onboarding, StreamSkeleton } from './StreamStates';
import { Inspector } from './Inspector';
import { AskPanel } from './AskPanel';
import { useAskConversation } from './useAskConversation';
import styles from './KnowledgeWorkspace.module.scss';

export interface KnowledgeWorkspaceProps {
  kb: UseKnowledgeBaseReturn;
  /** 侧边栏选中的范围：文件夹或智能文件夹 */
  scope: WorkspaceScope;
  linkIndex: LinkIndex;
  related: RelatedLink[];
  /** 打开某条目（按 id），在本工作区内选中并显示详情 */
  selectedItemId?: string;
  onSelectItem: (id: string | undefined) => void;
  /** 在写作模式中打开（仅 note 类型） */
  onOpenInWriting: (itemId: string) => void;
  /** 通过双向链接创建新笔记（目标不存在时） */
  onCreateNote: (title: string) => void;
  /** 打开快速输入 */
  onQuickCapture: () => void;
  /** 打开设置（用于引导配置 AI 服务商） */
  onOpenSettings: () => void;
}

const KnowledgeWorkspace: React.FC<KnowledgeWorkspaceProps> = ({
  kb,
  scope,
  linkIndex,
  related,
  selectedItemId,
  onSelectItem,
  onOpenInWriting,
  onCreateNote,
  onQuickCapture,
  onOpenSettings,
}) => {
  const [view, setView] = useState<WorkspaceView>('items');
  const [prefs, setPrefs] = useState<WorkspacePrefs>(loadPrefs);
  const [filters, setFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  const [graphMode, setGraphMode] = useState<KnowledgeGraphMode>('global');
  const conversation = useAskConversation();
  const activityByItem = useActivityByItem();

  useEffect(() => savePrefs(prefs), [prefs]);
  const updatePrefs = useCallback(
    (patch: Partial<WorkspacePrefs>) => setPrefs((prev) => ({ ...prev, ...patch })),
    []
  );

  // ---------- 数据管线：范围 → 筛选 → 排序 → 分组 ----------

  const tagNameById = useMemo(() => new Map(kb.tags.map((tag) => [tag.id, tag.name])), [kb.tags]);
  const itemsById = useMemo(() => new Map(kb.items.map((item) => [item.id, item])), [kb.items]);

  // 可搜索文本按条目对象缓存；标签名变化时整体失效
  const searchText = useMemo(() => {
    const cache = new WeakMap<KnowledgeItem, string>();
    return (item: KnowledgeItem) => {
      let text = cache.get(item);
      if (text === undefined) {
        text = buildSearchText(item, tagNameById);
        cache.set(item, text);
      }
      return text;
    };
  }, [tagNameById]);

  const { folderId, rules } = scope;
  const scoped = useMemo(
    () => filterByScope(kb.items, { folderId, rules }),
    [kb.items, folderId, rules]
  );

  // 搜索词延迟应用，输入时不被大列表的重新筛选阻塞
  const query = useDeferredValue(filters.query);
  const result = useMemo(
    () => applyFilters(scoped, { ...filters, query }, searchText),
    [scoped, filters.types, filters.tagIds, query, searchText]
  );
  const sorted = useMemo(() => sortItems(result.items, prefs.sort), [result.items, prefs.sort]);
  const groups = useMemo(
    () =>
      groupItems(sorted, prefs.groupBy, {
        sort: prefs.sort,
        tags: kb.tags,
        typeLabels: ITEM_TYPE_LABELS,
        now: new Date(),
      }),
    [sorted, prefs.groupBy, prefs.sort, kb.tags]
  );

  const selectedItem = selectedItemId ? itemsById.get(selectedItemId) : undefined;

  // ---------- 交互 ----------

  const handleOpen = useCallback(
    (item: KnowledgeItem) => {
      if (item.type === 'note') onOpenInWriting(item.id);
    },
    [onOpenInWriting]
  );

  const handleToggleFavorite = useCallback(
    (item: KnowledgeItem) => {
      kb.updateItem(item.id, { isFavorite: !item.isFavorite }).catch((error) =>
        console.error('[Knowledge] 更新收藏失败:', error)
      );
    },
    [kb]
  );

  /** 图谱中打开条目：选中并回到条目视图 */
  const handleGraphOpen = useCallback(
    (id: string) => {
      onSelectItem(id);
      setView('items');
    },
    [onSelectItem]
  );

  /** 问答引用：选中来源条目，并确保详情面板可见 */
  const handleCitation = useCallback(
    (id: string) => {
      onSelectItem(id);
      updatePrefs({ inspectorOpen: true });
    },
    [onSelectItem, updatePrefs]
  );

  // ---------- 渲染 ----------

  const renderStream = () => {
    if (kb.loading && kb.items.length === 0) return <StreamSkeleton />;
    if (kb.items.length === 0) return kb.error ? null : <Onboarding onQuickCapture={onQuickCapture} />;
    if (groups.length === 0) {
      return hasActiveFilters(filters) ? (
        <NoMatches onClearFilters={() => setFilters(EMPTY_FILTERS)} />
      ) : (
        <EmptyScope label={scope.label} onQuickCapture={onQuickCapture} />
      );
    }
    return (
      <ItemStream
        groups={groups}
        layout={prefs.layout}
        timeField={prefs.sort === 'created' ? 'createdAt' : 'updatedAt'}
        selectedId={selectedItemId}
        onSelect={onSelectItem}
        onOpen={handleOpen}
        onToggleFavorite={handleToggleFavorite}
        tagNameById={tagNameById}
        activityByItem={activityByItem}
      />
    );
  };

  return (
    <div className={styles.workspace}>
      <Toolbar
        view={view}
        onViewChange={setView}
        scopeLabel={scope.label}
        scopeCount={scoped.length}
        resultCount={result.items.length}
        filters={filters}
        onFiltersChange={setFilters}
        typeCounts={result.typeCounts}
        tags={kb.tags}
        tagCounts={result.tagCounts}
        prefs={prefs}
        onPrefsChange={updatePrefs}
        onQuickCapture={onQuickCapture}
      />

      <div className={styles.content}>
        <main className={styles.main}>
          {kb.error && <LoadError message={kb.error} onRetry={() => void kb.reload()} />}
          {view === 'items' && renderStream()}
          {view === 'graph' && (
            <div className={styles.graph}>
              <KnowledgeGraph
                index={linkIndex}
                related={related}
                focusId={selectedItemId}
                mode={graphMode}
                onModeChange={setGraphMode}
                onOpenItem={handleGraphOpen}
                onCreateNote={onCreateNote}
              />
            </div>
          )}
          {view === 'ask' && (
            <AskPanel
              conversation={conversation}
              onSelectItem={handleCitation}
              onOpenSettings={onOpenSettings}
            />
          )}
        </main>

        {prefs.inspectorOpen && (
          <Inspector
            item={selectedItem}
            kb={kb}
            activity={selectedItem ? activityByItem.get(selectedItem.id) : undefined}
            linkIndex={linkIndex}
            related={related}
            itemsById={itemsById}
            tagNameById={tagNameById}
            onSelectItem={onSelectItem}
            onOpenInWriting={onOpenInWriting}
            onCreateNote={onCreateNote}
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>
    </div>
  );
};

export default KnowledgeWorkspace;
