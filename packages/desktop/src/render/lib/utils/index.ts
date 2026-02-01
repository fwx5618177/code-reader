// ================================
// Common Utilities Module
// Shared utility functions for the application
// ================================

// Document ID utilities with uuid_hash format
export {
  generateUUID,
  hashContent,
  generateDocumentId,
  parseDocumentId,
  getDocumentUUID,
  getDocumentHash,
  updateDocumentIdHash,
  isSameDocument,
  hasSameContent,
  isUuidHashFormat,
  migrateToUuidHashFormat,
  generateVersionId,
  parseVersionId,
  getVersionsForDocument,
} from './id';

export type { DocumentIdParts, VersionIdParts } from './id';

// Portal components for rendering outside DOM hierarchy
export { Portal, ContextMenuPortal, usePortal } from './Portal';
export type { PortalProps, ContextMenuPortalProps } from './Portal';
