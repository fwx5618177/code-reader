// ================================
// Lezer LaTeX Tokenizer（词法分析器）
//
// 手写的 LaTeX 词法分析器，用于增量解析
// 将输入文本分解为 Token 流
// ================================

import { MATH_ENVIRONMENTS, VERBATIM_ENVIRONMENTS } from './types';

/** 紧跟 \begin / \end 的环境名参数 */
const ENV_NAME_PATTERN = /\{([^{}\n]*)\}/y;

/** 参数需要原样读取的命令（其中的 % # _ 等字符不具特殊含义） */
const RAW_ARGUMENT_COMMANDS = new Set(['url', 'path']);

// ================================
// Token 类型定义
// ================================

/**
 * Token 类型枚举
 */
export const TokenType = {
  // 特殊符号
  Backslash: 'Backslash',
  BraceOpen: 'BraceOpen',
  BraceClose: 'BraceClose',
  BracketOpen: 'BracketOpen',
  BracketClose: 'BracketClose',
  Dollar: 'Dollar',
  DoubleDollar: 'DoubleDollar',
  Percent: 'Percent',
  Ampersand: 'Ampersand',
  Hash: 'Hash',
  Caret: 'Caret',
  Underscore: 'Underscore',
  Tilde: 'Tilde',

  // 命令相关
  CommandName: 'CommandName',
  Star: 'Star',

  // 环境相关
  BeginEnv: 'BeginEnv',
  EndEnv: 'EndEnv',
  EnvName: 'EnvName',

  // 数学模式
  MathInlineOpen: 'MathInlineOpen',
  MathInlineClose: 'MathInlineClose',
  MathDisplayOpen: 'MathDisplayOpen',
  MathDisplayClose: 'MathDisplayClose',
  MathParenOpen: 'MathParenOpen',
  MathParenClose: 'MathParenClose',
  MathBracketOpen: 'MathBracketOpen',
  MathBracketClose: 'MathBracketClose',

  // 文本和空白
  Text: 'Text',
  Whitespace: 'Whitespace',
  Newline: 'Newline',
  ParagraphBreak: 'ParagraphBreak',

  // 注释
  Comment: 'Comment',

  // 表格
  RowSeparator: 'RowSeparator',
  ColumnSeparator: 'ColumnSeparator',

  // 其他
  EOF: 'EOF',
  Error: 'Error',
} as const;

export type TokenTypeValue = (typeof TokenType)[keyof typeof TokenType];

/**
 * Token 接口
 */
export interface Token {
  /** Token 类型 */
  type: TokenTypeValue;
  /** Token 值 */
  value: string;
  /** 起始位置 */
  from: number;
  /** 结束位置 */
  to: number;
  /** 起始行号（从 0 计） */
  line: number;
  /** 起始列号（从 0 计） */
  column: number;
}

/**
 * Tokenizer 状态
 */
export interface TokenizerState {
  /** 当前位置 */
  pos: number;
  /** 当前行号 */
  line: number;
  /** 当前列号 */
  column: number;
  /** 是否在数学模式中 */
  inMathMode: boolean;
  /** 数学模式类型 */
  mathModeType: 'inline' | 'display' | 'environment' | null;
  /** 数学模式分隔符 */
  mathDelimiter: string | null;
  /** 是否在原样输出环境中 */
  inVerbatim: boolean;
  /** 原样输出环境名称 */
  verbatimEnvName: string | null;
  /** 括号栈 */
  braceStack: number;
  /** 进入行内/行间公式时的括号深度：公式内出现关闭外层分组的 } 时公式在此结束（TeX 报 Missing $） */
  mathBraceBase: number;
  /** 环境栈 */
  envStack: string[];
  /** \begin{name} 读完后待进入的模式（原样输出或数学环境），at 为环境名参数之后的位置 */
  pendingMode: { kind: 'verbatim' | 'math'; env: string; at: number } | null;
  /** \url / \path 的原样参数：pending 等待左花括号，open 正在读取参数内容 */
  rawArgument: 'pending' | 'open' | null;
}

// ================================
// Tokenizer 类
// ================================

/**
 * LaTeX Tokenizer（词法分析器）
 *
 * 将 LaTeX 源码分解为 Token 流
 * 支持增量解析：可以从任意位置开始
 */
export class LatexTokenizer {
  /** 输入文本 */
  private input: string;

  /** 输入长度 */
  private length: number;

  /** 当前状态 */
  private state: TokenizerState;

  /** 已生成的 Token 缓存 */
  private tokenCache: Token[];

  /** Token 位置索引（用于快速查找） */
  private tokenPositionIndex: Map<number, number>;

  /**
   * 创建 Tokenizer 实例
   * @param input LaTeX 源码
   */
  constructor(input: string) {
    this.input = input;
    this.length = input.length;
    this.state = this.createInitialState();
    this.tokenCache = [];
    this.tokenPositionIndex = new Map();
  }

  /**
   * 创建初始状态
   */
  private createInitialState(): TokenizerState {
    return {
      pos: 0,
      line: 0,
      column: 0,
      inMathMode: false,
      mathModeType: null,
      mathDelimiter: null,
      inVerbatim: false,
      verbatimEnvName: null,
      braceStack: 0,
      mathBraceBase: 0,
      envStack: [],
      pendingMode: null,
      rawArgument: null,
    };
  }

  /**
   * 重置 Tokenizer
   * @param input 新的输入文本
   */
  reset(input?: string): void {
    if (input !== undefined) {
      this.input = input;
      this.length = input.length;
    }
    this.state = this.createInitialState();
    this.tokenCache = [];
    this.tokenPositionIndex.clear();
  }


  /**
   * 获取下一个 Token
   */
  nextToken(): Token {
    this.activatePendingMode();
    const line = this.state.line;
    const column = this.state.column;
    const token = this.scanToken();
    // Token 记录起始行列（扫描过程中 state 已前进到 Token 末尾）
    token.line = line;
    token.column = column;
    return token;
  }

  private scanToken(): Token {
    if (this.state.pos >= this.length) {
      return this.createToken(TokenType.EOF, '', this.state.pos, this.state.pos);
    }

    if (this.state.inVerbatim) {
      return this.tokenizeVerbatim();
    }

    if (this.state.rawArgument) {
      const raw = this.tokenizeRawArgument();
      if (raw) return raw;
    }

    if (this.state.inMathMode) {
      return this.tokenizeMathMode();
    }

    return this.tokenizeNormalMode();
  }

  /**
   * 环境名参数读完后进入对应模式：词法分析先于语法分析整体完成，
   * 原样输出与数学环境的模式切换只能由词法器自己根据 \begin{name} 决定
   */
  private activatePendingMode(): void {
    const pending = this.state.pendingMode;
    if (!pending || this.state.pos < pending.at) return;
    this.state.pendingMode = null;
    if (pending.kind === 'verbatim') {
      this.state.inVerbatim = true;
      this.state.verbatimEnvName = pending.env;
    } else if (!this.state.inMathMode) {
      this.state.inMathMode = true;
      this.state.mathModeType = 'environment';
      this.state.mathDelimiter = pending.env;
    }
  }

  /** 读取紧跟当前位置的 {环境名} */
  private peekEnvironmentName(): { name: string; end: number } | null {
    ENV_NAME_PATTERN.lastIndex = this.state.pos;
    const match = ENV_NAME_PATTERN.exec(this.input);
    if (!match) return null;
    return { name: (match[1] ?? '').trim(), end: this.state.pos + match[0].length };
  }

  private enterMathMode(type: 'inline' | 'display', delimiter: string): void {
    this.state.inMathMode = true;
    this.state.mathModeType = type;
    this.state.mathDelimiter = delimiter;
    this.state.mathBraceBase = this.state.braceStack;
  }

  private exitMathMode(): void {
    this.state.inMathMode = false;
    this.state.mathModeType = null;
    this.state.mathDelimiter = null;
  }

  /**
   * 获取所有 Token
   */
  tokenizeAll(): Token[] {
    const tokens: Token[] = [];
    let token: Token;

    do {
      token = this.nextToken();
      tokens.push(token);
    } while (token.type !== TokenType.EOF);

    return tokens;
  }

  /**
   * 获取指定范围内的 Token
   * @param from 起始位置
   * @param to 结束位置
   */
  tokenizeRange(from: number, to: number): Token[] {
    // 先确保已经 tokenize 到 to 位置
    while (this.state.pos < to && this.state.pos < this.length) {
      const token = this.nextToken();
      this.tokenCache.push(token);
      this.tokenPositionIndex.set(token.from, this.tokenCache.length - 1);
      if (token.type === TokenType.EOF) break;
    }

    // 从缓存中提取范围内的 Token
    return this.tokenCache.filter((t) => t.from >= from && t.to <= to);
  }


  /**
   * 正常模式下的 tokenize
   */
  private tokenizeNormalMode(): Token {
    const char = this.peek();
    const start = this.state.pos;

    switch (char) {
      case '\\':
        return this.tokenizeBackslash();

      case '{':
        this.state.braceStack++;
        return this.createTokenAndAdvance(TokenType.BraceOpen, '{', start);

      case '}':
        this.state.braceStack = Math.max(0, this.state.braceStack - 1);
        return this.createTokenAndAdvance(TokenType.BraceClose, '}', start);

      case '[':
        return this.createTokenAndAdvance(TokenType.BracketOpen, '[', start);

      case ']':
        return this.createTokenAndAdvance(TokenType.BracketClose, ']', start);

      case '$':
        return this.tokenizeDollar();

      case '%':
        return this.tokenizeComment();

      case '&':
        return this.createTokenAndAdvance(TokenType.Ampersand, '&', start);

      case '#':
        return this.createTokenAndAdvance(TokenType.Hash, '#', start);

      case '^':
        return this.createTokenAndAdvance(TokenType.Caret, '^', start);

      case '_':
        return this.createTokenAndAdvance(TokenType.Underscore, '_', start);

      case '~':
        return this.createTokenAndAdvance(TokenType.Tilde, '~', start);

      case '\n':
        return this.tokenizeNewline();

      case '\r':
        // 处理 \r\n
        if (this.peek(1) === '\n') {
          this.advance();
        }
        return this.tokenizeNewline();

      case ' ':
      case '\t':
        return this.tokenizeWhitespace();

      default:
        return this.tokenizeText();
    }
  }

  /**
   * tokenize 反斜杠（命令或特殊字符）
   */
  private tokenizeBackslash(): Token {
    const start = this.state.pos;
    this.advance(); // 跳过 \

    const nextChar = this.peek();

    if (nextChar === '') {
      // 文末孤立的反斜杠
      return this.createToken(TokenType.Error, '\\', start, this.state.pos);
    }

    // 数学分隔符只在文本模式下生效；数学模式内匹配的结束符由 tokenizeMathMode 处理
    if (!this.state.inMathMode) {
      if (nextChar === '(') {
        this.advance();
        this.enterMathMode('inline', '\\(');
        return this.createToken(TokenType.MathParenOpen, '\\(', start, this.state.pos);
      }

      if (nextChar === '[') {
        this.advance();
        this.enterMathMode('display', '\\[');
        return this.createToken(TokenType.MathBracketOpen, '\\[', start, this.state.pos);
      }

      // 文本模式下的 \) \] 没有对应的开始分隔符，交给语法分析报错
      if (nextChar === ')') {
        this.advance();
        return this.createToken(TokenType.MathParenClose, '\\)', start, this.state.pos);
      }

      if (nextChar === ']') {
        this.advance();
        return this.createToken(TokenType.MathBracketClose, '\\]', start, this.state.pos);
      }
    }

    // 换行符（\\ 或 \\*）
    if (nextChar === '\\') {
      this.advance();
      let value = '\\\\';
      if (this.peek() === '*') {
        this.advance();
        value = '\\\\*';
      }
      return this.createToken(TokenType.RowSeparator, value, start, this.state.pos);
    }

    // 控制符号：反斜杠后跟单个非字母字符（\, \| \{ \$ \% 等）
    if (!this.isLetter(nextChar)) {
      this.advance();
      return this.createToken(TokenType.CommandName, nextChar, start, this.state.pos);
    }

    const commandName = this.readCommandName();

    if (commandName === 'begin') {
      const env = this.peekEnvironmentName();
      if (env && VERBATIM_ENVIRONMENTS.includes(env.name as never)) {
        this.state.pendingMode = { kind: 'verbatim', env: env.name, at: env.end };
      } else if (env && !this.state.inMathMode && MATH_ENVIRONMENTS.includes(env.name as never)) {
        this.state.pendingMode = { kind: 'math', env: env.name, at: env.end };
      }
      return this.createToken(TokenType.BeginEnv, '\\begin', start, this.state.pos);
    }

    if (commandName === 'end') {
      if (this.state.mathModeType === 'environment') {
        const env = this.peekEnvironmentName();
        if (env && env.name === this.state.mathDelimiter) {
          this.exitMathMode();
        }
      }
      return this.createToken(TokenType.EndEnv, '\\end', start, this.state.pos);
    }

    if (commandName === 'verb') {
      return this.tokenizeVerb(start);
    }

    if (RAW_ARGUMENT_COMMANDS.has(commandName)) {
      this.state.rawArgument = 'pending';
    }

    return this.createToken(TokenType.CommandName, commandName, start, this.state.pos);
  }

  /**
   * \verb|...|：分隔符之间原样输出，必须在同一行内结束
   */
  private tokenizeVerb(start: number): Token {
    if (this.peek() === '*') {
      this.advance();
    }
    const delimiter = this.peek();
    const lineEnd = this.input.indexOf('\n', this.state.pos);
    const close =
      delimiter && delimiter !== ' ' && delimiter !== '\n' && !this.isLetter(delimiter)
        ? this.input.indexOf(delimiter, this.state.pos + 1)
        : -1;

    if (close === -1 || (lineEnd !== -1 && close > lineEnd)) {
      return this.createToken(TokenType.Error, this.input.slice(start, this.state.pos), start, this.state.pos);
    }

    while (this.state.pos <= close) {
      this.advance();
    }
    return this.createToken(TokenType.Text, this.input.slice(start, this.state.pos), start, this.state.pos);
  }

  /**
   * \url / \path 的参数：左花括号、原样内容、右花括号依次产出
   */
  private tokenizeRawArgument(): Token | null {
    const start = this.state.pos;

    if (this.state.rawArgument === 'pending') {
      if (this.peek() !== '{') {
        this.state.rawArgument = null;
        return null;
      }
      this.state.rawArgument = 'open';
      return this.createTokenAndAdvance(TokenType.BraceOpen, '{', start);
    }

    const close = this.input.indexOf('}', start);
    if (close === start) {
      this.state.rawArgument = null;
      return this.createTokenAndAdvance(TokenType.BraceClose, '}', start);
    }

    const end = close === -1 ? this.length : close;
    while (this.state.pos < end) {
      this.advance();
    }
    if (close === -1) {
      this.state.rawArgument = null;
    }
    return this.createToken(TokenType.Text, this.input.slice(start, end), start, end);
  }

  /**
   * 读取命令名称
   */
  private readCommandName(): string {
    const start = this.state.pos;

    // 命令名由字母组成
    while (this.state.pos < this.length) {
      const char = this.peek();
      if (this.isLetter(char)) {
        this.advance();
      } else {
        break;
      }
    }

    return this.input.slice(start, this.state.pos);
  }

  /**
   * tokenize 美元符号（数学模式）
   */
  private tokenizeDollar(): Token {
    const start = this.state.pos;

    // 检查是否是 $$（display math）
    if (this.peek(1) === '$') {
      this.advance();
      this.advance();

      this.enterMathMode('display', '$$');
      return this.createToken(TokenType.MathDisplayOpen, '$$', start, this.state.pos);
    }

    // 单个 $（inline math）
    this.advance();
    this.enterMathMode('inline', '$');
    return this.createToken(TokenType.MathInlineOpen, '$', start, this.state.pos);
  }

  /**
   * tokenize 注释
   */
  private tokenizeComment(): Token {
    const start = this.state.pos;
    this.advance(); // 跳过 %

    // 读取到行尾
    while (this.state.pos < this.length) {
      const char = this.peek();
      if (char === '\n' || char === '\r') {
        break;
      }
      this.advance();
    }

    return this.createToken(
      TokenType.Comment,
      this.input.slice(start, this.state.pos),
      start,
      this.state.pos
    );
  }

  /**
   * tokenize 换行
   */
  private tokenizeNewline(): Token {
    const start = this.state.pos;
    this.advance(); // 跳过 \n

    // 检查是否是段落分隔（连续两个或更多换行）
    let newlineCount = 1;
    while (this.state.pos < this.length) {
      const char = this.peek();
      if (char === '\n') {
        this.advance();
        newlineCount++;
      } else if (char === '\r') {
        this.advance();
        if (this.peek() === '\n') {
          this.advance();
        }
        newlineCount++;
      } else if (char === ' ' || char === '\t') {
        // 跳过换行间的空白
        this.advance();
      } else {
        break;
      }
    }

    if (newlineCount >= 2) {
      return this.createToken(
        TokenType.ParagraphBreak,
        this.input.slice(start, this.state.pos),
        start,
        this.state.pos
      );
    }

    return this.createToken(
      TokenType.Newline,
      this.input.slice(start, this.state.pos),
      start,
      this.state.pos
    );
  }

  /**
   * tokenize 空白
   */
  private tokenizeWhitespace(): Token {
    const start = this.state.pos;

    while (this.state.pos < this.length) {
      const char = this.peek();
      if (char === ' ' || char === '\t') {
        this.advance();
      } else {
        break;
      }
    }

    return this.createToken(
      TokenType.Whitespace,
      this.input.slice(start, this.state.pos),
      start,
      this.state.pos
    );
  }

  /**
   * tokenize 文本
   */
  private tokenizeText(): Token {
    const start = this.state.pos;

    while (this.state.pos < this.length) {
      const char = this.peek();

      // 遇到特殊字符停止
      if (
        char === '\\' ||
        char === '{' ||
        char === '}' ||
        char === '[' ||
        char === ']' ||
        char === '$' ||
        char === '%' ||
        char === '&' ||
        char === '#' ||
        char === '^' ||
        char === '_' ||
        char === '~' ||
        char === '\n' ||
        char === '\r' ||
        char === ' ' ||
        char === '\t'
      ) {
        // 如果还没有前进过，至少前进一个字符以防止无限循环
        if (this.state.pos === start) {
          this.advance();
        }
        break;
      }

      this.advance();
    }

    // 确保至少前进一个字符，防止空 token 导致无限循环
    if (this.state.pos === start && this.state.pos < this.length) {
      this.advance();
    }

    return this.createToken(
      TokenType.Text,
      this.input.slice(start, this.state.pos),
      start,
      this.state.pos
    );
  }

  /**
   * 数学模式下的 tokenize
   */
  private tokenizeMathMode(): Token {
    const char = this.peek();
    const start = this.state.pos;

    // 检查结束分隔符
    if (this.state.mathDelimiter === '$' && char === '$') {
      this.advance();
      this.exitMathMode();
      return this.createToken(TokenType.MathInlineClose, '$', start, this.state.pos);
    }

    if (this.state.mathDelimiter === '$$' && char === '$' && this.peek(1) === '$') {
      this.advance();
      this.advance();
      this.exitMathMode();
      return this.createToken(TokenType.MathDisplayClose, '$$', start, this.state.pos);
    }

    // 关闭公式之外分组的 }（\label{a $b}、\section{x $y}）：未闭合的公式在此结束，} 按正文处理
    if (char === '}' && this.state.mathModeType !== 'environment' && this.state.braceStack <= this.state.mathBraceBase) {
      this.exitMathMode();
      return this.tokenizeNormalMode();
    }

    // 其余数学模式（\( \[ $$ 与公式环境）中出现的 $ 不合法
    if (char === '$') {
      return this.createTokenAndAdvance(TokenType.Error, '$', start);
    }

    if (char === '\\') {
      const nextChar = this.peek(1);
      if (this.state.mathDelimiter === '\\(' && nextChar === ')') {
        this.advance();
        this.advance();
        this.exitMathMode();
        return this.createToken(TokenType.MathParenClose, '\\)', start, this.state.pos);
      }
      if (this.state.mathDelimiter === '\\[' && nextChar === ']') {
        this.advance();
        this.advance();
        this.exitMathMode();
        return this.createToken(TokenType.MathBracketClose, '\\]', start, this.state.pos);
      }
    }

    // 数学模式中处理命令
    if (char === '\\') {
      return this.tokenizeBackslash();
    }

    // 处理数学模式中的其他字符
    switch (char) {
      case '{':
        this.state.braceStack++;
        return this.createTokenAndAdvance(TokenType.BraceOpen, '{', start);

      case '}':
        this.state.braceStack = Math.max(0, this.state.braceStack - 1);
        return this.createTokenAndAdvance(TokenType.BraceClose, '}', start);

      case '^':
        return this.createTokenAndAdvance(TokenType.Caret, '^', start);

      case '_':
        return this.createTokenAndAdvance(TokenType.Underscore, '_', start);

      case '&':
        return this.createTokenAndAdvance(TokenType.Ampersand, '&', start);

      case ' ':
      case '\t':
        return this.tokenizeWhitespace();

      case '\n':
      case '\r': {
        // 段落分隔会终止未闭合的行内/行间公式（公式环境除外），避免一个缺失的 $ 让后文全部错位
        const token = this.tokenizeNewline();
        if (token.type === TokenType.ParagraphBreak && this.state.mathModeType !== 'environment') {
          this.exitMathMode();
        }
        return token;
      }

      default:
        return this.tokenizeMathText();
    }
  }

  /**
   * tokenize 数学模式中的文本
   */
  private tokenizeMathText(): Token {
    const start = this.state.pos;

    while (this.state.pos < this.length) {
      const char = this.peek();

      // 数学模式中的特殊字符
      if (
        char === '\\' ||
        char === '{' ||
        char === '}' ||
        char === '^' ||
        char === '_' ||
        char === '$' ||
        char === '&' ||
        char === ' ' ||
        char === '\t' ||
        char === '\n' ||
        char === '\r'
      ) {
        break;
      }

      this.advance();
    }

    return this.createToken(
      TokenType.Text,
      this.input.slice(start, this.state.pos),
      start,
      this.state.pos
    );
  }

  /**
   * 原样输出模式下的 tokenize
   */
  private tokenizeVerbatim(): Token {
    const start = this.state.pos;
    const envName = this.state.verbatimEnvName;
    const endPattern = `\\end{${envName}}`;

    // 查找 \end{envName}
    const endIndex = this.input.indexOf(endPattern, this.state.pos);

    if (endIndex === -1) {
      // 没有找到结束标记，读取到末尾
      this.state.pos = this.length;
      return this.createToken(TokenType.Text, this.input.slice(start), start, this.state.pos);
    }

    // 读取到结束标记之前（逐字符前进以维护行列号）
    while (this.state.pos < endIndex) {
      this.advance();
    }

    // 退出原样输出模式
    this.state.inVerbatim = false;
    this.state.verbatimEnvName = null;

    return this.createToken(TokenType.Text, this.input.slice(start, endIndex), start, endIndex);
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 查看当前位置的字符
   * @param offset 偏移量
   */
  private peek(offset: number = 0): string {
    const pos = this.state.pos + offset;
    if (pos >= this.length) {
      return '';
    }
    return this.input[pos] ?? '';
  }

  /**
   * 前进一个位置
   */
  private advance(): void {
    if (this.state.pos < this.length) {
      const char = this.input[this.state.pos];
      this.state.pos++;

      if (char === '\n') {
        this.state.line++;
        this.state.column = 0;
      } else {
        this.state.column++;
      }
    }
  }

  /**
   * 判断是否为字母
   */
  private isLetter(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
  }

  /**
   * 创建 Token
   */
  private createToken(type: TokenTypeValue, value: string, from: number, to: number): Token {
    return {
      type,
      value,
      from,
      to,
      line: this.state.line,
      column: this.state.column,
    };
  }

  /**
   * 创建 Token 并前进
   */
  private createTokenAndAdvance(type: TokenTypeValue, value: string, start: number): Token {
    this.advance();
    return this.createToken(type, value, start, this.state.pos);
  }

  // ================================
  // 状态访问器
  // ================================

  /**
   * 获取当前位置
   */
  getPosition(): number {
    return this.state.pos;
  }

  /**
   * 获取当前行号
   */
  getLine(): number {
    return this.state.line;
  }

  /**
   * 获取当前列号
   */
  getColumn(): number {
    return this.state.column;
  }

  /**
   * 获取当前状态的副本
   */
  getState(): TokenizerState {
    return { ...this.state, envStack: [...this.state.envStack] };
  }

  /**
   * 设置状态
   */
  setState(state: TokenizerState): void {
    this.state = { ...state, envStack: [...state.envStack] };
  }

  /**
   * 是否到达末尾
   */
  isAtEnd(): boolean {
    return this.state.pos >= this.length;
  }

  /**
   * 是否在数学模式中
   */
  isInMathMode(): boolean {
    return this.state.inMathMode;
  }

  /**
   * 是否在原样输出模式中
   */
  isInVerbatim(): boolean {
    return this.state.inVerbatim;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 LaTeX Tokenizer
 */
export function createLatexTokenizer(input: string): LatexTokenizer {
  return new LatexTokenizer(input);
}

/**
 * 快速 tokenize LaTeX 源码
 */
export function tokenizeLatex(input: string): Token[] {
  const tokenizer = new LatexTokenizer(input);
  return tokenizer.tokenizeAll();
}
