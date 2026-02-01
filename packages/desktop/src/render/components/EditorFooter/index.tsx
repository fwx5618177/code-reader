import React from 'react';
import { FileText, Loader2, Check } from 'lucide-react';
import styles from './EditorFooter.module.scss';

export interface EditorFooterProps {
  /** Character count */
  charCount: number;
  /** Word count (Chinese chars + English words) */
  wordCount: number;
  /** Whether the content has unsaved changes */
  isDirty?: boolean;
  /** Whether a save is currently in progress */
  isSaving?: boolean;
  /** Timestamp of last successful save */
  lastSavedAt?: Date | null;
  /** Whether to show keyboard hints */
  showHints?: boolean;
  /** Custom hints to display */
  hints?: Array<{ key: string; label: string }>;
  /** Additional class name */
  className?: string;
  /** Additional action buttons or elements to render */
  children?: React.ReactNode;
}

/**
 * Format relative time for display (e.g., "刚刚", "1分钟前")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffSeconds < 10) {
    return '刚刚';
  } else if (diffSeconds < 60) {
    return `${diffSeconds}秒前`;
  } else if (diffMinutes < 60) {
    return `${diffMinutes}分钟前`;
  } else if (diffHours < 24) {
    return `${diffHours}小时前`;
  } else {
    return date.toLocaleDateString();
  }
}

const DEFAULT_HINTS = [{ key: '⌘S', label: '保存' }];

export const EditorFooter: React.FC<EditorFooterProps> = ({
  charCount,
  wordCount,
  isDirty = false,
  isSaving = false,
  lastSavedAt = null,
  showHints = true,
  hints = DEFAULT_HINTS,
  className,
  children,
}) => {
  // Determine save status display
  const renderSaveStatus = () => {
    if (isSaving) {
      return (
        <span className={`${styles.statItem} ${styles.saving}`}>
          <Loader2 size={12} className={styles.spinIcon} />
          <span>保存中...</span>
        </span>
      );
    }

    if (isDirty) {
      return <span className={`${styles.statItem} ${styles.unsaved}`}>● 未保存</span>;
    }

    if (lastSavedAt) {
      return (
        <span className={`${styles.statItem} ${styles.saved}`}>
          <Check size={12} />
          <span>已保存 {formatRelativeTime(lastSavedAt)}</span>
        </span>
      );
    }

    return null;
  };

  return (
    <div className={`${styles.editorFooter} ${className || ''}`}>
      <div className={styles.stats}>
        <span className={styles.statItem}>
          <FileText size={12} />
          <span>{charCount} 字符</span>
        </span>
        <span className={styles.statItem}>
          <span>{wordCount} 字</span>
        </span>
        {renderSaveStatus()}
      </div>

      {/* Custom action buttons */}
      {children && <div className={styles.actions}>{children}</div>}

      {showHints && hints.length > 0 && (
        <div className={styles.hints}>
          {hints.map((hint, index) => (
            <React.Fragment key={hint.key}>
              {index > 0 && <span className={styles.separator}>·</span>}
              <span className={styles.hint}>
                <kbd>{hint.key}</kbd>
                <span>{hint.label}</span>
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

export default EditorFooter;
