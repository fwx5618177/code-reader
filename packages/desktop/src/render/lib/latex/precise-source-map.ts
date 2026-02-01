// ================================
// 精确 Source Map 实现
// 基于 DOM 测量的真实位置映射，支持双向查询
// ================================

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
 * Source Map 条目
 */
export interface SourceMapEntry {
  /** 条目 ID */
  id: string;
  /** 块类型 */
  blockType: BlockType;
  /** 源码起始行（1-based） */
  sourceStartLine: number;
  /** 源码结束行（1-based） */
  sourceEndLine: number;
  /** 源码起始偏移（字节） */
  sourceStartOffset: number;
  /** 源码结束偏移（字节） */
  sourceEndOffset: number;
  /** 渲染位置（像素，相对于容器顶部） */
  renderTop: number;
  /** 渲染高度（像素） */
  renderHeight: number;
  /** 优先级（用于冲突解决） */
  priority: number;
  /** 是否已测量（true 表示使用 DOM 测量值） */
  measured: boolean;
}

/**
 * 位置查询结果
 */
export interface PositionQueryResult {
  /** 是否精确匹配 */
  exact: boolean;
  /** 匹配的条目（可能为 null） */
  entry: SourceMapEntry | null;
  /** 插值计算的位置 */
  interpolatedPosition: number;
  /** 前一个条目 */
  prevEntry: SourceMapEntry | null;
  /** 后一个条目 */
  nextEntry: SourceMapEntry | null;
}

/**
 * 行号查询结果
 */
export interface LineQueryResult {
  /** 是否精确匹配 */
  exact: boolean;
  /** 匹配的条目（可能为 null） */
  entry: SourceMapEntry | null;
  /** 插值计算的行号 */
  interpolatedLine: number;
  /** 前一个条目 */
  prevEntry: SourceMapEntry | null;
  /** 后一个条目 */
  nextEntry: SourceMapEntry | null;
}

/**
 * DOM 测量信息
 */
export interface DOMBlockMeasurement {
  /** 块 ID（对应 data-block-id 属性） */
  id: string;
  /** 距离容器顶部的距离（像素） */
  top: number;
  /** 块高度（像素） */
  height: number;
}

/**
 * Source Map 配置
 */
export interface PreciseSourceMapConfig {
  /** 默认行高（用于估算未测量的块） */
  defaultLineHeight: number;
  /** 容器总高度 */
  containerHeight: number;
  /** 是否启用调试日志 */
  debug: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: PreciseSourceMapConfig = {
  defaultLineHeight: 22,
  containerHeight: 0,
  debug: false,
};

/**
 * 条目 ID 计数器
 */
let entryIdCounter = 0;

/**
 * 生成条目 ID
 */
function generateEntryId(): string {
  return `entry_${++entryIdCounter}_${Date.now().toString(36)}`;
}

/**
 * 精确 Source Map
 * 使用 B+ 树结构进行高效的范围查询
 */
export class PreciseSourceMap {
  private config: PreciseSourceMapConfig;

  // 按源码行排序的条目
  private entriesByLine: SourceMapEntry[] = [];

  // 按渲染位置排序的条目
  private entriesByPosition: SourceMapEntry[] = [];

  // ID 到条目的映射
  private entriesById: Map<string, SourceMapEntry> = new Map();

  // 是否需要重新排序
  private needsSort: boolean = false;

  // 源码总行数
  private totalLines: number = 0;

  // 渲染容器总高度
  private containerHeight: number = 0;

  // 测量完成的条目数
  private measuredCount: number = 0;

  constructor(config: Partial<PreciseSourceMapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.containerHeight = this.config.containerHeight;
  }

  /**
   * 设置源码总行数
   */
  setTotalLines(lines: number): void {
    this.totalLines = lines;
  }

  /**
   * 设置容器高度
   */
  setContainerHeight(height: number): void {
    this.containerHeight = height;
    this.config.containerHeight = height;
  }

  /**
   * 添加条目
   */
  addEntry(entry: Omit<SourceMapEntry, 'id'> & { id?: string }): string {
    const id = entry.id || generateEntryId();
    const fullEntry: SourceMapEntry = {
      ...entry,
      id,
      measured: entry.measured ?? false,
    };

    this.entriesById.set(id, fullEntry);
    this.entriesByLine.push(fullEntry);
    this.entriesByPosition.push(fullEntry);
    this.needsSort = true;

    if (fullEntry.measured) {
      this.measuredCount++;
    }

    return id;
  }

  /**
   * 批量添加条目
   */
  addEntries(entries: Array<Omit<SourceMapEntry, 'id'> & { id?: string }>): string[] {
    const ids: string[] = [];
    for (const entry of entries) {
      ids.push(this.addEntry(entry));
    }
    return ids;
  }

  /**
   * 从 AST 节点创建条目
   */
  addFromNode(node: {
    id: string;
    type: string;
    start: number;
    end: number;
  }, lineOffsets: number[], estimatedHeight?: number): string {
    const sourceStartLine = this.getLineFromOffset(node.start, lineOffsets);
    const sourceEndLine = this.getLineFromOffset(node.end, lineOffsets);
    const lineCount = sourceEndLine - sourceStartLine + 1;
    const height = estimatedHeight ?? lineCount * this.config.defaultLineHeight;

    return this.addEntry({
      id: node.id,
      blockType: this.mapNodeTypeToBlockType(node.type),
      sourceStartLine,
      sourceEndLine,
      sourceStartOffset: node.start,
      sourceEndOffset: node.end,
      renderTop: 0, // 稍后通过 DOM 测量更新
      renderHeight: height,
      priority: this.computePriority(node.type),
      measured: false,
    });
  }

  /**
   * 更新条目的渲染位置（来自 DOM 测量）
   */
  updateRenderPosition(id: string, top: number, height: number): boolean {
    const entry = this.entriesById.get(id);
    if (!entry) return false;

    const wasMeasured = entry.measured;
    entry.renderTop = top;
    entry.renderHeight = height;
    entry.measured = true;

    if (!wasMeasured) {
      this.measuredCount++;
    }

    this.needsSort = true;
    return true;
  }

  /**
   * 批量更新渲染位置（来自 DOM 测量）
   */
  updateRenderPositions(measurements: DOMBlockMeasurement[]): number {
    let updated = 0;
    for (const measurement of measurements) {
      if (this.updateRenderPosition(measurement.id, measurement.top, measurement.height)) {
        updated++;
      }
    }
    return updated;
  }

  /**
   * 根据源码行号查询渲染位置
   */
  getPositionForLine(line: number): PositionQueryResult {
    this.ensureSorted();

    if (this.entriesByLine.length === 0) {
      return {
        exact: false,
        entry: null,
        interpolatedPosition: this.estimatePositionForLine(line),
        prevEntry: null,
        nextEntry: null,
      };
    }

    // 二分查找包含该行的条目
    let low = 0;
    let high = this.entriesByLine.length - 1;
    let exactMatch: SourceMapEntry | null = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const entry = this.entriesByLine[mid];

      if (line >= entry.sourceStartLine && line <= entry.sourceEndLine) {
        exactMatch = entry;
        break;
      } else if (line < entry.sourceStartLine) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    if (exactMatch) {
      // 精确匹配：在块内进行线性插值
      const lineRange = exactMatch.sourceEndLine - exactMatch.sourceStartLine;
      const lineOffset = line - exactMatch.sourceStartLine;
      const positionOffset = lineRange > 0
        ? (lineOffset / lineRange) * exactMatch.renderHeight
        : 0;

      return {
        exact: true,
        entry: exactMatch,
        interpolatedPosition: exactMatch.renderTop + positionOffset,
        prevEntry: this.findPrevEntry(exactMatch, this.entriesByLine),
        nextEntry: this.findNextEntry(exactMatch, this.entriesByLine),
      };
    }

    // 未精确匹配：在相邻条目之间插值
    const prevEntry = this.findEntryBeforeLine(line);
    const nextEntry = this.findEntryAfterLine(line);

    let interpolatedPosition = 0;

    if (prevEntry && nextEntry) {
      // 在两个条目之间插值
      const prevEnd = prevEntry.sourceEndLine;
      const nextStart = nextEntry.sourceStartLine;
      const prevRenderEnd = prevEntry.renderTop + prevEntry.renderHeight;
      const lineGap = nextStart - prevEnd;
      const lineOffset = line - prevEnd;
      const posGap = nextEntry.renderTop - prevRenderEnd;

      interpolatedPosition = prevRenderEnd + (lineGap > 0 ? (lineOffset / lineGap) * posGap : 0);
    } else if (prevEntry) {
      // 在最后一个条目之后
      const prevRenderEnd = prevEntry.renderTop + prevEntry.renderHeight;
      const lineAfterPrev = line - prevEntry.sourceEndLine;
      const linesRemaining = Math.max(1, this.totalLines - prevEntry.sourceEndLine);
      const posRemaining = Math.max(0, this.containerHeight - prevRenderEnd);

      interpolatedPosition = prevRenderEnd + (lineAfterPrev / linesRemaining) * posRemaining;
    } else if (nextEntry) {
      // 在第一个条目之前
      const lineOffset = line - 1;
      const lineGap = nextEntry.sourceStartLine - 1;

      interpolatedPosition = lineGap > 0
        ? (lineOffset / lineGap) * nextEntry.renderTop
        : 0;
    } else {
      // 没有条目，使用估算
      interpolatedPosition = this.estimatePositionForLine(line);
    }

    return {
      exact: false,
      entry: null,
      interpolatedPosition,
      prevEntry,
      nextEntry,
    };
  }

  /**
   * 根据渲染位置查询源码行号
   */
  getLineForPosition(position: number): LineQueryResult {
    this.ensureSorted();

    if (this.entriesByPosition.length === 0) {
      return {
        exact: false,
        entry: null,
        interpolatedLine: this.estimateLineForPosition(position),
        prevEntry: null,
        nextEntry: null,
      };
    }

    // 二分查找包含该位置的条目
    let low = 0;
    let high = this.entriesByPosition.length - 1;
    let exactMatch: SourceMapEntry | null = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const entry = this.entriesByPosition[mid];
      const entryEnd = entry.renderTop + entry.renderHeight;

      if (position >= entry.renderTop && position <= entryEnd) {
        exactMatch = entry;
        break;
      } else if (position < entry.renderTop) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    if (exactMatch) {
      // 精确匹配：在块内进行线性插值
      const posRange = exactMatch.renderHeight;
      const lineRange = exactMatch.sourceEndLine - exactMatch.sourceStartLine;
      const posOffset = position - exactMatch.renderTop;
      const lineOffset = posRange > 0
        ? (posOffset / posRange) * lineRange
        : 0;

      return {
        exact: true,
        entry: exactMatch,
        interpolatedLine: Math.round(exactMatch.sourceStartLine + lineOffset),
        prevEntry: this.findPrevEntry(exactMatch, this.entriesByPosition),
        nextEntry: this.findNextEntry(exactMatch, this.entriesByPosition),
      };
    }

    // 未精确匹配：在相邻条目之间插值
    const prevEntry = this.findEntryBeforePosition(position);
    const nextEntry = this.findEntryAfterPosition(position);

    let interpolatedLine = 1;

    if (prevEntry && nextEntry) {
      const prevRenderEnd = prevEntry.renderTop + prevEntry.renderHeight;
      const posGap = nextEntry.renderTop - prevRenderEnd;
      const posOffset = position - prevRenderEnd;
      const lineGap = nextEntry.sourceStartLine - prevEntry.sourceEndLine;

      interpolatedLine = prevEntry.sourceEndLine +
        (posGap > 0 ? Math.round((posOffset / posGap) * lineGap) : 0);
    } else if (prevEntry) {
      const prevRenderEnd = prevEntry.renderTop + prevEntry.renderHeight;
      const posAfterPrev = position - prevRenderEnd;
      const posRemaining = Math.max(1, this.containerHeight - prevRenderEnd);
      const linesRemaining = Math.max(1, this.totalLines - prevEntry.sourceEndLine);

      interpolatedLine = prevEntry.sourceEndLine +
        Math.round((posAfterPrev / posRemaining) * linesRemaining);
    } else if (nextEntry) {
      const posOffset = position;
      const posGap = nextEntry.renderTop;
      const lineGap = nextEntry.sourceStartLine - 1;

      interpolatedLine = 1 + (posGap > 0 ? Math.round((posOffset / posGap) * lineGap) : 0);
    } else {
      interpolatedLine = this.estimateLineForPosition(position);
    }

    return {
      exact: false,
      entry: null,
      interpolatedLine: Math.max(1, Math.min(this.totalLines, interpolatedLine)),
      prevEntry,
      nextEntry,
    };
  }

  /**
   * 获取行范围内的所有条目
   */
  getEntriesInLineRange(startLine: number, endLine: number): SourceMapEntry[] {
    this.ensureSorted();
    return this.entriesByLine.filter(
      (entry) => entry.sourceStartLine <= endLine && entry.sourceEndLine >= startLine
    );
  }

  /**
   * 获取位置范围内的所有条目
   */
  getEntriesInPositionRange(startPos: number, endPos: number): SourceMapEntry[] {
    this.ensureSorted();
    return this.entriesByPosition.filter(
      (entry) => entry.renderTop <= endPos && entry.renderTop + entry.renderHeight >= startPos
    );
  }

  /**
   * 获取可见条目
   */
  getVisibleEntries(viewportTop: number, viewportHeight: number): SourceMapEntry[] {
    return this.getEntriesInPositionRange(viewportTop, viewportTop + viewportHeight);
  }

  /**
   * 获取所有条目
   */
  getAllEntries(): SourceMapEntry[] {
    this.ensureSorted();
    return [...this.entriesByLine];
  }

  /**
   * 获取条目
   */
  getEntry(id: string): SourceMapEntry | undefined {
    return this.entriesById.get(id);
  }

  /**
   * 删除条目
   */
  removeEntry(id: string): boolean {
    const entry = this.entriesById.get(id);
    if (!entry) return false;

    this.entriesById.delete(id);

    const lineIndex = this.entriesByLine.indexOf(entry);
    if (lineIndex !== -1) {
      this.entriesByLine.splice(lineIndex, 1);
    }

    const posIndex = this.entriesByPosition.indexOf(entry);
    if (posIndex !== -1) {
      this.entriesByPosition.splice(posIndex, 1);
    }

    if (entry.measured) {
      this.measuredCount--;
    }

    return true;
  }

  /**
   * 清空所有条目
   */
  clear(): void {
    this.entriesByLine = [];
    this.entriesByPosition = [];
    this.entriesById.clear();
    this.needsSort = false;
    this.measuredCount = 0;
  }

  /**
   * 获取条目数量
   */
  get entryCount(): number {
    return this.entriesById.size;
  }

  /**
   * 获取测量完成率
   */
  get measurementRate(): number {
    return this.entryCount > 0 ? this.measuredCount / this.entryCount : 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    entryCount: number;
    measuredCount: number;
    measurementRate: number;
    totalLines: number;
    containerHeight: number;
    blockTypeCounts: Record<BlockType, number>;
  } {
    const blockTypeCounts: Record<BlockType, number> = {
      'document': 0,
      'preamble': 0,
      'section': 0,
      'subsection': 0,
      'subsubsection': 0,
      'paragraph': 0,
      'math-inline': 0,
      'math-block': 0,
      'list': 0,
      'list-item': 0,
      'table': 0,
      'code': 0,
      'environment': 0,
      'command': 0,
      'comment': 0,
      'text': 0,
      'error': 0,
      'other': 0,
    };

    for (const entry of this.entriesByLine) {
      blockTypeCounts[entry.blockType]++;
    }

    return {
      entryCount: this.entryCount,
      measuredCount: this.measuredCount,
      measurementRate: this.measurementRate,
      totalLines: this.totalLines,
      containerHeight: this.containerHeight,
      blockTypeCounts,
    };
  }

  /**
   * 计算滚动同步位置（源码 -> 预览）
   */
  computePreviewScrollPosition(
    sourceScrollTop: number,
    sourceClientHeight: number,
    sourceTotalHeight: number
  ): number {
    // 计算源码可见区域的中心行
    const scrollRatio = sourceTotalHeight > 0
      ? sourceScrollTop / sourceTotalHeight
      : 0;
    const centerLine = Math.floor(this.totalLines * scrollRatio);

    // 查询对应的渲染位置
    const result = this.getPositionForLine(centerLine);

    if (result.exact && result.entry) {
      // 精确匹配：返回块的中心位置
      return result.entry.renderTop + result.entry.renderHeight / 2 - sourceClientHeight / 2;
    }

    // 使用插值位置
    return Math.max(0, result.interpolatedPosition - sourceClientHeight / 2);
  }

  /**
   * 计算滚动同步位置（预览 -> 源码）
   */
  computeSourceScrollPosition(
    previewScrollTop: number,
    previewClientHeight: number,
    sourceTotalHeight: number
  ): number {
    // 计算预览可见区域的中心位置
    const viewportCenter = previewScrollTop + previewClientHeight / 2;

    // 查询对应的源码行
    const result = this.getLineForPosition(viewportCenter);

    // 计算源码滚动位置
    const lineRatio = this.totalLines > 0
      ? (result.interpolatedLine - 1) / this.totalLines
      : 0;

    return Math.max(0, lineRatio * sourceTotalHeight - previewClientHeight / 2);
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 确保条目已排序
   */
  private ensureSorted(): void {
    if (!this.needsSort) return;

    // 按源码行排序
    this.entriesByLine.sort((a, b) => {
      if (a.sourceStartLine !== b.sourceStartLine) {
        return a.sourceStartLine - b.sourceStartLine;
      }
      // 同一行时，优先级高的排前面
      return b.priority - a.priority;
    });

    // 按渲染位置排序
    this.entriesByPosition.sort((a, b) => {
      if (a.renderTop !== b.renderTop) {
        return a.renderTop - b.renderTop;
      }
      return b.priority - a.priority;
    });

    this.needsSort = false;
  }

  /**
   * 从偏移获取行号
   */
  private getLineFromOffset(offset: number, lineOffsets: number[]): number {
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
    return low + 1;
  }

  /**
   * 映射节点类型到块类型
   */
  private mapNodeTypeToBlockType(nodeType: string): BlockType {
    const typeMap: Record<string, BlockType> = {
      'root': 'document',
      'preamble': 'preamble',
      'document': 'document',
      'section': 'section',
      'paragraph': 'paragraph',
      'math_inline': 'math-inline',
      'math_block': 'math-block',
      'list': 'list',
      'list_item': 'list-item',
      'environment': 'environment',
      'command': 'command',
      'comment': 'comment',
      'text': 'text',
      'error': 'error',
    };
    return typeMap[nodeType] || 'other';
  }

  /**
   * 计算优先级
   */
  private computePriority(nodeType: string): number {
    const priorityMap: Record<string, number> = {
      'section': 10,
      'paragraph': 5,
      'math_block': 8,
      'list': 6,
      'environment': 5,
      'math_inline': 3,
      'command': 2,
      'text': 1,
      'comment': 0,
    };
    return priorityMap[nodeType] ?? 1;
  }

  /**
   * 查找指定行之前的条目
   */
  private findEntryBeforeLine(line: number): SourceMapEntry | null {
    this.ensureSorted();
    let result: SourceMapEntry | null = null;
    for (const entry of this.entriesByLine) {
      if (entry.sourceEndLine < line) {
        result = entry;
      } else {
        break;
      }
    }
    return result;
  }

  /**
   * 查找指定行之后的条目
   */
  private findEntryAfterLine(line: number): SourceMapEntry | null {
    this.ensureSorted();
    for (const entry of this.entriesByLine) {
      if (entry.sourceStartLine > line) {
        return entry;
      }
    }
    return null;
  }

  /**
   * 查找指定位置之前的条目
   */
  private findEntryBeforePosition(position: number): SourceMapEntry | null {
    this.ensureSorted();
    let result: SourceMapEntry | null = null;
    for (const entry of this.entriesByPosition) {
      if (entry.renderTop + entry.renderHeight < position) {
        result = entry;
      } else if (entry.renderTop > position) {
        break;
      }
    }
    return result;
  }

  /**
   * 查找指定位置之后的条目
   */
  private findEntryAfterPosition(position: number): SourceMapEntry | null {
    this.ensureSorted();
    for (const entry of this.entriesByPosition) {
      if (entry.renderTop > position) {
        return entry;
      }
    }
    return null;
  }

  /**
   * 查找前一个条目
   */
  private findPrevEntry(
    entry: SourceMapEntry,
    sortedEntries: SourceMapEntry[]
  ): SourceMapEntry | null {
    const index = sortedEntries.indexOf(entry);
    return index > 0 ? sortedEntries[index - 1] : null;
  }

  /**
   * 查找后一个条目
   */
  private findNextEntry(
    entry: SourceMapEntry,
    sortedEntries: SourceMapEntry[]
  ): SourceMapEntry | null {
    const index = sortedEntries.indexOf(entry);
    return index >= 0 && index < sortedEntries.length - 1
      ? sortedEntries[index + 1]
      : null;
  }

  /**
   * 估算行号对应的位置
   */
  private estimatePositionForLine(line: number): number {
    if (this.totalLines <= 0) return 0;
    const ratio = (line - 1) / this.totalLines;
    return ratio * this.containerHeight;
  }

  /**
   * 估算位置对应的行号
   */
  private estimateLineForPosition(position: number): number {
    if (this.containerHeight <= 0) return 1;
    const ratio = position / this.containerHeight;
    return Math.max(1, Math.min(this.totalLines, Math.round(1 + ratio * this.totalLines)));
  }
}

// ================================
// DOM 测量工具
// ================================

/**
 * DOM 测量选项
 */
export interface DOMMeasurementOptions {
  /** 块选择器 */
  blockSelector: string;
  /** 块 ID 属性名 */
  blockIdAttribute: string;
  /** 是否只测量可见块 */
  visibleOnly: boolean;
  /** 可见区域上边界 */
  viewportTop?: number;
  /** 可见区域下边界 */
  viewportBottom?: number;
}

/**
 * 默认测量选项
 */
const DEFAULT_MEASUREMENT_OPTIONS: DOMMeasurementOptions = {
  blockSelector: '[data-block-id]',
  blockIdAttribute: 'data-block-id',
  visibleOnly: false,
};

/**
 * 从 DOM 测量块位置
 */
export function measureDOMBlocks(
  container: HTMLElement,
  options: Partial<DOMMeasurementOptions> = {}
): DOMBlockMeasurement[] {
  const opts = { ...DEFAULT_MEASUREMENT_OPTIONS, ...options };
  const measurements: DOMBlockMeasurement[] = [];

  const containerRect = container.getBoundingClientRect();
  const blocks = container.querySelectorAll(opts.blockSelector);

  for (const block of blocks) {
    const id = block.getAttribute(opts.blockIdAttribute);
    if (!id) continue;

    const rect = block.getBoundingClientRect();
    const top = rect.top - containerRect.top + container.scrollTop;
    const height = rect.height;

    // 可见性过滤
    if (opts.visibleOnly) {
      const viewportTop = opts.viewportTop ?? container.scrollTop;
      const viewportBottom = opts.viewportBottom ?? (container.scrollTop + container.clientHeight);

      if (top + height < viewportTop || top > viewportBottom) {
        continue;
      }
    }

    measurements.push({ id, top, height });
  }

  return measurements;
}

/**
 * 创建 ResizeObserver 以监控块大小变化
 */
export function createBlockResizeObserver(
  sourceMap: PreciseSourceMap,
  container: HTMLElement,
  options: Partial<DOMMeasurementOptions> = {}
): ResizeObserver {
  const opts = { ...DEFAULT_MEASUREMENT_OPTIONS, ...options };

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const block = entry.target as HTMLElement;
      const id = block.getAttribute(opts.blockIdAttribute);
      if (!id) continue;

      const containerRect = container.getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      const top = rect.top - containerRect.top + container.scrollTop;
      const height = rect.height;

      sourceMap.updateRenderPosition(id, top, height);
    }
  });

  // 观察所有块
  const blocks = container.querySelectorAll(opts.blockSelector);
  for (const block of blocks) {
    observer.observe(block);
  }

  return observer;
}

/**
 * 创建 IntersectionObserver 以监控块可见性
 */
export function createBlockVisibilityObserver(
  onVisibilityChange: (id: string, isVisible: boolean) => void,
  container: HTMLElement,
  options: Partial<DOMMeasurementOptions> = {}
): IntersectionObserver {
  const opts = { ...DEFAULT_MEASUREMENT_OPTIONS, ...options };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const block = entry.target as HTMLElement;
        const id = block.getAttribute(opts.blockIdAttribute);
        if (!id) continue;

        onVisibilityChange(id, entry.isIntersecting);
      }
    },
    {
      root: container,
      threshold: [0, 0.1, 0.5, 0.9, 1],
    }
  );

  // 观察所有块
  const blocks = container.querySelectorAll(opts.blockSelector);
  for (const block of blocks) {
    observer.observe(block);
  }

  return observer;
}

// ================================
// 导出
// ================================

/**
 * 创建精确 Source Map
 */
export function createPreciseSourceMap(
  config?: Partial<PreciseSourceMapConfig>
): PreciseSourceMap {
  return new PreciseSourceMap(config);
}

/**
 * 从 AST 创建 Source Map
 */
export function createSourceMapFromAST(
  ast: { type: string; id: string; start: number; end: number; children?: unknown[] },
  content: string,
  config?: Partial<PreciseSourceMapConfig>
): PreciseSourceMap {
  const sourceMap = new PreciseSourceMap(config);

  // 计算行偏移
  const lineOffsets: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      lineOffsets.push(i + 1);
    }
  }

  sourceMap.setTotalLines(lineOffsets.length);

  // 收集所有需要映射的节点
  const collectNodes = (
    node: { type: string; id: string; start: number; end: number; children?: unknown[] },
    depth = 0
  ): void => {
    // 只添加有意义的节点
    const significantTypes = new Set([
      'section',
      'paragraph',
      'math_block',
      'list',
      'environment',
      'preamble',
      'document',
    ]);

    if (significantTypes.has(node.type) && node.start !== undefined && node.end !== undefined) {
      sourceMap.addFromNode(node, lineOffsets);
    }

    // 递归处理子节点
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && typeof child === 'object' && 'type' in child) {
          collectNodes(child as typeof node, depth + 1);
        }
      }
    }
  };

  collectNodes(ast);

  return sourceMap;
}
