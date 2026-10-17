// ================================
// Document Version Types
// Single responsibility: Type definitions for version history
// ================================

/**
 * Type of change that created this version
 */
export type ChangeType = 'create' | 'edit' | 'auto-save' | 'restore' | 'ai-update';

/**
 * Type of author that created this version
 */
export type AuthorType = 'user' | 'ai' | 'system';

/**
 * Full document version entity
 */
export interface DocumentVersion {
  id: string;
  itemId: string;
  versionNumber: number;
  title: string | null;
  content: string | null;
  summary: string | null;
  changeType: ChangeType;
  changeDescription: string | null;
  diffFromPrevious: string | null;
  contentHash: string | null;
  contentSize: number | null;
  authorType: AuthorType;
  createdAt: string;
}

/**
 * Lightweight version item for list display
 */
export interface VersionListItem {
  id: string;
  itemId: string;
  versionNumber: number;
  title: string | null;
  changeType: ChangeType;
  changeDescription: string | null;
  contentSize: number | null;
  authorType: AuthorType;
  createdAt: string;
}

/**
 * Input for creating a new version
 */
export interface CreateVersionInput {
  itemId: string;
  title?: string;
  content?: string;
  summary?: string;
  changeType?: ChangeType;
  changeDescription?: string;
  authorType?: AuthorType;
}

/**
 * Options for fetching version history
 */
export interface VersionListOptions {
  itemId: string;
  limit?: number;
  offset?: number;
  changeTypes?: ChangeType[];
  /** 只返回版本号小于该值的版本 */
  beforeVersionNumber?: number;
}

export type { VersionRetentionPolicy, VersionStats, VersionPruneResult } from '../../../types/electron';

/**
 * Version comparison result
 */
export interface VersionComparison {
  versionA: DocumentVersion;
  versionB: DocumentVersion;
  titleChanged: boolean;
  contentChanged: boolean;
  summaryChanged: boolean;
}

/**
 * Version restore result
 */
export interface RestoreResult {
  success: boolean;
  restoredVersion: DocumentVersion | null;
  error?: string;
}

/**
 * Convert full version to list item
 */
export function versionToListItem(version: DocumentVersion): VersionListItem {
  return {
    id: version.id,
    itemId: version.itemId,
    versionNumber: version.versionNumber,
    title: version.title,
    changeType: version.changeType,
    changeDescription: version.changeDescription,
    contentSize: version.contentSize,
    authorType: version.authorType,
    createdAt: version.createdAt,
  };
}

/**
 * Format version date for display
 */
export function formatVersionDate(version: DocumentVersion | VersionListItem): string {
  const date = new Date(version.createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return '刚刚';
  } else if (diffMins < 60) {
    return `${diffMins} 分钟前`;
  } else if (diffHours < 24) {
    return `${diffHours} 小时前`;
  } else if (diffDays < 7) {
    return `${diffDays} 天前`;
  } else {
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

/**
 * Get human-readable change type label
 */
export function getChangeTypeLabel(changeType: ChangeType): string {
  const labels: Record<ChangeType, string> = {
    create: '创建',
    edit: '编辑',
    'auto-save': '自动保存',
    restore: '恢复',
    'ai-update': 'AI 更新',
  };
  return labels[changeType] || changeType;
}

/**
 * Get human-readable author type label
 */
export function getAuthorTypeLabel(authorType: AuthorType): string {
  const labels: Record<AuthorType, string> = {
    user: '用户',
    ai: 'AI',
    system: '系统',
  };
  return labels[authorType] || authorType;
}

/**
 * Format content size for display
 */
export function formatContentSize(bytes: number | null): string {
  if (bytes === null) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
