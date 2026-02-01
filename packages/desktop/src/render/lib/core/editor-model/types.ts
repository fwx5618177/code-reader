// ================================
// EditorModel 类型定义
// 版本化内容追踪，用于成熟的自动保存和协作功能
// 支持 versionId + contentHash 双处理
// ================================

/**
 * 版本化内容 - 每次内容变更都有唯一版本
 * 这是版本化自动保存的基础（VS Code 风格）
 */
export interface VersionedContent {
  /** 版本 ID - 单调递增计数器 */
  readonly versionId: number;
  /** 内容哈希 - 用于精确检测内容变化 */
  readonly contentHash: string;
  /** 文档标题 */
  readonly title: string;
  /** 文档内容（富文本为 HTML） */
  readonly content: string;
  /** 该版本创建时的时间戳 */
  readonly timestamp: number;
}

/**
 * 内容快照，用于保存操作
 */
export interface ContentSnapshot extends VersionedContent {
  /** 文档 ID（用于持久化） */
  readonly documentId: string;
  /** 内容长度（字节） */
  readonly contentLength: number;
  /** 可选：父版本 ID（用于版本链） */
  readonly parentVersionId?: number;
  /** 可选：父版本哈希（用于验证版本链完整性） */
  readonly parentContentHash?: string;
}

/**
 * 内容变更事件
 */
export interface ContentChangeEvent {
  /** 之前的版本 */
  readonly previousVersionId: number;
  /** 新版本 */
  readonly newVersionId: number;
  /** 之前的内容哈希 */
  readonly previousContentHash: string;
  /** 新的内容哈希 */
  readonly newContentHash: string;
  /** 变更类型 */
  readonly changeType: 'title' | 'content' | 'both';
  /** 变更时间戳 */
  readonly timestamp: number;
}

/**
 * 内容变更监听器
 */
export type ContentChangeListener = (event: ContentChangeEvent) => void;

/**
 * 编辑器模型配置
 */
export interface EditorModelConfig {
  /** 初始文档 ID */
  documentId?: string;
  /** 初始标题 */
  initialTitle?: string;
  /** 初始内容 */
  initialContent?: string;
  /** 初始版本 ID（默认: 1） */
  initialVersionId?: number;
  /** 初始内容哈希（如果不提供则自动计算） */
  initialContentHash?: string;
}

/**
 * 编辑器模型接口 - 管理文档内容和版本追踪
 *
 * 核心设计原则：
 * 1. 不可变的版本化内容 - 每次更新创建新版本
 * 2. 拉取式保存 - 保存引擎在准备保存时拉取内容
 * 3. 事件驱动 - 通知监听器变更以更新 UI
 * 4. 与 React 解耦 - 纯 TypeScript 类，便于测试
 * 5. 双重版本追踪 - versionId（排序）+ contentHash（精确检测）
 */
export interface IEditorModel {
  // ================================
  // 身份标识
  // ================================

  /** 获取文档 ID */
  getDocumentId(): string | null;

  /** 设置文档 ID（切换文档时） */
  setDocumentId(id: string | null): void;

  // ================================
  // 内容访问（拉取式）
  // ================================

  /** 获取当前版本化内容（用于保存操作） */
  getVersionedContent(): VersionedContent;

  /** 获取带文档 ID 的内容快照 */
  getSnapshot(): ContentSnapshot | null;

  /** 获取当前版本 ID */
  getVersionId(): number;

  /** 获取当前内容哈希 */
  getContentHash(): string;

  /** 获取当前标题 */
  getTitle(): string;

  /** 获取当前内容 */
  getContent(): string;

  // ================================
  // 内容更新
  // ================================

  /**
   * 更新内容（版本递增）
   * @param content 新内容
   * @returns 新版本 ID
   */
  updateContent(content: string): number;

  /**
   * 更新标题（版本递增）
   * @param title 新标题
   * @returns 新版本 ID
   */
  updateTitle(title: string): number;

  /**
   * 同时更新标题和内容（版本只递增一次）
   * @param title 新标题
   * @param content 新内容
   * @returns 新版本 ID
   */
  update(title: string, content: string): number;

  // ================================
  // 文档生命周期
  // ================================

  /**
   * 用新文档重置模型
   * 在切换文档或从数据库加载时使用
   */
  reset(config: EditorModelConfig): void;

  /**
   * 检查模型是否有内容
   */
  isEmpty(): boolean;

  // ================================
  // 变更追踪
  // ================================

  /**
   * 订阅内容变更
   * @returns 取消订阅函数
   */
  onContentChange(listener: ContentChangeListener): () => void;

  /**
   * 获取内容上次保存时的版本 ID
   */
  getLastSavedVersionId(): number | null;

  /**
   * 获取内容上次保存时的内容哈希
   */
  getLastSavedContentHash(): string | null;

  /**
   * 标记当前版本为已保存
   */
  markAsSaved(versionId: number, contentHash: string): void;

  /**
   * 检查是否有未保存的更改
   * 使用内容哈希进行精确检测
   */
  hasUnsavedChanges(): boolean;

  // ================================
  // 生命周期
  // ================================

  /** 销毁模型并清理资源 */
  destroy(): void;

  /** 检查模型是否已销毁 */
  isDestroyed(): boolean;
}

/**
 * 创建默认的版本化内容
 */
export function createVersionedContent(
  title: string = '',
  content: string = '',
  versionId: number = 1,
  contentHash: string = ''
): VersionedContent {
  return {
    versionId,
    contentHash,
    title,
    content,
    timestamp: Date.now(),
  };
}

/**
 * 检查两个版本化内容是否相等（通过版本 ID 和内容哈希）
 */
export function areVersionsEqual(a: VersionedContent, b: VersionedContent): boolean {
  return a.versionId === b.versionId && a.contentHash === b.contentHash;
}

/**
 * 检查内容是否实际变化（使用内容哈希）
 */
export function hasContentChanged(a: VersionedContent, b: VersionedContent): boolean {
  return a.contentHash !== b.contentHash;
}

/**
 * 检查版本是否更新（使用版本 ID）
 */
export function isVersionNewer(a: VersionedContent, b: VersionedContent): boolean {
  return a.versionId > b.versionId;
}

/**
 * 创建内容快照
 */
export function createContentSnapshot(
  documentId: string,
  title: string,
  content: string,
  versionId: number,
  contentHash: string,
  parentVersionId?: number,
  parentContentHash?: string
): ContentSnapshot {
  const encoder = new TextEncoder();
  const combinedContent = `${title}\n---\n${content}`;

  return {
    documentId,
    versionId,
    contentHash,
    title,
    content,
    timestamp: Date.now(),
    contentLength: encoder.encode(combinedContent).length,
    parentVersionId,
    parentContentHash,
  };
}
