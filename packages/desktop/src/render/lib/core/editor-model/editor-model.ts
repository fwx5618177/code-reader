// ================================
// EditorModel
// 版本化内容管理，用于成熟的自动保存和协作功能
// 设计灵感来自 VS Code 的 ITextModel
// 支持 versionId + contentHash 双处理
// ================================

import {
  IEditorModel,
  VersionedContent,
  ContentSnapshot,
  ContentChangeEvent,
  ContentChangeListener,
  EditorModelConfig,
  createVersionedContent,
  createContentSnapshot,
} from './types';
import { VersionTracker } from './version-tracker';
import { hashContent } from '../delta';

/**
 * EditorModel - 带版本追踪的文档内容管理器
 *
 * 核心设计原则：
 * 1. **拉取式保存**：保存引擎在准备保存时拉取内容
 *    - 不向保存管理器推送内容
 *    - 保存时始终获取最新内容
 *    - 防止过期内容问题
 *
 * 2. **双重版本追踪**：versionId + contentHash
 *    - versionId：单调递增，用于排序和快速比较
 *    - contentHash：内容哈希，用于精确检测变化
 *    - 支持乐观更新和冲突检测
 *
 * 3. **不可变版本**：每个版本都是快照
 *    - 线程安全（JS 中的异步安全）
 *    - 易于比较版本
 *    - 支持保存级别的撤销/重做
 *
 * 4. **与 React 解耦**：纯 TypeScript 类
 *    - 无需 React 即可测试
 *    - 可在 Worker 中使用
 *    - 框架无关
 *
 * 使用示例：
 * ```typescript
 * const model = new EditorModel({
 *   documentId: 'doc-123',
 *   initialTitle: '我的文档',
 *   initialContent: '<p>Hello</p>',
 * });
 *
 * // 更新内容（版本递增，哈希自动计算）
 * model.updateContent('<p>Hello World</p>');
 *
 * // 拉取内容用于保存
 * const snapshot = model.getSnapshot();
 * await saveToDatabase(snapshot);
 *
 * // 标记为已保存
 * model.markAsSaved(snapshot.versionId, snapshot.contentHash);
 * ```
 */
export class EditorModel implements IEditorModel {
  private documentId: string | null;
  private title: string;
  private content: string;
  private contentHash: string;
  private readonly versionTracker: VersionTracker;
  private lastSavedVersionId: number | null;
  private lastSavedContentHash: string | null;
  private parentVersionId: number | null;
  private parentContentHash: string | null;
  private readonly listeners: Set<ContentChangeListener>;
  private destroyed: boolean;

  constructor(config: EditorModelConfig = {}) {
    this.documentId = config.documentId ?? null;
    this.title = config.initialTitle ?? '';
    this.content = config.initialContent ?? '';

    // 计算初始内容哈希
    const combinedContent = `${this.title}\n---\n${this.content}`;
    this.contentHash = config.initialContentHash ?? hashContent(combinedContent);

    this.versionTracker = new VersionTracker({
      initialVersionId: config.initialVersionId ?? 1,
    });

    this.lastSavedVersionId = null;
    this.lastSavedContentHash = null;
    this.parentVersionId = null;
    this.parentContentHash = null;
    this.listeners = new Set();
    this.destroyed = false;
  }

  // ================================
  // 身份标识
  // ================================

  getDocumentId(): string | null {
    return this.documentId;
  }

  setDocumentId(id: string | null): void {
    this.documentId = id;
  }

  // ================================
  // 内容访问（拉取式）
  // ================================

  getVersionedContent(): VersionedContent {
    return createVersionedContent(
      this.title,
      this.content,
      this.versionTracker.getVersionId(),
      this.contentHash
    );
  }

  getSnapshot(): ContentSnapshot | null {
    if (this.documentId === null) {
      return null;
    }

    return createContentSnapshot(
      this.documentId,
      this.title,
      this.content,
      this.versionTracker.getVersionId(),
      this.contentHash,
      this.parentVersionId ?? undefined,
      this.parentContentHash ?? undefined
    );
  }

  getVersionId(): number {
    return this.versionTracker.getVersionId();
  }

  getContentHash(): string {
    return this.contentHash;
  }

  getTitle(): string {
    return this.title;
  }

  getContent(): string {
    return this.content;
  }

  // ================================
  // 内容更新
  // ================================

  updateContent(content: string): number {
    if (this.destroyed) {
      console.warn('[EditorModel] 无法更新已销毁的模型');
      return this.versionTracker.getVersionId();
    }

    // 如果内容没有变化则跳过
    if (this.content === content) {
      return this.versionTracker.getVersionId();
    }

    const previousVersionId = this.versionTracker.getVersionId();
    const previousContentHash = this.contentHash;

    // 更新内容
    this.content = content;

    // 计算新的内容哈希
    const combinedContent = `${this.title}\n---\n${this.content}`;
    const newContentHash = hashContent(combinedContent);

    // 更新版本信息
    this.parentVersionId = previousVersionId;
    this.parentContentHash = previousContentHash;
    this.contentHash = newContentHash;
    const newVersionId = this.versionTracker.increment();

    this.notifyListeners({
      previousVersionId,
      newVersionId,
      previousContentHash,
      newContentHash,
      changeType: 'content',
      timestamp: Date.now(),
    });

    return newVersionId;
  }

  updateTitle(title: string): number {
    if (this.destroyed) {
      console.warn('[EditorModel] 无法更新已销毁的模型');
      return this.versionTracker.getVersionId();
    }

    // 如果标题没有变化则跳过
    if (this.title === title) {
      return this.versionTracker.getVersionId();
    }

    const previousVersionId = this.versionTracker.getVersionId();
    const previousContentHash = this.contentHash;

    // 更新标题
    this.title = title;

    // 计算新的内容哈希
    const combinedContent = `${this.title}\n---\n${this.content}`;
    const newContentHash = hashContent(combinedContent);

    // 更新版本信息
    this.parentVersionId = previousVersionId;
    this.parentContentHash = previousContentHash;
    this.contentHash = newContentHash;
    const newVersionId = this.versionTracker.increment();

    this.notifyListeners({
      previousVersionId,
      newVersionId,
      previousContentHash,
      newContentHash,
      changeType: 'title',
      timestamp: Date.now(),
    });

    return newVersionId;
  }

  update(title: string, content: string): number {
    if (this.destroyed) {
      console.warn('[EditorModel] 无法更新已销毁的模型');
      return this.versionTracker.getVersionId();
    }

    const titleChanged = this.title !== title;
    const contentChanged = this.content !== content;

    // 如果没有变化则跳过
    if (!titleChanged && !contentChanged) {
      return this.versionTracker.getVersionId();
    }

    const previousVersionId = this.versionTracker.getVersionId();
    const previousContentHash = this.contentHash;

    // 更新内容
    this.title = title;
    this.content = content;

    // 计算新的内容哈希
    const combinedContent = `${this.title}\n---\n${this.content}`;
    const newContentHash = hashContent(combinedContent);

    // 更新版本信息
    this.parentVersionId = previousVersionId;
    this.parentContentHash = previousContentHash;
    this.contentHash = newContentHash;
    const newVersionId = this.versionTracker.increment();

    const changeType: 'title' | 'content' | 'both' =
      titleChanged && contentChanged ? 'both' : titleChanged ? 'title' : 'content';

    this.notifyListeners({
      previousVersionId,
      newVersionId,
      previousContentHash,
      newContentHash,
      changeType,
      timestamp: Date.now(),
    });

    return newVersionId;
  }

  // ================================
  // 文档生命周期
  // ================================

  reset(config: EditorModelConfig): void {
    if (this.destroyed) {
      console.warn('[EditorModel] 无法重置已销毁的模型');
      return;
    }

    const previousVersionId = this.versionTracker.getVersionId();
    const previousContentHash = this.contentHash;

    this.documentId = config.documentId ?? null;
    this.title = config.initialTitle ?? '';
    this.content = config.initialContent ?? '';

    // 计算新的内容哈希
    const combinedContent = `${this.title}\n---\n${this.content}`;
    this.contentHash = config.initialContentHash ?? hashContent(combinedContent);

    this.versionTracker.reset(config.initialVersionId ?? 1);
    this.lastSavedVersionId = null;
    this.lastSavedContentHash = null;
    this.parentVersionId = null;
    this.parentContentHash = null;

    const newVersionId = this.versionTracker.getVersionId();

    this.notifyListeners({
      previousVersionId,
      newVersionId,
      previousContentHash,
      newContentHash: this.contentHash,
      changeType: 'both',
      timestamp: Date.now(),
    });
  }

  isEmpty(): boolean {
    const trimmedTitle = this.title.trim();
    const trimmedContent = this.content.replace(/<[^>]*>/g, '').trim();
    return trimmedTitle.length === 0 && trimmedContent.length === 0;
  }

  // ================================
  // 变更追踪
  // ================================

  onContentChange(listener: ContentChangeListener): () => void {
    if (this.destroyed) {
      console.warn('[EditorModel] 无法向已销毁的模型添加监听器');
      return () => {};
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLastSavedVersionId(): number | null {
    return this.lastSavedVersionId;
  }

  getLastSavedContentHash(): string | null {
    return this.lastSavedContentHash;
  }

  markAsSaved(versionId: number, contentHash: string): void {
    // 仅当保存的版本比当前记录的更新时才更新
    if (this.lastSavedVersionId === null || versionId > this.lastSavedVersionId) {
      this.lastSavedVersionId = versionId;
      this.lastSavedContentHash = contentHash;
    }
  }

  hasUnsavedChanges(): boolean {
    // 使用内容哈希进行精确检测
    if (this.lastSavedContentHash === null) {
      // 从未保存过 - 如果非空则有更改
      return !this.isEmpty();
    }

    // 比较内容哈希（比版本号更准确）
    return this.contentHash !== this.lastSavedContentHash;
  }

  /**
   * 检查是否可以使用增量保存
   * 如果有父版本信息，则可以计算增量
   */
  canUseIncrementalSave(): boolean {
    return this.parentVersionId !== null && this.parentContentHash !== null;
  }

  /**
   * 获取父版本信息（用于增量保存）
   */
  getParentVersion(): { versionId: number; contentHash: string } | null {
    if (this.parentVersionId === null || this.parentContentHash === null) {
      return null;
    }

    return {
      versionId: this.parentVersionId,
      contentHash: this.parentContentHash,
    };
  }

  // ================================
  // 生命周期
  // ================================

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.listeners.clear();
    this.versionTracker.destroy();
  }

  /**
   * 检查模型是否已销毁
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  // ================================
  // 私有方法
  // ================================

  private notifyListeners(event: ContentChangeEvent): void {
    if (this.destroyed) {
      return;
    }

    // 使用 Array.from 以兼容 ES5 并安全迭代
    Array.from(this.listeners).forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('[EditorModel] 监听器错误:', error);
      }
    });
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建新的 EditorModel 实例
 */
export function createEditorModel(config?: EditorModelConfig): EditorModel {
  return new EditorModel(config);
}

/**
 * 从现有文档创建 EditorModel
 */
export function createEditorModelFromDocument(
  documentId: string,
  title: string,
  content: string,
  versionId?: number,
  contentHash?: string
): EditorModel {
  return new EditorModel({
    documentId,
    initialTitle: title,
    initialContent: content,
    initialVersionId: versionId ?? 1,
    initialContentHash: contentHash,
  });
}
