// ================================
// Lezer LaTeX Tokenizer（词法分析器）
//
// 手写的 LaTeX 词法分析器，用于增量解析
// 将输入文本分解为 Token 流
// ================================

import { SPECIAL_CHARS, MATH_ENVIRONMENTS, VERBATIM_ENVIRONMENTS } from './types';

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
  /** 行号 */
  line: number;
  /** 列号 */
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
  /** 环境栈 */
  envStack: string[];
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
      envStack: [],
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
   * 从指定位置开始重新 tokenize
   * @param fromPos 起始位置
   * @param newInput 新的输入文本
   */
  retokenizeFrom(fromPos: number, newInput: string): void {
    this.input = newInput;
    this.length = newInput.length;

    // 找到 fromPos 之前最近的有效状态
    const cacheIndex = this.findCacheIndexForPosition(fromPos);
    if (cacheIndex > 0) {
      // 从缓存中恢复状态
      this.tokenCache = this.tokenCache.slice(0, cacheIndex);
      const lastToken = this.tokenCache[cacheIndex - 1];
      if (lastToken) {
        this.state.pos = lastToken.to;
        this.state.line = lastToken.line;
        this.state.column = lastToken.column + lastToken.value.length;
      }
    } else {
      // 从头开始
      this.state = this.createInitialState();
      this.tokenCache = [];
    }

    // 重建位置索引
    this.rebuildPositionIndex();
  }

  /**
   * 查找指定位置对应的缓存索引
   */
  private findCacheIndexForPosition(pos: number): number {
    for (let i = this.tokenCache.length - 1; i >= 0; i--) {
      const token = this.tokenCache[i];
      if (token && token.to <= pos) {
        return i + 1;
      }
    }
    return 0;
  }

  /**
   * 重建位置索引
   */
  private rebuildPositionIndex(): void {
    this.tokenPositionIndex.clear();
    for (let i = 0; i < this.tokenCache.length; i++) {
      const token = this.tokenCache[i];
      if (token) {
        this.tokenPositionIndex.set(token.from, i);
      }
    }
  }

  /**
   * 获取下一个 Token
   */
  nextToken(): Token {
    // 跳过并处理空白（根据上下文）
    this.skipWhitespaceIfNeeded();

    // 检查是否到达末尾
    if (this.state.pos >= this.length) {
      return this.createToken(TokenType.EOF, '', this.state.pos, this.state.pos);
    }

    // 原样输出模式
    if (this.state.inVerbatim) {
      return this.tokenizeVerbatim();
    }

    // 数学模式
    if (this.state.inMathMode) {
      return this.tokenizeMathMode();
    }

    // 正常模式
    return this.tokenizeNormalMode();
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
   * 根据需要跳过空白
   */
  private skipWhitespaceIfNeeded(): void {
    // 在某些上下文中不跳过空白
    // 这里的实现保留空白作为单独的 Token
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

    // 检查是否是数学模式分隔符
    if (nextChar === '(') {
      this.advance();
      this.state.inMathMode = true;
      this.state.mathModeType = 'inline';
      this.state.mathDelimiter = '\\(';
      return this.createToken(TokenType.MathParenOpen, '\\(', start, this.state.pos);
    }

    if (nextChar === ')') {
      this.advance();
      this.state.inMathMode = false;
      this.state.mathModeType = null;
      this.state.mathDelimiter = null;
      return this.createToken(TokenType.MathParenClose, '\\)', start, this.state.pos);
    }

    if (nextChar === '[') {
      this.advance();
      this.state.inMathMode = true;
      this.state.mathModeType = 'display';
      this.state.mathDelimiter = '\\[';
      return this.createToken(TokenType.MathBracketOpen, '\\[', start, this.state.pos);
    }

    if (nextChar === ']') {
      this.advance();
      this.state.inMathMode = false;
      this.state.mathModeType = null;
      this.state.mathDelimiter = null;
      return this.createToken(TokenType.MathBracketClose, '\\]', start, this.state.pos);
    }

    // 检查是否是特殊字符转义
    if (SPECIAL_CHARS.has(nextChar)) {
      this.advance();
      return this.createToken(TokenType.CommandName, nextChar, start, this.state.pos);
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

    // 读取命令名称
    const commandName = this.readCommandName();
    if (commandName === '') {
      // 空命令名，返回错误
      return this.createToken(TokenType.Error, '\\', start, this.state.pos);
    }

    // 检查是否是 begin/end
    if (commandName === 'begin') {
      return this.createToken(TokenType.BeginEnv, '\\begin', start, this.state.pos);
    }

    if (commandName === 'end') {
      return this.createToken(TokenType.EndEnv, '\\end', start, this.state.pos);
    }

    return this.createToken(TokenType.CommandName, commandName, start, this.state.pos);
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

      if (this.state.inMathMode && this.state.mathDelimiter === '$$') {
        this.state.inMathMode = false;
        this.state.mathModeType = null;
        this.state.mathDelimiter = null;
        return this.createToken(TokenType.MathDisplayClose, '$$', start, this.state.pos);
      } else {
        this.state.inMathMode = true;
        this.state.mathModeType = 'display';
        this.state.mathDelimiter = '$$';
        return this.createToken(TokenType.MathDisplayOpen, '$$', start, this.state.pos);
      }
    }

    // 单个 $（inline math）
    this.advance();

    if (this.state.inMathMode && this.state.mathDelimiter === '$') {
      this.state.inMathMode = false;
      this.state.mathModeType = null;
      this.state.mathDelimiter = null;
      return this.createToken(TokenType.MathInlineClose, '$', start, this.state.pos);
    } else {
      this.state.inMathMode = true;
      this.state.mathModeType = 'inline';
      this.state.mathDelimiter = '$';
      return this.createToken(TokenType.MathInlineOpen, '$', start, this.state.pos);
    }
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

    this.state.line += newlineCount;
    this.state.column = 0;

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
      this.state.inMathMode = false;
      this.state.mathModeType = null;
      this.state.mathDelimiter = null;
      return this.createToken(TokenType.MathInlineClose, '$', start, this.state.pos);
    }

    if (this.state.mathDelimiter === '$$' && char === '$' && this.peek(1) === '$') {
      this.advance();
      this.advance();
      this.state.inMathMode = false;
      this.state.mathModeType = null;
      this.state.mathDelimiter = null;
      return this.createToken(TokenType.MathDisplayClose, '$$', start, this.state.pos);
    }

    if (char === '\\') {
      const nextChar = this.peek(1);
      if (this.state.mathDelimiter === '\\(' && nextChar === ')') {
        this.advance();
        this.advance();
        this.state.inMathMode = false;
        this.state.mathModeType = null;
        this.state.mathDelimiter = null;
        return this.createToken(TokenType.MathParenClose, '\\)', start, this.state.pos);
      }
      if (this.state.mathDelimiter === '\\[' && nextChar === ']') {
        this.advance();
        this.advance();
        this.state.inMathMode = false;
        this.state.mathModeType = null;
        this.state.mathDelimiter = null;
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
      case '\r':
        return this.tokenizeNewline();

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

    // 读取到结束标记之前
    this.state.pos = endIndex;

    // 退出原样输出模式
    this.state.inVerbatim = false;
    this.state.verbatimEnvName = null;

    return this.createToken(TokenType.Text, this.input.slice(start, endIndex), start, endIndex);
  }

  /**
   * 进入原样输出模式
   */
  enterVerbatimMode(envName: string): void {
    if (VERBATIM_ENVIRONMENTS.includes(envName as never)) {
      this.state.inVerbatim = true;
      this.state.verbatimEnvName = envName;
    }
  }

  /**
   * 进入数学环境模式
   */
  enterMathEnvironment(envName: string): void {
    if (MATH_ENVIRONMENTS.includes(envName as never)) {
      this.state.inMathMode = true;
      this.state.mathModeType = 'environment';
      this.state.mathDelimiter = envName;
    }
  }

  /**
   * 退出数学环境模式
   */
  exitMathEnvironment(envName: string): void {
    if (this.state.mathModeType === 'environment' && this.state.mathDelimiter === envName) {
      this.state.inMathMode = false;
      this.state.mathModeType = null;
      this.state.mathDelimiter = null;
    }
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
