# Document Versions Module

Document version history management using reducer/dispatch pattern for clean state management.

## Architecture

This module follows the same high-cohesion, low-coupling architecture as the parent `documents` module:

```
versions/
├── types.ts        # Type definitions and helper functions
├── repository.ts   # Database operations via IPC (single responsibility)
├── service.ts      # Business logic layer
├── state.ts        # State types and initial values
├── actions.ts      # Action type definitions and creators
├── reducer.ts      # Pure state transitions
├── useVersions.ts  # React hook for state management
└── index.ts        # Module exports
```

## Key Principles

1. **Single Responsibility**: Each file has one clear purpose
2. **Pure State Transitions**: Reducer contains no side effects
3. **Separation of Concerns**: Repository handles IPC, Service handles business logic
4. **React Integration**: Hook connects UI to the state machine

## Usage

### Basic Usage with useVersions Hook

```tsx
import { useVersions, DocumentVersion } from '../../lib/documents/versions';

function VersionHistoryPanel({ documentId }: { documentId: string }) {
  const {
    // State
    versions,
    totalCount,
    hasMore,
    listLoading,
    listError,
    previewVersionData,
    restoring,
    
    // Actions
    openPanel,
    closePanel,
    loadVersions,
    loadMoreVersions,
    loadPreviewVersion,
    restoreVersion,
    createVersion,
  } = useVersions({
    documentId,
    autoLoad: true,
    onRestore: (restoredVersion) => {
      console.log('Restored to version:', restoredVersion.versionNumber);
    },
  });

  // Use the state and actions in your component
}
```

### Creating Versions Manually

```tsx
const { createVersion } = useVersions({ documentId });

// Create a manual version snapshot
const version = await createVersion(content, {
  title: 'My Document',
  changeType: 'edit',
  changeDescription: '重要修改',
});
```

### Auto-Save Version Integration

The version service integrates with `AutoSaveManager` in `useDocuments`. When auto-save triggers, it can optionally create version snapshots at configured intervals (default: every 5 minutes).

```tsx
import { useDocuments } from '../../lib/documents';

const {
  lastVersionCreatedAt,
  createVersion,
} = useDocuments({
  onVersionCreated: (version) => {
    console.log('New version created:', version.id);
  },
});
```

## State Shape

```typescript
interface VersionState {
  documentId: string | null;
  isOpen: boolean;
  
  list: {
    versions: DocumentVersion[];
    totalCount: number;
    hasMore: boolean;
    loading: boolean;
    error: string | null;
    offset: number;
  };
  
  preview: {
    version: DocumentVersion | null;
    loading: boolean;
    error: string | null;
  };
  
  restore: {
    restoring: boolean;
    versionId: string | null;
    error: string | null;
    lastRestoredVersion: DocumentVersion | null;
  };
  
  compare: {
    versionA: DocumentVersion | null;
    versionB: DocumentVersion | null;
    loading: boolean;
    error: string | null;
  };
  
  lastCreatedVersion: DocumentVersion | null;
  lastVersionCreatedAt: Date | null;
}
```

## Actions

### List Actions
- `VERSION_LIST_LOAD_START` - Begin loading versions
- `VERSION_LIST_LOAD_SUCCESS` - Versions loaded successfully
- `VERSION_LIST_LOAD_MORE_SUCCESS` - More versions appended
- `VERSION_LIST_LOAD_ERROR` - Loading failed
- `VERSION_LIST_RESET` - Clear version list
- `VERSION_LIST_ADD_VERSION` - Add new version to list

### Preview Actions
- `VERSION_PREVIEW_LOAD_START` - Begin loading version details
- `VERSION_PREVIEW_LOAD_SUCCESS` - Version details loaded
- `VERSION_PREVIEW_LOAD_ERROR` - Loading failed
- `VERSION_PREVIEW_CLOSE` - Close preview

### Restore Actions
- `VERSION_RESTORE_START` - Begin restore operation
- `VERSION_RESTORE_SUCCESS` - Restore completed
- `VERSION_RESTORE_ERROR` - Restore failed
- `VERSION_RESTORE_RESET` - Clear restore state

### Panel Actions
- `VERSION_PANEL_OPEN` - Open version history panel
- `VERSION_PANEL_CLOSE` - Close panel
- `VERSION_PANEL_SET_DOCUMENT` - Switch to different document

### Version Creation
- `VERSION_CREATED` - New version created
- `VERSION_CREATION_FAILED` - Version creation failed

## Version Types

```typescript
type ChangeType = 'create' | 'edit' | 'auto-save' | 'restore' | 'ai-update';
type AuthorType = 'user' | 'ai' | 'system';

interface DocumentVersion {
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
```

## Helper Functions

```typescript
import {
  formatVersionDate,
  getChangeTypeLabel,
  getAuthorTypeLabel,
  formatContentSize,
} from '../../lib/documents/versions';

// Format "3 分钟前" or "2024年1月15日 14:30"
formatVersionDate(version); // => "3 分钟前"

// Get localized change type label
getChangeTypeLabel('auto-save'); // => "自动保存"

// Get localized author type label
getAuthorTypeLabel('user'); // => "用户"

// Format content size
formatContentSize(1536); // => "1.5 KB"
```

## Backend Integration

This module communicates with the main process via IPC:

- `version:create` - Create new version
- `version:get-history` - Get version history
- `version:get` - Get single version
- `version:get-latest` - Get latest version
- `version:restore` - Restore to version
- `version:prune` - Clean up old versions
- `version:auto-save` - Auto-save with interval check

The backend service (`main/database/version-history.ts`) handles:
- Version numbering
- Content diffing
- Content hashing
- Auto-save throttling
- Version pruning

## Best Practices

1. **Load on demand**: Only load versions when the panel is opened
2. **Pagination**: Use `loadMoreVersions()` for large histories
3. **Error handling**: Always handle errors from async operations
4. **Restore confirmation**: Show preview before restoring
5. **Pruning**: Periodically call `pruneVersions()` to limit storage