// ================================
// 高性能流式解析引擎
// 使用帧预算、Web Worker 和增量处理解决大文件 OOM 问题
// ================================

import type { LatexNode, RootNode, DocumentNode, PreambleNode, ParagraphNode } from './types';
import { getMemoryMonitor, MemoryPressure } from './chunk-pool';

// ================================
// 类型定义
// ================================

/**
 * 解析块类型
 */
export type ParseChunkType =
  | 'preamble'
  | 'section'
  | 'paragraph'
  | 'math-block'
  | 'environment'
  | 'list'
  | 'table'
  | 'code'
  | 'comment'
  | 'text';

/**
 * 解析块状态
 */
export type ParseChunkStatus = 'pending' | 'parsing' | 'parsed' | 'error';

/**
 * 解析块
 */
export interface ParseChunk {
  /** 块 ID */
  id: string;
  /** 块类型 */
  type: ParseChunkType;
  /** 源码起始偏移 */
  startOffset: number;
  /** 源码结束偏移 */
  endOffset: number;
  /** 源码起始行号（1-based） */
  startLine: number;
  /** 源码结束行号（1-based） */
  endLine: number;
  /** 块内容引用（不复制内容，只存储偏移） */
  contentRef: {
    start: number;
    end: number;
  };
  /** 块哈希（用于增量判断） */
  hash: string;
  /** 解析状态 */
  status: ParseChunkStatus;
  /** 解析后的 AST 节点 */
  ast: LatexNode | null;
  /** 是否可见（在视口内） */
  visible: boolean;
  /** 优先级（0 最高） */
  priority: number;
  /** 深度（嵌套层级） */
  depth: number;
  /** 是否脏（需要重新解析） */
  dirty: boolean;
  /** 解析错误 */
  error?: string;
}

/**
 * 帧预算配置
 */
export interface FrameBudgetConfig {
  /** 每帧最大处理时间（毫秒） */
  maxFrameTime: number;
  /** 空闲时间阈值（毫秒） */
  idleThreshold: number;
  /** 是否使用 requestIdleCallback */
  useIdleCallback: boolean;
}

/**
 * 解析任务
 */
export interface ParseTask {
  /** 任务 ID */
  id: string;
  /** 块 ID */
  chunkId: string;
  /** 优先级 */
  priority: number;
  /** 创建时间 */
  createdAt: number;
  /** 取消标志 */
  cancelled: boolean;
}

/**
 * 流式解析结果
 */
export interface StreamingParseResult {
  /** 根节点 */
  ast: RootNode;
  /** 所有块 */
  chunks: ParseChunk[];
  /** 已解析块数 */
  parsedCount: number;
  /** 总块数 */
  totalCount: number;
  /** 解析耗时 */
  parseTime: number;
  /** 是否完成 */
  complete: boolean;
}

/**
 * 增量变更
 */
export interface IncrementalChange {
  /** 变更起始偏移 */
  from: number;
  /** 变更结束偏移 */
  to: number;
  /** 插入的文本 */
  insert: string;
  /** 删除的文本 */
  deleted: string;
}

/**
 * 引擎配置
 */
export interface StreamingEngineConfig {
  /** 最小块大小（字节） */
  minChunkSize: number;
  /** 最大块大小（字节） */
  maxChunkSize: number;
  /** 帧预算配置 */
  frameBudget: FrameBudgetConfig;
  /** 最大并发解析任务数 */
  maxConcurrentTasks: number;
  /** 是否启用 Worker */
  useWorker: boolean;
  /** 可见区域额外解析行数 */
  visibilityPadding: number;
  /** 内存压力响应策略 */
  memoryStrategy: 'aggressive' | 'normal' | 'conservative';
}

// ================================
// 常量
// ================================

const DEFAULT_CONFIG: StreamingEngineConfig = {
  minChunkSize: 512,
  maxChunkSize: 32 * 1024, // 32KB
  frameBudget: {
    maxFrameTime: 8, // 8ms，保证 60fps
    idleThreshold: 50,
    useIdleCallback: true,
  },
  maxConcurrentTasks: 4,
  useWorker: true,
  visibilityPadding: 50, // 可见区域上下各多解析 50 行
  memoryStrategy: 'normal',
};

// 块边界检测正则（编译一次复用）
const SECTION_REGEX = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[{\[]/;
const ENVIRONMENT_BEGIN_REGEX = /\\begin\{([^}]+)\}/;
const MATH_BLOCK_START_REGEX = /(\$\$|\\[[])/;
const DOCUMENT_BEGIN_REGEX = /\\begin\{document\}/;
const DOCUMENT_END_REGEX = /\\end\{document\}/;

// 优先级常量
const PRIORITY = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
  BACKGROUND: 4,
} as const;

// ================================
// 工具函数
// ================================

let chunkIdCounter = 0;

/**
 * 生成块 ID
 */
function generateChunkId(): string {
  return `chunk_${++chunkIdCounter}_${Date.now().toString(36)}`;
}

/**
 * 快速哈希函数（FNV-1a 变体）
 */
function fastHash(str: string): string {
  let hash = 2166136261;
  const len = str.length;
  // 采样哈希，避免处理过长字符串
  const step = Math.max(1, Math.floor(len / 1000));
  for (let i = 0; i < len; i += step) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 计算每行起始偏移（行数即数组长度）
 */
function computeLineOffsets(content: string): number[] {
  const offsets: number[] = [0];
  const len = content.length;
  for (let i = 0; i < len; i++) {
    if (content.charCodeAt(i) === 10) { // '\n'
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * 从偏移获取行号（二分查找）
 */
function getLineFromOffset(offset: number, lineOffsets: number[]): number {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineOffsets[mid] > offset) {
      high = mid - 1;
    } else {
      low = mid;
    }
  }
  return low + 1; // 转为 1-based
}

/**
 * 检测块类型
 */
function detectChunkType(content: string, startOffset: number): ParseChunkType {
  const trimmed = content.trimStart();

  // 检测章节
  if (SECTION_REGEX.test(trimmed)) {
    return 'section';
  }

  // 检测数学块
  if (MATH_BLOCK_START_REGEX.test(trimmed) || trimmed.startsWith('\\begin{equation') ||
      trimmed.startsWith('\\begin{align') || trimmed.startsWith('\\begin{gather')) {
    return 'math-block';
  }

  // 检测列表环境
  if (trimmed.startsWith('\\begin{itemize}') || trimmed.startsWith('\\begin{enumerate}') ||
      trimmed.startsWith('\\begin{description}')) {
    return 'list';
  }

  // 检测表格环境
  if (trimmed.startsWith('\\begin{table}') || trimmed.startsWith('\\begin{tabular}')) {
    return 'table';
  }

  // 检测代码环境
  if (trimmed.startsWith('\\begin{verbatim}') || trimmed.startsWith('\\begin{lstlisting}') ||
      trimmed.startsWith('\\begin{minted}')) {
    return 'code';
  }

  // 检测注释
  if (trimmed.startsWith('%')) {
    return 'comment';
  }

  // 检测其他环境
  if (ENVIRONMENT_BEGIN_REGEX.test(trimmed)) {
    return 'environment';
  }

  // 检测前言
  if (startOffset === 0 || trimmed.startsWith('\\documentclass')) {
    return 'preamble';
  }

  // 默认为段落
  if (trimmed.length > 0) {
    return 'paragraph';
  }

  return 'text';
}

/**
 * 计算块优先级
 */
function computeChunkPriority(type: ParseChunkType, visible: boolean, depth: number): number {
  const typePriority: Record<ParseChunkType, number> = {
    'preamble': PRIORITY.CRITICAL,
    'section': PRIORITY.HIGH,
    'math-block': PRIORITY.HIGH,
    'list': PRIORITY.NORMAL,
    'table': PRIORITY.NORMAL,
    'environment': PRIORITY.NORMAL,
    'paragraph': PRIORITY.NORMAL,
    'code': PRIORITY.LOW,
    'comment': PRIORITY.BACKGROUND,
    'text': PRIORITY.LOW,
  };

  let priority = typePriority[type] ?? PRIORITY.NORMAL;

  // 可见块优先级提高
  if (visible) {
    priority = Math.max(0, priority - 2);
  }

  // 深层嵌套优先级降低
  priority += Math.min(2, depth);

  return priority;
}

// ================================
// 帧预算调度器
// ================================

/**
 * 帧预算管理器
 * 确保解析不阻塞主线程
 */
class FrameBudgetScheduler {
  private config: FrameBudgetConfig;
  private frameStartTime = 0;
  private idleCallbackId: number | null = null;
  private rafId: number | null = null;

  constructor(config: FrameBudgetConfig) {
    this.config = config;
  }

  /**
   * 开始新帧
   */
  startFrame(): void {
    this.frameStartTime = performance.now();
  }

  /**
   * 检查是否还有时间预算
   */
  hasTimeBudget(): boolean {
    const elapsed = performance.now() - this.frameStartTime;
    return elapsed < this.config.maxFrameTime;
  }

  /**
   * 获取剩余时间预算
   */
  getRemainingBudget(): number {
    return Math.max(0, this.config.maxFrameTime - (performance.now() - this.frameStartTime));
  }

  /**
   * 调度到下一帧
   */
  scheduleNextFrame(callback: () => void): void {
    if (this.config.useIdleCallback && typeof requestIdleCallback !== 'undefined') {
      this.idleCallbackId = requestIdleCallback(
        (deadline) => {
          if (!deadline.didTimeout && deadline.timeRemaining() >= this.config.idleThreshold) {
            callback();
          } else {
            // 时间不足，延迟到下一个空闲期
            this.scheduleNextFrame(callback);
          }
        },
        { timeout: 100 } // 最多等待 100ms
      );
    } else {
      this.rafId = requestAnimationFrame(() => {
        callback();
      });
    }
  }

  /**
   * 让出主线程
   */
  async yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      // 使用 setTimeout(0) 让出主线程
      setTimeout(resolve, 0);
    });
  }

  /**
   * 取消调度
   */
  cancel(): void {
    if (this.idleCallbackId !== null) {
      if (typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(this.idleCallbackId);
      }
      this.idleCallbackId = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<FrameBudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ================================
// 块边界检测器
// ================================

/**
 * 块边界信息
 */
interface ChunkBoundary {
  offset: number;
  line: number;
  type: 'section' | 'environment-start' | 'environment-end' | 'paragraph' | 'document-start' | 'document-end';
  priority: number;
  envName?: string;
}

/**
 * 高效块边界检测器
 * 使用状态机和单次遍历检测所有边界
 */
class ChunkBoundaryDetector {
  private content: string = '';
  private lineOffsets: number[] = [];

  setContent(content: string, lineOffsets: number[]): void {
    this.content = content;
    this.lineOffsets = lineOffsets;
  }

  /**
   * 检测所有块边界
   */
  detectBoundaries(): ChunkBoundary[] {
    const boundaries: ChunkBoundary[] = [];
    const len = this.content.length;
    let i = 0;
    let lastBoundary = 0;

    // 添加文档开始边界
    boundaries.push({
      offset: 0,
      line: 1,
      type: 'document-start',
      priority: PRIORITY.CRITICAL,
    });

    while (i < len) {
      const char = this.content.charCodeAt(i);

      // 检测反斜杠开头的命令
      if (char === 92) { // '\'
        const cmdStart = i;
        i++;

        // 读取命令名
        let cmdEnd = i;
        while (cmdEnd < len) {
          const c = this.content.charCodeAt(cmdEnd);
          // 字母 a-z, A-Z
          if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) {
            cmdEnd++;
          } else {
            break;
          }
        }

        if (cmdEnd > i) {
          const cmd = this.content.slice(i, cmdEnd);

          // 检测章节命令
          if (['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'].includes(cmd)) {
            boundaries.push({
              offset: cmdStart,
              line: getLineFromOffset(cmdStart, this.lineOffsets),
              type: 'section',
              priority: PRIORITY.HIGH,
            });
            lastBoundary = cmdStart;
          }

          // 检测 \begin
          if (cmd === 'begin') {
            const envMatch = this.content.slice(cmdEnd).match(/^\{([^}]+)\}/);
            if (envMatch) {
              const envName = envMatch[1];
              boundaries.push({
                offset: cmdStart,
                line: getLineFromOffset(cmdStart, this.lineOffsets),
                type: envName === 'document' ? 'document-start' : 'environment-start',
                priority: envName === 'document' ? PRIORITY.CRITICAL : PRIORITY.NORMAL,
                envName,
              });
              lastBoundary = cmdStart;
            }
          }

          // 检测 \end
          if (cmd === 'end') {
            const envMatch = this.content.slice(cmdEnd).match(/^\{([^}]+)\}/);
            if (envMatch) {
              const envName = envMatch[1];
              const endPos = cmdEnd + envMatch[0].length;
              boundaries.push({
                offset: endPos,
                line: getLineFromOffset(endPos, this.lineOffsets),
                type: envName === 'document' ? 'document-end' : 'environment-end',
                priority: PRIORITY.NORMAL,
                envName,
              });
              lastBoundary = endPos;
            }
          }

          i = cmdEnd;
          continue;
        }
      }

      // 检测段落分隔（连续两个换行）
      if (char === 10) { // '\n'
        let j = i + 1;
        // 跳过空白
        while (j < len) {
          const c = this.content.charCodeAt(j);
          if (c === 32 || c === 9 || c === 13) { // 空格、制表符、回车
            j++;
          } else {
            break;
          }
        }
        if (j < len && this.content.charCodeAt(j) === 10) {
          // 双换行，段落边界
          const boundaryOffset = j + 1;
          if (boundaryOffset > lastBoundary + 100) { // 避免过于密集的边界
            boundaries.push({
              offset: boundaryOffset,
              line: getLineFromOffset(boundaryOffset, this.lineOffsets),
              type: 'paragraph',
              priority: PRIORITY.LOW,
            });
            lastBoundary = boundaryOffset;
          }
          i = j + 1;
          continue;
        }
      }

      i++;
    }

    // 添加文档结束边界
    boundaries.push({
      offset: len,
      line: getLineFromOffset(len, this.lineOffsets),
      type: 'document-end',
      priority: PRIORITY.LOW,
    });

    return boundaries;
  }
}

// ================================
// 流式解析引擎
// ================================

/**
 * 高性能流式解析引擎
 */
export class StreamingEngine {
  private config: StreamingEngineConfig;
  private scheduler: FrameBudgetScheduler;
  private boundaryDetector: ChunkBoundaryDetector;

  // 文档状态
  private content: string = '';
  private lineOffsets: number[] = [];
  private chunks: Map<string, ParseChunk> = new Map();
  private chunkOrder: string[] = [];

  // 可见区域
  private visibleRange: { startLine: number; endLine: number } = { startLine: 1, endLine: 100 };

  // 解析队列
  private parseQueue: ParseTask[] = [];
  private activeTasks: Set<string> = new Set();
  private parseCancelled: boolean = false;

  // 缓存的 AST
  private cachedRoot: RootNode | null = null;

  // 统计
  private stats = {
    parseCount: 0,
    cacheHits: 0,
    totalParseTime: 0,
    chunkParseTime: new Map<string, number>(),
  };

  // 版本号（用于增量更新）
  private version: number = 0;

  constructor(config: Partial<StreamingEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scheduler = new FrameBudgetScheduler(this.config.frameBudget);
    this.boundaryDetector = new ChunkBoundaryDetector();

    // 监听内存压力
    const monitor = getMemoryMonitor();
    monitor.onPressureChange((pressure) => {
      this.handleMemoryPressure(pressure);
    });
    monitor.start();
  }

  /**
   * 初始化引擎（设置文档内容）
   */
  async initialize(content: string): Promise<StreamingParseResult> {
    const startTime = performance.now();

    // 重置状态
    this.reset();

    // 存储内容（不复制，使用引用）
    this.content = content;

    // 计算行信息
    this.lineOffsets = computeLineOffsets(content);

    // 设置边界检测器
    this.boundaryDetector.setContent(content, this.lineOffsets);

    // 检测块边界
    const boundaries = this.boundaryDetector.detectBoundaries();

    // 从边界创建块
    this.createChunksFromBoundaries(boundaries);

    // 合并过小的块
    this.mergeSmallChunks();

    // 更新可见性
    this.updateVisibility();

    // 构建初始 AST（仅结构，不解析内容）
    this.cachedRoot = this.buildSkeletonAST();

    // 开始增量解析可见块
    this.startIncrementalParsing();

    const parseTime = performance.now() - startTime;
    this.version++;

    return {
      ast: this.cachedRoot,
      chunks: Array.from(this.chunks.values()),
      parsedCount: 0,
      totalCount: this.chunks.size,
      parseTime,
      complete: false,
    };
  }

  /**
   * 应用增量变更
   */
  async applyChanges(changes: IncrementalChange[]): Promise<StreamingParseResult> {
    const startTime = performance.now();

    if (changes.length === 0) {
      return this.getCurrentResult(startTime);
    }

    // 按位置排序（从后往前应用）
    const sortedChanges = [...changes].sort((a, b) => b.from - a.from);

    // 应用变更到内容
    let newContent = this.content;
    for (const change of sortedChanges) {
      newContent =
        newContent.slice(0, change.from) +
        change.insert +
        newContent.slice(change.to);
    }

    // 计算受影响范围
    const affectedRange = this.computeAffectedRange(changes);

    // 检查是否需要完全重新分块
    const needFullRechunk = this.shouldFullRechunk(changes, newContent);

    if (needFullRechunk) {
      // 完全重新初始化
      return this.initialize(newContent);
    }

    // 增量更新
    this.content = newContent;

    // 重新计算行信息
    this.lineOffsets = computeLineOffsets(newContent);

    // 更新边界检测器
    this.boundaryDetector.setContent(newContent, this.lineOffsets);

    // 找出受影响的块
    const affectedChunkIds = this.findAffectedChunks(affectedRange);

    // 标记受影响块为脏
    for (const chunkId of affectedChunkIds) {
      const chunk = this.chunks.get(chunkId);
      if (chunk) {
        chunk.dirty = true;
        chunk.status = 'pending';
        chunk.ast = null;
      }
    }

    // 更新块偏移（变更点之后的块）
    this.updateChunkOffsets(changes);

    // 更新可见性
    this.updateVisibility();

    // 重新开始解析
    this.startIncrementalParsing();

    this.version++;

    return this.getCurrentResult(startTime);
  }

  /**
   * 设置可见区域
   */
  setVisibleRange(startLine: number, endLine: number): void {
    const padding = this.config.visibilityPadding;
    this.visibleRange = {
      startLine: Math.max(1, startLine - padding),
      endLine: endLine + padding,
    };

    // 更新块可见性
    this.updateVisibility();

    // 重新排序解析队列
    this.reorderParseQueue();
  }

  /**
   * 获取块
   */
  getChunk(id: string): ParseChunk | undefined {
    return this.chunks.get(id);
  }

  /**
   * 获取所有块
   */
  getAllChunks(): ParseChunk[] {
    return this.chunkOrder.map((id) => this.chunks.get(id)!).filter(Boolean);
  }

  /**
   * 获取可见块
   */
  getVisibleChunks(): ParseChunk[] {
    return this.getAllChunks().filter((chunk) => chunk.visible);
  }

  /**
   * 获取脏块（需要重新解析）
   */
  getDirtyChunks(): ParseChunk[] {
    return this.getAllChunks().filter((chunk) => chunk.dirty);
  }

  /**
   * 获取当前 AST
   */
  getAST(): RootNode | null {
    return this.cachedRoot;
  }

  /**
   * 获取块内容（延迟获取，避免复制）
   */
  getChunkContent(chunk: ParseChunk): string {
    return this.content.slice(chunk.contentRef.start, chunk.contentRef.end);
  }

  /**
   * 取消解析
   */
  cancelParsing(): void {
    this.parseCancelled = true;
    this.scheduler.cancel();
    this.parseQueue = [];
    this.activeTasks.clear();
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.cancelParsing();
    this.reset();
    getMemoryMonitor().stop();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    chunkCount: number;
    parsedCount: number;
    pendingCount: number;
    visibleCount: number;
    parseTime: number;
    cacheHitRate: number;
    memoryUsage: number;
  } {
    const chunks = this.getAllChunks();
    const parsedCount = chunks.filter((c) => c.status === 'parsed').length;
    const pendingCount = chunks.filter((c) => c.status === 'pending').length;
    const visibleCount = chunks.filter((c) => c.visible).length;
    const totalOps = this.stats.parseCount + this.stats.cacheHits;

    return {
      chunkCount: chunks.length,
      parsedCount,
      pendingCount,
      visibleCount,
      parseTime: this.stats.totalParseTime,
      cacheHitRate: totalOps > 0 ? this.stats.cacheHits / totalOps : 0,
      memoryUsage: getMemoryMonitor().getMemoryUsage(),
    };
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 重置状态
   */
  private reset(): void {
    this.cancelParsing();
    this.content = '';
    this.lineOffsets = [];
    this.chunks.clear();
    this.chunkOrder = [];
    this.cachedRoot = null;
    this.stats = {
      parseCount: 0,
      cacheHits: 0,
      totalParseTime: 0,
      chunkParseTime: new Map(),
    };
  }

  /**
   * 从边界创建块
   */
  private createChunksFromBoundaries(boundaries: ChunkBoundary[]): void {
    const contentLength = this.content.length;
    if (contentLength === 0 || boundaries.length < 2) return;

    // 过滤并排序边界
    const sortedBoundaries = boundaries
      .filter((b) => b.offset >= 0 && b.offset <= contentLength)
      .sort((a, b) => a.offset - b.offset);

    // 在边界之间创建块
    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
      const start = sortedBoundaries[i];
      const end = sortedBoundaries[i + 1];

      if (end.offset <= start.offset) continue;

      const chunkContent = this.content.slice(start.offset, end.offset);
      if (!chunkContent.trim()) continue;

      const id = generateChunkId();
      const type = detectChunkType(chunkContent, start.offset);
      const priority = computeChunkPriority(type, false, 0);

      const chunk: ParseChunk = {
        id,
        type,
        startOffset: start.offset,
        endOffset: end.offset,
        startLine: start.line,
        endLine: getLineFromOffset(end.offset, this.lineOffsets),
        contentRef: { start: start.offset, end: end.offset },
        hash: fastHash(chunkContent),
        status: 'pending',
        ast: null,
        visible: false,
        priority,
        depth: 0,
        dirty: true,
      };

      this.chunks.set(id, chunk);
      this.chunkOrder.push(id);
    }
  }

  /**
   * 合并过小的块
   */
  private mergeSmallChunks(): void {
    const minSize = this.config.minChunkSize;
    const maxSize = this.config.maxChunkSize;
    const merged: string[] = [];
    let current: ParseChunk | null = null;

    for (const id of this.chunkOrder) {
      const chunk = this.chunks.get(id)!;

      if (current === null) {
        current = chunk;
        merged.push(id);
        continue;
      }

      const currentSize = current.endOffset - current.startOffset;
      const mergedSize = (chunk.endOffset - current.startOffset);

      // 如果当前块太小且合并后不超过最大大小，则合并
      if (currentSize < minSize && mergedSize <= maxSize) {
        // 更新当前块
        current.endOffset = chunk.endOffset;
        current.endLine = chunk.endLine;
        current.contentRef.end = chunk.contentRef.end;
        current.hash = fastHash(this.content.slice(current.startOffset, current.endOffset));

        // 删除被合并的块
        this.chunks.delete(id);
      } else {
        current = chunk;
        merged.push(id);
      }
    }

    this.chunkOrder = merged;
  }

  /**
   * 更新块可见性
   */
  private updateVisibility(): void {
    const { startLine, endLine } = this.visibleRange;

    for (const chunk of this.chunks.values()) {
      const wasVisible = chunk.visible;
      chunk.visible =
        chunk.startLine <= endLine && chunk.endLine >= startLine;

      // 如果变为可见，提高优先级
      if (!wasVisible && chunk.visible) {
        chunk.priority = computeChunkPriority(chunk.type, true, chunk.depth);
      }
    }
  }

  /**
   * 构建骨架 AST（仅结构，不解析内容）
   */
  private buildSkeletonAST(): RootNode {
    // 找到前言块
    let preambleNode: PreambleNode | null = null;
    const documentChildren: LatexNode[] = [];

    for (const id of this.chunkOrder) {
      const chunk = this.chunks.get(id)!;

      if (chunk.type === 'preamble' && !preambleNode) {
        preambleNode = {
          type: 'preamble',
          id: `preamble_${chunk.id}`,
          start: chunk.startOffset,
          end: chunk.endOffset,
          raw: '',
          hash: chunk.hash,
          packages: [],
          commands: [],
          environments: [],
        };
      } else {
        // 创建占位节点
        const placeholder: ParagraphNode = {
          type: 'paragraph',
          id: `placeholder_${chunk.id}`,
          start: chunk.startOffset,
          end: chunk.endOffset,
          raw: '',
          hash: chunk.hash,
          children: [],
        };
        documentChildren.push(placeholder);
      }
    }

    const documentNode: DocumentNode = {
      type: 'document',
      id: `document_${this.version}`,
      start: preambleNode ? preambleNode.end : 0,
      end: this.content.length,
      raw: '',
      hash: fastHash('document'),
      children: documentChildren,
    };

    return {
      type: 'root',
      id: `root_${this.version}`,
      start: 0,
      end: this.content.length,
      raw: '',
      hash: fastHash(this.version.toString()),
      preamble: preambleNode,
      document: documentNode,
      documentClass: null,
      version: this.version,
    };
  }

  /**
   * 开始增量解析
   */
  private startIncrementalParsing(): void {
    this.parseCancelled = false;

    // 构建解析队列
    this.buildParseQueue();

    // 开始处理
    this.processParseQueue();
  }

  /**
   * 构建解析队列
   */
  private buildParseQueue(): void {
    this.parseQueue = [];

    // 收集需要解析的块
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty && chunk.status === 'pending') {
        this.parseQueue.push({
          id: generateChunkId(),
          chunkId: chunk.id,
          priority: chunk.priority,
          createdAt: Date.now(),
          cancelled: false,
        });
      }
    }

    // 按优先级排序
    this.reorderParseQueue();
  }

  /**
   * 重新排序解析队列
   */
  private reorderParseQueue(): void {
    this.parseQueue.sort((a, b) => {
      const chunkA = this.chunks.get(a.chunkId);
      const chunkB = this.chunks.get(b.chunkId);
      if (!chunkA || !chunkB) return 0;

      // 可见优先
      if (chunkA.visible !== chunkB.visible) {
        return chunkA.visible ? -1 : 1;
      }

      // 优先级
      if (chunkA.priority !== chunkB.priority) {
        return chunkA.priority - chunkB.priority;
      }

      // 位置优先（靠前的先解析）
      return chunkA.startOffset - chunkB.startOffset;
    });
  }

  /**
   * 处理解析队列
   */
  private processParseQueue(): void {
    if (this.parseCancelled) return;
    if (this.parseQueue.length === 0) return;

    this.scheduler.startFrame();

    const processNext = async (): Promise<void> => {
      // 检查是否取消
      if (this.parseCancelled) return;

      // 检查帧预算
      if (!this.scheduler.hasTimeBudget()) {
        // 让出主线程，下一帧继续
        this.scheduler.scheduleNextFrame(() => {
          this.processParseQueue();
        });
        return;
      }

      // 检查并发限制
      if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
        await this.scheduler.yieldToMain();
        this.scheduler.scheduleNextFrame(() => {
          this.processParseQueue();
        });
        return;
      }

      // 获取下一个任务
      const task = this.parseQueue.shift();
      if (!task || task.cancelled) {
        if (this.parseQueue.length > 0) {
          processNext();
        }
        return;
      }

      // 执行解析
      this.activeTasks.add(task.id);

      try {
        await this.parseChunk(task.chunkId);
      } catch (error) {
        const chunk = this.chunks.get(task.chunkId);
        if (chunk) {
          chunk.status = 'error';
          chunk.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        this.activeTasks.delete(task.id);
      }

      // 继续处理
      if (this.parseQueue.length > 0) {
        processNext();
      }
    };

    processNext();
  }

  /**
   * 解析单个块
   */
  private async parseChunk(chunkId: string): Promise<void> {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return;

    const startTime = performance.now();
    chunk.status = 'parsing';

    try {
      const content = this.getChunkContent(chunk);

      // 这里使用简化的解析（实际应该调用真正的解析器）
      // 在生产环境中，这里应该调用 Lezer 或 Tree-sitter 解析器
      const ast = this.simpleParseContent(content, chunk);

      chunk.ast = ast;
      chunk.status = 'parsed';
      chunk.dirty = false;

      // 更新缓存的 AST
      this.updateCachedAST(chunk);

      const parseTime = performance.now() - startTime;
      this.stats.parseCount++;
      this.stats.totalParseTime += parseTime;
      this.stats.chunkParseTime.set(chunkId, parseTime);
    } catch (error) {
      chunk.status = 'error';
      chunk.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 简化的内容解析（占位实现）
   */
  private simpleParseContent(content: string, chunk: ParseChunk): LatexNode {
    // 这是一个简化的解析实现
    // 实际应该使用 Lezer 或 Tree-sitter 解析器
    return {
      type: chunk.type === 'math-block' ? 'math_block' : 'paragraph',
      id: `node_${chunk.id}`,
      start: chunk.startOffset,
      end: chunk.endOffset,
      raw: content.slice(0, 200), // 只存储前 200 个字符
      hash: chunk.hash,
      children: [],
    } as unknown as LatexNode;
  }

  /**
   * 更新缓存的 AST
   */
  private updateCachedAST(chunk: ParseChunk): void {
    if (!this.cachedRoot || !this.cachedRoot.document) return;

    // 找到对应的占位节点并替换
    const children = this.cachedRoot.document.children;
    const index = children.findIndex((child) =>
      child.id === `placeholder_${chunk.id}` ||
      child.id === `node_${chunk.id}`
    );

    if (index !== -1 && chunk.ast) {
      children[index] = chunk.ast;
    }
  }

  /**
   * 计算受影响范围
   */
  private computeAffectedRange(changes: IncrementalChange[]): { from: number; to: number } {
    let from = Infinity;
    let to = -Infinity;

    for (const change of changes) {
      from = Math.min(from, change.from);
      to = Math.max(to, Math.max(change.to, change.from + change.insert.length));
    }

    return { from, to };
  }

  /**
   * 判断是否需要完全重新分块
   */
  private shouldFullRechunk(changes: IncrementalChange[], newContent: string): boolean {
    // 如果变更影响超过 30% 的内容，完全重新分块
    let totalChange = 0;
    for (const change of changes) {
      totalChange += Math.abs(change.insert.length - (change.to - change.from));
    }

    if (totalChange > newContent.length * 0.3) {
      return true;
    }

    // 如果涉及结构性变更（如 \begin{document}），完全重新分块
    for (const change of changes) {
      const affected = this.content.slice(
        Math.max(0, change.from - 50),
        Math.min(this.content.length, change.to + 50)
      );
      if (DOCUMENT_BEGIN_REGEX.test(affected) || DOCUMENT_END_REGEX.test(affected)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 找出受影响的块
   */
  private findAffectedChunks(range: { from: number; to: number }): string[] {
    const affected: string[] = [];

    for (const chunk of this.chunks.values()) {
      // 如果块与变更范围有交集
      if (chunk.startOffset <= range.to && chunk.endOffset >= range.from) {
        affected.push(chunk.id);
      }
    }

    return affected;
  }

  /**
   * 更新块偏移
   */
  private updateChunkOffsets(changes: IncrementalChange[]): void {
    // 计算偏移变化量
    let delta = 0;
    for (const change of changes) {
      delta += change.insert.length - (change.to - change.from);
    }

    if (delta === 0) return;

    // 找到最早的变更位置
    const earliestChange = Math.min(...changes.map((c) => c.from));

    // 更新变更点之后的所有块
    for (const chunk of this.chunks.values()) {
      if (chunk.startOffset >= earliestChange) {
        chunk.startOffset += delta;
        chunk.endOffset += delta;
        chunk.contentRef.start += delta;
        chunk.contentRef.end += delta;
        chunk.startLine = getLineFromOffset(chunk.startOffset, this.lineOffsets);
        chunk.endLine = getLineFromOffset(chunk.endOffset, this.lineOffsets);
      } else if (chunk.endOffset > earliestChange) {
        // 块跨越变更点
        chunk.endOffset += delta;
        chunk.contentRef.end += delta;
        chunk.endLine = getLineFromOffset(chunk.endOffset, this.lineOffsets);
        chunk.dirty = true;
        chunk.status = 'pending';
      }
    }
  }

  /**
   * 处理内存压力
   */
  private handleMemoryPressure(pressure: MemoryPressure): void {
    switch (pressure) {
      case MemoryPressure.CRITICAL:
        // 紧急：释放所有非可见块的 AST
        for (const chunk of this.chunks.values()) {
          if (!chunk.visible && chunk.ast) {
            chunk.ast = null;
            chunk.dirty = true;
            chunk.status = 'pending';
          }
        }
        // 触发 GC
        getMemoryMonitor().triggerGC();
        break;

      case MemoryPressure.HIGH:
        // 高压：减少并发任务
        this.config.maxConcurrentTasks = Math.max(1, this.config.maxConcurrentTasks - 1);
        break;

      case MemoryPressure.MEDIUM:
        // 中压：恢复正常
        this.config.maxConcurrentTasks = DEFAULT_CONFIG.maxConcurrentTasks;
        break;

      case MemoryPressure.LOW:
        // 低压：可以更激进
        break;
    }
  }

  /**
   * 获取当前结果
   */
  private getCurrentResult(startTime: number): StreamingParseResult {
    const chunks = this.getAllChunks();
    const parsedCount = chunks.filter((c) => c.status === 'parsed').length;

    return {
      ast: this.cachedRoot!,
      chunks,
      parsedCount,
      totalCount: chunks.length,
      parseTime: performance.now() - startTime,
      complete: parsedCount === chunks.length,
    };
  }
}

// ================================
// 导出
// ================================

/**
 * 创建流式解析引擎
 */
export function createStreamingEngine(
  config?: Partial<StreamingEngineConfig>
): StreamingEngine {
  return new StreamingEngine(config);
}

/**
 * 创建高性能流式解析引擎（大文件优化）
 */
export function createHighPerformanceEngine(): StreamingEngine {
  return new StreamingEngine({
    minChunkSize: 256,
    maxChunkSize: 16 * 1024, // 16KB 更小的块
    frameBudget: {
      maxFrameTime: 4, // 4ms 更短的帧时间
      idleThreshold: 25,
      useIdleCallback: true,
    },
    maxConcurrentTasks: 2, // 更少的并发
    useWorker: true,
    visibilityPadding: 100,
    memoryStrategy: 'aggressive',
  });
}
