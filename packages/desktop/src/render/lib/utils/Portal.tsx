// ================================
// Portal Component
// Renders children into a DOM node outside the parent hierarchy
// Used for modals, tooltips, and context menus to avoid overflow clipping
// ================================

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ================================
// Types
// ================================

export interface PortalProps {
  /** Content to render in the portal */
  children: React.ReactNode;
  /** DOM element ID to render into (defaults to creating a new element) */
  containerId?: string;
  /** Additional CSS class for the container */
  containerClassName?: string;
  /** Whether the portal is active */
  isOpen?: boolean;
}

// ================================
// Hook: usePortal
// Creates and manages a portal container element
// ================================

export function usePortal(id?: string): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // If an ID is provided, try to find an existing element
    if (id) {
      const existingElement = document.getElementById(id);
      if (existingElement) {
        setContainer(existingElement);
        return;
      }
    }

    // Create a new container element
    const element = document.createElement('div');
    element.id = id || `portal-${Date.now()}`;
    element.style.position = 'fixed';
    element.style.top = '0';
    element.style.left = '0';
    element.style.width = '0';
    element.style.height = '0';
    element.style.overflow = 'visible';
    element.style.zIndex = '9999';
    element.style.pointerEvents = 'none';

    document.body.appendChild(element);
    containerRef.current = element;
    setContainer(element);

    // Cleanup
    return () => {
      if (containerRef.current && containerRef.current.parentNode) {
        containerRef.current.parentNode.removeChild(containerRef.current);
        containerRef.current = null;
      }
    };
  }, [id]);

  return container;
}

// ================================
// Portal Component
// ================================

export const Portal: React.FC<PortalProps> = ({
  children,
  containerId,
  containerClassName,
  isOpen = true,
}) => {
  const container = usePortal(containerId);

  // Update container className when it changes
  useEffect(() => {
    if (container && containerClassName) {
      container.className = containerClassName;
    }
  }, [container, containerClassName]);

  if (!isOpen || !container) {
    return null;
  }

  return createPortal(children, container);
};

// ================================
// ContextMenuPortal Component
// Specialized portal for context menus with proper positioning
// ================================

export interface ContextMenuPortalProps {
  /** Whether the context menu is visible */
  isOpen: boolean;
  /** Position for the context menu */
  position: { top: number; left: number } | null;
  /** Content to render in the context menu */
  children: React.ReactNode;
  /** Callback when clicking outside the menu */
  onClose?: () => void;
  /** Additional CSS class for the menu */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
}

export const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  isOpen,
  position,
  children,
  onClose,
  className,
  style,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle click outside and escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };

    // Use capture phase to catch events before they bubble
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Adjust position to keep menu within viewport
  const adjustedPosition = useAdjustedPosition(position, menuRef);

  if (!isOpen || !position) {
    return null;
  }

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: adjustedPosition.top,
    left: adjustedPosition.left,
    zIndex: 10000,
    pointerEvents: 'auto',
    ...style,
  };

  return (
    <Portal isOpen={isOpen}>
      <div
        ref={menuRef}
        className={className}
        style={menuStyle}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </Portal>
  );
};

// ================================
// Hook: useAdjustedPosition
// Adjusts menu position to keep it within viewport
// ================================

function useAdjustedPosition(
  position: { top: number; left: number } | null,
  menuRef: React.RefObject<HTMLDivElement | null>
): { top: number; left: number } {
  const [adjusted, setAdjusted] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!position) {
      setAdjusted({ top: 0, left: 0 });
      return;
    }

    // Initial position
    let { top, left } = position;

    // Delay to allow menu to render and get its dimensions
    const timer = requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) {
        setAdjusted({ top, left });
        return;
      }

      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust horizontal position
      if (left + rect.width > viewportWidth - 8) {
        left = Math.max(8, viewportWidth - rect.width - 8);
      }

      // Adjust vertical position
      if (top + rect.height > viewportHeight - 8) {
        // Try positioning above the cursor
        const newTop = position.top - rect.height;
        if (newTop > 8) {
          top = newTop;
        } else {
          // If not enough space above, just constrain to viewport
          top = Math.max(8, viewportHeight - rect.height - 8);
        }
      }

      setAdjusted({ top, left });
    });

    return () => cancelAnimationFrame(timer);
  }, [position, menuRef]);

  return position ? adjusted : { top: 0, left: 0 };
}

export default Portal;
