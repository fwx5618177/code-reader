# File System Module

Monaco-style unified file system abstraction for the writing module.

## Overview

This module provides a unified file system interface that abstracts away the underlying storage mechanism (database, memory, or local file system). It follows the Monaco Editor's `IFileSystemProvider` pattern for consistency and extensibility.

## Architecture

```
file-system/
├── uri.ts                  # URI class and path utilities
├── types.ts                # Core type definitions
├── file-tree-model.ts      # Tree state management
├── memory-provider.ts      # In-memory provider
├── database-provider.ts    # SQLite provider
├── writing-adapter.ts      # Writing module adapter
├── useFileTree.ts          # Generic React hook
├── useWritingFileTree.ts   # Writing-specific hook
└── index.ts                # Public API exports
```

## Key Components

### Core Types

- **`Uri`** - Immutable URI class for addressing files and directories
- **`FileType`** - Enum for file types (File, Directory, SymbolicLink)
- **`FileStat`** - File statistics (type, ctime, mtime, size)
- **`IFileSystemProvider`** - Core interface for file system operations

### File Tree Model

- **`FileTreeNode`** - Node representation for UI rendering
- **`FlatFileTreeNode`** - Flattened node for virtualized rendering
- **`FileTreeState`** - Reducer state for tree UI
- **`FileTreeModel`** - Class-based model for tree operations

### Providers

- **`MemoryFileSystemProvider`** - In-memory file system (for testing/virtual files)
- **`DatabaseFileSystemProvider`** - SQLite-backed file system
- **`WritingFileSystemAdapter`** - Adapts folders/documents to IFileSystemProvider

### React Hooks

- **`useFileTree`** - Generic file tree hook for any IFileSystemProvider
- **`useWritingFileTree`** - Writing-specific hook with folder/document operations

## Usage

### Basic File Tree

```typescript
import { useFileTree, MemoryFileSystemProvider, Uri } from '../file-system';

const provider = new MemoryFileSystemProvider();
const rootUri = Uri.memory('/');

const {
  visibleNodes,
  isLoading,
  select,
  expand,
  toggle,
  createFile,
  createFolder,
  deleteNode,
} = useFileTree({
  provider,
  rootUri,
  autoLoad: true,
});
```

### Writing Module Integration

```typescript
import { useWritingFileTree, FileType } from '../file-system';

const {
  // State
  visibleNodes,
  isLoading,
  error,
  
  // Selection state
  selectedDocumentId,
  selectedFolderId,
  selectedDocument,
  selectedFolder,
  
  // Selection actions
  selectDocument,
  selectFolder,
  clearSelection,
  
  // Expand/collapse
  expand,
  collapse,
  toggle,
  isExpanded,
  
  // File operations
  createNewFolder,
  createNewDocument,
  renameFolderById,
  renameDocumentById,
  deleteFolderById,
  deleteDocumentById,
  moveDocumentToFolder,
  
  // Navigation
  expandToDocument,
  expandToFolder,
  
  // Metadata
  getNodeMeta,
  
  // Refresh
  refreshTree,
} = useWritingFileTree({
  folders,
  documents,
  foldersLoading,
  foldersError,
  initialSelectedDocumentId: 'doc-1',
  initialExpandedFolderIds: ['folder-1'],
  
  // Callbacks
  onSelectDocument: (doc) => console.log('Selected:', doc.id),
  onSelectFolder: (folder) => console.log('Folder:', folder?.id),
  
  // Operation implementations
  createFolder: async (name, parentId) => folderService.create(name, parentId),
  renameFolder: async (id, newName) => folderService.rename(id, newName),
  deleteFolder: async (id) => folderService.delete(id),
  createDocument: async (name, folderId) => documentService.create(name, folderId),
  renameDocument: async (id, newName) => documentService.rename(id, newName),
  deleteDocument: async (id) => documentService.delete(id),
  moveDocument: async (docId, folderId) => documentService.move(docId, folderId),
});
```

## Rendering Tree Nodes

```tsx
import { FileType, FlatFileTreeNode } from '../file-system';

{visibleNodes.map((flatNode: FlatFileTreeNode) => {
  const { node, depth } = flatNode;
  const meta = getNodeMeta(node.id);
  
  return (
    <TreeNode
      key={node.id}
      name={node.name}
      depth={depth}
      isFolder={node.type === FileType.Directory}
      isExpanded={isExpanded(node.id)}
      isSelected={node.isSelected}
      isFavorite={meta?.isFavorite}
      isPinned={meta?.isPinned}
      onClick={() => {
        if (node.type === FileType.Directory) {
          toggle(node.id);
        } else {
          select(node.id);
        }
      }}
    />
  );
})}
```

## Design Principles

1. **Monaco-style Interface** - Follows VSCode/Monaco patterns for familiarity
2. **Provider Pattern** - Pluggable backends via `IFileSystemProvider`
3. **Immutable State** - Uses reducer pattern for predictable updates
4. **Type Safety** - Full TypeScript support with strict typing
5. **Performance** - Supports virtualized rendering via flat node lists
6. **Testability** - Memory provider for easy unit testing
7. **Single Responsibility** - Each component has a focused purpose

## URI Schemes

| Scheme | Description |
|--------|-------------|
| `file://` | Local file system |
| `memory://` | In-memory virtual files |
| `db://` | Database-stored files |
| `writing://` | Writing module files (folders + documents) |
| `untitled://` | Unsaved files |

## File Operations

All providers support these core operations:

| Operation | Description |
|-----------|-------------|
| `stat(uri)` | Get file/directory info |
| `readDirectory(uri)` | List directory contents |
| `createDirectory(uri)` | Create folder |
| `readFile(uri)` | Read file content |
| `writeFile(uri, content, options)` | Write file content |
| `delete(uri, options)` | Delete file/directory |
| `rename(source, target, options)` | Move/rename file |
| `copy(source, target, options)` | Copy file (optional) |
| `watch(uri, options)` | Watch for changes (optional) |

## Related Modules

- **`lib/utils`** - Common utilities (UUID, document ID generation)
- **`lib/documents`** - Document repository and services
- **`lib/folders`** - Folder repository and services

## Future Enhancements

- [ ] Virtual scrolling support for large trees
- [ ] Drag and drop support
- [ ] Keyboard navigation
- [ ] Search/filter within tree
- [ ] Multi-selection support