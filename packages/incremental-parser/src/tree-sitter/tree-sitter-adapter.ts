// ================================
// Tree-sitter 适配器
//
// 为 Tree-sitter 提供与 Lezer 相同的接口
// 使项目可以在两种解析器之间切换
//
// Tree-sitter vs Lezer 对比：
// - Tree-sitter: C/WASM 实现，性能更好，适合 Native/Electron
// - Lezer: 纯 JS 实现，包体积小，适合纯 Web 场景
//
// 为什么当前项目默认使用 Lezer：
// 1. 纯 Web 场景，无需 WASM 加载
// 2. 与 CodeMirror 6 深度集成
// 3. 包体积更小（< 50KB vs WASM 200KB+）
// 4. 对于中等规模文档，性能差距不明显
// ================================

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

import type {
  TreeSitterAdapterConfig,
  TreeSitterParseState,
  TreeSitterTree,
  TreeSitterParser,
  TreeSitterNode,
  TreeSitterInputEdit,
  TreeSitterPoint,
  TreeSitterLanguage,
  ITreeSitterParser,
  TreeSitterInitState,
} from './types';

// ================================
// 常量
// ================================

/** 节点 ID 计数器 */
let nodeIdCounter = 0;

/** 重置节点 ID 计数器 */
export function resetTreeSitterNodeIdCounter(): void {
  nodeIdCounter = 0;
}

// ================================
// 工具函数
// ================================

/**
 * 生成唯一节点 ID
 */
function generateNodeId(): string {
  return `ts_node_${++nodeIdCounter}`;
}

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
 * 将 Tree-sitter 点转换为位置
 */
function pointToPosition(point: TreeSitterPoint, offset: number): Position {
  return {
    line: point.row,
    column: point.column,
    offset,
  };
}

/**
 * 根据偏移量计算行列位置
 */
function offsetToPoint(content: string, offset: number): TreeSitterPoint {
  let row = 0;
  let column = 0;

  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      row++;
      column = 0;
    } else {
      column++;
    }
  }

  return { row, column };
}

/**
 * 将文本变更转换为 Tree-sitter 输入编辑
 */
function changesToInputEdits(
  changes: TextChangeSet,
  oldContent: string,
  newContent: string
): TreeSitterInputEdit[] {
  const edits: TreeSitterInputEdit[] = [];

  for (const change of changes.changes) {
    const startIndex = change.from;
    const oldEndIndex = change.to;
    const newEndIndex = change.from + change.insert.length;

    const startPosition = offsetToPoint(oldContent, startIndex);
    const oldEndPosition = offsetToPoint(oldContent, oldEndIndex);
    const newEndPosition = offsetToPoint(newContent, newEndIndex);

    edits.push({
      startIndex,
      oldEndIndex,
      newEndIndex,
      startPosition,
      oldEndPosition,
      newEndPosition,
    });
  }

  return edits;
}

// ================================
// TreeSitterAdapter 类
// ================================

/**
 * Tree-sitter 增量解析器适配器
 *
 * 提供与 LezerIncrementalParser 相同的接口，
 * 使项目可以在两种解析器之间无缝切换
 */
export class TreeSitterAdapter implements ITreeSitterParser {
  /** 配置 */
  private readonly config: Required<TreeSitterAdapterConfig>;

  /** 初始化状态 */
  private initState: TreeSitterInitState = 'uninitialized';

  /** 初始化错误 */
  private initError: Error | null = null;

  /** Tree-sitter 解析器实例 */
  private parser: TreeSitterParser | null = null;

  /** Tree-sitter 语言实例（保留供 WASM 初始化后使用） */
  private _languageInstance: TreeSitterLanguage | null = null;

  /** 获取语言实例 */
  get languageInstance(): TreeSitterLanguage | null {
    return this._languageInstance;
  }

  /** 解析状态 */
  private state: TreeSitterParseState;

  /** 缓存的语法树列表 */
  private cachedTrees: TreeSitterTree[] = [];

  /** 语言名称 */
  readonly language: string;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Omit<Required<TreeSitterAdapterConfig>, 'language'> = {
    strict: false,
    maxDepth: 100,
    timeout: 5000,
    preserveComments: true,
    preserveWhitespace: false,
    parseTimeoutMs: 5000,
    enableIncremental: true,
    maxCachedTrees: 3,
    initWasm: async () => {
      // 默认空实现，需要用户提供
      throw new Error('Tree-sitter WASM 初始化函数未提供');
    },
  };

  constructor(config: TreeSitterAdapterConfig) {
    this.config = {
      ...TreeSitterAdapter.DEFAULT_CONFIG,
      ...config,
    };
    this.language = config.language.name;

    this.state = {
      content: '',
      tree: null,
      version: 0,
      nodeMap: new Map(),
    };
  }

  // ================================
  // 公共属性
  // ================================

  /** 是否已初始化 */
  get isInitialized(): boolean {
    return this.initState === 'initialized';
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 初始化解析器（加载 WASM）
   */
  async initialize(): Promise<void> {
    if (this.initState === 'initialized') {
      return;
    }

    if (this.initState === 'initializing') {
      // 等待初始化完成
      while (this.initState === 'initializing') {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (this.initState === 'error') {
        throw this.initError;
      }
      return;
    }

    this.initState = 'initializing';

    try {
      // 调用 WASM 初始化函数
      if (this.config.initWasm) {
        await this.config.initWasm();
      }

      // 注意：实际的 Parser 和 Language 创建需要 web-tree-sitter 库
      // 这里只是接口定义，实际使用时需要：
      // 1. import Parser from 'web-tree-sitter';
      // 2. await Parser.init();
      // 3. this.parser = new Parser();
      // 4. const lang = await Parser.Language.load(this.config.language.wasmPath);
      // 5. this.parser.setLanguage(lang);

      this.initState = 'initialized';
    } catch (error) {
      this.initState = 'error';
      this.initError = error instanceof Error ? error : new Error(String(error));
      throw this.initError;
    }
  }

  /**
   * 解析完整文档
   */
  parse(content: string, _config?: ParserConfig): ParseResult<ASTNode> {
    const startTime = performance.now();
    const errors: ParseError[] = [];
    const warnings: ParseWarning[] = [];

    // 检查初始化状态
    if (!this.isInitialized) {
      errors.push({
        message: 'Tree-sitter 解析器未初始化，请先调用 initialize()',
        position: { line: 0, column: 0, offset: 0 },
        code: 'not_initialized',
      });
      return {
        ast: this.createEmptyAST(),
        success: false,
        errors,
        warnings,
        parseTime: performance.now() - startTime,
      };
    }

    try {
      // 使用 Tree-sitter 解析
      const tree = this.parseWithTreeSitter(content);

      if (!tree) {
        throw new Error('解析返回空树');
      }

      // 清理旧的缓存树
      this.cleanupCachedTrees();

      // 缓存新树
      this.cachedTrees.push(tree);

      // 更新状态
      this.state = {
        content,
        tree,
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
        code: 'parse_error',
      });

      return {
        ast: this.createEmptyAST(),
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

    // 如果没有缓存的树或变更太大，执行完整解析
    if (
      !this.state.tree ||
      !this.config.enableIncremental ||
      this.shouldFullReparse(changes, content)
    ) {
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
      // 获取旧树的副本
      const oldTree = this.state.tree.copy();

      // 将变更应用到旧树
      const inputEdits = changesToInputEdits(changes, this.state.content, content);
      for (const edit of inputEdits) {
        oldTree.edit(edit);
      }

      // 增量解析
      const newTree = this.parseWithTreeSitter(content, oldTree);

      if (!newTree) {
        throw new Error('增量解析返回空树');
      }

      // 获取变更范围
      const changedRanges = oldTree.getChangedRanges(newTree);

      // 清理旧树
      oldTree.delete();

      // 计算受影响的节点
      const affectedNodeIds = this.findAffectedNodes(changedRanges);

      // 保存旧节点数量
      const oldNodeCount = this.state.nodeMap.size;

      // 清理旧的缓存树
      this.cleanupCachedTrees();

      // 缓存新树
      this.cachedTrees.push(newTree);

      // 更新状态
      this.state = {
        content,
        tree: newTree,
        version: this.state.version + 1,
        nodeMap: new Map(),
      };

      // 转换为统一 AST 格式
      const ast = this.treeToAST(newTree, content);

      // 收集语法错误
      this.collectErrors(newTree, content, errors);

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
   * 获取当前语法树
   */
  getTree(): TreeSitterTree | null {
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
    // 删除所有缓存的树
    for (const tree of this.cachedTrees) {
      tree.delete();
    }
    this.cachedTrees = [];

    this.state = {
      content: '',
      tree: null,
      version: 0,
      nodeMap: new Map(),
    };

    resetTreeSitterNodeIdCounter();
  }

  /**
   * 销毁解析器
   */
  dispose(): void {
    this.clearCache();

    if (this.parser) {
      this.parser.delete();
      this.parser = null;
    }

    this._languageInstance = null;
    this.initState = 'uninitialized';
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 使用 Tree-sitter 解析
   */
  private parseWithTreeSitter(content: string, oldTree?: TreeSitterTree): TreeSitterTree | null {
    if (!this.parser) {
      return null;
    }

    return this.parser.parse(content, oldTree ?? null);
  }

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
   * 查找受影响的节点
   */
  private findAffectedNodes(
    changedRanges: Array<{ startIndex: number; endIndex: number }>
  ): string[] {
    const affectedIds: string[] = [];

    for (const [id, mapping] of this.state.nodeMap) {
      for (const range of changedRanges) {
        if (mapping.startIndex < range.endIndex && mapping.endIndex > range.startIndex) {
          affectedIds.push(id);
          break;
        }
      }
    }

    return affectedIds;
  }

  /**
   * 将 Tree-sitter 树转换为统一 AST 格式
   */
  private treeToAST(tree: TreeSitterTree, content: string): ASTRoot<ASTNode> {
    const nodes = new Map<string, ASTNode>();
    const rootId = generateNodeId();

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

    // 遍历 Tree-sitter 树
    const tsRootNode = tree.rootNode;
    const childIds = this.convertNode(tsRootNode, content, rootId, nodes);

    // 更新根节点的子节点
    (rootNode as unknown as { children: string[] }).children = childIds;

    return {
      root: rootNode,
      nodes,
      version: this.state.version,
      length: content.length,
    };
  }

  /**
   * 转换单个节点及其子节点
   */
  private convertNode(
    tsNode: TreeSitterNode,
    content: string,
    parentId: string,
    nodes: Map<string, ASTNode>
  ): string[] {
    const childIds: string[] = [];

    for (const child of tsNode.children) {
      const nodeId = generateNodeId();
      const nodeContent = content.slice(child.startIndex, child.endIndex);
      const nodeHash = hashString(nodeContent);

      // 递归转换子节点
      const grandChildIds = this.convertNode(child, content, nodeId, nodes);

      const node: ASTNode = {
        type: child.type,
        id: nodeId,
        from: child.startIndex,
        to: child.endIndex,
        parent: parentId,
        children: grandChildIds,
        hash: nodeHash,
      };

      nodes.set(nodeId, node);
      childIds.push(nodeId);

      // 记录节点映射
      this.state.nodeMap.set(nodeId, {
        id: nodeId,
        originalId: child.id,
        type: child.type,
        startIndex: child.startIndex,
        endIndex: child.endIndex,
        parent: parentId,
        children: grandChildIds,
        hash: nodeHash,
      });
    }

    return childIds;
  }

  /**
   * 收集语法错误
   */
  private collectErrors(tree: TreeSitterTree, _content: string, errors: ParseError[]): void {
    // 遍历树查找错误节点
    const collectFromNode = (node: TreeSitterNode): void => {
      if (node.hasError) {
        if (node.isMissing) {
          errors.push({
            message: `缺失: ${node.type}`,
            position: pointToPosition(node.startPosition, node.startIndex),
            range: {
              start: pointToPosition(node.startPosition, node.startIndex),
              end: pointToPosition(node.endPosition, node.endIndex),
            },
            code: 'missing_node',
          });
        } else if (node.type === 'ERROR') {
          errors.push({
            message: '语法错误',
            position: pointToPosition(node.startPosition, node.startIndex),
            range: {
              start: pointToPosition(node.startPosition, node.startIndex),
              end: pointToPosition(node.endPosition, node.endIndex),
            },
            code: 'syntax_error',
          });
        }
      }

      // 递归检查子节点
      for (const child of node.children) {
        collectFromNode(child);
      }
    };

    collectFromNode(tree.rootNode);
  }

  /**
   * 创建空 AST
   */
  private createEmptyAST(): ASTRoot<ASTNode> {
    const rootId = generateNodeId();
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

  /**
   * 清理缓存的语法树
   */
  private cleanupCachedTrees(): void {
    while (this.cachedTrees.length >= this.config.maxCachedTrees) {
      const oldTree = this.cachedTrees.shift();
      if (oldTree && oldTree !== this.state.tree) {
        oldTree.delete();
      }
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Tree-sitter 适配器
 */
export function createTreeSitterAdapter(config: TreeSitterAdapterConfig): TreeSitterAdapter {
  return new TreeSitterAdapter(config);
}

// ================================
// 导出说明
// ================================

/**
 * 为什么项目默认使用 Lezer 而不是 Tree-sitter？
 *
 * 1. **纯 Web 场景**
 *    - 当前项目是 Web 应用
 *    - Lezer 是纯 JavaScript，无需 WASM
 *    - Tree-sitter 需要加载 WASM 模块（约 200KB+）
 *
 * 2. **与 CodeMirror 6 的集成**
 *    - Lezer 是 CodeMirror 6 的官方解析系统
 *    - 两者深度集成，共享类型和接口
 *    - Tree-sitter 需要额外的适配层
 *
 * 3. **包体积**
 *    - Lezer 核心约 20-30KB
 *    - 语言语法包通常 10-50KB
 *    - Tree-sitter WASM 运行时 200KB+
 *    - 每个语言的 WASM 约 100-500KB
 *
 * 4. **性能对比**
 *    - Tree-sitter 确实更快（C 实现）
 *    - 但对于中等规模文档（< 1MB），差距不明显
 *    - Lezer 的增量解析已经足够高效
 *
 * 5. **何时应该使用 Tree-sitter**
 *    - Electron 应用（可直接使用 C 绑定）
 *    - 需要解析超大文件（> 1MB）
 *    - 需要与 GitHub/Neovim 等工具保持一致
 *    - 对解析性能有极高要求
 *
 * 6. **如何切换到 Tree-sitter**
 *    - 安装 web-tree-sitter
 *    - 下载对应语言的 WASM 文件
 *    - 使用本适配器创建解析器
 *    - 替换现有的 Lezer 解析器调用
 */
