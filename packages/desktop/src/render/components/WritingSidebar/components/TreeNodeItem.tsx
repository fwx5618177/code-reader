// ================================
// TreeNodeItem 组件
// 文件夹和文档的独立树节点
// 支持拖放、文件夹选择和 VSCode 风格交互
// 使用 ContextMenuPortal 避免溢出裁剪问题
// ================================

import React, { useState, useCallback, useRef, memo, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Edit2,
  Trash2,
  FolderPlus,
  FileText,
  Star,
  Pin,
  FilePlus,
} from 'lucide-react';
import {
  FlatFileTreeNode,
  FileType,
  FileTreeNode,
  DragItem,
  DropTarget,
  DragState,
  getDragClasses,
  setDragData,
  getDragData,
  hasDragData,
  calculateDropPosition,
  validateDrop,
  getDropEffect,
  createDragPreview,
  setDragPreview,
} from '../../../lib/file-system';
import { ContextMenuPortal } from '../../../lib/utils';
import styles from '../WritingSidebar.module.scss';

// ================================
// Constants
// ================================

/** 支持的文档扩展名列表 */
const DOCUMENT_EXTENSIONS = ['.md', '.tex', '.txt', '.markdown'];

/**
 * 获取文件名中的扩展名（如果是支持的类型）
 */
function getDocumentExtension(filename: string): string | null {
  for (const ext of DOCUMENT_EXTENSIONS) {
    if (filename.endsWith(ext)) {
      return ext;
    }
  }
  return null;
}

/**
 * 移除文件名中的文档扩展名用于编辑
 */
function removeExtensionForEdit(filename: string): string {
  const ext = getDocumentExtension(filename);
  if (ext) {
    return filename.slice(0, -ext.length);
  }
  return filename;
}

// ================================
// Types
// ================================

export interface TreeNodeItemProps {
  flatNode: FlatFileTreeNode;
  isExpanded: boolean;
  /** Whether this node is currently selected - passed from parent for accurate state */
  isNodeSelected?: boolean;
  isFavorite?: boolean;
  isPinned?: boolean;
  style?: React.CSSProperties;
  /** Current drag state for the entire tree */
  dragState?: DragState;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onStartEdit: (id: string, currentName: string) => void;
  onDelete: (id: string, name: string, type: 'folder' | 'document') => void;
  onCreateSubfolder: (parentId: string) => void;
  onCreateDocument: (folderId: string) => void;
  /** Drag callbacks */
  onDragStart?: (item: DragItem) => void;
  onDragEnd?: () => void;
  onDragEnter?: (target: DropTarget) => void;
  onDragLeave?: () => void;
  onDrop?: (item: DragItem, target: DropTarget) => void;
  /** Get ancestor IDs for a node (for drop validation) */
  getAncestors?: (id: string) => string[];
}

// ================================
// Helper Functions
// ================================

/**
 * Get display name from file tree node
 */
function getDisplayName(node: FileTreeNode): string {
  return node.name || (node.type === FileType.File ? '无标题' : '未命名文件夹');
}

/**
 * Check if node is a folder
 */
function isFolder(node: FileTreeNode): boolean {
  return node.type === FileType.Directory;
}

/**
 * Get node type string
 */
function getNodeType(node: FileTreeNode): 'file' | 'folder' {
  return isFolder(node) ? 'folder' : 'file';
}

// ================================
// Context Menu Content Component
// ================================

interface ContextMenuContentProps {
  nodeIsFolder: boolean;
  onCreateDocumentInFolder: (e: React.MouseEvent) => void;
  onCreateSubfolder: (e: React.MouseEvent) => void;
  onStartEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

const ContextMenuContent: React.FC<ContextMenuContentProps> = memo(
  ({ nodeIsFolder, onCreateDocumentInFolder, onCreateSubfolder, onStartEdit, onDelete }) => (
    <>
      {nodeIsFolder && (
        <>
          <button className={styles.menuButton} onClick={onCreateDocumentInFolder} role="menuitem">
            <FilePlus size={12} />
            <span>新建文档</span>
          </button>
          <button className={styles.menuButton} onClick={onCreateSubfolder} role="menuitem">
            <FolderPlus size={12} />
            <span>新建子文件夹</span>
          </button>
          <div className={styles.menuDivider} />
        </>
      )}
      <button className={styles.menuButton} onClick={onStartEdit} role="menuitem">
        <Edit2 size={12} />
        <span>重命名</span>
      </button>
      <button
        className={`${styles.menuButton} ${styles.menuButtonDanger}`}
        onClick={onDelete}
        role="menuitem"
      >
        <Trash2 size={12} />
        <span>删除</span>
      </button>
    </>
  )
);

ContextMenuContent.displayName = 'ContextMenuContent';

// ================================
// Component
// ================================

const TreeNodeItem: React.FC<TreeNodeItemProps> = memo(
  ({
    flatNode,
    isExpanded,
    isNodeSelected,
    isFavorite,
    isPinned,
    style,
    dragState,
    onToggleExpand,
    onSelect,
    onStartEdit,
    onDelete,
    onCreateSubfolder,
    onCreateDocument,
    onDragStart,
    onDragEnd,
    onDragEnter,
    onDragLeave,
    onDrop,
    getAncestors,
  }) => {
    const { node, depth } = flatNode;
    // Use prop if provided, otherwise fall back to node's isSelected (for backwards compatibility)
    const isSelected = isNodeSelected ?? node.isSelected;
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
    const nodeRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);

    const nodeIsFolder = isFolder(node);
    const nodeType = getNodeType(node);
    const hasChildren = (node.childIds?.length ?? 0) > 0;

    // ================================
    // Drag State Classes
    // ================================

    const dragClasses = useMemo(() => {
      if (!dragState) return [];
      return getDragClasses(node.id, dragState);
    }, [node.id, dragState]);

    // ================================
    // Context Menu Handlers
    // ================================

    const closeContextMenu = useCallback(() => {
      setShowContextMenu(false);
      setMenuPosition(null);
    }, []);

    // ================================
    // Click Handlers
    // ================================

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Select the node (works for both files and folders)
        onSelect(node.id);
      },
      [node.id, onSelect]
    );

    const handleDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (nodeIsFolder) {
          onToggleExpand(node.id);
        }
      },
      [nodeIsFolder, node.id, onToggleExpand]
    );

    const handleToggle = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (nodeIsFolder) {
          onToggleExpand(node.id);
        }
      },
      [nodeIsFolder, node.id, onToggleExpand]
    );

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Position menu at mouse cursor
      setMenuPosition({
        top: e.clientY,
        left: e.clientX,
      });
      setShowContextMenu(true);
    }, []);

    const handleMenuClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (showContextMenu) {
          closeContextMenu();
        } else {
          // Position menu relative to button
          const button = menuButtonRef.current;
          if (button) {
            const rect = button.getBoundingClientRect();
            setMenuPosition({
              top: rect.bottom + 4,
              left: Math.max(8, rect.right - 160), // 160px is min-width of menu
            });
          }
          setShowContextMenu(true);
        }
      },
      [showContextMenu, closeContextMenu]
    );

    // ================================
    // Menu Action Handlers
    // ================================

    const handleStartEdit = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        // 移除文档扩展名用于编辑（支持 .md, .tex 等）
        const editName = removeExtensionForEdit(node.name);
        onStartEdit(node.id, editName);
      },
      [node.id, node.name, onStartEdit, closeContextMenu]
    );

    const handleDelete = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        onDelete(node.id, node.name, nodeIsFolder ? 'folder' : 'document');
      },
      [node.id, node.name, nodeIsFolder, onDelete, closeContextMenu]
    );

    const handleCreateSubfolder = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        onCreateSubfolder(node.id);
      },
      [node.id, onCreateSubfolder, closeContextMenu]
    );

    const handleCreateDocumentInFolder = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        onCreateDocument(node.id);
      },
      [node.id, onCreateDocument, closeContextMenu]
    );

    // ================================
    // Keyboard Navigation
    // ================================

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        switch (e.key) {
          case 'Enter':
            e.preventDefault();
            onSelect(node.id);
            break;
          case ' ':
            e.preventDefault();
            if (nodeIsFolder) {
              onToggleExpand(node.id);
            } else {
              onSelect(node.id);
            }
            break;
          case 'ArrowRight':
            if (nodeIsFolder) {
              e.preventDefault();
              if (!isExpanded) {
                onToggleExpand(node.id);
              }
            }
            break;
          case 'ArrowLeft':
            if (nodeIsFolder && isExpanded) {
              e.preventDefault();
              onToggleExpand(node.id);
            }
            break;
          case 'F2':
            e.preventDefault();
            // 移除文档扩展名用于编辑（支持 .md, .tex 等）
            const editName = removeExtensionForEdit(node.name);
            onStartEdit(node.id, editName);
            break;
          case 'Delete':
          case 'Backspace':
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              onDelete(node.id, node.name, nodeIsFolder ? 'folder' : 'document');
            }
            break;
        }
      },
      [
        node.id,
        node.name,
        nodeIsFolder,
        isExpanded,
        onSelect,
        onToggleExpand,
        onStartEdit,
        onDelete,
      ]
    );

    // ================================
    // Drag and Drop Handlers
    // ================================

    const handleDragStart = useCallback(
      (e: React.DragEvent) => {
        e.stopPropagation();

        const dragItem: DragItem = {
          id: node.id,
          type: nodeType,
          name: node.name,
          parentId: node.parentId,
          path: node.uri.path,
        };

        setDragData(e.dataTransfer, dragItem);

        // Create and set custom preview
        const preview = createDragPreview(node.name, nodeType);
        setDragPreview(e.dataTransfer, preview);

        onDragStart?.(dragItem);
      },
      [node, nodeType, onDragStart]
    );

    const handleDragEnd = useCallback(
      (e: React.DragEvent) => {
        e.stopPropagation();
        onDragEnd?.();
      },
      [onDragEnd]
    );

    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!hasDragData(e.dataTransfer)) return;

        const position = calculateDropPosition(e, e.currentTarget as HTMLElement, nodeIsFolder);

        const dropTarget: DropTarget = {
          id: node.id,
          type: nodeType,
          position,
        };

        // Validate drop
        const dragData = getDragData(e.dataTransfer);
        if (dragData && getAncestors) {
          const validation = validateDrop(dragData, node.id, nodeType, position, getAncestors);
          e.dataTransfer.dropEffect = getDropEffect(e, validation.valid);
        }

        onDragEnter?.(dropTarget);
      },
      [node.id, nodeType, nodeIsFolder, onDragEnter, getAncestors]
    );

    const handleDragEnterEvent = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    }, []);

    const handleDragLeaveEvent = useCallback(
      (e: React.DragEvent) => {
        e.stopPropagation();

        // Only leave if we're actually leaving this element
        const relatedTarget = e.relatedTarget as Node | null;
        const currentTarget = e.currentTarget as Node;
        if (relatedTarget && currentTarget.contains(relatedTarget)) {
          return;
        }

        onDragLeave?.();
      },
      [onDragLeave]
    );

    const handleDropEvent = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const dragData = getDragData(e.dataTransfer);
        if (!dragData) return;

        const position = calculateDropPosition(e, e.currentTarget as HTMLElement, nodeIsFolder);

        const dropTarget: DropTarget = {
          id: node.id,
          type: nodeType,
          position,
        };

        // Validate before executing
        if (getAncestors) {
          const validation = validateDrop(dragData, node.id, nodeType, position, getAncestors);

          if (validation.valid) {
            onDrop?.(dragData, dropTarget);
          }
        } else {
          // No validation available, allow drop
          onDrop?.(dragData, dropTarget);
        }
      },
      [node.id, nodeType, nodeIsFolder, onDrop, getAncestors]
    );

    // ================================
    // Render Icon
    // ================================

    const renderIcon = () => {
      if (nodeIsFolder) {
        return isExpanded ? (
          <FolderOpen size={14} className={`${styles.nodeIcon} ${styles.folderIcon}`} />
        ) : (
          <Folder size={14} className={`${styles.nodeIcon} ${styles.folderIcon}`} />
        );
      }

      // 文档图标和指示器
      return (
        <span className={`${styles.nodeIcon} ${styles.documentIconWrapper}`}>
          <FileText size={14} className={`${styles.nodeIcon} ${styles.documentIcon}`} />
          {isPinned && <Pin size={8} className={`${styles.indicator} ${styles.pinned}`} />}
          {isFavorite && <Star size={8} className={`${styles.indicator} ${styles.favorite}`} />}
        </span>
      );
    };

    const displayName = getDisplayName(node);

    // 构建 CSS 类名
    const classNames = [
      styles.treeNode,
      nodeIsFolder ? styles.folder : styles.document,
      isSelected ? styles.selected : '',
      // 拖放状态类名映射
      dragClasses.includes('is-dragging') ? styles.isDragging : '',
      dragClasses.includes('is-drag-over') ? styles.isDragOver : '',
      dragClasses.includes('can-drop') ? styles.canDrop : '',
      dragClasses.includes('cannot-drop') ? styles.cannotDrop : '',
      dragClasses.includes('drop-position-before') ? styles.dropPositionBefore : '',
      dragClasses.includes('drop-position-after') ? styles.dropPositionAfter : '',
      dragClasses.includes('drop-position-inside') ? styles.dropPositionInside : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Merge inline style with padding for depth
    const nodeStyle: React.CSSProperties = {
      ...style,
      paddingLeft: `${depth * 16 + 8}px`,
    };

    // Check if drag-drop is enabled
    const isDragEnabled = Boolean(onDragStart && onDragEnd && onDrop);

    return (
      <>
        <div
          ref={nodeRef}
          className={classNames}
          style={nodeStyle}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={nodeIsFolder ? isExpanded : undefined}
          tabIndex={0}
          // Drag and drop props
          draggable={isDragEnabled}
          onDragStart={isDragEnabled ? handleDragStart : undefined}
          onDragEnd={isDragEnabled ? handleDragEnd : undefined}
          onDragOver={isDragEnabled ? handleDragOver : undefined}
          onDragEnter={isDragEnabled ? handleDragEnterEvent : undefined}
          onDragLeave={isDragEnabled ? handleDragLeaveEvent : undefined}
          onDrop={isDragEnabled ? handleDropEvent : undefined}
        >
          {/* 文件夹展开/折叠切换 */}
          <button
            className={styles.nodeToggle}
            onClick={handleToggle}
            style={{ visibility: nodeIsFolder && hasChildren ? 'visible' : 'hidden' }}
            aria-label={isExpanded ? '折叠' : '展开'}
            tabIndex={-1}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          {/* 图标 */}
          {renderIcon()}

          {/* 名称 */}
          <span className={styles.nodeName} title={displayName}>
            {displayName}
          </span>

          {/* 文件夹子项计数徽章 */}
          {nodeIsFolder && hasChildren && (
            <span className={styles.nodeBadge}>{node.childIds?.length ?? 0}</span>
          )}

          {/* 上下文菜单触发器 */}
          <button
            ref={menuButtonRef}
            className={styles.nodeMenuBtn}
            onClick={handleMenuClick}
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={showContextMenu}
            tabIndex={-1}
          >
            <MoreHorizontal size={12} />
          </button>
        </div>

        {/* 上下文菜单 - 通过 Portal 渲染以避免溢出裁剪 */}
        <ContextMenuPortal
          isOpen={showContextMenu}
          position={menuPosition}
          onClose={closeContextMenu}
          className={styles.nodeContextMenu}
        >
          <ContextMenuContent
            nodeIsFolder={nodeIsFolder}
            onCreateDocumentInFolder={handleCreateDocumentInFolder}
            onCreateSubfolder={handleCreateSubfolder}
            onStartEdit={handleStartEdit}
            onDelete={handleDelete}
          />
        </ContextMenuPortal>
      </>
    );
  }
);

TreeNodeItem.displayName = 'TreeNodeItem';

export default TreeNodeItem;
