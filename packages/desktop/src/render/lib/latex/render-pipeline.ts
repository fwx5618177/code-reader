// ================================
// 统一的高性能渲染管道
// 集成 HeightMap、FrameScheduler 和流式解析
// 解决大文件 OOM 和滚动同步问题
// ================================

import {
  HeightMap,
  createHeightMap,
  measureDOMBlocks,
  createBlockResizeObserver,
  createBlockVisibilityObserver,
  type HeightBlock,
} from './height-map';
import {
  FrameScheduler,
  createFrameScheduler,
  TaskPriority,
  type ScheduledTask,
} from './frame-scheduler';
import type { RootNode, LatexNode } from './types';

// ================================
// 类型定义
// ================================

/** 渲染块状态 */
export type RenderBlockStatus = 'pending' | 'parsing' | 'parsed' | 'rendering' | 'rendered' | 'error';

/** 渲染块 */
export interface RenderBlock {
  /** 唯一标识 */
  id: string;
  /** 源码起始行（1-based） */
  sourceStartLine: number;
  /** 源码结束行（1-based） */
  sourceEndLine: number;
  /** 源码起始偏移 */
  sourceStartOffset: number;
  /** 源码结束偏移 */
  sourceEndOffset: number;
  /** 块类型 */
  type: RenderBlockType;
  /** 渲染后的 HTML */
  html: string;
  /** 渲染后的顶部位置 */
  renderTop: number;
  /** 渲染后的高度 */
  renderHeight: number;
  /** 是否已测量真实 DOM */
  measured: boolean;
  /** 状态 */
  status: RenderBlockStatus;
  /** 优先级 */
  priority: number;
  /** 是否可见 */
  visible: boolean;
  /** 内容哈希（用于缓存） */
  hash: string;
  /** AST 节点（解析后） */
  ast?: LatexNode;
}

/** 渲染块类型 */
export type RenderBlockType =
  | 'preamble'
  | 'section'
  | 'paragraph'
  | 'math-block'
  | 'math-inline'
  | 'list'
  | 'table'
  | 'code'
  | 'environment'
  | 'command'
  | 'text'
  | 'error'
  | 'unknown';

/** 可见范围 */
export interface VisibleRange {
  /** 起始行 */
  startLine: number;
  /** 结束行 */
  endLine: number;
  /** 滚动位置 */
  scrollTop: number;
  /** 视口高度 */
  viewportHeight: number;
}

/** 渲染管道配置 */
export interface RenderPipelineConfig {
  /** 默认行高估算（px） */
  defaultLineHeight: number;
  /** 可见区域外延（行数） */
  visibilityPadding: number;
  /** 最大并发解析任务 */
  maxConcurrentParse: number;
  /** 每帧最大时间（ms） */
  maxFrameTime: number;
  /** 是否使用 Worker */
  useWorker: boolean;
  /** 内存压力阈值（MB） */
  memoryThreshold: number;
  /** 是否启用 DOM 测量 */
  enableDOMMeasurement: boolean;
  /** 调试模式 */
  debug: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: RenderPipelineConfig = {
  defaultLineHeight: 24,
  visibilityPadding: 20,
  maxConcurrentParse: 4,
  maxFrameTime: 8,
  useWorker: true,
  memoryThreshold: 500,
  enableDOMMeasurement: true,
  debug: false,
};

/** 滚动同步结果 */
export interface ScrollSyncResult {
  /** 目标滚动位置 */
  scrollTop: number;
  /** 是否精确匹配 */
  exact: boolean;
  /** 匹配的块 */
  block?: RenderBlock;
}

/** 渲染结果 */
export interface PipelineRenderResult {
  /** 渲染的 HTML */
  html: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 解析时间（ms） */
  parseTime: number;
  /** 渲染时间（ms） */
  renderTime: number;
  /** 渲染的块数 */
  blockCount: number;
  /** 已测量的块数 */
  measuredCount: number;
}

/** 管道事件 */
export type PipelineEvent =
  | { type: 'parse-start'; blockId: string }
  | { type: 'parse-complete'; blockId: string; parseTime: number }
  | { type: 'render-start'; blockId: string }
  | { type: 'render-complete'; blockId: string; renderTime: number }
  | { type: 'measure-complete'; blockId: string; height: number }
  | { type: 'visibility-change'; visibleBlockIds: string[] }
  | { type: 'memory-pressure'; level: 'low' | 'medium' | 'high' | 'critical' }
  | { type: 'error'; blockId?: string; error: string };

/** 事件监听器 */
export type PipelineEventListener = (event: PipelineEvent) => void;

// ================================
// 工具函数
// ================================

/** 生成块 ID */
let blockIdCounter = 0;
function generateBlockId(): string {
  return `block_${Date.now().toString(36)}_${(blockIdCounter++).toString(36)}`;
}

/** 快速字符串哈希 */
function fastHash(str: string): string {
  let hash = 0;
  const len = str.length;
  const step = Math.max(1, Math.floor(len / 100));

  for (let i = 0; i < len; i += step) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }

  return hash.toString(36);
}

/** 计算行偏移表 */
function computeLineOffsets(content: string): { offsets: number[]; lineCount: number } {
  const offsets: number[] = [0];
  const len = content.length;

  for (let i = 0; i < len; i++) {
    if (content[i] === '\n') {
      offsets.push(i + 1);
    }
  }

  return { offsets, lineCount: offsets.length };
}

/** 从偏移获取行号 */
function getLineFromOffset(offset: number, lineOffsets: number[]): number {
  let low = 0;
  let high = lineOffsets.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineOffsets[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low + 1; // 1-based
}

/** 检测块类型 */
function detectBlockType(content: string): RenderBlockType {
  const trimmed = content.trim();

  if (!trimmed) return 'text';

  // 数学环境
  if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
    return 'math-block';
  }

  // 章节命令
  if (/^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{/.test(trimmed)) {
    return 'section';
  }

  // 环境
  if (/^\\begin\{/.test(trimmed)) {
    const envMatch = trimmed.match(/^\\begin\{(\w+)\}/);
    if (envMatch) {
      const envName = envMatch[1];

      // 数学环境
      if (['equation', 'align', 'gather', 'multline', 'eqnarray', 'aligned', 'gathered', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix'].includes(envName)) {
        return 'math-block';
      }

      // 列表环境
      if (['itemize', 'enumerate', 'description'].includes(envName)) {
        return 'list';
      }

      // 表格环境
      if (['tabular', 'table', 'longtable'].includes(envName)) {
        return 'table';
      }

      // 代码环境
      if (['verbatim', 'lstlisting', 'minted'].includes(envName)) {
        return 'code';
      }

      return 'environment';
    }
  }

  // 命令
  if (trimmed.startsWith('\\')) {
    return 'command';
  }

  // 默认为段落
  return 'paragraph';
}

/** 计算块优先级 */
function computeBlockPriority(type: RenderBlockType, visible: boolean): number {
  // 基础优先级
  const typePriority: Record<RenderBlockType, number> = {
    'section': 100,
    'math-block': 90,
    'paragraph': 80,
    'list': 70,
    'table': 70,
    'code': 60,
    'environment': 50,
    'command': 40,
    'math-inline': 30,
    'text': 20,
    'preamble': 10,
    'error': 0,
    'unknown': 0,
  };

  let priority = typePriority[type] || 0;

  // 可见块优先级提升
  if (visible) {
    priority += 1000;
  }

  return priority;
}

// ================================
// 块边界检测器
// ================================

interface BlockBoundary {
  /** 偏移位置 */
  offset: number;
  /** 行号 */
  line: number;
  /** 块类型 */
  type: RenderBlockType;
}

/**
 * 检测内容中的块边界
 * 使用流式扫描，避免创建大量子字符串
 */
function detectBlockBoundaries(
  content: string,
  lineOffsets: number[]
): BlockBoundary[] {
  const boundaries: BlockBoundary[] = [];
  const len = content.length;

  // 添加开始边界
  boundaries.push({
    offset: 0,
    line: 1,
    type: 'text',
  });

  let i = 0;

  while (i < len) {
    const char = content[i];

    // 检测反斜杠命令
    if (char === '\\') {
      // 章节命令
      if (i + 8 < len) {
        const slice8 = content.slice(i, i + 8);
        if (slice8.startsWith('\\section') || slice8.startsWith('\\chapter')) {
          boundaries.push({
            offset: i,
            line: getLineFromOffset(i, lineOffsets),
            type: 'section',
          });
          i++;
          continue;
        }
      }

      // 环境开始
      if (i + 7 < len && content.slice(i, i + 7) === '\\begin{') {
        const endBrace = content.indexOf('}', i + 7);
        if (endBrace !== -1) {
          const envName = content.slice(i + 7, endBrace);
          let type: RenderBlockType = 'environment';

          if (['equation', 'align', 'gather', 'multline', 'aligned', 'gathered', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix'].includes(envName) ||
              envName.endsWith('*') && ['equation', 'align', 'gather', 'multline'].includes(envName.slice(0, -1))) {
            type = 'math-block';
          } else if (['itemize', 'enumerate', 'description'].includes(envName)) {
            type = 'list';
          } else if (['tabular', 'table', 'longtable'].includes(envName)) {
            type = 'table';
          } else if (['verbatim', 'lstlisting', 'minted'].includes(envName)) {
            type = 'code';
          }

          boundaries.push({
            offset: i,
            line: getLineFromOffset(i, lineOffsets),
            type,
          });
        }
        i++;
        continue;
      }

      // 数学块 \[
      if (i + 2 <= len && content.slice(i, i + 2) === '\\[') {
        boundaries.push({
          offset: i,
          line: getLineFromOffset(i, lineOffsets),
          type: 'math-block',
        });
        i += 2;
        continue;
      }
    }

    // 数学块 $$
    if (char === '$' && i + 1 < len && content[i + 1] === '$') {
      boundaries.push({
        offset: i,
        line: getLineFromOffset(i, lineOffsets),
        type: 'math-block',
      });
      i += 2;
      continue;
    }

    // 段落分隔（连续两个换行）
    if (char === '\n' && i + 1 < len && content[i + 1] === '\n') {
      // 跳过连续空行
      let j = i + 2;
      while (j < len && (content[j] === '\n' || content[j] === ' ' || content[j] === '\t')) {
        j++;
      }

      if (j < len) {
        boundaries.push({
          offset: j,
          line: getLineFromOffset(j, lineOffsets),
          type: detectBlockType(content.slice(j, Math.min(j + 50, len))),
        });
      }

      i = j;
      continue;
    }

    i++;
  }

  // 添加结束边界
  if (boundaries.length === 0 || boundaries[boundaries.length - 1].offset !== len) {
    boundaries.push({
      offset: len,
      line: getLineFromOffset(len - 1, lineOffsets),
      type: 'text',
    });
  }

  return boundaries;
}

// ================================
// 对象池
// ================================

class ObjectPool<T> {
  private pool: T[] = [];
  private createFn: () => T;
  private resetFn: (obj: T) => void;
  private maxSize: number;

  constructor(
    createFn: () => T,
    resetFn: (obj: T) => void,
    maxSize: number = 1000
  ) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;
  }

  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.createFn();
  }

  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.resetFn(obj);
      this.pool.push(obj);
    }
  }

  clear(): void {
    this.pool.length = 0;
  }

  get size(): number {
    return this.pool.length;
  }
}

// ================================
// 渲染管道
// ================================

export class RenderPipeline {
  private config: RenderPipelineConfig;
  private heightMap: HeightMap;
  private scheduler: FrameScheduler;

  // 内容和状态
  private content: string = '';
  private lineOffsets: number[] = [0];
  private lineCount: number = 1;
  private blocks: Map<string, RenderBlock> = new Map();
  private blockOrder: string[] = [];

  // 可见性
  private visibleRange: VisibleRange = {
    startLine: 1,
    endLine: 50,
    scrollTop: 0,
    viewportHeight: 600,
  };

  // DOM 观察器
  private resizeObserver: ReturnType<typeof createBlockResizeObserver> | null = null;
  private visibilityObserver: ReturnType<typeof createBlockVisibilityObserver> | null = null;
  private previewContainer: HTMLElement | null = null;

  // 对象池
  private blockPool: ObjectPool<RenderBlock>;

  // 事件监听
  private listeners: Set<PipelineEventListener> = new Set();

  // 版本控制
  private version: number = 0;

  // 统计
  private stats = {
    parseTime: 0,
    renderTime: 0,
    measureTime: 0,
    blocksParsed: 0,
    blocksRendered: 0,
    blocksMeasured: 0,
  };

  constructor(config?: Partial<RenderPipelineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化 HeightMap
    this.heightMap = createHeightMap({
      defaultLineHeight: this.config.defaultLineHeight,
      containerHeight: 600,
      totalLines: 1,
      debug: this.config.debug,
    });

    // 初始化调度器
    this.scheduler = createFrameScheduler({
      maxFrameTime: this.config.maxFrameTime,
      useIdleCallback: true,
      maxConcurrentTasks: this.config.maxConcurrentParse,
      debug: this.config.debug,
    });

    // 初始化对象池
    this.blockPool = new ObjectPool<RenderBlock>(
      () => ({
        id: '',
        sourceStartLine: 0,
        sourceEndLine: 0,
        sourceStartOffset: 0,
        sourceEndOffset: 0,
        type: 'text',
        html: '',
        renderTop: 0,
        renderHeight: 0,
        measured: false,
        status: 'pending',
        priority: 0,
        visible: false,
        hash: '',
      }),
      (block) => {
        block.id = '';
        block.html = '';
        block.ast = undefined;
        block.status = 'pending';
        block.measured = false;
      }
    );
  }

  // ================================
  // 公共 API
  // ================================

  /**
   * 设置内容
   */
  setContent(content: string): void {
    this.content = content;

    const lineInfo = computeLineOffsets(content);
    this.lineOffsets = lineInfo.offsets;
    this.lineCount = lineInfo.lineCount;

    this.heightMap.setTotalLines(this.lineCount);
    this.version++;
  }

  /**
   * 初始化块
   * 将内容分割为渲染块，优先处理可见区域
   */
  async initializeBlocks(): Promise<void> {
    const startTime = performance.now();

    // 检测块边界
    const boundaries = detectBlockBoundaries(this.content, this.lineOffsets);

    // 清理旧块
    this.releaseAllBlocks();

    // 创建块
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];

      const block = this.blockPool.acquire();
      block.id = generateBlockId();
      block.sourceStartLine = start.line;
      block.sourceEndLine = end.line;
      block.sourceStartOffset = start.offset;
      block.sourceEndOffset = end.offset;
      block.type = start.type;
      block.hash = fastHash(this.content.slice(start.offset, end.offset));
      block.status = 'pending';
      block.visible = this.isLineVisible(start.line);
      block.priority = computeBlockPriority(start.type, block.visible);

      // 估算高度
      const lineCount = end.line - start.line + 1;
      block.renderHeight = lineCount * this.config.defaultLineHeight;

      this.blocks.set(block.id, block);
      this.blockOrder.push(block.id);

      // 添加到 HeightMap
      this.heightMap.addBlock({
        id: block.id,
        sourceStartLine: start.line,
        sourceEndLine: end.line,
        sourceStartOffset: start.offset,
        sourceEndOffset: end.offset,
        type: this.mapBlockTypeToHeightType(block.type),
        renderTop: block.renderTop,
        renderHeight: block.renderHeight,
        measured: false,
        priority: block.priority,
      });
    }

    // 更新渲染位置
    this.updateRenderPositions();

    if (this.config.debug) {
      console.log(`[RenderPipeline] 初始化 ${this.blocks.size} 个块，耗时 ${(performance.now() - startTime).toFixed(2)}ms`);
    }
  }

  /**
   * 设置可见范围
   */
  setVisibleRange(range: Partial<VisibleRange>): void {
    const padding = this.config.visibilityPadding;

    this.visibleRange = {
      ...this.visibleRange,
      ...range,
    };

    // 扩展可见范围
    const expandedStart = Math.max(1, this.visibleRange.startLine - padding);
    const expandedEnd = Math.min(this.lineCount, this.visibleRange.endLine + padding);

    // 更新块可见性
    const visibleBlockIds: string[] = [];

    for (const blockId of this.blockOrder) {
      const block = this.blocks.get(blockId);
      if (!block) continue;

      const wasVisible = block.visible;
      block.visible = block.sourceStartLine <= expandedEnd && block.sourceEndLine >= expandedStart;

      if (block.visible) {
        visibleBlockIds.push(blockId);

        // 可见性变化时更新优先级
        if (!wasVisible) {
          block.priority = computeBlockPriority(block.type, true);
        }
      }
    }

    // 触发事件
    this.emit({ type: 'visibility-change', visibleBlockIds });
  }

  /**
   * 调度渲染任务
   * 优先渲染可见块
   */
  async scheduleRendering(
    parseBlock: (content: string, type: RenderBlockType) => Promise<{ html: string; ast?: LatexNode }>,
  ): Promise<PipelineRenderResult> {
    const startTime = performance.now();
    let parseTime = 0;
    let renderTime = 0;
    let blockCount = 0;

    // 获取需要渲染的块，按优先级排序
    const pendingBlocks = this.blockOrder
      .map(id => this.blocks.get(id)!)
      .filter(block => block.status === 'pending' || block.status === 'error')
      .sort((a, b) => b.priority - a.priority);

    // 分批调度
    const batchSize = 5;
    const batches: RenderBlock[][] = [];

    for (let i = 0; i < pendingBlocks.length; i += batchSize) {
      batches.push(pendingBlocks.slice(i, i + batchSize));
    }

    // 处理每批
    for (const batch of batches) {
      const batchPromises = batch.map(async (block) => {
        const blockStart = performance.now();

        try {
          block.status = 'parsing';
          this.emit({ type: 'parse-start', blockId: block.id });

          const blockContent = this.content.slice(
            block.sourceStartOffset,
            block.sourceEndOffset
          );

          const result = await parseBlock(blockContent, block.type);

          const blockParseTime = performance.now() - blockStart;
          parseTime += blockParseTime;

          block.html = result.html;
          block.ast = result.ast;
          block.status = 'rendered';
          blockCount++;

          this.emit({ type: 'parse-complete', blockId: block.id, parseTime: blockParseTime });

          // 让出主线程
          if (blockCount % 3 === 0) {
            await this.scheduler.yieldToMain();
          }

        } catch (error) {
          block.status = 'error';
          block.html = `<div class="latex-error">${this.escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
          this.emit({ type: 'error', blockId: block.id, error: String(error) });
        }
      });

      await Promise.all(batchPromises);
    }

    renderTime = performance.now() - startTime - parseTime;

    // 组合 HTML
    const html = this.combineBlocksHtml();

    return {
      html,
      success: true,
      parseTime,
      renderTime,
      blockCount,
      measuredCount: this.heightMap.getMeasuredCount(),
    };
  }

  /**
   * 绑定预览容器
   * 启用 DOM 测量
   */
  bindPreviewContainer(container: HTMLElement): void {
    this.previewContainer = container;

    if (!this.config.enableDOMMeasurement) return;

    // 创建 ResizeObserver
    this.resizeObserver = createBlockResizeObserver(
      container,
      this.heightMap,
      {
        blockSelector: '[data-block-id]',
        blockIdAttribute: 'data-block-id',
      }
    );

    // 创建 IntersectionObserver
    this.visibilityObserver = createBlockVisibilityObserver(
      container,
      (id, isVisible) => {
        const block = this.blocks.get(id);
        if (block) {
          block.visible = isVisible;
          block.priority = computeBlockPriority(block.type, isVisible);
        }
      },
      {
        blockSelector: '[data-block-id]',
        blockIdAttribute: 'data-block-id',
      }
    );
  }

  /**
   * 测量 DOM 块
   */
  measureBlocks(): void {
    if (!this.previewContainer || !this.config.enableDOMMeasurement) return;

    const startTime = performance.now();

    const measurements = measureDOMBlocks({
      container: this.previewContainer,
      blockSelector: '[data-block-id]',
      blockIdAttribute: 'data-block-id',
      visibleOnly: false,
    });

    // 更新 HeightMap
    this.heightMap.updateBlockPositions(measurements);

    // 更新本地块数据
    for (const { id, renderTop, renderHeight } of measurements) {
      const block = this.blocks.get(id);
      if (block) {
        block.renderTop = renderTop;
        block.renderHeight = renderHeight;
        block.measured = true;
      }
    }

    this.stats.measureTime = performance.now() - startTime;
    this.stats.blocksMeasured = measurements.length;

    if (this.config.debug) {
      console.log(`[RenderPipeline] 测量 ${measurements.length} 个块，耗时 ${this.stats.measureTime.toFixed(2)}ms`);
    }
  }

  /**
   * 计算预览滚动位置（源码 -> 预览）
   */
  computePreviewScroll(
    sourceScrollTop: number,
    sourceViewportHeight: number,
    sourceLineHeight: number
  ): ScrollSyncResult {
    const result = this.heightMap.computePreviewScrollPosition(
      sourceScrollTop,
      sourceViewportHeight,
      sourceLineHeight
    );

    // 尝试找到对应的块
    const centerLine = Math.floor(sourceScrollTop / sourceLineHeight) + Math.floor(sourceViewportHeight / sourceLineHeight / 2);
    const posResult = this.heightMap.getPositionForLine(centerLine);

    let block: RenderBlock | undefined;
    if (posResult.block) {
      block = this.blocks.get(posResult.block.id);
    }

    return {
      scrollTop: result,
      exact: posResult.exact,
      block,
    };
  }

  /**
   * 计算源码滚动位置（预览 -> 源码）
   */
  computeSourceScroll(
    previewScrollTop: number,
    previewViewportHeight: number,
    sourceLineHeight: number
  ): ScrollSyncResult {
    const result = this.heightMap.computeSourceScrollPosition(
      previewScrollTop,
      previewViewportHeight,
      sourceLineHeight
    );

    // 尝试找到对应的块
    const centerPosition = previewScrollTop + previewViewportHeight / 2;
    const lineResult = this.heightMap.getLineForPosition(centerPosition);

    let block: RenderBlock | undefined;
    if (lineResult.block) {
      block = this.blocks.get(lineResult.block.id);
    }

    return {
      scrollTop: result,
      exact: lineResult.exact,
      block,
    };
  }

  /**
   * 获取所有块
   */
  getBlocks(): RenderBlock[] {
    return this.blockOrder.map(id => this.blocks.get(id)!);
  }

  /**
   * 获取可见块
   */
  getVisibleBlocks(): RenderBlock[] {
    return this.blockOrder
      .map(id => this.blocks.get(id)!)
      .filter(block => block.visible);
  }

  /**
   * 获取块
   */
  getBlock(id: string): RenderBlock | undefined {
    return this.blocks.get(id);
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: PipelineEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const heightMapStats = this.heightMap.getStats();

    return {
      ...this.stats,
      blockCount: this.blocks.size,
      visibleBlockCount: this.getVisibleBlocks().length,
      heightMap: heightMapStats,
      scheduler: this.scheduler.getStats(),
    };
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.scheduler.destroy();
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    this.releaseAllBlocks();
    this.blockPool.clear();
    this.listeners.clear();
    this.heightMap.clear();
  }

  // ================================
  // 私有方法
  // ================================

  private isLineVisible(line: number): boolean {
    const padding = this.config.visibilityPadding;
    return (
      line >= this.visibleRange.startLine - padding &&
      line <= this.visibleRange.endLine + padding
    );
  }

  private updateRenderPositions(): void {
    let currentTop = 0;

    for (const blockId of this.blockOrder) {
      const block = this.blocks.get(blockId);
      if (!block) continue;

      block.renderTop = currentTop;
      currentTop += block.renderHeight;

      // 更新 HeightMap
      this.heightMap.updateBlockPosition(block.id, block.renderTop, block.renderHeight);
    }
  }

  private combineBlocksHtml(): string {
    const parts: string[] = [];

    for (const blockId of this.blockOrder) {
      const block = this.blocks.get(blockId);
      if (!block) continue;

      // 添加块容器，包含必要的属性
      parts.push(
        `<div class="latex-render-block" ` +
        `data-block-id="${block.id}" ` +
        `data-block-type="${block.type}" ` +
        `data-source-start-line="${block.sourceStartLine}" ` +
        `data-source-end-line="${block.sourceEndLine}" ` +
        `style="min-height: ${block.renderHeight}px;">` +
        block.html +
        `</div>`
      );
    }

    return parts.join('');
  }

  private releaseAllBlocks(): void {
    for (const block of this.blocks.values()) {
      this.blockPool.release(block);
    }
    this.blocks.clear();
    this.blockOrder.length = 0;
    this.heightMap.clear();
  }

  private mapBlockTypeToHeightType(type: RenderBlockType): import('./height-map').HeightBlockType {
    const mapping: Record<RenderBlockType, import('./height-map').HeightBlockType> = {
      'preamble': 'preamble',
      'section': 'section',
      'paragraph': 'paragraph',
      'math-block': 'math-block',
      'math-inline': 'paragraph',
      'list': 'list',
      'table': 'table',
      'code': 'code',
      'environment': 'environment',
      'command': 'command',
      'text': 'paragraph',
      'error': 'error',
      'unknown': 'paragraph',
    };
    return mapping[type] || 'paragraph';
  }

  private emit(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[RenderPipeline] 事件处理错误:', error);
      }
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建渲染管道
 */
export function createRenderPipeline(
  config?: Partial<RenderPipelineConfig>
): RenderPipeline {
  return new RenderPipeline(config);
}

/**
 * 创建高性能渲染管道
 */
export function createHighPerformancePipeline(): RenderPipeline {
  return new RenderPipeline({
    defaultLineHeight: 22,
    visibilityPadding: 30,
    maxConcurrentParse: 6,
    maxFrameTime: 6,
    useWorker: true,
    memoryThreshold: 300,
    enableDOMMeasurement: true,
    debug: false,
  });
}
