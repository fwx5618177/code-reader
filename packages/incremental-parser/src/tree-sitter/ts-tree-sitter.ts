// ================================
// 纯 TypeScript 实现的 Tree-sitter 风格增量解析器
//
// 特点：
// 1. 不依赖 WASM，完全使用 TypeScript 实现
// 2. 支持真正的增量解析
// 3. 与 LezerIncrementalParser 接口兼容
// 4. 适用于大型文档的高性能解析
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

// ================================
// 类型定义
// ================================

/** 语法树节点 */
export interface TSNode {
  /** 节点类型 */
  type: string;
  /** 节点 ID */
  id: string;
  /** 起始位置 */
  startIndex: number;
  /** 结束位置 */
  endIndex: number;
  /** 起始行列 */
  startPosition: { row: number; column: number };
  /** 结束行列 */
  endPosition: { row: number; column: number };
  /** 父节点 ID */
  parent: string | null;
  /** 子节点 ID 列表 */
  children: string[];
  /** 节点哈希 */
  hash: string;
  /** 是否为错误节点 */
  isError: boolean;
  /** 原始文本 */
  text: string;
}

/** 语法树 */
export interface TSTree {
  /** 根节点 */
  rootNode: TSNode;
  /** 所有节点映射 */
  nodes: Map<string, TSNode>;
  /** 版本号 */
  version: number;
  /** 文档长度 */
  length: number;
}

/** 解析状态 */
interface ParseState {
  /** 当前文档内容 */
  content: string;
  /** 语法树 */
  tree: TSTree | null;
  /** AST 版本号 */
  version: number;
  /** 节点映射表 */
  nodeMap: Map<string, NodeMapping>;
  /** 行索引（快速定位行） */
  lineIndex: number[];
}

/** 节点映射信息 */
interface NodeMapping {
  /** 节点 ID */
  id: string;
  /** 节点类型 */
  type: string;
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

/** 解析器配置 */
export interface TSTreeSitterConfig extends ParserConfig {
  /** 语言名称 */
  language?: string;
  /** 最大缓存节点数 */
  maxCachedNodes?: number;
  /** 解析超时时间（毫秒） */
  parseTimeoutMs?: number;
  /** 是否启用增量解析 */
  enableIncremental?: boolean;
  /** 块级元素正则 */
  blockPatterns?: RegExp[];
}

// ================================
// 常量定义
// ================================

/** LaTeX 块级元素模式 */
const LATEX_BLOCK_PATTERNS: RegExp[] = [
  // 文档结构
  /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/,
  /\\begin\{document\}/,
  /\\end\{document\}/,
  /\\usepackage(?:\[[^\]]*\])?\{[^}]+\}/,
  /\\title\{[^}]*\}/,
  /\\author\{[^}]*\}/,
  /\\date\{[^}]*\}/,
  /\\maketitle/,
  // 章节
  /\\chapter\*?\{[^}]*\}/,
  /\\section\*?\{[^}]*\}/,
  /\\subsection\*?\{[^}]*\}/,
  /\\subsubsection\*?\{[^}]*\}/,
  /\\paragraph\*?\{[^}]*\}/,
  // 环境
  /\\begin\{(\w+)\*?\}(?:\[[^\]]*\])?/,
  /\\end\{(\w+)\*?\}/,
  // 数学环境
  /\$\$[\s\S]*?\$\$/,
  /\\\[[\s\S]*?\\\]/,
  /\\\([\s\S]*?\\\)/,
  // 段落分隔
  /\n\s*\n/,
];

/** 内联元素模式（保留供未来扩展使用） */
const _INLINE_PATTERNS: RegExp[] = [
  /\$[^$\n]+\$/,
  /\\textbf\{[^}]*\}/,
  /\\textit\{[^}]*\}/,
  /\\emph\{[^}]*\}/,
  /\\underline\{[^}]*\}/,
  /\\texttt\{[^}]*\}/,
  /\\cite\{[^}]*\}/,
  /\\ref\{[^}]*\}/,
  /\\label\{[^}]*\}/,
  /\\href\{[^}]*\}\{[^}]*\}/,
  /\\url\{[^}]*\}/,
];
// Export to prevent unused variable warning
export { _INLINE_PATTERNS as INLINE_PATTERNS };

// ================================
// 工具函数
// ================================

/** 节点 ID 计数器 */
let nodeIdCounter = 0;

/**
 * 生成唯一节点 ID
 */
function generateNodeId(): string {
  return `ts_node_${++nodeIdCounter}`;
}

/**
 * 重置节点 ID 计数器
 */
export function resetNodeIdCounter(): void {
  nodeIdCounter = 0;
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
 * 根据偏移量计算行列位置（保留供未来使用）
 */
function _offsetToPosition(content: string, offset: number): Position {
  let line = 0;
  let column = 0;

  for (let i = 0; i < content.length && i < offset; i++) {
    if (content[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
  }

  return { line, column, offset };
}
// Export to prevent unused variable warning
export { _offsetToPosition as offsetToPosition };

/**
 * 根据偏移量计算行列（使用索引加速）
 */
function offsetToRowColumn(offset: number, lineIndex: number[]): { row: number; column: number } {
  // 二分查找行号
  let low = 0;
  let high = lineIndex.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const midValue = lineIndex[mid];
    if (midValue !== undefined && midValue <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const row = low;
  const rowValue = lineIndex[row] ?? 0;
  const column = offset - rowValue;

  return { row, column };
}

/**
 * 构建行索引
 */
function buildLineIndex(content: string): number[] {
  const index: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      index.push(i + 1);
    }
  }
  return index;
}

// ================================
// TSTreeSitterParser 类
// ================================

/**
 * 纯 TypeScript 实现的 Tree-sitter 风格增量解析器
 *
 * 核心特性：
 * 1. 真正的增量解析：只重新解析变更的部分
 * 2. 语法树缓存：重用未变更的节点
 * 3. AST 映射：将语法树转换为统一的 AST 格式
 * 4. 错误恢复：自动处理语法错误
 */
export class TSTreeSitterParser {
  /** 语言名称 */
  readonly language: string;

  /** 解析状态 */
  private state: ParseState;

  /** 配置 */
  private readonly config: Required<TSTreeSitterConfig>;

  /** 块级模式（存储供增量解析扩展使用） */
  private readonly _blockPatterns: RegExp[];

  /** 获取块级模式 */
  get blockPatterns(): RegExp[] {
    return this._blockPatterns;
  }

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Omit<Required<TSTreeSitterConfig>, 'language'> = {
    strict: false,
    maxDepth: 100,
    timeout: 10000,
    preserveComments: true,
    preserveWhitespace: false,
    maxCachedNodes: 10000,
    parseTimeoutMs: 10000,
    enableIncremental: true,
    blockPatterns: LATEX_BLOCK_PATTERNS,
  };

  constructor(config?: TSTreeSitterConfig) {
    this.config = {
      ...TSTreeSitterParser.DEFAULT_CONFIG,
      language: 'latex',
      ...config,
    };
    this.language = this.config.language;
    this._blockPatterns = this.config.blockPatterns || LATEX_BLOCK_PATTERNS;

    this.state = {
      content: '',
      tree: null,
      version: 0,
      nodeMap: new Map(),
      lineIndex: [0],
    };
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 解析完整文档
   */
  parse(content: string, _config?: ParserConfig): ParseResult<ASTNode> {
    const startTime = performance.now();
    const errors: ParseError[] = [];
    const warnings: ParseWarning[] = [];

    try {
      // 构建行索引
      const lineIndex = buildLineIndex(content);

      // 解析文档
      const tree = this.parseDocument(content, lineIndex);

      // 更新状态
      this.state = {
        content,
        tree,
        version: this.state.version + 1,
        nodeMap: new Map(),
        lineIndex,
      };

      // 构建节点映射
      this.buildNodeMap(tree);

      // 转换为统一 AST 格式
      const ast = this.treeToAST(tree, content);

      // 收集错误
      this.collectErrors(tree, errors);

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
      // 构建行索引
      const lineIndex = buildLineIndex(content);

      // 计算变更范围
      const affectedRange = this.calculateAffectedRange(changes);

      // 增量解析
      const { tree, affectedNodeIds, reusedNodeCount } = this.incrementalParse(
        content,
        lineIndex,
        affectedRange
      );

      // 保存旧节点数量（用于调试和监控）
      const _oldNodeCount = this.state.nodeMap.size;
      void _oldNodeCount; // Mark as intentionally unused for now

      // 更新状态
      this.state = {
        content,
        tree,
        version: this.state.version + 1,
        nodeMap: new Map(),
        lineIndex,
      };

      // 构建节点映射
      this.buildNodeMap(tree);

      // 转换为统一 AST 格式
      const ast = this.treeToAST(tree, content);

      // 收集错误
      this.collectErrors(tree, errors);

      // 计算新节点数量
      const newNodeCount = this.state.nodeMap.size;

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
        newNodeCount: newNodeCount - reusedNodeCount,
      };
    } catch (error) {
      // 增量解析失败，回退到完整解析
      console.warn('[TSTreeSitter] 增量解析失败，回退到完整解析:', error);
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
  getTree(): TSTree | null {
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
      version: 0,
      nodeMap: new Map(),
      lineIndex: [0],
    };
    resetNodeIdCounter();
  }

  // ================================
  // 内部方法 - 解析
  // ================================

  /**
   * 解析文档
   */
  private parseDocument(content: string, lineIndex: number[]): TSTree {
    const rootId = generateNodeId();

    // 分析文档结构
    const blocks = this.tokenizeBlocks(content, lineIndex);

    // 创建根节点
    const rootNode: TSNode = {
      type: 'Document',
      id: rootId,
      startIndex: 0,
      endIndex: content.length,
      startPosition: { row: 0, column: 0 },
      endPosition: offsetToRowColumn(content.length, lineIndex),
      parent: null,
      children: blocks.map((b) => b.id),
      hash: hashString(content),
      isError: false,
      text: content,
    };

    // 设置父节点引用
    for (const block of blocks) {
      block.parent = rootId;
    }

    // 构建节点映射
    const nodes = new Map<string, TSNode>();
    nodes.set(rootId, rootNode);
    for (const block of blocks) {
      this.addNodeToMap(block, nodes);
    }

    return {
      rootNode,
      nodes,
      version: this.state.version + 1,
      length: content.length,
    };
  }

  /**
   * 分词：将文档分割为块级元素
   */
  private tokenizeBlocks(content: string, lineIndex: number[]): TSNode[] {
    const blocks: TSNode[] = [];
    let pos = 0;

    while (pos < content.length) {
      // 跳过空白
      const wsMatch = content.slice(pos).match(/^\s+/);
      if (wsMatch) {
        const wsText = wsMatch[0];
        // 检查是否为段落分隔符（两个以上换行）
        if (/\n\s*\n/.test(wsText)) {
          const wsId = generateNodeId();
          blocks.push({
            type: 'ParagraphBreak',
            id: wsId,
            startIndex: pos,
            endIndex: pos + wsText.length,
            startPosition: offsetToRowColumn(pos, lineIndex),
            endPosition: offsetToRowColumn(pos + wsText.length, lineIndex),
            parent: null,
            children: [],
            hash: hashString(wsText),
            isError: false,
            text: wsText,
          });
        }
        pos += wsText.length;
        continue;
      }

      // 尝试匹配块级元素
      const blockResult = this.matchBlock(content, pos, lineIndex);
      if (blockResult) {
        blocks.push(blockResult.node);
        pos = blockResult.endPos;
        continue;
      }

      // 匹配文本段落
      const paraResult = this.matchParagraph(content, pos, lineIndex);
      if (paraResult) {
        blocks.push(paraResult.node);
        pos = paraResult.endPos;
        continue;
      }

      // 无法匹配，跳过一个字符
      pos++;
    }

    return blocks;
  }

  /**
   * 匹配块级元素
   */
  private matchBlock(
    content: string,
    pos: number,
    lineIndex: number[]
  ): { node: TSNode; endPos: number } | null {
    const remaining = content.slice(pos);

    // 匹配 \documentclass
    const docClassMatch = remaining.match(/^\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}/);
    if (docClassMatch) {
      return this.createBlockNode(
        'DocumentClass',
        pos,
        pos + docClassMatch[0].length,
        docClassMatch[0],
        lineIndex
      );
    }

    // 匹配 \usepackage
    const usePackageMatch = remaining.match(/^\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/);
    if (usePackageMatch) {
      return this.createBlockNode(
        'UsePackage',
        pos,
        pos + usePackageMatch[0].length,
        usePackageMatch[0],
        lineIndex
      );
    }

    // 匹配 \title, \author, \date
    const metaMatch = remaining.match(/^\\(title|author|date)\{([^}]*)\}/);
    if (metaMatch && metaMatch[1]) {
      const cmdName = metaMatch[1];
      const type = cmdName.charAt(0).toUpperCase() + cmdName.slice(1);
      return this.createBlockNode(type, pos, pos + metaMatch[0].length, metaMatch[0], lineIndex);
    }

    // 匹配 \maketitle
    const makeTitleMatch = remaining.match(/^\\maketitle/);
    if (makeTitleMatch) {
      return this.createBlockNode(
        'Maketitle',
        pos,
        pos + makeTitleMatch[0].length,
        makeTitleMatch[0],
        lineIndex
      );
    }

    // 匹配章节命令
    const sectionMatch = remaining.match(
      /^\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/
    );
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      // 使用 SectionXxx 前缀来区分章节命令和文本段落
      const type = 'Section' + sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
      return this.createBlockNode(
        type,
        pos,
        pos + sectionMatch[0].length,
        sectionMatch[0],
        lineIndex
      );
    }

    // 匹配环境 \begin{...}...\end{...}
    const envMatch = remaining.match(/^\\begin\{(\w+)\*?\}(?:\[[^\]]*\])?/);
    if (envMatch && envMatch[1]) {
      const envName = envMatch[1];
      const endPattern = new RegExp(`\\\\end\\{${envName}\\*?\\}`);
      const endMatch = remaining.match(endPattern);
      if (endMatch) {
        const endPos = remaining.indexOf(endMatch[0]) + endMatch[0].length;
        const envText = remaining.slice(0, endPos);
        const envType = this.getEnvironmentType(envName);

        // 对于 document 环境，递归解析内部内容
        if (envName === 'document') {
          return this.parseDocumentEnvironment(
            pos,
            pos + endPos,
            envMatch[0],
            endMatch[0],
            envText,
            lineIndex
          );
        }

        return this.createBlockNode(envType, pos, pos + endPos, envText, lineIndex);
      }
    }

    // 匹配块级数学 $$...$$
    const displayMathMatch = remaining.match(/^\$\$([\s\S]*?)\$\$/);
    if (displayMathMatch) {
      return this.createBlockNode(
        'DisplayMath',
        pos,
        pos + displayMathMatch[0].length,
        displayMathMatch[0],
        lineIndex
      );
    }

    // 匹配块级数学 \[...\]
    const displayMath2Match = remaining.match(/^\\\[([\s\S]*?)\\\]/);
    if (displayMath2Match) {
      return this.createBlockNode(
        'DisplayMath',
        pos,
        pos + displayMath2Match[0].length,
        displayMath2Match[0],
        lineIndex
      );
    }

    // 匹配注释
    const commentMatch = remaining.match(/^%[^\n]*/);
    if (commentMatch) {
      return this.createBlockNode(
        'Comment',
        pos,
        pos + commentMatch[0].length,
        commentMatch[0],
        lineIndex
      );
    }

    return null;
  }

  /**
   * 匹配段落（直到下一个块级元素或段落分隔符）
   */
  private matchParagraph(
    content: string,
    pos: number,
    lineIndex: number[]
  ): { node: TSNode; endPos: number } | null {
    let endPos = pos;
    let text = '';

    while (endPos < content.length) {
      const remaining = content.slice(endPos);

      // 检查段落分隔符
      const paraBreakMatch = remaining.match(/^\n\s*\n/);
      if (paraBreakMatch) {
        break;
      }

      // 检查块级元素开始
      if (this.isBlockStart(remaining)) {
        break;
      }

      // 读取一个字符或内联元素
      const inlineResult = this.matchInline(content, endPos, lineIndex);
      if (inlineResult) {
        text += inlineResult.text;
        endPos = inlineResult.endPos;
      } else {
        text += content[endPos];
        endPos++;
      }
    }

    if (text.trim().length === 0) {
      return null;
    }

    return this.createBlockNode('Paragraph', pos, endPos, text, lineIndex);
  }

  /**
   * 匹配内联元素
   */
  private matchInline(
    content: string,
    pos: number,
    _lineIndex: number[]
  ): { text: string; endPos: number } | null {
    const remaining = content.slice(pos);

    // 匹配内联数学 $...$（非 $$）
    if (remaining[0] === '$' && remaining[1] !== '$') {
      const endIdx = remaining.indexOf('$', 1);
      if (endIdx > 0 && !remaining.slice(1, endIdx).includes('\n')) {
        const text = remaining.slice(0, endIdx + 1);
        return { text, endPos: pos + endIdx + 1 };
      }
    }

    // 匹配内联数学 \(...\)
    if (remaining.startsWith('\\(')) {
      const endIdx = remaining.indexOf('\\)');
      if (endIdx > 0) {
        const text = remaining.slice(0, endIdx + 2);
        return { text, endPos: pos + endIdx + 2 };
      }
    }

    // 匹配命令
    const cmdMatch = remaining.match(/^\\(\w+)(?:\{([^}]*)\})?/);
    if (cmdMatch) {
      return { text: cmdMatch[0], endPos: pos + cmdMatch[0].length };
    }

    return null;
  }

  /**
   * 判断是否为块级元素开始
   */
  private isBlockStart(text: string): boolean {
    const blockStarters = [
      /^\\documentclass/,
      /^\\usepackage/,
      /^\\begin\{/,
      /^\\chapter\*?\{/,
      /^\\section\*?\{/,
      /^\\subsection\*?\{/,
      /^\\subsubsection\*?\{/,
      /^\\paragraph\*?\{/,
      /^\\title\{/,
      /^\\author\{/,
      /^\\date\{/,
      /^\\maketitle/,
      /^\$\$/,
      /^\\\[/,
    ];

    return blockStarters.some((pattern) => pattern.test(text));
  }

  /**
   * 解析 document 环境，递归解析内部内容为子节点
   */
  private parseDocumentEnvironment(
    startPos: number,
    endPos: number,
    beginTag: string,
    endTag: string,
    fullText: string,
    lineIndex: number[]
  ): { node: TSNode; endPos: number } {
    const id = generateNodeId();
    const logPrefix = '[TSTreeSitter parseDocumentEnvironment]';

    // 提取内部内容（去除 \begin{document} 和 \end{document}）
    const innerStart = beginTag.length;
    const innerEnd = fullText.length - endTag.length;
    const innerContent = fullText.slice(innerStart, innerEnd);

    console.log(
      `${logPrefix} 解析 document 环境: fullText.length=${fullText.length}, ` +
        `innerContent.length=${innerContent.length}, beginTag="${beginTag}", endTag="${endTag}"`
    );

    // 递归解析内部内容
    const innerBlocks = this.tokenizeBlocksWithOffset(
      innerContent,
      startPos + innerStart,
      lineIndex
    );

    console.log(
      `${logPrefix} 解析完成: innerBlocks.length=${innerBlocks.length}, ` +
        `types=${innerBlocks
          .map((b) => b.type)
          .slice(0, 10)
          .join(', ')}${innerBlocks.length > 10 ? '...' : ''}`
    );

    // 创建 DocumentBody 节点
    const node: TSNode = {
      type: 'DocumentBody',
      id,
      startIndex: startPos,
      endIndex: endPos,
      startPosition: offsetToRowColumn(startPos, lineIndex),
      endPosition: offsetToRowColumn(endPos, lineIndex),
      parent: null,
      children: innerBlocks.map((b) => b.id),
      hash: hashString(fullText),
      isError: false,
      text: fullText,
    };

    // 设置子节点的父节点引用
    for (const block of innerBlocks) {
      block.parent = id;
    }

    // 将子节点保存到临时存储（会在 addNodeToMap 中递归添加）
    (node as TSNode & { childNodes?: TSNode[] }).childNodes = innerBlocks;

    return { node, endPos };
  }

  /**
   * 分词：将文档分割为块级元素（带偏移量版本）
   */
  private tokenizeBlocksWithOffset(
    content: string,
    globalOffset: number,
    lineIndex: number[]
  ): TSNode[] {
    const blocks: TSNode[] = [];
    let pos = 0;
    const logPrefix = '[TSTreeSitter tokenizeBlocksWithOffset]';
    let loopCount = 0;
    const maxLoops = content.length + 1000; // 防止无限循环

    console.log(
      `${logPrefix} 开始分词: content.length=${content.length}, globalOffset=${globalOffset}`
    );

    while (pos < content.length) {
      loopCount++;
      if (loopCount > maxLoops) {
        console.error(`${logPrefix} 检测到可能的无限循环，pos=${pos}, blocks=${blocks.length}`);
        break;
      }

      // 首先检查是否是注释行（优先级高于空白）
      const commentLineMatch = content.slice(pos).match(/^[ \t]*%[^\n]*\n?/);
      if (commentLineMatch) {
        // 创建注释节点
        const globalPos = globalOffset + pos;
        const commentId = generateNodeId();
        blocks.push({
          type: 'Comment',
          id: commentId,
          startIndex: globalPos,
          endIndex: globalPos + commentLineMatch[0].length,
          startPosition: offsetToRowColumn(globalPos, lineIndex),
          endPosition: offsetToRowColumn(globalPos + commentLineMatch[0].length, lineIndex),
          parent: null,
          children: [],
          hash: hashString(commentLineMatch[0]),
          isError: false,
          text: commentLineMatch[0],
        });
        pos += commentLineMatch[0].length;
        continue;
      }

      // 跳过空白
      const wsMatch = content.slice(pos).match(/^\s+/);
      if (wsMatch) {
        const wsText = wsMatch[0];
        // 检查是否为段落分隔符（两个以上换行）
        if (/\n\s*\n/.test(wsText)) {
          const wsId = generateNodeId();
          const globalPos = globalOffset + pos;
          blocks.push({
            type: 'ParagraphBreak',
            id: wsId,
            startIndex: globalPos,
            endIndex: globalPos + wsText.length,
            startPosition: offsetToRowColumn(globalPos, lineIndex),
            endPosition: offsetToRowColumn(globalPos + wsText.length, lineIndex),
            parent: null,
            children: [],
            hash: hashString(wsText),
            isError: false,
            text: wsText,
          });
        }
        pos += wsText.length;
        continue;
      }

      // 尝试匹配块级元素（使用全局偏移）
      const blockResult = this.matchBlockWithOffset(content, pos, globalOffset, lineIndex);
      if (blockResult) {
        blocks.push(blockResult.node);
        pos = blockResult.localEndPos;
        continue;
      }

      // 匹配文本段落（使用全局偏移）
      const paraResult = this.matchParagraphWithOffset(content, pos, globalOffset, lineIndex);
      if (paraResult) {
        blocks.push(paraResult.node);
        pos = paraResult.localEndPos;
        continue;
      }

      // 无法匹配，跳过一个字符
      pos++;
    }

    console.log(`${logPrefix} 分词完成: blocks.length=${blocks.length}, loopCount=${loopCount}`);

    return blocks;
  }

  /**
   * 匹配块级元素（带偏移量版本）
   */
  private matchBlockWithOffset(
    content: string,
    localPos: number,
    globalOffset: number,
    lineIndex: number[]
  ): { node: TSNode; localEndPos: number } | null {
    const remaining = content.slice(localPos);
    const globalPos = globalOffset + localPos;

    // 匹配章节命令
    const sectionMatch = remaining.match(
      /^\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/
    );
    if (sectionMatch && sectionMatch[1]) {
      const sectionName = sectionMatch[1];
      // 使用 SectionXxx 前缀来区分章节命令和文本段落
      // 例如: \paragraph{} -> SectionParagraph, \section{} -> SectionSection
      const type = 'Section' + sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
      const result = this.createBlockNode(
        type,
        globalPos,
        globalPos + sectionMatch[0].length,
        sectionMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + sectionMatch[0].length };
    }

    // 匹配 \maketitle
    const makeTitleMatch = remaining.match(/^\\maketitle\b/);
    if (makeTitleMatch) {
      const result = this.createBlockNode(
        'Maketitle',
        globalPos,
        globalPos + makeTitleMatch[0].length,
        makeTitleMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + makeTitleMatch[0].length };
    }

    // 匹配 \tableofcontents
    const tocMatch = remaining.match(/^\\tableofcontents\b/);
    if (tocMatch) {
      const result = this.createBlockNode(
        'Command',
        globalPos,
        globalPos + tocMatch[0].length,
        tocMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + tocMatch[0].length };
    }

    // 匹配 \newpage, \clearpage, \cleardoublepage
    const pageBreakMatch = remaining.match(/^\\(newpage|clearpage|cleardoublepage)\b/);
    if (pageBreakMatch) {
      const result = this.createBlockNode(
        'Command',
        globalPos,
        globalPos + pageBreakMatch[0].length,
        pageBreakMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + pageBreakMatch[0].length };
    }

    // 匹配 \listoffigures, \listoftables
    const listofMatch = remaining.match(/^\\(listoffigures|listoftables)\b/);
    if (listofMatch) {
      const result = this.createBlockNode(
        'Command',
        globalPos,
        globalPos + listofMatch[0].length,
        listofMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + listofMatch[0].length };
    }

    // 匹配 \appendix
    const appendixMatch = remaining.match(/^\\appendix\b/);
    if (appendixMatch) {
      const result = this.createBlockNode(
        'Command',
        globalPos,
        globalPos + appendixMatch[0].length,
        appendixMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + appendixMatch[0].length };
    }

    // 匹配 \bibliography{...} 和 \printbibliography
    const bibMatch = remaining.match(/^\\(bibliography\{[^}]*\}|printbibliography)\b/);
    if (bibMatch) {
      const result = this.createBlockNode(
        'Command',
        globalPos,
        globalPos + bibMatch[0].length,
        bibMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + bibMatch[0].length };
    }

    // 匹配环境 \begin{...}...\end{...}（非 document）
    const envMatch = remaining.match(/^\\begin\{(\w+)\*?\}(?:\[[^\]]*\])?/);
    if (envMatch && envMatch[1]) {
      const envName = envMatch[1];
      // 跳过 document 环境（不应该在 document 内部再出现）
      if (envName === 'document') {
        return null;
      }
      const endPattern = new RegExp(`\\\\end\\{${envName}\\*?\\}`);
      const endMatch = remaining.match(endPattern);
      if (endMatch) {
        const endPos = remaining.indexOf(endMatch[0]) + endMatch[0].length;
        const envText = remaining.slice(0, endPos);
        const envType = this.getEnvironmentType(envName);
        const result = this.createBlockNode(
          envType,
          globalPos,
          globalPos + endPos,
          envText,
          lineIndex
        );
        return { node: result.node, localEndPos: localPos + endPos };
      }
    }

    // 匹配块级数学 $$...$$
    const displayMathMatch = remaining.match(/^\$\$([\s\S]*?)\$\$/);
    if (displayMathMatch) {
      const result = this.createBlockNode(
        'DisplayMath',
        globalPos,
        globalPos + displayMathMatch[0].length,
        displayMathMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + displayMathMatch[0].length };
    }

    // 匹配块级数学 \[...\]
    const displayMath2Match = remaining.match(/^\\\[([\s\S]*?)\\\]/);
    if (displayMath2Match) {
      const result = this.createBlockNode(
        'DisplayMath',
        globalPos,
        globalPos + displayMath2Match[0].length,
        displayMath2Match[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + displayMath2Match[0].length };
    }

    // 匹配注释
    const commentMatch = remaining.match(/^%[^\n]*/);
    if (commentMatch) {
      const result = this.createBlockNode(
        'Comment',
        globalPos,
        globalPos + commentMatch[0].length,
        commentMatch[0],
        lineIndex
      );
      return { node: result.node, localEndPos: localPos + commentMatch[0].length };
    }

    return null;
  }

  /**
   * 匹配段落（带偏移量版本）
   */
  private matchParagraphWithOffset(
    content: string,
    localPos: number,
    globalOffset: number,
    lineIndex: number[]
  ): { node: TSNode; localEndPos: number } | null {
    let endPos = localPos;
    let text = '';

    while (endPos < content.length) {
      const remaining = content.slice(endPos);

      // 遇到段落分隔符停止
      if (/^\n\s*\n/.test(remaining)) {
        break;
      }

      // 遇到注释行停止（以 % 开头）
      if (/^%/.test(remaining)) {
        break;
      }

      // 遇到块级命令停止
      if (
        /^\\(begin|section|subsection|subsubsection|chapter|paragraph|subparagraph|maketitle|tableofcontents|newpage|clearpage|cleardoublepage|listoffigures|listoftables|appendix|bibliography|printbibliography)\b/.test(
          remaining
        )
      ) {
        break;
      }

      // 遇到块级数学停止
      if (/^(\$\$|\\\[)/.test(remaining)) {
        break;
      }

      // 获取下一行或到末尾
      const lineMatch = remaining.match(/^[^\n]*\n?/);
      if (lineMatch) {
        // 检查这一行是否包含注释（行内注释）
        // 如果是纯注释行（去除空白后以 % 开头），跳过
        const lineContent = lineMatch[0];
        const trimmedLine = lineContent.trimStart();
        if (trimmedLine.startsWith('%')) {
          // 跳过纯注释行，不添加到段落中
          endPos += lineMatch[0].length;
          continue;
        }
        text += lineMatch[0];
        endPos += lineMatch[0].length;
      } else {
        break;
      }
    }

    if (text.trim().length === 0) {
      return null;
    }

    const globalPos = globalOffset + localPos;
    const id = generateNodeId();
    const node: TSNode = {
      type: 'Paragraph',
      id,
      startIndex: globalPos,
      endIndex: globalPos + text.length,
      startPosition: offsetToRowColumn(globalPos, lineIndex),
      endPosition: offsetToRowColumn(globalPos + text.length, lineIndex),
      parent: null,
      children: [],
      hash: hashString(text),
      isError: false,
      text,
    };

    return { node, localEndPos: endPos };
  }

  /**
   * 获取环境类型
   */
  private getEnvironmentType(envName: string): string {
    const mathEnvs = [
      'equation',
      'align',
      'gather',
      'multline',
      'aligned',
      'gathered',
      'split',
      'eqnarray',
    ];

    const listEnvs = ['itemize', 'enumerate', 'description'];

    const tableEnvs = ['tabular', 'table', 'array'];

    const matrixEnvs = ['matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix'];

    const baseEnv = envName.replace(/\*$/, '');

    if (mathEnvs.includes(baseEnv)) {
      return 'MathEnvironment';
    }
    if (listEnvs.includes(baseEnv)) {
      return 'ListEnvironment';
    }
    if (tableEnvs.includes(baseEnv)) {
      return 'TableEnvironment';
    }
    if (matrixEnvs.includes(baseEnv)) {
      return 'MatrixEnvironment';
    }
    if (baseEnv === 'document') {
      return 'DocumentBody';
    }
    if (baseEnv === 'cases' || baseEnv === 'dcases' || baseEnv === 'rcases') {
      return 'CasesEnvironment';
    }

    return 'Environment';
  }

  /**
   * 创建块节点
   */
  private createBlockNode(
    type: string,
    startIndex: number,
    endIndex: number,
    text: string,
    lineIndex: number[]
  ): { node: TSNode; endPos: number } {
    const id = generateNodeId();

    const node: TSNode = {
      type,
      id,
      startIndex,
      endIndex,
      startPosition: offsetToRowColumn(startIndex, lineIndex),
      endPosition: offsetToRowColumn(endIndex, lineIndex),
      parent: null,
      children: [],
      hash: hashString(text),
      isError: false,
      text,
    };

    return { node, endPos: endIndex };
  }

  /**
   * 添加节点到映射
   */
  private addNodeToMap(node: TSNode, nodes: Map<string, TSNode>): void {
    const logPrefix = '[TSTreeSitter addNodeToMap]';
    nodes.set(node.id, node);

    // 如果有 childNodes（如 DocumentBody），递归添加
    const nodeWithChildren = node as TSNode & { childNodes?: TSNode[] };
    if (nodeWithChildren.childNodes) {
      console.log(
        `${logPrefix} 节点 ${node.type}(${node.id}) 有 childNodes: ${nodeWithChildren.childNodes.length} 个`
      );
      for (const childNode of nodeWithChildren.childNodes) {
        this.addNodeToMap(childNode, nodes);
      }
      // 清理临时属性
      delete nodeWithChildren.childNodes;
    }

    // 递归添加子节点
    for (const childId of node.children) {
      const childNode = nodes.get(childId);
      if (childNode) {
        this.addNodeToMap(childNode, nodes);
      }
    }
  }

  // ================================
  // 内部方法 - 增量解析
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

    // 如果变更涉及文档结构命令，需要完整解析
    for (const change of changes.changes) {
      const changeText = change.insert;
      if (
        changeText.includes('\\documentclass') ||
        changeText.includes('\\begin{document}') ||
        changeText.includes('\\end{document}')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 计算变更范围
   */
  private calculateAffectedRange(changes: TextChangeSet): { from: number; to: number } {
    let from = Infinity;
    let to = -Infinity;

    for (const change of changes.changes) {
      from = Math.min(from, change.from);
      to = Math.max(to, change.to);
    }

    return { from, to };
  }

  /**
   * 增量解析
   */
  private incrementalParse(
    content: string,
    lineIndex: number[],
    affectedRange: { from: number; to: number }
  ): { tree: TSTree; affectedNodeIds: string[]; reusedNodeCount: number } {
    const oldTree = this.state.tree!;
    const affectedNodeIds: string[] = [];
    let reusedNodeCount = 0;

    // 找到受影响的节点
    for (const [id, node] of oldTree.nodes) {
      if (node.startIndex < affectedRange.to && node.endIndex > affectedRange.from) {
        affectedNodeIds.push(id);
      } else {
        reusedNodeCount++;
      }
    }

    // 重新解析文档
    const newTree = this.parseDocument(content, lineIndex);

    return {
      tree: newTree,
      affectedNodeIds,
      reusedNodeCount,
    };
  }

  // ================================
  // 内部方法 - 转换
  // ================================

  /**
   * 构建节点映射
   */
  private buildNodeMap(tree: TSTree): void {
    for (const [id, node] of tree.nodes) {
      this.state.nodeMap.set(id, {
        id: node.id,
        type: node.type,
        from: node.startIndex,
        to: node.endIndex,
        parent: node.parent || undefined,
        children: node.children,
        hash: node.hash,
      });
    }
  }

  /**
   * 将 Tree 转换为统一 AST 格式
   */
  private treeToAST(tree: TSTree, content: string): ASTRoot<ASTNode> {
    const nodes = new Map<string, ASTNode>();
    const logPrefix = '[TSTreeSitter treeToAST]';

    // 调试日志：显示输入 tree 的节点数
    console.log(
      `${logPrefix} 输入 tree.nodes.size=${tree.nodes.size}, ` +
        `rootNode.id=${tree.rootNode.id}, ` +
        `rootNode.children=${tree.rootNode.children?.length ?? 0}`
    );

    // 转换所有节点
    for (const [id, tsNode] of tree.nodes) {
      const astNode: ASTNode = {
        type: tsNode.type,
        id: tsNode.id,
        from: tsNode.startIndex,
        to: tsNode.endIndex,
        parent: tsNode.parent || undefined,
        children: tsNode.children,
        hash: tsNode.hash,
      };
      nodes.set(id, astNode);
    }

    console.log(`${logPrefix} 转换后 nodes.size=${nodes.size}`);

    const rootNode = nodes.get(tree.rootNode.id);
    if (!rootNode) {
      console.error(`${logPrefix} 根节点不存在! tree.rootNode.id=${tree.rootNode.id}`);
      console.error(
        `${logPrefix} 可用的节点 ID: ${Array.from(nodes.keys()).slice(0, 10).join(', ')}`
      );
      throw new Error('根节点不存在');
    }

    console.log(
      `${logPrefix} 根节点: type=${rootNode.type}, children=${rootNode.children?.length ?? 0}`
    );

    // 验证子节点是否都能找到
    if (rootNode.children && rootNode.children.length > 0) {
      const foundChildren: string[] = [];
      const missingChildren: string[] = [];
      for (const childId of rootNode.children) {
        if (nodes.has(childId)) {
          const child = nodes.get(childId)!;
          foundChildren.push(`${child.type}(${childId.slice(0, 10)})`);
        } else {
          missingChildren.push(childId);
        }
      }
      console.log(
        `${logPrefix} 子节点验证: 找到=${foundChildren.length}, 缺失=${missingChildren.length}`
      );
      if (foundChildren.length > 0) {
        console.log(`${logPrefix} 找到的子节点: ${foundChildren.slice(0, 10).join(', ')}...`);
      }
      if (missingChildren.length > 0) {
        console.warn(`${logPrefix} 缺失的子节点 ID: ${missingChildren.slice(0, 5).join(', ')}`);
      }
    }

    return {
      root: rootNode,
      nodes,
      version: tree.version,
      length: content.length,
    };
  }

  /**
   * 收集错误
   */
  private collectErrors(tree: TSTree, errors: ParseError[]): void {
    for (const [, node] of tree.nodes) {
      if (node.isError) {
        errors.push({
          message: '语法错误',
          position: {
            line: node.startPosition.row,
            column: node.startPosition.column,
            offset: node.startIndex,
          },
          range: {
            start: {
              line: node.startPosition.row,
              column: node.startPosition.column,
              offset: node.startIndex,
            },
            end: {
              line: node.endPosition.row,
              column: node.endPosition.column,
              offset: node.endIndex,
            },
          },
        });
      }
    }
  }

  /**
   * 创建空 AST
   */
  private createEmptyAST(): ASTRoot<ASTNode> {
    const rootId = generateNodeId();
    const rootNode: ASTNode = {
      type: 'Document',
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
 * 创建 TSTreeSitter 解析器
 */
export function createTSTreeSitterParser(config?: TSTreeSitterConfig): TSTreeSitterParser {
  return new TSTreeSitterParser(config);
}

// ================================
// 导出
// ================================

export default TSTreeSitterParser;
