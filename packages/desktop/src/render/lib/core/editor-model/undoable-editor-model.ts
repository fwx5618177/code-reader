// ================================
// UndoableEditorModel
// 带撤销/重做功能的编辑器模型
// 使用生产级 HistoryManager
// ================================

import { EditorModel, createEditorModel } from './editor-model';
import {
  EditorModelConfig,
  ContentSnapshot,
  VersionedContent,
  ContentChangeEvent,
  ContentChangeListener,
  IEditorModel,
} from './types';
import {
  HistoryManager,
  createHistoryManager,
  HistoryManagerConfig,
  HistoryEventListener,
  EditorState,
  SelectionState,
  createEditorState,
  createSelection,
} from '../delta';

/**
 * UndoableEditorModel 配置
 */
export interface UndoableEditorModelConfig extends EditorModelConfig {
  /** 历史管理器配置 */
  historyConfig?: Partial<HistoryManagerConfig>;
  /** 是否启用撤销/重做（默认: true）*/
  undoEnabled?: boolean;
}

/**
 * 撤销/重做状态
 */
export interface UndoRedoState {
  /** 是否可以撤销 */
  readonly canUndo: boolean;
  /** 是否可以重做 */
  readonly canRedo: boolean;
  /** 撤销栈大小 */
  readonly undoCount: number;
  /** 重做栈大小 */
  readonly redoCount: number;
  /** 是否有活动事务 */
  readonly hasActiveTransaction: boolean;
}

/**
 * 撤销/重做结果
 */
export interface UndoRedoResult {
  /** 操作后的内容 */
  readonly content: string;
  /** 恢复到的版本 ID */
  readonly versionId: number;
  /** 恢复到的内容哈希 */
  readonly contentHash: string;
  /** 是否成功 */
  readonly success: boolean;
  /** 错误信息 */
  readonly error?: string;
  /** 恢复的选区状态 */
  readonly selection?: SelectionState | null;
}

/**
 * UndoableEditorModel - 带撤销/重做功能的编辑器模型
 *
 * 这是 EditorModel 的增强版本，通过组合模式集成 HistoryManager。
 * 保持职责分离：
 * - EditorModel：负责内容管理和版本追踪
 * - HistoryManager：负责撤销/重做历史
 *
 * 核心特性：
 * 1. **完整的编辑器功能**：继承 EditorModel 的所有功能
 * 2. **生产级撤销/重做**：基于 diff-match-patch 的高效实现
 * 3. **选区状态保存**：撤销/重做时恢复光标位置
 * 4. **事务支持**：将多个操作合并为一个撤销单元
 * 5. **智能合并**：快速连续输入自动合并
 *
 * 使用示例：
 * ```typescript
 * const model = new UndoableEditorModel({
 *   documentId: 'doc-123',
 *   initialTitle: '我的文档',
 *   initialContent: '<p>Hello</p>',
 * });
 *
 * // 更新内容（自动记录到撤销历史）
 * model.updateContent('<p>Hello World</p>');
 *
 * // 撤销
 * if (model.canUndo()) {
 *   const result = model.undo();
 *   if (result.success) {
 *     console.log('撤销成功，内容:', result.content);
 *   }
 * }
 *
 * // 事务模式（多个操作合并为一个撤销单元）
 * model.beginTransaction('批量编辑');
 * model.updateContent('内容1');
 * model.updateContent('内容2');
 * model.commitTransaction();
 * ```
 */
export class UndoableEditorModel implements IEditorModel {
  private readonly model: EditorModel;
  private readonly historyManager: HistoryManager;
  private readonly undoEnabled: boolean;
  private isUndoRedoInProgress: boolean;
  private currentSelection: SelectionState | null;
  private lastRecordedState: EditorState | null;

  constructor(config: UndoableEditorModelConfig = {}) {
    this.model = createEditorModel(config);
    this.historyManager = createHistoryManager(config.historyConfig);
    this.undoEnabled = config.undoEnabled ?? true;
    this.isUndoRedoInProgress = false;
    this.currentSelection = null;
    this.lastRecordedState = null;

    // 记录初始状态
    this.lastRecordedState = this.createCurrentState();

    // 监听内容变更以自动记录撤销历史
    if (this.undoEnabled) {
      this.model.onContentChange((event) => this.handleContentChange(event));
    }
  }

  // ================================
  // 撤销/重做 API
  // ================================

  /**
   * 执行撤销操作
   */
  undo(): UndoRedoResult {
    if (!this.undoEnabled) {
      return this.createFailedResult('撤销功能已禁用');
    }

    if (!this.canUndo()) {
      return this.createFailedResult('没有可撤销的操作');
    }

    const currentState = this.createCurrentState();
    const result = this.historyManager.undo(currentState);

    if (result.success && result.state) {
      this.isUndoRedoInProgress = true;
      try {
        // 解析恢复的内容
        const { title, content } = this.parseCombinedContent(result.state.content);
        this.model.update(title, content);
        this.lastRecordedState = result.state;
        this.currentSelection = result.state.selection;

        return {
          content: result.state.content,
          versionId: this.model.getVersionId(),
          contentHash: this.model.getContentHash(),
          success: true,
          selection: result.state.selection,
        };
      } finally {
        this.isUndoRedoInProgress = false;
      }
    }

    return this.createFailedResult(result.error ?? '撤销失败');
  }

  /**
   * 执行重做操作
   */
  redo(): UndoRedoResult {
    if (!this.undoEnabled) {
      return this.createFailedResult('撤销功能已禁用');
    }

    if (!this.canRedo()) {
      return this.createFailedResult('没有可重做的操作');
    }

    const currentState = this.createCurrentState();
    const result = this.historyManager.redo(currentState);

    if (result.success && result.state) {
      this.isUndoRedoInProgress = true;
      try {
        // 解析恢复的内容
        const { title, content } = this.parseCombinedContent(result.state.content);
        this.model.update(title, content);
        this.lastRecordedState = result.state;
        this.currentSelection = result.state.selection;

        return {
          content: result.state.content,
          versionId: this.model.getVersionId(),
          contentHash: this.model.getContentHash(),
          success: true,
          selection: result.state.selection,
        };
      } finally {
        this.isUndoRedoInProgress = false;
      }
    }

    return this.createFailedResult(result.error ?? '重做失败');
  }

  /**
   * 是否可以撤销
   */
  canUndo(): boolean {
    return this.undoEnabled && this.historyManager.canUndo();
  }

  /**
   * 是否可以重做
   */
  canRedo(): boolean {
    return this.undoEnabled && this.historyManager.canRedo();
  }

  /**
   * 获取撤销/重做状态
   */
  getUndoRedoState(): UndoRedoState {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this.historyManager.getUndoCount(),
      redoCount: this.historyManager.getRedoCount(),
      hasActiveTransaction: this.historyManager.hasActiveTransaction(),
    };
  }

  /**
   * 清空撤销/重做历史
   */
  clearUndoHistory(): void {
    this.historyManager.clear();
    this.lastRecordedState = this.createCurrentState();
  }

  /**
   * 添加撤销/重做事件监听器
   */
  onUndoRedoChange(listener: HistoryEventListener): () => void {
    return this.historyManager.addEventListener(listener);
  }

  // ================================
  // 选区状态 API
  // ================================

  /**
   * 设置当前选区状态
   *
   * 在下次内容变更时，此选区将被保存到历史记录中。
   */
  setSelection(anchor: number, focus?: number): void {
    this.currentSelection = createSelection(anchor, focus);
  }

  /**
   * 获取当前选区状态
   */
  getSelection(): SelectionState | null {
    return this.currentSelection;
  }

  /**
   * 清除选区状态
   */
  clearSelection(): void {
    this.currentSelection = null;
  }

  // ================================
  // 事务 API
  // ================================

  /**
   * 开始一个事务
   *
   * 事务模式允许将多个操作合并为一个撤销单元。
   *
   * @param label 事务标签（用于调试）
   */
  beginTransaction(label?: string): void {
    if (!this.undoEnabled) return;

    const currentState = this.createCurrentState();
    this.historyManager.beginTransaction(currentState, label);
  }

  /**
   * 提交当前事务
   */
  commitTransaction(): void {
    if (!this.undoEnabled) return;

    const tx = this.historyManager.getActiveTransaction();
    if (tx) {
      const finalState = this.createCurrentState();
      this.historyManager.commit(tx, finalState);
      this.lastRecordedState = finalState;
    }
  }

  /**
   * 取消当前事务
   *
   * 恢复到事务开始时的状态。
   */
  cancelTransaction(): void {
    if (!this.undoEnabled) return;

    const tx = this.historyManager.getActiveTransaction();
    if (tx) {
      const startState = this.historyManager.cancelTransaction(tx);

      // 恢复到事务开始时的状态
      this.isUndoRedoInProgress = true;
      try {
        const { title, content } = this.parseCombinedContent(startState.content);
        this.model.update(title, content);
        this.lastRecordedState = startState;
      } finally {
        this.isUndoRedoInProgress = false;
      }
    }
  }

  /**
   * 检查是否有活动事务
   */
  hasActiveTransaction(): boolean {
    return this.historyManager.hasActiveTransaction();
  }

  // ================================
  // IEditorModel 接口实现（代理到内部 model）
  // ================================

  getDocumentId(): string | null {
    return this.model.getDocumentId();
  }

  setDocumentId(id: string | null): void {
    this.model.setDocumentId(id);
  }

  getVersionedContent(): VersionedContent {
    return this.model.getVersionedContent();
  }

  getSnapshot(): ContentSnapshot | null {
    return this.model.getSnapshot();
  }

  getVersionId(): number {
    return this.model.getVersionId();
  }

  getContentHash(): string {
    return this.model.getContentHash();
  }

  getTitle(): string {
    return this.model.getTitle();
  }

  getContent(): string {
    return this.model.getContent();
  }

  updateContent(content: string): number {
    return this.model.updateContent(content);
  }

  updateTitle(title: string): number {
    return this.model.updateTitle(title);
  }

  update(title: string, content: string): number {
    return this.model.update(title, content);
  }

  reset(config: EditorModelConfig): void {
    this.model.reset(config);
    // 重置时清空撤销历史
    this.historyManager.clear();
    this.lastRecordedState = this.createCurrentState();
    this.currentSelection = null;
  }

  isEmpty(): boolean {
    return this.model.isEmpty();
  }

  onContentChange(listener: ContentChangeListener): () => void {
    return this.model.onContentChange(listener);
  }

  getLastSavedVersionId(): number | null {
    return this.model.getLastSavedVersionId();
  }

  getLastSavedContentHash(): string | null {
    return this.model.getLastSavedContentHash();
  }

  markAsSaved(versionId: number, contentHash: string): void {
    this.model.markAsSaved(versionId, contentHash);
  }

  hasUnsavedChanges(): boolean {
    return this.model.hasUnsavedChanges();
  }

  canUseIncrementalSave(): boolean {
    return this.model.canUseIncrementalSave();
  }

  getParentVersion(): { versionId: number; contentHash: string } | null {
    return this.model.getParentVersion();
  }

  destroy(): void {
    this.model.destroy();
    this.historyManager.destroy();
  }

  isDestroyed(): boolean {
    return this.model.isDestroyed();
  }

  // ================================
  // 历史导出/导入（用于持久化）
  // ================================

  /**
   * 导出历史记录
   */
  exportHistory(): ReturnType<HistoryManager['exportHistory']> {
    return this.historyManager.exportHistory();
  }

  /**
   * 导入历史记录
   */
  importHistory(data: ReturnType<HistoryManager['exportHistory']>): void {
    this.historyManager.importHistory(data);
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 处理内容变更事件
   */
  private handleContentChange(event: ContentChangeEvent): void {
    // 跳过撤销/重做过程中触发的变更
    if (this.isUndoRedoInProgress) {
      return;
    }

    // 如果有活动事务，只更新事务状态，不直接推入历史
    if (this.historyManager.hasActiveTransaction()) {
      const tx = this.historyManager.getActiveTransaction();
      if (tx) {
        this.historyManager.updateTransaction(tx, this.createCurrentState());
      }
      return;
    }

    const beforeState = this.lastRecordedState ?? this.createPreviousState(event);
    const afterState = this.createCurrentState();

    // 推入历史
    this.historyManager.push(beforeState, afterState, {
      canMerge: true,
    });

    // 更新记录的状态
    this.lastRecordedState = afterState;
  }

  /**
   * 创建当前编辑器状态
   */
  private createCurrentState(): EditorState {
    const combinedContent = this.getCombinedContent();
    return createEditorState(combinedContent, this.currentSelection, {
      versionId: this.model.getVersionId(),
      contentHash: this.model.getContentHash(),
    });
  }

  /**
   * 根据变更事件创建之前的状态
   */
  private createPreviousState(event: ContentChangeEvent): EditorState {
    // 由于我们没有保存之前的内容，使用当前内容作为 fallback
    // 这在首次变更时会发生
    return createEditorState(this.getCombinedContent(), null, {
      versionId: event.previousVersionId,
      contentHash: event.previousContentHash,
    });
  }

  /**
   * 获取组合内容（title + content）
   */
  private getCombinedContent(): string {
    return `${this.model.getTitle()}\n---\n${this.model.getContent()}`;
  }

  /**
   * 解析组合内容
   */
  private parseCombinedContent(combined: string): { title: string; content: string } {
    const separatorIndex = combined.indexOf('\n---\n');
    if (separatorIndex === -1) {
      // 没有分隔符，全部作为内容
      return { title: '', content: combined };
    }

    return {
      title: combined.substring(0, separatorIndex),
      content: combined.substring(separatorIndex + 5), // 5 = '\n---\n'.length
    };
  }

  /**
   * 创建失败结果
   */
  private createFailedResult(error: string): UndoRedoResult {
    return {
      content: '',
      versionId: 0,
      contentHash: '',
      success: false,
      error,
    };
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 UndoableEditorModel 实例
 */
export function createUndoableEditorModel(config?: UndoableEditorModelConfig): UndoableEditorModel {
  return new UndoableEditorModel(config);
}

/**
 * 从现有文档创建 UndoableEditorModel
 */
export function createUndoableEditorModelFromDocument(
  documentId: string,
  title: string,
  content: string,
  versionId?: number,
  contentHash?: string,
  historyConfig?: Partial<HistoryManagerConfig>
): UndoableEditorModel {
  return new UndoableEditorModel({
    documentId,
    initialTitle: title,
    initialContent: content,
    initialVersionId: versionId ?? 1,
    initialContentHash: contentHash,
    historyConfig,
  });
}
