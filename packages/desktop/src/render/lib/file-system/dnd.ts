// ================================
// Drag and Drop Module
// VSCode-style file tree drag and drop implementation
// Provides utilities for HTML5 drag and drop operations
// ================================

// ================================
// Types
// ================================

/**
 * Drag data transfer format
 */
export const DND_MIME_TYPE = 'application/x-file-tree-node';

/**
 * Drag item data
 */
export interface DragItem {
  /** Node ID being dragged */
  id: string;
  /** Node type */
  type: 'file' | 'folder';
  /** Node name */
  name: string;
  /** Parent ID (null for root items) */
  parentId: string | null;
  /** URI path */
  path: string;
}

/**
 * Drop target info
 */
export interface DropTarget {
  /** Target node ID */
  id: string;
  /** Target type */
  type: 'file' | 'folder';
  /** Drop position relative to target */
  position: DropPosition;
}

/**
 * Drop position relative to target node
 */
export type DropPosition = 'before' | 'inside' | 'after';

/**
 * Drag state for UI rendering
 */
export interface DragState {
  /** Whether a drag is in progress */
  isDragging: boolean;
  /** ID of the node being dragged */
  draggingId: string | null;
  /** Current drop target */
  dropTarget: DropTarget | null;
  /** Whether the current drop is valid */
  canDrop: boolean;
}

/**
 * Initial drag state
 */
export const initialDragState: DragState = {
  isDragging: false,
  draggingId: null,
  dropTarget: null,
  canDrop: false,
};

// ================================
// Drag Data Utilities
// ================================

/**
 * Set drag data on the data transfer object
 */
export function setDragData(
  dataTransfer: DataTransfer,
  item: DragItem
): void {
  dataTransfer.setData(DND_MIME_TYPE, JSON.stringify(item));
  // Also set text for external drops
  dataTransfer.setData('text/plain', item.name);
  dataTransfer.effectAllowed = 'move';
}

/**
 * Get drag data from the data transfer object
 */
export function getDragData(dataTransfer: DataTransfer): DragItem | null {
  try {
    const data = dataTransfer.getData(DND_MIME_TYPE);
    if (!data) return null;
    return JSON.parse(data) as DragItem;
  } catch {
    return null;
  }
}

/**
 * Check if the data transfer has our drag data type
 */
export function hasDragData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(DND_MIME_TYPE);
}

// ================================
// Drop Position Calculation
// ================================

/**
 * Calculate drop position based on mouse position within element
 */
export function calculateDropPosition(
  event: React.DragEvent | DragEvent,
  element: HTMLElement,
  targetIsFolder: boolean
): DropPosition {
  const rect = element.getBoundingClientRect();
  const mouseY = event.clientY;
  const relativeY = mouseY - rect.top;
  const height = rect.height;

  // For folders, we have 3 zones: before (25%), inside (50%), after (25%)
  // For files, we have 2 zones: before (50%), after (50%)
  if (targetIsFolder) {
    const threshold = height * 0.25;
    if (relativeY < threshold) {
      return 'before';
    } else if (relativeY > height - threshold) {
      return 'after';
    } else {
      return 'inside';
    }
  } else {
    // Files can only have before/after
    return relativeY < height / 2 ? 'before' : 'after';
  }
}

// ================================
// Drop Validation
// ================================

/**
 * Validate if a drop is allowed
 */
export function validateDrop(
  dragItem: DragItem,
  targetId: string,
  targetType: 'file' | 'folder',
  position: DropPosition,
  getAncestors: (id: string) => string[]
): { valid: boolean; reason?: string } {
  // Can't drop on itself
  if (dragItem.id === targetId) {
    return { valid: false, reason: 'Cannot drop item on itself' };
  }

  // Can't drop inside a file
  if (targetType === 'file' && position === 'inside') {
    return { valid: false, reason: 'Cannot drop inside a file' };
  }

  // Can't drop a folder into its own descendants
  if (dragItem.type === 'folder') {
    const targetAncestors = getAncestors(targetId);
    if (targetAncestors.includes(dragItem.id)) {
      return { valid: false, reason: 'Cannot drop folder into its own descendant' };
    }
  }

  // Can't drop before/after if already in the same position
  // (This would be a no-op, but we allow it for now)

  return { valid: true };
}

// ================================
// Drop Effect
// ================================

/**
 * Get the appropriate drop effect
 */
export function getDropEffect(
  event: React.DragEvent | DragEvent,
  canDrop: boolean
): DataTransfer['dropEffect'] {
  if (!canDrop) return 'none';

  // Check for modifier keys
  if (event.altKey || event.ctrlKey) {
    return 'copy';
  }

  return 'move';
}

// ================================
// Visual Feedback Utilities
// ================================

/**
 * CSS classes for drag states
 */
export const DragClasses = {
  dragging: 'is-dragging',
  dragOver: 'is-drag-over',
  dropBefore: 'drop-position-before',
  dropInside: 'drop-position-inside',
  dropAfter: 'drop-position-after',
  canDrop: 'can-drop',
  cannotDrop: 'cannot-drop',
} as const;

/**
 * Get CSS classes for a node based on drag state
 */
export function getDragClasses(
  nodeId: string,
  dragState: DragState
): string[] {
  const classes: string[] = [];

  // Is this node being dragged?
  if (dragState.draggingId === nodeId) {
    classes.push(DragClasses.dragging);
  }

  // Is this node the drop target?
  if (dragState.dropTarget?.id === nodeId) {
    classes.push(DragClasses.dragOver);

    // Add position class
    const position = dragState.dropTarget.position;
    if (position === 'before') {
      classes.push(DragClasses.dropBefore);
    } else if (position === 'inside') {
      classes.push(DragClasses.dropInside);
    } else if (position === 'after') {
      classes.push(DragClasses.dropAfter);
    }

    // Add can/cannot drop class
    if (dragState.canDrop) {
      classes.push(DragClasses.canDrop);
    } else {
      classes.push(DragClasses.cannotDrop);
    }
  }

  return classes;
}

// ================================
// Drag Preview
// ================================

/**
 * Create a custom drag preview element
 */
export function createDragPreview(
  name: string,
  type: 'file' | 'folder',
  count = 1
): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'file-tree-drag-preview';
  preview.style.cssText = `
    position: fixed;
    top: -1000px;
    left: -1000px;
    padding: 4px 8px;
    background: var(--bg-secondary, #2d2d2d);
    border: 1px solid var(--border-primary, #404040);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-primary, #fff);
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    z-index: 10001;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;

  // Icon
  const icon = document.createElement('span');
  icon.innerHTML = type === 'folder' ? '📁' : '📄';
  preview.appendChild(icon);

  // Name
  const nameEl = document.createElement('span');
  nameEl.textContent = name;
  nameEl.style.maxWidth = '200px';
  nameEl.style.overflow = 'hidden';
  nameEl.style.textOverflow = 'ellipsis';
  nameEl.style.whiteSpace = 'nowrap';
  preview.appendChild(nameEl);

  // Count badge (for multi-selection)
  if (count > 1) {
    const badge = document.createElement('span');
    badge.textContent = `+${count - 1}`;
    badge.style.cssText = `
      padding: 0 4px;
      background: var(--accent-primary, #007acc);
      border-radius: 10px;
      font-size: 10px;
    `;
    preview.appendChild(badge);
  }

  return preview;
}

/**
 * Set custom drag image
 */
export function setDragPreview(
  dataTransfer: DataTransfer,
  preview: HTMLElement
): void {
  // Append to body temporarily
  document.body.appendChild(preview);

  // Set as drag image
  dataTransfer.setDragImage(preview, 16, 16);

  // Remove after a short delay (drag image is captured immediately)
  requestAnimationFrame(() => {
    document.body.removeChild(preview);
  });
}

// ================================
// Hook Utilities
// ================================

/**
 * Create drag event handlers for a tree node
 */
export function createDragHandlers(
  nodeId: string,
  nodeType: 'file' | 'folder',
  nodeName: string,
  parentId: string | null,
  path: string,
  callbacks: {
    onDragStart: (item: DragItem) => void;
    onDragEnd: () => void;
    onDragEnter: (target: DropTarget) => void;
    onDragLeave: () => void;
    onDrop: (item: DragItem, target: DropTarget) => void;
    getAncestors: (id: string) => string[];
  }
): {
  draggable: true;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
} {
  const dragItem: DragItem = {
    id: nodeId,
    type: nodeType,
    name: nodeName,
    parentId,
    path,
  };

  return {
    draggable: true,

    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      setDragData(e.dataTransfer, dragItem);

      // Create and set custom preview
      const preview = createDragPreview(nodeName, nodeType);
      setDragPreview(e.dataTransfer, preview);

      callbacks.onDragStart(dragItem);
    },

    onDragEnd: (e: React.DragEvent) => {
      e.stopPropagation();
      callbacks.onDragEnd();
    },

    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!hasDragData(e.dataTransfer)) return;

      const position = calculateDropPosition(
        e,
        e.currentTarget as HTMLElement,
        nodeType === 'folder'
      );

      const dropTarget: DropTarget = {
        id: nodeId,
        type: nodeType,
        position,
      };

      // Validate drop
      const dragData = getDragData(e.dataTransfer);
      if (dragData) {
        const validation = validateDrop(
          dragData,
          nodeId,
          nodeType,
          position,
          callbacks.getAncestors
        );
        e.dataTransfer.dropEffect = getDropEffect(e, validation.valid);
      }

      callbacks.onDragEnter(dropTarget);
    },

    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },

    onDragLeave: (e: React.DragEvent) => {
      e.stopPropagation();

      // Only leave if we're actually leaving this element
      const relatedTarget = e.relatedTarget as Node | null;
      const currentTarget = e.currentTarget as Node;
      if (relatedTarget && currentTarget.contains(relatedTarget)) {
        return;
      }

      callbacks.onDragLeave();
    },

    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const dragData = getDragData(e.dataTransfer);
      if (!dragData) return;

      const position = calculateDropPosition(
        e,
        e.currentTarget as HTMLElement,
        nodeType === 'folder'
      );

      const dropTarget: DropTarget = {
        id: nodeId,
        type: nodeType,
        position,
      };

      // Validate before executing
      const validation = validateDrop(
        dragData,
        nodeId,
        nodeType,
        position,
        callbacks.getAncestors
      );

      if (validation.valid) {
        callbacks.onDrop(dragData, dropTarget);
      }
    },
  };
}

// ================================
// Reducer for Drag State
// ================================

export type DragAction =
  | { type: 'START_DRAG'; item: DragItem }
  | { type: 'END_DRAG' }
  | { type: 'SET_DROP_TARGET'; target: DropTarget | null; canDrop: boolean }
  | { type: 'CLEAR_DROP_TARGET' };

export function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case 'START_DRAG':
      return {
        ...state,
        isDragging: true,
        draggingId: action.item.id,
        dropTarget: null,
        canDrop: false,
      };

    case 'END_DRAG':
      return initialDragState;

    case 'SET_DROP_TARGET':
      return {
        ...state,
        dropTarget: action.target,
        canDrop: action.canDrop,
      };

    case 'CLEAR_DROP_TARGET':
      return {
        ...state,
        dropTarget: null,
        canDrop: false,
      };

    default:
      return state;
  }
}
