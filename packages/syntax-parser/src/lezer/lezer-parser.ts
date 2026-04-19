// ================================
// Lezer 增量解析器
//
// 基于 CodeMirror 6 的 Lezer 解析系统实现真正的增量解析
// 特点：
// - O(log n) 的增量解析复杂度
// - 自动错误恢复
// - 与 CodeMirror 深度集成
// - 支持多种语言（通过语法扩展）
// ================================

import { Tree, TreeFragment } from '@lezer/common';
import type { LRParser } from '@lezer/lr';
import type {
  ASTNode,
  ASTRoot,
  ParseResult,
  IncrementalParseResult,
  ParseError,
  ParseWarning,
  ParserConfig,
  TextChangeSet,
  Position,
} from '../types';

// ================================
// 类型定义
// ================================

/** Lezer 解析器配置 */
export interface LezerParserConfig extends ParserConfig {
  /** Lezer LR 解析器实例 */
  parser: LRParser;
  /** 语言名称 */
  language: string;
  /** 是否启用 TreeFragment 缓存 */
  enableFragmentCache?: boolean;
  /** 最大缓存 fragment 数量 */
  maxCachedFragments?: number;
  /** 解析超时时间（毫秒） */
  parseTimeout?: number;
}

/** 节点映射信息 */
interface NodeMapping {
  /** 节点 ID */
  id: string;
  /** Lezer 节点类型 */
  type: number;
  /** 节点名称 */
  name: string;
  /** 起始位置 */
  from: number;
  /** 结束位置 */
  to: number;
  /** 父节点 ID */
  parent?: string;
  /** 子节点 ID 列表 */
  children: string[];
  /** 节点哈希 */
  hash: string;
}

/** 解析状态 */
interface ParseState {
  /** 当前文档内容 */
  content: string;
  /** Lezer Tree */
  tree: Tree | null;
  /** 缓存的 TreeFragment */
  fragments: readonly TreeFragment[];
  /** AST 版本号 */
  version: number;
  /** 节点映射表 */
  nodeMap: Map<string, NodeMapping>;
}

// ================================
// 工具函数
// ================================

/**
 * 计算字符串哈希值（FNV-1a）
 */
function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash ^= char;
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

/**
 * 根据偏移量计算行列位置
 */
function offsetToPosition(content: string, offset: number): Position {
  let line = 0;
  let column = 0;
  let currentOffset = 0;

  for (let i = 0; i < content.length && i < offset; i++) {
    if (content[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
    currentOffset++;
  }

  return { line, column, offset: currentOffset };
}

// ================================
// LezerIncrementalParser 类
// ================================

/**
 * Lezer 增量解析器
 *
 * 核心特性：
 * 1. 真正的增量解析：只重新解析变更的部分
 * 2. TreeFragment 缓存：重用未变更的语法树片段
 * 3. AST 映射：将 Lezer Tree 转换为统一的 AST 格式
 * 4. 错误恢复：自动处理语法错误，尽可能生成有效的 AST
 */
export class LezerIncrementalParser {
  /** Lezer LR 解析器 */
  private readonly parser: LRParser;

  /** 语言名称 */
  readonly language: string;

  /** 解析状态 */
  private state: ParseState;

  /** 配置 */
  private readonly config: Required<LezerParserConfig>;

  /** 节点 ID 计数器（实例级，支持并发安全） */
  private nodeIdCounter = 0;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Omit<Required<LezerParserConfig>, 'parser' | 'language'> =
    {
      strict: false,
      maxDepth: 100,
      timeout: 5000,
      preserveComments: true,
      preserveWhitespace: false,
      enableFragmentCache: true,
      maxCachedFragments: 100,
      parseTimeout: 5000,
    };

  constructor(config: LezerParserConfig) {
    this.parser = config.parser;
    this.language = config.language;
    this.config = {
      ...LezerIncrementalParser.DEFAULT_CONFIG,
      ...config,
    };

    this.state = {
      content: '',
      tree: null,
      fragments: [],
      version: 0,
      nodeMap: new Map(),
    };
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 生成唯一节点 ID（实例级，避免并发 ID 冲突）
   */
  private generateNodeId(): string {
    return `lezer_node_${++this.nodeIdCounter}`;
  }

  /**
   * 重置节点 ID 计数器（仅用于测试）
   */
  resetNodeIdCounter(): void {
    this.nodeIdCounter = 0;
  }

  /**
   * 解析完整文档
   */
  parse(content: string, _config?: ParserConfig): ParseResult<ASTNode> {
    const startTime = performance.now();
    const errors: ParseError[] = [];
    const warnings: ParseWarning[] = [];

    try {
      // 使用 Lezer 解析
      const tree = this.parser.parse(content);

      // 更新状态
      this.state = {
        content,
        tree,
        fragments: this.config.enableFragmentCache ? TreeFragment.addTree(tree, []) : [],
        version: this.state.version + 1,
        nodeMap: new Map(),
      };

      // 转换为统一 AST 格式
      const ast = this.treeToAST(tree, content);

      // 收集语法错误
      this.collectErrors(tree, content, errors);

      return {
        ast,
        success: errors.length === 0,
        errors,
        warnings,
        parseTime: performance.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({
        message: `解析失败: ${message}`,
        position: { line: 0, column: 0, offset: 0 },
      });

      // 返回空 AST
      const emptyAST = this.createEmptyAST();

      return {
        ast: emptyAST,
        success: false,
        errors,
        warnings,
        parseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * 增量解析
   */
  parseIncremental(
    content: string,
    changes: TextChangeSet,
    _previousAST: ASTRoot<ASTNode>,
    _config?: ParserConfig
  ): IncrementalParseResult<ASTNode> {
    const startTime = performance.now();
    const errors: ParseError[] = [];
    const warnings: ParseWarning[] = [];

    // 如果没有缓存的 Tree 或变更太大，执行完整解析
    if (!this.state.tree || this.shouldFullReparse(changes, content)) {
      const result = this.parse(content);
      return {
        ...result,
        affectedNodeIds: this.getAllNodeIds(),
        dirtyNodeIds: this.getAllNodeIds(),
        fullReparse: true,
        reusedNodeCount: 0,
        newNodeCount: this.state.nodeMap.size,
      };
    }

    try {
      // 计算变更范围
      const changedRanges = this.calculateChangedRanges(changes);

      // 更新 TreeFragment 缓存
      const updatedFragments = this.updateFragments(this.state.fragments, changedRanges, content);

      // 使用增量解析
      const tree = this.parser.parse(content, updatedFragments);

      // 计算受影响的节点
      const affectedNodeIds = this.findAffectedNodes(this.state.tree, tree, changedRanges);

      // 保存旧节点数量
      const oldNodeCount = this.state.nodeMap.size;

      // 更新状态
      this.state = {
        content,
        tree,
        fragments: this.config.enableFragmentCache
          ? TreeFragment.addTree(tree, updatedFragments)
          : [],
        version: this.state.version + 1,
        nodeMap: new Map(),
      };

      // 转换为统一 AST 格式
      const ast = this.treeToAST(tree, content);

      // 收集语法错误
      this.collectErrors(tree, content, errors);

      // 计算重用的节点数量
      const newNodeCount = this.state.nodeMap.size;
      const reusedNodeCount = Math.max(0, oldNodeCount - affectedNodeIds.length);

      return {
        ast,
        success: errors.length === 0,
        errors,
        warnings,
        parseTime: performance.now() - startTime,
        affectedNodeIds,
        dirtyNodeIds: affectedNodeIds,
        fullReparse: false,
        reusedNodeCount,
        newNodeCount,
      };
    } catch (error) {
      // 增量解析失败，回退到完整解析
      const result = this.parse(content);
      return {
        ...result,
        affectedNodeIds: this.getAllNodeIds(),
        dirtyNodeIds: this.getAllNodeIds(),
        fullReparse: true,
        reusedNodeCount: 0,
        newNodeCount: this.state.nodeMap.size,
      };
    }
  }

  /**
   * 获取当前 Tree
   */
  getTree(): Tree | null {
    return this.state.tree;
  }

  /**
   * 获取当前内容
   */
  getContent(): string {
    return this.state.content;
  }

  /**
   * 获取当前版本号
   */
  getVersion(): number {
    return this.state.version;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.state = {
      content: '',
      tree: null,
      fragments: [],
      version: 0,
      nodeMap: new Map(),
    };
    this.resetNodeIdCounter();
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 判断是否需要完整重新解析
   */
  private shouldFullReparse(changes: TextChangeSet, newContent: string): boolean {
    // 如果没有变更信息，需要完整解析
    if (changes.changes.length === 0) {
      return true;
    }

    // 如果变更超过文档 30%，完整解析更高效
    const totalChangeSize = changes.changes.reduce(
      (sum, c) => sum + Math.abs(c.insert.length - (c.to - c.from)),
      0
    );
    if (totalChangeSize > newContent.length * 0.3) {
      return true;
    }

    return false;
  }

  /**
   * 计算变更范围
   */
  private calculateChangedRanges(
    changes: TextChangeSet
  ): { fromA: number; toA: number; fromB: number; toB: number }[] {
    const ranges: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
    let offset = 0;

    for (const change of changes.changes) {
      const deleteLength = change.to - change.from;
      const insertLength = change.insert.length;

      ranges.push({
        fromA: change.from,
        toA: change.to,
        fromB: change.from + offset,
        toB: change.from + offset + insertLength,
      });

      offset += insertLength - deleteLength;
    }

    return ranges;
  }

  /**
   * 更新 TreeFragment 缓存
   */
  private updateFragments(
    fragments: readonly TreeFragment[],
    changedRanges: { fromA: number; toA: number; fromB: number; toB: number }[],
    _newContent: string
  ): readonly TreeFragment[] {
    if (changedRanges.length === 0) {
      return fragments;
    }

    // 使用 Lezer 的 applyChanges 更新 fragments
    return TreeFragment.applyChanges(fragments, changedRanges);
  }

  /**
   * 查找受影响的节点
   */
  private findAffectedNodes(
    _oldTree: Tree,
    _newTree: Tree,
    changedRanges: { fromA: number; toA: number; fromB: number; toB: number }[]
  ): string[] {
    const affectedIds: string[] = [];

    // 遍历节点映射表，找出与变更范围重叠的节点
    for (const [id, mapping] of this.state.nodeMap) {
      for (const range of changedRanges) {
        if (mapping.from < range.toA && mapping.to > range.fromA) {
          affectedIds.push(id);
          break;
        }
      }
    }

    return affectedIds;
  }

  /**
   * 将 Lezer Tree 转换为统一 AST 格式
   */
  private treeToAST(tree: Tree, content: string): ASTRoot<ASTNode> {
    const nodes = new Map<string, ASTNode>();
    const rootId = this.generateNodeId();

    // 遍历树并创建节点
    const cursor = tree.cursor();
    const stack: { id: string; children: string[] }[] = [];

    // 创建根节点
    const rootNode: ASTNode = {
      type: 'root',
      id: rootId,
      from: 0,
      to: content.length,
      children: [],
      hash: hashString(content),
    };
    nodes.set(rootId, rootNode);
    stack.push({ id: rootId, children: [] });

    // 深度优先遍历
    do {
      const nodeId = this.generateNodeId();
      const nodeContent = content.slice(cursor.from, cursor.to);
      const nodeHash = hashString(nodeContent);

      const node: ASTNode = {
        type: cursor.name,
        id: nodeId,
        from: cursor.from,
        to: cursor.to,
        parent: stack[stack.length - 1]?.id,
        children: [],
        hash: nodeHash,
      };

      nodes.set(nodeId, node);

      // 记录节点映射
      this.state.nodeMap.set(nodeId, {
        id: nodeId,
        type: cursor.type.id,
        name: cursor.name,
        from: cursor.from,
        to: cursor.to,
        parent: stack[stack.length - 1]?.id,
        children: [],
        hash: nodeHash,
      });

      // 添加到父节点的子节点列表
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(nodeId);
      }

      // 如果有子节点，入栈
      if (cursor.firstChild()) {
        stack.push({ id: nodeId, children: [] });
      } else {
        // 没有子节点，尝试移动到兄弟节点
        while (!cursor.nextSibling()) {
          // 出栈并更新父节点的 children
          const completed = stack.pop();
          if (completed) {
            const completedNode = nodes.get(completed.id);
            if (completedNode) {
              (completedNode as unknown as { children: string[] }).children = completed.children;
            }
            const mapping = this.state.nodeMap.get(completed.id);
            if (mapping) {
              mapping.children = completed.children;
            }
          }

          if (!cursor.parent()) {
            break;
          }
        }
      }
    } while (cursor.node.parent);

    // 更新根节点的 children
    const rootStack = stack[0];
    if (rootStack) {
      (rootNode as unknown as { children: string[] }).children = rootStack.children;
    }

    return {
      root: rootNode,
      nodes,
      version: this.state.version,
      length: content.length,
    };
  }

  /**
   * 收集语法错误
   */
  private collectErrors(tree: Tree, content: string, errors: ParseError[]): void {
    const cursor = tree.cursor();

    do {
      // 检查错误节点
      if (cursor.type.isError) {
        const position = offsetToPosition(content, cursor.from);
        errors.push({
          message: '语法错误',
          position,
          range: {
            start: position,
            end: offsetToPosition(content, cursor.to),
          },
        });
      }
    } while (cursor.next());
  }

  /**
   * 创建空 AST
   */
  private createEmptyAST(): ASTRoot<ASTNode> {
    const rootId = this.generateNodeId();
    const rootNode: ASTNode = {
      type: 'root',
      id: rootId,
      from: 0,
      to: 0,
      children: [],
      hash: hashString(''),
    };

    return {
      root: rootNode,
      nodes: new Map([[rootId, rootNode]]),
      version: 0,
      length: 0,
    };
  }

  /**
   * 获取所有节点 ID
   */
  private getAllNodeIds(): string[] {
    return Array.from(this.state.nodeMap.keys());
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Lezer 增量解析器
 */
export function createLezerParser(config: LezerParserConfig): LezerIncrementalParser {
  return new LezerIncrementalParser(config);
}

// ================================
// 辅助类型导出
// ================================

export type { NodeMapping, ParseState };
