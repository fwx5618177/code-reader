// ================================
// Document Library
// 文档管理模块统一导出
// ================================

// ================================
// 文件类型系统
// ================================

export type { DocumentTypeId, FileTypeConfig } from './file-types';

export {
  // 内置文件类型
  MARKDOWN_TYPE,
  LATEX_TYPE,
  PLAIN_TEXT_TYPE,
  BUILTIN_FILE_TYPES,
  // 注册表
  fileTypeRegistry,
  FileTypeRegistry,
  // 工具函数
  getFileType,
  getFileTypeId,
  keepFileExtension,
  supportsMath,
  supportsCodeBlocks,
  getDefaultTemplate,
  getCreatableTypes,
  inferTypeFromContent,
  resolveDocumentType,
  getFileTypeDisplayInfo,
  getAllSupportedExtensions,
  isSupportedFile,
  ensureExtension,
} from './file-types';

// ================================
// Types
// ================================
export type {
  Document,
  DocumentListItem,
  CreateDocumentInput,
  UpdateDocumentInput,
  DocumentRow,
  DocumentListRow,
} from './types';

export { rowToDocument, rowToListItem, documentToListItem } from './types';

// Constants
export {
  DOCUMENT_TYPE,
  DOCUMENT_STATUS,
  PLACEHOLDERS,
} from './constants';

// State types
export type { ListState, EditorState, DocumentState, AutoSaveState } from './state';

export {
  initialListState,
  initialEditorState,
  initialDocumentState,
  initialAutoSaveState,
} from './state';

// Actions
export type { ListAction, EditorAction, GlobalAction, DocumentAction } from './actions';

export { actions } from './actions';

// Reducer
export { documentReducer } from './reducer';

// Repository
export { documentRepository } from './repository';

// Service
export { documentService } from './service';

// Hooks
export { useDocuments } from './useDocuments';
export type { UseDocumentsReturn, UseDocumentsConfig } from './useDocuments';

// 写作集成服务
export {
  WritingIntegration,
  getWritingIntegration,
  resetWritingIntegration,
} from './writing-integration';
export type {
  DocumentIndexItem,
  WritingIntegrationConfig,
  IncrementalSaveDecision,
} from './writing-integration';

// 注意：useDocumentEditor 已被 core 模块的 useManagedEditor 替代
// 如需使用请从 '../core' 导入:
// import { useManagedEditor, UseManagedEditorConfig, UseManagedEditorReturn } from '../core';

// ================================
// Versions Sub-module
// ================================

// Version types
export type {
  ChangeType,
  AuthorType,
  DocumentVersion,
  VersionListItem,
  CreateVersionInput,
  VersionListOptions,
  VersionComparison,
  RestoreResult,
} from './versions';

export {
  versionToListItem,
  formatVersionDate,
  getChangeTypeLabel,
  getAuthorTypeLabel,
  formatContentSize,
} from './versions';

// Version state
export type {
  VersionState,
  VersionListState,
  VersionPreviewState,
  VersionRestoreState,
  VersionCompareState,
} from './versions';

export { initialVersionState, initialVersionListState, shouldReloadVersions } from './versions';

// Version actions
export type { VersionAction } from './versions';
export { versionActions } from './versions';

// Version reducer
export { versionReducer } from './versions';

// Version service
export { versionService } from './versions';

// Version hook
export type { UseVersionsConfig, UseVersionsReturn } from './versions';
export { useVersions } from './versions';
