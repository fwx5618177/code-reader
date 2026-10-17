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
  COMMAND_ARG_COUNTS,
} from './types';

import { LatexTokenizer, TokenType, type Token } from './tokenizer';

/** 没有必选参数的常见环境：紧跟的 {...} 是环境内容而不是参数 */
const ARGUMENTLESS_ENVIRONMENTS = new Set([
  'document',
  'center',
  'flushleft',
  'flushright',
  'itemize',
  'enumerate',
  'description',
  'quote',
  'quotation',
  'verse',
  'abstract',
  'figure',
  'figure*',
  'table',
  'table*',
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'proof',
]);

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
  /** 开始时间 */
  startTime: number;
  /** 解析输入（用于把偏移换算为行列） */
  input: string;
  /** 各行起始偏移，首次报告问题时计算 */
  lineStarts: number[] | null;
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
    const tokens = new LatexTokenizer(input).tokenizeAll();

    this.state = this.createInitialState(input, tokens, startTime);

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

    const tokens = new LatexTokenizer(input).tokenizeAll();
    this.state = this.createInitialState(input, tokens, startTime);

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
        // 父级分组会在调用 parseContent 前消费自己的 }，到这里的都是多余的
        this.addError('多余的右花括号 }', token.from, token.to);
        this.advance();
        return null;

      case TokenType.EndEnv:
        return this.parseStrayEnd();

      case TokenType.MathParenClose:
      case TokenType.MathBracketClose:
        this.addError(`多余的 ${token.value}（没有对应的开始分隔符）`, token.from, token.to);
        this.advance();
        return null;

      default:
        // 其他 Token（包括正文中的 ] 等）作为文本处理
        return this.parseText();
    }
  }

  /**
   * 没有对应 \begin 的 \end{name}
   */
  private parseStrayEnd(): null {
    const token = this.currentToken()!;
    const name = this.peekEnvironmentName(this.state!.tokenIndex);
    this.advance();
    this.parseRequiredArg();
    const to = this.previousToken()?.to ?? token.to;
    this.addError(`多余的 \\end{${name ?? ''}}（没有对应的 \\begin）`, token.from, to);
    return null;
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

    // 解析参数：可选参数可以出现在必选参数之间（如 \newcommand{\foo}[1]{...}）
    const optionalArgs: string[] = [];
    const readOptionalArgs = () => {
      while (this.currentToken()?.type === TokenType.BracketOpen) {
        const arg = this.parseOptionalArg();
        if (arg !== null) {
          optionalArgs.push(arg);
        }
      }
    };

    const requiredArgs: string[] = [];
    const argInfo = COMMAND_ARG_COUNTS[commandName];
    // 未登记参数个数的命令最多读取一个紧跟的必选参数
    const expectedArgs = argInfo?.required ?? 1;

    readOptionalArgs();
    for (let i = 0; i < expectedArgs; i++) {
      if (this.currentToken()?.type !== TokenType.BraceOpen) {
        break;
      }
      const arg = this.parseRequiredArg();
      if (arg !== null) {
        requiredArgs.push(arg);
      }
      if (i < expectedArgs - 1) {
        readOptionalArgs();
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
   * 解析可选参数（不跨段落：遇到空行仍未闭合即报错并停止）
   */
  private parseOptionalArg(): string | null {
    const open = this.currentToken();
    if (open?.type !== TokenType.BracketOpen) {
      return null;
    }

    this.advance(); // 跳过 [
    let content = '';
    let depth = 1;

    while (!this.isAtEnd() && depth > 0) {
      const token = this.currentToken()!;

      if (token.type === TokenType.ParagraphBreak || token.type === TokenType.EOF) {
        break;
      }
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

    if (depth > 0) {
      this.addError('可选参数缺少右方括号 ]', open.from, open.to);
    }
    return content;
  }

  /**
   * 解析必选参数
   */
  private parseRequiredArg(): string | null {
    const open = this.currentToken();
    if (open?.type !== TokenType.BraceOpen) {
      return null;
    }

    this.advance(); // 跳过 {
    let content = '';
    let depth = 1;

    while (!this.isAtEnd() && depth > 0) {
      const token = this.currentToken()!;

      if (token.type === TokenType.EOF) {
        break;
      }
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

    if (depth > 0) {
      this.addError('缺少右花括号 }', open.from, open.to);
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
    // \begin{name} 的范围，缺少结束标记时把问题标在这里
    const headerEnd = this.previousToken()?.to ?? beginToken.to;

    // 进入环境
    this.state!.envStack.push(envName);
    this.state!.depth++;

    // 解析可选参数和必选参数
    const optionalArgs: string[] = [];
    while (this.currentToken()?.type === TokenType.BracketOpen) {
      const arg = this.parseOptionalArg();
      if (arg !== null) {
        optionalArgs.push(arg);
      }
    }

    const requiredArgs: string[] = [];
    while (
      !ARGUMENTLESS_ENVIRONMENTS.has(envName) &&
      this.currentToken()?.type === TokenType.BraceOpen
    ) {
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
    const endToken = this.currentToken();

    if (endToken?.type === TokenType.EndEnv) {
      const endEnvName = this.peekEnvironmentName(this.state!.tokenIndex);
      const outerEnvs = this.state!.envStack.slice(0, -1);

      if (endEnvName !== envName && endEnvName !== null && outerEnvs.includes(endEnvName)) {
        // 这个 \end 属于外层环境：当前环境漏写了结束标记，不消费交给外层
        this.addError(`缺少 \\end{${envName}}`, start, headerEnd);
      } else {
        this.advance(); // 跳过 \end
        this.parseRequiredArg();
        end = this.previousToken()?.to ?? end;
        if (endEnvName !== envName) {
          this.addError(
            `\\begin{${envName}} 与 \\end{${endEnvName ?? ''}} 不匹配`,
            endToken.from,
            end
          );
        }
      }
    } else {
      this.addError(`缺少 \\end{${envName}}`, start, headerEnd);
    }

    // 退出环境
    this.state!.envStack.pop();
    this.state!.depth--;

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
      // 外层环境的 \end 会让分组在此截断（报缺少 }），由环境自己消费
      if (this.atOpenEnvironmentEnd()) {
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
      this.addError('缺少右花括号 }', start, startToken.to);
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

    let content = '';
    const closeType = delimiter === '$' ? TokenType.MathInlineClose : TokenType.MathParenClose;

    while (!this.isAtEnd()) {
      const token = this.currentToken()!;

      if (token.type === closeType || token.type === TokenType.ParagraphBreak || this.atOpenEnvironmentEnd()) {
        break;
      }
      if (token.type === TokenType.Error) {
        this.parseError();
        continue;
      }

      content += token.value;
      this.advance();
    }

    // 跳过结束分隔符
    if (this.currentToken()?.type === closeType) {
      this.advance();
    } else {
      this.addError(`公式缺少结束分隔符 ${delimiter === '$' ? '$' : '\\)'}`, start, startToken.to);
    }

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

    let content = '';
    const closeType = delimiter === '$$' ? TokenType.MathDisplayClose : TokenType.MathBracketClose;

    while (!this.isAtEnd()) {
      const token = this.currentToken()!;

      if (token.type === closeType || token.type === TokenType.ParagraphBreak || this.atOpenEnvironmentEnd()) {
        break;
      }
      if (token.type === TokenType.Error) {
        this.parseError();
        continue;
      }

      content += token.value;
      this.advance();
    }

    // 跳过结束分隔符
    if (this.currentToken()?.type === closeType) {
      this.advance();
    } else {
      this.addError(`公式缺少结束分隔符 ${delimiter === '$$' ? '$$' : '\\]'}`, start, startToken.to);
    }

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
   * 解析错误 Token（词法器无法识别的片段）
   */
  private parseError(): LatexASTNode {
    const token = this.currentToken()!;
    const message = describeErrorToken(token.value);
    this.addError(message, token.from, token.to);
    const node = this.createErrorNode(message, token.from, token.to);
    this.advance();
    return node;
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 创建初始状态
   */
  private createInitialState(input: string, tokens: Token[], startTime: number): ParserState {
    return {
      tokenIndex: 0,
      tokens,
      depth: 0,
      errors: [],
      warnings: [],
      nodeIdCounter: 0,
      nodeMap: new Map(),
      envStack: [],
      startTime,
      input,
      lineStarts: null,
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
   * 当前 Token 是否为某个已打开环境的 \end：内层未闭合的分组/公式在此截断，交给该环境消费
   */
  private atOpenEnvironmentEnd(): boolean {
    const token = this.currentToken();
    return (
      token?.type === TokenType.EndEnv &&
      this.state!.envStack.includes(this.peekEnvironmentName(this.state!.tokenIndex) ?? '')
    );
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
    this.addProblem('error', message, from, to);
  }

  /**
   * 添加警告
   */
  private addWarning(message: string, from: number, to: number): void {
    this.addProblem('warning', message, from, to);
  }

  private addProblem(severity: 'error' | 'warning', message: string, from: number, to: number): void {
    if (!this.state) return;
    const { line, column } = this.locate(from);
    const problem: LatexParseError = { message, from, to, line, column, severity };
    (severity === 'error' ? this.state.errors : this.state.warnings).push(problem);
  }

  /**
   * 偏移 → 行列（行从 1 计，列从 0 计）
   */
  private locate(offset: number): { line: number; column: number } {
    const state = this.state!;
    if (!state.lineStarts) {
      const starts = [0];
      for (let i = state.input.indexOf('\n'); i !== -1; i = state.input.indexOf('\n', i + 1)) {
        starts.push(i + 1);
      }
      state.lineStarts = starts;
    }
    const starts = state.lineStarts;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - starts[low]! };
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

/**
 * 词法错误 Token 的说明
 */
function describeErrorToken(value: string): string {
  if (value === '\\') return '反斜杠后缺少命令名';
  if (value === '$') return '公式中出现多余的 $';
  if (value.startsWith('\\verb')) return '\\verb 缺少结束分隔符（必须在同一行内闭合）';
  return `无法识别的内容: ${value}`;
}
