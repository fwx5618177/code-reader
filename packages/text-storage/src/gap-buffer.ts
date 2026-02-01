// ================================
// Gap Buffer 数据结构
//
// 基于 Emacs 的实现思路，用于快速的局部编辑操作
// 特点：
// - O(1) 的局部插入/删除（在 gap 位置）
// - O(n) 的远距离跳转（需要移动 gap）
// - 内存紧凑，适合中等大小文件
// - 实现简单，性能可预测
// ================================

import type { ITextBuffer, TextChangeSet, Position, LineCache } from './types';

// ================================
// 常量配置
// ================================

/** 初始 gap 大小 */
const INITIAL_GAP_SIZE = 1024;

/** gap 增长因子 */
const GAP_GROW_FACTOR = 1.5;

/** 最小 gap 大小 */
const MIN_GAP_SIZE = 256;

// ================================
// 工具函数
// ================================

/**
 * 查找文本中的所有换行符位置
 */
function findLineBreaks(text: string): number[] {
  const lineBreaks: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\n') {
      lineBreaks.push(i);
    } else if (char === '\r') {
      if (i + 1 < text.length && text[i + 1] === '\n') {
        lineBreaks.push(i + 1);
        i++;
      } else {
        lineBreaks.push(i);
      }
    }
  }
  return lineBreaks;
}

// ================================
// GapBuffer 类
// ================================

/**
 * Gap Buffer 文本缓冲区实现
 *
 * 核心思想：
 * 1. 使用单个数组存储文本，中间有一个"间隙"（gap）
 * 2. 编辑操作在 gap 位置进行时是 O(1)
 * 3. 远距离编辑需要先移动 gap 到目标位置
 * 4. gap 会根据需要动态增长
 *
 * 内存布局：
 * [前段文本...][gap 空间...][后段文本...]
 *              ^gapStart   ^gapEnd
 */
export class GapBuffer implements ITextBuffer {
  /** 内部缓冲区 */
  private buffer: string[];

  /** gap 起始位置 */
  private gapStart: number;

  /** gap 结束位置 */
  private gapEnd: number;

  /** 行缓存 */
  private lineCache: LineCache;

  /** 是否启用行缓存 */
  private readonly enableLineCache: boolean;

  constructor(initialContent: string = '', enableLineCache: boolean = true) {
    this.enableLineCache = enableLineCache;
    this.lineCache = {
      valid: false,
      lineStarts: [],
      lineCount: 0,
    };

    // 初始化缓冲区
    const contentLength = initialContent.length;
    const gapSize = Math.max(INITIAL_GAP_SIZE, Math.floor(contentLength * 0.1));

    this.buffer = new Array(contentLength + gapSize);
    this.gapStart = contentLength;
    this.gapEnd = contentLength + gapSize;

    // 复制初始内容
    for (let i = 0; i < contentLength; i++) {
      this.buffer[i] = initialContent[i]!;
    }
  }

  // ================================
  // 公共属性
  // ================================

  /** 获取文档总长度 */
  get length(): number {
    return this.buffer.length - this.gapSize;
  }

  /** 获取 gap 大小 */
  private get gapSize(): number {
    return this.gapEnd - this.gapStart;
  }

  /** 获取行数 */
  get lineCount(): number {
    this.ensureLineCache();
    return this.lineCache.lineCount;
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 获取完整文本
   */
  toString(): string {
    const parts: string[] = [];

    // 前段文本
    for (let i = 0; i < this.gapStart; i++) {
      parts.push(this.buffer[i]!);
    }

    // 后段文本
    for (let i = this.gapEnd; i < this.buffer.length; i++) {
      parts.push(this.buffer[i]!);
    }

    return parts.join('');
  }

  /**
   * 获取指定范围的文本
   */
  slice(start: number, end?: number): string {
    const actualEnd = end === undefined ? this.length : Math.min(end, this.length);
    const actualStart = Math.max(0, start);

    if (actualStart >= actualEnd) {
      return '';
    }

    const parts: string[] = [];

    for (let i = actualStart; i < actualEnd; i++) {
      parts.push(this.charAt(i));
    }

    return parts.join('');
  }

  /**
   * 获取指定位置的字符
   */
  charAt(index: number): string {
    if (index < 0 || index >= this.length) {
      return '';
    }

    // 转换逻辑索引到物理索引
    const physicalIndex = this.toPhysicalIndex(index);
    return this.buffer[physicalIndex] ?? '';
  }

  /**
   * 获取指定行的文本
   */
  getLine(line: number): string {
    this.ensureLineCache();

    if (line < 0 || line >= this.lineCache.lineCount) {
      return '';
    }

    const lineStart = this.lineCache.lineStarts[line] ?? 0;
    const lineEnd =
      line + 1 < this.lineCache.lineCount
        ? (this.lineCache.lineStarts[line + 1] ?? this.length) - 1
        : this.length;

    let result = this.slice(lineStart, lineEnd);

    if (result.endsWith('\r')) {
      result = result.slice(0, -1);
    }

    return result;
  }

  /**
   * 获取指定行的起始偏移量
   */
  getLineOffset(line: number): number {
    this.ensureLineCache();

    if (line < 0) {
      return 0;
    }
    if (line >= this.lineCache.lineCount) {
      return this.length;
    }

    return this.lineCache.lineStarts[line] ?? 0;
  }

  /**
   * 根据偏移量获取位置
   */
  positionAt(offset: number): Position {
    this.ensureLineCache();

    const actualOffset = Math.max(0, Math.min(offset, this.length));

    // 二分查找行号
    let low = 0;
    let high = this.lineCache.lineCount - 1;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const midStart = this.lineCache.lineStarts[mid] ?? 0;
      if (midStart <= actualOffset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    const line = low;
    const lineStart = this.lineCache.lineStarts[line] ?? 0;
    const column = actualOffset - lineStart;

    return { line, column, offset: actualOffset };
  }

  /**
   * 根据位置获取偏移量
   */
  offsetAt(position: Position): number {
    this.ensureLineCache();

    const line = Math.max(0, Math.min(position.line, this.lineCache.lineCount - 1));
    const lineStart = this.lineCache.lineStarts[line] ?? 0;
    const lineEnd =
      line + 1 < this.lineCache.lineCount
        ? (this.lineCache.lineStarts[line + 1] ?? this.length)
        : this.length;

    const maxColumn = lineEnd - lineStart;
    const column = Math.max(0, Math.min(position.column, maxColumn));

    return lineStart + column;
  }

  /**
   * 应用批量变更
   */
  apply(changes: TextChangeSet): ITextBuffer {
    // 克隆当前实例
    const newBuffer = this.clone();

    // 按位置从后往前应用变更
    const sortedChanges = [...changes.changes].sort((a, b) => b.from - a.from);

    for (const change of sortedChanges) {
      newBuffer.replaceInternal(change.from, change.to, change.insert);
    }

    return newBuffer;
  }

  /**
   * 插入文本
   */
  insert(offset: number, text: string): ITextBuffer {
    return this.replace(offset, offset, text);
  }

  /**
   * 删除文本
   */
  delete(from: number, to: number): ITextBuffer {
    return this.replace(from, to, '');
  }

  /**
   * 替换文本
   */
  replace(from: number, to: number, text: string): ITextBuffer {
    const newBuffer = this.clone();
    newBuffer.replaceInternal(from, to, text);
    return newBuffer;
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 将逻辑索引转换为物理索引
   */
  private toPhysicalIndex(logicalIndex: number): number {
    if (logicalIndex < this.gapStart) {
      return logicalIndex;
    }
    return logicalIndex + this.gapSize;
  }

  /**
   * 移动 gap 到指定位置
   */
  private moveGap(position: number): void {
    if (position === this.gapStart) {
      return;
    }

    if (position < this.gapStart) {
      // 向左移动 gap
      const moveCount = this.gapStart - position;
      for (let i = 0; i < moveCount; i++) {
        this.buffer[this.gapEnd - 1 - i] = this.buffer[this.gapStart - 1 - i]!;
      }
      this.gapStart = position;
      this.gapEnd -= moveCount;
    } else {
      // 向右移动 gap
      const moveCount = position - this.gapStart;
      for (let i = 0; i < moveCount; i++) {
        this.buffer[this.gapStart + i] = this.buffer[this.gapEnd + i]!;
      }
      this.gapStart = position;
      this.gapEnd += moveCount;
    }
  }

  /**
   * 扩展 gap 大小
   */
  private expandGap(requiredSize: number): void {
    if (this.gapSize >= requiredSize) {
      return;
    }

    const newGapSize = Math.max(
      requiredSize,
      Math.floor(this.buffer.length * GAP_GROW_FACTOR),
      MIN_GAP_SIZE
    );
    const additionalSize = newGapSize - this.gapSize;

    // 创建新的缓冲区
    const newBuffer = new Array(this.buffer.length + additionalSize);

    // 复制前段
    for (let i = 0; i < this.gapStart; i++) {
      newBuffer[i] = this.buffer[i];
    }

    // 复制后段（偏移 additionalSize）
    for (let i = this.gapEnd; i < this.buffer.length; i++) {
      newBuffer[i + additionalSize] = this.buffer[i];
    }

    this.buffer = newBuffer;
    this.gapEnd += additionalSize;
  }

  /**
   * 内部替换操作（修改当前实例）
   */
  private replaceInternal(from: number, to: number, text: string): void {
    const actualFrom = Math.max(0, Math.min(from, this.length));
    const actualTo = Math.max(actualFrom, Math.min(to, this.length));
    const deleteCount = actualTo - actualFrom;
    const insertCount = text.length;

    // 移动 gap 到删除起始位置
    this.moveGap(actualFrom);

    // 删除操作：扩展 gap 覆盖被删除的文本
    this.gapEnd += deleteCount;

    // 插入操作：确保 gap 足够大
    if (insertCount > this.gapSize) {
      this.expandGap(insertCount);
    }

    // 写入新文本
    for (let i = 0; i < insertCount; i++) {
      this.buffer[this.gapStart + i] = text[i]!;
    }
    this.gapStart += insertCount;

    // 使行缓存失效
    this.invalidateLineCache();
  }

  /**
   * 克隆当前实例
   */
  private clone(): GapBuffer {
    const newBuffer = new GapBuffer('', this.enableLineCache);
    newBuffer.buffer = [...this.buffer];
    newBuffer.gapStart = this.gapStart;
    newBuffer.gapEnd = this.gapEnd;
    // 行缓存需要重建
    newBuffer.invalidateLineCache();
    return newBuffer;
  }

  /**
   * 确保行缓存有效
   */
  private ensureLineCache(): void {
    if (this.lineCache.valid || !this.enableLineCache) {
      return;
    }

    this.rebuildLineCache();
  }

  /**
   * 重建行缓存
   */
  private rebuildLineCache(): void {
    const text = this.toString();
    const lineBreaks = findLineBreaks(text);

    const lineStarts: number[] = [0];
    for (const pos of lineBreaks) {
      lineStarts.push(pos + 1);
    }

    this.lineCache = {
      valid: true,
      lineStarts,
      lineCount: lineStarts.length,
    };
  }

  /**
   * 使行缓存失效
   */
  private invalidateLineCache(): void {
    this.lineCache.valid = false;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Gap Buffer 实例
 */
export function createGapBuffer(
  initialContent: string = '',
  enableLineCache: boolean = true
): GapBuffer {
  return new GapBuffer(initialContent, enableLineCache);
}
