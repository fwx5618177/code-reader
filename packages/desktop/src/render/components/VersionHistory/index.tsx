// ================================
// VersionHistory 组件
// 显示文档版本历史，支持预览、与当前内容 / 上一版本对比、恢复
// 使用 lib/documents/versions 模块进行状态管理
// ================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  History,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  Bot,
  Settings,
  Eye,
  X,
  AlertCircle,
  GitCompare,
} from 'lucide-react';
import {
  useVersions,
  DocumentVersion,
  AuthorType,
  formatVersionDate,
  getChangeTypeLabel,
  getAuthorTypeLabel,
  formatContentSize,
} from '../../lib/documents/versions';
import { DiffViewer } from '../../lib/writing/components/DiffViewer';
import { buildVersionDiff, type VersionDiff, type VersionDiffMode } from './diff-target';
import styles from './VersionHistory.module.scss';

// ================================
// 类型定义
// ================================

export interface VersionHistoryProps {
  itemId: string;
  isOpen: boolean;
  /** 当前编辑中的内容，用于“对比当前” */
  currentContent: string;
  onClose: () => void;
  onRestore?: (version: DocumentVersion) => void;
  className?: string;
}

interface VersionPreviewModalProps {
  version: DocumentVersion;
  onClose: () => void;
  onRestore: () => void;
  restoring: boolean;
}

// ================================
// 版本预览模态框
// ================================

function VersionPreviewModal({
  version,
  onClose,
  onRestore,
  restoring,
}: VersionPreviewModalProps): React.ReactElement {
  return (
    <div className={styles.versionPreviewOverlay} onClick={onClose}>
      <div className={styles.versionPreview} onClick={(e) => e.stopPropagation()}>
        <div className={styles.previewHeader}>
          <div className={styles.previewTitle}>
            <Eye size={16} />
            <span>版本 {version.versionNumber} 预览</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.previewMeta}>
          <span className={styles.metaItem}>
            <Clock size={14} />
            {formatVersionDate(version)}
          </span>
          <span className={styles.metaItem}>
            {version.authorType === 'user' && <User size={14} />}
            {version.authorType === 'ai' && <Bot size={14} />}
            {version.authorType === 'system' && <Settings size={14} />}
            {getAuthorTypeLabel(version.authorType)}
          </span>
          <span className={`${styles.changeBadge} ${styles[version.changeType]}`}>
            {getChangeTypeLabel(version.changeType)}
          </span>
        </div>

        {version.changeDescription && (
          <div className={styles.previewDescription}>{version.changeDescription}</div>
        )}

        <div className={styles.previewContent}>
          {version.title && (
            <div className={styles.contentTitle}>
              <strong>标题:</strong> {version.title}
            </div>
          )}
          {version.content ? (
            <pre className={styles.contentText}>{version.content}</pre>
          ) : (
            <div className={styles.contentEmpty}>无内容</div>
          )}
        </div>

        <div className={styles.previewFooter}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button className={styles.restoreBtn} onClick={onRestore} disabled={restoring}>
            <RotateCcw size={14} />
            {restoring ? '恢复中...' : '恢复到此版本'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================
// 版本对比模态框
// ================================

interface VersionDiffModalProps {
  diff: VersionDiff;
  onClose: () => void;
  onRestore: () => void;
  restoring: boolean;
}

function VersionDiffModal({
  diff,
  onClose,
  onRestore,
  restoring,
}: VersionDiffModalProps): React.ReactElement {
  return (
    <div className={styles.versionPreviewOverlay} onClick={onClose}>
      <div
        className={`${styles.versionPreview} ${styles.versionDiff}`}
        role="dialog"
        aria-label="版本对比"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.previewHeader}>
          <div className={styles.previewTitle}>
            <GitCompare size={16} />
            <span>
              {diff.sourceTitle} → {diff.targetTitle}
            </span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className={styles.diffBody}>
          <DiffViewer
            className={styles.diffViewer}
            source={diff.source}
            target={diff.target}
            sourceTitle={diff.sourceTitle}
            targetTitle={diff.targetTitle}
          />
        </div>

        <div className={styles.previewFooter}>
          <button className={styles.cancelBtn} onClick={onClose}>
            关闭
          </button>
          <button className={styles.restoreBtn} onClick={onRestore} disabled={restoring}>
            <RotateCcw size={14} />
            {restoring ? '恢复中...' : `恢复到版本 ${diff.version.versionNumber}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================
// 版本条目组件
// ================================

interface VersionItemProps {
  version: DocumentVersion;
  isFirst: boolean;
  /** 上一版本已加载，可以对比 */
  hasPrevious: boolean;
  onPreview: () => void;
  onCompare: (mode: VersionDiffMode) => void;
  onRestore: () => void;
  restoring: boolean;
}

function VersionItem({
  version,
  isFirst,
  hasPrevious,
  onPreview,
  onCompare,
  onRestore,
  restoring,
}: VersionItemProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const getAuthorIcon = (authorType: AuthorType): React.ReactNode => {
    switch (authorType) {
      case 'user':
        return <User size={14} />;
      case 'ai':
        return <Bot size={14} />;
      case 'system':
        return <Settings size={14} />;
    }
  };

  return (
    <div className={`${styles.versionItem} ${isFirst ? styles.versionItemCurrent : ''}`}>
      <div className={styles.versionTimeline}>
        <div className={`${styles.timelineDot} ${styles[version.changeType]}`} />
        <div className={styles.timelineLine} />
      </div>

      <div className={styles.versionContent}>
        <div className={styles.versionHeader} onClick={() => setExpanded(!expanded)}>
          <div className={styles.versionInfo}>
            <span className={styles.versionNumber}>
              版本 {version.versionNumber}
              {isFirst && <span className={styles.currentBadge}>当前</span>}
            </span>
            <span className={`${styles.changeType} ${styles[version.changeType]}`}>
              {getChangeTypeLabel(version.changeType)}
            </span>
          </div>
          <div className={styles.versionMeta}>
            <span className={styles.author}>
              {getAuthorIcon(version.authorType)}
              {getAuthorTypeLabel(version.authorType)}
            </span>
            <span className={styles.date}>
              <Clock size={12} />
              {formatVersionDate(version)}
            </span>
          </div>
          <button className={styles.expandBtn}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        {expanded && (
          <div className={styles.versionDetails}>
            {version.changeDescription && (
              <div className={styles.versionDescription}>{version.changeDescription}</div>
            )}

            {version.title && (
              <div className={styles.versionTitlePreview}>
                <strong>标题:</strong> {version.title}
              </div>
            )}

            {version.contentSize && (
              <div className={styles.versionSize}>
                内容大小: {formatContentSize(version.contentSize)}
              </div>
            )}

            <div className={styles.versionActions}>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnPreview}`}
                onClick={onPreview}
              >
                <Eye size={14} />
                预览
              </button>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnPreview}`}
                onClick={() => onCompare('current')}
              >
                <GitCompare size={14} />
                对比当前
              </button>
              {hasPrevious && (
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnPreview}`}
                  onClick={() => onCompare('previous')}
                >
                  <GitCompare size={14} />
                  对比上一版
                </button>
              )}
              {!isFirst && (
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnRestore}`}
                  onClick={onRestore}
                  disabled={restoring}
                >
                  <RotateCcw size={14} />
                  {restoring ? '恢复中...' : '恢复'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ================================
// 主组件
// ================================

export function VersionHistory({
  itemId,
  isOpen,
  currentContent,
  onClose,
  onRestore,
  className,
}: VersionHistoryProps): React.ReactElement | null {
  // 使用版本管理 hook
  const {
    // 列表状态
    versions,
    totalCount,
    hasMore,
    listLoading,
    listError,

    // 预览状态
    previewVersionData,

    // 恢复状态
    restoring,
    restoreError,

    // 操作
    openPanel,
    closePanel,
    loadVersions,
    loadMoreVersions,
    loadPreviewVersion,
    closePreview,
    restoreVersion,
  } = useVersions({
    documentId: itemId,
    autoLoad: false,
    onRestore: (restoredVersion) => {
      if (onRestore) {
        onRestore(restoredVersion);
      }
    },
  });

  // 本地状态 - 预览模态框
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  // 本地状态 - 对比模态框（内容在打开时确定，不随后续编辑变化）
  const [activeDiff, setActiveDiff] = useState<VersionDiff | null>(null);

  // 面板打开时加载版本
  useEffect(() => {
    if (isOpen && itemId) {
      openPanel(itemId);
      loadVersions(itemId);
    } else if (!isOpen) {
      closePanel();
    }
  }, [isOpen, itemId, openPanel, closePanel, loadVersions]);

  // 处理预览点击
  const handlePreview = useCallback(
    async (versionId: string) => {
      await loadPreviewVersion(versionId);
      setShowPreviewModal(true);
    },
    [loadPreviewVersion]
  );

  // 处理关闭预览
  const handleClosePreview = useCallback(() => {
    setShowPreviewModal(false);
    closePreview();
  }, [closePreview]);

  // 处理从预览模态框恢复
  const handleRestoreFromPreview = useCallback(async () => {
    if (!previewVersionData) return;

    const restored = await restoreVersion(previewVersionData.id);
    if (restored) {
      setShowPreviewModal(false);
    }
  }, [previewVersionData, restoreVersion]);

  // 处理从列表恢复
  const handleRestoreFromList = useCallback(
    async (versionId: string) => {
      await restoreVersion(versionId);
    },
    [restoreVersion]
  );

  // 处理从对比模态框恢复
  const handleRestoreFromDiff = useCallback(async () => {
    if (!activeDiff) return;

    const restored = await restoreVersion(activeDiff.version.id);
    if (restored) {
      setActiveDiff(null);
    }
  }, [activeDiff, restoreVersion]);

  // 处理关闭面板
  const handleClose = useCallback(() => {
    closePanel();
    onClose();
  }, [closePanel, onClose]);

  // 合并错误信息
  const errorMessage = listError || restoreError;

  if (!isOpen) return null;

  return (
    <div className={`${styles.versionHistoryPanel} ${className || ''}`}>
      <div className={styles.panelHeader}>
        <div className={styles.headerTitle}>
          <History size={18} />
          <span>版本历史</span>
          <span className={styles.versionCount}>{totalCount} 个版本</span>
        </div>
        <button className={styles.closeBtn} onClick={handleClose}>
          <X size={16} />
        </button>
      </div>

      <div className={styles.panelContent}>
        {errorMessage && (
          <div className={styles.errorMessage}>
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {listLoading && versions.length === 0 ? (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <span>加载中...</span>
          </div>
        ) : versions.length === 0 ? (
          <div className={styles.emptyState}>
            <History size={32} />
            <span>暂无版本历史</span>
            <p>编辑文档后会自动保存版本</p>
          </div>
        ) : (
          <div className={styles.versionsList}>
            {versions.map((version, index) => (
              <VersionItem
                key={version.id}
                version={version}
                isFirst={index === 0}
                hasPrevious={index + 1 < versions.length}
                onPreview={() => handlePreview(version.id)}
                onCompare={(mode) =>
                  setActiveDiff(buildVersionDiff(versions, index, mode, currentContent))
                }
                onRestore={() => handleRestoreFromList(version.id)}
                restoring={restoring}
              />
            ))}

            {hasMore && (
              <button
                className={styles.loadMoreBtn}
                onClick={loadMoreVersions}
                disabled={listLoading}
              >
                {listLoading ? '加载中...' : '加载更多'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 版本预览模态框 */}
      {showPreviewModal && previewVersionData && (
        <VersionPreviewModal
          version={previewVersionData}
          onClose={handleClosePreview}
          onRestore={handleRestoreFromPreview}
          restoring={restoring}
        />
      )}

      {/* 版本对比模态框 */}
      {activeDiff && (
        <VersionDiffModal
          diff={activeDiff}
          onClose={() => setActiveDiff(null)}
          onRestore={handleRestoreFromDiff}
          restoring={restoring}
        />
      )}
    </div>
  );
}

export default VersionHistory;
