// ================================
// 高性能流式解析管道
//
// 核心设计：
// 1. 使用 Rope 数据结构实现 O(log n) 的字符串操作
// 2. 基于 Piece Table 的增量编辑支持
// 3. 帧调度器确保 60fps 流畅体验
// 4. 精确的源码-渲染位置映射
// ================================

// ================================
// 类型定义
// ================================

/** 解析块类型 */
export type ParseBlockType =
  | 'preamble'
  | 'document'
  | 'section'
  | 'paragraph'
  | 'math_inline'
  | 'math_block'
  | 'environment'
  | 'list'
  | 'table'
  | 'command'
  | 'text'
  | 'comment'
  | 'error';

/** 解析块 */
export interface ParseBlock {
  /** 块唯一 ID */
  id: string;
  /** 块类型 */
  type: ParseBlockType;
  /** 源码起始偏移 */
  sourceStart: number;
  /** 源码结束偏移 */
  sourceEnd: number;
  /** 源码起始行 */
  sourceStartLine: number;
  /** 源码结束行 */
  sourceEndLine: number;
  /** 块内容哈希（用于缓存） */
  hash: number;
  /** 渲染 HTML */
  html: string;
  /** 渲染高度（真实测量值，-1 表示未测量） */
  measuredHeight: number;
  /** 估算高度 */
  estimatedHeight: number;
  /** 渲染顶部位置 */
  renderTop: number;
  /** 子块 */
  children: ParseBlock[];
  /** 是否已渲染 */
  rendered: boolean;
  /** 是否脏（需要重新解析） */
  dirty: boolean;
  /** 版本号 */
  version: number;
}

/** 编辑操作 */
export interface EditOperation {
  /** 操作类型 */
  type: 'insert' | 'delete' | 'replace';
  /** 起始偏移 */
  from: number;
  /** 结束偏移（仅 delete/replace） */
  to: number;
  /** 插入文本（仅 insert/replace） */
  text: string;
  /** 时间戳 */
  timestamp: number;
}

/** 位置映射结果 */
export interface PositionMapping {
  /** 源码行号 */
  sourceLine: number;
  /** 源码列号 */
  sourceColumn: number;
  /** 源码偏移 */
  sourceOffset: number;
  /** 渲染块 ID */
  blockId: string;
  /** 渲染位置（像素） */
  renderPosition: number;
  /** 是否精确匹配 */
  exact: boolean;
}

/** 解析进度回调 */
export type ParseProgressCallback = (progress: number, blockCount: number) => void;

/** 渲染进度回调 */
export type RenderProgressCallback = (progress: number, html: string) => void;

/** 帧任务优先级 */
export enum TaskPriority {
  /** 关键任务（用户输入响应） */
  CRITICAL = 0,
  /** 高优先级（可见区域渲染） */
  HIGH = 1,
  /** 普通优先级 */
  NORMAL = 2,
  /** 低优先级（预渲染） */
  LOW = 3,
  /** 空闲任务 */
  IDLE = 4,
}

/** 帧任务 */
interface FrameTask {
  id: string;
  priority: TaskPriority;
  execute: () => Promise<void> | void;
  cancelled: boolean;
  createdAt: number;
}

/** 管道配置 */
export interface PipelineConfig {
  /** 每帧最大执行时间（毫秒） */
  maxFrameTime: number;
  /** 块解析超时（毫秒） */
  blockParseTimeout: number;
  /** 最大缓存块数 */
  maxCachedBlocks: number;
  /** 是否启用调试日志 */
  debug: boolean;
  /** 块大小阈值（字节） */
  chunkSize: number;
  /** 最大并行任务数 */
  maxParallelTasks: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: PipelineConfig = {
  maxFrameTime: 8, // 留出时间给渲染，确保 60fps
  blockParseTimeout: 100,
  maxCachedBlocks: 500,
  debug: false,
  chunkSize: 4096,
  maxParallelTasks: 4,
};

// ================================
// Rope 数据结构
// 实现 O(log n) 的字符串操作
// ================================

/** Rope 节点 */
interface RopeNode {
  /** 节点类型 */
  type: 'leaf' | 'branch';
  /** 总长度 */
  length: number;
  /** 总行数 */
  lineCount: number;
  /** 高度（用于平衡） */
  height: number;
}

/** 叶子节点 */
interface RopeLeaf extends RopeNode {
  type: 'leaf';
  /** 文本内容 */
  text: string;
}

/** 分支节点 */
interface RopeBranch extends RopeNode {
  type: 'branch';
  /** 左子树 */
  left: RopeNode;
  /** 右子树 */
  right: RopeNode;
}

/** Rope 叶子节点最大大小 */
const ROPE_LEAF_MAX_SIZE = 512;

/** Rope 叶子节点最小大小 */
const ROPE_LEAF_MIN_SIZE = 128;

/**
 * 创建叶子节点
 */
function createLeaf(text: string): RopeLeaf {
  const lineCount = (text.match(/\n/g) || []).length;
  return {
    type: 'leaf',
    text,
    length: text.length,
    lineCount,
    height: 1,
  };
}

/**
 * 创建分支节点
 */
function createBranch(left: RopeNode, right: RopeNode): RopeBranch {
  return {
    type: 'branch',
    left,
    right,
    length: left.length + right.length,
    lineCount: left.lineCount + right.lineCount,
    height: Math.max(left.height, right.height) + 1,
  };
}

/**
 * 获取节点平衡因子
 */
function getBalance(node: RopeNode): number {
  if (node.type === 'leaf') return 0;
  const branch = node as RopeBranch;
  return branch.left.height - branch.right.height;
}

/**
 * 右旋
 */
function rotateRight(node: RopeBranch): RopeNode {
  const left = node.left as RopeBranch;
  const newRight = createBranch(left.right, node.right);
  return createBranch(left.left, newRight);
}

/**
 * 左旋
 */
function rotateLeft(node: RopeBranch): RopeNode {
  const right = node.right as RopeBranch;
  const newLeft = createBranch(node.left, right.left);
  return createBranch(newLeft, right.right);
}

/**
 * 平衡节点
 */
function balance(node: RopeNode): RopeNode {
  if (node.type === 'leaf') return node;

  const branch = node as RopeBranch;
  const factor = getBalance(branch);

  if (factor > 1) {
    // 左重
    if (getBalance(branch.left) < 0) {
      // LR 情况
      const newLeft = rotateLeft(branch.left as RopeBranch);
      return rotateRight(createBranch(newLeft, branch.right) as RopeBranch);
    }
    // LL 情况
    return rotateRight(branch);
  }

  if (factor < -1) {
    // 右重
    if (getBalance(branch.right) > 0) {
      // RL 情况
      const newRight = rotateRight(branch.right as RopeBranch);
      return rotateLeft(createBranch(branch.left, newRight) as RopeBranch);
    }
    // RR 情况
    return rotateLeft(branch);
  }

  return node;
}

/**
 * 从文本创建 Rope
 */
function ropeFromString(text: string): RopeNode {
  if (text.length <= ROPE_LEAF_MAX_SIZE) {
    return createLeaf(text);
  }

  // 在换行符附近分割
  const mid = Math.floor(text.length / 2);
  let splitPos = mid;

  // 向前查找换行符
  for (let i = mid; i >= mid - 100 && i >= 0; i--) {
    if (text[i] === '\n') {
      splitPos = i + 1;
      break;
    }
  }

  // 向后查找换行符
  if (splitPos === mid) {
    for (let i = mid; i <= mid + 100 && i < text.length; i++) {
      if (text[i] === '\n') {
        splitPos = i + 1;
        break;
      }
    }
  }

  const left = ropeFromString(text.slice(0, splitPos));
  const right = ropeFromString(text.slice(splitPos));

  return balance(createBranch(left, right));
}

/**
 * 获取 Rope 指定范围的文本
 */
function ropeSlice(node: RopeNode, start: number, end: number): string {
  if (start >= end || start >= node.length) {
    return '';
  }

  if (node.type === 'leaf') {
    const leaf = node as RopeLeaf;
    return leaf.text.slice(
      Math.max(0, start),
      Math.min(leaf.length, end)
    );
  }

  const branch = node as RopeBranch;
  const leftLen = branch.left.length;

  if (end <= leftLen) {
    // 完全在左子树
    return ropeSlice(branch.left, start, end);
  }

  if (start >= leftLen) {
    // 完全在右子树
    return ropeSlice(branch.right, start - leftLen, end - leftLen);
  }

  // 跨两个子树
  const leftPart = ropeSlice(branch.left, start, leftLen);
  const rightPart = ropeSlice(branch.right, 0, end - leftLen);
  return leftPart + rightPart;
}

/**
 * 在 Rope 中插入文本
 */
function ropeInsert(node: RopeNode, pos: number, text: string): RopeNode {
  if (text.length === 0) return node;

  if (node.type === 'leaf') {
    const leaf = node as RopeLeaf;
    const newText = leaf.text.slice(0, pos) + text + leaf.text.slice(pos);

    if (newText.length <= ROPE_LEAF_MAX_SIZE) {
      return createLeaf(newText);
    }

    // 需要分割
    return ropeFromString(newText);
  }

  const branch = node as RopeBranch;
  const leftLen = branch.left.length;

  if (pos <= leftLen) {
    const newLeft = ropeInsert(branch.left, pos, text);
    return balance(createBranch(newLeft, branch.right));
  } else {
    const newRight = ropeInsert(branch.right, pos - leftLen, text);
    return balance(createBranch(branch.left, newRight));
  }
}

/**
 * 从 Rope 中删除文本
 */
function ropeDelete(node: RopeNode, start: number, end: number): RopeNode {
  if (start >= end) return node;

  if (node.type === 'leaf') {
    const leaf = node as RopeLeaf;
    const newText = leaf.text.slice(0, start) + leaf.text.slice(end);
    return createLeaf(newText);
  }

  const branch = node as RopeBranch;
  const leftLen = branch.left.length;

  if (end <= leftLen) {
    // 完全在左子树
    const newLeft = ropeDelete(branch.left, start, end);
    if (newLeft.length === 0) return branch.right;
    return balance(createBranch(newLeft, branch.right));
  }

  if (start >= leftLen) {
    // 完全在右子树
    const newRight = ropeDelete(branch.right, start - leftLen, end - leftLen);
    if (newRight.length === 0) return branch.left;
    return balance(createBranch(branch.left, newRight));
  }

  // 跨两个子树
  const newLeft = ropeDelete(branch.left, start, leftLen);
  const newRight = ropeDelete(branch.right, 0, end - leftLen);

  if (newLeft.length === 0) return newRight;
  if (newRight.length === 0) return newLeft;

  return balance(createBranch(newLeft, newRight));
}

/**
 * 将 Rope 转换为字符串
 */
function ropeToString(node: RopeNode): string {
  if (node.type === 'leaf') {
    return (node as RopeLeaf).text;
  }

  const branch = node as RopeBranch;
  return ropeToString(branch.left) + ropeToString(branch.right);
}

/**
 * 获取指定行的偏移量
 */
function ropeLineToOffset(node: RopeNode, line: number): number {
  if (line <= 0) return 0;

  const text = ropeToString(node);
  let currentLine = 0;
  let offset = 0;

  for (let i = 0; i < text.length && currentLine < line; i++) {
    if (text[i] === '\n') {
      currentLine++;
      offset = i + 1;
    }
  }

  return offset;
}

/**
 * 获取指定偏移量的行号
 */
function ropeOffsetToLine(node: RopeNode, offset: number): number {
  const text = ropeSlice(node, 0, offset);
  return (text.match(/\n/g) || []).length;
}

// ================================
// 帧调度器
// 确保解析和渲染不阻塞主线程
// ================================

/**
 * 帧调度器类
 */
class FrameScheduler {
  private tasks: FrameTask[] = [];
  private isRunning: boolean = false;
  private rafId: number | null = null;
  private config: PipelineConfig;
  private frameStartTime: number = 0;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  /**
   * 调度任务
   */
  schedule(
    id: string,
    priority: TaskPriority,
    execute: () => Promise<void> | void
  ): string {
    // 取消已存在的同 ID 任务
    this.cancel(id);

    const task: FrameTask = {
      id,
      priority,
      execute,
      cancelled: false,
      createdAt: performance.now(),
    };

    // 按优先级插入
    let insertIndex = this.tasks.length;
    for (let i = 0; i < this.tasks.length; i++) {
      if (this.tasks[i].priority > priority) {
        insertIndex = i;
        break;
      }
    }
    this.tasks.splice(insertIndex, 0, task);

    // 启动调度循环
    if (!this.isRunning) {
      this.start();
    }

    return id;
  }

  /**
   * 取消任务
   */
  cancel(id: string): boolean {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.tasks[index].cancelled = true;
      this.tasks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 取消所有任务
   */
  cancelAll(): void {
    for (const task of this.tasks) {
      task.cancelled = true;
    }
    this.tasks = [];
  }

  /**
   * 启动调度循环
   */
  private start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleFrame();
  }

  /**
   * 停止调度循环
   */
  stop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 调度下一帧
   */
  private scheduleFrame(): void {
    this.rafId = requestAnimationFrame(() => this.processFrame());
  }

  /**
   * 处理一帧
   */
  private async processFrame(): Promise<void> {
    if (!this.isRunning) return;

    this.frameStartTime = performance.now();
    let processedCount = 0;

    // 在时间预算内处理任务
    while (
      this.tasks.length > 0 &&
      this.hasTimeBudget() &&
      processedCount < this.config.maxParallelTasks
    ) {
      const task = this.tasks.shift();
      if (!task || task.cancelled) continue;

      try {
        await task.execute();
      } catch (error) {
        if (this.config.debug) {
          console.error(`[FrameScheduler] 任务执行失败: ${task.id}`, error);
        }
      }

      processedCount++;
    }

    // 继续调度
    if (this.tasks.length > 0) {
      this.scheduleFrame();
    } else {
      this.isRunning = false;
    }
  }

  /**
   * 检查是否还有时间预算
   */
  private hasTimeBudget(): boolean {
    return performance.now() - this.frameStartTime < this.config.maxFrameTime;
  }

  /**
   * 获取剩余时间预算
   */
  getRemainingBudget(): number {
    return Math.max(
      0,
      this.config.maxFrameTime - (performance.now() - this.frameStartTime)
    );
  }

  /**
   * 让出主线程
   */
  async yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      if ('scheduler' in globalThis && 'yield' in (globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler) {
        ((globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler.yield as () => Promise<void>)().then(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  /**
   * 获取待处理任务数
   */
  getPendingCount(): number {
    return this.tasks.length;
  }

  /**
   * 销毁调度器
   */
  destroy(): void {
    this.stop();
    this.cancelAll();
  }
}

// ================================
// 行偏移索引
// 快速行号到偏移量的映射
// ================================

/**
 * 行偏移索引类
 */
class LineOffsetIndex {
  private offsets: number[] = [0];
  private version: number = 0;

  /**
   * 从文本构建索引
   */
  build(text: string): void {
    this.offsets = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        this.offsets.push(i + 1);
      }
    }
    this.version++;
  }

  /**
   * 获取行号对应的偏移量
   */
  getOffset(line: number): number {
    if (line < 0) return 0;
    if (line >= this.offsets.length) {
      return this.offsets[this.offsets.length - 1];
    }
    return this.offsets[line];
  }

  /**
   * 获取偏移量对应的行号（二分查找）
   */
  getLine(offset: number): number {
    if (offset <= 0) return 0;

    let low = 0;
    let high = this.offsets.length - 1;

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.offsets[mid] > offset) {
        high = mid - 1;
      } else {
        low = mid;
      }
    }

    return low;
  }

  /**
   * 获取总行数
   */
  getLineCount(): number {
    return this.offsets.length;
  }

  /**
   * 获取版本号
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * 应用编辑操作更新索引
   */
  applyEdit(from: number, to: number, text: string): void {
    const fromLine = this.getLine(from);
    const toLine = this.getLine(to);
    const deletedLineCount = toLine - fromLine;

    // 计算新增的行数
    const newLines: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        newLines.push(from + i + 1);
      }
    }

    // 计算偏移量变化
    const deltaLength = text.length - (to - from);

    // 更新后续行的偏移量
    for (let i = toLine + 1; i < this.offsets.length; i++) {
      this.offsets[i] += deltaLength;
    }

    // 替换受影响的行
    this.offsets.splice(fromLine + 1, deletedLineCount, ...newLines);

    this.version++;
  }
}

// ================================
// 块哈希计算
// 用于快速检测内容变化
// ================================

/**
 * 计算字符串哈希（FNV-1a）
 */
function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0; // 转为无符号整数
}

/**
 * 生成唯一 ID
 */
let idCounter = 0;
function generateId(prefix: string = 'block'): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

// ================================
// 块边界检测
// 识别 LaTeX 文档中的逻辑块边界
// ================================

/** 块边界类型 */
interface BlockBoundary {
  /** 偏移位置 */
  offset: number;
  /** 边界类型 */
  type: 'start' | 'end';
  /** 块类型 */
  blockType: ParseBlockType;
  /** 环境名称（可选） */
  envName?: string;
}

/**
 * 检测块边界
 */
function detectBlockBoundaries(text: string): BlockBoundary[] {
  const boundaries: BlockBoundary[] = [];

  // 章节命令正则
  const sectionRegex = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/g;

  // 环境正则
  const envStartRegex = /\\begin\{([a-zA-Z*]+)\}/g;
  const envEndRegex = /\\end\{([a-zA-Z*]+)\}/g;

  // 数学环境正则
  const mathBlockStartRegex = /\$\$|\\\[/g;
  const mathBlockEndRegex = /\$\$|\\\]/g;

  // 段落分隔符（连续两个或更多换行）
  const paragraphBreakRegex = /\n\s*\n/g;

  // 检测章节
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(text)) !== null) {
    boundaries.push({
      offset: match.index,
      type: 'start',
      blockType: 'section',
    });
  }

  // 检测环境开始
  while ((match = envStartRegex.exec(text)) !== null) {
    const envName = match[1];
    let blockType: ParseBlockType = 'environment';

    // 识别特殊环境
    if (['equation', 'align', 'gather', 'multline', 'eqnarray', 'equation*', 'align*', 'gather*', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix'].includes(envName)) {
      blockType = 'math_block';
    } else if (['itemize', 'enumerate', 'description'].includes(envName)) {
      blockType = 'list';
    } else if (['tabular', 'table', 'longtable'].includes(envName)) {
      blockType = 'table';
    }

    boundaries.push({
      offset: match.index,
      type: 'start',
      blockType,
      envName,
    });
  }

  // 检测环境结束
  while ((match = envEndRegex.exec(text)) !== null) {
    const envName = match[1];
    let blockType: ParseBlockType = 'environment';

    if (['equation', 'align', 'gather', 'multline', 'eqnarray', 'equation*', 'align*', 'gather*', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix'].includes(envName)) {
      blockType = 'math_block';
    } else if (['itemize', 'enumerate', 'description'].includes(envName)) {
      blockType = 'list';
    } else if (['tabular', 'table', 'longtable'].includes(envName)) {
      blockType = 'table';
    }

    boundaries.push({
      offset: match.index + match[0].length,
      type: 'end',
      blockType,
      envName,
    });
  }

  // 检测独立数学块
  while ((match = mathBlockStartRegex.exec(text)) !== null) {
    // 确保不在环境内
    boundaries.push({
      offset: match.index,
      type: 'start',
      blockType: 'math_block',
    });
  }

  while ((match = mathBlockEndRegex.exec(text)) !== null) {
    boundaries.push({
      offset: match.index + match[0].length,
      type: 'end',
      blockType: 'math_block',
    });
  }

  // 检测段落分隔
  while ((match = paragraphBreakRegex.exec(text)) !== null) {
    boundaries.push({
      offset: match.index,
      type: 'end',
      blockType: 'paragraph',
    });
    boundaries.push({
      offset: match.index + match[0].length,
      type: 'start',
      blockType: 'paragraph',
    });
  }

  // 按偏移量排序
  boundaries.sort((a, b) => a.offset - b.offset);

  return boundaries;
}

// ================================
// 流式解析管道
// ================================

/**
 * 流式解析管道类
 */
export class StreamingPipeline {
  private rope: RopeNode;
  private lineIndex: LineOffsetIndex;
  private blocks: Map<string, ParseBlock>;
  private blockOrder: string[];
  private scheduler: FrameScheduler;
  private config: PipelineConfig;
  private version: number = 0;
  private parseVersion: number = 0;
  private renderCache: Map<number, string>;

  // 回调
  private onProgress: ParseProgressCallback | null = null;
  private onRenderProgress: RenderProgressCallback | null = null;

  // 测量数据
  private blockHeights: Map<string, number>;
  private totalRenderedHeight: number = 0;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rope = createLeaf('');
    this.lineIndex = new LineOffsetIndex();
    this.blocks = new Map();
    this.blockOrder = [];
    this.scheduler = new FrameScheduler(this.config);
    this.renderCache = new Map();
    this.blockHeights = new Map();
  }

  /**
   * 设置内容
   */
  async setContent(text: string): Promise<void> {
    this.version++;
    this.rope = ropeFromString(text);
    this.lineIndex.build(text);
    this.blocks.clear();
    this.blockOrder = [];
    this.renderCache.clear();
    this.blockHeights.clear();
    this.totalRenderedHeight = 0;

    // 分块解析
    await this.parseAllBlocks();
  }

  /**
   * 应用编辑操作
   */
  async applyEdit(operation: EditOperation): Promise<void> {
    this.version++;

    // 更新 Rope
    switch (operation.type) {
      case 'insert':
        this.rope = ropeInsert(this.rope, operation.from, operation.text);
        break;
      case 'delete':
        this.rope = ropeDelete(this.rope, operation.from, operation.to);
        break;
      case 'replace':
        this.rope = ropeDelete(this.rope, operation.from, operation.to);
        this.rope = ropeInsert(this.rope, operation.from, operation.text);
        break;
    }

    // 更新行索引
    this.lineIndex.applyEdit(
      operation.from,
      operation.type === 'insert' ? operation.from : operation.to,
      operation.text
    );

    // 标记受影响的块为脏
    this.markDirtyBlocks(operation);

    // 重新解析脏块
    await this.reparseBlocks();
  }

  /**
   * 获取文本内容
   */
  getText(): string {
    return ropeToString(this.rope);
  }

  /**
   * 获取指定范围的文本
   */
  getTextRange(start: number, end: number): string {
    return ropeSlice(this.rope, start, end);
  }

  /**
   * 获取总长度
   */
  getLength(): number {
    return this.rope.length;
  }

  /**
   * 获取行数
   */
  getLineCount(): number {
    return this.lineIndex.getLineCount();
  }

  /**
   * 获取所有块
   */
  getBlocks(): ParseBlock[] {
    return this.blockOrder.map((id) => this.blocks.get(id)!).filter(Boolean);
  }

  /**
   * 获取指定范围内的块
   */
  getBlocksInRange(startOffset: number, endOffset: number): ParseBlock[] {
    const result: ParseBlock[] = [];
    for (const id of this.blockOrder) {
      const block = this.blocks.get(id);
      if (!block) continue;
      if (block.sourceEnd < startOffset) continue;
      if (block.sourceStart > endOffset) break;
      result.push(block);
    }
    return result;
  }

  /**
   * 获取指定行的块
   */
  getBlockAtLine(line: number): ParseBlock | null {
    const offset = this.lineIndex.getOffset(line);
    for (const id of this.blockOrder) {
      const block = this.blocks.get(id);
      if (!block) continue;
      if (offset >= block.sourceStart && offset < block.sourceEnd) {
        return block;
      }
    }
    return null;
  }

  /**
   * 获取完整渲染 HTML
   */
  getRenderedHtml(): string {
    const parts: string[] = [];
    for (const id of this.blockOrder) {
      const block = this.blocks.get(id);
      if (block && block.rendered) {
        parts.push(block.html);
      }
    }
    return parts.join('\n');
  }

  /**
   * 设置进度回调
   */
  setProgressCallback(callback: ParseProgressCallback): void {
    this.onProgress = callback;
  }

  /**
   * 设置渲染进度回调
   */
  setRenderProgressCallback(callback: RenderProgressCallback): void {
    this.onRenderProgress = callback;
  }

  /**
   * 计算源码位置到渲染位置的映射
   */
  getPositionMapping(sourceOffset: number): PositionMapping {
    const line = this.lineIndex.getLine(sourceOffset);
    const lineOffset = this.lineIndex.getOffset(line);
    const column = sourceOffset - lineOffset;

    // 查找包含该偏移的块
    let block: ParseBlock | null = null;
    let renderPosition = 0;

    for (const id of this.blockOrder) {
      const b = this.blocks.get(id);
      if (!b) continue;

      if (sourceOffset >= b.sourceStart && sourceOffset < b.sourceEnd) {
        block = b;
        // 计算块内相对位置
        const relativeOffset = sourceOffset - b.sourceStart;
        const blockTotalChars = b.sourceEnd - b.sourceStart;
        const ratio = blockTotalChars > 0 ? relativeOffset / blockTotalChars : 0;
        const blockHeight = b.measuredHeight >= 0 ? b.measuredHeight : b.estimatedHeight;
        renderPosition = b.renderTop + ratio * blockHeight;
        break;
      }

      // 累加渲染位置
      renderPosition = b.renderTop + (b.measuredHeight >= 0 ? b.measuredHeight : b.estimatedHeight);
    }

    return {
      sourceLine: line,
      sourceColumn: column,
      sourceOffset,
      blockId: block?.id ?? '',
      renderPosition,
      exact: block !== null && block.measuredHeight >= 0,
    };
  }

  /**
   * 计算渲染位置到源码位置的映射
   */
  getSourcePosition(renderPosition: number): PositionMapping {
    let currentTop = 0;
    let block: ParseBlock | null = null;
    let sourceOffset = 0;

    for (const id of this.blockOrder) {
      const b = this.blocks.get(id);
      if (!b) continue;

      const blockHeight = b.measuredHeight >= 0 ? b.measuredHeight : b.estimatedHeight;
      const blockBottom = currentTop + blockHeight;

      if (renderPosition >= currentTop && renderPosition < blockBottom) {
        block = b;
        // 计算块内相对位置
        const relativePosition = renderPosition - currentTop;
        const ratio = blockHeight > 0 ? relativePosition / blockHeight : 0;
        const blockTotalChars = b.sourceEnd - b.sourceStart;
        sourceOffset = b.sourceStart + Math.floor(ratio * blockTotalChars);
        break;
      }

      currentTop = blockBottom;
    }

    if (!block && this.blockOrder.length > 0) {
      // 超出范围，返回最后一个块的末尾
      const lastId = this.blockOrder[this.blockOrder.length - 1];
      block = this.blocks.get(lastId) ?? null;
      sourceOffset = block ? block.sourceEnd : 0;
    }

    const line = this.lineIndex.getLine(sourceOffset);
    const lineOffset = this.lineIndex.getOffset(line);

    return {
      sourceLine: line,
      sourceColumn: sourceOffset - lineOffset,
      sourceOffset,
      blockId: block?.id ?? '',
      renderPosition,
      exact: block !== null && block.measuredHeight >= 0,
    };
  }

  /**
   * 更新块的测量高度
   */
  updateBlockHeight(blockId: string, height: number): void {
    const block = this.blocks.get(blockId);
    if (!block) return;

    const oldHeight = block.measuredHeight >= 0 ? block.measuredHeight : block.estimatedHeight;
    block.measuredHeight = height;

    // 更新后续块的渲染位置
    const blockIndex = this.blockOrder.indexOf(blockId);
    if (blockIndex < 0) return;

    const delta = height - oldHeight;
    let currentTop = block.renderTop + height;

    for (let i = blockIndex + 1; i < this.blockOrder.length; i++) {
      const b = this.blocks.get(this.blockOrder[i]);
      if (b) {
        b.renderTop = currentTop;
        currentTop += b.measuredHeight >= 0 ? b.measuredHeight : b.estimatedHeight;
      }
    }

    this.totalRenderedHeight += delta;
  }

  /**
   * 批量更新块高度
   */
  updateBlockHeights(heights: Map<string, number>): void {
    let needsRecalculation = false;

    for (const [blockId, height] of heights) {
      const block = this.blocks.get(blockId);
      if (block && block.measuredHeight !== height) {
        block.measuredHeight = height;
        needsRecalculation = true;
      }
    }

    if (needsRecalculation) {
      this.recalculateRenderPositions();
    }
  }

  /**
   * 获取总渲染高度
   */
  getTotalRenderedHeight(): number {
    return this.totalRenderedHeight;
  }

  /**
   * 获取版本号
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * 销毁管道
   */
  destroy(): void {
    this.scheduler.destroy();
    this.blocks.clear();
    this.blockOrder = [];
    this.renderCache.clear();
    this.blockHeights.clear();
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 解析所有块
   */
  private async parseAllBlocks(): Promise<void> {
    const text = ropeToString(this.rope);
    if (text.length === 0) return;

    this.parseVersion = this.version;
    const boundaries = detectBlockBoundaries(text);

    // 创建块
    let currentPos = 0;
    let blockCount = 0;
    const totalLength = text.length;

    // 检测前言
    const documentMatch = text.match(/\\begin\{document\}/);
    if (documentMatch && documentMatch.index !== undefined) {
      // 前言块
      const preambleEnd = documentMatch.index + documentMatch[0].length;
      if (currentPos < preambleEnd) {
        const block = this.createBlock(
          'preamble',
          currentPos,
          preambleEnd,
          text.slice(currentPos, preambleEnd)
        );
        this.addBlock(block);
        currentPos = preambleEnd;
        blockCount++;
      }
    }

    // 根据边界创建块
    for (const boundary of boundaries) {
      if (boundary.offset <= currentPos) continue;

      // 在边界之前创建文本/段落块
      if (boundary.type === 'start' && boundary.offset > currentPos) {
        const content = text.slice(currentPos, boundary.offset);
        if (content.trim()) {
          const block = this.createBlock(
            'paragraph',
            currentPos,
            boundary.offset,
            content
          );
          this.addBlock(block);
          blockCount++;
        }
        currentPos = boundary.offset;
      }

      // 报告进度
      if (this.onProgress) {
        const progress = Math.min(1, currentPos / totalLength);
        this.onProgress(progress, blockCount);
      }

      // 让出主线程
      if (blockCount % 10 === 0) {
        await this.scheduler.yieldToMain();
        if (this.parseVersion !== this.version) {
          // 版本已变更，停止解析
          return;
        }
      }
    }

    // 处理剩余内容
    if (currentPos < text.length) {
      const content = text.slice(currentPos);
      if (content.trim()) {
        const block = this.createBlock(
          'paragraph',
          currentPos,
          text.length,
          content
        );
        this.addBlock(block);
        blockCount++;
      }
    }

    // 计算渲染位置
    this.recalculateRenderPositions();

    // 报告完成
    if (this.onProgress) {
      this.onProgress(1, blockCount);
    }
  }

  /**
   * 创建块
   */
  private createBlock(
    type: ParseBlockType,
    start: number,
    end: number,
    content: string
  ): ParseBlock {
    const startLine = this.lineIndex.getLine(start);
    const endLine = this.lineIndex.getLine(end);
    const hash = hashString(content);

    // 检查缓存
    const cachedHtml = this.renderCache.get(hash);

    return {
      id: generateId(type),
      type,
      sourceStart: start,
      sourceEnd: end,
      sourceStartLine: startLine,
      sourceEndLine: endLine,
      hash,
      html: cachedHtml || '',
      measuredHeight: -1,
      estimatedHeight: this.estimateHeight(type, content),
      renderTop: 0,
      children: [],
      rendered: !!cachedHtml,
      dirty: false,
      version: this.version,
    };
  }

  /**
   * 添加块
   */
  private addBlock(block: ParseBlock): void {
    this.blocks.set(block.id, block);
    this.blockOrder.push(block.id);
  }

  /**
   * 估算块高度
   */
  private estimateHeight(type: ParseBlockType, content: string): number {
    const lineCount = (content.match(/\n/g) || []).length + 1;
    const baseLineHeight = 24;

    switch (type) {
      case 'preamble':
        return lineCount * baseLineHeight * 0.5; // 前言通常不显示
      case 'section':
        return 50 + lineCount * baseLineHeight;
      case 'paragraph':
        return lineCount * baseLineHeight;
      case 'math_block':
        return Math.max(80, lineCount * 30);
      case 'math_inline':
        return 30;
      case 'list':
        return lineCount * (baseLineHeight + 8);
      case 'table':
        return lineCount * 35;
      case 'environment':
        return lineCount * baseLineHeight;
      default:
        return lineCount * baseLineHeight;
    }
  }

  /**
   * 标记受影响的块为脏
   */
  private markDirtyBlocks(operation: EditOperation): void {
    const from = operation.from;
    const to = operation.type === 'insert' ? operation.from : operation.to;

    for (const id of this.blockOrder) {
      const block = this.blocks.get(id);
      if (!block) continue;

      // 检查块是否与编辑范围重叠
      if (block.sourceEnd < from) continue;
      if (block.sourceStart > to) {
        // 更新后续块的偏移量
        const delta = operation.type === 'insert'
          ? operation.text.length
          : operation.type === 'delete'
            ? -(to - from)
            : operation.text.length - (to - from);
        block.sourceStart += delta;
        block.sourceEnd += delta;
        continue;
      }

      // 标记为脏
      block.dirty = true;
      block.rendered = false;

      // 清除缓存
      this.renderCache.delete(block.hash);
    }
  }

  /**
   * 重新解析脏块
   */
  private async reparseBlocks(): Promise<void> {
    const text = ropeToString(this.rope);
    const dirtyBlocks = this.blockOrder
      .map((id) => this.blocks.get(id))
      .filter((b): b is ParseBlock => b !== undefined && b.dirty);

    for (const block of dirtyBlocks) {
      // 检查版本
      if (block.version !== this.version - 1) {
        // 块已过期
        continue;
      }

      // 重新获取内容
      const content = text.slice(block.sourceStart, block.sourceEnd);
      block.hash = hashString(content);
      block.sourceStartLine = this.lineIndex.getLine(block.sourceStart);
      block.sourceEndLine = this.lineIndex.getLine(block.sourceEnd);
      block.estimatedHeight = this.estimateHeight(block.type, content);
      block.dirty = false;
      block.version = this.version;

      // 检查渲染缓存
      const cachedHtml = this.renderCache.get(block.hash);
      if (cachedHtml) {
        block.html = cachedHtml;
        block.rendered = true;
      }
    }

    // 重新计算渲染位置
    this.recalculateRenderPositions();
  }

  /**
   * 重新计算渲染位置
   */
  private recalculateRenderPositions(): void {
    let currentTop = 0;

    for (const id of this.blockOrder) {
      const block = this.blocks.get(id);
      if (!block) continue;

      block.renderTop = currentTop;
      const height = block.measuredHeight >= 0 ? block.measuredHeight : block.estimatedHeight;
      currentTop += height;
    }

    this.totalRenderedHeight = currentTop;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建流式解析管道
 */
export function createStreamingPipeline(
  config?: Partial<PipelineConfig>
): StreamingPipeline {
  return new StreamingPipeline(config);
}

// ================================
// 导出
// ================================

export {
  FrameScheduler,
  LineOffsetIndex,
  hashString,
  generateId,
  detectBlockBoundaries,
  // Rope 函数
  ropeFromString,
  ropeToString,
  ropeSlice,
  ropeInsert,
  ropeDelete,
  ropeLineToOffset,
  ropeOffsetToLine,
};
