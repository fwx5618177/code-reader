// ================================
// Folders Library
// Unified exports for folder/directory management
// ================================

// Types
export type {
  Folder,
  FolderTreeNode,
  FolderListItem,
  CreateFolderInput,
  UpdateFolderInput,
  FolderRow,
  FlattenedFolderNode,
} from './types';

export {
  rowToFolder,
  folderToListItem,
  buildFolderTree,
  flattenFolderTree,
  listFolderPaths,
  collectDescendantIds,
  wouldCreateCycle,
} from './types';

// Repository
export { folderRepository } from './repository';

// Service
export { folderService } from './service';

// Hook
export { useFolders } from './useFolders';
export type { UseFoldersReturn } from './useFolders';
