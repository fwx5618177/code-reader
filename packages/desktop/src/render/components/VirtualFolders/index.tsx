// ================================
// VirtualFolders 组件
// 虚拟文件夹和智能分组视图
// ================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  Tag,
  Clock,
  Star,
  Sparkles,
  Edit3,
  Trash2,
  Copy,
} from 'lucide-react';
import styles from './VirtualFolders.module.scss';
import {
  SMART_FOLDER_PRESETS,
  matchesAllRules,
  type FilterRule,
} from '../../lib/knowledge/filter-rules';
import type { KnowledgeItem } from '../../types/knowledge';
import { KNOWLEDGE_FOLDER_DRAG_TYPE, KNOWLEDGE_ITEM_DRAG_TYPE } from '../../lib/knowledge/drag';
import { loadExpandedFolders, saveExpandedFolders } from './expanded-folders';

// ================================
// 类型定义
// ================================

export interface VirtualFolder {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  type: 'manual' | 'smart' | 'auto';
  parentId?: string;
  itemCount: number;
  filterRules?: FilterRule[];
  children?: VirtualFolder[];
  isExpanded?: boolean;
}

interface VirtualFoldersProps {
  folders: VirtualFolder[];
  /** 全部知识条目（用于计算智能文件夹的条目数） */
  items: KnowledgeItem[];
  selectedFolderId?: string;
  onFolderSelect: (folderId: string) => void;
  onCreateFolder?: () => void;
  /** 在用户文件夹下新建子文件夹 */
  onCreateSubfolder?: (parentId: string) => void;
  onEditFolder?: (folder: VirtualFolder) => void;
  onDeleteFolder?: (folder: VirtualFolder) => void;
  /** 条目从条目流拖到用户文件夹上 */
  onDropItem?: (folderId: string, itemId: string) => void;
  /** 文件夹拖到另一个用户文件夹上（parentId 为 null 表示拖到「我的文件夹」根节点，即移到顶层） */
  onMoveFolder?: (folderId: string, parentId: string | null) => void;
  /** 拖动时判断目标是否可接收（如不能移到自身或子文件夹中） */
  canMoveFolder?: (folderId: string, parentId: string | null) => boolean;
}

// ================================
// 主组件
// ================================

const VirtualFolders: React.FC<VirtualFoldersProps> = ({
  folders,
  items,
  selectedFolderId,
  onFolderSelect,
  onCreateFolder,
  onCreateSubfolder,
  onEditFolder,
  onDeleteFolder,
  onDropItem,
  onMoveFolder,
  canMoveFolder,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(loadExpandedFolders);
  const [contextMenuFolder, setContextMenuFolder] = useState<string | null>(null);
  // 拖动条目或文件夹时悬停的文件夹
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // 正在拖动的文件夹：dragover 期间无法读取 dataTransfer 数据，用它判断目标是否可接收
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);

  useEffect(() => {
    saveExpandedFolders(expandedFolders);
  }, [expandedFolders]);

  // 切换文件夹展开状态
  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // 展开文件夹（新建子文件夹、拖入文件夹后让结果可见）
  const expandFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => (prev.has(folderId) ? prev : new Set(prev).add(folderId)));
  }, []);

  const endFolderDrag = useCallback(() => {
    setDraggingFolderId(null);
    setDropTargetId(null);
  }, []);

  // 获取文件夹图标
  const getFolderIcon = useCallback((folder: VirtualFolder, isExpanded: boolean) => {
    if (folder.icon === 'clock') return <Clock size={16} />;
    if (folder.icon === 'star') return <Star size={16} />;
    if (folder.icon === 'tag') return <Tag size={16} />;
    if (folder.icon === 'sparkles') return <Sparkles size={16} />;
    return isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />;
  }, []);

  // 合并智能文件夹和用户文件夹，智能文件夹的条目数按规则实时计算
  const allFolders = useMemo(() => {
    const smartFoldersWithCounts: VirtualFolder[] = SMART_FOLDER_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      type: 'smart',
      icon: preset.icon,
      filterRules: preset.rules.length > 0 ? preset.rules : undefined,
      itemCount: items.filter((item) => matchesAllRules(item, preset.rules)).length,
    }));

    return [
      {
        id: 'smart',
        name: '智能文件夹',
        type: 'smart' as const,
        itemCount: 0,
        children: smartFoldersWithCounts,
      },
      {
        id: 'user',
        name: '我的文件夹',
        type: 'manual' as const,
        itemCount: 0,
        children: folders,
      },
    ];
  }, [folders, items]);

  // 渲染文件夹项
  const renderFolder = useCallback(
    (folder: VirtualFolder, depth: number = 0) => {
      const isExpanded = expandedFolders.has(folder.id);
      const isSelected = selectedFolderId === folder.id;
      const hasChildren = folder.children && folder.children.length > 0;
      // 「智能文件夹」「我的文件夹」两个分组根节点：点击整行展开 / 折叠
      const isGroup = folder.id === 'smart' || folder.id === 'user';
      const isUserFolder = folder.type === 'manual' && !isGroup;
      // 只有用户文件夹可以接收拖入的条目
      const dropItem = isUserFolder ? onDropItem : undefined;
      // 用户文件夹与「我的文件夹」根节点可以接收拖入的文件夹
      const folderDropParent = isUserFolder ? folder.id : folder.id === 'user' ? null : undefined;
      const acceptsFolder =
        onMoveFolder !== undefined &&
        folderDropParent !== undefined &&
        draggingFolderId !== null &&
        draggingFolderId !== folder.id &&
        (canMoveFolder?.(draggingFolderId, folderDropParent) ?? true);
      const acceptsDrop = (types: readonly string[]): boolean =>
        (dropItem !== undefined && types.includes(KNOWLEDGE_ITEM_DRAG_TYPE)) ||
        (acceptsFolder && types.includes(KNOWLEDGE_FOLDER_DRAG_TYPE));

      const folderItemClasses = [
        styles.folderItem,
        isSelected && styles.folderItemSelected,
        folder.type === 'smart' && styles.folderItemSmart,
        dropTargetId === folder.id && styles.folderItemDropTarget,
        draggingFolderId === folder.id && styles.folderItemDragging,
      ]
        .filter(Boolean)
        .join(' ');

      const toggleClasses = [styles.folderToggle, !hasChildren && styles.folderToggleInvisible]
        .filter(Boolean)
        .join(' ');

      return (
        <div key={folder.id} className={styles.folderItemWrapper}>
          <div
            className={folderItemClasses}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            draggable={isUserFolder && onMoveFolder !== undefined}
            onClick={() => {
              if (isGroup && hasChildren) {
                toggleFolder(folder.id);
              }
              onFolderSelect(folder.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenuFolder(folder.id);
            }}
            onDragStart={
              isUserFolder && onMoveFolder
                ? (e) => {
                    e.dataTransfer.setData(KNOWLEDGE_FOLDER_DRAG_TYPE, folder.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingFolderId(folder.id);
                  }
                : undefined
            }
            onDragEnd={isUserFolder && onMoveFolder ? endFolderDrag : undefined}
            onDragOver={(e) => {
              if (!acceptsDrop(e.dataTransfer.types)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropTargetId(folder.id);
            }}
            onDragLeave={(e) => {
              // 移入子元素时不算离开
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDropTargetId(null);
              }
            }}
            onDrop={(e) => {
              setDropTargetId(null);
              if (!acceptsDrop(e.dataTransfer.types)) return;
              const movedFolderId = e.dataTransfer.getData(KNOWLEDGE_FOLDER_DRAG_TYPE);
              const itemId = e.dataTransfer.getData(KNOWLEDGE_ITEM_DRAG_TYPE);
              e.preventDefault();
              if (movedFolderId && acceptsFolder && folderDropParent !== undefined) {
                setDraggingFolderId(null);
                expandFolder(folder.id);
                onMoveFolder?.(movedFolderId, folderDropParent);
              } else if (itemId) {
                dropItem?.(folder.id, itemId);
              }
            }}
          >
            {/* 展开/折叠按钮 */}
            <span
              className={toggleClasses}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleFolder(folder.id);
              }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>

            {/* 文件夹图标 */}
            <span
              className={styles.folderIcon}
              style={
                folder.color
                  ? ({ '--folder-color': folder.color } as React.CSSProperties)
                  : undefined
              }
            >
              {getFolderIcon(folder, isExpanded)}
            </span>

            {/* 文件夹名称 */}
            <span className={styles.folderName}>{folder.name}</span>

            {/* 条目数量 */}
            {folder.itemCount > 0 && <span className={styles.folderCount}>{folder.itemCount}</span>}

            {/* 智能文件夹指示器 */}
            {folder.type === 'smart' && folder.filterRules && (
              <span className={styles.smartIndicator} title="智能文件夹">
                <Sparkles size={12} />
              </span>
            )}

            {/* 操作菜单 */}
            {folder.type !== 'smart' && folder.id !== 'smart' && folder.id !== 'user' && (
              <button
                className={styles.folderActionsBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenuFolder(contextMenuFolder === folder.id ? null : folder.id);
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            )}
          </div>

          {/* 上下文菜单（「我的文件夹」根节点不可重命名 / 删除） */}
          {contextMenuFolder === folder.id && folder.type === 'manual' && folder.id !== 'user' && (
            <div className={styles.folderContextMenu}>
              {onCreateSubfolder && (
                <button
                  className={styles.contextMenuItem}
                  onClick={() => {
                    expandFolder(folder.id);
                    onCreateSubfolder(folder.id);
                    setContextMenuFolder(null);
                  }}
                >
                  <FolderPlus size={14} />
                  <span>新建子文件夹</span>
                </button>
              )}
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  onEditFolder?.(folder);
                  setContextMenuFolder(null);
                }}
              >
                <Edit3 size={14} />
                <span>重命名</span>
              </button>
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  navigator.clipboard.writeText(folder.name);
                  setContextMenuFolder(null);
                }}
              >
                <Copy size={14} />
                <span>复制名称</span>
              </button>
              <div className={styles.menuDivider} />
              <button
                className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
                onClick={() => {
                  onDeleteFolder?.(folder);
                  setContextMenuFolder(null);
                }}
              >
                <Trash2 size={14} />
                <span>删除</span>
              </button>
            </div>
          )}

          {/* 子文件夹 */}
          {hasChildren && isExpanded && (
            <div className={styles.folderChildren}>
              {folder.children!.map((child) => renderFolder(child, depth + 1))}
            </div>
          )}
        </div>
      );
    },
    [
      expandedFolders,
      selectedFolderId,
      contextMenuFolder,
      dropTargetId,
      draggingFolderId,
      toggleFolder,
      expandFolder,
      endFolderDrag,
      getFolderIcon,
      onFolderSelect,
      onCreateSubfolder,
      onEditFolder,
      onDeleteFolder,
      onDropItem,
      onMoveFolder,
      canMoveFolder,
    ]
  );

  return (
    <div className={styles.virtualFolders}>
      {/* 头部 */}
      <div className={styles.foldersHeader}>
        <h3 className={styles.foldersTitle}>文件夹</h3>
        <div className={styles.headerActions}>
          {/* 添加文件夹按钮 */}
          <button className={styles.addFolderBtn} onClick={onCreateFolder} title="新建文件夹">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* 文件夹列表 */}
      <div className={styles.foldersList}>{allFolders.map((folder) => renderFolder(folder))}</div>

      {/* 空状态 */}
      {folders.length === 0 && (
        <div className={styles.emptyFolders}>
          <p className={styles.emptyText}>暂无自定义文件夹</p>
          <button className={styles.emptyCreateBtn} onClick={onCreateFolder}>
            <Plus size={14} />
            <span>创建文件夹</span>
          </button>
        </div>
      )}

      {/* 点击外部关闭上下文菜单 */}
      {contextMenuFolder && (
        <div className={styles.contextMenuBackdrop} onClick={() => setContextMenuFolder(null)} />
      )}
    </div>
  );
};

export default VirtualFolders;
