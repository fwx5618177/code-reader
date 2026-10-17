// ================================
// HistoryManager
// 生产级撤销/重做管理器
// 基于事务的状态追踪，支持选区状态和操作合并
// 设计参考：ProseMirror、CodeMirror、Slate.js
// ================================

import {
  DiffEngine,
  createDiffEngine,
  TextDiff,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from '@code-reader/diff-algorithm';

// 类型别名，保持兼容
type Diff = TextDiff;

// ================================
// 类型定义
// ================================

/**
 * 选区状态
 */
export interface SelectionState {
  /** 锚点位置（选区起始） */
  readonly anchor: number;
  /** 焦点位置（选区结束） */
  readonly focus: number;
  /** 是否为反向选区 */
  readonly isBackward: boolean;
}

/**
 * 编辑器状态快照
 */
export interface EditorState {
  /** 文档内容 */
  readonly content: string;
  /** 选区状态 */
  readonly selection: SelectionState | null;
  /** 时间戳 */
  readonly timestamp: number;
  /** 元数据 */
  readonly metadata?: Record<string, unknown>;
}

/**
 * 历史条目
 */
export interface HistoryEntry {
  /** 唯一标识符 */
  readonly id: string;
  /** 前向差分（state1 -> state2）*/
  readonly forwardDiff: ReadonlyArray<Diff>;
  /** 反向差分（state2 -> state1）*/
  readonly reverseDiff: ReadonlyArray<Diff>;
  /** 操作前的状态 */
  readonly beforeState: EditorState;
  /** 操作后的状态 */
  readonly afterState: EditorState;
  /** 操作类型标签 */
  readonly label?: string;
  /** 是否可与下一个操作合并 */
  readonly canMerge: boolean;
  /** 合并组 ID（相同 ID 的操作可以合并） */
  readonly mergeGroup?: string;
}

/**
 * 事务
 */
export interface Transaction {
  /** 事务 ID */
  readonly id: string;
  /** 事务标签 */
  readonly label?: string;
  /** 起始状态 */
  readonly startState: EditorState;
  /** 当前状态 */
  currentState: EditorState;
  /** 是否已提交 */
  committed: boolean;
  /** 是否已取消 */
  cancelled: boolean;
  /** 创建时间 */
  readonly createdAt: number;
}

/**
 * 历史管理器配置
 */
export interface HistoryManagerConfig {
  /** 最大历史深度（默认: 100） */
  maxDepth?: number;
  /** 是否启用合并（默认: true） */
  enableMerging?: boolean;
  /** 合并时间窗口（毫秒，默认: 500） */
  mergeWindowMs?: number;
  /** 合并字符阈值（默认: 20）- 超过此字符数不合并 */
  mergeCharThreshold?: number;
  /** 是否保存选区状态（默认: true） */
  preserveSelection?: boolean;
  /** 新操作时是否清空重做栈（默认: true） */
  clearRedoOnChange?: boolean;
  /** 是否启用调试日志（默认: false） */
  debug?: boolean;
}

/**
 * 历史管理器事件类型
 */
export type HistoryEventType =
  | 'PUSH'
  | 'UNDO'
  | 'REDO'
  | 'CLEAR'
  | 'TRANSACTION_START'
  | 'TRANSACTION_COMMIT'
  | 'TRANSACTION_CANCEL'
  | 'STACK_CHANGED';

/**
 * 历史管理器事件
 */
export interface HistoryEvent {
  readonly type: HistoryEventType;
  readonly undoCount: number;
  readonly redoCount: number;
  readonly entry?: HistoryEntry;
  readonly timestamp: number;
}

/**
 * 历史管理器事件监听器
 */
export type HistoryEventListener = (event: HistoryEvent) => void;

/**
 * 撤销/重做操作结果
 */
export interface HistoryOperationResult {
  /** 是否成功 */
  readonly success: boolean;
  /** 操作后的状态 */
  readonly state: EditorState | null;
  /** 错误信息 */
  readonly error?: string;
  /** 应用的历史条目 */
  readonly entry?: HistoryEntry;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<HistoryManagerConfig> = {
  maxDepth: 100,
  enableMerging: true,
  mergeWindowMs: 500,
  mergeCharThreshold: 20,
  preserveSelection: true,
  clearRedoOnChange: true,
  debug: false,
};

// ================================
// 工具函数
// ================================

/**
 * 生成唯一 ID
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * 创建选区状态
 */
export function createSelection(anchor: number, focus?: number): SelectionState {
  const f = focus ?? anchor;
  return {
    anchor,
    focus: f,
    isBackward: f < anchor,
  };
}

/**
 * 创建编辑器状态
 */
export function createEditorState(
  content: string,
  selection?: SelectionState | null,
  metadata?: Record<string, unknown>
): EditorState {
  return {
    content,
    selection: selection ?? null,
    timestamp: Date.now(),
    metadata,
  };
}

/**
 * 计算差分字符数
 */
function diffCharCount(diffs: ReadonlyArray<Diff>): number {
  let count = 0;
  for (const d of diffs) {
    if (d[0] !== DIFF_EQUAL) {
      count += d[1].length;
    }
  }
  return count;
}

/**
 * 判断两个操作是否为相同类型
 */
function isSameOperationType(diffs1: ReadonlyArray<Diff>, diffs2: ReadonlyArray<Diff>): boolean {
  const hasInsert1 = diffs1.some((d) => d[0] === DIFF_INSERT);
  const hasDelete1 = diffs1.some((d) => d[0] === DIFF_DELETE);
  const hasInsert2 = diffs2.some((d) => d[0] === DIFF_INSERT);
  const hasDelete2 = diffs2.some((d) => d[0] === DIFF_DELETE);

  // 纯插入操作
  if (hasInsert1 && !hasDelete1 && hasInsert2 && !hasDelete2) {
    return true;
  }
  // 纯删除操作
  if (!hasInsert1 && hasDelete1 && !hasInsert2 && hasDelete2) {
    return true;
  }

  return false;
}

/**
 * 判断是否应该在此处中断合并（语义边界）
 */
function isSemanticBreakpoint(text: string): boolean {
  // 空白字符（空格、换行）后通常是好的中断点
  const lastChar = text.charAt(text.length - 1);
  return /[\s\.\,\;\:\!\?\n\r]/.test(lastChar);
}

// ================================
// HistoryManager 类
// ================================

/**
 * HistoryManager - 生产级撤销/重做管理器
 *
 * 核心特性：
 * 1. **基于差分**：使用 diff-match-patch 算法计算差分
 * 2. **事务支持**：支持 beginTransaction/commit/cancel 模式
 * 3. **选区状态**：保存和恢复光标/选区位置
 * 4. **智能合并**：基于时间窗口和操作类型合并连续操作
 * 5. **CRDT 兼容**：预留协同编辑接口
 *
 * 使用示例：
 * ```typescript
 * const history = new HistoryManager();
 *
 * // 推送状态
 * history.push(createEditorState('Hello'), createEditorState('Hello World'));
 *
 * // 撤销
 * const undoResult = history.undo(currentState);
 * if (undoResult.success) {
 *   applyState(undoResult.state);
 * }
 *
 * // 事务模式
 * const tx = history.beginTransaction(currentState);
 * // ... 多次编辑 ...
 * history.commit(tx, finalState);
 * ```
 */
export class HistoryManager {
  private readonly config: Required<HistoryManagerConfig>;
  private readonly diffEngine: DiffEngine;
  private undoStack: HistoryEntry[];
  private redoStack: HistoryEntry[];
  private readonly listeners: Set<HistoryEventListener>;
  private activeTransaction: Transaction | null;
  private lastPushTime: number;
  private destroyed: boolean;

  constructor(config: Partial<HistoryManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.diffEngine = createDiffEngine({ semanticCleanup: true, efficiencyCleanup: true });
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.activeTransaction = null;
    this.lastPushTime = 0;
    this.destroyed = false;
  }

  // ================================
  // 核心 API
  // ================================

  /**
   * 推送新的历史条目
   *
   * @param beforeState 操作前状态
   * @param afterState 操作后状态
   * @param options 可选配置
   */
  push(
    beforeState: EditorState,
    afterState: EditorState,
    options: {
      label?: string;
      canMerge?: boolean;
      mergeGroup?: string;
      forcePush?: boolean;
    } = {}
  ): HistoryEntry | null {
    if (this.destroyed) {
      this.log('无法推送 - 管理器已销毁');
      return null;
    }

    // 如果内容没有变化，跳过
    if (beforeState.content === afterState.content) {
      this.log('跳过推送 - 内容无变化');
      return null;
    }

    const now = Date.now();
    const canMerge = options.canMerge ?? true;
    const forcePush = options.forcePush ?? false;

    // 计算差分
    const diffResult = this.diffEngine.diff(beforeState.content, afterState.content);
    const forwardDiff = diffResult.diffs;
    const reverse = this.diffEngine.reverseDiff(forwardDiff);

    // 检查是否应该合并到上一个操作
    if (
      this.config.enableMerging &&
      canMerge &&
      !forcePush &&
      this.shouldMergeWithPrevious(forwardDiff, now, options.mergeGroup)
    ) {
      return this.mergeWithPrevious(afterState, forwardDiff);
    }

    // 创建新条目
    const entry: HistoryEntry = {
      id: generateId(),
      forwardDiff,
      reverseDiff: reverse,
      beforeState,
      afterState,
      label: options.label,
      canMerge,
      mergeGroup: options.mergeGroup,
    };

    // 推入撤销栈
    this.undoStack.push(entry);

    // 清空重做栈
    if (this.config.clearRedoOnChange) {
      this.redoStack = [];
    }

    // 限制栈深度
    this.trimStack();

    this.lastPushTime = now;

    this.log('已推送条目，撤销栈大小:', this.undoStack.length);
    this.emitEvent('PUSH', entry);

    return entry;
  }

  /**
   * 执行撤销操作
   *
   * @param currentState 当前状态（用于验证）
   */
  undo(currentState: EditorState): HistoryOperationResult {
    if (this.destroyed) {
      return this.createFailedResult('管理器已销毁');
    }

    if (!this.canUndo()) {
      return this.createFailedResult('没有可撤销的操作');
    }

    // 弹出撤销栈顶
    const entry = this.undoStack.pop()!;

    // 验证当前状态是否匹配
    if (currentState.content !== entry.afterState.content) {
      this.log('警告：当前状态与历史不匹配，尝试应用差分');
    }

    // 应用反向差分
    const restoredContent = this.diffEngine.applyDiff(currentState.content, entry.reverseDiff);

    // 创建恢复后的状态
    const restoredState: EditorState = {
      content: restoredContent,
      selection: this.config.preserveSelection ? entry.beforeState.selection : null,
      timestamp: Date.now(),
      metadata: entry.beforeState.metadata,
    };

    // 推入重做栈
    this.redoStack.push(entry);

    this.log('撤销成功');
    this.emitEvent('UNDO', entry);

    return {
      success: true,
      state: restoredState,
      entry,
    };
  }

  /**
   * 执行重做操作
   *
   * @param currentState 当前状态（用于验证）
   */
  redo(currentState: EditorState): HistoryOperationResult {
    if (this.destroyed) {
      return this.createFailedResult('管理器已销毁');
    }

    if (!this.canRedo()) {
      return this.createFailedResult('没有可重做的操作');
    }

    // 弹出重做栈顶
    const entry = this.redoStack.pop()!;

    // 应用前向差分
    const restoredContent = this.diffEngine.applyDiff(currentState.content, entry.forwardDiff);

    // 创建恢复后的状态
    const restoredState: EditorState = {
      content: restoredContent,
      selection: this.config.preserveSelection ? entry.afterState.selection : null,
      timestamp: Date.now(),
      metadata: entry.afterState.metadata,
    };

    // 推入撤销栈
    this.undoStack.push(entry);

    this.log('重做成功');
    this.emitEvent('REDO', entry);

    return {
      success: true,
      state: restoredState,
      entry,
    };
  }

  // ================================
  // 事务 API
  // ================================

  /**
   * 开始一个事务
   *
   * 事务模式允许将多个操作合并为一个撤销单元。
   *
   * @param startState 事务开始时的状态
   * @param label 事务标签
   */
  beginTransaction(startState: EditorState, label?: string): Transaction {
    if (this.activeTransaction) {
      this.log('警告：已有活动事务，将自动取消');
      this.cancelTransaction(this.activeTransaction);
    }

    const transaction: Transaction = {
      id: generateId(),
      label,
      startState,
      currentState: startState,
      committed: false,
      cancelled: false,
      createdAt: Date.now(),
    };

    this.activeTransaction = transaction;
    this.log('事务已开始:', transaction.id);
    this.emitEvent('TRANSACTION_START');

    return transaction;
  }

  /**
   * 更新事务状态
   *
   * 在事务进行中可以多次调用此方法更新状态。
   *
   * @param tx 事务对象
   * @param newState 新状态
   */
  updateTransaction(tx: Transaction, newState: EditorState): void {
    if (tx !== this.activeTransaction) {
      this.log('警告：尝试更新非活动事务');
      return;
    }

    if (tx.committed || tx.cancelled) {
      this.log('警告：事务已结束，无法更新');
      return;
    }

    tx.currentState = newState;
  }

  /**
   * 提交事务
   *
   * 将事务期间的所有变更作为一个撤销单元。
   *
   * @param tx 事务对象
   * @param finalState 最终状态（可选，默认使用 currentState）
   */
  commit(tx: Transaction, finalState?: EditorState): HistoryEntry | null {
    if (tx !== this.activeTransaction) {
      this.log('警告：尝试提交非活动事务');
      return null;
    }

    if (tx.committed || tx.cancelled) {
      this.log('警告：事务已结束');
      return null;
    }

    const endState = finalState ?? tx.currentState;

    // 标记事务为已提交
    tx.committed = true;
    this.activeTransaction = null;

    // 如果没有变化，不创建历史条目
    if (tx.startState.content === endState.content) {
      this.log('事务提交但无变化');
      this.emitEvent('TRANSACTION_COMMIT');
      return null;
    }

    // 创建历史条目
    const entry = this.push(tx.startState, endState, {
      label: tx.label,
      canMerge: false, // 事务不与其他操作合并
      forcePush: true,
    });

    this.log('事务已提交:', tx.id);
    this.emitEvent('TRANSACTION_COMMIT', entry ?? undefined);

    return entry;
  }

  /**
   * 取消事务
   *
   * 丢弃事务期间的所有变更。
   *
   * @param tx 事务对象
   */
  cancelTransaction(tx: Transaction): EditorState {
    if (tx !== this.activeTransaction) {
      this.log('警告：尝试取消非活动事务');
      return tx.startState;
    }

    // 标记事务为已取消
    tx.cancelled = true;
    this.activeTransaction = null;

    this.log('事务已取消:', tx.id);
    this.emitEvent('TRANSACTION_CANCEL');

    // 返回事务开始时的状态
    return tx.startState;
  }

  /**
   * 检查是否有活动事务
   */
  hasActiveTransaction(): boolean {
    return this.activeTransaction !== null;
  }

  /**
   * 获取活动事务
   */
  getActiveTransaction(): Transaction | null {
    return this.activeTransaction;
  }

  // ================================
  // 状态查询
  // ================================

  /**
   * 是否可以撤销
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * 是否可以重做
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * 获取撤销栈大小
   */
  getUndoCount(): number {
    return this.undoStack.length;
  }

  /**
   * 获取重做栈大小
   */
  getRedoCount(): number {
    return this.redoStack.length;
  }

  /**
   * 获取撤销栈顶条目（不弹出）
   */
  peekUndo(): HistoryEntry | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null;
  }

  /**
   * 获取重做栈顶条目（不弹出）
   */
  peekRedo(): HistoryEntry | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : null;
  }

  /**
   * 获取完整的撤销历史（只读）
   */
  getUndoHistory(): ReadonlyArray<HistoryEntry> {
    return this.undoStack;
  }

  /**
   * 获取完整的重做历史（只读）
   */
  getRedoHistory(): ReadonlyArray<HistoryEntry> {
    return this.redoStack;
  }

  // ================================
  // 事件处理
  // ================================

  /**
   * 添加事件监听器
   */
  addEventListener(listener: HistoryEventListener): () => void {
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

  /**
   * 清空所有历史
   */
  clear(): void {
    if (this.destroyed) return;

    this.undoStack = [];
    this.redoStack = [];
    this.lastPushTime = 0;

    if (this.activeTransaction) {
      this.activeTransaction.cancelled = true;
      this.activeTransaction = null;
    }

    this.log('历史已清空');
    this.emitEvent('CLEAR');
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners.clear();
    this.activeTransaction = null;
    this.log('管理器已销毁');
  }

  /**
   * 检查是否已销毁
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  // ================================
  // CRDT 兼容接口（预留）
  // ================================

  /**
   * 从远程操作重建历史
   *
   * 此方法预留给 CRDT 集成使用。
   * 当接收到远程操作时，可以调用此方法更新本地历史。
   *
   * @param operations 远程操作列表
   * @param baseState 基础状态
   */
  rebuildFromOperations(
    operations: Array<{ type: 'insert' | 'delete'; position: number; text: string }>,
    baseState: EditorState
  ): EditorState {
    let content = baseState.content;

    for (const op of operations) {
      if (op.type === 'insert') {
        content = content.slice(0, op.position) + op.text + content.slice(op.position);
      } else if (op.type === 'delete') {
        content = content.slice(0, op.position) + content.slice(op.position + op.text.length);
      }
    }

    return createEditorState(content, baseState.selection, baseState.metadata);
  }

  /**
   * 导出历史为可序列化格式
   *
   * 用于持久化或同步。
   */
  exportHistory(): {
    undoStack: Array<{
      id: string;
      beforeContent: string;
      afterContent: string;
      timestamp: number;
      label?: string;
    }>;
    redoStack: Array<{
      id: string;
      beforeContent: string;
      afterContent: string;
      timestamp: number;
      label?: string;
    }>;
  } {
    const serializeEntry = (entry: HistoryEntry) => ({
      id: entry.id,
      beforeContent: entry.beforeState.content,
      afterContent: entry.afterState.content,
      timestamp: entry.beforeState.timestamp,
      label: entry.label,
    });

    return {
      undoStack: this.undoStack.map(serializeEntry),
      redoStack: this.redoStack.map(serializeEntry),
    };
  }

  /**
   * 从导出的数据恢复历史
   */
  importHistory(data: ReturnType<typeof this.exportHistory>): void {
    this.clear();

    for (const item of data.undoStack) {
      const beforeState = createEditorState(item.beforeContent);
      const afterState = createEditorState(item.afterContent);
      const diffResult = this.diffEngine.diff(item.beforeContent, item.afterContent);
      const forwardDiff = diffResult.diffs;
      const reverse = this.diffEngine.reverseDiff(forwardDiff);

      this.undoStack.push({
        id: item.id,
        forwardDiff,
        reverseDiff: reverse,
        beforeState,
        afterState,
        label: item.label,
        canMerge: false,
      });
    }

    for (const item of data.redoStack) {
      const beforeState = createEditorState(item.beforeContent);
      const afterState = createEditorState(item.afterContent);
      const diffResult = this.diffEngine.diff(item.beforeContent, item.afterContent);
      const forwardDiff = diffResult.diffs;
      const reverse = this.diffEngine.reverseDiff(forwardDiff);

      this.redoStack.push({
        id: item.id,
        forwardDiff,
        reverseDiff: reverse,
        beforeState,
        afterState,
        label: item.label,
        canMerge: false,
      });
    }

    this.emitEvent('STACK_CHANGED');
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 判断是否应该与上一个操作合并
   */
  private shouldMergeWithPrevious(
    forwardDiff: ReadonlyArray<Diff>,
    now: number,
    mergeGroup?: string
  ): boolean {
    if (this.undoStack.length === 0) {
      return false;
    }

    const lastEntry = this.undoStack[this.undoStack.length - 1];

    // 上一个条目不允许合并
    if (!lastEntry.canMerge) {
      return false;
    }

    // 检查合并组
    if (mergeGroup !== undefined && lastEntry.mergeGroup !== mergeGroup) {
      return false;
    }

    // 检查时间窗口
    const timeDiff = now - this.lastPushTime;
    if (timeDiff > this.config.mergeWindowMs) {
      return false;
    }

    // 检查操作类型是否相同（连续插入或连续删除）
    if (!isSameOperationType(lastEntry.forwardDiff, forwardDiff)) {
      return false;
    }

    // 检查字符数阈值
    const charCount = diffCharCount(forwardDiff);
    if (charCount > this.config.mergeCharThreshold) {
      return false;
    }

    // 检查语义边界
    const lastDiff = lastEntry.forwardDiff[lastEntry.forwardDiff.length - 1];
    if (lastDiff && lastDiff[0] === DIFF_INSERT && isSemanticBreakpoint(lastDiff[1])) {
      return false;
    }

    return true;
  }

  /**
   * 与上一个操作合并
   */
  private mergeWithPrevious(
    afterState: EditorState,
    _forwardDiff: ReadonlyArray<Diff>
  ): HistoryEntry | null {
    const lastEntry = this.undoStack[this.undoStack.length - 1];

    // 重新计算从最初状态到新状态的差分
    const diffResult = this.diffEngine.diff(lastEntry.beforeState.content, afterState.content);
    const newForwardDiff = diffResult.diffs;
    const newReverseDiff = this.diffEngine.reverseDiff(newForwardDiff);

    // 更新栈顶条目
    const mergedEntry: HistoryEntry = {
      id: lastEntry.id,
      forwardDiff: newForwardDiff,
      reverseDiff: newReverseDiff,
      beforeState: lastEntry.beforeState,
      afterState,
      label: lastEntry.label,
      canMerge: true,
      mergeGroup: lastEntry.mergeGroup,
    };

    this.undoStack[this.undoStack.length - 1] = mergedEntry;
    this.lastPushTime = Date.now();

    this.log('已合并条目，撤销栈大小:', this.undoStack.length);
    this.emitEvent('PUSH', mergedEntry);

    return mergedEntry;
  }

  /**
   * 限制栈深度
   */
  private trimStack(): void {
    if (this.undoStack.length > this.config.maxDepth) {
      const removeCount = this.undoStack.length - this.config.maxDepth;
      this.undoStack.splice(0, removeCount);
      this.log('已移除', removeCount, '个旧条目');
    }
  }

  /**
   * 创建失败结果
   */
  private createFailedResult(error: string): HistoryOperationResult {
    return {
      success: false,
      state: null,
      error,
    };
  }

  /**
   * 发出事件
   */
  private emitEvent(type: HistoryEventType, entry?: HistoryEntry): void {
    if (this.destroyed) return;

    const event: HistoryEvent = {
      type,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      entry,
      timestamp: Date.now(),
    };

    Array.from(this.listeners).forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('[HistoryManager] 监听器错误:', error);
      }
    });
  }

  /**
   * 输出调试日志
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[HistoryManager]', ...args);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 HistoryManager 实例
 */
export function createHistoryManager(config?: Partial<HistoryManagerConfig>): HistoryManager {
  return new HistoryManager(config);
}

// ================================
// 默认实例
// ================================

let defaultHistoryManager: HistoryManager | null = null;

/**
 * 获取默认 HistoryManager 实例
 */
export function getDefaultHistoryManager(): HistoryManager {
  if (!defaultHistoryManager) {
    defaultHistoryManager = createHistoryManager();
  }
  return defaultHistoryManager;
}

/**
 * 重置默认 HistoryManager 实例
 */
export function resetDefaultHistoryManager(): void {
  if (defaultHistoryManager) {
    defaultHistoryManager.destroy();
    defaultHistoryManager = null;
  }
}
