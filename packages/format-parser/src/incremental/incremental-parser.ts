// ================================
// 高性能增量内容解析器
// 基于 FSM（有限状态机）实现
// 支持超大文件的流式增量解析
// ================================

// ================================
// 类型定义
// ================================

/** 解析器状态 */
export const enum ParserState {
  /** 初始/正常文本状态 */
  Text = 0,
  /** 可能是特殊语法的开始 */
  MaybeSpecial = 1,
  /** 标题状态 (# 开头) */
  Heading = 2,
  /** 代码围栏开始 (`) */
  CodeFenceStart = 3,
  /** 代码围栏语言标识 */
  CodeFenceLanguage = 4,
  /** 代码块内容 */
  CodeBlock = 5,
  /** 代码围栏结束 */
  CodeFenceEnd = 6,
  /** 行内代码 */
  InlineCode = 7,
  /** 粗体/斜体标记 */
  Emphasis = 8,
  /** 链接/图片开始 */
  LinkStart = 9,
  /** 链接文本 */
  LinkText = 10,
  /** 链接 URL */
  LinkUrl = 11,
  /** 引用块 */
  Blockquote = 12,
  /** 列表项 */
  ListItem = 13,
  /** 水平分隔线 */
  HorizontalRule = 14,
  /** HTML 标签 */
  HtmlTag = 15,
  /** 转义字符 */
  Escape = 16,
}

/** Token 类型 */
export const enum TokenType {
  Text = 'text',
  Heading = 'heading',
  CodeBlock = 'code_block',
  InlineCode = 'inline_code',
  Bold = 'bold',
  Italic = 'italic',
  BoldItalic = 'bold_italic',
  Strikethrough = 'strikethrough',
  Link = 'link',
  Image = 'image',
  Blockquote = 'blockquote',
  UnorderedList = 'unordered_list',
  OrderedList = 'ordered_list',
  ListItem = 'list_item',
  HorizontalRule = 'horizontal_rule',
  HtmlTag = 'html_tag',
  Paragraph = 'paragraph',
  LineBreak = 'line_break',
  Newline = 'newline',
}

/** 解析后的 Token */
export interface Token {
  /** Token 类型 */
  type: TokenType;
  /** 原始文本内容 */
  raw: string;
  /** 解析后的内容（不含标记） */
  content: string;
  /** 起始位置（字符偏移） */
  start: number;
  /** 结束位置（字符偏移） */
  end: number;
  /** 起始行号（1-based） */
  startLine: number;
  /** 起始列号（1-based） */
  startColumn: number;
  /** 结束行号 */
  endLine: number;
  /** 结束列号 */
  endColumn: number;
  /** Token 特定属性 */
  attributes: Record<string, unknown>;
  /** 子 Token（用于嵌套结构） */
  children?: Token[];
}

/** 解析结果 */
export interface ParseResult {
  /** 解析出的 Token 列表 */
  tokens: Token[];
  /** 解析是否完成 */
  complete: boolean;
  /** 已处理的字符数 */
  processed: number;
  /** 解析耗时（毫秒） */
  duration: number;
  /** 错误信息（如有） */
  errors: ParseError[];
}

/** 解析错误 */
export interface ParseError {
  message: string;
  line: number;
  column: number;
  offset: number;
}

/** 解析器配置 */
export interface ParserConfig {
  /** 是否启用 GFM（GitHub Flavored Markdown） */
  gfm?: boolean;
  /** 是否解析 HTML 标签 */
  html?: boolean;
  /** 是否解析数学公式 */
  math?: boolean;
  /** 是否启用智能标点 */
  smartPunctuation?: boolean;
  /** 增量解析的块大小（字符数） */
  chunkSize?: number;
  /** 最大嵌套深度 */
  maxNestingDepth?: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: Required<ParserConfig> = {
  gfm: true,
  html: true,
  math: false,
  smartPunctuation: false,
  chunkSize: 65536, // 64KB
  maxNestingDepth: 100,
};

/** 解析器上下文 */
interface ParserContext {
  /** 当前状态 */
  state: ParserState;
  /** 状态栈（用于嵌套） */
  stateStack: ParserState[];
  /** 当前位置（字符偏移） */
  position: number;
  /** 当前行号 */
  line: number;
  /** 当前列号 */
  column: number;
  /** 当前 Token 起始位置 */
  tokenStart: number;
  /** 当前 Token 起始行 */
  tokenStartLine: number;
  /** 当前 Token 起始列 */
  tokenStartColumn: number;
  /** 累积的内容缓冲 */
  buffer: string;
  /** 属性缓冲 */
  attributes: Record<string, unknown>;
  /** 嵌套深度 */
  nestingDepth: number;
  /** 代码围栏字符数 */
  fenceCount: number;
  /** 代码围栏字符 */
  fenceChar: string;
  /** 强调标记字符 */
  emphasisChar: string;
  /** 强调标记数量 */
  emphasisCount: number;
}

// ================================
// 字符常量
// ================================

const CHAR_NEWLINE = 10; // \n
const CHAR_CARRIAGE_RETURN = 13; // \r
const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_HASH = 35; // #
const CHAR_BACKTICK = 96; // `
const CHAR_ASTERISK = 42; // *
const CHAR_UNDERSCORE = 95; // _
const CHAR_TILDE = 126; // ~
const CHAR_GREATER_THAN = 62; // >
const CHAR_HYPHEN = 45; // -
const CHAR_PLUS = 43; // +

// 以下常量保留用于未来扩展（链接、图片、HTML、转义等解析）
// const CHAR_BRACKET_OPEN = 91; // [
// const CHAR_BRACKET_CLOSE = 93; // ]
// const CHAR_PAREN_OPEN = 40; // (
// const CHAR_PAREN_CLOSE = 41; // )
// const CHAR_EXCLAMATION = 33; // !
// const CHAR_LESS_THAN = 60; // <
// const CHAR_BACKSLASH = 92; // \
// const CHAR_DOLLAR = 36; // $

// ================================
// 工具函数
// ================================

/**
 * 判断是否为空白字符
 */
function isWhitespace(charCode: number): boolean {
  return (
    charCode === CHAR_SPACE ||
    charCode === CHAR_TAB ||
    charCode === CHAR_NEWLINE ||
    charCode === CHAR_CARRIAGE_RETURN
  );
}

/**
 * 判断是否为行尾
 */
function isLineEnd(charCode: number): boolean {
  return charCode === CHAR_NEWLINE || charCode === CHAR_CARRIAGE_RETURN;
}

/**
 * 判断是否为数字
 */
function isDigit(charCode: number): boolean {
  return charCode >= 48 && charCode <= 57;
}

// isAlpha 和 isAlphaNumeric 保留用于未来扩展（HTML 标签解析等）
// function isAlpha(charCode: number): boolean {
//   return (charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122);
// }

// isAlphaNumeric 保留用于未来扩展
// function isAlphaNumeric(charCode: number): boolean {
//   return isAlpha(charCode) || isDigit(charCode);
// }

// ================================
// IncrementalParser 类
// ================================

export class IncrementalParser {
  private _config: Required<ParserConfig>;
  private context: ParserContext;
  private tokens: Token[] = [];
  private errors: ParseError[] = [];
  private pendingInput: string = '';
  private isComplete: boolean = false;

  constructor(config?: ParserConfig) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this.context = this.createInitialContext();
  }

  /**
   * 获取当前配置
   */
  get config(): Required<ParserConfig> {
    return this._config;
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 创建初始上下文
   */
  private createInitialContext(): ParserContext {
    return {
      state: ParserState.Text,
      stateStack: [],
      position: 0,
      line: 1,
      column: 1,
      tokenStart: 0,
      tokenStartLine: 1,
      tokenStartColumn: 1,
      buffer: '',
      attributes: {},
      nestingDepth: 0,
      fenceCount: 0,
      fenceChar: '',
      emphasisChar: '',
      emphasisCount: 0,
    };
  }

  // pushState 和 popState 保留用于未来嵌套结构解析
  // /**
  //  * 推入状态栈
  //  */
  // private pushState(newState: ParserState): void {
  //   this.context.stateStack.push(this.context.state);
  //   this.context.state = newState;
  //   this.context.nestingDepth++;
  // }

  // /**
  //  * 弹出状态栈
  //  */
  // private popState(): void {
  //   if (this.context.stateStack.length > 0) {
  //     this.context.state = this.context.stateStack.pop()!;
  //     this.context.nestingDepth--;
  //   } else {
  //     this.context.state = ParserState.Text;
  //   }
  // }

  /**
   * 开始新 Token
   */
  private startToken(): void {
    this.context.tokenStart = this.context.position;
    this.context.tokenStartLine = this.context.line;
    this.context.tokenStartColumn = this.context.column;
    this.context.buffer = '';
    this.context.attributes = {};
  }

  /**
   * 完成当前 Token
   */
  private finishToken(type: TokenType, raw: string): Token {
    const token: Token = {
      type,
      raw,
      content: this.context.buffer,
      start: this.context.tokenStart,
      end: this.context.position,
      startLine: this.context.tokenStartLine,
      startColumn: this.context.tokenStartColumn,
      endLine: this.context.line,
      endColumn: this.context.column,
      attributes: { ...this.context.attributes },
    };

    this.context.buffer = '';
    this.context.attributes = {};

    return token;
  }

  // addError 保留用于未来错误处理
  // /**
  //  * 添加错误
  //  */
  // private addError(message: string): void {
  //   this.errors.push({
  //     message,
  //     line: this.context.line,
  //     column: this.context.column,
  //     offset: this.context.position,
  //   });
  // }

  /**
   * 前进一个字符
   */
  private advance(input: string): void {
    const charCode = input.charCodeAt(this.context.position);

    if (charCode === CHAR_NEWLINE) {
      this.context.line++;
      this.context.column = 1;
    } else if (charCode === CHAR_CARRIAGE_RETURN) {
      // CR - 检查是否后跟 LF
      const nextPos = this.context.position + 1;
      if (nextPos < input.length && input.charCodeAt(nextPos) === CHAR_NEWLINE) {
        // CRLF - 在 LF 处处理换行
      } else {
        this.context.line++;
        this.context.column = 1;
      }
    } else {
      this.context.column++;
    }

    this.context.position++;
  }

  /**
   * 查看当前字符
   */
  private peek(input: string, offset: number = 0): number {
    const pos = this.context.position + offset;
    if (pos >= input.length) return -1;
    return input.charCodeAt(pos);
  }

  /**
   * 检查是否在行首
   */
  private isAtLineStart(): boolean {
    return this.context.column === 1;
  }

  /**
   * 消费空白字符
   */
  private consumeWhitespace(input: string): number {
    let count = 0;
    while (this.context.position < input.length) {
      const char = this.peek(input);
      if (char === CHAR_SPACE || char === CHAR_TAB) {
        this.advance(input);
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * 解析标题
   */
  private parseHeading(input: string): Token | null {
    const startPos = this.context.position;
    let level = 0;

    // 计算 # 数量
    while (this.peek(input) === CHAR_HASH && level < 6) {
      this.advance(input);
      level++;
    }

    // 检查是否后跟空格或行尾
    const nextChar = this.peek(input);
    if (level > 0 && level <= 6 && (isWhitespace(nextChar) || nextChar === -1)) {
      // 跳过空格
      this.consumeWhitespace(input);

      // 读取标题内容直到行尾
      const contentStart = this.context.position;
      while (this.context.position < input.length && !isLineEnd(this.peek(input))) {
        this.advance(input);
      }

      const content = input.slice(contentStart, this.context.position);
      const raw = input.slice(startPos, this.context.position);

      this.context.attributes = { level };
      this.context.buffer = content.trim();

      return this.finishToken(TokenType.Heading, raw);
    }

    // 不是有效标题，回退
    this.context.position = startPos;
    return null;
  }

  /**
   * 解析代码围栏
   */
  private parseCodeFence(input: string): Token | null {
    const startPos = this.context.position;
    const startLine = this.context.line;
    const startColumn = this.context.column;
    const fenceChar = input.charAt(this.context.position);
    let fenceCount = 0;

    // 计算围栏字符数
    while (this.peek(input) === fenceChar.charCodeAt(0)) {
      this.advance(input);
      fenceCount++;
    }

    // 至少需要 3 个
    if (fenceCount < 3) {
      this.context.position = startPos;
      return null;
    }

    // 读取语言标识（直到行尾）
    const langStart = this.context.position;
    while (this.context.position < input.length && !isLineEnd(this.peek(input))) {
      this.advance(input);
    }
    const language = input.slice(langStart, this.context.position).trim();

    // 跳过换行
    if (this.peek(input) === CHAR_CARRIAGE_RETURN) this.advance(input);
    if (this.peek(input) === CHAR_NEWLINE) this.advance(input);

    // 读取代码内容
    const codeStart = this.context.position;
    let codeEnd = codeStart;
    let foundEnd = false;

    while (this.context.position < input.length) {
      // 检查是否是结束围栏
      if (this.isAtLineStart()) {
        let endFenceCount = 0;
        const checkPos = this.context.position;

        while (
          this.context.position < input.length &&
          input.charCodeAt(this.context.position) === fenceChar.charCodeAt(0)
        ) {
          endFenceCount++;
          this.context.position++;
          this.context.column++;
        }

        if (endFenceCount >= fenceCount) {
          // 找到结束围栏
          codeEnd = checkPos;
          foundEnd = true;

          // 跳到行尾
          while (this.context.position < input.length && !isLineEnd(this.peek(input))) {
            this.advance(input);
          }
          break;
        }
      }

      codeEnd = this.context.position;
      this.advance(input);
    }

    // 提取代码内容
    let codeContent = input.slice(codeStart, codeEnd);
    // 移除末尾的换行符
    if (codeContent.endsWith('\n')) {
      codeContent = codeContent.slice(0, -1);
    }
    if (codeContent.endsWith('\r')) {
      codeContent = codeContent.slice(0, -1);
    }

    const raw = input.slice(startPos, this.context.position);

    this.context.tokenStart = startPos;
    this.context.tokenStartLine = startLine;
    this.context.tokenStartColumn = startColumn;
    this.context.buffer = codeContent;
    this.context.attributes = {
      language,
      fenceChar,
      fenceCount,
      complete: foundEnd,
    };

    return this.finishToken(TokenType.CodeBlock, raw);
  }

  /**
   * 解析引用块
   */
  private parseBlockquote(input: string): Token | null {
    if (this.peek(input) !== CHAR_GREATER_THAN) return null;

    const startPos = this.context.position;
    this.advance(input);

    // 跳过可选空格
    if (this.peek(input) === CHAR_SPACE) {
      this.advance(input);
    }

    // 读取内容直到行尾
    const contentStart = this.context.position;
    while (this.context.position < input.length && !isLineEnd(this.peek(input))) {
      this.advance(input);
    }

    const content = input.slice(contentStart, this.context.position);
    const raw = input.slice(startPos, this.context.position);

    this.context.tokenStart = startPos;
    this.context.buffer = content;

    return this.finishToken(TokenType.Blockquote, raw);
  }

  /**
   * 解析列表项
   */
  private parseListItem(input: string): Token | null {
    const startPos = this.context.position;
    const char = this.peek(input);

    let isOrdered = false;
    let marker = '';

    // 无序列表：- * +
    if (char === CHAR_HYPHEN || char === CHAR_ASTERISK || char === CHAR_PLUS) {
      marker = String.fromCharCode(char);
      this.advance(input);
    }
    // 有序列表：1. 2. 等
    else if (isDigit(char)) {
      while (this.context.position < input.length && isDigit(this.peek(input))) {
        marker += String.fromCharCode(this.peek(input));
        this.advance(input);
      }

      if (this.peek(input) === 46) {
        // .
        marker += '.';
        this.advance(input);
        isOrdered = true;
      } else {
        // 不是有效的有序列表
        this.context.position = startPos;
        return null;
      }
    } else {
      return null;
    }

    // 必须后跟空格
    if (this.peek(input) !== CHAR_SPACE && this.peek(input) !== CHAR_TAB) {
      this.context.position = startPos;
      return null;
    }

    this.consumeWhitespace(input);

    // 读取内容直到行尾
    const contentStart = this.context.position;
    while (this.context.position < input.length && !isLineEnd(this.peek(input))) {
      this.advance(input);
    }

    const content = input.slice(contentStart, this.context.position);
    const raw = input.slice(startPos, this.context.position);

    this.context.tokenStart = startPos;
    this.context.buffer = content;
    this.context.attributes = {
      marker,
      ordered: isOrdered,
    };

    return this.finishToken(TokenType.ListItem, raw);
  }

  /**
   * 解析水平分隔线
   */
  private parseHorizontalRule(input: string): Token | null {
    const startPos = this.context.position;
    const char = this.peek(input);

    // 必须是 - * _
    if (char !== CHAR_HYPHEN && char !== CHAR_ASTERISK && char !== CHAR_UNDERSCORE) {
      return null;
    }

    let count = 0;
    const ruleChar = char;

    while (this.context.position < input.length && !isLineEnd(this.peek(input))) {
      const c = this.peek(input);
      if (c === ruleChar) {
        count++;
        this.advance(input);
      } else if (c === CHAR_SPACE || c === CHAR_TAB) {
        this.advance(input);
      } else {
        // 包含其他字符，不是分隔线
        this.context.position = startPos;
        return null;
      }
    }

    if (count >= 3) {
      const raw = input.slice(startPos, this.context.position);
      this.context.tokenStart = startPos;
      this.context.buffer = '';

      return this.finishToken(TokenType.HorizontalRule, raw);
    }

    this.context.position = startPos;
    return null;
  }

  /**
   * 解析行内代码
   */
  private parseInlineCode(input: string): Token | null {
    if (this.peek(input) !== CHAR_BACKTICK) return null;

    const startPos = this.context.position;
    let backtickCount = 0;

    // 计算开始的反引号数量
    while (this.peek(input) === CHAR_BACKTICK) {
      backtickCount++;
      this.advance(input);
    }

    const contentStart = this.context.position;

    // 寻找匹配的结束反引号
    while (this.context.position < input.length) {
      if (this.peek(input) === CHAR_BACKTICK) {
        let endCount = 0;
        const endPos = this.context.position;

        while (this.peek(input) === CHAR_BACKTICK) {
          endCount++;
          this.advance(input);
        }

        if (endCount === backtickCount) {
          // 找到匹配的结束
          const content = input.slice(contentStart, endPos);
          const raw = input.slice(startPos, this.context.position);

          this.context.tokenStart = startPos;
          this.context.buffer = content;

          return this.finishToken(TokenType.InlineCode, raw);
        }
      } else if (isLineEnd(this.peek(input))) {
        // 行内代码不能跨行
        break;
      } else {
        this.advance(input);
      }
    }

    // 没有找到结束，回退
    this.context.position = startPos;
    return null;
  }

  /**
   * 解析一行
   */
  private parseLine(input: string): Token[] {
    const lineTokens: Token[] = [];

    // 检查行首特殊语法
    if (this.isAtLineStart()) {
      const wsCount = this.consumeWhitespace(input);

      // 代码块（缩进 4 空格或 1 tab）
      if (wsCount >= 4) {
        // 处理缩进代码块
        const contentStart = this.context.position;
        while (this.context.position < input.length && !isLineEnd(this.peek(input))) {
          this.advance(input);
        }

        const content = input.slice(contentStart, this.context.position);
        this.startToken();
        this.context.buffer = content;

        // 这里简化处理，标记为文本
        // 完整实现需要收集连续缩进行
      }

      const char = this.peek(input);

      // 标题
      if (char === CHAR_HASH) {
        const heading = this.parseHeading(input);
        if (heading) {
          lineTokens.push(heading);
          return lineTokens;
        }
      }

      // 代码围栏
      if (char === CHAR_BACKTICK || char === CHAR_TILDE) {
        const fence = this.parseCodeFence(input);
        if (fence) {
          lineTokens.push(fence);
          return lineTokens;
        }
      }

      // 引用块
      if (char === CHAR_GREATER_THAN) {
        const quote = this.parseBlockquote(input);
        if (quote) {
          lineTokens.push(quote);
          return lineTokens;
        }
      }

      // 水平分隔线
      if (char === CHAR_HYPHEN || char === CHAR_ASTERISK || char === CHAR_UNDERSCORE) {
        const hr = this.parseHorizontalRule(input);
        if (hr) {
          lineTokens.push(hr);
          return lineTokens;
        }
      }

      // 列表项
      if (char === CHAR_HYPHEN || char === CHAR_ASTERISK || char === CHAR_PLUS || isDigit(char)) {
        const listItem = this.parseListItem(input);
        if (listItem) {
          lineTokens.push(listItem);
          return lineTokens;
        }
      }
    }

    // 解析普通段落/行内元素
    this.startToken();
    const lineStart = this.context.position;

    while (this.context.position < input.length && !isLineEnd(this.peek(input))) {
      const char = this.peek(input);

      // 行内代码
      if (char === CHAR_BACKTICK) {
        // 先保存当前缓冲的文本
        if (this.context.buffer.length > 0) {
          const textToken = this.finishToken(
            TokenType.Text,
            input.slice(this.context.tokenStart, this.context.position)
          );
          lineTokens.push(textToken);
          this.startToken();
        }

        const code = this.parseInlineCode(input);
        if (code) {
          lineTokens.push(code);
          this.startToken();
          continue;
        }
      }

      // 累积普通文本
      this.context.buffer += String.fromCharCode(char);
      this.advance(input);
    }

    // 完成剩余文本
    if (this.context.buffer.length > 0) {
      const textToken = this.finishToken(
        TokenType.Text,
        input.slice(lineStart, this.context.position)
      );
      lineTokens.push(textToken);
    }

    return lineTokens;
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 增量解析输入
   * @param chunk 输入文本块
   * @param isLast 是否为最后一块
   */
  parse(chunk: string, isLast: boolean = true): ParseResult {
    const startTime = performance.now();

    // 合并待处理的输入
    const input = this.pendingInput + chunk;
    this.pendingInput = '';

    // 解析所有完整的行
    while (this.context.position < input.length) {
      const lineTokens = this.parseLine(input);
      this.tokens.push(...lineTokens);

      // 处理换行
      if (this.context.position < input.length) {
        if (this.peek(input) === CHAR_CARRIAGE_RETURN) this.advance(input);
        if (this.peek(input) === CHAR_NEWLINE) {
          this.advance(input);

          // 添加换行 Token
          this.tokens.push({
            type: TokenType.Newline,
            raw: '\n',
            content: '\n',
            start: this.context.position - 1,
            end: this.context.position,
            startLine: this.context.line - 1,
            startColumn: this.context.column,
            endLine: this.context.line,
            endColumn: 1,
            attributes: {},
          });
        }
      }
    }

    // 如果不是最后一块，保存未完成的部分
    if (!isLast) {
      // 找到最后一个完整行的位置
      const lastNewline = input.lastIndexOf('\n');
      if (lastNewline !== -1 && lastNewline < input.length - 1) {
        this.pendingInput = input.slice(lastNewline + 1);
      }
    }

    this.isComplete = isLast;

    const duration = performance.now() - startTime;

    return {
      tokens: this.tokens,
      complete: this.isComplete,
      processed: this.context.position,
      duration,
      errors: this.errors,
    };
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.context = this.createInitialContext();
    this.tokens = [];
    this.errors = [];
    this.pendingInput = '';
    this.isComplete = false;
  }

  /**
   * 获取当前解析状态
   */
  getState(): {
    position: number;
    line: number;
    column: number;
    tokenCount: number;
    isComplete: boolean;
  } {
    return {
      position: this.context.position,
      line: this.context.line,
      column: this.context.column,
      tokenCount: this.tokens.length,
      isComplete: this.isComplete,
    };
  }

  /**
   * 获取所有 Token
   */
  getTokens(): Token[] {
    return this.tokens;
  }

  /**
   * 获取解析错误
   */
  getErrors(): ParseError[] {
    return this.errors;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建增量解析器实例
 */
export function createIncrementalParser(config?: ParserConfig): IncrementalParser {
  return new IncrementalParser(config);
}

// ================================
// 便捷函数
// ================================

/**
 * 一次性解析完整文本
 */
export function parseMarkdown(text: string, config?: ParserConfig): ParseResult {
  const parser = createIncrementalParser(config);
  return parser.parse(text, true);
}

/**
 * 流式解析（用于大文件）
 */
export async function parseMarkdownStream(
  stream: AsyncIterable<string>,
  config?: ParserConfig,
  onProgress?: (result: ParseResult) => void
): Promise<ParseResult> {
  const parser = createIncrementalParser(config);
  let lastResult: ParseResult | null = null;

  for await (const chunk of stream) {
    lastResult = parser.parse(chunk, false);
    if (onProgress) {
      onProgress(lastResult);
    }
  }

  // 完成解析
  lastResult = parser.parse('', true);

  return lastResult!;
}

// ================================
// 导出
// ================================

export default IncrementalParser;
