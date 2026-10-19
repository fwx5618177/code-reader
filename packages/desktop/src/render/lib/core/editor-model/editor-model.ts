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
/**
 * 某一版本内容的哈希：首次读取时计算并缓存。
 * 大文档每次按键都整篇哈希代价高（80 万字符约 9ms），而哈希只在保存快照与比较时才需要
 */
class LazyContentHash {
  private value: string | null;

  constructor(
    readonly title: string,
    readonly content: string,
    known?: string
  ) {
    this.value = known ?? null;
  }

  get(): string {
    return (this.value ??= hashContent(`${this.title}\n---\n${this.content}`));
  }

  /** 已知该版本的哈希（如保存结果带回的哈希）时直接记下，免去计算 */
  prime(hash: string): void {
    this.value ??= hash;
  }
}

/** 保存进行中时最多记住多少个快照版本（用于保存完成后免哈希判断有无未保存的修改） */
const MAX_PENDING_SNAPSHOTS = 8;

/** 内容变更事件：哈希字段按需计算 */
function changeEvent(
  previousVersionId: number,
  newVersionId: number,
  previous: LazyContentHash,
  next: LazyContentHash,
  changeType: ContentChangeEvent['changeType']
): ContentChangeEvent {
  return {
    previousVersionId,
    newVersionId,
    get previousContentHash() {
      return previous.get();
    },
    get newContentHash() {
      return next.get();
    },
    changeType,
    timestamp: Date.now(),
  };
}

export class EditorModel implements IEditorModel {
  private documentId: string | null;
  private title: string;
  private content: string;
  private hash: LazyContentHash;
  private readonly versionTracker: VersionTracker;
  private lastSavedVersionId: number | null;
  private lastSavedContentHash: string | null;
  /** 最近一次保存的版本内容（已知时），用于不计算哈希就判断有无未保存的修改 */
  private lastSaved: LazyContentHash | null;
  /** 已取快照、尚未确认保存的版本 */
  private readonly pendingSnapshots = new Map<number, LazyContentHash>();
  private parentVersionId: number | null;
  private parentHash: LazyContentHash | null;
  private readonly listeners: Set<ContentChangeListener>;
  private destroyed: boolean;

  constructor(config: EditorModelConfig = {}) {
    this.documentId = config.documentId ?? null;
    this.title = config.initialTitle ?? '';
    this.content = config.initialContent ?? '';

    this.hash = new LazyContentHash(this.title, this.content, config.initialContentHash);

    this.versionTracker = new VersionTracker({
      initialVersionId: config.initialVersionId ?? 1,
    });

    this.lastSavedVersionId = null;
    this.lastSavedContentHash = null;
    this.lastSaved = null;
    this.parentVersionId = null;
    this.parentHash = null;
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
      this.hash.get()
    );
  }

  getSnapshot(): ContentSnapshot | null {
    if (this.documentId === null) {
      return null;
    }

    const versionId = this.versionTracker.getVersionId();
    this.pendingSnapshots.set(versionId, this.hash);
    if (this.pendingSnapshots.size > MAX_PENDING_SNAPSHOTS) {
      this.pendingSnapshots.delete(this.pendingSnapshots.keys().next().value!);
    }

    return createContentSnapshot(
      this.documentId,
      this.title,
      this.content,
      versionId,
      this.hash.get(),
      this.parentVersionId ?? undefined,
      this.parentHash?.get()
    );
  }

  getVersionId(): number {
    return this.versionTracker.getVersionId();
  }

  getContentHash(): string {
    return this.hash.get();
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
    // 更新内容
    this.content = content;

    const newVersionId = this.advanceVersion(previousVersionId);
    this.notifyListeners(changeEvent(previousVersionId, newVersionId, this.parentHash!, this.hash, 'content'));

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
    // 更新标题
    this.title = title;

    const newVersionId = this.advanceVersion(previousVersionId);
    this.notifyListeners(changeEvent(previousVersionId, newVersionId, this.parentHash!, this.hash, 'title'));

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

    // 更新内容
    this.title = title;
    this.content = content;

    const newVersionId = this.advanceVersion(previousVersionId);
    const changeType: 'title' | 'content' | 'both' =
      titleChanged && contentChanged ? 'both' : titleChanged ? 'title' : 'content';
    this.notifyListeners(changeEvent(previousVersionId, newVersionId, this.parentHash!, this.hash, changeType));

    return newVersionId;
  }

  /** 内容已更新：当前哈希变为父版本，新版本的哈希留待需要时计算 */
  private advanceVersion(previousVersionId: number): number {
    this.parentVersionId = previousVersionId;
    this.parentHash = this.hash;
    this.hash = new LazyContentHash(this.title, this.content);
    return this.versionTracker.increment();
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
    const previous = this.hash;

    this.documentId = config.documentId ?? null;
    this.title = config.initialTitle ?? '';
    this.content = config.initialContent ?? '';
    this.hash = new LazyContentHash(this.title, this.content, config.initialContentHash);

    this.versionTracker.reset(config.initialVersionId ?? 1);
    this.lastSavedVersionId = null;
    this.lastSavedContentHash = null;
    this.lastSaved = null;
    this.pendingSnapshots.clear();
    this.parentVersionId = null;
    this.parentHash = null;

    this.notifyListeners(changeEvent(previousVersionId, this.versionTracker.getVersionId(), previous, this.hash, 'both'));
  }

  /**
   * 标题与正文都没有可见内容（正文中的旧版 HTML 标签不算）。
   * 每次内容变化都会调用：找到第一个非空白字符且不是标签开头就返回，不扫描整篇
   */
  isEmpty(): boolean {
    if (this.title.trim().length > 0) return false;
    const first = this.content.search(/\S/);
    if (first === -1) return true;
    if (this.content[first] !== '<') return false;
    return this.content.replace(/<[^>]*>/g, '').trim().length === 0;
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
      const saved =
        versionId === this.versionTracker.getVersionId()
          ? this.hash
          : (this.pendingSnapshots.get(versionId) ?? (versionId === this.parentVersionId ? this.parentHash : null));
      saved?.prime(contentHash);
      this.lastSaved = saved;
    }
    for (const pending of this.pendingSnapshots.keys()) {
      if (pending <= versionId) this.pendingSnapshots.delete(pending);
    }
  }

  /**
   * 是否有未保存的修改（按内容判断，比版本号准确：改了又改回来算没有修改）。
   * 已知保存时的内容就直接比较字符串，不计算哈希
   */
  hasUnsavedChanges(): boolean {
    if (this.lastSavedContentHash === null) {
      // 从未保存过 - 如果非空则有更改
      return !this.isEmpty();
    }
    const saved = this.lastSaved;
    if (saved) return saved !== this.hash && (saved.title !== this.title || saved.content !== this.content);
    return this.hash.get() !== this.lastSavedContentHash;
  }

  /**
   * 检查是否可以使用增量保存
   * 如果有父版本信息，则可以计算增量
   */
  canUseIncrementalSave(): boolean {
    return this.parentVersionId !== null && this.parentHash !== null;
  }

  /**
   * 获取父版本信息（用于增量保存）
   */
  getParentVersion(): { versionId: number; contentHash: string } | null {
    if (this.parentVersionId === null || this.parentHash === null) {
      return null;
    }

    return {
      versionId: this.parentVersionId,
      contentHash: this.parentHash.get(),
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
