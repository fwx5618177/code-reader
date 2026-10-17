// ================================
// 条目详情面板：标题、操作、元信息、标签，以及 AI 解读 / 原始内容 / 关联 三个标签页
// ================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, BookOpen, ExternalLink, PenLine, Pin, Star, Trash2 } from 'lucide-react';
import type { KnowledgeItem } from '../../types/knowledge';
import type { ItemActivity } from '../../lib/agent/agentStore';
import type { UseKnowledgeBaseReturn } from '../../lib/knowledge/useKnowledgeBase';
import { isWritingDocument } from '../../lib/documents/constants';
import { listFolderPaths } from '../../lib/folders/types';
import { isReadableItem } from '../../lib/knowledge/open-target';
import { displayTitle, type LinkIndex, type RelatedLink } from '../../lib/links/link-index';
import { sourceHost } from '../../lib/reading';
import { parseWikiLinkInner } from '../../lib/markdown';
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';
import { openExternal } from '../ReadingWorkspace/system';
import { absoluteTime, formatFileSize } from './item-display';
import { TagEditor } from './TagEditor';
import { InspectorAiTab } from './InspectorAiTab';
import { InspectorContentTab } from './InspectorContentTab';
import { InspectorRelationsTab } from './InspectorRelationsTab';
import styles from './Inspector.module.scss';

type InspectorTab = 'ai' | 'content' | 'relations';

const TABS: { tab: InspectorTab; label: string }[] = [
  { tab: 'ai', label: 'AI 解读' },
  { tab: 'content', label: '原始内容' },
  { tab: 'relations', label: '关联' },
];

export interface InspectorProps {
  item?: KnowledgeItem;
  kb: UseKnowledgeBaseReturn;
  activity?: ItemActivity;
  linkIndex: LinkIndex;
  related: RelatedLink[];
  itemsById: ReadonlyMap<string, KnowledgeItem>;
  tagNameById: ReadonlyMap<string, string>;
  onSelectItem: (id: string | undefined) => void;
  onOpenInWriting: (itemId: string) => void;
  /** 在阅读模式中打开可阅读条目（PDF / EPUB / 网页剪藏等） */
  onOpenInReading: (itemId: string) => void;
  onCreateNote: (title: string) => void;
  /** 重命名条目（同时更新其他笔记中指向它的链接） */
  onRenameItem: (id: string, title: string) => Promise<void>;
  onOpenSettings: () => void;
}

interface InspectorBodyProps extends Omit<InspectorProps, 'item'> {
  item: KnowledgeItem;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
}

/** 可编辑标题：失焦或 Enter 保存，Esc 还原；保留原标题的扩展名（如 .md） */
const TitleInput: React.FC<{ title: string; onSave: (title: string) => Promise<void> }> = ({
  title,
  onSave,
}) => {
  const shown = displayTitle(title);
  const [draft, setDraft] = useState(shown);
  /** Esc 撤销编辑：随后的失焦不保存 */
  const cancelRef = useRef(false);

  // 标题被外部更新（如 Agent 或写作模式）时同步
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const next = draft.trim();
    if (cancelRef.current || !next) {
      cancelRef.current = false;
      setDraft(shown);
      return;
    }
    if (next !== shown) void onSave(next + title.slice(shown.length));
  };

  return (
    <input
      className={styles.titleInput}
      value={draft}
      aria-label="标题"
      placeholder="未命名"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
};

const InspectorBody: React.FC<InspectorBodyProps> = ({
  item,
  kb,
  activity,
  linkIndex,
  related,
  itemsById,
  tagNameById,
  onSelectItem,
  onOpenInWriting,
  onOpenInReading,
  onCreateNote,
  onRenameItem,
  onOpenSettings,
  tab,
  onTabChange,
}) => {
  const [actionError, setActionError] = useState<string | null>(null);
  const TypeIcon = ITEM_TYPE_ICONS[item.type];
  const tagNames = item.tagIds
    .map((id) => tagNameById.get(id))
    .filter((name): name is string => !!name);

  /** 执行写操作，失败时在面板内提示 */
  const run = useCallback(async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  /** 点击正文中的链接（目标#标题）：在知识库中选中目标，不存在时创建 */
  const handleWikiLink = useCallback(
    (ref: string) => {
      const target = parseWikiLinkInner(ref)?.target;
      if (!target) return;
      const resolved = linkIndex.resolve(target);
      if (resolved) onSelectItem(resolved.id);
      else onCreateNote(target);
    },
    [linkIndex, onSelectItem, onCreateNote]
  );

  const handleDelete = () => {
    if (!window.confirm(`确定删除「${displayTitle(item.title) || '未命名'}」吗？`)) return;
    void run(async () => {
      await kb.removeItem(item.id);
      onSelectItem(undefined);
    });
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <TypeIcon size={16} className={styles.titleIcon} aria-label={ITEM_TYPE_LABELS[item.type]} />
          <TitleInput title={item.title} onSave={(title) => run(() => onRenameItem(item.id, title))} />
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            data-active={item.isFavorite}
            data-kind="favorite"
            aria-pressed={item.isFavorite}
            title={item.isFavorite ? '取消收藏' : '收藏'}
            onClick={() => run(() => kb.updateItem(item.id, { isFavorite: !item.isFavorite }))}
          >
            <Star size={14} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            data-active={item.isPinned}
            aria-pressed={item.isPinned}
            title={item.isPinned ? '取消置顶' : '置顶'}
            onClick={() => run(() => kb.updateItem(item.id, { isPinned: !item.isPinned }))}
          >
            <Pin size={14} />
          </button>
          {isWritingDocument(item) && (
            <button type="button" className={styles.button} onClick={() => onOpenInWriting(item.id)}>
              <PenLine size={13} />
              在写作中打开
            </button>
          )}
          {isReadableItem(item) && (
            <button type="button" className={styles.button} onClick={() => onOpenInReading(item.id)}>
              <BookOpen size={13} />
              在阅读模式中打开
            </button>
          )}
          <div className={styles.actionsSpacer} />
          <button
            type="button"
            className={styles.iconButton}
            data-kind="danger"
            title="删除"
            onClick={handleDelete}
          >
            <Trash2 size={14} />
          </button>
        </div>

        {actionError && (
          <p className={styles.hint} data-kind="error" role="alert">
            <AlertCircle size={13} />
            操作失败：{actionError}
          </p>
        )}

        <dl className={styles.meta}>
          <dt>类型</dt>
          <dd>{ITEM_TYPE_LABELS[item.type]}</dd>
          <dt>文件夹</dt>
          <dd>
            <select
              className={styles.folderSelect}
              aria-label="移动到文件夹"
              value={item.folderId ?? ''}
              onChange={(event) =>
                void run(() => kb.updateItem(item.id, { folderId: event.target.value || null }))
              }
            >
              <option value="">未归档</option>
              {listFolderPaths(kb.folders).map(({ id, path }) => (
                <option key={id} value={id}>
                  {path}
                </option>
              ))}
            </select>
          </dd>
          <dt>创建</dt>
          <dd>{absoluteTime(item.createdAt)}</dd>
          <dt>更新</dt>
          <dd>{absoluteTime(item.updatedAt)}</dd>
          {item.fileSize !== undefined && item.fileSize > 0 && (
            <>
              <dt>大小</dt>
              <dd>{formatFileSize(item.fileSize)}</dd>
            </>
          )}
          {item.sourceUrl && (
            <>
              <dt>来源</dt>
              <dd>
                <button
                  type="button"
                  className={styles.sourceLink}
                  title={item.sourceUrl}
                  onClick={() => item.sourceUrl && openExternal(item.sourceUrl)}
                >
                  {sourceHost(item.sourceUrl)}
                  <ExternalLink size={11} />
                </button>
              </dd>
            </>
          )}
        </dl>

        <TagEditor
          names={tagNames}
          allTags={kb.tags}
          onChange={(names) => void run(() => kb.setItemTags(item.id, names))}
        />
      </header>

      <div className={styles.tabs} role="tablist" aria-label="详情">
        {TABS.map(({ tab: value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={styles.tab}
            onClick={() => onTabChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.body} role="tabpanel">
        {tab === 'ai' && <InspectorAiTab item={item} activity={activity} onOpenSettings={onOpenSettings} />}
        {tab === 'content' && <InspectorContentTab item={item} onWikiLink={handleWikiLink} />}
        {tab === 'relations' && (
          <InspectorRelationsTab
            item={item}
            linkIndex={linkIndex}
            related={related}
            itemsById={itemsById}
            onSelectItem={onSelectItem}
            onCreateNote={onCreateNote}
          />
        )}
      </div>
    </>
  );
};

export const Inspector: React.FC<InspectorProps> = ({ item, ...rest }) => {
  // 切换条目时保留当前标签页
  const [tab, setTab] = useState<InspectorTab>('ai');

  return (
    <aside className={styles.inspector} aria-label="条目详情">
      {item ? (
        <InspectorBody key={item.id} item={item} tab={tab} onTabChange={setTab} {...rest} />
      ) : (
        <div className={styles.placeholder}>选择一个条目查看详情</div>
      )}
    </aside>
  );
};
