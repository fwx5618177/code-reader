// ================================
// Versions Module Index
// Exports all version history related functionality
// ================================

// Types
export type {
  ChangeType,
  AuthorType,
  DocumentVersion,
  VersionListItem,
  CreateVersionInput,
  VersionListOptions,
  VersionComparison,
  RestoreResult,
} from './types';

export {
  versionToListItem,
  formatVersionDate,
  getChangeTypeLabel,
  getAuthorTypeLabel,
  formatContentSize,
} from './types';

// State
export type {
  VersionState,
  VersionListState,
  VersionPreviewState,
  VersionRestoreState,
  VersionCompareState,
} from './state';

export {
  initialVersionState,
  initialVersionListState,
  initialVersionPreviewState,
  initialVersionRestoreState,
  initialVersionCompareState,
  createVersionListState,
  shouldReloadVersions,
} from './state';

// Actions
export type {
  VersionAction,
  VersionListAction,
  VersionPreviewAction,
  VersionRestoreAction,
  VersionCompareAction,
  VersionPanelAction,
  VersionCreationAction,
} from './actions';

export { versionActions } from './actions';

// Reducer
export { versionReducer } from './reducer';

// Service
export { versionService } from './service';

// Repository
export { versionRepository } from './repository';

// Hook
export type { UseVersionsConfig, UseVersionsReturn } from './useVersions';
export { useVersions } from './useVersions';
