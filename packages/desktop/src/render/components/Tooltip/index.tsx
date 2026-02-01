// ================================
// Tooltip Component
// A reusable tooltip for showing labels on hover
// Uses CSS Modules for styling
// ================================

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.scss';

// ================================
// Types
// ================================

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
export type TooltipAlign = 'start' | 'center' | 'end';
export type TooltipDisplay = 'contents' | 'inline-flex' | 'inline' | 'block' | 'flex';
export type TooltipSize = 'small' | 'medium' | 'large';

export interface TooltipProps {
  /** Content to display in the tooltip */
  content: React.ReactNode;
  /** The element that triggers the tooltip */
  children: React.ReactNode;
  /** Position of the tooltip relative to the trigger */
  position?: TooltipPosition;
  /** Alignment of the tooltip */
  align?: TooltipAlign;
  /** Delay before showing tooltip (ms) */
  delay?: number;
  /** Whether the tooltip is disabled */
  disabled?: boolean;
  /** Optional shortcut to display */
  shortcut?: string;
  /** Custom class name for tooltip */
  className?: string;
  /** Max width of tooltip */
  maxWidth?: number;
  /** Whether to show an arrow */
  showArrow?: boolean;
  /** Display style for the trigger wrapper */
  display?: TooltipDisplay;
  /** Size variant */
  size?: TooltipSize;
}

// ================================
// Helper: Get trigger class name
// ================================

const getTriggerClassName = (display: TooltipDisplay): string => {
  switch (display) {
    case 'inline-flex':
      return styles.triggerInlineFlex;
    case 'inline':
      return styles.triggerInline;
    case 'block':
      return styles.triggerBlock;
    case 'flex':
      return styles.triggerFlex;
    case 'contents':
    default:
      return styles.trigger;
  }
};

// ================================
// Helper: Get arrow class name
// ================================

const getArrowClassName = (position: TooltipPosition): string => {
  const baseClass = styles.arrow;
  switch (position) {
    case 'top':
      return `${baseClass} ${styles.arrowTop}`;
    case 'bottom':
      return `${baseClass} ${styles.arrowBottom}`;
    case 'left':
      return `${baseClass} ${styles.arrowLeft}`;
    case 'right':
      return `${baseClass} ${styles.arrowRight}`;
    default:
      return baseClass;
  }
};

// ================================
// Helper: Get size class name
// ================================

const getSizeClassName = (size: TooltipSize): string => {
  switch (size) {
    case 'small':
      return styles.small;
    case 'large':
      return styles.large;
    default:
      return '';
  }
};

// ================================
// Helper: Get element bounding rect
// Handles display:contents by finding first child with layout
// ================================

const getElementRect = (element: HTMLElement | null): DOMRect | null => {
  if (!element) return null;

  const rect = element.getBoundingClientRect();

  // Check if element has no layout (display: contents or similar)
  if (rect.width === 0 && rect.height === 0) {
    // Try to get rect from first child element
    const firstChild = element.firstElementChild as HTMLElement;
    if (firstChild) {
      return firstChild.getBoundingClientRect();
    }
    return null;
  }

  return rect;
};

// ================================
// Tooltip Component
// ================================

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'right',
  align = 'center',
  delay = 400,
  disabled = false,
  shortcut,
  className = '',
  maxWidth = 200,
  showArrow = true,
  display = 'contents',
  size = 'medium',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate tooltip position
  const calculatePosition = useCallback(() => {
    const triggerRect = getElementRect(triggerRef.current);
    const tooltipElement = tooltipRef.current;

    if (!triggerRect || !tooltipElement) {
      return false;
    }

    const tooltipRect = tooltipElement.getBoundingClientRect();

    // If tooltip has no size yet, we can't position it properly
    if (tooltipRect.width === 0 && tooltipRect.height === 0) {
      return false;
    }

    const gap = 8;

    let x = 0;
    let y = 0;

    switch (position) {
      case 'top':
        x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        y = triggerRect.top - tooltipRect.height - gap;
        break;
      case 'bottom':
        x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        y = triggerRect.bottom + gap;
        break;
      case 'left':
        x = triggerRect.left - tooltipRect.width - gap;
        y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        break;
      case 'right':
        x = triggerRect.right + gap;
        y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        break;
    }

    // Apply alignment adjustments
    if (position === 'top' || position === 'bottom') {
      switch (align) {
        case 'start':
          x = triggerRect.left;
          break;
        case 'end':
          x = triggerRect.right - tooltipRect.width;
          break;
      }
    } else {
      switch (align) {
        case 'start':
          y = triggerRect.top;
          break;
        case 'end':
          y = triggerRect.bottom - tooltipRect.height;
          break;
      }
    }

    // Keep tooltip within viewport
    const padding = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    x = Math.max(padding, Math.min(x, viewportWidth - tooltipRect.width - padding));
    y = Math.max(padding, Math.min(y, viewportHeight - tooltipRect.height - padding));

    setCoords({ x, y });
    return true;
  }, [position, align]);

  // Show tooltip
  const handleMouseEnter = useCallback(() => {
    if (disabled) return;

    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      setIsPositioned(false);
    }, delay);
  }, [delay, disabled]);

  // Hide tooltip
  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
    setIsPositioned(false);
  }, []);

  // Use useLayoutEffect to position before paint
  useLayoutEffect(() => {
    if (isVisible && !isPositioned) {
      // Use multiple frames to ensure DOM is ready
      let attempts = 0;
      const maxAttempts = 5;

      const tryPosition = () => {
        if (calculatePosition()) {
          setIsPositioned(true);
        } else if (attempts < maxAttempts) {
          attempts++;
          requestAnimationFrame(tryPosition);
        }
      };

      requestAnimationFrame(tryPosition);
    }
  }, [isVisible, isPositioned, calculatePosition]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Early return if disabled or no content
  if (disabled || !content) {
    return <>{children}</>;
  }

  // Build tooltip class names
  const tooltipClassNames = [
    styles.tooltip,
    isVisible && isPositioned ? styles.visible : '',
    getSizeClassName(size),
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Render tooltip in portal
  // Only render when visible, but only show (opacity: 1) when positioned
  const tooltipElement = isVisible
    ? createPortal(
        <div
          ref={tooltipRef}
          className={tooltipClassNames}
          style={{
            left: coords.x,
            top: coords.y,
            maxWidth,
            // Keep it invisible until positioned to prevent flicker
            visibility: isPositioned ? 'visible' : 'hidden',
          }}
          role="tooltip"
        >
          {showArrow && <div className={getArrowClassName(position)} />}
          <div className={styles.content}>
            <span className={styles.text}>{content}</span>
            {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div
        ref={triggerRef}
        className={getTriggerClassName(display)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
      >
        {children}
      </div>
      {tooltipElement}
    </>
  );
};

export default Tooltip;
