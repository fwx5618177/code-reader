// ================================
// Source Map 生成器
//
// 实现精确的源码-渲染位置双向映射
// 核心功能：
// 1. 精确记录每个块的源码位置和渲染位置
// 2. 支持双向查询：源码行 -> 渲染位置，渲染位置 -> 源码行
// 3. 二分查找实现 O(log n) 查询性能
// 4. 支持插值计算块内精确位置
//
// 设计原则：
// - 渲染位置基于真实 DOM 测量，而非估算
// - 支持增量更新，避免全量重建
// - 内存高效，使用紧凑数据结构
// ================================

import type { RootNode, LatexNode, LatexNodeType } from './types';

// ================================
// 类型定义
// ================================

/** Source Map 条目 */
export interface SourceMapEntry {
  /** 源码起始行（1-based） */
  sourceStartLine: number;
  /** 源码结束行（1-based） */
  sourceEndLine: number;
  /** 源码起始偏移（0-based） */
  sourceStartOffset: number;
  /** 源码结束偏移（0-based） */
  sourceEndOffset: number;
  /** 渲染块 ID */
  blockId: string;
  /** 渲染块类型 */
  blockType: SourceMapBlockType;
  /** 渲染起始位置（像素，相对于容器顶部） */
  renderPosition: number;
  /** 渲染结束位置（像素） */
  renderEndPosition: number;
  /** 渲染块高度（像素） */
  renderHeight: number;
  /** 优先级（用于滚动同步时的权重） */
  priority: number;
}

/** Source Map 块类型 */
export type SourceMapBlockType =
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

/** 位置查询结果 */
export interface PositionQueryResult {
  /** 是否精确匹配 */
  exact: boolean;
  /** 匹配的条目 */
  entry: SourceMapEntry | null;
  /** 插值计算的位置 */
  interpolatedPosition: number;
  /** 前一个条目（用于插值） */
  prevEntry: SourceMapEntry | null;
  /** 后一个条目（用于插值） */
  nextEntry: SourceMapEntry | null;
}

/** 行号查询结果 */
export interface LineQueryResult {
  /** 是否精确匹配 */
  exact: boolean;
  /** 匹配的条目 */
  entry: SourceMapEntry | null;
  /** 插值计算的行号 */
  interpolatedLine: number;
  /** 前一个条目 */
  prevEntry: SourceMapEntry | null;
  /** 后一个条目 */
  nextEntry: SourceMapEntry | null;
}

/** 渲染块位置信息（用于 DOM 测量回调） */
export interface RenderBlockPosition {
  /** 块 ID */
  blockId: string;
  /** 顶部位置（相对于容器） */
  top: number;
  /** 高度 */
  height: number;
}

/** Source Map 统计信息 */
export interface SourceMapStats {
  /** 条目数量 */
  entryCount: number;
  /** 覆盖的源码行数 */
  coveredLines: number;
  /** 总行数 */
  totalLines: number;
  /** 覆盖率 */
  coverageRatio: number;
  /** 按块类型统计 */
  blockTypeCounts: Record<SourceMapBlockType, number>;
}

/** 滚动同步模式 */
export type ScrollSyncMode = 'proportional' | 'block-aligned' | 'hybrid';

// ================================
// 工具函数
// ================================

/** 生成块 ID */
let blockIdCounter = 0;
function generateBlockId(): string {
  return `block_${Date.now()}_${++blockIdCounter}`;
}

// ================================
// Source Map 生成器类
// ================================

/**
 * Source Map 生成器
 *
 * 核心职责：
 * 1. 维护源码位置到渲染位置的映射
 * 2. 支持高效的双向查询
 * 3. 支持增量更新
 *
 * 性能优化：
 * - 使用排序数组 + 二分查找，查询复杂度 O(log n)
 * - 支持块级插值，无需存储每行映射
 * - 惰性排序，批量添加后一次排序
 */
export class SourceMapGenerator {
  /** 源码内容 */
  private sourceContent: string;

  /** 行偏移数组（用于快速计算行号） */
  private lineOffsets: number[];

  /** Source Map 条目数组（按源码位置排序） */
  private entries: SourceMapEntry[];

  /** 是否已排序 */
  private sorted: boolean;

  /** 总行数 */
  private totalLines: number;

  /** 渲染容器总高度 */
  private containerHeight: number;

  constructor(sourceContent: string = '') {
    this.sourceContent = sourceContent;
    this.lineOffsets = this.computeLineOffsets(sourceContent);
    this.totalLines = this.lineOffsets.length;
    this.entries = [];
    this.sorted = true;
    this.containerHeight = 0;
  }

  // ================================
  // 初始化和配置
  // ================================

  /**
   * 计算行偏移数组
   */
  private computeLineOffsets(content: string): number[] {
    const offsets: number[] = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  /**
   * 从偏移量获取行号（二分查找）
   */
  getLineFromOffset(offset: number): number {
    if (offset < 0) return 1;
    if (offset >= this.sourceContent.length) return this.totalLines;

    let low = 0;
    let high = this.lineOffsets.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.lineOffsets[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    return low + 1; // 返回 1-based 行号
  }

  /**
   * 从行号获取偏移量
   */
  getOffsetFromLine(line: number): number {
    const index = Math.max(0, Math.min(line - 1, this.lineOffsets.length - 1));
    return this.lineOffsets[index];
  }

  /**
   * 设置源码内容
   */
  setSourceContent(content: string): void {
    this.sourceContent = content;
    this.lineOffsets = this.computeLineOffsets(content);
    this.totalLines = this.lineOffsets.length;
  }

  /**
   * 设置渲染容器高度
   */
  setContainerHeight(height: number): void {
    this.containerHeight = height;
  }

  // ================================
  // 条目管理
  // ================================

  /**
   * 添加单个条目
   */
  addEntry(entry: SourceMapEntry): void {
    this.entries.push(entry);
    this.sorted = false;
  }

  /**
   * 批量添加条目
   */
  addEntries(entries: SourceMapEntry[]): void {
    this.entries.push(...entries);
    this.sorted = false;
  }

  /**
   * 从 AST 节点添加条目
   */
  addFromNode(node: LatexNode, renderPosition: number, renderHeight: number): SourceMapEntry {
    const sourceStartLine = this.getLineFromOffset(node.start);
    const sourceEndLine = this.getLineFromOffset(node.end);

    const entry: SourceMapEntry = {
      sourceStartLine,
      sourceEndLine,
      sourceStartOffset: node.start,
      sourceEndOffset: node.end,
      blockId: node.id || generateBlockId(),
      blockType: this.mapNodeTypeToBlockType(node.type),
      renderPosition,
      renderEndPosition: renderPosition + renderHeight,
      renderHeight,
      priority: this.computePriority(node.type),
    };

    this.addEntry(entry);
    return entry;
  }

  /**
   * 从 DOM 测量结果更新渲染位置
   */
  updateRenderPositions(positions: RenderBlockPosition[]): void {
    const positionMap = new Map<string, RenderBlockPosition>();
    for (const pos of positions) {
      positionMap.set(pos.blockId, pos);
    }

    for (const entry of this.entries) {
      const pos = positionMap.get(entry.blockId);
      if (pos) {
        entry.renderPosition = pos.top;
        entry.renderHeight = pos.height;
        entry.renderEndPosition = pos.top + pos.height;
      }
    }

    // 更新容器高度
    if (positions.length > 0) {
      const lastPos = positions[positions.length - 1];
      this.containerHeight = Math.max(this.containerHeight, lastPos.top + lastPos.height);
    }
  }

  /**
   * 清空所有条目
   */
  clear(): void {
    this.entries = [];
    this.sorted = true;
    this.containerHeight = 0;
  }

  /**
   * 获取所有条目
   */
  getEntries(): SourceMapEntry[] {
    this.ensureSorted();
    return [...this.entries];
  }

  /**
   * 获取条目数量
   */
  get entryCount(): number {
    return this.entries.length;
  }

  // ================================
  // 位置查询
  // ================================

  /**
   * 根据源码行号查询渲染位置
   *
   * 使用二分查找 + 线性插值：
   * 1. 找到包含该行的条目
   * 2. 如果在条目内部，使用线性插值计算精确位置
   * 3. 如果在条目之间，使用相邻条目插值
   */
  getPositionForLine(line: number): PositionQueryResult {
    this.ensureSorted();

    if (this.entries.length === 0) {
      return {
        exact: false,
        entry: null,
        interpolatedPosition: 0,
        prevEntry: null,
        nextEntry: null,
      };
    }

    // 二分查找包含该行的条目
    let low = 0;
    let high = this.entries.length - 1;
    let exactMatch: SourceMapEntry | null = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const entry = this.entries[mid];

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
      // 精确匹配：使用线性插值计算块内位置
      const lineRange = exactMatch.sourceEndLine - exactMatch.sourceStartLine;
      const posRange = exactMatch.renderHeight;
      const lineOffset = line - exactMatch.sourceStartLine;
      const interpolatedPosition =
        exactMatch.renderPosition + (lineRange > 0 ? (lineOffset / lineRange) * posRange : 0);

      return {
        exact: true,
        entry: exactMatch,
        interpolatedPosition,
        prevEntry: this.findPrevEntry(exactMatch),
        nextEntry: this.findNextEntry(exactMatch),
      };
    }

    // 未精确匹配：找到相邻条目进行插值
    const prevEntry = this.findEntryBefore(line);
    const nextEntry = this.findEntryAfter(line);

    let interpolatedPosition = 0;

    if (prevEntry && nextEntry) {
      // 在两个条目之间插值
      const prevEnd = prevEntry.sourceEndLine;
      const nextStart = nextEntry.sourceStartLine;
      const lineGap = nextStart - prevEnd;
      const lineOffset = line - prevEnd;
      const posGap = nextEntry.renderPosition - prevEntry.renderEndPosition;

      interpolatedPosition =
        prevEntry.renderEndPosition + (lineGap > 0 ? (lineOffset / lineGap) * posGap : 0);
    } else if (prevEntry) {
      // 在最后一个条目之后
      const lineAfterPrev = line - prevEntry.sourceEndLine;
      const linesRemaining = this.totalLines - prevEntry.sourceEndLine;
      const posRemaining = this.containerHeight - prevEntry.renderEndPosition;

      interpolatedPosition =
        prevEntry.renderEndPosition +
        (linesRemaining > 0 ? (lineAfterPrev / linesRemaining) * posRemaining : 0);
    } else if (nextEntry) {
      // 在第一个条目之前
      const lineGap = nextEntry.sourceStartLine - 1;
      const lineOffset = line - 1;
      const posGap = nextEntry.renderPosition;

      interpolatedPosition = lineGap > 0 ? (lineOffset / lineGap) * posGap : 0;
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

    if (this.entries.length === 0) {
      return {
        exact: false,
        entry: null,
        interpolatedLine: 1,
        prevEntry: null,
        nextEntry: null,
      };
    }

    // 查找包含该位置的条目
    let exactMatch: SourceMapEntry | null = null;
    let prevEntry: SourceMapEntry | null = null;
    let nextEntry: SourceMapEntry | null = null;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      if (position >= entry.renderPosition && position < entry.renderEndPosition) {
        exactMatch = entry;
        prevEntry = i > 0 ? this.entries[i - 1] : null;
        nextEntry = i < this.entries.length - 1 ? this.entries[i + 1] : null;
        break;
      }

      if (entry.renderPosition > position) {
        nextEntry = entry;
        break;
      }

      prevEntry = entry;
    }

    if (exactMatch) {
      // 精确匹配：使用线性插值计算块内行号
      const posRange = exactMatch.renderHeight;
      const lineRange = exactMatch.sourceEndLine - exactMatch.sourceStartLine;
      const posOffset = position - exactMatch.renderPosition;
      const interpolatedLine =
        exactMatch.sourceStartLine +
        (posRange > 0 ? Math.round((posOffset / posRange) * lineRange) : 0);

      return {
        exact: true,
        entry: exactMatch,
        interpolatedLine: Math.max(
          exactMatch.sourceStartLine,
          Math.min(interpolatedLine, exactMatch.sourceEndLine)
        ),
        prevEntry,
        nextEntry,
      };
    }

    // 未精确匹配：使用插值
    let interpolatedLine = 1;

    if (prevEntry && nextEntry) {
      // 在两个条目之间
      const posGap = nextEntry.renderPosition - prevEntry.renderEndPosition;
      const posOffset = position - prevEntry.renderEndPosition;
      const lineGap = nextEntry.sourceStartLine - prevEntry.sourceEndLine;

      interpolatedLine =
        prevEntry.sourceEndLine + (posGap > 0 ? Math.round((posOffset / posGap) * lineGap) : 0);
    } else if (prevEntry) {
      // 在最后一个条目之后
      const posAfterPrev = position - prevEntry.renderEndPosition;
      const posRemaining = this.containerHeight - prevEntry.renderEndPosition;
      const linesRemaining = this.totalLines - prevEntry.sourceEndLine;

      interpolatedLine =
        prevEntry.sourceEndLine +
        (posRemaining > 0 ? Math.round((posAfterPrev / posRemaining) * linesRemaining) : 0);
    } else if (nextEntry) {
      // 在第一个条目之前
      const posGap = nextEntry.renderPosition;
      const posOffset = position;
      const lineGap = nextEntry.sourceStartLine - 1;

      interpolatedLine = 1 + (posGap > 0 ? Math.round((posOffset / posGap) * lineGap) : 0);
    }

    return {
      exact: false,
      entry: null,
      interpolatedLine: Math.max(1, Math.min(interpolatedLine, this.totalLines)),
      prevEntry,
      nextEntry,
    };
  }

  /**
   * 获取指定行范围内的条目
   */
  getEntriesInLineRange(startLine: number, endLine: number): SourceMapEntry[] {
    this.ensureSorted();

    return this.entries.filter(
      (entry) => entry.sourceEndLine >= startLine && entry.sourceStartLine <= endLine
    );
  }

  /**
   * 获取指定渲染位置范围内的条目
   */
  getEntriesInPositionRange(startPos: number, endPos: number): SourceMapEntry[] {
    this.ensureSorted();

    return this.entries.filter(
      (entry) => entry.renderEndPosition >= startPos && entry.renderPosition <= endPos
    );
  }

  /**
   * 获取可见区域的条目
   */
  getVisibleEntries(viewportTop: number, viewportHeight: number): SourceMapEntry[] {
    return this.getEntriesInPositionRange(viewportTop, viewportTop + viewportHeight);
  }

  // ================================
  // 滚动同步
  // ================================

  /**
   * 计算预览滚动位置（基于源码滚动）
   *
   * @param sourceScrollTop 源码编辑器滚动位置
   * @param sourceViewportHeight 源码编辑器视口高度
   * @param sourceTotalHeight 源码编辑器总高度
   * @param mode 同步模式
   */
  computePreviewScrollPosition(
    sourceScrollTop: number,
    sourceViewportHeight: number,
    sourceTotalHeight: number,
    mode: ScrollSyncMode = 'hybrid'
  ): number {
    if (this.entries.length === 0 || this.containerHeight === 0) {
      // 无映射信息，使用比例滚动
      return sourceTotalHeight > 0
        ? (sourceScrollTop / sourceTotalHeight) * this.containerHeight
        : 0;
    }

    // 计算可视区域的中心行
    const lineHeight = sourceTotalHeight / this.totalLines;
    const visibleStartLine = Math.floor(sourceScrollTop / lineHeight) + 1;
    const visibleCenterLine = visibleStartLine + Math.floor(sourceViewportHeight / lineHeight / 2);

    if (mode === 'proportional') {
      // 纯比例滚动
      return (sourceScrollTop / sourceTotalHeight) * this.containerHeight;
    }

    if (mode === 'block-aligned') {
      // 块对齐滚动：找到最近的块并对齐
      const result = this.getPositionForLine(visibleCenterLine);
      if (result.entry) {
        // 计算块在视口中的相对位置
        const lineInBlock = visibleCenterLine - result.entry.sourceStartLine;
        const blockLines = result.entry.sourceEndLine - result.entry.sourceStartLine + 1;
        const blockOffset =
          blockLines > 0 ? (lineInBlock / blockLines) * result.entry.renderHeight : 0;

        return result.entry.renderPosition + blockOffset - sourceViewportHeight / 2;
      }
      return result.interpolatedPosition - sourceViewportHeight / 2;
    }

    // hybrid 模式：结合块对齐和比例滚动
    const result = this.getPositionForLine(visibleCenterLine);
    const blockPosition = result.interpolatedPosition;

    // 比例位置
    const proportionalPosition = (sourceScrollTop / sourceTotalHeight) * this.containerHeight;

    // 混合：70% 块对齐 + 30% 比例
    return blockPosition * 0.7 + proportionalPosition * 0.3 - sourceViewportHeight / 2;
  }

  /**
   * 计算源码滚动位置（基于预览滚动）
   */
  computeSourceScrollPosition(
    previewScrollTop: number,
    previewViewportHeight: number,
    sourceTotalHeight: number,
    mode: ScrollSyncMode = 'hybrid'
  ): number {
    if (this.entries.length === 0 || sourceTotalHeight === 0) {
      // 无映射信息，使用比例滚动
      return this.containerHeight > 0
        ? (previewScrollTop / this.containerHeight) * sourceTotalHeight
        : 0;
    }

    // 计算视口中心位置对应的行
    const viewportCenter = previewScrollTop + previewViewportHeight / 2;
    const result = this.getLineForPosition(viewportCenter);

    const lineHeight = sourceTotalHeight / this.totalLines;
    const targetLine = result.interpolatedLine;

    if (mode === 'proportional') {
      return (previewScrollTop / this.containerHeight) * sourceTotalHeight;
    }

    if (mode === 'block-aligned') {
      return (targetLine - 1) * lineHeight - previewViewportHeight / 2;
    }

    // hybrid 模式
    const blockPosition = (targetLine - 1) * lineHeight;
    const proportionalPosition = (previewScrollTop / this.containerHeight) * sourceTotalHeight;

    return blockPosition * 0.7 + proportionalPosition * 0.3 - previewViewportHeight / 2;
  }

  // ================================
  // 统计信息
  // ================================

  /**
   * 获取统计信息
   */
  getStats(): SourceMapStats {
    const blockTypeCounts: Record<SourceMapBlockType, number> = {
      document: 0,
      preamble: 0,
      section: 0,
      subsection: 0,
      subsubsection: 0,
      paragraph: 0,
      'math-inline': 0,
      'math-block': 0,
      list: 0,
      'list-item': 0,
      table: 0,
      code: 0,
      environment: 0,
      command: 0,
      comment: 0,
      text: 0,
      error: 0,
      other: 0,
    };

    const coveredLines = new Set<number>();

    for (const entry of this.entries) {
      blockTypeCounts[entry.blockType]++;

      for (let line = entry.sourceStartLine; line <= entry.sourceEndLine; line++) {
        coveredLines.add(line);
      }
    }

    return {
      entryCount: this.entries.length,
      coveredLines: coveredLines.size,
      totalLines: this.totalLines,
      coverageRatio: this.totalLines > 0 ? coveredLines.size / this.totalLines : 0,
      blockTypeCounts,
    };
  }

  // ================================
  // 从 AST 构建 Source Map
  // ================================

  /**
   * 从 AST 构建 Source Map
   * 使用估算的渲染位置（后续通过 DOM 测量更新）
   */
  static fromAST(
    ast: RootNode,
    sourceContent: string,
    estimatedLineHeight: number = 24
  ): SourceMapGenerator {
    const generator = new SourceMapGenerator(sourceContent);

    // 遍历 AST，收集所有需要映射的节点
    const nodes = generator.collectNodesFromAST(ast);

    // 按源码位置排序
    nodes.sort((a, b) => a.start - b.start);

    // 生成条目（使用估算位置）
    let currentRenderPosition = 0;

    for (const node of nodes) {
      const startLine = generator.getLineFromOffset(node.start);
      const endLine = generator.getLineFromOffset(node.end);
      const lineCount = endLine - startLine + 1;
      const estimatedHeight = lineCount * estimatedLineHeight;

      const entry: SourceMapEntry = {
        sourceStartLine: startLine,
        sourceEndLine: endLine,
        sourceStartOffset: node.start,
        sourceEndOffset: node.end,
        blockId: node.id || generateBlockId(),
        blockType: generator.mapNodeTypeToBlockType(node.type),
        renderPosition: currentRenderPosition,
        renderEndPosition: currentRenderPosition + estimatedHeight,
        renderHeight: estimatedHeight,
        priority: generator.computePriority(node.type),
      };

      generator.addEntry(entry);
      currentRenderPosition += estimatedHeight;
    }

    generator.containerHeight = currentRenderPosition;

    return generator;
  }

  /**
   * 从 AST 收集需要映射的节点
   */
  private collectNodesFromAST(ast: RootNode): LatexNode[] {
    const nodes: LatexNode[] = [];

    const traverse = (node: LatexNode): void => {
      // 只收集结构性节点
      const significantTypes: LatexNodeType[] = [
        'section',
        'paragraph',
        'math_block',
        'list',
        'environment',
        'preamble',
        'document',
      ];

      if (significantTypes.includes(node.type)) {
        nodes.push(node);
      }

      // 递归处理子节点
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    // 处理前言
    if (ast.preamble) {
      traverse(ast.preamble);
    }

    // 处理文档正文
    if (ast.document) {
      traverse(ast.document);
    }

    return nodes;
  }

  // ================================
  // 私有辅助方法
  // ================================

  /**
   * 确保条目已排序
   */
  private ensureSorted(): void {
    if (!this.sorted) {
      this.entries.sort((a, b) => {
        // 首先按源码起始行排序
        if (a.sourceStartLine !== b.sourceStartLine) {
          return a.sourceStartLine - b.sourceStartLine;
        }
        // 然后按源码起始偏移排序
        return a.sourceStartOffset - b.sourceStartOffset;
      });
      this.sorted = true;
    }
  }

  /**
   * 查找指定行之前的条目
   */
  private findEntryBefore(line: number): SourceMapEntry | null {
    this.ensureSorted();

    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].sourceEndLine < line) {
        return this.entries[i];
      }
    }
    return null;
  }

  /**
   * 查找指定行之后的条目
   */
  private findEntryAfter(line: number): SourceMapEntry | null {
    this.ensureSorted();

    for (const entry of this.entries) {
      if (entry.sourceStartLine > line) {
        return entry;
      }
    }
    return null;
  }

  /**
   * 查找条目的前一个条目
   */
  private findPrevEntry(entry: SourceMapEntry): SourceMapEntry | null {
    const index = this.entries.indexOf(entry);
    return index > 0 ? this.entries[index - 1] : null;
  }

  /**
   * 查找条目的后一个条目
   */
  private findNextEntry(entry: SourceMapEntry): SourceMapEntry | null {
    const index = this.entries.indexOf(entry);
    return index >= 0 && index < this.entries.length - 1 ? this.entries[index + 1] : null;
  }

  /**
   * 将节点类型映射到块类型
   */
  private mapNodeTypeToBlockType(nodeType: LatexNodeType): SourceMapBlockType {
    const typeMap: Partial<Record<LatexNodeType, SourceMapBlockType>> = {
      root: 'document',
      preamble: 'preamble',
      document: 'document',
      section: 'section',
      paragraph: 'paragraph',
      math_inline: 'math-inline',
      math_block: 'math-block',
      list: 'list',
      list_item: 'list-item',
      environment: 'environment',
      command: 'command',
      comment: 'comment',
      text: 'text',
      error: 'error',
    };

    return typeMap[nodeType] ?? 'other';
  }

  /**
   * 计算优先级
   */
  private computePriority(nodeType: LatexNodeType): number {
    const priorityMap: Partial<Record<LatexNodeType, number>> = {
      section: 1,
      paragraph: 3,
      math_block: 2,
      list: 4,
      environment: 5,
      math_inline: 6,
      command: 7,
      text: 8,
      comment: 9,
      error: 10,
    };

    return priorityMap[nodeType] ?? 10;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Source Map 生成器
 */
export function createSourceMapGenerator(sourceContent?: string): SourceMapGenerator {
  return new SourceMapGenerator(sourceContent);
}

/**
 * 从 AST 创建 Source Map
 */
export function createSourceMapFromAST(
  ast: RootNode,
  sourceContent: string,
  _htmlContent?: string,
  estimatedLineHeight: number = 24
): SourceMapGenerator {
  return SourceMapGenerator.fromAST(ast, sourceContent, estimatedLineHeight);
}

/**
 * 计算预览滚动位置
 *
 * 兼容两种调用方式：
 * 1. (sourceScrollRatio, sourceMap, totalLines) - 旧版 API
 * 2. (sourceMap, sourceScrollRatio, sourceViewportHeight, totalLines) - 新版 API
 *
 * @param arg1 滚动比例或 Source Map
 * @param arg2 Source Map 或滚动比例
 * @param arg3 总行数或视口高度
 * @param arg4 总行数（新版 API）
 */
export function computePreviewScrollPosition(
  arg1: number | SourceMapGenerator | null,
  arg2: SourceMapGenerator | null | number,
  arg3: number,
  arg4?: number
): number {
  // 安全检查：确保有参数
  if (arg1 === undefined || arg1 === null || arg2 === undefined || arg2 === null) {
    return typeof arg1 === 'number' ? arg1 : 0;
  }

  // 检测调用方式
  let sourceMap: SourceMapGenerator | null;
  let sourceScrollRatio: number;
  let totalLines: number;

  try {
    if (typeof arg1 === 'number') {
      // 旧版 API: (sourceScrollRatio, sourceMap, totalLines)
      sourceScrollRatio = arg1;
      sourceMap = arg2 as SourceMapGenerator | null;
      totalLines = arg3;
    } else {
      // 新版 API: (sourceMap, sourceScrollRatio, sourceViewportHeight, totalLines)
      sourceMap = arg1;
      sourceScrollRatio = arg2 as number;
      totalLines = arg4 ?? arg3;
    }

    // 基本验证
    if (!sourceMap || totalLines === 0 || !Number.isFinite(sourceScrollRatio)) {
      return typeof sourceScrollRatio === 'number' && Number.isFinite(sourceScrollRatio)
        ? sourceScrollRatio
        : 0;
    }

    // 检查 sourceMap 是否是有效的 SourceMapGenerator 实例
    if (!sourceMap || typeof sourceMap !== 'object') {
      return sourceScrollRatio;
    }

    if (typeof sourceMap.getPositionForLine !== 'function') {
      console.warn(
        '[computePreviewScrollPosition] sourceMap 不是有效的 SourceMapGenerator 实例, 类型:',
        typeof sourceMap
      );
      return sourceScrollRatio;
    }
  } catch (e) {
    console.warn('[computePreviewScrollPosition] 参数解析错误:', e);
    return typeof arg1 === 'number' ? arg1 : 0;
  }

  // 计算当前可视行
  const visibleLine = Math.max(1, Math.floor(sourceScrollRatio * totalLines) + 1);

  // 查询对应的渲染位置
  const result = sourceMap.getPositionForLine(visibleLine);

  // 如果有容器高度信息，返回比例；否则返回原始位置
  const containerHeight = sourceMap['containerHeight'] as number | undefined;
  if (containerHeight && containerHeight > 0) {
    return result.interpolatedPosition / containerHeight;
  }

  // 回退到基于条目数的估算
  if (sourceMap.entryCount > 0) {
    return result.interpolatedPosition;
  }

  return sourceScrollRatio;
}

/**
 * 计算源码滚动位置
 *
 * 兼容两种调用方式：
 * 1. (previewScrollRatio, sourceMap, totalLines) - 旧版 API
 * 2. (sourceMap, previewScrollRatio, previewTotalHeight, sourceTotalHeight) - 新版 API
 */
export function computeSourceScrollPosition(
  arg1: number | SourceMapGenerator | null,
  arg2: SourceMapGenerator | null | number,
  arg3: number,
  arg4?: number
): number {
  // 安全检查：确保有参数
  if (arg1 === undefined || arg1 === null || arg2 === undefined || arg2 === null) {
    return typeof arg1 === 'number' ? arg1 : 0;
  }

  // 检测调用方式
  let sourceMap: SourceMapGenerator | null;
  let previewScrollRatio: number;
  let sourceTotalHeight: number;

  try {
    if (typeof arg1 === 'number') {
      // 旧版 API: (previewScrollRatio, sourceMap, totalLines)
      previewScrollRatio = arg1;
      sourceMap = arg2 as SourceMapGenerator | null;
      sourceTotalHeight = arg3;
    } else {
      // 新版 API: (sourceMap, previewScrollRatio, previewTotalHeight, sourceTotalHeight)
      sourceMap = arg1;
      previewScrollRatio = arg2 as number;
      sourceTotalHeight = arg4 ?? arg3;
    }

    // 基本验证
    if (!sourceMap || sourceTotalHeight === 0 || !Number.isFinite(previewScrollRatio)) {
      return typeof previewScrollRatio === 'number' && Number.isFinite(previewScrollRatio)
        ? previewScrollRatio
        : 0;
    }

    // 检查 sourceMap 是否是有效的 SourceMapGenerator 实例
    if (!sourceMap || typeof sourceMap !== 'object') {
      return previewScrollRatio;
    }

    if (typeof sourceMap.getLineForPosition !== 'function') {
      console.warn(
        '[computeSourceScrollPosition] sourceMap 不是有效的 SourceMapGenerator 实例, 类型:',
        typeof sourceMap
      );
      return previewScrollRatio;
    }
  } catch (e) {
    console.warn('[computeSourceScrollPosition] 参数解析错误:', e);
    return typeof arg1 === 'number' ? arg1 : 0;
  }

  // 获取容器高度
  const containerHeight = sourceMap['containerHeight'] as number | undefined;
  const renderPosition =
    containerHeight && containerHeight > 0
      ? previewScrollRatio * containerHeight
      : previewScrollRatio;

  // 查询对应的源码行
  const result = sourceMap.getLineForPosition(renderPosition);

  // 转换为滚动比例
  const totalLines = sourceMap['totalLines'] as number | undefined;
  if (totalLines && totalLines > 0) {
    return (result.interpolatedLine - 1) / totalLines;
  }

  return previewScrollRatio;
}

// ================================
// 导出
// ================================

export default SourceMapGenerator;
