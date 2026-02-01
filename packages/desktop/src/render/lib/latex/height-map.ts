// ================================
// 高度映射系统 (HeightMap)
//
// 基于 CodeMirror 6 的 HeightMap 设计思路，实现精确的源码-渲染位置映射
// 核心特性：
// 1. 使用平衡二叉树存储块高度信息，支持 O(log n) 查询和更新
// 2. 支持估算值和真实测量值的混合使用
// 3. 增量更新机制，只更新变更区域
// 4. 与 DOM 测量集成，支持 ResizeObserver 回写
// ================================

/**
 * 块类型
 */
export type HeightBlockType =
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
  | 'preamble'
  | 'document'
  | 'error'
  | 'unknown';

/**
 * 高度块信息
 */
export interface HeightBlock {
  /** 块 ID */
  id: string;
  /** 块类型 */
  type: HeightBlockType;
  /** 源码起始行（0-based） */
  sourceStartLine: number;
  /** 源码结束行（0-based，包含） */
  sourceEndLine: number;
  /** 源码起始偏移量 */
  sourceStartOffset: number;
  /** 源码结束偏移量 */
  sourceEndOffset: number;
  /** 渲染顶部位置（像素） */
  renderTop: number;
  /** 渲染高度（像素） */
  renderHeight: number;
  /** 是否已通过 DOM 测量 */
  measured: boolean;
  /** 优先级（用于滚动同步） */
  priority: number;
}

/**
 * 高度树节点（平衡二叉树）
 */
interface HeightNode {
  /** 节点类型 */
  type: 'leaf' | 'branch';
  /** 子树覆盖的总行数 */
  lineCount: number;
  /** 子树的总渲染高度 */
  totalHeight: number;
  /** 子树中已测量块的数量 */
  measuredCount: number;
  /** 节点深度（用于平衡） */
  depth: number;
}

/**
 * 叶子节点（存储实际块信息）
 */
interface HeightLeaf extends HeightNode {
  type: 'leaf';
  /** 块信息 */
  block: HeightBlock;
}

/**
 * 分支节点（二叉树内部节点）
 */
interface HeightBranch extends HeightNode {
  type: 'branch';
  /** 左子树 */
  left: HeightNode;
  /** 右子树 */
  right: HeightNode;
  /** 左子树覆盖的最大行号 */
  leftMaxLine: number;
}

/**
 * 位置查询结果
 */
export interface PositionQueryResult {
  /** 是否精确匹配 */
  exact: boolean;
  /** 匹配的块 */
  block: HeightBlock | null;
  /** 插值计算的渲染位置 */
  interpolatedPosition: number;
  /** 前一个块 */
  prevBlock: HeightBlock | null;
  /** 后一个块 */
  nextBlock: HeightBlock | null;
}

/**
 * 行查询结果
 */
export interface LineQueryResult {
  /** 是否精确匹配 */
  exact: boolean;
  /** 匹配的块 */
  block: HeightBlock | null;
  /** 插值计算的源码行 */
  interpolatedLine: number;
  /** 前一个块 */
  prevBlock: HeightBlock | null;
  /** 后一个块 */
  nextBlock: HeightBlock | null;
}

/**
 * 高度映射配置
 */
export interface HeightMapConfig {
  /** 默认行高估算值（像素） */
  defaultLineHeight: number;
  /** 容器高度 */
  containerHeight: number;
  /** 总行数 */
  totalLines: number;
  /** 调试模式 */
  debug: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: HeightMapConfig = {
  defaultLineHeight: 24,
  containerHeight: 0,
  totalLines: 0,
  debug: false,
};

// ================================
// 工具函数
// ================================

/**
 * 判断是否为叶子节点
 */
function isLeaf(node: HeightNode): node is HeightLeaf {
  return node.type === 'leaf';
}

/**
 * 创建叶子节点
 */
function createLeaf(block: HeightBlock): HeightLeaf {
  const lineCount = block.sourceEndLine - block.sourceStartLine + 1;
  return {
    type: 'leaf',
    lineCount,
    totalHeight: block.renderHeight,
    measuredCount: block.measured ? 1 : 0,
    depth: 0,
    block,
  };
}

/**
 * 创建分支节点
 */
function createBranch(left: HeightNode, right: HeightNode): HeightBranch {
  // 计算左子树的最大行号
  let leftMaxLine = 0;
  if (isLeaf(left)) {
    leftMaxLine = left.block.sourceEndLine;
  } else {
    // 递归获取左子树的最大行号
    leftMaxLine = getMaxLine(left);
  }

  return {
    type: 'branch',
    left,
    right,
    leftMaxLine,
    lineCount: left.lineCount + right.lineCount,
    totalHeight: left.totalHeight + right.totalHeight,
    measuredCount: left.measuredCount + right.measuredCount,
    depth: Math.max(left.depth, right.depth) + 1,
  };
}

/**
 * 获取节点覆盖的最大行号
 */
function getMaxLine(node: HeightNode): number {
  if (isLeaf(node)) {
    return node.block.sourceEndLine;
  }
  const branch = node as HeightBranch;
  return getMaxLine(branch.right);
}

/**
 * 获取节点覆盖的最小行号
 */
function getMinLine(node: HeightNode): number {
  if (isLeaf(node)) {
    return node.block.sourceStartLine;
  }
  const branch = node as HeightBranch;
  return getMinLine(branch.left);
}

/**
 * 获取平衡因子
 */
function getBalanceFactor(node: HeightBranch): number {
  return node.right.depth - node.left.depth;
}

/**
 * 右旋转
 */
function rotateRight(node: HeightBranch): HeightNode {
  if (!isLeaf(node.left) && node.left.type === 'branch') {
    const left = node.left as HeightBranch;
    const newRight = createBranch(left.right, node.right);
    return createBranch(left.left, newRight);
  }
  return node;
}

/**
 * 左旋转
 */
function rotateLeft(node: HeightBranch): HeightNode {
  if (!isLeaf(node.right) && node.right.type === 'branch') {
    const right = node.right as HeightBranch;
    const newLeft = createBranch(node.left, right.left);
    return createBranch(newLeft, right.right);
  }
  return node;
}

/**
 * 平衡节点（AVL 平衡）
 */
function balance(node: HeightNode): HeightNode {
  if (isLeaf(node)) {
    return node;
  }

  const branch = node as HeightBranch;
  const factor = getBalanceFactor(branch);

  // 右重
  if (factor > 1) {
    if (!isLeaf(branch.right)) {
      const rightBranch = branch.right as HeightBranch;
      if (getBalanceFactor(rightBranch) < 0) {
        // 右左情况
        const newRight = rotateRight(rightBranch);
        return rotateLeft(createBranch(branch.left, newRight) as HeightBranch);
      }
    }
    // 右右情况
    return rotateLeft(branch);
  }

  // 左重
  if (factor < -1) {
    if (!isLeaf(branch.left)) {
      const leftBranch = branch.left as HeightBranch;
      if (getBalanceFactor(leftBranch) > 0) {
        // 左右情况
        const newLeft = rotateLeft(leftBranch);
        return rotateRight(createBranch(newLeft, branch.right) as HeightBranch);
      }
    }
    // 左左情况
    return rotateRight(branch);
  }

  return node;
}

/**
 * 在树中插入块
 */
function insertBlock(root: HeightNode | null, block: HeightBlock): HeightNode {
  const leaf = createLeaf(block);

  if (!root) {
    return leaf;
  }

  return insertNode(root, leaf, block.sourceStartLine);
}

/**
 * 递归插入节点
 */
function insertNode(node: HeightNode, newLeaf: HeightLeaf, line: number): HeightNode {
  if (isLeaf(node)) {
    // 在叶子节点位置插入
    if (line <= node.block.sourceStartLine) {
      return balance(createBranch(newLeaf, node));
    } else {
      return balance(createBranch(node, newLeaf));
    }
  }

  const branch = node as HeightBranch;

  // 根据行号决定插入左子树还是右子树
  if (line <= branch.leftMaxLine) {
    const newLeft = insertNode(branch.left, newLeaf, line);
    return balance(createBranch(newLeft, branch.right));
  } else {
    const newRight = insertNode(branch.right, newLeaf, line);
    return balance(createBranch(branch.left, newRight));
  }
}

/**
 * 在树中查找块（按行号）
 */
function findBlockByLine(node: HeightNode | null, line: number): HeightLeaf | null {
  if (!node) {
    return null;
  }

  if (isLeaf(node)) {
    if (line >= node.block.sourceStartLine && line <= node.block.sourceEndLine) {
      return node;
    }
    return null;
  }

  const branch = node as HeightBranch;

  if (line <= branch.leftMaxLine) {
    return findBlockByLine(branch.left, line);
  } else {
    return findBlockByLine(branch.right, line);
  }
}

/**
 * 在树中查找块（按 ID）
 * @internal 保留用于未来扩展
 */
export function findBlockById(node: HeightNode | null, id: string): HeightLeaf | null {
  if (!node) {
    return null;
  }

  if (isLeaf(node)) {
    if (node.block.id === id) {
      return node;
    }
    return null;
  }

  const branch = node as HeightBranch;

  // 先查左子树
  const leftResult = findBlockById(branch.left, id);
  if (leftResult) {
    return leftResult;
  }

  // 再查右子树
  return findBlockById(branch.right, id);
}

/**
 * 收集所有叶子节点
 * @internal 保留用于未来扩展
 */
export function collectLeaves(node: HeightNode | null, leaves: HeightLeaf[]): void {
  if (!node) {
    return;
  }

  if (isLeaf(node)) {
    leaves.push(node);
    return;
  }

  const branch = node as HeightBranch;
  collectLeaves(branch.left, leaves);
  collectLeaves(branch.right, leaves);
}

/**
 * 计算指定行之前的累计高度
 */
function getHeightBeforeLine(node: HeightNode | null, line: number): number {
  if (!node) {
    return 0;
  }

  if (isLeaf(node)) {
    if (line <= node.block.sourceStartLine) {
      return 0;
    }
    if (line > node.block.sourceEndLine) {
      return node.totalHeight;
    }
    // 行在块内部，按比例插值
    const lineOffset = line - node.block.sourceStartLine;
    const lineCount = node.block.sourceEndLine - node.block.sourceStartLine + 1;
    return (lineOffset / lineCount) * node.totalHeight;
  }

  const branch = node as HeightBranch;

  if (line <= getMinLine(branch.left)) {
    return 0;
  }

  if (line > branch.leftMaxLine) {
    // 行在右子树
    return branch.left.totalHeight + getHeightBeforeLine(branch.right, line);
  } else {
    // 行在左子树
    return getHeightBeforeLine(branch.left, line);
  }
}

/**
 * 根据渲染位置查找对应的行
 */
function getLineAtHeight(node: HeightNode | null, height: number): number {
  if (!node) {
    return 0;
  }

  if (isLeaf(node)) {
    if (height <= 0) {
      return node.block.sourceStartLine;
    }
    if (height >= node.totalHeight) {
      return node.block.sourceEndLine;
    }
    // 按比例插值
    const ratio = height / node.totalHeight;
    const lineCount = node.block.sourceEndLine - node.block.sourceStartLine + 1;
    return Math.floor(node.block.sourceStartLine + ratio * lineCount);
  }

  const branch = node as HeightBranch;

  if (height < branch.left.totalHeight) {
    return getLineAtHeight(branch.left, height);
  } else {
    return getLineAtHeight(branch.right, height - branch.left.totalHeight);
  }
}

// ================================
// HeightMap 类
// ================================

/**
 * 高度映射系统
 *
 * 提供精确的源码行号到渲染位置的双向映射
 * 支持估算值和真实测量值的混合使用
 */
export class HeightMap {
  /** 配置 */
  private config: HeightMapConfig;

  /** 根节点 */
  private root: HeightNode | null = null;

  /** 块 ID 索引（用于快速查找） */
  private blockIndex: Map<string, HeightBlock> = new Map();

  /** 已测量块数量 */
  private measuredCount: number = 0;

  /** 总块数 */
  private totalBlocks: number = 0;

  /** 版本号（用于变更检测） */
  private version: number = 0;

  constructor(config: Partial<HeightMapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 配置方法
  // ================================

  /**
   * 设置总行数
   */
  setTotalLines(lines: number): void {
    this.config.totalLines = lines;
  }

  /**
   * 设置容器高度
   */
  setContainerHeight(height: number): void {
    this.config.containerHeight = height;
  }

  /**
   * 获取容器高度
   */
  getContainerHeight(): number {
    return this.config.containerHeight;
  }

  /**
   * 获取总渲染高度
   */
  getTotalHeight(): number {
    return this.root?.totalHeight ?? 0;
  }

  // ================================
  // 块操作方法
  // ================================

  /**
   * 添加块
   */
  addBlock(block: HeightBlock): void {
    // 更新索引
    this.blockIndex.set(block.id, block);

    // 插入树
    this.root = insertBlock(this.root, block);

    // 更新统计
    this.totalBlocks++;
    if (block.measured) {
      this.measuredCount++;
    }

    this.version++;
  }

  /**
   * 批量添加块
   */
  addBlocks(blocks: HeightBlock[]): void {
    // 按行号排序
    const sortedBlocks = [...blocks].sort((a, b) => a.sourceStartLine - b.sourceStartLine);

    for (const block of sortedBlocks) {
      this.addBlock(block);
    }
  }

  /**
   * 更新块的渲染位置
   */
  updateBlockPosition(id: string, renderTop: number, renderHeight: number): boolean {
    const block = this.blockIndex.get(id);
    if (!block) {
      return false;
    }

    const wasMeasured = block.measured;

    // 更新块信息
    block.renderTop = renderTop;
    block.renderHeight = renderHeight;
    block.measured = true;

    // 更新统计
    if (!wasMeasured) {
      this.measuredCount++;
    }

    // 需要重建树以更新高度统计
    this.rebuildTree();

    this.version++;
    return true;
  }

  /**
   * 批量更新块位置
   */
  updateBlockPositions(
    updates: Array<{ id: string; renderTop: number; renderHeight: number }>
  ): number {
    let updated = 0;

    for (const { id, renderTop, renderHeight } of updates) {
      const block = this.blockIndex.get(id);
      if (block) {
        const wasMeasured = block.measured;
        block.renderTop = renderTop;
        block.renderHeight = renderHeight;
        block.measured = true;

        if (!wasMeasured) {
          this.measuredCount++;
        }
        updated++;
      }
    }

    if (updated > 0) {
      this.rebuildTree();
      this.version++;
    }

    return updated;
  }

  /**
   * 获取块
   */
  getBlock(id: string): HeightBlock | undefined {
    return this.blockIndex.get(id);
  }

  /**
   * 移除块
   */
  removeBlock(id: string): boolean {
    const block = this.blockIndex.get(id);
    if (!block) {
      return false;
    }

    this.blockIndex.delete(id);
    this.totalBlocks--;
    if (block.measured) {
      this.measuredCount--;
    }

    // 重建树
    this.rebuildTree();
    this.version++;

    return true;
  }

  /**
   * 清除所有块
   */
  clear(): void {
    this.root = null;
    this.blockIndex.clear();
    this.measuredCount = 0;
    this.totalBlocks = 0;
    this.version++;
  }

  // ================================
  // 查询方法
  // ================================

  /**
   * 根据源码行号获取渲染位置
   */
  getPositionForLine(line: number): PositionQueryResult {
    // 查找包含该行的块
    const leaf = findBlockByLine(this.root, line);

    if (leaf) {
      // 精确匹配
      const block = leaf.block;
      const lineOffset = line - block.sourceStartLine;
      const lineCount = block.sourceEndLine - block.sourceStartLine + 1;
      const positionOffset = (lineOffset / lineCount) * block.renderHeight;

      return {
        exact: true,
        block,
        interpolatedPosition: block.renderTop + positionOffset,
        prevBlock: this.findPrevBlock(block),
        nextBlock: this.findNextBlock(block),
      };
    }

    // 未找到精确匹配，使用插值
    const interpolatedPosition = getHeightBeforeLine(this.root, line);
    const prevBlock = this.findBlockBeforeLine(line);
    const nextBlock = this.findBlockAfterLine(line);

    return {
      exact: false,
      block: null,
      interpolatedPosition,
      prevBlock,
      nextBlock,
    };
  }

  /**
   * 根据渲染位置获取源码行号
   */
  getLineForPosition(position: number): LineQueryResult {
    // 使用累计高度计算行号
    const line = getLineAtHeight(this.root, position);

    // 查找包含该行的块
    const leaf = findBlockByLine(this.root, line);

    if (leaf) {
      const block = leaf.block;
      const posOffset = position - block.renderTop;
      const lineCount = block.sourceEndLine - block.sourceStartLine + 1;

      // 检查位置是否在块内部
      if (posOffset >= 0 && posOffset <= block.renderHeight) {
        const lineOffset = Math.floor((posOffset / block.renderHeight) * lineCount);
        return {
          exact: true,
          block,
          interpolatedLine: block.sourceStartLine + lineOffset,
          prevBlock: this.findPrevBlock(block),
          nextBlock: this.findNextBlock(block),
        };
      }
    }

    // 未找到精确匹配，使用插值
    return {
      exact: false,
      block: null,
      interpolatedLine: line,
      prevBlock: this.findBlockBeforePosition(position),
      nextBlock: this.findBlockAfterPosition(position),
    };
  }

  /**
   * 获取指定行范围内的所有块
   */
  getBlocksInLineRange(startLine: number, endLine: number): HeightBlock[] {
    const result: HeightBlock[] = [];

    for (const block of this.blockIndex.values()) {
      if (block.sourceEndLine >= startLine && block.sourceStartLine <= endLine) {
        result.push(block);
      }
    }

    return result.sort((a, b) => a.sourceStartLine - b.sourceStartLine);
  }

  /**
   * 获取指定位置范围内的所有块
   */
  getBlocksInPositionRange(startPos: number, endPos: number): HeightBlock[] {
    const result: HeightBlock[] = [];

    for (const block of this.blockIndex.values()) {
      const blockEnd = block.renderTop + block.renderHeight;
      if (blockEnd >= startPos && block.renderTop <= endPos) {
        result.push(block);
      }
    }

    return result.sort((a, b) => a.renderTop - b.renderTop);
  }

  /**
   * 获取可见区域内的块
   */
  getVisibleBlocks(scrollTop: number, viewportHeight: number): HeightBlock[] {
    return this.getBlocksInPositionRange(scrollTop, scrollTop + viewportHeight);
  }

  /**
   * 获取所有块
   */
  getAllBlocks(): HeightBlock[] {
    return Array.from(this.blockIndex.values()).sort(
      (a, b) => a.sourceStartLine - b.sourceStartLine
    );
  }

  // ================================
  // 滚动同步方法
  // ================================

  /**
   * 计算预览区域的滚动位置（基于源码滚动位置）
   *
   * @param sourceScrollTop 源码区域的滚动位置
   * @param sourceViewportHeight 源码区域的视口高度
   * @param sourceTotalHeight 源码区域的总高度
   */
  computePreviewScrollPosition(
    sourceScrollTop: number,
    sourceViewportHeight: number,
    sourceTotalHeight: number
  ): number {
    // 计算源码区域的滚动比例
    const maxSourceScroll = Math.max(0, sourceTotalHeight - sourceViewportHeight);
    if (maxSourceScroll <= 0) {
      return 0;
    }

    const scrollRatio = sourceScrollTop / maxSourceScroll;

    // 计算可见区域中心对应的源码行
    const sourceLineHeight = this.config.defaultLineHeight;
    const visibleCenterOffset = sourceScrollTop + sourceViewportHeight / 2;
    const centerLine = Math.floor(visibleCenterOffset / sourceLineHeight);

    // 获取该行对应的渲染位置
    const result = this.getPositionForLine(centerLine);
    const previewCenterPosition = result.interpolatedPosition;

    // 计算预览区域的滚动位置
    const totalHeight = this.getTotalHeight();
    const previewViewportHeight = this.config.containerHeight || sourceViewportHeight;
    const maxPreviewScroll = Math.max(0, totalHeight - previewViewportHeight);

    if (maxPreviewScroll <= 0) {
      return 0;
    }

    // 使用混合策略：70% 基于精确位置，30% 基于比例
    const positionBasedScroll = Math.max(
      0,
      Math.min(previewCenterPosition - previewViewportHeight / 2, maxPreviewScroll)
    );
    const ratioBasedScroll = scrollRatio * maxPreviewScroll;

    // 根据测量率调整权重
    const measurementRate = this.getMeasurementRate();
    const positionWeight = 0.5 + measurementRate * 0.4; // 0.5 - 0.9
    const ratioWeight = 1 - positionWeight;

    return Math.round(positionBasedScroll * positionWeight + ratioBasedScroll * ratioWeight);
  }

  /**
   * 计算源码区域的滚动位置（基于预览滚动位置）
   *
   * @param previewScrollTop 预览区域的滚动位置
   * @param previewViewportHeight 预览区域的视口高度
   */
  computeSourceScrollPosition(
    previewScrollTop: number,
    previewViewportHeight: number,
    sourceTotalHeight: number
  ): number {
    const totalHeight = this.getTotalHeight();
    const maxPreviewScroll = Math.max(0, totalHeight - previewViewportHeight);

    if (maxPreviewScroll <= 0) {
      return 0;
    }

    // 计算预览区域的滚动比例
    const scrollRatio = previewScrollTop / maxPreviewScroll;

    // 计算可见区域中心对应的渲染位置
    const visibleCenterPosition = previewScrollTop + previewViewportHeight / 2;

    // 获取该位置对应的源码行
    const result = this.getLineForPosition(visibleCenterPosition);
    const centerLine = result.interpolatedLine;

    // 计算源码区域的滚动位置
    const sourceLineHeight = this.config.defaultLineHeight;
    const sourceViewportHeight = previewViewportHeight; // 假设相同高度
    const maxSourceScroll = Math.max(0, sourceTotalHeight - sourceViewportHeight);

    if (maxSourceScroll <= 0) {
      return 0;
    }

    // 使用混合策略
    const lineBasedScroll = Math.max(
      0,
      Math.min(centerLine * sourceLineHeight - sourceViewportHeight / 2, maxSourceScroll)
    );
    const ratioBasedScroll = scrollRatio * maxSourceScroll;

    // 根据测量率调整权重
    const measurementRate = this.getMeasurementRate();
    const lineWeight = 0.5 + measurementRate * 0.4;
    const ratioWeight = 1 - lineWeight;

    return Math.round(lineBasedScroll * lineWeight + ratioBasedScroll * ratioWeight);
  }

  // ================================
  // 统计方法
  // ================================

  /**
   * 获取块数量
   */
  get blockCount(): number {
    return this.totalBlocks;
  }

  /**
   * 获取已测量块数量
   */
  getMeasuredCount(): number {
    return this.measuredCount;
  }

  /**
   * 获取测量率
   */
  getMeasurementRate(): number {
    if (this.totalBlocks === 0) {
      return 0;
    }
    return this.measuredCount / this.totalBlocks;
  }

  /**
   * 获取版本号
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    blockCount: number;
    measuredCount: number;
    measurementRate: number;
    totalHeight: number;
    totalLines: number;
    averageBlockHeight: number;
    treeDepth: number;
  } {
    return {
      blockCount: this.totalBlocks,
      measuredCount: this.measuredCount,
      measurementRate: this.getMeasurementRate(),
      totalHeight: this.getTotalHeight(),
      totalLines: this.config.totalLines,
      averageBlockHeight: this.totalBlocks > 0 ? this.getTotalHeight() / this.totalBlocks : 0,
      treeDepth: this.root?.depth ?? 0,
    };
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 重建树
   */
  private rebuildTree(): void {
    // 收集所有块并按行号排序
    const blocks = Array.from(this.blockIndex.values()).sort(
      (a, b) => a.sourceStartLine - b.sourceStartLine
    );

    // 更新渲染位置
    let currentTop = 0;
    for (const block of blocks) {
      block.renderTop = currentTop;
      currentTop += block.renderHeight;
    }

    // 重建平衡树
    this.root = this.buildTreeFromBlocks(blocks, 0, blocks.length - 1);
  }

  /**
   * 从块数组构建平衡树
   */
  private buildTreeFromBlocks(
    blocks: HeightBlock[],
    start: number,
    end: number
  ): HeightNode | null {
    if (start > end) {
      return null;
    }

    if (start === end) {
      return createLeaf(blocks[start]!);
    }

    const mid = Math.floor((start + end) / 2);
    const left = this.buildTreeFromBlocks(blocks, start, mid);
    const right = this.buildTreeFromBlocks(blocks, mid + 1, end);

    if (!left) return right;
    if (!right) return left;

    return createBranch(left, right);
  }

  /**
   * 查找指定行之前的块
   */
  private findBlockBeforeLine(line: number): HeightBlock | null {
    let result: HeightBlock | null = null;

    for (const block of this.blockIndex.values()) {
      if (block.sourceEndLine < line) {
        if (!result || block.sourceEndLine > result.sourceEndLine) {
          result = block;
        }
      }
    }

    return result;
  }

  /**
   * 查找指定行之后的块
   */
  private findBlockAfterLine(line: number): HeightBlock | null {
    let result: HeightBlock | null = null;

    for (const block of this.blockIndex.values()) {
      if (block.sourceStartLine > line) {
        if (!result || block.sourceStartLine < result.sourceStartLine) {
          result = block;
        }
      }
    }

    return result;
  }

  /**
   * 查找指定位置之前的块
   */
  private findBlockBeforePosition(position: number): HeightBlock | null {
    let result: HeightBlock | null = null;

    for (const block of this.blockIndex.values()) {
      const blockEnd = block.renderTop + block.renderHeight;
      if (blockEnd < position) {
        if (!result || blockEnd > result.renderTop + result.renderHeight) {
          result = block;
        }
      }
    }

    return result;
  }

  /**
   * 查找指定位置之后的块
   */
  private findBlockAfterPosition(position: number): HeightBlock | null {
    let result: HeightBlock | null = null;

    for (const block of this.blockIndex.values()) {
      if (block.renderTop > position) {
        if (!result || block.renderTop < result.renderTop) {
          result = block;
        }
      }
    }

    return result;
  }

  /**
   * 查找上一个块
   */
  private findPrevBlock(currentBlock: HeightBlock): HeightBlock | null {
    return this.findBlockBeforeLine(currentBlock.sourceStartLine);
  }

  /**
   * 查找下一个块
   */
  private findNextBlock(currentBlock: HeightBlock): HeightBlock | null {
    return this.findBlockAfterLine(currentBlock.sourceEndLine);
  }
}

// ================================
// DOM 测量工具
// ================================

/**
 * DOM 测量选项
 */
export interface DOMMeasurementOptions {
  /** 块元素选择器 */
  blockSelector: string;
  /** 块 ID 属性名 */
  blockIdAttribute: string;
  /** 是否只测量可见区域 */
  visibleOnly: boolean;
  /** 容器元素 */
  container: HTMLElement;
}

/**
 * 默认测量选项
 */
const DEFAULT_MEASUREMENT_OPTIONS: Partial<DOMMeasurementOptions> = {
  blockSelector: '[data-block-id]',
  blockIdAttribute: 'data-block-id',
  visibleOnly: true,
};

/**
 * 测量 DOM 块的高度
 */
export function measureDOMBlocks(
  options: Partial<DOMMeasurementOptions> & { container: HTMLElement }
): Array<{ id: string; renderTop: number; renderHeight: number }> {
  const opts = { ...DEFAULT_MEASUREMENT_OPTIONS, ...options };
  const measurements: Array<{ id: string; renderTop: number; renderHeight: number }> = [];

  const containerRect = opts.container.getBoundingClientRect();
  const blockSelector = opts.blockSelector ?? '[data-block-id]';
  const blocks = opts.container.querySelectorAll(blockSelector);

  for (const block of blocks) {
    const blockIdAttr = opts.blockIdAttribute ?? 'data-block-id';
    const id = block.getAttribute(blockIdAttr);
    if (!id) continue;

    const rect = block.getBoundingClientRect();
    const renderTop = rect.top - containerRect.top + opts.container.scrollTop;
    const renderHeight = rect.height;

    // 如果只测量可见区域，检查是否在视口内
    if (opts.visibleOnly) {
      const viewportTop = opts.container.scrollTop;
      const viewportBottom = viewportTop + opts.container.clientHeight;

      if (renderTop + renderHeight < viewportTop || renderTop > viewportBottom) {
        continue;
      }
    }

    measurements.push({ id, renderTop, renderHeight });
  }

  return measurements;
}

/**
 * 创建 ResizeObserver 用于监听块高度变化
 */
export function createBlockResizeObserver(
  container: HTMLElement,
  heightMap: HeightMap,
  options: Partial<DOMMeasurementOptions> = {}
): ResizeObserver {
  const opts = { ...DEFAULT_MEASUREMENT_OPTIONS, ...options };

  const observer = new ResizeObserver((entries) => {
    const updates: Array<{ id: string; renderTop: number; renderHeight: number }> = [];

    const blockIdAttr = opts.blockIdAttribute ?? 'data-block-id';
    for (const entry of entries) {
      const block = entry.target as HTMLElement;
      const id = block.getAttribute(blockIdAttr);
      if (!id) continue;

      const containerRect = container.getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      const renderTop = rect.top - containerRect.top + container.scrollTop;
      const renderHeight = entry.borderBoxSize?.[0]?.blockSize ?? rect.height;

      updates.push({ id, renderTop, renderHeight });
    }

    if (updates.length > 0) {
      heightMap.updateBlockPositions(updates);
    }
  });

  // 观察所有块元素
  const blockSelector = opts.blockSelector ?? '[data-block-id]';
  const blocks = container.querySelectorAll(blockSelector);
  for (const block of blocks) {
    observer.observe(block);
  }

  return observer;
}

/**
 * 创建 IntersectionObserver 用于监听块可见性
 */
export function createBlockVisibilityObserver(
  container: HTMLElement,
  onVisibilityChange: (id: string, isVisible: boolean) => void,
  options: Partial<DOMMeasurementOptions> = {}
): IntersectionObserver {
  const opts = { ...DEFAULT_MEASUREMENT_OPTIONS, ...options };

  const blockIdAttr = opts.blockIdAttribute ?? 'data-block-id';
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const block = entry.target as HTMLElement;
        const id = block.getAttribute(blockIdAttr);
        if (!id) continue;

        onVisibilityChange(id, entry.isIntersecting);
      }
    },
    {
      root: container,
      threshold: [0, 0.1, 0.5, 1],
    }
  );

  // 观察所有块元素
  const blockSelector = opts.blockSelector ?? '[data-block-id]';
  const blocks = container.querySelectorAll(blockSelector);
  for (const block of blocks) {
    observer.observe(block);
  }

  return observer;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 HeightMap 实例
 */
export function createHeightMap(config: Partial<HeightMapConfig> = {}): HeightMap {
  return new HeightMap(config);
}

/**
 * 从 AST 创建 HeightMap
 */
export function createHeightMapFromAST(
  ast: { id: string; start: number; end: number; type: string; children?: unknown[] },
  sourceContent: string,
  config: Partial<HeightMapConfig> = {}
): HeightMap {
  const heightMap = new HeightMap(config);

  // 计算行偏移量
  const lineOffsets: number[] = [0];
  for (let i = 0; i < sourceContent.length; i++) {
    if (sourceContent[i] === '\n') {
      lineOffsets.push(i + 1);
    }
  }

  // 设置总行数
  heightMap.setTotalLines(lineOffsets.length);

  // 辅助函数：根据偏移量获取行号
  const getLineFromOffset = (offset: number): number => {
    let low = 0;
    let high = lineOffsets.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (lineOffsets[mid]! <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    return low;
  };

  // 辅助函数：映射节点类型
  const mapNodeType = (type: string): HeightBlockType => {
    const typeMap: Record<string, HeightBlockType> = {
      root: 'document',
      preamble: 'preamble',
      document: 'document',
      section: 'section',
      paragraph: 'paragraph',
      math_inline: 'math-inline',
      math_block: 'math-block',
      list: 'list',
      environment: 'environment',
      command: 'command',
      text: 'text',
      error: 'error',
    };
    return typeMap[type] ?? 'unknown';
  };

  // 辅助函数：计算优先级
  const computePriority = (type: string): number => {
    const priorityMap: Record<string, number> = {
      section: 10,
      paragraph: 8,
      math_block: 7,
      list: 6,
      environment: 5,
      math_inline: 4,
      command: 3,
      text: 2,
    };
    return priorityMap[type] ?? 1;
  };

  // 收集需要映射的节点
  const collectNodes = (
    node: { id: string; start: number; end: number; type: string; children?: unknown[] },
    blocks: HeightBlock[]
  ): void => {
    const significantTypes = [
      'section',
      'paragraph',
      'math_block',
      'list',
      'environment',
      'preamble',
      'document',
    ];

    if (significantTypes.includes(node.type)) {
      const sourceStartLine = getLineFromOffset(node.start);
      const sourceEndLine = getLineFromOffset(node.end);
      const lineCount = sourceEndLine - sourceStartLine + 1;
      const estimatedHeight = lineCount * (config.defaultLineHeight ?? 24);

      blocks.push({
        id: node.id,
        type: mapNodeType(node.type),
        sourceStartLine,
        sourceEndLine,
        sourceStartOffset: node.start,
        sourceEndOffset: node.end,
        renderTop: 0, // 稍后计算
        renderHeight: estimatedHeight,
        measured: false,
        priority: computePriority(node.type),
      });
    }

    // 递归处理子节点
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && typeof child === 'object' && 'id' in child) {
          collectNodes(child as typeof node, blocks);
        }
      }
    }
  };

  // 收集所有块
  const blocks: HeightBlock[] = [];
  collectNodes(ast, blocks);

  // 按行号排序
  blocks.sort((a, b) => a.sourceStartLine - b.sourceStartLine);

  // 计算渲染位置
  let currentTop = 0;
  for (const block of blocks) {
    block.renderTop = currentTop;
    currentTop += block.renderHeight;
  }

  // 设置容器高度
  heightMap.setContainerHeight(currentTop);

  // 添加块
  heightMap.addBlocks(blocks);

  return heightMap;
}
