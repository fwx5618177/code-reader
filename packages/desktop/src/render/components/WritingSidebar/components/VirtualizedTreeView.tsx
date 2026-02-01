// ================================
// VirtualizedTreeView 组件
// 使用 react-window v2 实现高效树渲染
// 支持拖放、文件夹选择和 VSCode 风格交互
// ================================

import React, { memo, useMemo, useRef, useEffect, useState, useReducer, useCallback } from 'react';
import { List, useListRef } from 'react-window';
import type { ListImperativeAPI } from 'react-window';
import {
  FlatFileTreeNode,
  DragItem,
  DropTarget,
  DragState,
  initialDragState,
  dragReducer,
  validateDrop,
} from '../../../lib/file-system';
import TreeNodeItem from './TreeNodeItem';
import styles from '../WritingSidebar.module.scss';

// ================================
// Constants
// ================================

const ITEM_HEIGHT = 28; // Height of each tree node in pixels
const DEFAULT_HEIGHT = 400; // Default list height
const MIN_HEIGHT = 100; // Minimum list height

// ================================
// Types
// ================================

export interface NodeWithMeta {
  flatNode: FlatFileTreeNode;
  isFavorite?: boolean;
  isPinned?: boolean;
}

export interface VirtualizedTreeViewProps {
  /** Nodes with metadata to render */
  nodes: NodeWithMeta[];
  /** Height of the container (optional, will auto-size if not provided) */
  height?: number;
  /** Width of the container (optional, defaults to 100%) */
  width?: number | string;
  /** Check if a node is expanded */
  isExpanded: (id: string) => boolean;
  /** Check if a node is selected */
  isSelected: (id: string) => boolean;
  /** Toggle expand/collapse */
  onToggleExpand: (id: string) => void;
  /** Select a node */
  onSelect: (id: string) => void;
  /** Start editing (rename) */
  onStartEdit: (id: string, currentName: string) => void;
  /** Delete a node */
  onDelete: (id: string, name: string, type: 'folder' | 'document') => void;
  /** Create subfolder */
  onCreateSubfolder: (parentId: string) => void;
  /** Create document in folder */
  onCreateDocument: (folderId: string) => void;
  /** ID to scroll into view */
  scrollToId?: string | null;
  /** Get ancestor IDs for a node */
  getAncestors?: (id: string) => string[];
  /** Callback when a node is moved via drag-drop */
  onMoveNode?: (
    sourceId: string,
    targetId: string,
    position: 'before' | 'inside' | 'after'
  ) => void;
}

// ================================
// Row Data type (passed via rowProps)
// ================================

interface TreeRowData {
  nodes: NodeWithMeta[];
  dragState: DragState;
  isExpanded: (id: string) => boolean;
  isSelected: (id: string) => boolean;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onStartEdit: (id: string, currentName: string) => void;
  onDelete: (id: string, name: string, type: 'folder' | 'document') => void;
  onCreateSubfolder: (parentId: string) => void;
  onCreateDocument: (folderId: string) => void;
  onDragStart: (item: DragItem) => void;
  onDragEnd: () => void;
  onDragEnter: (target: DropTarget) => void;
  onDragLeave: () => void;
  onDrop: (item: DragItem, target: DropTarget) => void;
  getAncestors: (id: string) => string[];
}

// ================================
// Row Component for react-window v2
// Must return ReactElement (not null) to satisfy react-window types
// ================================

interface TreeRowProps extends TreeRowData {
  index: number;
  style: React.CSSProperties;
  ariaAttributes?: {
    'aria-posinset': number;
    'aria-setsize': number;
    role: 'listitem';
  };
}

function TreeRow({
  index,
  style,
  nodes,
  dragState,
  isExpanded,
  isSelected,
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
}: TreeRowProps): React.ReactElement {
  const nodeData = nodes[index];

  // Return empty div if no node data (react-window requires ReactElement)
  if (!nodeData) {
    return <div style={style} />;
  }

  const { flatNode, isFavorite, isPinned } = nodeData;
  const nodeId = flatNode.node.id;

  // Ensure the row style allows for proper interaction
  const rowStyle: React.CSSProperties = {
    ...style,
    // Ensure pointer events work
    pointerEvents: 'auto',
    // Use content-box to avoid height calculation issues
    boxSizing: 'border-box',
  };

  return (
    <TreeNodeItem
      flatNode={flatNode}
      isExpanded={isExpanded(nodeId)}
      isNodeSelected={isSelected(nodeId)}
      isFavorite={isFavorite}
      isPinned={isPinned}
      style={rowStyle}
      dragState={dragState}
      onToggleExpand={onToggleExpand}
      onSelect={onSelect}
      onStartEdit={onStartEdit}
      onDelete={onDelete}
      onCreateSubfolder={onCreateSubfolder}
      onCreateDocument={onCreateDocument}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      getAncestors={getAncestors}
    />
  );
}

// ================================
// Main Component
// ================================

const VirtualizedTreeView: React.FC<VirtualizedTreeViewProps> = ({
  nodes,
  height,
  width = '100%',
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelect,
  onStartEdit,
  onDelete,
  onCreateSubfolder,
  onCreateDocument,
  scrollToId,
  getAncestors: getAncestorsProp,
  onMoveNode,
}) => {
  const listRef = useListRef();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(height ?? DEFAULT_HEIGHT);

  // Drag and drop state management
  const [dragState, dispatchDrag] = useReducer(dragReducer, initialDragState);

  // ================================
  // Ancestor Lookup
  // ================================

  // Create a map for quick ancestor lookup
  const ancestorMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { flatNode } of nodes) {
      map.set(flatNode.node.id, flatNode.ancestors);
    }
    return map;
  }, [nodes]);

  const getAncestors = useCallback(
    (id: string): string[] => {
      if (getAncestorsProp) {
        return getAncestorsProp(id);
      }
      return ancestorMap.get(id) ?? [];
    },
    [getAncestorsProp, ancestorMap]
  );

  // ================================
  // Drag and Drop Callbacks
  // ================================

  const handleDragStart = useCallback((item: DragItem) => {
    dispatchDrag({ type: 'START_DRAG', item });
  }, []);

  const handleDragEnd = useCallback(() => {
    dispatchDrag({ type: 'END_DRAG' });
  }, []);

  const handleDragEnter = useCallback(
    (target: DropTarget) => {
      // Validate the drop
      const draggingId = dragState.draggingId;
      if (!draggingId) {
        dispatchDrag({ type: 'SET_DROP_TARGET', target, canDrop: false });
        return;
      }

      // Find the drag item
      const dragNode = nodes.find((n) => n.flatNode.node.id === draggingId);
      if (!dragNode) {
        dispatchDrag({ type: 'SET_DROP_TARGET', target, canDrop: false });
        return;
      }

      const dragItem: DragItem = {
        id: draggingId,
        type: dragNode.flatNode.node.type === 2 ? 'folder' : 'file',
        name: dragNode.flatNode.node.name,
        parentId: dragNode.flatNode.node.parentId,
        path: dragNode.flatNode.node.uri.path,
      };

      const validation = validateDrop(
        dragItem,
        target.id,
        target.type,
        target.position,
        getAncestors
      );

      dispatchDrag({ type: 'SET_DROP_TARGET', target, canDrop: validation.valid });
    },
    [dragState.draggingId, nodes, getAncestors]
  );

  const handleDragLeave = useCallback(() => {
    dispatchDrag({ type: 'CLEAR_DROP_TARGET' });
  }, []);

  const handleDrop = useCallback(
    (item: DragItem, target: DropTarget) => {
      // Validate again before executing
      const validation = validateDrop(item, target.id, target.type, target.position, getAncestors);

      if (validation.valid && onMoveNode) {
        onMoveNode(item.id, target.id, target.position);
      }

      dispatchDrag({ type: 'END_DRAG' });
    },
    [getAncestors, onMoveNode]
  );

  // ================================
  // Container Height Management
  // ================================

  // Auto-size height based on container
  useEffect(() => {
    if (height !== undefined) {
      setContainerHeight(height);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      const parent = container.parentElement;
      if (parent) {
        // Get available height from parent
        const rect = parent.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(parent);
        const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
        const availableHeight = rect.height - paddingTop - paddingBottom;

        // Account for "All Documents" row height (~36px)
        const adjustedHeight = Math.max(availableHeight - 36, MIN_HEIGHT);

        // Use natural height if fewer items, otherwise use container height
        const naturalHeight = nodes.length * ITEM_HEIGHT;
        setContainerHeight(Math.min(naturalHeight, adjustedHeight));
      }
    };

    updateHeight();

    // Use ResizeObserver for responsive updates
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(updateHeight);
    });

    if (container.parentElement) {
      resizeObserver.observe(container.parentElement);
    }

    return () => resizeObserver.disconnect();
  }, [height, nodes.length]);

  // ================================
  // Scroll to Item
  // ================================

  // Scroll to specific item when scrollToId changes
  useEffect(() => {
    if (!scrollToId || !listRef.current) return;

    const index = nodes.findIndex((n) => n.flatNode.node.id === scrollToId);
    if (index >= 0) {
      // Delay to ensure the list is rendered
      requestAnimationFrame(() => {
        listRef.current?.scrollToRow({
          index,
          align: 'smart',
          behavior: 'smooth',
        });
      });
    }
  }, [scrollToId, nodes, listRef]);

  // ================================
  // Memoized Row Props
  // ================================

  // Create stable callback wrappers
  const callbacks = useMemo(
    () => ({
      isExpanded,
      isSelected,
      onToggleExpand,
      onSelect,
      onStartEdit,
      onDelete,
      onCreateSubfolder,
      onCreateDocument,
    }),
    [
      isExpanded,
      isSelected,
      onToggleExpand,
      onSelect,
      onStartEdit,
      onDelete,
      onCreateSubfolder,
      onCreateDocument,
    ]
  );

  // Memoize row props to prevent unnecessary re-renders
  const rowProps: TreeRowData = useMemo(
    () => ({
      nodes,
      dragState,
      isExpanded: callbacks.isExpanded,
      isSelected: callbacks.isSelected,
      onToggleExpand: callbacks.onToggleExpand,
      onSelect: callbacks.onSelect,
      onStartEdit: callbacks.onStartEdit,
      onDelete: callbacks.onDelete,
      onCreateSubfolder: callbacks.onCreateSubfolder,
      onCreateDocument: callbacks.onCreateDocument,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      getAncestors,
    }),
    [
      nodes,
      dragState,
      callbacks,
      handleDragStart,
      handleDragEnd,
      handleDragEnter,
      handleDragLeave,
      handleDrop,
      getAncestors,
    ]
  );

  // ================================
  // Render
  // ================================

  // If no nodes, don't render the list
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`${styles.virtualizedTreeView} ${dragState.isDragging ? styles.isDraggingActive : ''}`}
      style={{
        width,
        height: containerHeight,
        position: 'relative',
        overflow: 'visible', // 允许上下文菜单溢出
      }}
      role="tree"
      aria-label="文档树"
    >
      <List<TreeRowData>
        listRef={listRef as React.RefObject<ListImperativeAPI>}
        className={styles.virtualizedTreeList}
        style={{
          height: containerHeight,
          width: '100%',
          overflowX: 'hidden',
          overflowY: 'auto',
        }}
        rowComponent={TreeRow}
        rowCount={nodes.length}
        rowHeight={ITEM_HEIGHT}
        rowProps={rowProps}
        overscanCount={5}
      />
    </div>
  );
};

VirtualizedTreeView.displayName = 'VirtualizedTreeView';

export default memo(VirtualizedTreeView);

export { ITEM_HEIGHT };
