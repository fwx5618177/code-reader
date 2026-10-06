// ================================
// 块级增量渲染器
//
// 实现高效的 DOM 差异更新，只更新变化的部分
//
// 核心特性：
// 1. AST Diff：比较新旧 AST，标记变化的节点
// 2. 块级更新：只更新 modified 节点对应的 DOM
// 3. 节点复用：unchanged 节点完全不重新渲染
// 4. 批量更新：合并多个 DOM 操作，减少重排
// 5. 优先级队列：可视区域优先渲染
//
// 基于行业成熟方案：
// - morphdom: 无框架依赖的 DOM Diff
// - lit-html: 标记式更新
// - VS Code: 块级增量渲染
// ================================

import type { LatexNode, RootNode, AnyLatexNode, LatexNodeType, SectionNode } from './types';

// ================================
// 类型定义
// ================================

/** 节点差异类型 */
export type DiffType = 'added' | 'removed' | 'modified' | 'unchanged' | 'moved';

/** 节点差异信息 */
export interface NodeDiff {
  /** 差异类型 */
  readonly type: DiffType;
  /** 节点 ID */
  readonly nodeId: string;
  /** 旧节点（removed/modified 时存在） */
  readonly oldNode?: LatexNode;
  /** 新节点（added/modified 时存在） */
  readonly newNode?: LatexNode;
  /** 节点哈希值 */
  readonly hash?: string;
  /** 父节点 ID */
  readonly parentId?: string;
  /** 在父节点中的索引 */
  readonly index?: number;
}

/** AST 差异结果 */
export interface ASTDiffResult {
  /** 新增的节点 */
  readonly added: readonly NodeDiff[];
  /** 删除的节点 */
  readonly removed: readonly NodeDiff[];
  /** 修改的节点 */
  readonly modified: readonly NodeDiff[];
  /** 未变化的节点 */
  readonly unchanged: readonly NodeDiff[];
  /** 移动的节点 */
  readonly moved: readonly NodeDiff[];
  /** 差异统计 */
  readonly stats: DiffStats;
}

/** 差异统计 */
export interface DiffStats {
  /** 总节点数 */
  readonly totalNodes: number;
  /** 变化的节点数 */
  readonly changedNodes: number;
  /** 变化率 */
  readonly changeRatio: number;
  /** 计算耗时（毫秒） */
  readonly computeTime: number;
}

/** 渲染块 */
export interface RenderBlock {
  /** 块 ID */
  readonly id: string;
  /** 块类型 */
  readonly type: string;
  /** 渲染后的 HTML */
  readonly html: string;
  /** 源码起始位置 */
  readonly start: number;
  /** 源码结束位置 */
  readonly end: number;
  /** 节点哈希值 */
  readonly hash: string;
  /** 渲染优先级（数字越小优先级越高） */
  readonly priority: number;
}

/** DOM 更新操作 */
export interface DOMUpdate {
  /** 操作类型 */
  readonly type: 'insert' | 'remove' | 'replace' | 'move' | 'update-content';
  /** 目标元素 ID */
  readonly targetId: string;
  /** 新的 HTML 内容 */
  readonly html?: string;
  /** 参考元素 ID（用于 insert/move） */
  readonly referenceId?: string;
  /** 插入位置 */
  readonly position?: 'before' | 'after' | 'first' | 'last';
}

/** 增量渲染器配置 */
export interface IncrementalRendererConfig {
  /** 容器元素选择器或元素 */
  container: string | HTMLElement;
  /** 块选择器 */
  blockSelector?: string;
  /** 块 ID 属性名 */
  blockIdAttribute?: string;
  /** 是否启用批量更新 */
  enableBatching?: boolean;
  /** 批量更新延迟（毫秒） */
  batchDelay?: number;
  /** 是否启用动画 */
  enableAnimation?: boolean;
  /** 动画持续时间（毫秒） */
  animationDuration?: number;
  /** 渲染块回调 */
  onRenderBlock?: (block: RenderBlock) => string;
  /** 差异计算完成回调 */
  onDiffComplete?: (diff: ASTDiffResult) => void;
  /** 更新完成回调 */
  onUpdateComplete?: (updates: readonly DOMUpdate[]) => void;
}

/** 渲染缓存条目 */
interface RenderCacheEntry {
  /** 节点哈希值 */
  readonly hash: string;
  /** 渲染后的 HTML */
  readonly html: string;
  /** 创建时间 */
  readonly createdAt: number;
  /** 最后访问时间 */
  lastAccessedAt: number;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<Omit<IncrementalRendererConfig, 'container'>> = {
  blockSelector: '[data-block-id]',
  blockIdAttribute: 'data-block-id',
  enableBatching: true,
  batchDelay: 16,
  enableAnimation: false,
  animationDuration: 150,
  onRenderBlock: (block) => block.html,
  onDiffComplete: () => {},
  onUpdateComplete: () => {},
};

// ================================
// 工具函数
// ================================

/**
 * 计算字符串哈希值（FNV-1a）
 */
function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

/**
 * 计算节点哈希值
 */
function computeNodeHash(node: LatexNode | AnyLatexNode): string {
  const signature = `${node.type}:${node.start}:${node.end}`;
  const contentHash = 'raw' in node && typeof node.raw === 'string' ? hashString(node.raw) : '';
  return hashString(signature + contentHash);
}

/**
 * 收集 AST 中的所有节点（含 Preamble/Document、子节点、章节标题与命令/环境参数）
 */
function collectNodes(ast: RootNode | AnyLatexNode): Map<string, AnyLatexNode> {
  const nodes = new Map<string, AnyLatexNode>();

  const traverse = (node: AnyLatexNode): void => {
    nodes.set(node.id, node);

    switch (node.type) {
      case 'root':
        if (node.preamble) traverse(node.preamble);
        if (node.document) traverse(node.document);
        break;
      case 'section':
        for (const titleNode of node.title) {
          traverse(titleNode as AnyLatexNode);
        }
        break;
      case 'command':
      case 'environment':
        for (const argList of node.args) {
          for (const argNode of argList) {
            traverse(argNode as AnyLatexNode);
          }
        }
        break;
      default:
        break;
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child as AnyLatexNode);
      }
    }
  };

  traverse(ast);
  return nodes;
}

/** 节点类型到块级类型的映射 */
const BLOCK_TYPES: Partial<Record<LatexNodeType, string>> = {
  section: 'section',
  paragraph: 'paragraph',
  math_inline: 'math',
  math_block: 'math',
  list: 'list',
  list_item: 'list-item',
  environment: 'environment',
  command: 'command',
  text: 'text',
  error: 'error',
};

/**
 * 获取节点的块级类型
 */
function getBlockType(nodeType: LatexNodeType): string {
  return BLOCK_TYPES[nodeType] ?? 'block';
}

/** 节点类型到渲染优先级的映射（数值越小越优先） */
const RENDER_PRIORITIES: Partial<Record<LatexNodeType, number>> = {
  section: 1,
  paragraph: 4,
  math_block: 5,
  list: 6,
  math_inline: 8,
  environment: 9,
  command: 10,
  text: 11,
  error: 12,
};

/**
 * 计算渲染优先级
 */
function computePriority(nodeType: LatexNodeType): number {
  return RENDER_PRIORITIES[nodeType] ?? 10;
}

/** 章节级别到标题标签级别的映射 */
const SECTION_HEADING_LEVELS: Record<SectionNode['level'], number> = {
  part: 1,
  chapter: 1,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};

/**
 * 提取节点列表中的纯文本
 */
function extractNodesText(nodes: readonly LatexNode[]): string {
  let text = '';
  for (const child of nodes) {
    const typed = child as AnyLatexNode;
    if (typed.type === 'text') {
      text += typed.content;
    } else if (typed.children) {
      text += extractNodesText(typed.children);
    } else {
      text += typed.raw;
    }
  }
  return text;
}

// ================================
// AST Diff 算法
// ================================

/**
 * AST 差异计算器
 *
 * 使用节点哈希值快速检测变化，
 * 支持节点移动检测。
 */
export class ASTDiffer {
  /** 节点哈希缓存 */
  private readonly hashCache: Map<string, string>;

  constructor() {
    this.hashCache = new Map();
  }

  /**
   * 计算两个 AST 之间的差异
   */
  diff(oldAST: RootNode | null, newAST: RootNode): ASTDiffResult {
    const startTime = performance.now();

    // 收集节点
    const oldNodes = oldAST ? collectNodes(oldAST) : new Map<string, AnyLatexNode>();
    const newNodes = collectNodes(newAST);

    // 计算哈希值
    const oldHashes = new Map<string, string>();
    const newHashes = new Map<string, string>();

    for (const [id, node] of oldNodes) {
      const hash = this.getOrComputeHash(id, node);
      oldHashes.set(id, hash);
    }

    for (const [id, node] of newNodes) {
      const hash = this.getOrComputeHash(id, node);
      newHashes.set(id, hash);
    }

    // 分类节点
    const added: NodeDiff[] = [];
    const removed: NodeDiff[] = [];
    const modified: NodeDiff[] = [];
    const unchanged: NodeDiff[] = [];
    const moved: NodeDiff[] = [];

    // 检测新增和修改的节点
    for (const [id, node] of newNodes) {
      const newHash = newHashes.get(id)!;

      if (!oldNodes.has(id)) {
        // 检查是否是移动的节点（相同哈希值）
        let isMoved = false;
        for (const [oldId, oldHash] of oldHashes) {
          if (oldHash === newHash && !newNodes.has(oldId)) {
            moved.push({
              type: 'moved',
              nodeId: id,
              oldNode: oldNodes.get(oldId) as LatexNode,
              newNode: node as LatexNode,
              hash: newHash,
            });
            isMoved = true;
            break;
          }
        }

        if (!isMoved) {
          added.push({
            type: 'added',
            nodeId: id,
            newNode: node as LatexNode,
            hash: newHash,
          });
        }
      } else {
        const oldHash = oldHashes.get(id)!;
        if (oldHash !== newHash) {
          modified.push({
            type: 'modified',
            nodeId: id,
            oldNode: oldNodes.get(id) as LatexNode,
            newNode: node as LatexNode,
            hash: newHash,
          });
        } else {
          unchanged.push({
            type: 'unchanged',
            nodeId: id,
            newNode: node as LatexNode,
            hash: newHash,
          });
        }
      }
    }

    // 检测删除的节点
    for (const [id, node] of oldNodes) {
      if (!newNodes.has(id)) {
        // 检查是否已经被标记为移动
        const oldHash = oldHashes.get(id)!;
        const wasMoved = moved.some((m) => m.hash === oldHash);

        if (!wasMoved) {
          removed.push({
            type: 'removed',
            nodeId: id,
            oldNode: node as LatexNode,
            hash: oldHash,
          });
        }
      }
    }

    const computeTime = performance.now() - startTime;
    const totalNodes = newNodes.size;
    const changedNodes = added.length + removed.length + modified.length + moved.length;

    return {
      added,
      removed,
      modified,
      unchanged,
      moved,
      stats: {
        totalNodes,
        changedNodes,
        changeRatio: totalNodes > 0 ? changedNodes / totalNodes : 0,
        computeTime,
      },
    };
  }

  /**
   * 获取或计算节点哈希值
   */
  private getOrComputeHash(id: string, node: AnyLatexNode): string {
    const cached = this.hashCache.get(id);
    if (cached) {
      return cached;
    }

    const hash = computeNodeHash(node);
    this.hashCache.set(id, hash);
    return hash;
  }

  /**
   * 使指定节点的缓存失效
   */
  invalidate(nodeIds: readonly string[]): void {
    for (const id of nodeIds) {
      this.hashCache.delete(id);
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.hashCache.clear();
  }
}

// ================================
// 增量渲染器
// ================================

/**
 * 块级增量渲染器
 *
 * 实现高效的 DOM 差异更新：
 * 1. 使用 AST Diff 计算变化的节点
 * 2. 只更新变化节点对应的 DOM
 * 3. 批量合并 DOM 操作，减少重排
 * 4. 支持渲染优先级队列
 */
export class IncrementalRenderer {
  private readonly config: Required<IncrementalRendererConfig>;
  private readonly differ: ASTDiffer;
  private readonly renderCache: Map<string, RenderCacheEntry>;
  private container: HTMLElement | null;
  private currentAST: RootNode | null;
  private pendingUpdates: DOMUpdate[];
  private batchTimer: ReturnType<typeof setTimeout> | null;
  private isDestroyed: boolean;

  constructor(config: IncrementalRendererConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<IncrementalRendererConfig>;

    this.differ = new ASTDiffer();
    this.renderCache = new Map();
    this.container = null;
    this.currentAST = null;
    this.pendingUpdates = [];
    this.batchTimer = null;
    this.isDestroyed = false;

    this.initContainer();
  }

  // ================================
  // 初始化
  // ================================

  /**
   * 初始化容器元素
   */
  private initContainer(): void {
    if (typeof this.config.container === 'string') {
      this.container = document.querySelector(this.config.container);
    } else {
      this.container = this.config.container;
    }

    if (!this.container) {
      console.warn('[IncrementalRenderer] 容器元素未找到');
    }
  }

  // ================================
  // 渲染方法
  // ================================

  /**
   * 渲染 AST
   *
   * @param ast 新的 AST
   * @param renderFn 节点渲染函数
   * @returns DOM 更新操作列表
   */
  render(
    ast: RootNode,
    renderFn?: (node: LatexNode) => string
  ): {
    diff: ASTDiffResult;
    updates: readonly DOMUpdate[];
    html: string;
  } {
    if (this.isDestroyed) {
      throw new Error('渲染器已销毁');
    }

    // 计算差异
    const diff = this.differ.diff(this.currentAST, ast);
    this.config.onDiffComplete(diff);

    // 生成更新操作
    const updates = this.generateUpdates(diff, renderFn);

    // 生成完整 HTML（用于首次渲染或全量渲染）
    const html = this.generateFullHTML(ast, renderFn);

    // 更新当前 AST
    this.currentAST = ast;

    // 应用更新
    if (this.config.enableBatching) {
      this.batchUpdates(updates);
    } else {
      this.applyUpdates(updates);
    }

    return { diff, updates, html };
  }

  /**
   * 增量渲染（只处理变化的部分）
   */
  renderIncremental(
    ast: RootNode,
    renderFn?: (node: LatexNode) => string
  ): ASTDiffResult {
    if (this.isDestroyed) {
      throw new Error('渲染器已销毁');
    }

    // 计算差异
    const diff = this.differ.diff(this.currentAST, ast);
    this.config.onDiffComplete(diff);

    // 如果变化太多，进行全量渲染
    if (diff.stats.changeRatio > 0.5) {
      this.fullRender(ast, renderFn);
    } else {
      // 生成并应用增量更新
      const updates = this.generateUpdates(diff, renderFn);

      if (this.config.enableBatching) {
        this.batchUpdates(updates);
      } else {
        this.applyUpdates(updates);
      }
    }

    // 更新当前 AST
    this.currentAST = ast;

    return diff;
  }

  /**
   * 全量渲染
   */
  fullRender(
    ast: RootNode,
    renderFn?: (node: LatexNode) => string
  ): void {
    if (!this.container) return;

    const html = this.generateFullHTML(ast, renderFn);
    this.container.innerHTML = html;
    this.currentAST = ast;
  }

  // ================================
  // 更新生成
  // ================================

  /**
   * 生成 DOM 更新操作
   */
  private generateUpdates(
    diff: ASTDiffResult,
    renderFn?: (node: LatexNode) => string
  ): DOMUpdate[] {
    const updates: DOMUpdate[] = [];

    // 处理删除的节点
    for (const nodeDiff of diff.removed) {
      updates.push({
        type: 'remove',
        targetId: nodeDiff.nodeId,
      });
    }

    // 处理修改的节点
    for (const nodeDiff of diff.modified) {
      if (nodeDiff.newNode) {
        const html = this.renderNode(nodeDiff.newNode, renderFn);
        updates.push({
          type: 'replace',
          targetId: nodeDiff.nodeId,
          html,
        });
      }
    }

    // 处理新增的节点
    for (const nodeDiff of diff.added) {
      if (nodeDiff.newNode) {
        const html = this.renderNode(nodeDiff.newNode, renderFn);
        updates.push({
          type: 'insert',
          targetId: nodeDiff.nodeId,
          html,
          position: 'last',
        });
      }
    }

    // 处理移动的节点
    for (const nodeDiff of diff.moved) {
      updates.push({
        type: 'move',
        targetId: nodeDiff.nodeId,
        referenceId: nodeDiff.parentId,
        position: 'last',
      });
    }

    return updates;
  }

  /**
   * 渲染单个节点
   */
  private renderNode(
    node: LatexNode,
    renderFn?: (node: LatexNode) => string
  ): string {
    const hash = computeNodeHash(node);

    // 检查缓存
    const cached = this.renderCache.get(hash);
    if (cached) {
      cached.lastAccessedAt = Date.now();
      return cached.html;
    }

    // 渲染节点
    let html: string;
    if (renderFn) {
      html = renderFn(node);
    } else {
      // 默认渲染
      const block: RenderBlock = {
        id: node.id,
        type: getBlockType(node.type),
        html: this.defaultRenderNode(node),
        start: node.start,
        end: node.end,
        hash,
        priority: computePriority(node.type),
      };
      html = this.config.onRenderBlock(block);
    }

    // 添加块标记
    html = this.wrapWithBlockId(node.id, node.type, html);

    // 缓存渲染结果
    this.renderCache.set(hash, {
      hash,
      html,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });

    return html;
  }

  /**
   * 默认节点渲染
   */
  private defaultRenderNode(node: LatexNode): string {
    const typed = node as AnyLatexNode;

    switch (typed.type) {
      case 'section': {
        const level = SECTION_HEADING_LEVELS[typed.level];
        return `<h${level} class="latex-${typed.level}">${extractNodesText(typed.title)}</h${level}>`;
      }
      case 'paragraph':
        return `<p class="latex-paragraph">${typed.raw}</p>`;
      case 'math_inline':
        return `<span class="latex-math-inline">${typed.content}</span>`;
      case 'math_block':
        return `<div class="latex-math-block">${typed.content}</div>`;
      case 'text':
        return `<span class="latex-text">${typed.content || typed.raw}</span>`;
      case 'error':
        return `<span class="latex-error">${typed.message || '错误'}</span>`;
      case 'comment':
        return `<div class="latex-block latex-comment">${typed.content || typed.raw}</div>`;
      default:
        return `<div class="latex-block latex-${typed.type}">${typed.raw}</div>`;
    }
  }

  /**
   * 用块 ID 包装 HTML
   */
  private wrapWithBlockId(id: string, type: string, html: string): string {
    return `<div ${this.config.blockIdAttribute}="${id}" data-block-type="${type}">${html}</div>`;
  }

  /**
   * 生成完整 HTML
   */
  private generateFullHTML(
    ast: RootNode,
    renderFn?: (node: LatexNode) => string
  ): string {
    const nodes = collectNodes(ast);
    const blocks: RenderBlock[] = [];

    // 只收集块级节点
    const blockTypes = ['section', 'subsection', 'subsubsection', 'paragraph', 'math-block', 'display-math', 'list', 'table', 'environment'];

    for (const [id, node] of nodes) {
      if (blockTypes.includes(node.type) || node.type === 'text') {
        const hash = computeNodeHash(node);
        blocks.push({
          id,
          type: getBlockType(node.type),
          html: this.renderNode(node as LatexNode, renderFn),
          start: node.start,
          end: node.end,
          hash,
          priority: computePriority(node.type),
        });
      }
    }

    // 按源码位置排序
    blocks.sort((a, b) => a.start - b.start);

    return blocks.map((b) => b.html).join('\n');
  }

  // ================================
  // DOM 更新
  // ================================

  /**
   * 批量更新
   */
  private batchUpdates(updates: readonly DOMUpdate[]): void {
    this.pendingUpdates.push(...updates);

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      const pending = [...this.pendingUpdates];
      this.pendingUpdates = [];
      this.applyUpdates(pending);
      this.batchTimer = null;
    }, this.config.batchDelay);
  }

  /**
   * 应用更新操作
   */
  private applyUpdates(updates: readonly DOMUpdate[]): void {
    if (!this.container || updates.length === 0) return;

    // 使用 DocumentFragment 批量操作
    const fragment = document.createDocumentFragment();

    for (const update of updates) {
      this.applyUpdate(update, fragment);
    }

    this.config.onUpdateComplete(updates);
  }

  /**
   * 应用单个更新操作
   */
  private applyUpdate(update: DOMUpdate, _fragment: DocumentFragment): void {
    if (!this.container) return;

    const selector = `[${this.config.blockIdAttribute}="${update.targetId}"]`;
    const element = this.container.querySelector(selector);

    switch (update.type) {
      case 'remove':
        if (element) {
          if (this.config.enableAnimation) {
            element.classList.add('latex-block-removing');
            setTimeout(() => {
              element.remove();
            }, this.config.animationDuration);
          } else {
            element.remove();
          }
        }
        break;

      case 'replace':
        if (element && update.html) {
          const temp = document.createElement('div');
          temp.innerHTML = update.html;
          const newElement = temp.firstElementChild;
          if (newElement) {
            if (this.config.enableAnimation) {
              newElement.classList.add('latex-block-updating');
              element.replaceWith(newElement);
              setTimeout(() => {
                newElement.classList.remove('latex-block-updating');
              }, this.config.animationDuration);
            } else {
              element.replaceWith(newElement);
            }
          }
        }
        break;

      case 'insert':
        if (update.html) {
          const temp = document.createElement('div');
          temp.innerHTML = update.html;
          const newElement = temp.firstElementChild;
          if (newElement) {
            if (this.config.enableAnimation) {
              newElement.classList.add('latex-block-inserting');
              setTimeout(() => {
                newElement.classList.remove('latex-block-inserting');
              }, this.config.animationDuration);
            }

            if (update.referenceId) {
              const refSelector = `[${this.config.blockIdAttribute}="${update.referenceId}"]`;
              const refElement = this.container!.querySelector(refSelector);
              if (refElement) {
                if (update.position === 'before') {
                  refElement.before(newElement);
                } else {
                  refElement.after(newElement);
                }
              } else {
                this.container!.appendChild(newElement);
              }
            } else {
              if (update.position === 'first') {
                this.container!.prepend(newElement);
              } else {
                this.container!.appendChild(newElement);
              }
            }
          }
        }
        break;

      case 'move':
        if (element && update.referenceId) {
          const refSelector = `[${this.config.blockIdAttribute}="${update.referenceId}"]`;
          const refElement = this.container!.querySelector(refSelector);
          if (refElement) {
            if (update.position === 'before') {
              refElement.before(element);
            } else {
              refElement.after(element);
            }
          }
        }
        break;

      case 'update-content':
        if (element && update.html) {
          element.innerHTML = update.html;
        }
        break;
    }
  }

  // ================================
  // 缓存管理
  // ================================

  /**
   * 清除渲染缓存
   */
  clearCache(): void {
    this.renderCache.clear();
    this.differ.clearCache();
  }

  /**
   * 清除过期缓存
   */
  cleanupCache(maxAge: number = 5 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;

    for (const [hash, entry] of this.renderCache) {
      if (now - entry.lastAccessedAt > maxAge) {
        this.renderCache.delete(hash);
        removed++;
      }
    }

    return removed;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    size: number;
    oldestEntry: number;
    newestEntry: number;
  } {
    let oldest = Infinity;
    let newest = 0;

    for (const entry of this.renderCache.values()) {
      if (entry.createdAt < oldest) oldest = entry.createdAt;
      if (entry.createdAt > newest) newest = entry.createdAt;
    }

    return {
      size: this.renderCache.size,
      oldestEntry: oldest === Infinity ? 0 : oldest,
      newestEntry: newest,
    };
  }

  // ================================
  // 生命周期
  // ================================

  /**
   * 重置渲染器
   */
  reset(): void {
    this.currentAST = null;
    this.pendingUpdates = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.clearCache();
  }

  /**
   * 销毁渲染器
   */
  destroy(): void {
    this.reset();
    this.container = null;
    this.isDestroyed = true;
  }

  /**
   * 获取当前 AST
   */
  getCurrentAST(): RootNode | null {
    return this.currentAST;
  }

  /**
   * 设置容器
   */
  setContainer(container: string | HTMLElement): void {
    if (typeof container === 'string') {
      this.container = document.querySelector(container);
    } else {
      this.container = container;
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建增量渲染器
 */
export function createIncrementalRenderer(
  config: IncrementalRendererConfig
): IncrementalRenderer {
  return new IncrementalRenderer(config);
}

/**
 * 创建 AST 差异计算器
 */
export function createASTDiffer(): ASTDiffer {
  return new ASTDiffer();
}

// ================================
// 导出
// ================================

export default IncrementalRenderer;
