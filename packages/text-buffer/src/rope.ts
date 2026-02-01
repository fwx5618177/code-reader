// ================================
// Rope 数据结构
//
// 基于 Xi Editor 和 Lapce 的实现思路，用于超大文件的高效编辑
// 特点：
// - O(log n) 的插入/删除/查找操作
// - 内存高效（节点共享，适合撤销/重做）
// - 支持并行处理（不可变数据结构）
// ================================

import type { ITextBuffer, TextChangeSet, Position, LineCache } from './types';

// ================================
// 常量配置
// ================================

/** 叶子节点的最大长度 */
const MAX_LEAF_SIZE = 512;

// ================================
// 类型定义
// ================================

/** Rope 节点类型 */
type RopeNode = RopeLeaf | RopeBranch;

/** 叶子节点（存储实际文本） */
interface RopeLeaf {
  readonly type: 'leaf';
  /** 文本内容 */
  readonly text: string;
  /** 文本长度 */
  readonly length: number;
  /** 换行符数量 */
  readonly lineBreaks: number;
  /** 换行符位置列表 */
  readonly lineBreakOffsets: readonly number[];
}

/** 分支节点（二叉树结构） */
interface RopeBranch {
  readonly type: 'branch';
  /** 左子树 */
  readonly left: RopeNode;
  /** 右子树 */
  readonly right: RopeNode;
  /** 总长度 */
  readonly length: number;
  /** 总换行符数量 */
  readonly lineBreaks: number;
  /** 树的高度 */
  readonly height: number;
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

/**
 * 创建叶子节点
 */
function createLeaf(text: string): RopeLeaf {
  const lineBreakOffsets = findLineBreaks(text);
  return {
    type: 'leaf',
    text,
    length: text.length,
    lineBreaks: lineBreakOffsets.length,
    lineBreakOffsets,
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
    lineBreaks: left.lineBreaks + right.lineBreaks,
    height: Math.max(getHeight(left), getHeight(right)) + 1,
  };
}

/**
 * 获取节点高度
 */
function getHeight(node: RopeNode): number {
  return node.type === 'branch' ? node.height : 0;
}

/**
 * 计算平衡因子
 */
function getBalanceFactor(node: RopeBranch): number {
  return getHeight(node.right) - getHeight(node.left);
}

/**
 * 右旋转
 */
function rotateRight(node: RopeBranch): RopeNode {
  if (node.left.type !== 'branch') {
    return node;
  }
  const left = node.left;
  const newRight = createBranch(left.right, node.right);
  return createBranch(left.left, newRight);
}

/**
 * 左旋转
 */
function rotateLeft(node: RopeBranch): RopeNode {
  if (node.right.type !== 'branch') {
    return node;
  }
  const right = node.right;
  const newLeft = createBranch(node.left, right.left);
  return createBranch(newLeft, right.right);
}

/**
 * 平衡节点（AVL 平衡）
 */
function balance(node: RopeNode): RopeNode {
  if (node.type === 'leaf') {
    return node;
  }

  const factor = getBalanceFactor(node);

  // 右重
  if (factor > 1) {
    if (node.right.type === 'branch' && getBalanceFactor(node.right) < 0) {
      // 右左情况
      const newRight = rotateRight(node.right as RopeBranch);
      return rotateLeft(createBranch(node.left, newRight) as RopeBranch);
    }
    // 右右情况
    return rotateLeft(node);
  }

  // 左重
  if (factor < -1) {
    if (node.left.type === 'branch' && getBalanceFactor(node.left) > 0) {
      // 左右情况
      const newLeft = rotateLeft(node.left as RopeBranch);
      return rotateRight(createBranch(newLeft, node.right) as RopeBranch);
    }
    // 左左情况
    return rotateRight(node);
  }

  return node;
}

/**
 * 合并两个节点
 */
function concat(left: RopeNode | null, right: RopeNode | null): RopeNode | null {
  if (!left) return right;
  if (!right) return left;

  // 如果两个叶子节点很小，合并它们
  if (
    left.type === 'leaf' &&
    right.type === 'leaf' &&
    left.length + right.length <= MAX_LEAF_SIZE
  ) {
    return createLeaf(left.text + right.text);
  }

  // 创建分支节点
  const branch = createBranch(left, right);
  return balance(branch);
}

/**
 * 在指定位置分割节点
 */
function split(node: RopeNode, offset: number): [RopeNode | null, RopeNode | null] {
  if (offset <= 0) {
    return [null, node];
  }
  if (offset >= node.length) {
    return [node, null];
  }

  if (node.type === 'leaf') {
    const leftText = node.text.slice(0, offset);
    const rightText = node.text.slice(offset);
    return [
      leftText.length > 0 ? createLeaf(leftText) : null,
      rightText.length > 0 ? createLeaf(rightText) : null,
    ];
  }

  // 分支节点
  if (offset <= node.left.length) {
    const [leftPart, rightPart] = split(node.left, offset);
    return [leftPart, concat(rightPart, node.right)];
  } else {
    const [leftPart, rightPart] = split(node.right, offset - node.left.length);
    return [concat(node.left, leftPart), rightPart];
  }
}

/**
 * 从文本创建 Rope 节点
 */
function fromString(text: string): RopeNode | null {
  if (text.length === 0) {
    return null;
  }

  if (text.length <= MAX_LEAF_SIZE) {
    return createLeaf(text);
  }

  // 分割成多个叶子节点
  const chunks: RopeNode[] = [];
  for (let i = 0; i < text.length; i += MAX_LEAF_SIZE) {
    const chunk = text.slice(i, Math.min(i + MAX_LEAF_SIZE, text.length));
    chunks.push(createLeaf(chunk));
  }

  // 构建平衡树
  while (chunks.length > 1) {
    const newChunks: RopeNode[] = [];
    for (let i = 0; i < chunks.length; i += 2) {
      if (i + 1 < chunks.length) {
        const merged = concat(chunks[i]!, chunks[i + 1]!);
        if (merged) {
          newChunks.push(merged);
        }
      } else {
        newChunks.push(chunks[i]!);
      }
    }
    chunks.length = 0;
    chunks.push(...newChunks);
  }

  return chunks[0] ?? null;
}

/**
 * 将节点转换为字符串
 */
function nodeToString(node: RopeNode | null): string {
  if (!node) {
    return '';
  }

  if (node.type === 'leaf') {
    return node.text;
  }

  return nodeToString(node.left) + nodeToString(node.right);
}

/**
 * 获取指定范围的文本
 */
function nodeSlice(node: RopeNode | null, start: number, end: number): string {
  if (!node || start >= end) {
    return '';
  }

  if (node.type === 'leaf') {
    return node.text.slice(Math.max(0, start), Math.min(end, node.length));
  }

  const leftLen = node.left.length;

  if (end <= leftLen) {
    return nodeSlice(node.left, start, end);
  }
  if (start >= leftLen) {
    return nodeSlice(node.right, start - leftLen, end - leftLen);
  }

  return nodeSlice(node.left, start, leftLen) + nodeSlice(node.right, 0, end - leftLen);
}

/**
 * 收集所有换行符位置
 */
function collectLineBreaks(node: RopeNode | null, offset: number, result: number[]): void {
  if (!node) {
    return;
  }

  if (node.type === 'leaf') {
    for (const pos of node.lineBreakOffsets) {
      result.push(offset + pos);
    }
    return;
  }

  collectLineBreaks(node.left, offset, result);
  collectLineBreaks(node.right, offset + node.left.length, result);
}

// ================================
// Rope 类
// ================================

/**
 * Rope 文本缓冲区实现
 *
 * 核心思想：
 * 1. 使用平衡二叉树存储文本片段
 * 2. 每个叶子节点存储一小段文本
 * 3. 分支节点维护子树的统计信息
 * 4. 所有操作都创建新节点（不可变）
 */
export class Rope implements ITextBuffer {
  /** 根节点 */
  private readonly root: RopeNode | null;

  /** 行缓存 */
  private lineCache: LineCache;

  /** 是否启用行缓存 */
  private readonly enableLineCache: boolean;

  constructor(content: string | RopeNode | null = '', enableLineCache: boolean = true) {
    if (typeof content === 'string') {
      this.root = fromString(content);
    } else {
      this.root = content;
    }
    this.enableLineCache = enableLineCache;
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
    return this.root?.length ?? 0;
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
    return nodeToString(this.root);
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

    return nodeSlice(this.root, actualStart, actualEnd);
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
    let result: ITextBuffer = this;

    // 按位置从后往前应用变更
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
    const actualFrom = Math.max(0, Math.min(from, this.length));
    const actualTo = Math.max(actualFrom, Math.min(to, this.length));

    // 分割操作
    const [left, rest] = split(this.root ?? createLeaf(''), actualFrom);
    const [, right] = rest ? split(rest, actualTo - actualFrom) : [null, null];

    // 创建新文本节点
    const newNode = text.length > 0 ? fromString(text) : null;

    // 合并节点
    let newRoot = concat(left, newNode);
    newRoot = concat(newRoot, right);

    return new Rope(newRoot, this.enableLineCache);
  }

  // ================================
  // 内部方法
  // ================================

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
    const lineBreakPositions: number[] = [];
    collectLineBreaks(this.root, 0, lineBreakPositions);

    const lineStarts: number[] = [0];
    for (const pos of lineBreakPositions) {
      lineStarts.push(pos + 1);
    }

    this.lineCache = {
      valid: true,
      lineStarts,
      lineCount: lineStarts.length,
    };
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Rope 实例
 */
export function createRope(initialContent: string = '', enableLineCache: boolean = true): Rope {
  return new Rope(initialContent, enableLineCache);
}
