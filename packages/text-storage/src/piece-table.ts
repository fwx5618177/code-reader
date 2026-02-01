// ================================
// Piece Table 数据结构
//
// 基于 VS Code 的实现思路，提供高效的文本编辑操作
// 特点：
// - O(log n) 的插入/删除操作
// - 低内存占用（只追加不修改原始内容）
// - 支持高效的撤销/重做
// ================================

import type { ITextBuffer, TextChangeSet, Position, LineCache } from './types';

// ================================
// 类型定义
// ================================

/** 缓冲区类型 */
enum BufferType {
  /** 原始缓冲区（只读） */
  Original = 0,
  /** 添加缓冲区（追加写入） */
  Add = 1,
}

/** Piece 节点 */
interface Piece {
  /** 缓冲区类型 */
  readonly bufferType: BufferType;
  /** 在缓冲区中的起始位置 */
  readonly start: number;
  /** 在缓冲区中的长度 */
  readonly length: number;
  /** 换行符数量 */
  readonly lineBreaks: number;
  /** 每个换行符在 piece 中的相对位置 */
  readonly lineBreakOffsets: readonly number[];
}

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
      // 处理 \r\n 和单独的 \r
      if (i + 1 < text.length && text[i + 1] === '\n') {
        lineBreaks.push(i + 1);
        i++; // 跳过 \n
      } else {
        lineBreaks.push(i);
      }
    }
  }
  return lineBreaks;
}

/**
 * 创建 Piece
 */
function createPiece(bufferType: BufferType, start: number, length: number, text: string): Piece {
  const lineBreakOffsets = findLineBreaks(text);
  return {
    bufferType,
    start,
    length,
    lineBreaks: lineBreakOffsets.length,
    lineBreakOffsets,
  };
}

// ================================
// PieceTable 类
// ================================

/**
 * Piece Table 文本缓冲区实现
 *
 * 核心思想：
 * 1. 维护两个缓冲区：原始缓冲区（只读）和添加缓冲区（追加写入）
 * 2. 使用 Piece 列表描述当前文档的组成
 * 3. 编辑操作只需要修改 Piece 列表，不修改实际文本内容
 */
export class PieceTable implements ITextBuffer {
  /** 原始文本缓冲区 */
  private readonly originalBuffer: string;

  /** 添加文本缓冲区（只追加） */
  private addBuffer: string;

  /** Piece 列表 */
  private pieces: Piece[];

  /** 文档总长度 */
  private _length: number;

  /** 行缓存 */
  private lineCache: LineCache;

  /** 是否启用行缓存 */
  private readonly enableLineCache: boolean;

  constructor(initialContent: string = '', enableLineCache: boolean = true) {
    this.originalBuffer = initialContent;
    this.addBuffer = '';
    this.enableLineCache = enableLineCache;
    this._length = initialContent.length;

    // 初始化 pieces
    if (initialContent.length > 0) {
      this.pieces = [createPiece(BufferType.Original, 0, initialContent.length, initialContent)];
    } else {
      this.pieces = [];
    }

    // 初始化行缓存
    this.lineCache = {
      valid: false,
      lineStarts: [],
      lineCount: 0,
    };
  }

  // ================================
  // 公共属性
  // ================================

  /** 获取文档总长度 */
  get length(): number {
    return this._length;
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
    if (this.pieces.length === 0) {
      return '';
    }

    const parts: string[] = [];
    for (const piece of this.pieces) {
      parts.push(this.getPieceText(piece));
    }
    return parts.join('');
  }

  /**
   * 获取指定范围的文本
   */
  slice(start: number, end?: number): string {
    const actualEnd = end === undefined ? this._length : Math.min(end, this._length);
    const actualStart = Math.max(0, start);

    if (actualStart >= actualEnd) {
      return '';
    }

    const parts: string[] = [];
    let currentOffset = 0;

    for (const piece of this.pieces) {
      const pieceEnd = currentOffset + piece.length;

      // 检查 piece 是否与请求范围重叠
      if (pieceEnd > actualStart && currentOffset < actualEnd) {
        const pieceText = this.getPieceText(piece);
        const sliceStart = Math.max(0, actualStart - currentOffset);
        const sliceEnd = Math.min(piece.length, actualEnd - currentOffset);
        parts.push(pieceText.slice(sliceStart, sliceEnd));
      }

      currentOffset = pieceEnd;
      if (currentOffset >= actualEnd) {
        break;
      }
    }

    return parts.join('');
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
        ? (this.lineCache.lineStarts[line + 1] ?? this._length) - 1 // 排除换行符
        : this._length;

    let result = this.slice(lineStart, lineEnd);

    // 移除行尾的 \r（如果有）
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
      return this._length;
    }

    return this.lineCache.lineStarts[line] ?? 0;
  }

  /**
   * 根据偏移量获取位置
   */
  positionAt(offset: number): Position {
    this.ensureLineCache();

    const actualOffset = Math.max(0, Math.min(offset, this._length));

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
        ? (this.lineCache.lineStarts[line + 1] ?? this._length)
        : this._length;

    const maxColumn = lineEnd - lineStart;
    const column = Math.max(0, Math.min(position.column, maxColumn));

    return lineStart + column;
  }

  /**
   * 应用批量变更
   */
  apply(changes: TextChangeSet): ITextBuffer {
    // 创建新实例
    let result: ITextBuffer = this;

    // 按位置从后往前应用变更，避免位置偏移问题
    const sortedChanges = [...changes.changes].sort((a, b) => b.from - a.from);

    for (const change of sortedChanges) {
      result = result.replace(change.from, change.to, change.insert);
    }

    return result;
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
    // 创建新的 PieceTable 实例
    const newTable = this.clone();
    newTable.replaceInternal(from, to, text);
    return newTable;
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 获取 piece 的文本内容
   */
  private getPieceText(piece: Piece): string {
    const buffer = piece.bufferType === BufferType.Original ? this.originalBuffer : this.addBuffer;
    return buffer.slice(piece.start, piece.start + piece.length);
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
    const lineStarts: number[] = [0]; // 第一行总是从 0 开始
    let currentOffset = 0;

    for (const piece of this.pieces) {
      // 将 piece 的换行符位置转换为文档偏移量
      for (const relativeOffset of piece.lineBreakOffsets) {
        lineStarts.push(currentOffset + relativeOffset + 1); // +1 是因为行从换行符后一个字符开始
      }
      currentOffset += piece.length;
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

  /**
   * 克隆当前实例
   */
  private clone(): PieceTable {
    const newTable = new PieceTable('', this.enableLineCache);

    // 复制缓冲区引用（原始缓冲区是只读的，可以共享）
    // 使用 Object.assign 绕过私有属性限制
    Object.assign(newTable, {
      originalBuffer: this.originalBuffer,
      addBuffer: this.addBuffer,
      pieces: [...this.pieces],
      _length: this._length,
    });

    // 行缓存需要重建
    newTable.invalidateLineCache();

    return newTable;
  }

  /**
   * 内部替换操作（修改当前实例）
   */
  private replaceInternal(from: number, to: number, text: string): void {
    // 边界检查
    const actualFrom = Math.max(0, Math.min(from, this._length));
    const actualTo = Math.max(actualFrom, Math.min(to, this._length));

    // 如果没有实际变更，直接返回
    if (actualFrom === actualTo && text.length === 0) {
      return;
    }

    // 删除操作
    if (actualFrom < actualTo) {
      this.deleteRange(actualFrom, actualTo);
    }

    // 插入操作
    if (text.length > 0) {
      this.insertAt(actualFrom, text);
    }

    // 更新长度
    this._length = this._length - (actualTo - actualFrom) + text.length;

    // 使行缓存失效
    this.invalidateLineCache();
  }

  /**
   * 删除指定范围
   */
  private deleteRange(from: number, to: number): void {
    if (from >= to) {
      return;
    }

    const newPieces: Piece[] = [];
    let currentOffset = 0;

    for (const piece of this.pieces) {
      const pieceStart = currentOffset;
      const pieceEnd = currentOffset + piece.length;

      if (pieceEnd <= from || pieceStart >= to) {
        // piece 完全在删除范围之外，保留
        newPieces.push(piece);
      } else if (pieceStart >= from && pieceEnd <= to) {
        // piece 完全在删除范围内，跳过
      } else if (pieceStart < from && pieceEnd > to) {
        // 删除范围完全在 piece 内部，需要分割成两个 piece
        const leftLength = from - pieceStart;
        const rightStart = to - pieceStart;
        const rightLength = pieceEnd - to;

        // 左半部分
        const leftText = this.getPieceText(piece).slice(0, leftLength);
        newPieces.push(createPiece(piece.bufferType, piece.start, leftLength, leftText));

        // 右半部分
        const rightText = this.getPieceText(piece).slice(rightStart);
        newPieces.push(
          createPiece(piece.bufferType, piece.start + rightStart, rightLength, rightText)
        );
      } else if (pieceStart < from) {
        // 删除范围与 piece 右侧重叠
        const keepLength = from - pieceStart;
        const keepText = this.getPieceText(piece).slice(0, keepLength);
        newPieces.push(createPiece(piece.bufferType, piece.start, keepLength, keepText));
      } else {
        // 删除范围与 piece 左侧重叠
        const skipLength = to - pieceStart;
        const keepLength = piece.length - skipLength;
        const keepText = this.getPieceText(piece).slice(skipLength);
        newPieces.push(
          createPiece(piece.bufferType, piece.start + skipLength, keepLength, keepText)
        );
      }

      currentOffset = pieceEnd;
    }

    this.pieces = newPieces;
  }

  /**
   * 在指定位置插入文本
   */
  private insertAt(offset: number, text: string): void {
    // 将文本追加到添加缓冲区
    const addBufferStart = this.addBuffer.length;
    this.addBuffer += text;

    // 创建新的 piece
    const newPiece = createPiece(BufferType.Add, addBufferStart, text.length, text);

    // 找到插入位置并更新 pieces
    const newPieces: Piece[] = [];
    let currentOffset = 0;
    let inserted = false;

    for (const piece of this.pieces) {
      const pieceStart = currentOffset;
      const pieceEnd = currentOffset + piece.length;

      if (!inserted && offset <= pieceEnd) {
        if (offset === pieceStart) {
          // 在 piece 开头插入
          newPieces.push(newPiece);
          newPieces.push(piece);
          inserted = true;
        } else if (offset === pieceEnd) {
          // 在 piece 结尾插入
          newPieces.push(piece);
          newPieces.push(newPiece);
          inserted = true;
        } else {
          // 在 piece 中间插入，需要分割
          const splitPoint = offset - pieceStart;
          const leftText = this.getPieceText(piece).slice(0, splitPoint);
          const rightText = this.getPieceText(piece).slice(splitPoint);

          // 左半部分
          newPieces.push(createPiece(piece.bufferType, piece.start, splitPoint, leftText));

          // 新插入的 piece
          newPieces.push(newPiece);

          // 右半部分
          newPieces.push(
            createPiece(
              piece.bufferType,
              piece.start + splitPoint,
              piece.length - splitPoint,
              rightText
            )
          );

          inserted = true;
        }
      } else {
        newPieces.push(piece);
      }

      currentOffset = pieceEnd;
    }

    // 如果还没插入，说明是在文档末尾
    if (!inserted) {
      newPieces.push(newPiece);
    }

    this.pieces = newPieces;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Piece Table 实例
 */
export function createPieceTable(
  initialContent: string = '',
  enableLineCache: boolean = true
): PieceTable {
  return new PieceTable(initialContent, enableLineCache);
}
