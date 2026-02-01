// ================================
// Version Reducer
// Single responsibility: Pure state transitions for version history
// No side effects, no async operations
// ================================

import {
  VersionState,
  initialVersionListState,
  initialVersionPreviewState,
  initialVersionRestoreState,
  initialVersionCompareState,
} from './state';
import { VersionAction } from './actions';

// ================================
// Reducer Function
// ================================

export function versionReducer(state: VersionState, action: VersionAction): VersionState {
  switch (action.type) {
    // ================================
    // List Actions
    // ================================

    case 'VERSION_LIST_LOAD_START':
      return {
        ...state,
        list: {
          ...state.list,
          loading: true,
          error: null,
        },
      };

    case 'VERSION_LIST_LOAD_SUCCESS':
      return {
        ...state,
        list: {
          versions: action.payload.versions,
          totalCount: action.payload.totalCount,
          hasMore: action.payload.hasMore,
          loading: false,
          error: null,
          offset: action.payload.versions.length,
        },
      };

    case 'VERSION_LIST_LOAD_MORE_SUCCESS':
      return {
        ...state,
        list: {
          ...state.list,
          versions: [...state.list.versions, ...action.payload.versions],
          hasMore: action.payload.hasMore,
          loading: false,
          error: null,
          offset: state.list.offset + action.payload.versions.length,
        },
      };

    case 'VERSION_LIST_LOAD_ERROR':
      return {
        ...state,
        list: {
          ...state.list,
          loading: false,
          error: action.payload,
        },
      };

    case 'VERSION_LIST_RESET':
      return {
        ...state,
        list: initialVersionListState,
      };

    case 'VERSION_LIST_ADD_VERSION':
      // Add new version to the beginning of the list
      return {
        ...state,
        list: {
          ...state.list,
          versions: [action.payload, ...state.list.versions],
          totalCount: state.list.totalCount + 1,
        },
        lastCreatedVersion: action.payload,
        lastVersionCreatedAt: new Date(),
      };

    // ================================
    // Preview Actions
    // ================================

    case 'VERSION_PREVIEW_LOAD_START':
      return {
        ...state,
        preview: {
          version: null,
          loading: true,
          error: null,
        },
      };

    case 'VERSION_PREVIEW_LOAD_SUCCESS':
      return {
        ...state,
        preview: {
          version: action.payload,
          loading: false,
          error: null,
        },
      };

    case 'VERSION_PREVIEW_LOAD_ERROR':
      return {
        ...state,
        preview: {
          ...state.preview,
          loading: false,
          error: action.payload,
        },
      };

    case 'VERSION_PREVIEW_CLOSE':
      return {
        ...state,
        preview: initialVersionPreviewState,
      };

    // ================================
    // Restore Actions
    // ================================

    case 'VERSION_RESTORE_START':
      return {
        ...state,
        restore: {
          restoring: true,
          versionId: action.payload,
          error: null,
          lastRestoredVersion: null,
        },
      };

    case 'VERSION_RESTORE_SUCCESS':
      return {
        ...state,
        restore: {
          restoring: false,
          versionId: null,
          error: null,
          lastRestoredVersion: action.payload,
        },
        // Also add the restored version to the list
        list: {
          ...state.list,
          versions: [action.payload, ...state.list.versions],
          totalCount: state.list.totalCount + 1,
        },
        lastCreatedVersion: action.payload,
        lastVersionCreatedAt: new Date(),
      };

    case 'VERSION_RESTORE_ERROR':
      return {
        ...state,
        restore: {
          ...state.restore,
          restoring: false,
          error: action.payload,
        },
      };

    case 'VERSION_RESTORE_RESET':
      return {
        ...state,
        restore: initialVersionRestoreState,
      };

    // ================================
    // Compare Actions
    // ================================

    case 'VERSION_COMPARE_START':
      return {
        ...state,
        compare: {
          ...state.compare,
          loading: true,
          error: null,
        },
      };

    case 'VERSION_COMPARE_SET_VERSIONS':
      return {
        ...state,
        compare: {
          versionA: action.payload.versionA,
          versionB: action.payload.versionB,
          loading: false,
          error: null,
        },
      };

    case 'VERSION_COMPARE_LOAD_ERROR':
      return {
        ...state,
        compare: {
          ...state.compare,
          loading: false,
          error: action.payload,
        },
      };

    case 'VERSION_COMPARE_CLOSE':
      return {
        ...state,
        compare: initialVersionCompareState,
      };

    // ================================
    // Panel Actions
    // ================================

    case 'VERSION_PANEL_OPEN':
      return {
        ...state,
        isOpen: true,
        documentId: action.payload,
        // Reset list when opening for a new document
        list: state.documentId !== action.payload ? initialVersionListState : state.list,
      };

    case 'VERSION_PANEL_CLOSE':
      return {
        ...state,
        isOpen: false,
        // Keep the data for potential re-open, but close preview
        preview: initialVersionPreviewState,
      };

    case 'VERSION_PANEL_SET_DOCUMENT':
      // Switch to a different document
      if (state.documentId === action.payload) {
        return state; // No change needed
      }
      return {
        ...state,
        documentId: action.payload,
        list: initialVersionListState,
        preview: initialVersionPreviewState,
        restore: initialVersionRestoreState,
        compare: initialVersionCompareState,
      };

    // ================================
    // Version Creation Actions
    // ================================

    case 'VERSION_CREATED':
      // Only add to list if the panel is open and matches the document
      if (state.isOpen && state.documentId === action.payload.itemId) {
        return {
          ...state,
          list: {
            ...state.list,
            versions: [action.payload, ...state.list.versions],
            totalCount: state.list.totalCount + 1,
          },
          lastCreatedVersion: action.payload,
          lastVersionCreatedAt: new Date(),
        };
      }
      // Otherwise just update the last created info
      return {
        ...state,
        lastCreatedVersion: action.payload,
        lastVersionCreatedAt: new Date(),
      };

    case 'VERSION_CREATION_FAILED':
      // Log error but don't break the UI state
      console.error('[VersionReducer] Version creation failed:', action.payload);
      return state;

    // ================================
    // Default
    // ================================

    default:
      return state;
  }
}

export default versionReducer;
