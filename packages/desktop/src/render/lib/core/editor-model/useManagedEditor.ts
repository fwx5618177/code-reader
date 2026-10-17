// ================================
// useManagedEditor Hook
// 使用 DocumentEditorManager 进行正确生命周期管理的 React Hook
// 确保每个文档只有单个实例，防止内存泄漏
// ================================

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { EditorModel } from './editor-model';
import { ContentChangeEvent } from './types';
import {
  DocumentEditorManager,
  ManagedEditorInstance,
  CreateEditorOptions,
} from './editor-manager';
import {
  SaveEngine,
  SaveResult,
  SaveEngineEvent,
  ISaveExecutor,
  createFailedResult,
} from '../save-engine';

// ================================
// 类型定义
// ================================

/**
 * useManagedEditor Hook 配置
 */
export interface UseManagedEditorConfig {
  /** 文档 ID（获取实例必需） */
  documentId: string | null;
  /** 新文档的初始标题 */
  initialTitle?: string;
  /** 新文档的初始内容 */
  initialContent?: string;
  /** 保存执行器（必需） */
  executor: ISaveExecutor;
  /** 自动保存防抖延迟（毫秒） */
  debounceMs?: number;
  /** 保存最大间隔（毫秒） */
  maxIntervalMs?: number;
  /** 是否启用自动保存 */
  autoSaveEnabled?: boolean;
  /** 内容变更回调 */
  onContentChange?: (event: ContentChangeEvent) => void;
  /** 保存成功回调 */
  onSaveSuccess?: (result: SaveResult) => void;
  /** 保存失败回调 */
  onSaveError?: (result: SaveResult) => void;
  /** 所有保存引擎事件回调 */
  onSaveEvent?: (event: SaveEngineEvent) => void;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * useManagedEditor Hook 返回类型
 */
export interface UseManagedEditorReturn {
  // ================================
  // 实例状态
  // ================================

  /** 是否已获取编辑器实例 */
  isAcquired: boolean;

  /** 当前文档 ID */
  documentId: string | null;

  /** 实例是否准备就绪可用 */
  isReady: boolean;

  // ================================
  // 内容状态
  // ================================

  /** 当前标题 */
  title: string;

  /** 当前内容 */
  content: string;

  /** 当前版本 ID */
  versionId: number;

  /** 是否有未保存的更改 */
  hasUnsavedChanges: boolean;

  /** 编辑器是否为空 */
  isEmpty: boolean;

  // ================================
  // 内容操作
  // ================================

  /** 更新内容（触发版本递增和自动保存） */
  updateContent: (content: string) => void;

  /** 更新标题（触发版本递增和自动保存） */
  updateTitle: (title: string) => void;

  /** 同时更新标题和内容 */
  update: (title: string, content: string) => void;

  // ================================
  // 文档操作
  // ================================

  /** 将新内容加载到当前文档 */
  loadContent: (title: string, content: string) => void;

  /** 切换到新文档（释放当前实例并获取新实例） */
  switchDocument: (documentId: string, title: string, content: string) => void;

  /** 清空编辑器（释放当前实例） */
  clear: () => void;

  // ================================
  // 保存操作
  // ================================

  /** 请求保存（通过策略调度） */
  requestSave: () => void;

  /** 立即保存 */
  saveNow: () => Promise<SaveResult>;

  /** 取消待处理的保存 */
  cancelPendingSave: () => void;

  /** 是否正在保存 */
  isSaving: boolean;

  /** 是否已调度保存 */
  isScheduled: boolean;

  /** 最后保存时间戳 */
  lastSavedAt: Date | null;

  /** 最后保存的版本 ID */
  lastSavedVersionId: number | null;

  // ================================
  // 自动保存控制
  // ================================

  /** 启用自动保存 */
  enableAutoSave: () => void;

  /** 禁用自动保存 */
  disableAutoSave: () => void;

  /** 自动保存是否启用 */
  isAutoSaveEnabled: boolean;

  // ================================
  // 模型访问（高级用途）
  // ================================

  /** 直接访问 EditorModel（未获取时为 null） */
  model: EditorModel | null;

  /** 直接访问 SaveEngine（未获取时为 null） */
  saveEngine: SaveEngine | null;
}

// ================================
// Hook 实现
// ================================

/**
 * useManagedEditor - 具有正确生命周期管理的文档编辑 React Hook
 *
 * 核心特性：
 * - 使用 DocumentEditorManager 单例进行实例管理
 * - 正确的引用计数和清理
 * - 安全的异步操作，带有已销毁实例检查
 * - 跨组件的单文档单实例
 *
 * 使用示例：
 * ```tsx
 * const {
 *   title,
 *   content,
 *   updateContent,
 *   updateTitle,
 *   saveNow,
 *   isSaving,
 *   hasUnsavedChanges,
 * } = useManagedEditor({
 *   documentId: selectedDocId,
 *   executor: {
 *     save: async (snapshot) => {
 *       await database.save(snapshot);
 *       return createSuccessResult(snapshot.versionId, snapshot.documentId);
 *     },
 *   },
 *   onSaveSuccess: (result) => {
 *     console.log('已保存:', result.savedVersionId);
 *   },
 * });
 * ```
 */
export function useManagedEditor(config: UseManagedEditorConfig): UseManagedEditorReturn {
  // ================================
  // Refs
  // ================================

  // 追踪当前获取的文档 ID
  const acquiredDocIdRef = useRef<string | null>(null);

  // 追踪当前实例
  const instanceRef = useRef<ManagedEditorInstance | null>(null);

  // 本 hook 在当前实例上的订阅：同一文档可能被多个 hook 持有，各自订阅、各自取消
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // 将回调保存在 refs 中以避免闭包过期
  const configRef = useRef(config);
  configRef.current = config;

  // 追踪组件是否挂载
  const isMountedRef = useRef(true);

  // ================================
  // React State
  // ================================

  const [currentVersionId, setCurrentVersionId] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastSavedVersionId, setLastSavedVersionId] = useState<number | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(config.autoSaveEnabled ?? true);
  const [isAcquired, setIsAcquired] = useState(false);

  // ================================
  // 管理器访问
  // ================================

  const manager = useMemo(() => {
    return DocumentEditorManager.getInstance({
      debug: config.debug,
    });
  }, [config.debug]);

  // ================================
  // 实例获取/释放
  // ================================

  // 取消订阅并释放当前实例（自动保存由实例自身负责，释放后待保存的更改照常写回）
  const detachInstance = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (acquiredDocIdRef.current) {
      manager.release(acquiredDocIdRef.current);
    }
    acquiredDocIdRef.current = null;
    instanceRef.current = null;
  }, [manager]);

  const acquireInstance = useCallback(
    (documentId: string): ManagedEditorInstance | null => {
      // 已经获取了此文档
      if (acquiredDocIdRef.current === documentId && instanceRef.current) {
        return instanceRef.current;
      }

      // 如果有旧实例则释放
      detachInstance();

      // 准备创建选项
      const options: CreateEditorOptions = {
        initialTitle: configRef.current.initialTitle ?? '',
        initialContent: configRef.current.initialContent ?? '',
        executor: configRef.current.executor,
        autoSaveEnabled: configRef.current.autoSaveEnabled ?? true,
        debounceMs: configRef.current.debounceMs,
        maxIntervalMs: configRef.current.maxIntervalMs,
      };

      // 获取实例（已存在时沿用其内容，初始标题与内容不生效）
      const { instance } = manager.acquire(documentId, options);

      if (instance.isDestroyed) {
        console.error('[useManagedEditor] 获取到已销毁的实例');
        return null;
      }

      // 存储引用
      acquiredDocIdRef.current = documentId;
      instanceRef.current = instance;

      // 订阅内容与保存事件，只更新本 hook 的状态
      const offContent = instance.model.onContentChange((event) => {
        if (!isMountedRef.current) return;
        setCurrentVersionId(event.newVersionId);
        configRef.current.onContentChange?.(event);
      });
      const offSave = instance.saveEngine.addEventListener((event) => {
        if (!isMountedRef.current) return;

        switch (event.type) {
          case 'SAVE_STARTED':
            setIsSaving(true);
            break;
          case 'SAVE_SUCCESS':
            setIsSaving(false);
            setIsScheduled(false);
            setLastSavedAt(event.result.savedAt);
            setLastSavedVersionId(event.result.savedVersionId);
            configRef.current.onSaveSuccess?.(event.result);
            break;
          case 'SAVE_FAILED':
            setIsSaving(false);
            configRef.current.onSaveError?.(event.result);
            break;
          case 'SAVE_SCHEDULED':
            setIsScheduled(true);
            break;
          case 'SAVE_CANCELLED':
            setIsScheduled(false);
            break;
        }

        configRef.current.onSaveEvent?.(event);
      });
      unsubscribeRef.current = () => {
        offContent();
        offSave();
      };

      return instance;
    },
    [manager, detachInstance]
  );

  const releaseInstance = useCallback(() => {
    if (acquiredDocIdRef.current) {
      detachInstance();
      setIsAcquired(false);
    }
  }, [detachInstance]);

  // ================================
  // Effect: documentId 变更时获取/释放
  // ================================

  useEffect(() => {
    isMountedRef.current = true;

    if (config.documentId) {
      const instance = acquireInstance(config.documentId);
      if (instance) {
        setIsAcquired(true);
        setCurrentVersionId(instance.model.getVersionId());
        setLastSavedVersionId(instance.model.getLastSavedVersionId());
      }
    } else {
      releaseInstance();
    }

    return () => {
      isMountedRef.current = false;
      // 卸载时释放
      detachInstance();
    };
  }, [config.documentId, acquireInstance, releaseInstance, detachInstance]);

  // ================================
  // 安全的实例访问
  // ================================

  const getInstance = useCallback((): ManagedEditorInstance | null => {
    const instance = instanceRef.current;
    if (!instance || instance.isDestroyed) {
      return null;
    }
    return instance;
  }, []);

  // ================================
  // 内容操作
  // ================================

  const updateContent = useCallback(
    (content: string) => {
      const instance = getInstance();
      if (!instance) {
        console.warn('[useManagedEditor] 无法 updateContent - 没有实例');
        return;
      }
      instance.model.updateContent(content);
    },
    [getInstance]
  );

  const updateTitle = useCallback(
    (title: string) => {
      const instance = getInstance();
      if (!instance) {
        console.warn('[useManagedEditor] 无法 updateTitle - 没有实例');
        return;
      }
      instance.model.updateTitle(title);
    },
    [getInstance]
  );

  const update = useCallback(
    (title: string, content: string) => {
      const instance = getInstance();
      if (!instance) {
        console.warn('[useManagedEditor] 无法 update - 没有实例');
        return;
      }
      instance.model.update(title, content);
    },
    [getInstance]
  );

  // ================================
  // 文档操作
  // ================================

  const loadContent = useCallback(
    (title: string, content: string) => {
      const instance = getInstance();
      if (!instance) {
        console.warn('[useManagedEditor] 无法 loadContent - 没有实例');
        return;
      }
      // 先取消待处理的保存
      instance.saveEngine.cancelPendingSave();
      // 用新内容重置模型
      instance.model.reset({
        documentId: instance.documentId,
        initialTitle: title,
        initialContent: content,
        initialVersionId: 1,
      });
      // 更新 React 状态
      setCurrentVersionId(1);
      setLastSavedVersionId(null);
      setLastSavedAt(null);
    },
    [getInstance]
  );

  const switchDocument = useCallback(
    (documentId: string, title: string, content: string) => {
      // 释放当前实例
      releaseInstance();

      // 更新配置用于新的获取
      configRef.current = {
        ...configRef.current,
        documentId,
        initialTitle: title,
        initialContent: content,
      };

      // 获取新实例
      const instance = acquireInstance(documentId);
      if (instance) {
        setIsAcquired(true);
        setCurrentVersionId(instance.model.getVersionId());
        setLastSavedVersionId(null);
        setLastSavedAt(null);
      }
    },
    [acquireInstance, releaseInstance]
  );

  const clear = useCallback(() => {
    releaseInstance();
    setCurrentVersionId(1);
    setLastSavedVersionId(null);
    setLastSavedAt(null);
    setIsSaving(false);
    setIsScheduled(false);
  }, [releaseInstance]);

  // ================================
  // 保存操作
  // ================================

  const requestSave = useCallback(() => {
    const instance = getInstance();
    if (!instance) return;
    instance.saveEngine.requestSave();
  }, [getInstance]);

  const saveNow = useCallback(async (): Promise<SaveResult> => {
    const instance = getInstance();
    if (!instance) {
      return createFailedResult('没有编辑器实例');
    }
    return instance.saveEngine.saveNow();
  }, [getInstance]);

  const cancelPendingSave = useCallback(() => {
    const instance = getInstance();
    if (!instance) return;
    instance.saveEngine.cancelPendingSave();
  }, [getInstance]);

  // ================================
  // 自动保存控制
  // ================================

  const enableAutoSave = useCallback(() => {
    const instance = getInstance();
    if (instance) {
      instance.saveEngine.setAutoSaveEnabled(true);
    }
    setAutoSaveEnabled(true);
  }, [getInstance]);

  const disableAutoSave = useCallback(() => {
    const instance = getInstance();
    if (instance) {
      instance.saveEngine.setAutoSaveEnabled(false);
    }
    setAutoSaveEnabled(false);
  }, [getInstance]);

  // ================================
  // 计算值
  // ================================

  const instance = getInstance();
  const model = instance?.model ?? null;
  const saveEngine = instance?.saveEngine ?? null;

  const title = useMemo(() => {
    return model?.getTitle() ?? configRef.current.initialTitle ?? '';
  }, [model, currentVersionId]);

  const content = useMemo(() => {
    return model?.getContent() ?? configRef.current.initialContent ?? '';
  }, [model, currentVersionId]);

  const hasUnsavedChanges = useMemo(() => {
    return model?.hasUnsavedChanges() ?? false;
  }, [model, currentVersionId, lastSavedVersionId]);

  const isEmpty = useMemo(() => {
    return model?.isEmpty() ?? true;
  }, [model, currentVersionId]);

  const isReady = isAcquired && model !== null && !model.isDestroyed();

  // ================================
  // 返回
  // ================================

  return {
    // 实例状态
    isAcquired,
    documentId: config.documentId,
    isReady,

    // 内容状态
    title,
    content,
    versionId: currentVersionId,
    hasUnsavedChanges,
    isEmpty,

    // 内容操作
    updateContent,
    updateTitle,
    update,

    // 文档操作
    loadContent,
    switchDocument,
    clear,

    // 保存操作
    requestSave,
    saveNow,
    cancelPendingSave,
    isSaving,
    isScheduled,
    lastSavedAt,
    lastSavedVersionId,

    // 自动保存控制
    enableAutoSave,
    disableAutoSave,
    isAutoSaveEnabled: autoSaveEnabled,

    // 模型访问
    model,
    saveEngine,
  };
}

export default useManagedEditor;
