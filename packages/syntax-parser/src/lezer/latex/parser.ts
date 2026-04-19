// ================================
// Lezer LaTeX Parser（语法分析器）
//
// 手写的 LaTeX 语法分析器，用于增量解析
// 将 Token 流构建为 AST
// ================================

import {
  NodeType,
  NodeNames,
  type NodeTypeValue,
  type LatexASTNode,
  type CommandASTNode,
  type EnvironmentASTNode,
  type MathASTNode,
  type SectionASTNode,
  type CommentASTNode,
  type ErrorASTNode,
  type LatexLezerConfig,
  type LatexLezerParseResult,
  type LatexLezerIncrementalResult,
  type LatexParseError,
  DEFAULT_LATEX_LEZER_CONFIG,
  SECTION_COMMANDS,
  LIST_ENVIRONMENTS,
  MATH_ENVIRONMENTS,
  VERBATIM_ENVIRONMENTS,
  COMMAND_ARG_COUNTS,
} from './types';

import { LatexTokenizer, TokenType, type Token } from './tokenizer';

// ================================
// 解析器状态定义
// ================================

/**
 * 解析器状态
 */
interface ParserState {
  /** 当前 Token 索引 */
  tokenIndex: number;
  /** Token 列表 */
  tokens: Token[];
  /** 当前深度 */
  depth: number;
  /** 错误列表 */
  errors: LatexParseError[];
  /** 警告列表 */
  warnings: LatexParseError[];
  /** 节点 ID 计数器 */
  nodeIdCounter: number;
  /** 节点映射表 */
  nodeMap: Map<number, LatexASTNode>;
  /** 环境栈 */
  envStack: string[];
  /** 是否在数学模式中 */
  inMathMode: boolean;
  /** 开始时间 */
  startTime: number;
}

// ================================
// LaTeX Parser 类
// ================================

/**
 * LaTeX 语法分析器
 *
 * 特性：
 * 1. 手写递归下降解析器
 * 2. 支持增量解析
 * 3. 错误恢复机制
 * 4. AST 节点缓存
 */
export class LatexLezerParser {
  /** 配置 */
  private config: LatexLezerConfig;

  /** Tokenizer 实例 */
  private tokenizer: LatexTokenizer | null = null;

  /** 解析器状态 */
  private state: ParserState | null = null;

  /** 上一次解析的 AST */
  private cachedAST: LatexASTNode | null = null;

  /** 上一次解析的内容 */
  private cachedContent: string = '';

  /** 文档版本号 */
  private version: number = 0;

  constructor(config?: Partial<LatexLezerConfig>) {
    this.config = { ...DEFAULT_LATEX_LEZER_CONFIG, ...config };
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 解析 LaTeX 文档
   */
  parse(input: string): LatexLezerParseResult {
    const startTime = performance.now();
    this.version++;

    // 初始化
    this.tokenizer = new LatexTokenizer(input);
    const tokens = this.tokenizer.tokenizeAll();

    this.state = this.createInitialState(tokens, startTime);

    try {
      // 解析文档
      const root = this.parseDocument();

      // 缓存结果
      this.cachedAST = root;
      this.cachedContent = input;

      return {
        root,
        nodeMap: this.state.nodeMap,
        errors: this.state.errors,
        warnings: this.state.warnings,
        success: this.state.errors.length === 0,
        parseTime: performance.now() - startTime,
        version: this.version,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addError(message, 0, input.length);

      // 返回空文档
      const emptyRoot = this.createNode(NodeType.Document, 0, input.length);

      return {
        root: emptyRoot,
        nodeMap: this.state.nodeMap,
        errors: this.state.errors,
        warnings: this.state.warnings,
        success: false,
        parseTime: performance.now() - startTime,
        version: this.version,
      };
    }
  }

  /**
   * 增量解析
   */
  parseIncremental(
    input: string,
    changeFrom: number,
    changeTo: number,
    insertLength: number
  ): LatexLezerIncrementalResult {
    const startTime = performance.now();

    // 判断是否需要完整重新解析
    if (this.shouldFullReparse(input, changeFrom, changeTo, insertLength)) {
      const result = this.parse(input);
      return {
        ...result,
        affectedNodes: Array.from(result.nodeMap.keys()),
        dirtyNodes: Array.from(result.nodeMap.keys()),
        fullReparse: true,
        reusedNodeCount: 0,
        newNodeCount: result.nodeMap.size,
      };
    }

    // 增量解析
    this.version++;

    // 初始化 tokenizer 并进行增量 tokenize
    this.tokenizer = new LatexTokenizer(input);
    this.tokenizer.retokenizeFrom(changeFrom, input);

    const tokens = this.tokenizer.tokenizeAll();
    this.state = this.createInitialState(tokens, startTime);

    try {
      // 计算受影响的范围
      const delta = insertLength - (changeTo - changeFrom);
      const affectedFrom = changeFrom;
      const affectedTo = changeTo + delta;

      // 解析文档
      const root = this.parseDocument();

      // 找出受影响的节点
      const affectedNodes = this.findAffectedNodes(root, affectedFrom, affectedTo);
      const dirtyNodes = affectedNodes;

      // 计算重用的节点数量
      const totalNodes = this.state.nodeMap.size;
      const reusedNodeCount = Math.max(0, totalNodes - affectedNodes.length);

      // 缓存结果
      this.cachedAST = root;
      this.cachedContent = input;

      return {
        root,
        nodeMap: this.state.nodeMap,
        errors: this.state.errors,
        warnings: this.state.warnings,
        success: this.state.errors.length === 0,
        parseTime: performance.now() - startTime,
        version: this.version,
        affectedNodes,
        dirtyNodes,
        fullReparse: false,
        reusedNodeCount,
        newNodeCount: affectedNodes.length,
      };
    } catch (error) {
      // 回退到完整解析
      return this.parseIncremental(input, 0, this.cachedContent.length, input.length);
    }
  }

  /**
   * 获取缓存的 AST
   */
  getCachedAST(): LatexASTNode | null {
    return this.cachedAST;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedAST = null;
    this.cachedContent = '';
    this.version = 0;
  }

  // ================================
  // 解析方法
  // ================================

  /**
   * 解析文档
   */
  private parseDocument(): LatexASTNode {
    const start = this.currentToken()?.from ?? 0;
    const children: LatexASTNode[] = [];

    // 查找 \documentclass 和 \begin{document}
    let hasPreamble = false;
    let preambleEnd = -1;
    let documentBodyStart = -1;

    // 扫描查找结构
    for (let i = 0; i < this.state!.tokens.length; i++) {
      const token = this.state!.tokens[i];
      if (!token) continue;

      if (token.type === TokenType.BeginEnv) {
        // 查找环境名称
        const envName = this.peekEnvironmentName(i);
        if (envName === 'document') {
          documentBodyStart = i;
          if (preambleEnd === -1) {
            preambleEnd = token.from;
          }
          break;
        }
      }
      if (token.type === TokenType.CommandName && token.value === 'documentclass') {
        hasPreamble = true;
      }
    }

    // 解析前言区（如果有）
    if (hasPreamble && preambleEnd > 0) {
      const preamble = this.parsePreamble(start, preambleEnd);
      children.push(preamble);
    }

    // 解析文档主体
    if (documentBodyStart >= 0) {
      this.state!.tokenIndex = documentBodyStart;
      const body = this.parseDocumentBody();
      if (body) {
        children.push(body);
      }
    } else {
      // 没有 \begin{document}，解析整个内容
      let lastPos = -1;
      let iterationCount = 0;
      const maxIterations = this.state!.tokens.length * 2 + 1000; // 安全限制
      while (!this.isAtEnd()) {
        iterationCount++;
        if (iterationCount > maxIterations) {
          break;
        }
        // 防止无限循环：检查位置是否前进
        const currentPos = this.state!.tokenIndex;
        if (currentPos === lastPos) {
          // 位置没有变化，强制前进
          this.advance();
          continue;
        }
        lastPos = currentPos;

        const node = this.parseContent();
        if (node) {
          children.push(node);
        }
      }
    }

    const end = this.previousToken()?.to ?? this.getInputLength();
    const doc = this.createNode(NodeType.Document, start, end, children);

    return doc;
  }

  /**
   * 解析前言区
   */
  private parsePreamble(start: number, end: number): LatexASTNode {
    const children: LatexASTNode[] = [];
    const savedIndex = this.state!.tokenIndex;

    let lastPos = -1;
    while (!this.isAtEnd() && this.currentToken()!.from < end) {
      // 防止无限循环：检查位置是否前进
      const currentPos = this.state!.tokenIndex;
      if (currentPos === lastPos) {
        // 位置没有变化，强制前进
        this.advance();
        continue;
      }
      lastPos = currentPos;

      const node = this.parseContent();
      if (node) {
        children.push(node);
      }
    }

    this.state!.tokenIndex = savedIndex;
    return this.createNode(NodeType.Preamble, start, end, children);
  }

  /**
   * 解析文档主体
   */
  private parseDocumentBody(): LatexASTNode | null {
    const token = this.currentToken();
    if (!token || token.type !== TokenType.BeginEnv) {
      return null;
    }

    const envNode = this.parseEnvironment();
    if (envNode) {
      // 将 Environment 节点转换为 DocumentBody
      return {
        ...envNode,
        type: NodeType.DocumentBody,
        name: NodeNames[NodeType.DocumentBody],
      };
    }

    return null;
  }

  /**
   * 解析内容（通用）
   */
  private parseContent(): LatexASTNode | null {
    // 检查超时
    if (this.isTimeout()) {
      throw new Error('解析超时');
    }

    // 检查深度
    if (this.state!.depth > this.config.maxDepth) {
      this.addWarning(
        '达到最大解析深度',
        this.currentToken()?.from ?? 0,
        this.currentToken()?.to ?? 0
      );
      return null;
    }

    const token = this.currentToken();
    if (!token) {
      return null;
    }

    switch (token.type) {
      case TokenType.CommandName:
        return this.parseCommand();

      case TokenType.BeginEnv:
        return this.parseEnvironment();

      case TokenType.BraceOpen:
        return this.parseGroup();

      case TokenType.MathInlineOpen:
      case TokenType.MathParenOpen:
        return this.parseInlineMath();

      case TokenType.MathDisplayOpen:
      case TokenType.MathBracketOpen:
        return this.parseDisplayMath();

      case TokenType.Comment:
        return this.parseComment();

      case TokenType.Text:
        return this.parseText();

      case TokenType.Whitespace:
      case TokenType.Newline:
        if (this.config.preserveWhitespace) {
          return this.parseWhitespace();
        }
        this.advance();
        return null;

      case TokenType.ParagraphBreak:
        return this.parseParagraphBreak();

      case TokenType.EOF:
        return null;

      case TokenType.Error:
        return this.parseError();

      case TokenType.BraceClose:
      case TokenType.BracketClose:
      case TokenType.EndEnv:
        // 这些应该由父级解析器处理
        // 必须前进 token 位置，否则会陷入无限循环
        this.advance();
        return null;

      default:
        // 其他 Token 作为文本处理
        return this.parseText();
    }
  }

  /**
   * 解析命令
   */
  private parseCommand(): LatexASTNode {
    const startToken = this.currentToken()!;
    const start = startToken.from;
    const commandName = startToken.value;

    this.advance(); // 跳过命令名

    // 检查是否有星号
    let star = false;
    if (
      this.currentToken()?.type === TokenType.Star ||
      (this.currentToken()?.type === TokenType.Text && this.currentToken()?.value === '*')
    ) {
      star = true;
      this.advance();
    }

    // 解析可选参数
    const optionalArgs: string[] = [];
    while (this.currentToken()?.type === TokenType.BracketOpen) {
      const arg = this.parseOptionalArg();
      if (arg !== null) {
        optionalArgs.push(arg);
      }
    }

    // 解析必选参数
    const requiredArgs: string[] = [];
    const argInfo = COMMAND_ARG_COUNTS[commandName];
    const expectedArgs = argInfo?.required ?? 0;

    for (let i = 0; i < expectedArgs; i++) {
      if (this.currentToken()?.type === TokenType.BraceOpen) {
        const arg = this.parseRequiredArg();
        if (arg !== null) {
          requiredArgs.push(arg);
        }
      }
    }

    // 如果没有预定义参数数量，尝试解析一个参数
    if (!argInfo && this.currentToken()?.type === TokenType.BraceOpen) {
      const arg = this.parseRequiredArg();
      if (arg !== null) {
        requiredArgs.push(arg);
      }
    }

    const end = this.previousToken()?.to ?? start + commandName.length + 1;

    // 检查是否是章节命令
    if (SECTION_COMMANDS[commandName] !== undefined) {
      const sectionNode: SectionASTNode = {
        type: NodeType.Section,
        name: NodeNames[NodeType.Section],
        from: start,
        to: end,
        title: requiredArgs[0] || '',
        level: SECTION_COMMANDS[commandName],
        star,
      };
      this.registerNode(sectionNode);
      return sectionNode;
    }

    // 普通命令节点
    const node: CommandASTNode = {
      type: NodeType.Command,
      name: NodeNames[NodeType.Command],
      from: start,
      to: end,
      commandName,
      star,
      optionalArgs,
      requiredArgs,
    };

    this.registerNode(node);
    return node;
  }

  /**
   * 解析可选参数
   */
  private parseOptionalArg(): string | null {
    if (this.currentToken()?.type !== TokenType.BracketOpen) {
      return null;
    }

    this.advance(); // 跳过 [
    let content = '';
    let depth = 1;

    while (!this.isAtEnd() && depth > 0) {
      const token = this.currentToken()!;

      if (token.type === TokenType.BracketOpen) {
        depth++;
        content += '[';
      } else if (token.type === TokenType.BracketClose) {
        depth--;
        if (depth > 0) {
          content += ']';
        }
      } else {
        content += token.value;
      }

      this.advance();
    }

    return content;
  }

  /**
   * 解析必选参数
   */
  private parseRequiredArg(): string | null {
    if (this.currentToken()?.type !== TokenType.BraceOpen) {
      return null;
    }

    this.advance(); // 跳过 {
    let content = '';
    let depth = 1;

    while (!this.isAtEnd() && depth > 0) {
      const token = this.currentToken()!;

      if (token.type === TokenType.BraceOpen) {
        depth++;
        content += '{';
      } else if (token.type === TokenType.BraceClose) {
        depth--;
        if (depth > 0) {
          content += '}';
        }
      } else {
        content += token.value;
      }

      this.advance();
    }

    return content;
  }

  /**
   * 解析环境
   */
  private parseEnvironment(): LatexASTNode | null {
    const beginToken = this.currentToken();
    if (!beginToken || beginToken.type !== TokenType.BeginEnv) {
      return null;
    }

    const start = beginToken.from;
    this.advance(); // 跳过 \begin

    // 解析环境名称
    const envName = this.parseRequiredArg();
    if (!envName) {
      this.addError('缺少环境名称', start, beginToken.to);
      return this.createErrorNode('缺少环境名称', start, beginToken.to);
    }

    // 进入环境
    this.state!.envStack.push(envName);
    this.state!.depth++;

    // 检查是否是数学环境
    if (MATH_ENVIRONMENTS.includes(envName as never)) {
      this.state!.inMathMode = true;
      this.tokenizer?.enterMathEnvironment(envName);
    }

    // 检查是否是原样输出环境
    if (VERBATIM_ENVIRONMENTS.includes(envName as never)) {
      this.tokenizer?.enterVerbatimMode(envName);
    }

    // 解析可选参数和必选参数
    const optionalArgs: string[] = [];
    while (this.currentToken()?.type === TokenType.BracketOpen) {
      const arg = this.parseOptionalArg();
      if (arg !== null) {
        optionalArgs.push(arg);
      }
    }

    const requiredArgs: string[] = [];
    while (this.currentToken()?.type === TokenType.BraceOpen) {
      const arg = this.parseRequiredArg();
      if (arg !== null) {
        requiredArgs.push(arg);
      }
    }

    // 解析环境内容
    const children: LatexASTNode[] = [];

    // 特殊处理列表环境
    if (LIST_ENVIRONMENTS.includes(envName as never)) {
      let lastPos = -1;
      while (!this.isAtEnd()) {
        // 防止无限循环：检查位置是否前进
        const currentPos = this.state!.tokenIndex;
        if (currentPos === lastPos) {
          this.advance();
          continue;
        }
        lastPos = currentPos;

        const token = this.currentToken();

        // 检查是否是 \end
        if (token?.type === TokenType.EndEnv) {
          break;
        }

        // 解析 \item
        if (token?.type === TokenType.CommandName && token.value === 'item') {
          const item = this.parseListItem();
          if (item) {
            children.push(item);
          }
        } else {
          const content = this.parseContent();
          if (content) {
            children.push(content);
          }
        }
      }
    } else {
      // 普通环境
      let lastPos = -1;
      while (!this.isAtEnd()) {
        // 防止无限循环：检查位置是否前进
        const currentPos = this.state!.tokenIndex;
        if (currentPos === lastPos) {
          this.advance();
          continue;
        }
        lastPos = currentPos;

        const token = this.currentToken();

        // 检查是否是 \end
        if (token?.type === TokenType.EndEnv) {
          break;
        }

        const content = this.parseContent();
        if (content) {
          children.push(content);
        }
      }
    }

    // 解析 \end{envName}
    let end = this.previousToken()?.to ?? start;

    if (this.currentToken()?.type === TokenType.EndEnv) {
      this.advance(); // 跳过 \end
      const endEnvName = this.parseRequiredArg();

      if (endEnvName !== envName) {
        this.addWarning(
          `环境不匹配: \\begin{${envName}} 对应 \\end{${endEnvName}}`,
          start,
          this.previousToken()?.to ?? start
        );
      }

      end = this.previousToken()?.to ?? end;
    } else {
      this.addError(`缺少 \\end{${envName}}`, start, end);
    }

    // 退出环境
    this.state!.envStack.pop();
    this.state!.depth--;

    if (MATH_ENVIRONMENTS.includes(envName as never)) {
      this.state!.inMathMode = false;
      this.tokenizer?.exitMathEnvironment(envName);
    }

    // 创建环境节点
    const node: EnvironmentASTNode = {
      type: NodeType.Environment,
      name: NodeNames[NodeType.Environment],
      from: start,
      to: end,
      environmentName: envName,
      optionalArgs,
      requiredArgs,
      children,
    };

    this.registerNode(node);
    return node;
  }

  /**
   * 解析列表项
   */
  private parseListItem(): LatexASTNode | null {
    const token = this.currentToken();
    if (!token || token.type !== TokenType.CommandName || token.value !== 'item') {
      return null;
    }

    const start = token.from;
    this.advance(); // 跳过 \item

    // 解析可选标签
    let label: string | undefined;
    if (this.currentToken()?.type === TokenType.BracketOpen) {
      label = this.parseOptionalArg() ?? undefined;
    }

    // 解析项内容
    const children: LatexASTNode[] = [];
    let lastPos = -1;

    while (!this.isAtEnd()) {
      // 防止无限循环：检查位置是否前进
      const currentPos = this.state!.tokenIndex;
      if (currentPos === lastPos) {
        this.advance();
        continue;
      }
      lastPos = currentPos;

      const current = this.currentToken();

      // 遇到下一个 \item 或 \end 停止
      if (current?.type === TokenType.EndEnv) {
        break;
      }
      if (current?.type === TokenType.CommandName && current.value === 'item') {
        break;
      }

      const content = this.parseContent();
      if (content) {
        children.push(content);
      }
    }

    const end = this.previousToken()?.to ?? start;

    const node: LatexASTNode = {
      type: NodeType.Item,
      name: NodeNames[NodeType.Item],
      from: start,
      to: end,
      children,
    };

    if (label) {
      (node as LatexASTNode & { label?: string }).label = label;
    }

    this.registerNode(node);
    return node;
  }

  /**
   * 解析分组
   */
  private parseGroup(): LatexASTNode {
    const startToken = this.currentToken()!;
    const start = startToken.from;

    this.advance(); // 跳过 {
    this.state!.depth++;

    const children: LatexASTNode[] = [];
    let lastPos = -1;

    while (!this.isAtEnd()) {
      // 防止无限循环：检查位置是否前进
      const currentPos = this.state!.tokenIndex;
      if (currentPos === lastPos) {
        this.advance();
        continue;
      }
      lastPos = currentPos;

      const token = this.currentToken();

      if (token?.type === TokenType.BraceClose) {
        break;
      }

      const content = this.parseContent();
      if (content) {
        children.push(content);
      }
    }

    // 跳过 }
    if (this.currentToken()?.type === TokenType.BraceClose) {
      this.advance();
    } else {
      this.addError('缺少右花括号 }', start, this.previousToken()?.to ?? start);
    }

    this.state!.depth--;

    const end = this.previousToken()?.to ?? start;
    const node = this.createNode(NodeType.Group, start, end, children);

    return node;
  }

  /**
   * 解析行内数学
   */
  private parseInlineMath(): LatexASTNode {
    const startToken = this.currentToken()!;
    const start = startToken.from;
    const delimiter = startToken.value;

    this.advance(); // 跳过开始分隔符
    this.state!.inMathMode = true;

    let content = '';
    const closeType = delimiter === '$' ? TokenType.MathInlineClose : TokenType.MathParenClose;

    while (!this.isAtEnd()) {
      const token = this.currentToken()!;

      if (token.type === closeType) {
        break;
      }

      content += token.value;
      this.advance();
    }

    // 跳过结束分隔符
    if (this.currentToken()?.type === closeType) {
      this.advance();
    } else {
      this.addError(`缺少数学模式结束分隔符`, start, this.previousToken()?.to ?? start);
    }

    this.state!.inMathMode = false;

    const end = this.previousToken()?.to ?? start;

    const node: MathASTNode = {
      type: NodeType.InlineMath,
      name: NodeNames[NodeType.InlineMath],
      from: start,
      to: end,
      content,
      delimiter: delimiter as '$' | '\\(',
      numbered: false,
    };

    this.registerNode(node);
    return node;
  }

  /**
   * 解析块级数学
   */
  private parseDisplayMath(): LatexASTNode {
    const startToken = this.currentToken()!;
    const start = startToken.from;
    const delimiter = startToken.value;

    this.advance(); // 跳过开始分隔符
    this.state!.inMathMode = true;

    let content = '';
    const closeType = delimiter === '$$' ? TokenType.MathDisplayClose : TokenType.MathBracketClose;

    while (!this.isAtEnd()) {
      const token = this.currentToken()!;

      if (token.type === closeType) {
        break;
      }

      content += token.value;
      this.advance();
    }

    // 跳过结束分隔符
    if (this.currentToken()?.type === closeType) {
      this.advance();
    } else {
      this.addError(`缺少数学模式结束分隔符`, start, this.previousToken()?.to ?? start);
    }

    this.state!.inMathMode = false;

    const end = this.previousToken()?.to ?? start;

    const node: MathASTNode = {
      type: NodeType.DisplayMath,
      name: NodeNames[NodeType.DisplayMath],
      from: start,
      to: end,
      content,
      delimiter: delimiter as '$$' | '\\[',
      numbered: false,
    };

    this.registerNode(node);
    return node;
  }

  /**
   * 解析注释
   */
  private parseComment(): LatexASTNode | null {
    const token = this.currentToken()!;

    if (!this.config.preserveComments) {
      this.advance();
      return null;
    }

    const node: CommentASTNode = {
      type: NodeType.Comment,
      name: NodeNames[NodeType.Comment],
      from: token.from,
      to: token.to,
      content: token.value.slice(1), // 去掉 %
    };

    this.advance();
    this.registerNode(node);
    return node;
  }

  /**
   * 解析文本
   */
  private parseText(): LatexASTNode {
    const startToken = this.currentToken()!;
    const start = startToken.from;
    let content = startToken.value;

    this.advance();

    // 合并连续的文本 Token
    while (!this.isAtEnd()) {
      const token = this.currentToken()!;

      if (
        token.type === TokenType.Text ||
        (!this.config.preserveWhitespace &&
          (token.type === TokenType.Whitespace || token.type === TokenType.Newline))
      ) {
        content += token.value;
        this.advance();
      } else {
        break;
      }
    }

    const end = this.previousToken()?.to ?? start;
    const node = this.createNode(NodeType.Text, start, end);

    return node;
  }

  /**
   * 解析空白
   */
  private parseWhitespace(): LatexASTNode {
    const token = this.currentToken()!;
    const node = this.createNode(NodeType.Whitespace, token.from, token.to);
    this.advance();
    return node;
  }

  /**
   * 解析段落分隔
   */
  private parseParagraphBreak(): LatexASTNode {
    const token = this.currentToken()!;
    const node = this.createNode(NodeType.ParagraphBreak, token.from, token.to);
    this.advance();
    return node;
  }

  /**
   * 解析错误
   */
  private parseError(): LatexASTNode {
    const token = this.currentToken()!;
    this.addError(`无效的 Token: ${token.value}`, token.from, token.to);
    const node = this.createErrorNode(`无效的 Token`, token.from, token.to);
    this.advance();
    return node;
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 创建初始状态
   */
  private createInitialState(tokens: Token[], startTime: number): ParserState {
    return {
      tokenIndex: 0,
      tokens,
      depth: 0,
      errors: [],
      warnings: [],
      nodeIdCounter: 0,
      nodeMap: new Map(),
      envStack: [],
      inMathMode: false,
      startTime,
    };
  }

  /**
   * 创建节点
   */
  private createNode(
    type: NodeTypeValue,
    from: number,
    to: number,
    children?: LatexASTNode[]
  ): LatexASTNode {
    const node: LatexASTNode = {
      type,
      name: NodeNames[type],
      from,
      to,
      children,
      hash: this.computeHash(from, to),
    };

    this.registerNode(node);
    return node;
  }

  /**
   * 创建错误节点
   */
  private createErrorNode(message: string, from: number, to: number): ErrorASTNode {
    const node: ErrorASTNode = {
      type: NodeType.Error,
      name: NodeNames[NodeType.Error],
      from,
      to,
      message,
      severity: 'error',
    };

    this.registerNode(node);
    return node;
  }

  /**
   * 注册节点
   */
  private registerNode(node: LatexASTNode): void {
    const id = this.state!.nodeIdCounter++;
    this.state!.nodeMap.set(id, node);
  }

  /**
   * 计算哈希值
   */
  private computeHash(from: number, to: number): string {
    // 简单的哈希计算
    let hash = 2166136261;
    const str = `${from}:${to}`;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16);
  }

  /**
   * 获取当前 Token
   */
  private currentToken(): Token | null {
    if (!this.state || this.state.tokenIndex >= this.state.tokens.length) {
      return null;
    }
    return this.state.tokens[this.state.tokenIndex] ?? null;
  }

  /**
   * 获取前一个 Token
   */
  private previousToken(): Token | null {
    if (!this.state || this.state.tokenIndex <= 0) {
      return null;
    }
    return this.state.tokens[this.state.tokenIndex - 1] ?? null;
  }

  /**
   * 前进到下一个 Token
   */
  private advance(): void {
    if (this.state && this.state.tokenIndex < this.state.tokens.length) {
      this.state.tokenIndex++;
    }
  }

  /**
   * 是否到达末尾
   */
  private isAtEnd(): boolean {
    return !this.state || this.state.tokenIndex >= this.state.tokens.length;
  }

  /**
   * 是否超时
   */
  private isTimeout(): boolean {
    if (!this.state) return false;
    return performance.now() - this.state.startTime > this.config.timeout;
  }

  /**
   * 查看环境名称
   */
  private peekEnvironmentName(beginIndex: number): string | null {
    // 在 \begin 之后查找 {envName}
    let i = beginIndex + 1;
    const tokens = this.state!.tokens;

    // 跳过空白
    while (i < tokens.length) {
      const token = tokens[i];
      if (!token || token.type !== TokenType.Whitespace) break;
      i++;
    }

    // 查找 {
    const braceToken = tokens[i];
    if (i < tokens.length && braceToken && braceToken.type === TokenType.BraceOpen) {
      i++;
      // 读取环境名称
      if (i < tokens.length) {
        const nameToken = tokens[i];
        if (
          nameToken &&
          (nameToken.type === TokenType.Text || nameToken.type === TokenType.CommandName)
        ) {
          return nameToken.value;
        }
      }
    }

    return null;
  }

  /**
   * 获取输入长度
   */
  private getInputLength(): number {
    if (!this.state || this.state.tokens.length === 0) {
      return 0;
    }
    const lastToken = this.state.tokens[this.state.tokens.length - 1];
    return lastToken?.to ?? 0;
  }

  /**
   * 添加错误
   */
  private addError(message: string, from: number, to: number): void {
    if (!this.state) return;

    const token = this.currentToken();
    this.state.errors.push({
      message,
      from,
      to,
      line: token?.line ?? 0,
      column: token?.column ?? 0,
      severity: 'error',
    });
  }

  /**
   * 添加警告
   */
  private addWarning(message: string, from: number, to: number): void {
    if (!this.state) return;

    const token = this.currentToken();
    this.state.warnings.push({
      message,
      from,
      to,
      line: token?.line ?? 0,
      column: token?.column ?? 0,
      severity: 'warning',
    });
  }

  /**
   * 判断是否需要完整重新解析
   */
  private shouldFullReparse(
    _input: string,
    changeFrom: number,
    changeTo: number,
    insertLength: number
  ): boolean {
    // 如果没有缓存，需要完整解析
    if (!this.cachedAST || !this.cachedContent) {
      return true;
    }

    // 如果变更太大（超过 30%），完整解析更高效
    const changeSize = Math.abs(insertLength - (changeTo - changeFrom));
    if (changeSize > this.cachedContent.length * 0.3) {
      return true;
    }

    // 如果变更在前言区，需要完整解析
    const preambleEnd = this.findPreambleEnd();
    if (changeFrom < preambleEnd) {
      return true;
    }

    return false;
  }

  /**
   * 查找前言区结束位置
   */
  private findPreambleEnd(): number {
    if (!this.cachedContent) return 0;

    const beginDocIndex = this.cachedContent.indexOf('\\begin{document}');
    return beginDocIndex >= 0 ? beginDocIndex : 0;
  }

  /**
   * 查找受影响的节点
   */
  private findAffectedNodes(root: LatexASTNode, from: number, to: number): number[] {
    const affected: number[] = [];

    const traverse = (node: LatexASTNode, id: number) => {
      // 检查节点是否与变更范围重叠
      if (node.to > from && node.from < to) {
        affected.push(id);
      }

      // 递归遍历子节点
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (child) {
            traverse(child, id * 100 + i);
          }
        }
      }
    };

    traverse(root, 0);
    return affected;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 LaTeX Lezer 解析器
 */
export function createLatexLezerParser(config?: Partial<LatexLezerConfig>): LatexLezerParser {
  return new LatexLezerParser(config);
}

/**
 * 快速解析 LaTeX 文档
 */
export function parseLatexDocument(
  input: string,
  config?: Partial<LatexLezerConfig>
): LatexLezerParseResult {
  const parser = new LatexLezerParser(config);
  return parser.parse(input);
}
