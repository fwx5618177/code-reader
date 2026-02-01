// ================================
// Document Reducer
// Single responsibility: Pure state transitions only
// No side effects, no async operations
// ================================

import {
  DocumentState,
  initialDocumentState,
  initialEditorState,
  initialAutoSaveState,
} from './state';
import { DocumentAction } from './actions';
import { DocumentListItem } from './types';

// ================================
// Helper Functions
// ================================

/**
 * Sort list items by pinned status, then by updated date
 */
function sortListItems(items: DocumentListItem[]): DocumentListItem[] {
  return [...items].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

// ================================
// Reducer Function
// ================================

export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    // ================================
    // Global Actions
    // ================================

    case 'INIT_START':
      return {
        ...state,
        list: { ...state.list, loading: true, error: null },
        initialized: false,
      };

    case 'INIT_SUCCESS': {
      const { list, document } = action.payload;
      // list is already sorted from hook, don't re-sort
      return {
        ...state,
        list: {
          items: list,
          loading: false,
          error: null,
        },
        editor: document
          ? {
              documentId: document.id,
              document: document,
              loading: false,
              saving: false,
              error: null,
              dirty: false,
              autoSave: initialAutoSaveState,
              lastSavedAt: null,
              lastVersionAt: null,
            }
          : initialEditorState,
        initialized: true,
      };
    }

    case 'INIT_ERROR':
      return {
        ...state,
        list: { ...state.list, loading: false, error: action.payload },
        initialized: false,
      };

    case 'RESET':
      return initialDocumentState;

    // ================================
    // List Actions
    // ================================

    case 'LIST_LOAD_START':
      return {
        ...state,
        list: { ...state.list, loading: true, error: null },
      };

    case 'LIST_LOAD_SUCCESS':
      // list is already sorted from database, don't re-sort
      return {
        ...state,
        list: {
          items: action.payload,
          loading: false,
          error: null,
        },
      };

    case 'LIST_LOAD_ERROR':
      return {
        ...state,
        list: { ...state.list, loading: false, error: action.payload },
      };

    case 'LIST_ADD_ITEM': {
      const newItems = [action.payload, ...state.list.items];
      return {
        ...state,
        list: { ...state.list, items: sortListItems(newItems) },
      };
    }

    case 'LIST_UPDATE_ITEM': {
      const updatedItems = state.list.items.map((item) =>
        item.id === action.payload.id ? action.payload : item
      );
      return {
        ...state,
        list: { ...state.list, items: sortListItems(updatedItems) },
      };
    }

    case 'LIST_REMOVE_ITEM': {
      const filteredItems = state.list.items.filter((item) => item.id !== action.payload);
      return {
        ...state,
        list: { ...state.list, items: filteredItems },
      };
    }

    // ================================
    // Editor Actions
    // ================================

    case 'EDITOR_LOAD_START':
      return {
        ...state,
        editor: {
          documentId: action.payload,
          document: null,
          loading: true,
          saving: false,
          error: null,
          dirty: false,
          autoSave: initialAutoSaveState,
          lastSavedAt: null,
          lastVersionAt: null,
        },
      };

    case 'EDITOR_LOAD_SUCCESS':
      return {
        ...state,
        editor: {
          documentId: action.payload.id,
          document: action.payload,
          loading: false,
          saving: false,
          error: null,
          dirty: false,
          autoSave: initialAutoSaveState,
          lastSavedAt: null,
          lastVersionAt: null,
        },
      };

    case 'EDITOR_LOAD_ERROR':
      return {
        ...state,
        editor: {
          ...state.editor,
          loading: false,
          error: action.payload,
        },
      };

    case 'EDITOR_UPDATE_LOCAL': {
      if (!state.editor.document) {
        return state;
      }

      const { title, content } = action.payload;
      const updatedDocument = {
        ...state.editor.document,
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
      };

      return {
        ...state,
        editor: {
          ...state.editor,
          document: updatedDocument,
          dirty: true,
        },
      };
    }

    case 'EDITOR_SAVE_START':
      return {
        ...state,
        // Use saving instead of loading to prevent UI from hiding the editor
        editor: { ...state.editor, saving: true, error: null },
      };

    case 'EDITOR_SAVE_SUCCESS':
      return {
        ...state,
        editor: {
          ...state.editor,
          document: action.payload,
          saving: false,
          error: null,
          dirty: false,
          lastSavedAt: new Date(),
        },
      };

    // Silent save success - only updates metadata, does NOT overwrite editor content
    // This is the key to non-blocking auto-save that doesn't interrupt editing
    // Inspired by VS Code's optimistic update pattern
    case 'EDITOR_SAVE_SUCCESS_SILENT': {
      // Only update if we're still on the same document
      if (state.editor.documentId !== action.payload.documentId) {
        return state;
      }

      // Update document's updatedAt without touching content
      const currentDoc = state.editor.document;
      if (!currentDoc) {
        return state;
      }

      return {
        ...state,
        editor: {
          ...state.editor,
          document: {
            ...currentDoc,
            updatedAt: action.payload.updatedAt,
          },
          saving: false,
          error: null,
          dirty: false,
          lastSavedAt: action.payload.updatedAt,
        },
      };
    }

    case 'EDITOR_SAVE_ERROR':
      return {
        ...state,
        editor: { ...state.editor, saving: false, error: action.payload },
      };

    case 'EDITOR_CLEAR':
      return {
        ...state,
        editor: initialEditorState,
      };

    case 'EDITOR_SET_DIRTY':
      return {
        ...state,
        editor: { ...state.editor, dirty: action.payload },
      };

    // ================================
    // Auto-Save Actions
    // ================================

    case 'EDITOR_AUTO_SAVE_STATE_CHANGED':
      return {
        ...state,
        editor: {
          ...state.editor,
          autoSave: action.payload,
          // Sync dirty state with auto-save state
          dirty: action.payload.isDirty,
        },
      };

    case 'EDITOR_VERSION_CREATED':
      return {
        ...state,
        editor: {
          ...state.editor,
          lastVersionAt: action.payload.createdAt,
        },
      };

    // ================================
    // Default
    // ================================

    default:
      return state;
  }
}

export default documentReducer;
