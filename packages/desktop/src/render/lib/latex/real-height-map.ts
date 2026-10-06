// ================================
// 真实高度测量系统
//
// 解决源码与渲染位置映射不准确的问题
// 核心思想：完全基于 DOM 实际测量，禁止使用估算值
//
// 设计参考：
// 1. VDOM 算法的高度协调机制
// 2. 虚拟滚动的精确定位需求
// 3. CodeMirror 的行高测量策略
// ================================

// ================================
// 类型定义
// ================================

/**
 * 渲染块信息
 */
export interface RenderBlock {
  /** 块 ID（与 data-block-id 对应） */
  id: string;
  /** 块类型 */
  type: BlockType;
  /** 源码起始行（1-based） */
  sourceStartLine: number;
  /** 源码结束行（1-based） */
  sourceEndLine: number;
  /** 源码起始偏移量 */
  sourceStartOffset: number;
  /** 源码结束偏移量 */
  sourceEndOffset: number;
  /** 渲染位置：距离容器顶部的距离（像素） */
  renderTop: number;
  /** 渲染高度（像素） */
  renderHeight: number;
  /** 是否已测量（true = 真实值，false = 估算值） */
  measured: boolean;
  /** 测量时间戳 */
  measuredAt: number;
  /** 渲染优先级 */
  priority: number;
}

/**
 * 块类型
 */
export type BlockType =
  | 'document'
  | 'preamble'
  | 'section'
  | 'subsection'
  | 'subsubsection'
  | 'paragraph'
  | 'math-inline'
  | 'math-block'
  | 'list'
  | 'list-item'
  | 'table'
  | 'code'
  | 'environment'
  | 'command'
  | 'comment'
  | 'text'
  | 'error'
  | 'other';

/**
 * 位置查询结果
 */
export interface PositionQueryResult {
  /** 查询的源码行 */
  sourceLine: number;
  /** 对应的渲染位置（像素） */
  renderPosition: number;
  /** 是否精确（基于真实测量） */
  isExact: boolean;
  /** 置信度 (0-1) */
  confidence: number;
  /** 匹配的块 */
  block: RenderBlock | null;
  /** 前一个块 */
  prevBlock: RenderBlock | null;
  /** 后一个块 */
  nextBlock: RenderBlock | null;
}

/**
 * 行查询结果
 */
export interface LineQueryResult {
  /** 查询的渲染位置 */
  renderPosition: number;
  /** 对应的源码行 */
  sourceLine: number;
  /** 是否精确 */
  isExact: boolean;
  /** 置信度 */
  confidence: number;
  /** 匹配的块 */
  block: RenderBlock | null;
}

/**
 * 测量结果
 */
export interface MeasurementResult {
  /** 块 ID */
  id: string;
  /** 测量的顶部位置 */
  top: number;
  /** 测量的高度 */
  height: number;
  /** 元素是否可见 */
  visible: boolean;
}

/**
 * 配置
 */
export interface RealHeightMapConfig {
  /** 默认行高估算（仅用于未测量块的初始估算） */
  defaultLineHeight: number;
  /** 容器高度 */
  containerHeight: number;
  /** 视口高度 */
  viewportHeight: number;
  /** 测量过期时间（毫秒） */
  measurementTTL: number;
  /** 是否启用调试日志 */
  debug: boolean;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: RealHeightMapConfig = {
  defaultLineHeight: 24,
  containerHeight: 0,
  viewportHeight: 600,
  measurementTTL: 5000, // 5秒后重新测量
  debug: false,
};

// ================================
// 工具函数
// ================================

/**
 * 二分查找
 * 返回目标值所在下标（exact 为 true），或第一个大于目标值的插入位置
 */
function binarySearch<T>(
  arr: T[],
  target: number,
  accessor: (item: T) => number
): { index: number; exact: boolean } {
  let low = 0;
  let high = arr.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = accessor(arr[mid]);

    if (value === target) {
      return { index: mid, exact: true };
    } else if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return { index: low, exact: false };
}

// ================================
// RealHeightMap 类
// ================================

/**
 * 真实高度映射
 *
 * 维护源码行与渲染位置的精确映射，完全基于 DOM 测量
 */
export class RealHeightMap {
  private config: RealHeightMapConfig;

  /** 所有块，按源码位置排序 */
  private blocks: RenderBlock[] = [];

  /** 块索引（id -> block） */
  private blockIndex: Map<string, RenderBlock> = new Map();

  /** 行到块的快速映射 */
  private lineToBlockMap: Map<number, RenderBlock> = new Map();

  /** 已测量块的数量 */
  private measuredCount: number = 0;

  /** 总渲染高度（已测量） */
  private totalMeasuredHeight: number = 0;

  /** 版本号（每次更新递增） */
  private version: number = 0;

  /** 总源码行数 */
  private totalLines: number = 0;

  constructor(config?: Partial<RealHeightMapConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 初始化和配置
  // ================================

  /**
   * 设置总行数
   */
  setTotalLines(lines: number): void {
    this.totalLines = lines;
  }

  /**
   * 获取总行数
   */
  getTotalLines(): number {
    return this.totalLines;
  }

  /**
   * 设置容器高度
   */
  setContainerHeight(height: number): void {
    this.config.containerHeight = height;
  }

  /**
   * 设置视口高度
   */
  setViewportHeight(height: number): void {
    this.config.viewportHeight = height;
  }

  /**
   * 获取配置
   */
  getConfig(): RealHeightMapConfig {
    return { ...this.config };
  }

  // ================================
  // 块管理
  // ================================

  /**
   * 添加块（初始估算）
   */
  addBlock(block: Omit<RenderBlock, 'measured' | 'measuredAt'>): void {
    const fullBlock: RenderBlock = {
      ...block,
      measured: false,
      measuredAt: 0,
    };

    // 检查是否已存在
    const existing = this.blockIndex.get(block.id);
    if (existing) {
      // 更新现有块（保留测量状态）
      Object.assign(existing, {
        ...block,
        measured: existing.measured,
        measuredAt: existing.measuredAt,
        renderTop: existing.measured ? existing.renderTop : block.renderTop,
        renderHeight: existing.measured ? existing.renderHeight : block.renderHeight,
      });
      this.rebuildLineMap();
      return;
    }

    this.blocks.push(fullBlock);
    this.blockIndex.set(block.id, fullBlock);

    // 排序并重建索引
    this.sortBlocks();
    this.rebuildLineMap();
    this.version++;
  }

  /**
   * 批量添加块
   */
  addBlocks(blocks: Array<Omit<RenderBlock, 'measured' | 'measuredAt'>>): void {
    for (const block of blocks) {
      const fullBlock: RenderBlock = {
        ...block,
        measured: false,
        measuredAt: 0,
      };

      const existing = this.blockIndex.get(block.id);
      if (existing) {
        Object.assign(existing, {
          ...block,
          measured: existing.measured,
          measuredAt: existing.measuredAt,
          renderTop: existing.measured ? existing.renderTop : block.renderTop,
          renderHeight: existing.measured ? existing.renderHeight : block.renderHeight,
        });
      } else {
        this.blocks.push(fullBlock);
        this.blockIndex.set(block.id, fullBlock);
      }
    }

    this.sortBlocks();
    this.rebuildLineMap();
    this.version++;
  }

  /**
   * 排序块
   */
  private sortBlocks(): void {
    this.blocks.sort((a, b) => a.sourceStartLine - b.sourceStartLine);
  }

  /**
   * 重建行到块的映射
   */
  private rebuildLineMap(): void {
    this.lineToBlockMap.clear();
    for (const block of this.blocks) {
      for (let line = block.sourceStartLine; line <= block.sourceEndLine; line++) {
        // 优先使用更高优先级或更精确的块
        const existing = this.lineToBlockMap.get(line);
        if (
          !existing ||
          block.priority > existing.priority ||
          (block.measured && !existing.measured)
        ) {
          this.lineToBlockMap.set(line, block);
        }
      }
    }
  }

  /**
   * 移除块
   */
  removeBlock(id: string): boolean {
    const block = this.blockIndex.get(id);
    if (!block) return false;

    const index = this.blocks.indexOf(block);
    if (index >= 0) {
      this.blocks.splice(index, 1);
    }

    this.blockIndex.delete(id);

    if (block.measured) {
      this.measuredCount--;
      this.totalMeasuredHeight -= block.renderHeight;
    }

    this.rebuildLineMap();
    this.version++;
    return true;
  }

  /**
   * 清空所有块
   */
  clear(): void {
    this.blocks = [];
    this.blockIndex.clear();
    this.lineToBlockMap.clear();
    this.measuredCount = 0;
    this.totalMeasuredHeight = 0;
    this.version++;
  }

  /**
   * 获取块
   */
  getBlock(id: string): RenderBlock | undefined {
    return this.blockIndex.get(id);
  }

  /**
   * 获取所有块
   */
  getAllBlocks(): RenderBlock[] {
    return [...this.blocks];
  }

  // ================================
  // DOM 测量（核心功能）
  // ================================

  /**
   * 更新块的真实测量值
   * 这是核心方法，确保使用真实 DOM 高度
   */
  updateBlockMeasurement(id: string, top: number, height: number): boolean {
    const block = this.blockIndex.get(id);
    if (!block) return false;

    const wasMeasured = block.measured;
    const oldHeight = block.renderHeight;

    block.renderTop = top;
    block.renderHeight = height;
    block.measured = true;
    block.measuredAt = Date.now();

    if (!wasMeasured) {
      this.measuredCount++;
    }

    // 更新总高度
    this.totalMeasuredHeight += height - (wasMeasured ? oldHeight : 0);

    this.version++;

    if (this.config.debug) {
      console.log(
        `[RealHeightMap] 测量块 ${id}: top=${top.toFixed(1)}, height=${height.toFixed(1)}`
      );
    }

    return true;
  }

  /**
   * 批量更新测量值
   */
  updateMeasurements(measurements: MeasurementResult[]): number {
    let updated = 0;

    for (const m of measurements) {
      if (this.updateBlockMeasurement(m.id, m.top, m.height)) {
        updated++;
      }
    }

    // 重新计算所有块的位置（级联更新）
    if (updated > 0) {
      this.recalculatePositions();
    }

    return updated;
  }

  /**
   * 重新计算所有块的位置
   * 基于已测量块的位置，更新未测量块的估算位置
   */
  private recalculatePositions(): void {
    if (this.blocks.length === 0) return;

    // 按源码位置排序
    this.sortBlocks();

    let currentTop = 0;
    let lastMeasuredEndLine = 0;

    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];

      if (block.measured) {
        // 已测量块：使用实际值
        currentTop = block.renderTop + block.renderHeight;
        lastMeasuredEndLine = block.sourceEndLine;
      } else {
        // 未测量块：基于最近的已测量块估算
        if (lastMeasuredEndLine > 0) {
          // 根据行数差异估算位置
          const lineGap = block.sourceStartLine - lastMeasuredEndLine;
          const estimatedGap = lineGap * this.config.defaultLineHeight;
          block.renderTop = currentTop + estimatedGap;
        } else {
          block.renderTop = currentTop;
        }

        // 估算高度
        const lineCount = block.sourceEndLine - block.sourceStartLine + 1;
        block.renderHeight = this.estimateHeight(block.type, lineCount);

        currentTop = block.renderTop + block.renderHeight;
      }
    }

    // 更新容器高度
    if (this.blocks.length > 0) {
      const lastBlock = this.blocks[this.blocks.length - 1];
      this.config.containerHeight = lastBlock.renderTop + lastBlock.renderHeight;
    }
  }

  /**
   * 估算块高度（仅用于未测量块）
   */
  private estimateHeight(type: BlockType, lineCount: number): number {
    const baseHeight = lineCount * this.config.defaultLineHeight;

    // 根据类型调整估算
    switch (type) {
      case 'section':
        return Math.max(40, baseHeight * 1.5);
      case 'subsection':
        return Math.max(36, baseHeight * 1.3);
      case 'subsubsection':
        return Math.max(32, baseHeight * 1.2);
      case 'math-block':
        return Math.max(60, baseHeight * 2);
      case 'table':
        return Math.max(100, baseHeight * 1.5);
      case 'code':
        return baseHeight * 1.2;
      case 'list':
        return baseHeight * 1.1;
      default:
        return baseHeight;
    }
  }

  // ================================
  // 位置查询
  // ================================

  /**
   * 根据源码行查询渲染位置
   */
  getPositionForLine(line: number): PositionQueryResult {
    // 直接从行映射查找
    const block = this.lineToBlockMap.get(line);

    if (block) {
      // 计算行在块内的偏移
      const lineOffset = line - block.sourceStartLine;
      const lineCount = block.sourceEndLine - block.sourceStartLine + 1;
      const ratio = lineCount > 1 ? lineOffset / (lineCount - 1) : 0;

      const renderPosition = block.renderTop + ratio * block.renderHeight;

      return {
        sourceLine: line,
        renderPosition,
        isExact: block.measured,
        confidence: block.measured ? 1.0 : 0.5,
        block,
        prevBlock: this.findPrevBlock(block),
        nextBlock: this.findNextBlock(block),
      };
    }

    // 没有直接映射，使用插值
    return this.interpolatePosition(line);
  }

  /**
   * 插值计算位置（当行没有直接对应的块时）
   */
  private interpolatePosition(line: number): PositionQueryResult {
    if (this.blocks.length === 0) {
      return {
        sourceLine: line,
        renderPosition: (line - 1) * this.config.defaultLineHeight,
        isExact: false,
        confidence: 0.1,
        block: null,
        prevBlock: null,
        nextBlock: null,
      };
    }

    // 找到最近的前后块：块按源码位置排序，二分定位第一个起始行大于 line 的块
    const { index, exact } = binarySearch(this.blocks, line, (block) => block.sourceStartLine);
    let nextIndex = exact ? index + 1 : index;
    while (nextIndex < this.blocks.length && this.blocks[nextIndex].sourceStartLine <= line) {
      nextIndex++;
    }
    const nextBlock: RenderBlock | null =
      nextIndex < this.blocks.length ? this.blocks[nextIndex] : null;

    // 前一个块：起始行不大于 line 且结束行小于 line 的最近块
    let prevBlock: RenderBlock | null = null;
    for (let i = nextIndex - 1; i >= 0; i--) {
      if (this.blocks[i].sourceEndLine < line) {
        prevBlock = this.blocks[i];
        break;
      }
    }

    // 插值
    if (prevBlock && nextBlock) {
      const prevEnd = prevBlock.renderTop + prevBlock.renderHeight;
      const nextStart = nextBlock.renderTop;
      const lineGap = nextBlock.sourceStartLine - prevBlock.sourceEndLine;
      const lineOffset = line - prevBlock.sourceEndLine;
      const ratio = lineGap > 0 ? lineOffset / lineGap : 0;
      const renderPosition = prevEnd + ratio * (nextStart - prevEnd);

      const avgConfidence =
        prevBlock.measured && nextBlock.measured
          ? 0.8
          : prevBlock.measured || nextBlock.measured
            ? 0.6
            : 0.3;

      return {
        sourceLine: line,
        renderPosition,
        isExact: false,
        confidence: avgConfidence,
        block: null,
        prevBlock,
        nextBlock,
      };
    } else if (prevBlock) {
      // 在最后一个块之后
      const prevEnd = prevBlock.renderTop + prevBlock.renderHeight;
      const lineOffset = line - prevBlock.sourceEndLine;
      const renderPosition = prevEnd + lineOffset * this.config.defaultLineHeight;

      return {
        sourceLine: line,
        renderPosition,
        isExact: false,
        confidence: prevBlock.measured ? 0.7 : 0.3,
        block: null,
        prevBlock,
        nextBlock: null,
      };
    } else if (nextBlock) {
      // 在第一个块之前
      const lineOffset = nextBlock.sourceStartLine - line;
      const renderPosition = Math.max(
        0,
        nextBlock.renderTop - lineOffset * this.config.defaultLineHeight
      );

      return {
        sourceLine: line,
        renderPosition,
        isExact: false,
        confidence: nextBlock.measured ? 0.7 : 0.3,
        block: null,
        prevBlock: null,
        nextBlock,
      };
    }

    // 没有任何块
    return {
      sourceLine: line,
      renderPosition: (line - 1) * this.config.defaultLineHeight,
      isExact: false,
      confidence: 0.1,
      block: null,
      prevBlock: null,
      nextBlock: null,
    };
  }

  /**
   * 根据渲染位置查询源码行
   */
  getLineForPosition(position: number): LineQueryResult {
    if (this.blocks.length === 0) {
      const line = Math.floor(position / this.config.defaultLineHeight) + 1;
      return {
        renderPosition: position,
        sourceLine: Math.max(1, Math.min(line, this.totalLines || line)),
        isExact: false,
        confidence: 0.1,
        block: null,
      };
    }

    // 二分查找
    let low = 0;
    let high = this.blocks.length - 1;
    let foundBlock: RenderBlock | null = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const block = this.blocks[mid];
      const blockEnd = block.renderTop + block.renderHeight;

      if (position >= block.renderTop && position < blockEnd) {
        foundBlock = block;
        break;
      } else if (position < block.renderTop) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    if (foundBlock) {
      // 在块内部，计算对应的行
      const posOffset = position - foundBlock.renderTop;
      const ratio = foundBlock.renderHeight > 0 ? posOffset / foundBlock.renderHeight : 0;
      const lineCount = foundBlock.sourceEndLine - foundBlock.sourceStartLine + 1;
      const lineOffset = Math.floor(ratio * lineCount);
      const sourceLine = Math.min(
        foundBlock.sourceStartLine + lineOffset,
        foundBlock.sourceEndLine
      );

      return {
        renderPosition: position,
        sourceLine,
        isExact: foundBlock.measured,
        confidence: foundBlock.measured ? 1.0 : 0.5,
        block: foundBlock,
      };
    }

    // 不在任何块内，插值
    return this.interpolateLine(position);
  }

  /**
   * 插值计算行号
   */
  private interpolateLine(position: number): LineQueryResult {
    let prevBlock: RenderBlock | null = null;
    let nextBlock: RenderBlock | null = null;

    for (const block of this.blocks) {
      if (block.renderTop + block.renderHeight <= position) {
        prevBlock = block;
      } else if (block.renderTop > position && !nextBlock) {
        nextBlock = block;
        break;
      }
    }

    if (prevBlock && nextBlock) {
      const prevEnd = prevBlock.renderTop + prevBlock.renderHeight;
      const gap = nextBlock.renderTop - prevEnd;
      const offset = position - prevEnd;
      const ratio = gap > 0 ? offset / gap : 0;
      const lineGap = nextBlock.sourceStartLine - prevBlock.sourceEndLine;
      const sourceLine = prevBlock.sourceEndLine + Math.floor(ratio * lineGap);

      return {
        renderPosition: position,
        sourceLine: Math.max(1, sourceLine),
        isExact: false,
        confidence: 0.5,
        block: null,
      };
    } else if (prevBlock) {
      const offset = position - (prevBlock.renderTop + prevBlock.renderHeight);
      const lineOffset = Math.floor(offset / this.config.defaultLineHeight);
      const sourceLine = prevBlock.sourceEndLine + lineOffset;

      return {
        renderPosition: position,
        sourceLine: Math.max(1, Math.min(sourceLine, this.totalLines || sourceLine)),
        isExact: false,
        confidence: 0.4,
        block: null,
      };
    } else if (nextBlock) {
      const offset = nextBlock.renderTop - position;
      const lineOffset = Math.floor(offset / this.config.defaultLineHeight);
      const sourceLine = nextBlock.sourceStartLine - lineOffset;

      return {
        renderPosition: position,
        sourceLine: Math.max(1, sourceLine),
        isExact: false,
        confidence: 0.4,
        block: null,
      };
    }

    // 回退
    const line = Math.floor(position / this.config.defaultLineHeight) + 1;
    return {
      renderPosition: position,
      sourceLine: Math.max(1, Math.min(line, this.totalLines || line)),
      isExact: false,
      confidence: 0.1,
      block: null,
    };
  }

  /**
   * 查找前一个块
   */
  private findPrevBlock(block: RenderBlock): RenderBlock | null {
    const index = this.blocks.indexOf(block);
    return index > 0 ? this.blocks[index - 1] : null;
  }

  /**
   * 查找后一个块
   */
  private findNextBlock(block: RenderBlock): RenderBlock | null {
    const index = this.blocks.indexOf(block);
    return index >= 0 && index < this.blocks.length - 1 ? this.blocks[index + 1] : null;
  }

  // ================================
  // 滚动同步
  // ================================

  /**
   * 计算预览滚动位置（源码滚动 -> 预览滚动）
   */
  computePreviewScrollPosition(
    sourceScrollTop: number,
    sourceViewportHeight: number,
    sourceContentHeight: number
  ): number {
    if (sourceContentHeight <= 0 || this.totalLines <= 0) {
      return 0;
    }

    // 计算源码当前可见的中心行
    const sourceLineHeight = sourceContentHeight / this.totalLines;
    const centerOffset = sourceScrollTop + sourceViewportHeight / 2;
    const centerLine = Math.max(1, Math.floor(centerOffset / sourceLineHeight) + 1);

    // 查询对应的渲染位置
    const result = this.getPositionForLine(centerLine);

    // 计算预览滚动位置（将中心位置放到视口中心）
    const previewCenter = result.renderPosition;
    const previewScrollTop = previewCenter - this.config.viewportHeight / 2;

    // 限制范围
    const maxScroll = Math.max(0, this.config.containerHeight - this.config.viewportHeight);
    return Math.max(0, Math.min(previewScrollTop, maxScroll));
  }

  /**
   * 计算源码滚动位置（预览滚动 -> 源码滚动）
   */
  computeSourceScrollPosition(
    previewScrollTop: number,
    sourceViewportHeight: number,
    sourceContentHeight: number
  ): number {
    if (this.config.containerHeight <= 0 || this.totalLines <= 0) {
      return 0;
    }

    // 计算预览当前可见的中心位置
    const centerPosition = previewScrollTop + this.config.viewportHeight / 2;

    // 查询对应的源码行
    const result = this.getLineForPosition(centerPosition);

    // 计算源码滚动位置（将中心行放到视口中心）
    const sourceLineHeight = sourceContentHeight / this.totalLines;
    const sourceCenterOffset = (result.sourceLine - 1) * sourceLineHeight;
    const sourceScrollTop = sourceCenterOffset - sourceViewportHeight / 2;

    // 限制范围
    const maxScroll = Math.max(0, sourceContentHeight - sourceViewportHeight);
    return Math.max(0, Math.min(sourceScrollTop, maxScroll));
  }

  // ================================
  // 统计和调试
  // ================================

  /**
   * 获取测量进度
   */
  getMeasurementProgress(): { measured: number; total: number; rate: number } {
    const total = this.blocks.length;
    const measured = this.measuredCount;
    return {
      measured,
      total,
      rate: total > 0 ? measured / total : 0,
    };
  }

  /**
   * 获取版本号
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * 获取容器高度
   */
  getContainerHeight(): number {
    return this.config.containerHeight;
  }

  /**
   * 获取未测量的块
   */
  getUnmeasuredBlocks(): RenderBlock[] {
    return this.blocks.filter((b) => !b.measured);
  }

  /**
   * 获取需要重新测量的块（过期的）
   */
  getStaleBlocks(): RenderBlock[] {
    const now = Date.now();
    const ttl = this.config.measurementTTL;
    return this.blocks.filter((b) => b.measured && now - b.measuredAt > ttl);
  }

  /**
   * 获取可见区域的块
   */
  getVisibleBlocks(scrollTop: number, viewportHeight: number): RenderBlock[] {
    const viewportBottom = scrollTop + viewportHeight;
    return this.blocks.filter((block) => {
      const blockBottom = block.renderTop + block.renderHeight;
      return blockBottom > scrollTop && block.renderTop < viewportBottom;
    });
  }

  /**
   * 调试：打印所有块信息
   */
  debugPrint(): void {
    console.group('[RealHeightMap] Debug Info');
    console.log(`Total blocks: ${this.blocks.length}`);
    console.log(
      `Measured: ${this.measuredCount} (${((this.measuredCount / this.blocks.length) * 100).toFixed(1)}%)`
    );
    console.log(`Container height: ${this.config.containerHeight}px`);
    console.log(`Total lines: ${this.totalLines}`);
    console.log(`Version: ${this.version}`);

    console.group('Blocks:');
    for (const block of this.blocks) {
      console.log(
        `${block.id}: L${block.sourceStartLine}-${block.sourceEndLine} ` +
          `-> ${block.renderTop.toFixed(1)}-${(block.renderTop + block.renderHeight).toFixed(1)}px ` +
          `(${block.measured ? 'measured' : 'estimated'})`
      );
    }
    console.groupEnd();
    console.groupEnd();
  }
}

// ================================
// DOM 测量工具函数
// ================================

/**
 * 测量容器内所有带 data-block-id 属性的元素
 */
export function measureBlockElements(
  container: HTMLElement,
  options?: {
    blockSelector?: string;
    blockIdAttribute?: string;
    visibleOnly?: boolean;
  }
): MeasurementResult[] {
  const {
    blockSelector = '[data-block-id]',
    blockIdAttribute = 'data-block-id',
    visibleOnly = false,
  } = options || {};

  const measurements: MeasurementResult[] = [];
  const containerRect = container.getBoundingClientRect();
  const containerScrollTop = container.scrollTop;

  const elements = container.querySelectorAll(blockSelector);

  for (const element of elements) {
    const id = element.getAttribute(blockIdAttribute);
    if (!id) continue;

    const rect = element.getBoundingClientRect();
    const top = rect.top - containerRect.top + containerScrollTop;
    const height = rect.height;

    // 检查是否可见
    const visible = rect.bottom > containerRect.top && rect.top < containerRect.bottom;

    if (visibleOnly && !visible) continue;

    measurements.push({
      id,
      top,
      height,
      visible,
    });
  }

  return measurements;
}

/**
 * 创建 ResizeObserver 监听块尺寸变化
 */
export function createBlockResizeObserver(
  container: HTMLElement,
  heightMap: RealHeightMap,
  options?: {
    blockSelector?: string;
    blockIdAttribute?: string;
    debounceMs?: number;
  }
): ResizeObserver {
  const {
    blockSelector = '[data-block-id]',
    blockIdAttribute = 'data-block-id',
    debounceMs = 100,
  } = options || {};

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const pendingUpdates: Map<string, { top: number; height: number }> = new Map();

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      const id = element.getAttribute(blockIdAttribute);
      if (!id) continue;

      const containerRect = container.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const top = rect.top - containerRect.top + container.scrollTop;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? rect.height;

      pendingUpdates.set(id, { top, height });
    }

    // 防抖更新
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      const measurements: MeasurementResult[] = [];
      for (const [id, { top, height }] of pendingUpdates) {
        measurements.push({ id, top, height, visible: true });
      }
      pendingUpdates.clear();

      if (measurements.length > 0) {
        heightMap.updateMeasurements(measurements);
      }
    }, debounceMs);
  });

  // 观察所有块元素
  const elements = container.querySelectorAll(blockSelector);
  for (const element of elements) {
    observer.observe(element);
  }

  return observer;
}

/**
 * 创建 IntersectionObserver 监听块可见性
 */
export function createBlockVisibilityObserver(
  container: HTMLElement,
  onVisibilityChange: (id: string, visible: boolean, ratio: number) => void,
  options?: {
    blockSelector?: string;
    blockIdAttribute?: string;
    threshold?: number | number[];
    rootMargin?: string;
  }
): IntersectionObserver {
  const {
    blockSelector = '[data-block-id]',
    blockIdAttribute = 'data-block-id',
    threshold = [0, 0.5, 1],
    rootMargin = '50px',
  } = options || {};

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const id = element.getAttribute(blockIdAttribute);
        if (!id) continue;

        onVisibilityChange(id, entry.isIntersecting, entry.intersectionRatio);
      }
    },
    {
      root: container,
      threshold,
      rootMargin,
    }
  );

  // 观察所有块元素
  const elements = container.querySelectorAll(blockSelector);
  for (const element of elements) {
    observer.observe(element);
  }

  return observer;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 RealHeightMap 实例
 */
export function createRealHeightMap(config?: Partial<RealHeightMapConfig>): RealHeightMap {
  return new RealHeightMap(config);
}
