// ================================
// TitleInput Component
// Controlled input that manages its own local state to prevent cursor loss
//
// Problem: When parent state updates (e.g., during auto-save), the input
// value prop changes, which can cause cursor position to reset.
//
// Solution: Use local state as source of truth during editing, only sync
// from props when the document changes (identified by documentId prop).
//
// This is the same pattern used by VS Code, Notion, and other mature editors.
// ================================

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';

// ================================
// Types
// ================================

export interface TitleInputProps {
  /** Current title value from parent state */
  value: string;
  /** Document ID - used to detect document changes */
  documentId: string | null;
  /** Callback when title changes */
  onChange: (newTitle: string) => void;
  /** 失焦（提交重命名） */
  onBlur?: () => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS class name */
  className?: string;
  /** Whether the input is read-only */
  readOnly?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
}

// ================================
// Component
// ================================

/**
 * TitleInput - A controlled input that maintains its own local state
 *
 * Key features:
 * - Local state is the source of truth during editing
 * - Only syncs from props when documentId changes
 * - Prevents cursor loss during auto-save or parent re-renders
 * - Async notification to parent to prevent blocking input
 */
const TitleInputInner: React.FC<TitleInputProps> = ({
  value,
  documentId,
  onChange,
  onBlur,
  placeholder = '无标题',
  className = '',
  readOnly = false,
  autoFocus = false,
}) => {
  // Local state - source of truth during editing
  const [localValue, setLocalValue] = useState(value);

  // Track which document we've synced for
  const lastSyncedDocIdRef = useRef<string | null>(null);

  // Ref for onChange to avoid stale closures
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  // Input ref for focus management
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync from props only when document changes
  // This is the key to preventing cursor loss:
  // - During editing: localValue is the source of truth
  // - On document switch: sync from props
  useEffect(() => {
    if (documentId !== lastSyncedDocIdRef.current) {
      lastSyncedDocIdRef.current = documentId;
      setLocalValue(value);
    }
  }, [documentId, value]);

  // Handle input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    // Update local state immediately for responsive UI
    setLocalValue(newValue);

    // Notify parent asynchronously
    // Using microtask to ensure local state update completes first
    // This prevents any potential race conditions
    queueMicrotask(() => {
      onChangeRef.current(newValue);
    });
  }, []);

  // Auto-focus on mount if requested
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <input
      ref={inputRef}
      type="text"
      className={className}
      value={localValue}
      onChange={handleChange}
      onBlur={() => onBlurRef.current?.()}
      placeholder={placeholder}
      readOnly={readOnly}
    />
  );
};

// ================================
// Memoized Export
// ================================

/**
 * Custom comparison function for memo
 * Only re-render when props that affect behavior change
 * NOT when value changes (that's handled by local state)
 */
function arePropsEqual(prev: TitleInputProps, next: TitleInputProps): boolean {
  // Re-render if document changes (need to sync new title)
  if (prev.documentId !== next.documentId) return false;

  // Re-render if these change
  if (prev.placeholder !== next.placeholder) return false;
  if (prev.className !== next.className) return false;
  if (prev.readOnly !== next.readOnly) return false;
  if (prev.autoFocus !== next.autoFocus) return false;

  // DON'T re-render just because value or onChange changed
  // - value is only used on document switch (handled by useEffect)
  // - onChange / onBlur are captured in refs
  return true;
}

export const TitleInput = memo(TitleInputInner, arePropsEqual);

export default TitleInput;
