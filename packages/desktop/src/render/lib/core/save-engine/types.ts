// ================================
// SaveEngine 类型定义
// 拉取式保存引擎，用于版本感知的自动保存
// 设计灵感来自 VS Code 的保存模型
// 支持 versionId + contentHash 双处理和增量保存
// ================================

import { VersionedContent, ContentSnapshot } from '../editor-model';
// 从统一的 diff 库导入类型
import type { DiffOperation, IncrementalSaveData } from '@code-reader/diff-algorithm';

// 重新导出以保持向后兼容
export type { DiffOperation, IncrementalSaveData };

// ================================
// 保存结果
// ================================

/**
 * 保存操作的结果
 */
export interface SaveResult {
  /** 保存是否成功 */
  readonly success: boolean;
  /** 已保存的版本 ID */
  readonly savedVersionId: number;
  /** 已保存的内容哈希 */
  readonly savedContentHash: string;
  /** 保存时间戳 */
  readonly savedAt: Date;
  /** 保存失败时的错误信息 */
  readonly error?: string;
  /** 已保存的文档 ID */
  readonly documentId?: string;
  /** 是否使用了增量保存 */
  readonly isIncremental?: boolean;
}

/**
 * 创建成功的保存结果
 */
export function createSuccessResult(
  savedVersionId: number,
  savedContentHash: string,
  documentId?: string,
  isIncremental?: boolean
): SaveResult {
  return {
    success: true,
    savedVersionId,
    savedContentHash,
    savedAt: new Date(),
    documentId,
    isIncremental,
  };
}

/**
 * 创建失败的保存结果
 */
export function createFailedResult(
  error: string,
  versionId: number = 0,
  contentHash: string = ''
): SaveResult {
  return {
    success: false,
    savedVersionId: versionId,
    savedContentHash: contentHash,
    savedAt: new Date(),
    error,
  };
}

// ================================
// 保存负载
// ================================

/**
 * 保存负载（全量或增量）
 */
export interface SavePayload {
  /** 保存类型 */
  readonly type: 'full' | 'incremental';
  /** 文档 ID */
  readonly documentId: string;
  /** 目标版本 ID */
  readonly versionId: number;
  /** 目标内容哈希 */
  readonly contentHash: string;
  /** 全量快照（type === 'full' 时存在） */
  readonly snapshot?: ContentSnapshot;
  /** 增量数据（type === 'incremental' 时存在） */
  readonly incremental?: IncrementalSaveData;
}

// ================================
// 保存策略
// ================================

/**
 * 保存策略接口
 * 策略定义何时保存，而不是如何保存
 */
export interface ISaveStrategy {
  /** 策略名称，用于识别 */
  readonly name: string;

  /**
   * 调度保存操作
   * 策略决定何时实际调用 performSave
   *
   * @param performSave 准备保存时调用的函数
   */
  scheduleSave(performSave: () => Promise<SaveResult>): void;

  /**
   * 取消任何已调度的保存
   */
  cancel(): void;

  /**
   * 检查是否有已调度的保存
   */
  isScheduled(): boolean;

  /**
   * 强制立即执行任何已调度的保存
   */
  flush(): Promise<SaveResult | null>;

  /**
   * 清理资源
   */
  destroy(): void;
}

// ================================
// 内容提供者
// ================================

/**
 * 内容提供者接口
 * 提供用于保存的内容（拉取式模型）
 */
export interface IContentProvider {
  /**
   * 获取当前内容快照用于保存
   * 如果没有加载文档则返回 null
   */
  getSnapshot(): ContentSnapshot | null;

  /**
   * 仅获取版本化内容（不含文档 ID）
   */
  getVersionedContent(): VersionedContent;

  /**
   * 获取当前版本 ID
   */
  getVersionId(): number;

  /**
   * 获取当前内容哈希
   */
  getContentHash(): string;

  /**
   * 检查是否有未保存的更改
   */
  hasUnsavedChanges(): boolean;

  /**
   * 检查是否可以使用增量保存
   */
  canUseIncrementalSave?(): boolean;

  /**
   * 获取父版本信息（用于增量保存）
   */
  getParentVersion?(): { versionId: number; contentHash: string } | null;
}

// ================================
// 保存执行器
// ================================

/**
 * 保存执行器接口
 * 处理实际的持久化逻辑
 */
export interface ISaveExecutor {
  /**
   * 执行保存操作（全量）
   *
   * @param snapshot 要保存的内容快照
   * @returns 保存结果
   */
  save(snapshot: ContentSnapshot): Promise<SaveResult>;

  /**
   * 执行增量保存操作（可选）
   * 如果不支持增量保存，可以不实现此方法
   *
   * @param payload 保存负载
   * @returns 保存结果
   */
  saveIncremental?(payload: IncrementalSaveData): Promise<SaveResult>;

  /**
   * 检查是否支持增量保存
   */
  supportsIncremental?(): boolean;
}

// ================================
// 保存引擎
// ================================

/**
 * 保存引擎状态
 */
export interface SaveEngineState {
  /** 是否正在保存 */
  readonly isSaving: boolean;
  /** 是否已调度保存 */
  readonly isScheduled: boolean;
  /** 最后保存的版本 ID */
  readonly lastSavedVersionId: number | null;
  /** 最后保存的内容哈希 */
  readonly lastSavedContentHash: string | null;
  /** 最后保存时间戳 */
  readonly lastSavedAt: Date | null;
  /** 当前错误（如果有） */
  readonly error: string | null;
  /** 最后一次保存是否为增量保存 */
  readonly lastSaveWasIncremental: boolean;
}

/**
 * 保存引擎事件类型
 */
export type SaveEngineEvent =
  | { type: 'SAVE_SCHEDULED' }
  | { type: 'SAVE_STARTED'; versionId: number; contentHash: string; isIncremental: boolean }
  | { type: 'SAVE_SUCCESS'; result: SaveResult }
  | { type: 'SAVE_FAILED'; result: SaveResult }
  | { type: 'SAVE_CANCELLED' }
  | { type: 'SAVE_SKIPPED'; reason: string }
  | { type: 'STATE_CHANGED'; state: SaveEngineState };

/**
 * 保存引擎事件监听器
 */
export type SaveEngineEventListener = (event: SaveEngineEvent) => void;

/**
 * 保存引擎配置
 */
export interface SaveEngineConfig {
  /** 内容提供者（拉取式） */
  contentProvider: IContentProvider;
  /** 保存执行器 */
  executor: ISaveExecutor;
  /** 保存策略（可选，默认为防抖策略） */
  strategy?: ISaveStrategy;
  /** 是否在内容变更时自动保存 */
  autoSaveEnabled?: boolean;
  /** 是否优先使用增量保存 */
  preferIncremental?: boolean;
  /** 增量保存阈值（超过此大小才考虑增量） */
  incrementalThreshold?: number;
  /** 事件监听器 */
  onEvent?: SaveEngineEventListener;
}

/**
 * 保存引擎接口
 * 协调内容拉取、策略调度和保存执行
 */
export interface ISaveEngine {
  // ================================
  // 保存操作
  // ================================

  /**
   * 请求保存（将根据策略调度）
   */
  requestSave(): void;

  /**
   * 立即保存（绕过策略）
   */
  saveNow(): Promise<SaveResult>;

  /**
   * 取消任何待处理的保存
   */
  cancelPendingSave(): void;

  // ================================
  // 状态访问
  // ================================

  /**
   * 获取当前状态
   */
  getState(): SaveEngineState;

  /**
   * 获取最后保存的版本 ID
   */
  getLastSavedVersionId(): number | null;

  /**
   * 获取最后保存的内容哈希
   */
  getLastSavedContentHash(): string | null;

  /**
   * 检查是否有未保存的更改
   */
  hasUnsavedChanges(): boolean;

  /**
   * 检查是否正在保存
   */
  isSaving(): boolean;

  // ================================
  // 配置
  // ================================

  /**
   * 设置保存策略
   */
  setStrategy(strategy: ISaveStrategy): void;

  /**
   * 启用/禁用自动保存
   */
  setAutoSaveEnabled(enabled: boolean): void;

  /**
   * 检查自动保存是否启用
   */
  isAutoSaveEnabled(): boolean;

  /**
   * 设置是否优先使用增量保存
   */
  setPreferIncremental(prefer: boolean): void;

  // ================================
  // 事件处理
  // ================================

  /**
   * 添加事件监听器
   * @returns 取消订阅函数
   */
  addEventListener(listener: SaveEngineEventListener): () => void;

  // ================================
  // 生命周期
  // ================================

  /**
   * 销毁引擎并清理资源
   */
  destroy(): void;
}

// ================================
// 初始状态
// ================================

/**
 * 保存引擎初始状态
 */
export const initialSaveEngineState: SaveEngineState = {
  isSaving: false,
  isScheduled: false,
  lastSavedVersionId: null,
  lastSavedContentHash: null,
  lastSavedAt: null,
  error: null,
  lastSaveWasIncremental: false,
};
