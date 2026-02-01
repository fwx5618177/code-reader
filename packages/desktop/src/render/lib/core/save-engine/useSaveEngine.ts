// ================================
// useSaveEngine Hook（低层）
// SaveEngine 的 React 集成，提供版本感知的拉取式自动保存
// 注意：推荐使用 useManagedEditor（高层）以获得更好的生命周期管理
// ================================

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import {
  SaveEngine,
  SaveEngineState,
  SaveEngineEvent,
  SaveResult,
  ISaveStrategy,
  IContentProvider,
  ISaveExecutor,
  initialSaveEngineState,
} from './index';
import { DebouncedSaveStrategy, DEFAULT_DEBOUNCED_CONFIG } from './strategies';

// ================================
// Hook 配置
// ================================

export interface UseSaveEngineConfig {
  /** 内容提供者（必需）- 提供用于保存的内容 */
  contentProvider: IContentProvider;

  /** 保存执行器（必需）- 执行实际保存 */
  executor: ISaveExecutor;

  /** 自定义保存策略（可选，默认为防抖策略） */
  strategy?: ISaveStrategy;

  /** 是否启用自动保存（默认: true） */
  autoSaveEnabled?: boolean;

  /** 防抖延迟（毫秒，默认: 1500） */
  debounceMs?: number;

  /** 保存最大间隔（毫秒，默认: 30000） */
  maxIntervalMs?: number;

  /** 保存事件发生时的回调 */
  onEvent?: (event: SaveEngineEvent) => void;

  /** 保存成功时的回调 */
  onSaveSuccess?: (result: SaveResult) => void;

  /** 保存失败时的回调 */
  onSaveError?: (result: SaveResult) => void;
}

// ================================
// Hook 返回类型
// ================================

export interface UseSaveEngineReturn {
  // ================================
  // 保存操作
  // ================================

  /** 请求保存（将根据策略调度） */
  requestSave: () => void;

  /** 立即保存（绕过策略） */
  saveNow: () => Promise<SaveResult>;

  /** 取消任何待处理的保存 */
  cancelPendingSave: () => void;

  // ================================
  // 状态
  // ================================

  /** 当前保存引擎状态 */
  state: SaveEngineState;

  /** 是否正在保存 */
  isSaving: boolean;

  /** 是否已调度保存 */
  isScheduled: boolean;

  /** 是否有未保存的更改 */
  hasUnsavedChanges: boolean;

  /** 最后保存的版本 ID */
  lastSavedVersionId: number | null;

  /** 最后保存时间戳 */
  lastSavedAt: Date | null;

  /** 当前错误（如果有） */
  error: string | null;

  // ================================
  // 配置
  // ================================

  /** 启用自动保存 */
  enableAutoSave: () => void;

  /** 禁用自动保存 */
  disableAutoSave: () => void;

  /** 检查自动保存是否启用 */
  isAutoSaveEnabled: boolean;

  /** 设置新的保存策略 */
  setStrategy: (strategy: ISaveStrategy) => void;

  // ================================
  // 引擎访问
  // ================================

  /** 直接访问 SaveEngine 实例 */
  engine: SaveEngine;
}

// ================================
// Hook 实现
// ================================

/**
 * useSaveEngine - 版本感知拉取式自动保存的 React Hook（低层）
 *
 * 核心特性：
 * - 拉取式：保存时从提供者拉取内容
 * - 版本感知：使用版本 ID 追踪变更
 * - 策略模式：可插拔的保存调度（防抖、立即等）
 * - 事件驱动：保存成功/失败的回调
 *
 * 注意：此 hook 不包含实例生命周期管理。推荐使用 useManagedEditor
 * 以获得正确的实例管理和防止内存泄漏。
 *
 * 使用示例：
 * ```tsx
 * const {
 *   requestSave,
 *   saveNow,
 *   isSaving,
 *   hasUnsavedChanges,
 *   lastSavedAt,
 * } = useSaveEngine({
 *   contentProvider: editorModel,
 *   executor: {
 *     save: async (snapshot) => {
 *       await database.save(snapshot);
 *       return createSuccessResult(snapshot.versionId, snapshot.documentId);
 *     },
 *   },
 *   onSaveSuccess: (result) => {
 *     console.log('已保存版本:', result.savedVersionId);
 *   },
 * });
 *
 * // 内容变更时请求自动保存
 * const handleContentChange = () => {
 *   requestSave();
 * };
 *
 * // 使用 Cmd+S 手动保存
 * const handleManualSave = async () => {
 *   await saveNow();
 * };
 * ```
 */
export function useSaveEngine(config: UseSaveEngineConfig): UseSaveEngineReturn {
  // 创建引擎 ref - 跨渲染持久化
  const engineRef = useRef<SaveEngine | null>(null);

  // React 状态用于 UI 更新
  const [state, setState] = useState<SaveEngineState>(initialSaveEngineState);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(config.autoSaveEnabled ?? true);

  // 将回调保存在 refs 中以避免闭包过期
  const onEventRef = useRef(config.onEvent);
  const onSaveSuccessRef = useRef(config.onSaveSuccess);
  const onSaveErrorRef = useRef(config.onSaveError);

  // 配置变更时更新 refs
  onEventRef.current = config.onEvent;
  onSaveSuccessRef.current = config.onSaveSuccess;
  onSaveErrorRef.current = config.onSaveError;

  // 首次渲染或关键依赖变更时初始化引擎
  if (!engineRef.current) {
    const strategy =
      config.strategy ??
      new DebouncedSaveStrategy({
        ...DEFAULT_DEBOUNCED_CONFIG,
        debounceMs: config.debounceMs ?? DEFAULT_DEBOUNCED_CONFIG.debounceMs,
        maxIntervalMs: config.maxIntervalMs ?? DEFAULT_DEBOUNCED_CONFIG.maxIntervalMs,
      });

    engineRef.current = new SaveEngine({
      contentProvider: config.contentProvider,
      executor: config.executor,
      strategy,
      autoSaveEnabled: config.autoSaveEnabled ?? true,
      onEvent: (event) => {
        // 更新 React 状态
        if (event.type === 'STATE_CHANGED') {
          setState(event.state);
        }

        // 处理成功/错误回调
        if (event.type === 'SAVE_SUCCESS') {
          onSaveSuccessRef.current?.(event.result);
        } else if (event.type === 'SAVE_FAILED') {
          onSaveErrorRef.current?.(event.result);
        }

        // 转发事件到外部监听器
        onEventRef.current?.(event);
      },
    });
  }

  // 获取引擎的稳定引用
  const engine = engineRef.current;

  // 卸载时清理
  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
    };
  }, []);

  // ================================
  // 保存操作
  // ================================

  const requestSave = useCallback(() => {
    engine.requestSave();
  }, [engine]);

  const saveNow = useCallback(async (): Promise<SaveResult> => {
    return engine.saveNow();
  }, [engine]);

  const cancelPendingSave = useCallback(() => {
    engine.cancelPendingSave();
  }, [engine]);

  // ================================
  // 配置
  // ================================

  const enableAutoSave = useCallback(() => {
    engine.setAutoSaveEnabled(true);
    setAutoSaveEnabled(true);
  }, [engine]);

  const disableAutoSave = useCallback(() => {
    engine.setAutoSaveEnabled(false);
    setAutoSaveEnabled(false);
  }, [engine]);

  const setStrategy = useCallback(
    (strategy: ISaveStrategy) => {
      engine.setStrategy(strategy);
    },
    [engine]
  );

  // ================================
  // 派生状态
  // ================================

  const isSaving = useMemo(() => state.isSaving, [state.isSaving]);
  const isScheduled = useMemo(() => state.isScheduled, [state.isScheduled]);
  const hasUnsavedChanges = useMemo(
    () => config.contentProvider.hasUnsavedChanges(),
    [config.contentProvider, state.lastSavedVersionId]
  );
  const lastSavedVersionId = useMemo(() => state.lastSavedVersionId, [state.lastSavedVersionId]);
  const lastSavedAt = useMemo(() => state.lastSavedAt, [state.lastSavedAt]);
  const error = useMemo(() => state.error, [state.error]);

  return {
    // 保存操作
    requestSave,
    saveNow,
    cancelPendingSave,

    // 状态
    state,
    isSaving,
    isScheduled,
    hasUnsavedChanges,
    lastSavedVersionId,
    lastSavedAt,
    error,

    // 配置
    enableAutoSave,
    disableAutoSave,
    isAutoSaveEnabled: autoSaveEnabled,
    setStrategy,

    // 引擎访问
    engine,
  };
}

export default useSaveEngine;
