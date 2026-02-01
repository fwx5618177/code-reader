// ================================
// useEditorModel Hook（低层）
// EditorModel 的 React 集成，提供版本化内容追踪
// 注意：推荐使用 useManagedEditor（高层）以获得更好的生命周期管理
// ================================

import { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import {
  EditorModel,
  EditorModelConfig,
  VersionedContent,
  ContentSnapshot,
  ContentChangeEvent,
} from './index';

// ================================
// Hook 配置
// ================================

export interface UseEditorModelConfig extends EditorModelConfig {
  /** 内容变更时的回调 */
  onContentChange?: (event: ContentChangeEvent) => void;
  /** 内容保存时的回调 */
  onSaved?: (versionId: number) => void;
}

// ================================
// Hook 返回类型
// ================================

export interface UseEditorModelReturn {
  // ================================
  // 内容访问
  // ================================

  /** 获取当前版本化内容（用于保存操作） */
  getVersionedContent: () => VersionedContent;

  /** 获取带文档 ID 的内容快照 */
  getSnapshot: () => ContentSnapshot | null;

  /** 获取当前版本 ID */
  versionId: number;

  /** 获取当前标题 */
  title: string;

  /** 获取当前内容 */
  content: string;

  /** 获取文档 ID */
  documentId: string | null;

  // ================================
  // 内容更新
  // ================================

  /** 更新内容（版本递增） */
  updateContent: (content: string) => number;

  /** 更新标题（版本递增） */
  updateTitle: (title: string) => number;

  /** 同时更新标题和内容 */
  update: (title: string, content: string) => number;

  // ================================
  // 文档生命周期
  // ================================

  /** 用新文档重置模型 */
  reset: (config: EditorModelConfig) => void;

  /** 设置文档 ID */
  setDocumentId: (id: string | null) => void;

  /** 检查模型是否为空 */
  isEmpty: () => boolean;

  // ================================
  // 保存状态
  // ================================

  /** 是否有未保存的更改 */
  hasUnsavedChanges: boolean;

  /** 获取最后保存的版本 ID */
  lastSavedVersionId: number | null;

  /** 标记当前版本为已保存 */
  markAsSaved: (versionId: number) => void;

  // ================================
  // 模型访问
  // ================================

  /** 直接访问 EditorModel 实例 */
  model: EditorModel;
}

// ================================
// Hook 实现
// ================================

/**
 * useEditorModel - 版本化内容管理的 React Hook（低层）
 *
 * 核心特性：
 * - 每次内容变更都进行版本追踪
 * - 拉取式内容访问用于保存操作
 * - 最小化 React 状态（模型管理自己的状态）
 * - 事件驱动更新
 *
 * 注意：此 hook 不包含生命周期管理。推荐使用 useManagedEditor
 * 以获得正确的实例管理和防止内存泄漏。
 *
 * 使用示例：
 * ```tsx
 * const {
 *   title,
 *   content,
 *   versionId,
 *   updateContent,
 *   updateTitle,
 *   getSnapshot,
 *   hasUnsavedChanges,
 *   markAsSaved,
 * } = useEditorModel({
 *   documentId: selectedDocId,
 *   initialTitle: '我的文档',
 *   initialContent: '<p>Hello</p>',
 *   onContentChange: (event) => {
 *     // 处理内容变更（如请求自动保存）
 *   },
 * });
 * ```
 */
export function useEditorModel(config: UseEditorModelConfig = {}): UseEditorModelReturn {
  // 创建模型 ref - 跨渲染持久化
  const modelRef = useRef<EditorModel | null>(null);

  // 首次渲染时初始化模型
  if (!modelRef.current) {
    modelRef.current = new EditorModel({
      documentId: config.documentId,
      initialTitle: config.initialTitle,
      initialContent: config.initialContent,
      initialVersionId: config.initialVersionId,
    });
  }

  // 获取模型的稳定引用
  const model = modelRef.current;

  // React 状态用于在内容变更时触发重新渲染
  // 我们只追踪版本 ID 以最小化状态更新
  const [currentVersionId, setCurrentVersionId] = useState(model.getVersionId());
  const [lastSavedVersionId, setLastSavedVersionId] = useState<number | null>(
    model.getLastSavedVersionId()
  );

  // 将回调保存在 refs 中以避免闭包过期
  const onContentChangeRef = useRef(config.onContentChange);
  const onSavedRef = useRef(config.onSaved);
  onContentChangeRef.current = config.onContentChange;
  onSavedRef.current = config.onSaved;

  // 订阅内容变更
  useEffect(() => {
    const unsubscribe = model.onContentChange((event) => {
      // 更新 React 状态以触发重新渲染
      setCurrentVersionId(event.newVersionId);

      // 调用外部回调
      onContentChangeRef.current?.(event);
    });

    return unsubscribe;
  }, [model]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      modelRef.current?.destroy();
    };
  }, []);

  // ================================
  // 内容访问
  // ================================

  const getVersionedContent = useCallback(() => {
    return model.getVersionedContent();
  }, [model]);

  const getSnapshot = useCallback(() => {
    return model.getSnapshot();
  }, [model]);

  // ================================
  // 内容更新
  // ================================

  const updateContent = useCallback(
    (content: string): number => {
      return model.updateContent(content);
    },
    [model]
  );

  const updateTitle = useCallback(
    (title: string): number => {
      return model.updateTitle(title);
    },
    [model]
  );

  const update = useCallback(
    (title: string, content: string): number => {
      return model.update(title, content);
    },
    [model]
  );

  // ================================
  // 文档生命周期
  // ================================

  const reset = useCallback(
    (resetConfig: EditorModelConfig) => {
      model.reset(resetConfig);
      setCurrentVersionId(model.getVersionId());
      setLastSavedVersionId(null);
    },
    [model]
  );

  const setDocumentId = useCallback(
    (id: string | null) => {
      model.setDocumentId(id);
    },
    [model]
  );

  const isEmpty = useCallback(() => {
    return model.isEmpty();
  }, [model]);

  // ================================
  // 保存状态
  // ================================

  const markAsSaved = useCallback(
    (versionId: number, contentHash?: string) => {
      const hash = contentHash ?? model.getContentHash();
      model.markAsSaved(versionId, hash);
      setLastSavedVersionId(versionId);
      onSavedRef.current?.(versionId);
    },
    [model]
  );

  // 计算值
  const hasUnsavedChanges = useMemo(() => {
    return model.hasUnsavedChanges();
  }, [model, currentVersionId, lastSavedVersionId]);

  // 当前值（从版本 ID 派生以确保新鲜度）
  const title = useMemo(() => model.getTitle(), [model, currentVersionId]);
  const content = useMemo(() => model.getContent(), [model, currentVersionId]);
  const documentId = useMemo(() => model.getDocumentId(), [model, currentVersionId]);

  return {
    // 内容访问
    getVersionedContent,
    getSnapshot,
    versionId: currentVersionId,
    title,
    content,
    documentId,

    // 内容更新
    updateContent,
    updateTitle,
    update,

    // 文档生命周期
    reset,
    setDocumentId,
    isEmpty,

    // 保存状态
    hasUnsavedChanges,
    lastSavedVersionId,
    markAsSaved,

    // 模型访问
    model,
  };
}

export default useEditorModel;
