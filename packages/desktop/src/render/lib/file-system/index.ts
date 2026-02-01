// ================================
// File System Module
// Monaco-style unified file system for documents and folders
// Provides a consistent API for file operations across different backends
// ================================

// ================================
// URI Module
// ================================

export type { UriScheme, UriComponents } from './uri';

export {
  Uri,
  normalizePath,
  joinPaths,
  relativePath,
  matchGlob,
  getExtension,
  getBasename,
  getDirname,
} from './uri';

// ================================
// Types
// ================================

export {
  FileType,
  FilePermission,
  FileChangeType,
  FileSystemErrorCode,
  FileOpenFlags,
} from './types';

export type {
  FileStat,
  FileStatWithName,
  FileChange,
  FileReadOptions,
  FileWriteOptions,
  FileDeleteOptions,
  FileCreateOptions,
  FileRenameOptions,
  FileCopyOptions,
  IFileSystemProvider,
  FileSystemCapabilities,
  IFileEntry,
  IFileNode,
  IDirectoryNode,
  FileFormat,
  FileFormatInfo,
} from './types';

export {
  DEFAULT_CAPABILITIES,
  FILE_FORMATS,
  isFileNode,
  isDirectoryNode,
  getFileFormat,
  getFileFormatInfo,
  getLanguageFromExtension,
  FileSystemError,
} from './types';

// ================================
// Memory File System Provider
// ================================

export { MemoryFileSystemProvider } from './memory-provider';

export { getMemoryFileSystem, createMemoryFileSystem } from './memory-provider';

// ================================
// Database File System Provider
// ================================

export { DatabaseFileSystemProvider } from './database-provider';

export { getDatabaseFileSystem, createDatabaseFileSystem } from './database-provider';

// ================================
// File Tree Model
// ================================

export type {
  FileTreeNode,
  FlatFileTreeNode,
  FileTreeState,
  FileTreeAction,
  FileTreeSortConfig,
} from './file-tree-model';

export {
  DEFAULT_SORT_CONFIG,
  initialFileTreeState,
  fileTreeReducer,
  getAncestorIds,
  getDescendantIds,
  flattenFileTree,
  getVisibleNodes,
  findNodeByPath,
  findNodeByUri,
  FileTreeModel,
  createFileTreeModel,
} from './file-tree-model';

// ================================
// React Hook
// ================================

export type { UseFileTreeConfig, UseFileTreeReturn } from './useFileTree';

export { useFileTree } from './useFileTree';

// ================================
// Writing File Tree Hook
// ================================

export type {
  UseWritingFileTreeConfig,
  UseWritingFileTreeReturn,
  WritingNodeMeta,
  FolderLike,
} from './useWritingFileTree';

export { useWritingFileTree } from './useWritingFileTree';

// ================================
// Drag and Drop
// ================================

export type { DragItem, DropTarget, DropPosition, DragState, DragAction } from './dnd';

export {
  DND_MIME_TYPE,
  initialDragState,
  setDragData,
  getDragData,
  hasDragData,
  calculateDropPosition,
  validateDrop,
  getDropEffect,
  DragClasses,
  getDragClasses,
  createDragPreview,
  setDragPreview,
  createDragHandlers,
  dragReducer,
} from './dnd';
