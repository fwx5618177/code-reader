// ================================
// SaveEngine
// 拉取式版本感知保存引擎
// 协调内容拉取、策略调度和保存执行
// 支持 versionId + contentHash 双处理和增量保存
// ================================

import { ContentSnapshot } from '../editor-model';
import { createDiffEngine } from '@code-reader/diff-algorithm';
import {
  ISaveEngine,
  ISaveStrategy,
  ISaveExecutor,
  IContentProvider,
  SaveResult,
  SaveEngineState,
  SaveEngineEvent,
  SaveEngineEventListener,
  SaveEngineConfig,
  IncrementalSaveData,
  DiffOperation,
  initialSaveEngineState,
  createSuccessResult,
  createFailedResult,
} from './types';
import { DebouncedSaveStrategy, DEFAULT_DEBOUNCED_CONFIG } from './strategies';

/**
 * SaveEngine - 拉取式版本感知保存引擎
 *
 * 核心设计原则：
 *
 * 1. **拉取式**：保存时从提供者拉取内容
 *    - 无过期内容问题
 *    - 始终保存最新内容
 *    - 提供者控制保存内容
 *
 * 2. **双重版本感知**：使用 versionId + contentHash 追踪变更
 *    - versionId：快速排序比较
 *    - contentHash：精确检测内容变化
 *    - 支持冲突检测
 *
 * 3. **增量保存支持**：对于大文档自动使用增量保存
 *    - 自动判断是否适合增量保存
 *    - 回退到全量保存
 *
 * 4. **策略模式**：可插拔的保存调度
 *    - 默认：防抖策略用于自动保存
 *    - 立即：用于手动保存（Cmd+S）
 *    - 自定义：实现 ISaveStrategy
 *
 * 5. **事件驱动**：通知监听器保存事件
 *    - UI 可显示保存状态
 *    - 错误处理
 *    - 调试
 *
 * 使用示例：
 * ```typescript
 * const engine = new SaveEngine({
 *   contentProvider: editorModel,
 *   executor: {
 *     save: async (snapshot) => {
 *       await database.save(snapshot);
 *       return createSuccessResult(snapshot.versionId, snapshot.contentHash);
 *     },
 *   },
 * });
 *
 * // 请求自动保存（使用策略）
 * engine.requestSave();
 *
 * // 手动保存（绕过策略）
 * await engine.saveNow();
 *
 * // 清理
 * engine.destroy();
 * ```
 */
export class SaveEngine implements ISaveEngine {
  private readonly contentProvider: IContentProvider;
  private readonly executor: ISaveExecutor;
  private strategy: ISaveStrategy;
  private autoSaveEnabled: boolean;
  private preferIncremental: boolean;
  private readonly incrementalThreshold: number;
  private readonly listeners: Set<SaveEngineEventListener>;
  private state: SaveEngineState;
  private destroyed: boolean;

  // 用于增量保存的上次保存内容缓存
  private lastSavedContent: string | null = null;
  private lastSavedTitle: string | null = null;

  // 并发控制
  private isSavingInternal: boolean = false;
  private pendingSaveRequest: boolean = false;

  constructor(config: SaveEngineConfig) {
    this.contentProvider = config.contentProvider;
    this.executor = config.executor;
    this.strategy = config.strategy ?? new DebouncedSaveStrategy(DEFAULT_DEBOUNCED_CONFIG);
    this.autoSaveEnabled = config.autoSaveEnabled ?? true;
    this.preferIncremental = config.preferIncremental ?? true;
    this.incrementalThreshold = config.incrementalThreshold ?? 1024; // 1KB
    this.listeners = new Set();
    this.state = { ...initialSaveEngineState };
    this.destroyed = false;

    // 如果提供了外部事件监听器则添加
    if (config.onEvent) {
      this.addEventListener(config.onEvent);
    }
  }

  // ================================
  // 保存操作
  // ================================

  requestSave(): void {
    if (this.destroyed) {
      this.log('无法请求保存 - 引擎已销毁');
      return;
    }

    if (!this.autoSaveEnabled) {
      this.log('自动保存已禁用，忽略请求');
      return;
    }

    // 检查是否有需要保存的更改
    if (!this.contentProvider.hasUnsavedChanges()) {
      this.log('没有未保存的更改，跳过');
      this.emitEvent({ type: 'SAVE_SKIPPED', reason: '没有未保存的更改' });
      return;
    }

    // 通过策略调度保存
    this.updateState({ isScheduled: true });
    this.emitEvent({ type: 'SAVE_SCHEDULED' });

    this.strategy.scheduleSave(() => this.performSave());
  }

  async saveNow(): Promise<SaveResult> {
    if (this.destroyed) {
      return createFailedResult('引擎已销毁');
    }

    // 取消任何待处理的调度保存
    this.strategy.cancel();
    this.updateState({ isScheduled: false });

    // 立即执行保存
    return this.performSave();
  }

  cancelPendingSave(): void {
    if (this.destroyed) return;

    this.strategy.cancel();
    this.pendingSaveRequest = false;
    this.updateState({ isScheduled: false });
    this.emitEvent({ type: 'SAVE_CANCELLED' });
  }

  // ================================
  // 状态访问
  // ================================

  getState(): SaveEngineState {
    return { ...this.state };
  }

  getLastSavedVersionId(): number | null {
    return this.state.lastSavedVersionId;
  }

  getLastSavedContentHash(): string | null {
    return this.state.lastSavedContentHash;
  }

  hasUnsavedChanges(): boolean {
    return this.contentProvider.hasUnsavedChanges();
  }

  isSaving(): boolean {
    return this.state.isSaving;
  }

  // ================================
  // 配置
  // ================================

  setStrategy(strategy: ISaveStrategy): void {
    if (this.destroyed) return;

    // 清理旧策略
    this.strategy.destroy();

    // 设置新策略
    this.strategy = strategy;
    this.log('策略已更改为:', strategy.name);
  }

  setAutoSaveEnabled(enabled: boolean): void {
    this.autoSaveEnabled = enabled;

    if (!enabled) {
      // 取消任何待处理的自动保存
      this.cancelPendingSave();
    }

    this.log('自动保存', enabled ? '已启用' : '已禁用');
  }

  isAutoSaveEnabled(): boolean {
    return this.autoSaveEnabled;
  }

  setPreferIncremental(prefer: boolean): void {
    this.preferIncremental = prefer;
    this.log('增量保存优先', prefer ? '已启用' : '已禁用');
  }

  // ================================
  // 事件处理
  // ================================

  addEventListener(listener: SaveEngineEventListener): () => void {
    if (this.destroyed) {
      return () => {};
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ================================
  // 生命周期
  // ================================

  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.strategy.destroy();
    this.listeners.clear();
    this.lastSavedContent = null;
    this.lastSavedTitle = null;
    this.log('引擎已销毁');
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 执行实际的保存操作
   * 这是核心保存逻辑，拉取内容并执行保存
   */
  private async performSave(): Promise<SaveResult> {
    // 防止并发保存
    if (this.isSavingInternal) {
      this.pendingSaveRequest = true;
      this.log('保存正在进行中，将请求加入队列');
      return createFailedResult('保存正在进行中');
    }

    // 拉取当前内容快照
    const snapshot = this.contentProvider.getSnapshot();

    if (!snapshot) {
      this.log('没有要保存的内容（未加载文档）');
      return createFailedResult('未加载文档');
    }

    // 使用 contentHash 检查是否有实际更改（比版本号更准确）
    if (
      this.state.lastSavedContentHash !== null &&
      snapshot.contentHash === this.state.lastSavedContentHash
    ) {
      this.log('内容哈希相同，无实际变更，跳过');
      this.emitEvent({ type: 'SAVE_SKIPPED', reason: '内容哈希相同，无实际变更' });
      return createSuccessResult(snapshot.versionId, snapshot.contentHash, snapshot.documentId);
    }

    // 判断是否可以使用增量保存
    const canUseIncremental = this.canPerformIncrementalSave(snapshot);
    const isIncremental = canUseIncremental && this.preferIncremental;

    // 标记为正在保存
    this.isSavingInternal = true;
    this.updateState({ isSaving: true, isScheduled: false, error: null });
    this.emitEvent({
      type: 'SAVE_STARTED',
      versionId: snapshot.versionId,
      contentHash: snapshot.contentHash,
      isIncremental,
    });

    try {
      let result: SaveResult;

      if (isIncremental && this.executor.saveIncremental) {
        // 执行增量保存
        result = await this.performIncrementalSave(snapshot);
      } else {
        // 执行全量保存
        result = await this.executor.save(snapshot);
      }

      if (result.success) {
        // 更新状态为保存成功
        this.updateState({
          isSaving: false,
          lastSavedVersionId: result.savedVersionId,
          lastSavedContentHash: result.savedContentHash,
          lastSavedAt: result.savedAt,
          lastSaveWasIncremental: result.isIncremental ?? false,
          error: null,
        });

        // 缓存保存的内容用于下次增量保存
        this.lastSavedContent = snapshot.content;
        this.lastSavedTitle = snapshot.title;

        this.emitEvent({ type: 'SAVE_SUCCESS', result });
        this.log(
          '保存成功，版本:',
          result.savedVersionId,
          '哈希:',
          result.savedContentHash.substring(0, 8)
        );
      } else {
        // 处理保存失败
        this.updateState({
          isSaving: false,
          error: result.error ?? '未知错误',
        });
        this.emitEvent({ type: 'SAVE_FAILED', result });
        this.log('保存失败:', result.error);
      }

      return result;
    } catch (error) {
      // 处理意外错误
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      const result = createFailedResult(errorMessage, snapshot.versionId, snapshot.contentHash);

      this.updateState({
        isSaving: false,
        error: errorMessage,
      });
      this.emitEvent({ type: 'SAVE_FAILED', result });
      this.log('保存错误:', error);

      return result;
    } finally {
      this.isSavingInternal = false;

      // 处理任何排队的保存请求
      if (this.pendingSaveRequest) {
        this.pendingSaveRequest = false;
        // 使用微任务避免快速保存时的栈溢出
        queueMicrotask(() => {
          if (this.contentProvider.hasUnsavedChanges()) {
            this.requestSave();
          }
        });
      }
    }
  }

  /**
   * 判断是否可以执行增量保存
   */
  private canPerformIncrementalSave(snapshot: ContentSnapshot): boolean {
    // 检查执行器是否支持增量保存
    if (!this.executor.saveIncremental || !this.executor.supportsIncremental?.()) {
      return false;
    }

    // 检查是否有上次保存的内容
    if (this.lastSavedContent === null || this.lastSavedTitle === null) {
      return false;
    }

    // 检查内容提供者是否支持获取父版本信息
    if (
      this.contentProvider.canUseIncrementalSave &&
      !this.contentProvider.canUseIncrementalSave()
    ) {
      return false;
    }

    // 检查内容大小是否超过阈值
    const combinedContent = `${snapshot.title}\n---\n${snapshot.content}`;
    if (combinedContent.length < this.incrementalThreshold) {
      // 内容太小，使用全量保存更高效
      return false;
    }

    return true;
  }

  /**
   * 执行增量保存
   */
  private async performIncrementalSave(snapshot: ContentSnapshot): Promise<SaveResult> {
    if (!this.executor.saveIncremental) {
      // 回退到全量保存
      return this.executor.save(snapshot);
    }

    // 计算差分
    const oldContent = `${this.lastSavedTitle}\n---\n${this.lastSavedContent}`;
    const newContent = `${snapshot.title}\n---\n${snapshot.content}`;
    const diffEngine = createDiffEngine();
    const diffResult = diffEngine.diff(oldContent, newContent);
    const stats = diffEngine.getStats(diffResult.diffs);

    // 检查增量保存是否值得（变化率超过50%则不划算）
    if (stats.changeRatio > 0.5) {
      this.log('增量保存不划算，回退到全量保存');
      return this.executor.save(snapshot);
    }

    // 获取父版本信息
    const parentVersion = this.contentProvider.getParentVersion?.();
    const baseVersionId = parentVersion?.versionId ?? this.state.lastSavedVersionId ?? 0;
    const baseContentHash = parentVersion?.contentHash ?? this.state.lastSavedContentHash ?? '';

    // 将 TextDiff 转换为操作格式
    const operations: DiffOperation[] = diffResult.diffs.map(([op, text]) => ({
      type: (op === 1 ? 'insert' : op === -1 ? 'delete' : 'retain') as
        | 'insert'
        | 'delete'
        | 'retain',
      value: text,
    }));

    const incrementalData: IncrementalSaveData = {
      documentId: snapshot.documentId,
      baseVersionId,
      baseContentHash,
      targetVersionId: snapshot.versionId,
      targetContentHash: snapshot.contentHash,
      operations,
      timestamp: Date.now(),
    };

    const deltaSize = stats.insertions + stats.deletions;
    this.log('执行增量保存，delta 大小:', deltaSize, '变化率:', stats.changeRatio.toFixed(2));

    try {
      const result = await this.executor.saveIncremental(incrementalData);

      // 标记为增量保存
      if (result.success && result.isIncremental === undefined) {
        return {
          ...result,
          isIncremental: true,
        };
      }

      return result;
    } catch (error) {
      // 增量保存失败，回退到全量保存
      this.log('增量保存失败，回退到全量保存:', error);
      return this.executor.save(snapshot);
    }
  }

  /**
   * 更新内部状态并发出状态变更事件
   */
  private updateState(updates: Partial<SaveEngineState>): void {
    this.state = { ...this.state, ...updates };
    this.emitEvent({ type: 'STATE_CHANGED', state: this.getState() });
  }

  /**
   * 向所有监听器发出事件
   */
  private emitEvent(event: SaveEngineEvent): void {
    if (this.destroyed) return;

    // 使用 Array.from 以便在监听器修改期间安全迭代
    Array.from(this.listeners).forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('[SaveEngine] 监听器错误:', error);
      }
    });
  }

  /**
   * 输出调试日志
   */
  private log(...args: unknown[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.log('[SaveEngine]', ...args);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建新的 SaveEngine 实例
 */
export function createSaveEngine(config: SaveEngineConfig): SaveEngine {
  return new SaveEngine(config);
}

/**
 * 创建带默认防抖策略的 SaveEngine
 */
export function createAutoSaveEngine(
  contentProvider: IContentProvider,
  executor: ISaveExecutor,
  debounceMs: number = 1500,
  maxIntervalMs: number = 30000
): SaveEngine {
  return new SaveEngine({
    contentProvider,
    executor,
    strategy: new DebouncedSaveStrategy({ debounceMs, maxIntervalMs }),
    autoSaveEnabled: true,
    preferIncremental: true,
  });
}
