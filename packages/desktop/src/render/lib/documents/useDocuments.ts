// ================================
// useDocuments Hook
// 高层文档管理，具有正确的生命周期控制
// 使用 useManagedEditor 通过 DocumentEditorManager 进行编辑器状态管理
//
// 状态管理说明：
// - isSaving: 完全由 useManagedEditor 管理，不再同步到 reducer
// - lastSavedAt: 优先使用 editor.lastSavedAt
// - isDirty: 优先使用 editor.hasUnsavedChanges
//
// 集成功能：
// - WritingIntegration: 搜索索引、差分缓存、性能监控
// ================================

import { useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import { documentReducer } from './reducer';
import { documentService } from './service';
import { initialDocumentState } from './state';
import { actions } from './actions';
import { Document, DocumentListItem, CreateDocumentInput } from './types';
import { versionService, DocumentVersion } from './versions';
import {
  useManagedEditor,
  createSuccessResult,
  createFailedResult,
  ContentSnapshot,
} from '../core';
import { WritingIntegration, getWritingIntegration } from './writing-integration';

// ================================
// 配置
// ================================

export interface UseDocumentsConfig {
  /** 自动保存防抖延迟（毫秒） */
  debounceMs?: number;
  /** 保存最大间隔（毫秒） */
  maxIntervalMs?: number;
  /** 是否启用自动保存 */
  autoSaveEnabled?: boolean;
  /** 版本创建时的回调 */
  onVersionCreated?: (version: DocumentVersion) => void;
  /** 是否启用调试日志 */
  debug?: boolean;
}

// ================================
// 返回类型
// ================================

export interface UseDocumentsReturn {
  // 列表状态
  documents: DocumentListItem[];
  listLoading: boolean;
  listError: string | null;

  // 编辑器状态
  currentDocument: Document | null;
  selectedId: string | null;
  editorLoading: boolean;
  editorError: string | null;
  isDirty: boolean;

  // 自动保存状态
  isSaving: boolean;
  lastSavedAt: Date | null;

  // 全局状态
  isInitialized: boolean;
  isFirstTime: boolean;

  // 计算值
  title: string;
  content: string;
  wordCount: number;
  charCount: number;

  // 操作
  initialize: () => Promise<void>;
  selectDocument: (id: string) => Promise<void>;
  reloadDocument: () => Promise<void>;
  createDocument: (input?: CreateDocumentInput) => Promise<Document | null>;
  updateLocal: (updates: { title?: string; content?: string }) => void;
  saveDocument: () => Promise<boolean>;
  deleteDocument: (id: string) => Promise<boolean>;
  refreshList: () => Promise<void>;

  // 自动保存控制
  enableAutoSave: () => void;
  disableAutoSave: () => void;
  isAutoSaveEnabled: boolean;

  // 版本历史
  lastVersionCreatedAt: Date | null;
  createVersion: (changeDescription?: string) => Promise<DocumentVersion | null>;
}

// ================================
// 辅助函数
// ================================

function calculateWordCount(content: string): number {
  if (!content) return 0;
  const text = content.replace(/<[^>]*>/g, '');
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = text
    .replace(/[\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return chineseChars + englishWords;
}

function calculateCharCount(content: string): number {
  if (!content) return 0;
  return content.replace(/<[^>]*>/g, '').replace(/\s/g, '').length;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<Omit<UseDocumentsConfig, 'onVersionCreated'>> & {
  onVersionCreated?: UseDocumentsConfig['onVersionCreated'];
} = {
  debounceMs: 1500,
  maxIntervalMs: 30000,
  autoSaveEnabled: true,
  onVersionCreated: undefined,
  debug: false,
};

// ================================
// Hook Implementation
// ================================

export function useDocuments(config: UseDocumentsConfig = {}): UseDocumentsReturn {
  // Merge config with defaults
  const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);

  // Reducer for list and editor state
  const [state, dispatch] = useReducer(documentReducer, initialDocumentState);

  // Refs for async operation tracking
  const initializingRef = useRef(false);
  const loadingDocRef = useRef<string | null>(null);
  const configRef = useRef(mergedConfig);
  configRef.current = mergedConfig;

  // Track mounted state for async safety
  const isMountedRef = useRef(true);

  // Track last version creation time for version interval
  const lastVersionAtRef = useRef<number | null>(null);
  const VERSION_INTERVAL_MS = 300000; // 5 minutes

  // 写作集成服务引用
  const writingIntegrationRef = useRef<WritingIntegration | null>(null);

  // ================================
  // Save Executor
  // ================================

  const saveExecutor = useMemo(
    () => ({
      save: async (snapshot: ContentSnapshot) => {
        try {
          const saved = await documentService.saveDocument(snapshot.documentId, {
            title: snapshot.title,
            content: snapshot.content,
          });

          if (!saved) {
            return createFailedResult('Failed to save document', snapshot.versionId);
          }

          // 更新搜索索引
          if (writingIntegrationRef.current) {
            writingIntegrationRef.current
              .updateDocumentIndex({
                id: snapshot.documentId,
                title: snapshot.title,
                content: snapshot.content,
              })
              .catch((err) => {
                console.warn('[useDocuments] 更新文档索引失败:', err);
              });
          }

          // Update list item
          if (isMountedRef.current) {
            const listItem = documentService.toListItem(saved);
            dispatch(actions.listUpdateItem(listItem));
          }

          // Maybe create version
          const now = Date.now();
          const shouldCreateVersion =
            !lastVersionAtRef.current || now - lastVersionAtRef.current >= VERSION_INTERVAL_MS;

          if (shouldCreateVersion) {
            try {
              const version = await versionService.createAutoSaveVersion(
                snapshot.documentId,
                snapshot.content,
                { title: snapshot.title }
              );

              if (version && isMountedRef.current) {
                lastVersionAtRef.current = now;
                dispatch(actions.editorVersionCreated(version.id, new Date(now)));
                configRef.current.onVersionCreated?.(version);
              }
            } catch (error) {
              if (configRef.current.debug) {
                console.warn('[useDocuments] Failed to create version:', error);
              }
            }
          }

          if (configRef.current.debug) {
            console.log('[useDocuments] Document saved:', snapshot.documentId);
          }

          // 修复：传入正确的 contentHash，而不是 documentId
          // contentHash 用于 hasUnsavedChanges() 比较，确保保存后状态正确更新
          return createSuccessResult(snapshot.versionId, snapshot.contentHash, snapshot.documentId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return createFailedResult(message, snapshot.versionId);
        }
      },
    }),
    []
  );

  // ================================
  // useManagedEditor Integration
  // ================================

  const editor = useManagedEditor({
    documentId: state.editor.documentId,
    initialTitle: state.editor.document?.title ?? '',
    initialContent: state.editor.document?.content ?? '',
    executor: saveExecutor,
    debounceMs: mergedConfig.debounceMs,
    maxIntervalMs: mergedConfig.maxIntervalMs,
    autoSaveEnabled: mergedConfig.autoSaveEnabled,
    debug: mergedConfig.debug,
    onSaveSuccess: (result) => {
      if (isMountedRef.current && result.documentId) {
        dispatch(
          actions.editorSaveSuccessSilent({
            documentId: result.documentId,
            updatedAt: result.savedAt ?? new Date(),
          })
        );
      }
    },
    onSaveError: (result) => {
      if (isMountedRef.current) {
        dispatch(actions.editorSaveError(result.error ?? 'Save failed'));
      }
    },
  });

  // ================================
  // 生命周期
  // ================================

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 注意：不再同步 editor.isSaving 到 reducer
  // 直接使用 editor.isSaving 作为保存状态的唯一来源
  // 这样避免了状态不同步导致的 loading 卡住问题

  // 初始化写作集成服务
  useEffect(() => {
    let cancelled = false;

    const initWritingIntegration = async () => {
      try {
        const integration = await getWritingIntegration({
          enableSearchIndex: true,
          enableDiffCache: true,
          enablePerformanceMonitor: true,
          debug: mergedConfig.debug,
        });
        if (!cancelled) {
          writingIntegrationRef.current = integration;
          if (mergedConfig.debug) {
            console.log('[useDocuments] 写作集成服务初始化完成');
          }
        }
      } catch (error) {
        console.warn('[useDocuments] 写作集成服务初始化失败:', error);
      }
    };

    initWritingIntegration();

    return () => {
      cancelled = true;
    };
  }, [mergedConfig.debug]);

  // ================================
  // Initialize
  // ================================

  const initialize = useCallback(async (): Promise<void> => {
    if (initializingRef.current || state.initialized) {
      return;
    }

    initializingRef.current = true;
    dispatch(actions.initStart());

    try {
      const list = await documentService.getDocumentList();

      let firstDocument: Document | undefined;
      if (list.length > 0) {
        const firstId = list[0].id;
        firstDocument = (await documentService.getDocument(firstId)) ?? undefined;
      }

      if (isMountedRef.current) {
        dispatch(actions.initSuccess(list, firstDocument));

        // 批量索引所有文档到搜索索引
        if (writingIntegrationRef.current && list.length > 0) {
          const docsToIndex = await Promise.all(
            list.slice(0, 50).map(async (item) => {
              const doc = await documentService.getDocument(item.id);
              return doc ? { id: doc.id, title: doc.title, content: doc.content } : null;
            })
          );
          const validDocs = docsToIndex.filter((d): d is NonNullable<typeof d> => d !== null);
          if (validDocs.length > 0) {
            writingIntegrationRef.current.indexDocuments(validDocs).catch((err) => {
              console.warn('[useDocuments] 批量索引失败:', err);
            });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Initialization failed';
      if (isMountedRef.current) {
        dispatch(actions.initError(message));
      }
      console.error('[useDocuments] Initialization failed:', error);
    } finally {
      initializingRef.current = false;
    }
  }, [state.initialized]);

  // ================================
  // Select Document
  // ================================

  const selectDocument = useCallback(
    async (id: string): Promise<void> => {
      // Already loading this document
      if (loadingDocRef.current === id) {
        return;
      }

      // Already selected and loaded
      if (state.editor.documentId === id && state.editor.document !== null) {
        return;
      }

      // Save current document before switching if there are unsaved changes
      if (editor.hasUnsavedChanges && editor.documentId) {
        await editor.saveNow();
      }

      loadingDocRef.current = id;
      dispatch(actions.editorLoadStart(id));

      try {
        const document = await documentService.getDocument(id);

        if (!isMountedRef.current) {
          return;
        }

        if (document) {
          // Load into editor via switchDocument
          editor.switchDocument(document.id, document.title, document.content);
          dispatch(actions.editorLoadSuccess(document));
        } else {
          dispatch(actions.editorLoadError('Document not found'));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load document';
        if (isMountedRef.current) {
          dispatch(actions.editorLoadError(message));
        }
        console.error('[useDocuments] Select document failed:', error);
      } finally {
        loadingDocRef.current = null;
      }
    },
    [state.editor.documentId, state.editor.document, editor]
  );

  // ================================
  // Reload Document
  // ================================

  const reloadDocument = useCallback(async (): Promise<void> => {
    const id = state.editor.documentId;
    if (!id) {
      console.warn('[useDocuments] No document to reload');
      return;
    }

    if (loadingDocRef.current === id) {
      return;
    }

    loadingDocRef.current = id;
    dispatch(actions.editorLoadStart(id));

    try {
      const document = await documentService.getDocument(id);

      if (!isMountedRef.current) {
        return;
      }

      if (document) {
        editor.loadContent(document.title, document.content);
        dispatch(actions.editorLoadSuccess(document));

        const listItem = documentService.toListItem(document);
        dispatch(actions.listUpdateItem(listItem));
      } else {
        dispatch(actions.editorLoadError('Document not found'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reload document';
      if (isMountedRef.current) {
        dispatch(actions.editorLoadError(message));
      }
      console.error('[useDocuments] Reload document failed:', error);
    } finally {
      loadingDocRef.current = null;
    }
  }, [state.editor.documentId, editor]);

  // ================================
  // Create Document
  // ================================

  const createDocument = useCallback(
    async (input: CreateDocumentInput = {}): Promise<Document | null> => {
      try {
        const document = await documentService.createDocument(input);
        const listItem = documentService.toListItem(document);

        if (!isMountedRef.current) {
          return document;
        }

        dispatch(actions.listAddItem(listItem));

        // Switch to new document
        editor.switchDocument(document.id, document.title, document.content);
        dispatch(actions.editorLoadSuccess(document));

        return document;
      } catch (error) {
        console.error('[useDocuments] Create document failed:', error);
        return null;
      }
    },
    [editor]
  );

  // ================================
  // Update Local
  // ================================

  const updateLocal = useCallback(
    (updates: { title?: string; content?: string }): void => {
      if (updates.title !== undefined) {
        editor.updateTitle(updates.title);
      }
      if (updates.content !== undefined) {
        editor.updateContent(updates.content);
      }

      // Update reducer state for UI
      dispatch(actions.editorUpdateLocal(updates));
    },
    [editor]
  );

  // ================================
  // Save Document
  // ================================

  const saveDocument = useCallback(async (): Promise<boolean> => {
    const result = await editor.saveNow();
    return result.success;
  }, [editor]);

  // ================================
  // Delete Document
  // ================================

  const deleteDocument = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const success = await documentService.deleteDocument(id);

        if (!success || !isMountedRef.current) {
          return success;
        }

        dispatch(actions.listRemoveItem(id));

        if (state.editor.documentId === id) {
          editor.clear();
          dispatch(actions.editorClear());

          // Select next document if available
          const remaining = state.list.items.filter((item) => item.id !== id);
          if (remaining.length > 0) {
            // Use queueMicrotask to ensure state is updated before selecting
            queueMicrotask(() => {
              if (isMountedRef.current) {
                selectDocument(remaining[0].id);
              }
            });
          }
        }

        return success;
      } catch (error) {
        console.error('[useDocuments] Delete document failed:', error);
        return false;
      }
    },
    [state.editor.documentId, state.list.items, editor, selectDocument]
  );

  // ================================
  // Refresh List
  // ================================

  const refreshList = useCallback(async (): Promise<void> => {
    dispatch(actions.listLoadStart());

    try {
      const list = await documentService.getDocumentList();

      if (isMountedRef.current) {
        dispatch(actions.listLoadSuccess(list));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load documents';
      if (isMountedRef.current) {
        dispatch(actions.listLoadError(message));
      }
      console.error('[useDocuments] Refresh list failed:', error);
    }
  }, []);

  // ================================
  // Auto-Save Control
  // ================================

  const enableAutoSave = useCallback(() => {
    editor.enableAutoSave();
  }, [editor]);

  const disableAutoSave = useCallback(() => {
    editor.disableAutoSave();
  }, [editor]);

  // ================================
  // Create Version (manual)
  // ================================

  const createVersion = useCallback(
    async (changeDescription?: string): Promise<DocumentVersion | null> => {
      const documentId = state.editor.documentId;
      const document = state.editor.document;

      if (!documentId || !document) {
        console.warn('[useDocuments] No document to create version for');
        return null;
      }

      try {
        // Use current editor content
        const currentContent = editor.content;
        const currentTitle = editor.title;

        const version = await versionService.createSaveVersion(documentId, currentContent, {
          title: currentTitle,
          changeDescription: changeDescription || '手动创建版本',
        });

        if (isMountedRef.current) {
          lastVersionAtRef.current = Date.now();
          dispatch(actions.editorVersionCreated(version.id, new Date(version.createdAt)));
          configRef.current.onVersionCreated?.(version);
        }

        if (configRef.current.debug) {
          console.log('[useDocuments] Manual version created:', version.id);
        }

        return version;
      } catch (error) {
        console.error('[useDocuments] Failed to create version:', error);
        return null;
      }
    },
    [state.editor.documentId, state.editor.document, editor.content, editor.title]
  );

  // ================================
  // Computed Values
  // ================================

  const title = editor.isReady ? editor.title : (state.editor.document?.title ?? '');
  const content = editor.isReady ? editor.content : (state.editor.document?.content ?? '');
  const wordCount = useMemo(() => calculateWordCount(content), [content]);
  const charCount = useMemo(() => calculateCharCount(content), [content]);

  const isFirstTime = state.initialized && state.list.items.length === 0;
  // 修复：只使用 editor.isSaving 作为唯一来源，避免状态不同步
  // 之前使用 OR 逻辑会导致 state.editor.saving 卡在 true 不重置
  const isSaving = editor.isSaving;
  const lastSavedAt = editor.lastSavedAt ?? state.editor.lastSavedAt;
  const lastVersionCreatedAt = state.editor.lastVersionAt;
  const isDirty = editor.isReady ? editor.hasUnsavedChanges : state.editor.dirty;

  // ================================
  // Return
  // ================================

  return useMemo(
    () => ({
      // List state
      documents: state.list.items,
      listLoading: state.list.loading,
      listError: state.list.error,

      // Editor state
      currentDocument: state.editor.document,
      selectedId: state.editor.documentId,
      editorLoading: state.editor.loading,
      editorError: state.editor.error,
      isDirty,

      // Auto-save state
      isSaving,
      lastSavedAt,

      // Global state
      isInitialized: state.initialized,
      isFirstTime,

      // Computed values
      title,
      content,
      wordCount,
      charCount,

      // Actions
      initialize,
      selectDocument,
      reloadDocument,
      createDocument,
      updateLocal,
      saveDocument,
      deleteDocument,
      refreshList,

      // Auto-save control
      enableAutoSave,
      disableAutoSave,
      isAutoSaveEnabled: editor.isAutoSaveEnabled,

      // Version history
      lastVersionCreatedAt,
      createVersion,
    }),
    [
      state.list.items,
      state.list.loading,
      state.list.error,
      state.editor.document,
      state.editor.documentId,
      state.editor.loading,
      state.editor.error,
      isDirty,
      isSaving,
      lastSavedAt,
      state.initialized,
      isFirstTime,
      title,
      content,
      wordCount,
      charCount,
      initialize,
      selectDocument,
      reloadDocument,
      createDocument,
      updateLocal,
      saveDocument,
      deleteDocument,
      refreshList,
      enableAutoSave,
      disableAutoSave,
      editor.isAutoSaveEnabled,
      lastVersionCreatedAt,
      createVersion,
    ]
  );
}

export default useDocuments;
