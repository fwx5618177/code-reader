// ================================
// LaTeX 文档模型
//
// 高性能 LaTeX 文档存储与编辑核心模块
// 整合 text-storage 包的 Piece Table/Rope 数据结构
//
// 特性：
// 1. 使用 Piece Table 或 Rope 作为底层文本存储（根据文件大小自动选择）
// 2. O(log n) 的插入/删除操作
// 3. 支持高效的撤销/重做（基于编辑操作历史）
// 4. 支持增量变更通知（用于增量解析）
// 5. 行号 ↔ 渲染位置映射（用于滚动同步）
// 6. Source Map 机制实现精确的源码-渲染对齐
//
// 基于行业成熟方案：
// - VS Code: Piece Table
// - Xi Editor / Lapce: Rope
// - Monaco: 分块存储 + 虚拟滚动
// ================================

import {
  createTextBuffer,
  selectBufferType,
  type ITextBuffer,
  type TextChangeSet,
  type Position,
  type TextBufferType,
} from '@code-reader/text-buffer';

// ================================
// 类型定义
// ================================

/** 文档变更事件 */
export interface DocumentChange {
  /** 变更起始位置（字符偏移量） */
  readonly from: number;
  /** 变更结束位置（原始文档中的位置） */
  readonly to: number;
  /** 插入的文本 */
  readonly insert: string;
  /** 被删除的文本 */
  readonly deleted: string;
  /** 变更前的文档长度 */
  readonly oldLength: number;
  /** 变更后的文档长度 */
  readonly newLength: number;
}

/** 编辑操作（用于撤销/重做） */
export interface EditOperation {
  /** 操作类型 */
  readonly type: 'insert' | 'delete' | 'replace';
  /** 起始位置 */
  readonly from: number;
  /** 结束位置（删除/替换时有效） */
  readonly to: number;
  /** 插入的文本 */
  readonly insertedText: string;
  /** 删除的文本 */
  readonly deletedText: string;
  /** 操作时间戳 */
  readonly timestamp: number;
  /** 是否可合并（连续输入可合并为一个操作） */
  readonly mergeable: boolean;
}

/** 编辑历史配置 */
export interface EditHistoryConfig {
  /** 最大撤销栈深度 */
  maxUndoStackSize: number;
  /** 合并间隔（毫秒，在此时间内的连续输入合并为一个操作） */
  mergeInterval: number;
}

/** Source Map 条目 - 源码位置 ↔ 渲染位置映射 */
export interface SourceMapEntry {
  /** 源码行号（从 0 开始） */
  readonly sourceLine: number;
  /** 源码起始偏移量 */
  readonly sourceOffset: number;
  /** 源码结束偏移量 */
  readonly sourceEndOffset: number;
  /** 渲染块 ID */
  readonly renderBlockId: string;
  /** 渲染块类型 */
  readonly renderBlockType: 'paragraph' | 'section' | 'math' | 'list' | 'table' | 'code' | 'other';
  /** 渲染块在渲染输出中的相对位置（0-1） */
  readonly renderPosition: number;
}

/** 行信息 */
export interface LineInfo {
  /** 行号（从 0 开始） */
  readonly line: number;
  /** 行起始偏移量 */
  readonly startOffset: number;
  /** 行结束偏移量（不含换行符） */
  readonly endOffset: number;
  /** 行内容 */
  readonly content: string;
}

/** 文档统计信息 */
export interface DocumentStats {
  /** 字符总数 */
  readonly length: number;
  /** 行数 */
  readonly lineCount: number;
  /** 单词数（估算） */
  readonly wordCount: number;
  /** 段落数（估算） */
  readonly paragraphCount: number;
  /** 数学公式数 */
  readonly mathCount: number;
  /** 章节数 */
  readonly sectionCount: number;
}

/** 文档变更监听器 */
export type DocumentChangeListener = (changes: DocumentChange[]) => void;

/** 文档配置 */
export interface LatexDocumentConfig {
  /** 初始内容 */
  initialContent?: string;
  /** 强制使用的缓冲区类型（默认自动选择） */
  bufferType?: TextBufferType;
  /** 是否启用编辑历史（撤销/重做） */
  enableHistory?: boolean;
  /** 编辑历史配置 */
  historyConfig?: Partial<EditHistoryConfig>;
  /** 是否启用 Source Map（用于滚动同步） */
  enableSourceMap?: boolean;
  /** 是否启用统计信息缓存 */
  enableStatsCache?: boolean;
}

/** 默认编辑历史配置 */
const DEFAULT_HISTORY_CONFIG: EditHistoryConfig = {
  maxUndoStackSize: 1000,
  mergeInterval: 300, // 300ms 内的连续输入合并
};

/** 默认文档配置 */
const DEFAULT_DOCUMENT_CONFIG: Required<LatexDocumentConfig> = {
  initialContent: '',
  bufferType: 'piece-table',
  enableHistory: true,
  historyConfig: DEFAULT_HISTORY_CONFIG,
  enableSourceMap: true,
  enableStatsCache: true,
};

// ================================
// LaTeX 文档模型类
// ================================

/**
 * 高性能 LaTeX 文档模型
 *
 * 核心特性：
 * 1. 使用 Piece Table 或 Rope 作为底层存储
 * 2. O(log n) 的编辑操作
 * 3. 支持撤销/重做
 * 4. 支持增量变更通知
 * 5. Source Map 机制用于滚动同步
 */
export class LatexDocument {
  /** 底层文本缓冲区 */
  private buffer: ITextBuffer;

  /** 当前使用的缓冲区类型 */
  private readonly bufferType: TextBufferType;

  /** 配置 */
  private readonly config: Required<LatexDocumentConfig>;

  /** 变更监听器 */
  private readonly changeListeners: Set<DocumentChangeListener>;

  /** 撤销栈 */
  private undoStack: EditOperation[];

  /** 重做栈 */
  private redoStack: EditOperation[];

  /** 上次编辑时间戳（用于合并连续输入） */
  private lastEditTimestamp: number;

  /** Source Map */
  private sourceMap: SourceMapEntry[];

  /** Source Map 是否有效 */
  private sourceMapValid: boolean;

  /** 统计信息缓存 */
  private statsCache: DocumentStats | null;

  /** 统计信息缓存是否有效 */
  private statsCacheValid: boolean;

  /** 版本号（每次编辑递增） */
  private version: number;

  constructor(config?: LatexDocumentConfig) {
    this.config = { ...DEFAULT_DOCUMENT_CONFIG, ...config };
    this.config.historyConfig = {
      ...DEFAULT_HISTORY_CONFIG,
      ...config?.historyConfig,
    };

    // 根据内容大小选择缓冲区类型
    const content = this.config.initialContent;
    const contentSize = new Blob([content]).size;

    if (this.config.bufferType) {
      this.bufferType = this.config.bufferType;
    } else {
      this.bufferType = selectBufferType(contentSize);
    }

    // 创建底层缓冲区
    this.buffer = this.createBuffer(content);

    // 初始化状态
    this.changeListeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.lastEditTimestamp = 0;
    this.sourceMap = [];
    this.sourceMapValid = false;
    this.statsCache = null;
    this.statsCacheValid = false;
    this.version = 0;
  }

  // ================================
  // 公共属性
  // ================================

  /** 获取文档长度 */
  get length(): number {
    return this.buffer.length;
  }

  /** 获取行数 */
  get lineCount(): number {
    return this.buffer.lineCount;
  }

  /** 获取当前版本号 */
  get currentVersion(): number {
    return this.version;
  }

  /** 获取缓冲区类型 */
  get currentBufferType(): TextBufferType {
    return this.bufferType;
  }

  /** 是否可以撤销 */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** 是否可以重做 */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ================================
  // 文本读取方法
  // ================================

  /**
   * 获取完整文本内容
   */
  getText(): string {
    return this.buffer.toString();
  }

  /**
   * 获取指定范围的文本
   */
  getTextRange(from: number, to: number): string {
    return this.buffer.slice(from, to);
  }

  /**
   * 获取指定行的文本
   */
  getLine(line: number): string {
    return this.buffer.getLine(line);
  }

  /**
   * 获取指定行的信息
   */
  getLineInfo(line: number): LineInfo | null {
    if (line < 0 || line >= this.lineCount) {
      return null;
    }

    const startOffset = this.buffer.getLineOffset(line);
    const content = this.buffer.getLine(line);
    const endOffset = startOffset + content.length;

    return {
      line,
      startOffset,
      endOffset,
      content,
    };
  }

  /**
   * 根据偏移量获取位置（行号、列号）
   */
  positionAt(offset: number): Position {
    return this.buffer.positionAt(offset);
  }

  /**
   * 根据位置获取偏移量
   */
  offsetAt(position: Position): number {
    return this.buffer.offsetAt(position);
  }

  /**
   * 获取指定行的起始偏移量
   */
  getLineOffset(line: number): number {
    return this.buffer.getLineOffset(line);
  }

  // ================================
  // 文本编辑方法
  // ================================

  /**
   * 插入文本
   * @param offset 插入位置
   * @param text 要插入的文本
   * @returns 变更信息
   */
  insert(offset: number, text: string): DocumentChange {
    if (text.length === 0) {
      return this.createEmptyChange();
    }

    const clampedOffset = Math.max(0, Math.min(offset, this.length));
    const oldLength = this.length;

    // 执行插入
    this.buffer = this.buffer.insert(clampedOffset, text);

    // 创建变更记录
    const change: DocumentChange = {
      from: clampedOffset,
      to: clampedOffset,
      insert: text,
      deleted: '',
      oldLength,
      newLength: this.length,
    };

    // 记录编辑操作（用于撤销）
    if (this.config.enableHistory) {
      this.recordOperation({
        type: 'insert',
        from: clampedOffset,
        to: clampedOffset,
        insertedText: text,
        deletedText: '',
        timestamp: Date.now(),
        mergeable: this.isMergeableInsert(text),
      });
    }

    // 通知监听器
    this.notifyChange([change]);

    // 使缓存失效
    this.invalidateCaches();

    return change;
  }

  /**
   * 删除文本
   * @param from 删除起始位置
   * @param to 删除结束位置
   * @returns 变更信息
   */
  delete(from: number, to: number): DocumentChange {
    if (from >= to) {
      return this.createEmptyChange();
    }

    const clampedFrom = Math.max(0, Math.min(from, this.length));
    const clampedTo = Math.max(clampedFrom, Math.min(to, this.length));

    if (clampedFrom === clampedTo) {
      return this.createEmptyChange();
    }

    const oldLength = this.length;
    const deletedText = this.buffer.slice(clampedFrom, clampedTo);

    // 执行删除
    this.buffer = this.buffer.delete(clampedFrom, clampedTo);

    // 创建变更记录
    const change: DocumentChange = {
      from: clampedFrom,
      to: clampedTo,
      insert: '',
      deleted: deletedText,
      oldLength,
      newLength: this.length,
    };

    // 记录编辑操作（用于撤销）
    if (this.config.enableHistory) {
      this.recordOperation({
        type: 'delete',
        from: clampedFrom,
        to: clampedTo,
        insertedText: '',
        deletedText,
        timestamp: Date.now(),
        mergeable: false,
      });
    }

    // 通知监听器
    this.notifyChange([change]);

    // 使缓存失效
    this.invalidateCaches();

    return change;
  }

  /**
   * 替换文本
   * @param from 替换起始位置
   * @param to 替换结束位置
   * @param text 替换文本
   * @returns 变更信息
   */
  replace(from: number, to: number, text: string): DocumentChange {
    const clampedFrom = Math.max(0, Math.min(from, this.length));
    const clampedTo = Math.max(clampedFrom, Math.min(to, this.length));

    const oldLength = this.length;
    const deletedText = this.buffer.slice(clampedFrom, clampedTo);

    // 如果没有实际变更，直接返回
    if (deletedText === text) {
      return this.createEmptyChange();
    }

    // 执行替换
    this.buffer = this.buffer.replace(clampedFrom, clampedTo, text);

    // 创建变更记录
    const change: DocumentChange = {
      from: clampedFrom,
      to: clampedTo,
      insert: text,
      deleted: deletedText,
      oldLength,
      newLength: this.length,
    };

    // 记录编辑操作（用于撤销）
    if (this.config.enableHistory) {
      this.recordOperation({
        type: 'replace',
        from: clampedFrom,
        to: clampedTo,
        insertedText: text,
        deletedText,
        timestamp: Date.now(),
        mergeable: false,
      });
    }

    // 通知监听器
    this.notifyChange([change]);

    // 使缓存失效
    this.invalidateCaches();

    return change;
  }

  /**
   * 批量应用变更
   * @param changes 变更列表
   * @returns 实际应用的变更列表
   */
  applyChanges(changes: TextChangeSet): DocumentChange[] {
    if (changes.changes.length === 0) {
      return [];
    }

    const oldLength = this.length;

    // 应用变更
    this.buffer = this.buffer.apply(changes);

    // 构建变更记录
    const docChanges: DocumentChange[] = changes.changes.map((change) => ({
      from: change.from,
      to: change.to,
      insert: change.insert,
      deleted: change.deleted || '',
      oldLength,
      newLength: this.length,
    }));

    // 通知监听器
    this.notifyChange(docChanges);

    // 使缓存失效
    this.invalidateCaches();

    return docChanges;
  }

  /**
   * 替换整个文档内容
   * @param content 新内容
   * @returns 变更信息
   */
  setContent(content: string): DocumentChange {
    const oldContent = this.buffer.toString();
    const oldLength = oldContent.length;

    if (oldContent === content) {
      return this.createEmptyChange();
    }

    // 重新创建缓冲区
    this.buffer = this.createBuffer(content);

    // 创建变更记录
    const change: DocumentChange = {
      from: 0,
      to: oldLength,
      insert: content,
      deleted: oldContent,
      oldLength,
      newLength: content.length,
    };

    // 记录编辑操作（用于撤销）
    if (this.config.enableHistory) {
      // 替换整个内容时清空历史（防止内存问题）
      this.undoStack = [];
      this.redoStack = [];
    }

    // 通知监听器
    this.notifyChange([change]);

    // 使缓存失效
    this.invalidateCaches();

    return change;
  }

  // ================================
  // 撤销/重做
  // ================================

  /**
   * 撤销上一次操作
   * @returns 是否成功撤销
   */
  undo(): boolean {
    if (!this.config.enableHistory || this.undoStack.length === 0) {
      return false;
    }

    const operation = this.undoStack.pop()!;

    // 执行逆操作
    if (operation.type === 'insert') {
      // 撤销插入 = 删除
      const from = operation.from;
      const to = from + operation.insertedText.length;
      this.buffer = this.buffer.delete(from, to);
    } else if (operation.type === 'delete') {
      // 撤销删除 = 插入
      this.buffer = this.buffer.insert(operation.from, operation.deletedText);
    } else {
      // 撤销替换 = 替换回原来的
      const from = operation.from;
      const to = from + operation.insertedText.length;
      this.buffer = this.buffer.replace(from, to, operation.deletedText);
    }

    // 将操作压入重做栈
    this.redoStack.push(operation);

    // 通知变更
    const change: DocumentChange = {
      from: operation.from,
      to: operation.to,
      insert: operation.deletedText,
      deleted: operation.insertedText,
      oldLength: this.length + operation.insertedText.length - operation.deletedText.length,
      newLength: this.length,
    };
    this.notifyChange([change]);

    // 使缓存失效
    this.invalidateCaches();

    return true;
  }

  /**
   * 重做上一次撤销的操作
   * @returns 是否成功重做
   */
  redo(): boolean {
    if (!this.config.enableHistory || this.redoStack.length === 0) {
      return false;
    }

    const operation = this.redoStack.pop()!;

    // 重新执行操作
    if (operation.type === 'insert') {
      this.buffer = this.buffer.insert(operation.from, operation.insertedText);
    } else if (operation.type === 'delete') {
      this.buffer = this.buffer.delete(operation.from, operation.to);
    } else {
      this.buffer = this.buffer.replace(operation.from, operation.to, operation.insertedText);
    }

    // 将操作压入撤销栈
    this.undoStack.push(operation);

    // 通知变更
    const change: DocumentChange = {
      from: operation.from,
      to: operation.to,
      insert: operation.insertedText,
      deleted: operation.deletedText,
      oldLength: this.length - operation.insertedText.length + operation.deletedText.length,
      newLength: this.length,
    };
    this.notifyChange([change]);

    // 使缓存失效
    this.invalidateCaches();

    return true;
  }

  /**
   * 清空编辑历史
   */
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastEditTimestamp = 0;
  }

  // ================================
  // Source Map（滚动同步）
  // ================================

  /**
   * 更新 Source Map
   * 通常在解析完成后调用
   */
  updateSourceMap(entries: SourceMapEntry[]): void {
    if (!this.config.enableSourceMap) {
      return;
    }

    this.sourceMap = entries;
    this.sourceMapValid = true;
  }

  /**
   * 获取 Source Map
   */
  getSourceMap(): SourceMapEntry[] {
    return this.sourceMap;
  }

  /**
   * 根据源码行号获取渲染位置
   * @param sourceLine 源码行号
   * @returns 渲染位置（0-1）
   */
  getRenderedPositionForLine(sourceLine: number): number {
    if (!this.sourceMapValid || this.sourceMap.length === 0) {
      // 无 Source Map 时使用线性映射
      return this.lineCount > 1 ? sourceLine / (this.lineCount - 1) : 0;
    }

    // 二分查找最近的条目
    let low = 0;
    let high = this.sourceMap.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.sourceMap[mid].sourceLine <= sourceLine) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const entry = this.sourceMap[low];
    if (!entry) {
      return 0;
    }

    // 在条目内部进行插值
    const nextEntry = this.sourceMap[low + 1];
    if (nextEntry && sourceLine > entry.sourceLine) {
      const lineRange = nextEntry.sourceLine - entry.sourceLine;
      const posRange = nextEntry.renderPosition - entry.renderPosition;
      const lineOffset = sourceLine - entry.sourceLine;
      return entry.renderPosition + (lineOffset / lineRange) * posRange;
    }

    return entry.renderPosition;
  }

  /**
   * 根据渲染位置获取源码行号
   * @param renderPosition 渲染位置（0-1）
   * @returns 源码行号
   */
  getSourceLineForRenderedPosition(renderPosition: number): number {
    if (!this.sourceMapValid || this.sourceMap.length === 0) {
      // 无 Source Map 时使用线性映射
      return Math.round(renderPosition * (this.lineCount - 1));
    }

    // 二分查找最近的条目
    let low = 0;
    let high = this.sourceMap.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.sourceMap[mid].renderPosition <= renderPosition) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const entry = this.sourceMap[low];
    if (!entry) {
      return 0;
    }

    // 在条目内部进行插值
    const nextEntry = this.sourceMap[low + 1];
    if (nextEntry && renderPosition > entry.renderPosition) {
      const posRange = nextEntry.renderPosition - entry.renderPosition;
      const lineRange = nextEntry.sourceLine - entry.sourceLine;
      const posOffset = renderPosition - entry.renderPosition;
      return Math.round(entry.sourceLine + (posOffset / posRange) * lineRange);
    }

    return entry.sourceLine;
  }

  /**
   * 使 Source Map 失效
   */
  invalidateSourceMap(): void {
    this.sourceMapValid = false;
  }

  // ================================
  // 统计信息
  // ================================

  /**
   * 获取文档统计信息
   */
  getStats(): DocumentStats {
    if (this.config.enableStatsCache && this.statsCacheValid && this.statsCache) {
      return this.statsCache;
    }

    const content = this.getText();

    // 计算单词数（简单估算：按空白分割）
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

    // 计算段落数（以空行分隔）
    const paragraphCount = content.split(/\n\s*\n/).filter((p) => p.trim()).length;

    // 计算数学公式数
    const inlineMathCount = (content.match(/\$[^$]+\$/g) || []).length;
    const displayMathCount = (content.match(/\$\$[\s\S]+?\$\$/g) || []).length;
    const envMathCount = (
      content.match(/\\begin\{(equation|align|gather|multline)\*?\}/g) || []
    ).length;
    const mathCount = inlineMathCount + displayMathCount + envMathCount;

    // 计算章节数
    const sectionCount = (content.match(/\\(section|subsection|chapter)\{/g) || []).length;

    const stats: DocumentStats = {
      length: content.length,
      lineCount: this.lineCount,
      wordCount,
      paragraphCount,
      mathCount,
      sectionCount,
    };

    if (this.config.enableStatsCache) {
      this.statsCache = stats;
      this.statsCacheValid = true;
    }

    return stats;
  }

  // ================================
  // 变更监听
  // ================================

  /**
   * 添加变更监听器
   * @param listener 监听器函数
   * @returns 取消监听的函数
   */
  addChangeListener(listener: DocumentChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /**
   * 移除变更监听器
   */
  removeChangeListener(listener: DocumentChangeListener): void {
    this.changeListeners.delete(listener);
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 创建文本缓冲区（统一委托 text-buffer 工厂，支持 piece-table / rope / gap-buffer）
   */
  private createBuffer(content: string): ITextBuffer {
    return createTextBuffer({ type: this.bufferType, initialContent: content, enableLineCache: true });
  }

  /**
   * 创建空变更记录
   */
  private createEmptyChange(): DocumentChange {
    return {
      from: 0,
      to: 0,
      insert: '',
      deleted: '',
      oldLength: this.length,
      newLength: this.length,
    };
  }

  /**
   * 记录编辑操作
   */
  private recordOperation(operation: EditOperation): void {
    const historyConfig = this.config.historyConfig as EditHistoryConfig;
    const now = Date.now();

    // 尝试合并连续输入
    if (
      operation.mergeable &&
      this.undoStack.length > 0 &&
      now - this.lastEditTimestamp < historyConfig.mergeInterval
    ) {
      const lastOp = this.undoStack[this.undoStack.length - 1];
      if (lastOp.mergeable && lastOp.type === 'insert') {
        // 合并插入操作
        const mergedOp: EditOperation = {
          ...lastOp,
          insertedText: lastOp.insertedText + operation.insertedText,
          timestamp: now,
        };
        this.undoStack[this.undoStack.length - 1] = mergedOp;
        this.lastEditTimestamp = now;
        return;
      }
    }

    // 压入新操作
    this.undoStack.push(operation);
    this.lastEditTimestamp = now;

    // 清空重做栈
    this.redoStack = [];

    // 限制栈大小
    while (this.undoStack.length > historyConfig.maxUndoStackSize) {
      this.undoStack.shift();
    }

    // 递增版本号
    this.version++;
  }

  /**
   * 判断插入是否可合并（单字符输入）
   */
  private isMergeableInsert(text: string): boolean {
    // 只有单字符输入可合并，且不是换行
    return text.length === 1 && text !== '\n' && text !== '\r';
  }

  /**
   * 通知变更监听器
   */
  private notifyChange(changes: DocumentChange[]): void {
    for (const listener of this.changeListeners) {
      try {
        listener(changes);
      } catch (error) {
        console.error('[LatexDocument] 变更监听器错误:', error);
      }
    }
  }

  /**
   * 使所有缓存失效
   */
  private invalidateCaches(): void {
    this.sourceMapValid = false;
    this.statsCacheValid = false;
    this.version++;
  }

  // ================================
  // 销毁
  // ================================

  /**
   * 销毁文档（释放资源）
   */
  destroy(): void {
    this.changeListeners.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.sourceMap = [];
    this.statsCache = null;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 LaTeX 文档实例
 */
export function createLatexDocument(config?: LatexDocumentConfig): LatexDocument {
  return new LatexDocument(config);
}

/**
 * 根据内容大小自动选择最佳存储策略创建文档
 */
export function createAutoLatexDocument(content: string = ''): LatexDocument {
  const contentSize = new Blob([content]).size;
  const bufferType = selectBufferType(contentSize);

  return new LatexDocument({
    initialContent: content,
    bufferType,
    enableHistory: true,
    enableSourceMap: true,
    enableStatsCache: true,
  });
}

/**
 * 为大文件创建优化的文档实例
 */
export function createLargeFileLatexDocument(content: string): LatexDocument {
  return new LatexDocument({
    initialContent: content,
    bufferType: 'rope', // 大文件使用 Rope
    enableHistory: true,
    enableSourceMap: true,
    enableStatsCache: true,
    historyConfig: {
      maxUndoStackSize: 500, // 减少历史栈以节省内存
      mergeInterval: 500,
    },
  });
}

// ================================
// 默认导出
// ================================

export default {
  LatexDocument,
  createLatexDocument,
  createAutoLatexDocument,
  createLargeFileLatexDocument,
};
