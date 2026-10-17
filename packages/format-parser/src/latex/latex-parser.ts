// ================================
// @code-reader/parser - LaTeX 解析器
// 完整的 LaTeX 文档解析器实现
// ================================

import {
  type LaTeXParserOptions,
  type LaTeXParseResult,
  type ParseWarning,
  type Position,
  type DocumentNode,
  type DocumentClass,
  type PreambleItem,
  type DocumentMetadata,
  type LaTeXBlockNode,
  type LaTeXInlineNode,
  type ParagraphNode,
  type SectionNode,
  type EnvironmentNode,
  type MathBlockNode,
  type CodeBlockNode,
  type ListNode,
  type ListItemNode,
  type TableNode,
  type TableRowNode,
  type TableCellNode,
  type FigureNode,
  type QuoteNode,
  type TheoremNode,
  type CommentNode,
  type TextNode,
  type MathInlineNode,
  type BoldNode,
  type ItalicNode,
  type MonospaceNode,
  type CitationNode,
  type ReferenceNode,
  type LabelNode,
  type HyperlinkNode,
  type CommandNode,
  type SpecialCharNode,
  type GroupNode,
  type CrossReferenceEntry,
  type CrossReferenceIndex,
  LaTeXBlockType,
  LaTeXInlineType,
  DEFAULT_LATEX_OPTIONS,
} from './types';

// ================================
// 常量定义
// ================================

/** 特殊字符转义映射 */
const SPECIAL_CHAR_MAP: Record<string, string> = {
  '\\$': '$',
  '\\%': '%',
  '\\&': '&',
  '\\#': '#',
  '\\_': '_',
  '\\{': '{',
  '\\}': '}',
  '\\~': '~',
  '\\^': '^',
  '\\\\': '\n',
  '\\textbackslash': '\\',
  '\\textasciitilde': '~',
  '\\textasciicircum': '^',
  '\\textless': '<',
  '\\textgreater': '>',
  '\\textbar': '|',
  '\\LaTeX': 'LaTeX',
  '\\TeX': 'TeX',
  '\\ldots': '…',
  '\\dots': '…',
  '\\cdots': '⋯',
  '\\vdots': '⋮',
  '\\ddots': '⋱',
  '\\quad': '  ',
  '\\qquad': '    ',
  '\\,': ' ',
  '\\;': ' ',
  '\\!': '',
  '\\ ': ' ',
  '\\@': '',
  '---': '—',
  '--': '–',
  "``": '\u201C',
  "''": '\u201D',
  '`': '\u2018',
  "'": '\u2019',
};

/** 章节命令及其级别 */
const SECTION_COMMANDS: Record<string, number> = {
  part: -1,
  chapter: 0,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};

/** 文本格式命令 */
const TEXT_FORMAT_COMMANDS = new Set([
  'textbf',
  'textit',
  'texttt',
  'textsc',
  'textsf',
  'textrm',
  'textsl',
  'textup',
  'emph',
  'underline',
  'bfseries',
  'itshape',
  'ttfamily',
  'scshape',
  'sffamily',
  'rmfamily',
  'slshape',
  'upshape',
  'bf',
  'it',
  'tt',
  'sc',
  'sf',
  'rm',
  'sl',
]);

/** 引用命令 */
const CITATION_COMMANDS = new Set([
  'cite',
  'citep',
  'citet',
  'citeauthor',
  'citeyear',
  'citealt',
  'citealp',
  'nocite',
  'fullcite',
  'footcite',
  'textcite',
  'parencite',
  'autocite',
]);

/** 交叉引用命令 */
const REFERENCE_COMMANDS = new Set([
  'ref',
  'eqref',
  'pageref',
  'nameref',
  'autoref',
  'cref',
  'Cref',
  'vref',
  'labelcref',
]);

/** 可一次引用多个标签（逗号分隔）的引用命令 */
const MULTI_KEY_REFERENCE_COMMANDS = new Set(['cref', 'Cref', 'labelcref']);

/** 第一个必选参数需要记入交叉引用索引的命令 */
const INDEXED_ARGUMENT_COMMANDS = new Set([
  'bibitem',
  'bibliography',
  'addbibresource',
  'input',
  'include',
  'subfile',
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createCrossReferenceIndex(): CrossReferenceIndex {
  return {
    labels: [],
    references: [],
    citations: [],
    bibItems: [],
    bibliographySources: [],
    includedFiles: [],
  };
}

// ================================
// 词法分析器
// ================================

/** Token 类型 */
const enum TokenType {
  Text = 'text',
  Command = 'command',
  BeginGroup = 'begin_group',
  EndGroup = 'end_group',
  BeginOptional = 'begin_optional',
  EndOptional = 'end_optional',
  MathInline = 'math_inline',
  MathDisplay = 'math_display',
  Comment = 'comment',
  Newline = 'newline',
  Whitespace = 'whitespace',
  EOF = 'eof',
}

/** Token 结构 */
interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  offset: number;
}

/** 词法分析的起点：解析子串（如章节标题）时使 Token 位置仍是整篇文档的绝对位置 */
interface SourceOrigin {
  /** 偏移（从 0 计） */
  offset: number;
  /** 行（从 1 计） */
  line: number;
  /** 列（从 1 计） */
  column: number;
}

const DOCUMENT_ORIGIN: SourceOrigin = { offset: 0, line: 1, column: 1 };

/**
 * LaTeX 词法分析器
 */
class LaTeXLexer {
  private input: string;
  private base: number;
  private pos: number = 0;
  private line: number;
  private column: number;

  constructor(input: string, origin: SourceOrigin = DOCUMENT_ORIGIN) {
    this.input = input;
    this.base = origin.offset;
    this.line = origin.line;
    this.column = origin.column;
  }

  /**
   * 获取下一个 Token
   */
  nextToken(): Token {
    if (this.pos >= this.input.length) {
      return this.createToken(TokenType.EOF, '');
    }

    const char = this.input.charAt(this.pos);

    // 注释
    if (char === '%') {
      return this.readComment();
    }

    // 命令
    if (char === '\\') {
      return this.readCommand();
    }

    // 组开始
    if (char === '{') {
      return this.advance(TokenType.BeginGroup, '{');
    }

    // 组结束
    if (char === '}') {
      return this.advance(TokenType.EndGroup, '}');
    }

    // 可选参数开始
    if (char === '[') {
      return this.advance(TokenType.BeginOptional, '[');
    }

    // 可选参数结束
    if (char === ']') {
      return this.advance(TokenType.EndOptional, ']');
    }

    // 行内数学 $
    if (char === '$') {
      return this.readMath();
    }

    // 换行
    if (char === '\n') {
      return this.readNewline();
    }

    // 空白
    if (this.isWhitespace(char)) {
      return this.readWhitespace();
    }

    // 普通文本
    return this.readText();
  }

  private createToken(type: TokenType, value: string): Token {
    return {
      type,
      value,
      line: this.line,
      column: this.column,
      offset: this.base + this.pos,
    };
  }

  private advance(type: TokenType, value: string): Token {
    const token = this.createToken(type, value);
    this.pos += value.length;
    this.column += value.length;
    return token;
  }

  private isWhitespace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\r';
  }

  private isAlpha(char: string): boolean {
    return /[a-zA-Z]/.test(char);
  }

  private readComment(): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.base + this.pos;

    let value = '';
    while (this.pos < this.input.length && this.input.charAt(this.pos) !== '\n') {
      value += this.input.charAt(this.pos);
      this.pos++;
      this.column++;
    }

    return {
      type: TokenType.Comment,
      value,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }

  private readCommand(): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.base + this.pos;

    let value = '\\';
    this.pos++;
    this.column++;

    // 检查是否是特殊单字符命令
    if (this.pos < this.input.length) {
      const nextChar = this.input.charAt(this.pos);
      if (!this.isAlpha(nextChar)) {
        value += nextChar;
        this.pos++;
        this.column++;
        return {
          type: TokenType.Command,
          value,
          line: startLine,
          column: startColumn,
          offset: startOffset,
        };
      }
    }

    // 读取字母命令
    while (this.pos < this.input.length && this.isAlpha(this.input.charAt(this.pos))) {
      value += this.input.charAt(this.pos);
      this.pos++;
      this.column++;
    }

    return {
      type: TokenType.Command,
      value,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }

  private readMath(): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.base + this.pos;

    // 检查是否是 $$ (display math)
    if (this.pos + 1 < this.input.length && this.input.charAt(this.pos + 1) === '$') {
      this.pos += 2;
      this.column += 2;
      let value = '';

      while (this.pos < this.input.length) {
        if (
          this.input.charAt(this.pos) === '$' &&
          this.pos + 1 < this.input.length &&
          this.input.charAt(this.pos + 1) === '$'
        ) {
          this.pos += 2;
          this.column += 2;
          break;
        }
        if (this.input.charAt(this.pos) === '\n') {
          this.line++;
          this.column = 1;
        } else {
          this.column++;
        }
        value += this.input.charAt(this.pos);
        this.pos++;
      }

      return {
        type: TokenType.MathDisplay,
        value,
        line: startLine,
        column: startColumn,
        offset: startOffset,
      };
    }

    // 行内数学 $...$
    this.pos++;
    this.column++;
    let value = '';

    while (this.pos < this.input.length && this.input.charAt(this.pos) !== '$') {
      // 处理转义的 $
      if (this.input.charAt(this.pos) === '\\' && this.pos + 1 < this.input.length) {
        value += this.input.charAt(this.pos);
        this.pos++;
        this.column++;
        if (this.pos < this.input.length) {
          value += this.input.charAt(this.pos);
          this.pos++;
          this.column++;
        }
        continue;
      }

      if (this.input.charAt(this.pos) === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      value += this.input.charAt(this.pos);
      this.pos++;
    }

    // 跳过结束的 $
    if (this.pos < this.input.length) {
      this.pos++;
      this.column++;
    }

    return {
      type: TokenType.MathInline,
      value,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }

  private readNewline(): Token {
    const token = this.createToken(TokenType.Newline, '\n');
    this.pos++;
    this.line++;
    this.column = 1;
    return token;
  }

  private readWhitespace(): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.base + this.pos;

    let value = '';
    while (this.pos < this.input.length && this.isWhitespace(this.input.charAt(this.pos))) {
      value += this.input.charAt(this.pos);
      this.pos++;
      this.column++;
    }

    return {
      type: TokenType.Whitespace,
      value,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }

  private readText(): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.base + this.pos;

    let value = '';
    while (this.pos < this.input.length) {
      const char = this.input.charAt(this.pos);
      // 遇到特殊字符停止
      if (
        char === '\\' ||
        char === '{' ||
        char === '}' ||
        char === '[' ||
        char === ']' ||
        char === '$' ||
        char === '%' ||
        char === '\n' ||
        this.isWhitespace(char)
      ) {
        break;
      }
      value += char;
      this.pos++;
      this.column++;
    }

    return {
      type: TokenType.Text,
      value,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }
}

// ================================
// LaTeX 解析器
// ================================

/**
 * LaTeX 解析器
 * 将 LaTeX 文档解析为 AST
 */
export class LaTeXParser {
  private options: Required<LaTeXParserOptions>;
  private lexer!: LaTeXLexer;
  private currentToken!: Token;
  private warnings: ParseWarning[] = [];
  private input: string = '';
  /** this.input 在整篇文档中的起始偏移（子串解析时非 0） */
  private baseOffset: number = 0;
  private crossRefs: CrossReferenceIndex = createCrossReferenceIndex();

  constructor(options?: LaTeXParserOptions) {
    this.options = { ...DEFAULT_LATEX_OPTIONS, ...options };
  }

  /**
   * 解析 LaTeX 文档
   */
  parse(input: string): LaTeXParseResult {
    const startTime = performance.now();

    this.reset(input, DOCUMENT_ORIGIN, createCrossReferenceIndex());
    const document = this.parseDocument();
    const duration = performance.now() - startTime;

    return {
      document,
      warnings: this.warnings,
      crossReferences: this.crossRefs,
      duration,
    };
  }

  /**
   * 仅解析行内内容
   */
  parseInline(input: string): LaTeXInlineNode[] {
    this.reset(input, DOCUMENT_ORIGIN, createCrossReferenceIndex());
    return this.parseInlineContent();
  }

  /**
   * 解析文档中一段参数内的行内内容：位置按整篇文档计算，交叉引用记入父解析器的索引
   */
  private parseInlineAt(input: string, origin: SourceOrigin, crossRefs: CrossReferenceIndex): LaTeXInlineNode[] {
    this.reset(input, origin, crossRefs);
    return this.parseInlineContent();
  }

  private reset(input: string, origin: SourceOrigin, crossRefs: CrossReferenceIndex): void {
    this.input = input;
    this.baseOffset = origin.offset;
    this.lexer = new LaTeXLexer(input, origin);
    this.warnings = [];
    this.crossRefs = crossRefs;
    this.currentToken = this.lexer.nextToken();
  }

  /**
   * 获取配置选项
   */
  getOptions(): Required<LaTeXParserOptions> {
    return { ...this.options };
  }

  // ================================
  // Token 操作
  // ================================

  private advance(): void {
    this.currentToken = this.lexer.nextToken();
  }

  /**
   * 期望当前 Token 为指定类型：匹配则消费并返回 true；
   * 不匹配则记录语法警告且不消费，返回 false，由调用方决定恢复策略
   */
  private expect(type: TokenType): boolean {
    if (this.currentToken.type !== type) {
      this.addWarning(
        `期望 ${type}，但得到 ${this.currentToken.type}`,
        'syntax'
      );
      return false;
    }
    this.advance();
    return true;
  }

  private match(type: TokenType): boolean {
    return this.currentToken.type === type;
  }

  private matchCommand(name: string): boolean {
    return (
      this.currentToken.type === TokenType.Command &&
      this.currentToken.value === name
    );
  }

  /** 单个 Token 的位置（Token 值即其源码文本时使用） */
  private tokenPosition(token: Token): Position {
    return {
      startLine: token.line,
      startColumn: token.column,
      endLine: token.line,
      endColumn: token.column + token.value.length,
      startOffset: token.offset,
      endOffset: token.offset + token.value.length,
    };
  }

  /** 从 startToken 到当前 Token 之前（不含当前 Token）的范围 */
  private spanFrom(startToken: Token): Position {
    return {
      startLine: startToken.line,
      startColumn: startToken.column,
      endLine: this.currentToken.line,
      endColumn: this.currentToken.column,
      startOffset: startToken.offset,
      endOffset: this.currentToken.offset,
    };
  }

  /** 从 startToken 到当前 Token 之前的源码 */
  private rawFrom(startToken: Token): string {
    return this.sourceBetween(startToken.offset, this.currentToken.offset);
  }

  private sourceBetween(from: number, to: number): string {
    return this.input.substring(from - this.baseOffset, to - this.baseOffset);
  }

  /** 当前位置是否为 \begin{name} / \end{name} */
  private atEnvironmentCommand(command: 'begin' | 'end', name: string): boolean {
    if (!this.matchCommand(`\\${command}`)) return false;
    const pattern = new RegExp(`\\\\${command}\\s*\\{${escapeRegExp(name)}\\}`, 'y');
    pattern.lastIndex = this.currentToken.offset - this.baseOffset;
    return pattern.test(this.input);
  }

  private addWarning(
    message: string,
    type: ParseWarning['type']
  ): void {
    this.warnings.push({
      message,
      position: this.tokenPosition(this.currentToken),
      type,
    });
  }

  // ================================
  // 文档解析
  // ================================

  private parseDocument(): DocumentNode {
    const startToken = this.currentToken;
    let documentClass: DocumentClass | undefined;
    const preamble: PreambleItem[] = [];
    const children: LaTeXBlockNode[] = [];
    const metadata: DocumentMetadata = {};

    // 解析文档类
    if (this.matchCommand('\\documentclass')) {
      documentClass = this.parseDocumentClass();
    }

    // 只有存在 \begin{document} 时才有导言区；片段文档整体作为正文解析
    const hasDocumentEnvironment = /\\begin\s*\{document\}/.test(this.input);

    if (hasDocumentEnvironment) {
      while (true) {
        this.skipWhitespaceAndComments();
        if (this.match(TokenType.EOF) || this.atEnvironmentCommand('begin', 'document')) break;
        const item = this.parsePreambleItem();
        if (item) {
          if (this.options.parsePreamble) preamble.push(item);
          this.extractMetadata(item, metadata);
        }
      }

      // 跳过 \begin{document}
      if (this.matchCommand('\\begin')) {
        this.advance();
        this.skipWhitespace();
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          this.readUntilEndGroup();
        }
      }
    }

    // 解析文档主体
    while (!this.match(TokenType.EOF)) {
      if (this.atEnvironmentCommand('end', 'document')) {
        break;
      }

      // 正文层级出现的其他 \end{...} 没有对应的 \begin：记录后跳过，继续解析后文
      if (this.matchCommand('\\end')) {
        this.addWarning('多余的 \\end（没有对应的 \\begin）', 'unmatched_brace');
        this.advance();
        this.skipWhitespace();
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          this.readUntilEndGroup();
        }
        continue;
      }

      const block = this.parseBlock();
      if (block) {
        children.push(block);
      }
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.Document,
      documentClass,
      preamble,
      children,
      metadata,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseDocumentClass(): DocumentClass {
    this.advance(); // 跳过 \documentclass
    this.skipWhitespace();

    const options: string[] = [];
    let name = '';

    // 解析可选参数
    if (this.match(TokenType.BeginOptional)) {
      this.advance();
      const optContent = this.readUntilEndOptional();
      options.push(...optContent.split(',').map((s) => s.trim()).filter(Boolean));
    }

    this.skipWhitespace();

    // 解析必选参数
    if (this.match(TokenType.BeginGroup)) {
      this.advance();
      name = this.readUntilEndGroup();
    }

    return { name, options };
  }

  private parsePreambleItem(): PreambleItem | null {
    this.skipWhitespaceAndComments();

    if (this.match(TokenType.EOF)) {
      return null;
    }

    const startToken = this.currentToken;

    if (this.currentToken.type === TokenType.Command) {
      const command = this.currentToken.value;
      this.advance();
      this.skipWhitespace();

      const optArgs: string[] = [];
      const args: string[] = [];

      // 解析可选参数
      while (this.match(TokenType.BeginOptional)) {
        this.advance();
        optArgs.push(this.readUntilEndOptional());
        this.skipWhitespace();
      }

      // 解析必选参数
      while (this.match(TokenType.BeginGroup)) {
        this.advance();
        const { text, origin } = this.readArgument(TokenType.EndGroup);
        const name = command.substring(1);
        if (args.length === 0 && INDEXED_ARGUMENT_COMMANDS.has(name)) {
          this.indexCommandArgument(name, text, origin);
        }
        args.push(text);
        this.skipWhitespace();
      }

      let type: PreambleItem['type'] = 'other';
      if (command === '\\usepackage') type = 'usepackage';
      else if (command === '\\newcommand') type = 'newcommand';
      else if (command === '\\renewcommand') type = 'renewcommand';
      else if (command === '\\input') type = 'input';
      else if (command === '\\include') type = 'include';

      const raw = this.rawFrom(startToken);

      return { type, command, args, optArgs, raw };
    }

    // 跳过非命令内容
    this.advance();
    return null;
  }

  private extractMetadata(item: PreambleItem, metadata: DocumentMetadata): void {
    if (item.command === '\\title' && item.args[0]) {
      metadata.title = item.args[0];
    } else if (item.command === '\\author' && item.args[0]) {
      metadata.author = item.args[0].split('\\and').map((s) => s.trim());
    } else if (item.command === '\\date' && item.args[0]) {
      metadata.date = item.args[0];
    }
  }

  // ================================
  // 块级解析
  // ================================

  private parseBlock(): LaTeXBlockNode | null {
    this.skipWhitespace();

    if (this.match(TokenType.EOF)) {
      return null;
    }

    // 块级注释：按 preserveComments 选项决定保留为注释节点或丢弃
    if (this.match(TokenType.Comment)) {
      return this.parseComment();
    }

    // 处理命令
    if (this.currentToken.type === TokenType.Command) {
      const command = this.currentToken.value.substring(1); // 去掉反斜杠

      // 章节命令
      if (command in SECTION_COMMANDS || command.endsWith('*') && command.slice(0, -1) in SECTION_COMMANDS) {
        return this.parseSection();
      }

      // 环境开始
      if (command === 'begin') {
        return this.parseEnvironment();
      }

      // 跳过某些命令
      if (command === 'maketitle' || command === 'tableofcontents') {
        this.advance();
        return null;
      }
    }

    // 数学显示模式
    if (this.match(TokenType.MathDisplay)) {
      return this.parseMathBlock();
    }

    if (this.matchCommand('\\[')) {
      return this.parseBracketMath();
    }

    // 普通段落
    return this.parseParagraph();
  }

  private parseComment(): CommentNode | null {
    const commentToken = this.currentToken;
    this.advance();

    if (!this.options.preserveComments) {
      return null;
    }

    return {
      type: LaTeXBlockType.Comment,
      // 去掉行首的 % 标记
      content: commentToken.value.substring(1),
      position: this.tokenPosition(commentToken),
      raw: commentToken.value,
    };
  }

  private parseSection(): SectionNode {
    const startToken = this.currentToken;
    const command = this.currentToken.value.substring(1);
    const numbered = !command.endsWith('*');
    const baseCommand = numbered ? command : command.slice(0, -1);
    const level = SECTION_COMMANDS[baseCommand] ?? 1;

    this.advance();
    this.skipWhitespace();

    // 解析可选参数（短标题）
    let shortTitle: LaTeXInlineNode[] | undefined;
    if (this.match(TokenType.BeginOptional)) {
      this.advance();
      shortTitle = this.readInlineArgument(TokenType.EndOptional);
    }

    this.skipWhitespace();

    // 解析标题
    let title: LaTeXInlineNode[] = [];
    if (this.match(TokenType.BeginGroup)) {
      this.advance();
      title = this.readInlineArgument(TokenType.EndGroup);
    }

    this.skipWhitespace();

    // 检查标签
    let label: string | undefined;
    if (this.matchCommand('\\label')) {
      label = this.readLabel();
    }

    // 解析子内容（直到下一个同级或更高级章节）
    const children: LaTeXBlockNode[] = [];
    while (!this.match(TokenType.EOF)) {
      // 检查是否遇到同级或更高级章节
      if (this.currentToken.type === TokenType.Command) {
        const nextCommand = this.currentToken.value.substring(1).replace('*', '');
        if (nextCommand in SECTION_COMMANDS) {
          const nextLevel = SECTION_COMMANDS[nextCommand];
          if (nextLevel !== undefined && nextLevel <= level) {
            break;
          }
        }
        if (nextCommand === 'end') {
          break;
        }
      }

      const block = this.parseBlock();
      if (block) {
        children.push(block);
      }
    }

    const raw = this.rawFrom(startToken);

    let type: LaTeXBlockType.Section | LaTeXBlockType.Subsection | LaTeXBlockType.Subsubsection;
    if (level <= 1) {
      type = LaTeXBlockType.Section;
    } else if (level === 2) {
      type = LaTeXBlockType.Subsection;
    } else {
      type = LaTeXBlockType.Subsubsection;
    }

    return {
      type,
      level,
      title,
      shortTitle,
      numbered,
      label,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseEnvironment(): LaTeXBlockNode {
    const startToken = this.currentToken;
    this.advance(); // 跳过 \begin
    this.skipWhitespace();

    // 读取环境名称
    let envName = '';
    if (this.expect(TokenType.BeginGroup)) {
      envName = this.readUntilEndGroup();
    }

    this.skipWhitespace();

    // 根据环境类型分派
    if (this.options.mathEnvironments.includes(envName)) {
      return this.parseMathEnvironment(startToken, envName);
    }

    if (this.options.codeEnvironments.includes(envName)) {
      return this.parseCodeEnvironment(startToken, envName);
    }

    if (this.options.theoremEnvironments.includes(envName)) {
      return this.parseTheoremEnvironment(startToken, envName);
    }

    if (envName === 'itemize' || envName === 'enumerate' || envName === 'description') {
      return this.parseListEnvironment(startToken, envName);
    }

    if (envName === 'tabular' || envName === 'table' || envName === 'table*') {
      return this.parseTableEnvironment(startToken, envName);
    }

    if (envName === 'figure' || envName === 'figure*') {
      return this.parseFigureEnvironment(startToken, envName);
    }

    if (envName === 'quote' || envName === 'quotation') {
      return this.parseQuoteEnvironment(startToken, envName);
    }

    if (envName === 'abstract') {
      return this.parseAbstractEnvironment(startToken);
    }

    // 通用环境
    return this.parseGenericEnvironment(startToken, envName);
  }

  private parseMathEnvironment(startToken: Token, envName: string): MathBlockNode {
    const body = this.readMathBody(() => this.atEnvironmentCommand('end', envName));

    if (body.closed) {
      this.advance(); // 跳过 \end
      this.skipWhitespace();
      if (this.match(TokenType.BeginGroup)) {
        this.advance();
        this.readUntilEndGroup();
      }
    } else {
      this.addWarning(`数学环境未闭合，缺少 \\end{${envName}}`, 'syntax');
    }

    return {
      type: LaTeXBlockType.MathBlock,
      content: body.content,
      environment: envName,
      numbered: !envName.endsWith('*'),
      label: body.label,
      position: this.spanFrom(startToken),
      raw: this.rawFrom(startToken),
    };
  }

  /**
   * \[ ... \] 行间公式
   */
  private parseBracketMath(): MathBlockNode {
    const startToken = this.currentToken;
    this.advance(); // 跳过 \[
    const body = this.readMathBody(() => this.matchCommand('\\]'));

    if (body.closed) {
      this.advance(); // 跳过 \]
    } else {
      this.addWarning('行间公式未闭合，缺少 \\]', 'syntax');
    }

    return {
      type: LaTeXBlockType.MathBlock,
      content: body.content,
      environment: '\\[',
      numbered: false,
      label: body.label,
      position: this.spanFrom(startToken),
      raw: this.rawFrom(startToken),
    };
  }

  /**
   * 读取公式内容直到 isEnd() 为真（不消费结束标记）。
   * 公式中的 \label 与 \ref 类命令（如 \tag{\ref{x}}、\text{由 \eqref{a}}）记入交叉引用索引；
   * align 等多行公式可以有多个标签，节点保留第一个
   */
  private readMathBody(isEnd: () => boolean): { content: string; label?: string; closed: boolean } {
    let content = '';
    let label: string | undefined;

    while (!this.match(TokenType.EOF)) {
      if (isEnd()) {
        return { content: content.trim(), label, closed: true };
      }

      if (this.matchCommand('\\label')) {
        const name = this.readLabel();
        label ??= name;
        continue;
      }

      if (
        this.currentToken.type === TokenType.Command &&
        REFERENCE_COMMANDS.has(this.currentToken.value.substring(1))
      ) {
        content += this.parseReference(this.currentToken.value.substring(1)).raw;
        continue;
      }

      content += this.currentToken.value;
      this.advance();
    }

    return { content: content.trim(), label, closed: false };
  }

  private parseCodeEnvironment(startToken: Token, envName: string): CodeBlockNode {
    const options: Record<string, string> = {};
    let language: string | undefined;

    // 解析可选参数
    this.skipWhitespace();
    if (this.match(TokenType.BeginOptional)) {
      this.advance();
      const optContent = this.readUntilEndOptional();
      // 解析选项
      for (const opt of optContent.split(',')) {
        const [key, value] = opt.split('=').map((s) => s.trim());
        if (key && value) {
          options[key] = value;
          if (key === 'language') {
            language = value;
          }
        }
      }
    }

    // 读取代码内容
    let content = '';
    while (!this.match(TokenType.EOF)) {
      if (this.matchCommand('\\end')) {
        this.advance();
        this.skipWhitespace();
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          const endEnv = this.readUntilEndGroup();
          if (endEnv === envName) {
            break;
          }
          content += `\\end{${endEnv}}`;
        }
        continue;
      }

      content += this.currentToken.value;
      this.advance();
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.CodeBlock,
      content: content.trim(),
      language,
      environment: envName,
      options,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseTheoremEnvironment(startToken: Token, envName: string): TheoremNode {
    let title: LaTeXInlineNode[] | undefined;
    let label: string | undefined;

    // 解析可选标题
    this.skipWhitespace();
    if (this.match(TokenType.BeginOptional)) {
      this.advance();
      title = this.readInlineArgument(TokenType.EndOptional);
    }

    this.skipWhitespace();

    // 检查标签
    if (this.matchCommand('\\label')) {
      label = this.readLabel();
    }

    // 解析内容
    const children = this.parseBlocksUntilEnd(envName);

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.Theorem,
      theoremType: envName,
      title,
      label,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseListEnvironment(
    startToken: Token,
    envName: 'itemize' | 'enumerate' | 'description'
  ): ListNode {
    const children: ListItemNode[] = [];

    this.skipWhitespaceAndComments();

    while (!this.match(TokenType.EOF)) {
      // 检查结束
      if (this.matchCommand('\\end')) {
        this.advance();
        this.skipWhitespace();
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          const endEnv = this.readUntilEndGroup();
          if (endEnv === envName) {
            break;
          }
        }
        continue;
      }

      // 解析 \item
      if (this.matchCommand('\\item')) {
        const item = this.parseListItem(envName);
        children.push(item);
        continue;
      }

      // 跳过其他内容
      this.advance();
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.List,
      listType: envName,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseListItem(listType: string): ListItemNode {
    const startToken = this.currentToken;
    this.advance(); // 跳过 \item
    this.skipWhitespace();

    let label: LaTeXInlineNode[] | undefined;

    // 对于 description，解析可选标签
    if (listType === 'description' && this.match(TokenType.BeginOptional)) {
      this.advance();
      label = this.readInlineArgument(TokenType.EndOptional);
    }

    // 解析内容直到下一个 \item 或 \end
    const children: (LaTeXBlockNode | LaTeXInlineNode)[] = [];
    const inlineContent: LaTeXInlineNode[] = [];

    while (!this.match(TokenType.EOF)) {
      if (this.matchCommand('\\item') || this.matchCommand('\\end')) {
        break;
      }

      // 检查是否有嵌套列表
      if (this.matchCommand('\\begin')) {
        // 先保存当前的行内内容
        if (inlineContent.length > 0) {
          children.push(...inlineContent);
          inlineContent.length = 0;
        }

        const block = this.parseEnvironment();
        children.push(block);
        continue;
      }

      // 收集行内内容
      const inline = this.parseInlineToken();
      if (inline) {
        inlineContent.push(inline);
      } else {
        this.advance();
      }
    }

    if (inlineContent.length > 0) {
      children.push(...inlineContent);
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.ListItem,
      label,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseTableEnvironment(startToken: Token, envName: string): TableNode {
    let columnAlignment: ('l' | 'c' | 'r' | 'p')[] = [];
    let caption: LaTeXInlineNode[] | undefined;
    let label: string | undefined;
    const children: TableRowNode[] = [];

    this.skipWhitespaceAndComments();

    // 解析位置选项
    if (this.match(TokenType.BeginOptional)) {
      this.advance();
      this.readUntilEndOptional(); // 位置选项
    }

    // 如果是 table 环境，需要找到内部的 tabular
    if (envName === 'table' || envName === 'table*') {
      while (!this.match(TokenType.EOF)) {
        if (this.matchCommand('\\end')) {
          this.advance();
          this.skipWhitespace();
          if (this.match(TokenType.BeginGroup)) {
            this.advance();
            const endEnv = this.readUntilEndGroup();
            if (endEnv === envName) {
              break;
            }
          }
          continue;
        }

        // 解析标题
        if (this.matchCommand('\\caption')) {
          this.advance();
          this.skipWhitespace();
          if (this.match(TokenType.BeginGroup)) {
            this.advance();
            caption = this.readInlineArgument(TokenType.EndGroup);
          }
          continue;
        }

        // 解析标签
        if (this.matchCommand('\\label')) {
          label = this.readLabel();
          continue;
        }

        // 解析 tabular
        if (this.matchCommand('\\begin')) {
          this.advance();
          this.skipWhitespace();
          if (this.match(TokenType.BeginGroup)) {
            this.advance();
            const innerEnv = this.readUntilEndGroup();
            if (innerEnv === 'tabular') {
              const result = this.parseTabular();
              columnAlignment = result.alignment;
              children.push(...result.rows);
            }
          }
          continue;
        }

        this.advance();
      }
    } else {
      // 直接解析 tabular
      const result = this.parseTabular();
      columnAlignment = result.alignment;
      children.push(...result.rows);
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.Table,
      columnAlignment,
      children,
      caption,
      label,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseTabular(): { alignment: ('l' | 'c' | 'r' | 'p')[]; rows: TableRowNode[] } {
    const alignment: ('l' | 'c' | 'r' | 'p')[] = [];
    const rows: TableRowNode[] = [];

    this.skipWhitespace();

    // 解析列格式
    if (this.match(TokenType.BeginGroup)) {
      this.advance();
      const format = this.readUntilEndGroup();
      for (const char of format) {
        if (char === 'l' || char === 'c' || char === 'r' || char === 'p') {
          alignment.push(char);
        }
      }
    }

    this.skipWhitespaceAndComments();

    // 解析行
    let currentCells: TableCellNode[] = [];
    let rowStart = this.currentToken;
    let isFirstRow = true;

    while (!this.match(TokenType.EOF)) {
      // 检查结束
      if (this.matchCommand('\\end')) {
        // 保存最后一行
        if (currentCells.length > 0) {
          rows.push(this.createTableRow(rowStart, currentCells, isFirstRow));
        }
        this.advance();
        this.skipWhitespace();
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          this.readUntilEndGroup();
        }
        break;
      }

      // 检查换行 \\
      if (this.matchCommand('\\\\')) {
        if (currentCells.length > 0) {
          rows.push(this.createTableRow(rowStart, currentCells, isFirstRow));
          isFirstRow = false;
          currentCells = [];
        }
        this.advance();
        rowStart = this.currentToken;
        continue;
      }

      // 检查 \hline
      if (this.matchCommand('\\hline') || this.matchCommand('\\toprule') ||
          this.matchCommand('\\midrule') || this.matchCommand('\\bottomrule')) {
        this.advance();
        continue;
      }

      // 解析单元格
      const cell = this.parseTableCell();
      currentCells.push(cell);

      // 跳过 & 分隔符
      if (this.currentToken.type === TokenType.Text && this.currentToken.value === '&') {
        this.advance();
      }
    }

    return { alignment, rows };
  }

  private createTableRow(startToken: Token, cells: TableCellNode[], isHeader: boolean): TableRowNode {
    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.TableRow,
      children: cells,
      isHeader,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseTableCell(): TableCellNode {
    const startToken = this.currentToken;
    const children: LaTeXInlineNode[] = [];

    while (!this.match(TokenType.EOF)) {
      // 检查分隔符或换行
      if (this.currentToken.type === TokenType.Text && this.currentToken.value === '&') {
        break;
      }
      if (this.matchCommand('\\\\') || this.matchCommand('\\end') ||
          this.matchCommand('\\hline') || this.matchCommand('\\midrule')) {
        break;
      }

      const inline = this.parseInlineToken();
      if (inline) {
        children.push(inline);
      } else if (this.currentToken.type === TokenType.Whitespace ||
                 this.currentToken.type === TokenType.Newline) {
        this.advance();
      } else {
        break;
      }
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.TableCell,
      children,
      colspan: 1,
      rowspan: 1,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseFigureEnvironment(startToken: Token, envName: string): FigureNode {
    let path: string | undefined;
    let caption: LaTeXInlineNode[] | undefined;
    let label: string | undefined;
    let placement: string | undefined;
    const options: Record<string, string> = {};
    const children: LaTeXBlockNode[] = [];

    this.skipWhitespace();

    // 解析位置选项
    if (this.match(TokenType.BeginOptional)) {
      this.advance();
      placement = this.readUntilEndOptional();
    }

    while (!this.match(TokenType.EOF)) {
      if (this.matchCommand('\\end')) {
        this.advance();
        this.skipWhitespace();
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          const endEnv = this.readUntilEndGroup();
          if (endEnv === envName) {
            break;
          }
        }
        continue;
      }

      // 解析 \includegraphics
      if (this.matchCommand('\\includegraphics')) {
        this.advance();
        this.skipWhitespace();

        // 解析选项
        if (this.match(TokenType.BeginOptional)) {
          this.advance();
          const optContent = this.readUntilEndOptional();
          for (const opt of optContent.split(',')) {
            const [key, value] = opt.split('=').map((s) => s.trim());
            if (key && value) {
              options[key] = value;
            }
          }
        }

        this.skipWhitespace();

        // 解析路径
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          path = this.readUntilEndGroup();
        }
        continue;
      }

      // 解析标题
      if (this.matchCommand('\\caption')) {
        this.advance();
        this.skipWhitespace();
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          caption = this.readInlineArgument(TokenType.EndGroup);
        }
        continue;
      }

      // 解析标签
      if (this.matchCommand('\\label')) {
        label = this.readLabel();
        continue;
      }

      this.advance();
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.Figure,
      path,
      options,
      caption,
      label,
      placement,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseQuoteEnvironment(
    startToken: Token,
    envName: 'quote' | 'quotation'
  ): QuoteNode {
    const children = this.parseBlocksUntilEnd(envName);

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.Quote,
      environment: envName,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseAbstractEnvironment(startToken: Token): LaTeXBlockNode {
    const children = this.parseBlocksUntilEnd('abstract');

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.Abstract,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseGenericEnvironment(startToken: Token, envName: string): EnvironmentNode {
    const args: string[] = [];
    const optArgs: string[] = [];

    this.skipWhitespace();

    // 解析可选参数
    while (this.match(TokenType.BeginOptional)) {
      this.advance();
      optArgs.push(this.readUntilEndOptional());
      this.skipWhitespace();
    }

    // 解析必选参数
    while (this.match(TokenType.BeginGroup)) {
      this.advance();
      args.push(this.readUntilEndGroup());
      this.skipWhitespace();
    }

    const children = this.parseBlocksUntilEnd(envName);

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.Environment,
      name: envName,
      args,
      optArgs,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseBlocksUntilEnd(envName: string): LaTeXBlockNode[] {
    const blocks: LaTeXBlockNode[] = [];

    while (!this.match(TokenType.EOF)) {
      if (this.matchCommand('\\end')) {
        this.advance();
        this.skipWhitespace();
        if (this.match(TokenType.BeginGroup)) {
          this.advance();
          const endEnv = this.readUntilEndGroup();
          if (endEnv === envName) {
            break;
          }
        }
        continue;
      }

      const block = this.parseBlock();
      if (block) {
        blocks.push(block);
      }
    }

    return blocks;
  }

  private parseMathBlock(): MathBlockNode {
    const startToken = this.currentToken;
    const content = this.currentToken.value;
    this.advance();

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.MathBlock,
      content,
      environment: '$$',
      numbered: false,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseParagraph(): ParagraphNode {
    const startToken = this.currentToken;
    const children = this.parseInlineContent();

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXBlockType.Paragraph,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  // ================================
  // 行内解析
  // ================================

  private parseInlineContent(): LaTeXInlineNode[] {
    const nodes: LaTeXInlineNode[] = [];
    let consecutiveNewlines = 0;

    while (!this.match(TokenType.EOF)) {
      // 检查段落分隔（连续两个换行）
      if (this.match(TokenType.Newline)) {
        consecutiveNewlines++;
        if (consecutiveNewlines >= 2) {
          break;
        }
        this.advance();
        continue;
      }

      consecutiveNewlines = 0;

      // 检查是否遇到块级命令
      if (this.currentToken.type === TokenType.Command) {
        const command = this.currentToken.value.substring(1);
        if (
          command in SECTION_COMMANDS ||
          command === 'begin' ||
          command === 'end' ||
          command === '[' ||
          command === 'maketitle' ||
          command === 'tableofcontents'
        ) {
          break;
        }
      }

      const node = this.parseInlineToken();
      if (node) {
        nodes.push(node);
      } else {
        this.advance();
      }
    }

    return nodes;
  }

  private parseInlineToken(): LaTeXInlineNode | null {
    const startToken = this.currentToken;

    switch (this.currentToken.type) {
      case TokenType.Text:
        return this.parseTextNode();

      case TokenType.Command:
        return this.parseInlineCommand();

      case TokenType.MathInline:
        return this.parseMathInline();

      case TokenType.BeginGroup:
        return this.parseGroup();

      case TokenType.Whitespace:
        this.advance();
        return {
          type: LaTeXInlineType.Whitespace,
          count: 1,
          position: this.tokenPosition(startToken),
          raw: startToken.value,
        };

      case TokenType.Comment:
        if (this.options.preserveComments) {
          this.advance();
          return {
            type: LaTeXInlineType.Text,
            content: '',
            position: this.tokenPosition(startToken),
            raw: startToken.value,
          };
        }
        this.advance();
        return null;

      default:
        return null;
    }
  }

  private parseTextNode(): TextNode {
    const startToken = this.currentToken;
    let content = this.currentToken.value;

    // 处理特殊字符转换
    for (const [pattern, replacement] of Object.entries(SPECIAL_CHAR_MAP)) {
      if (content.includes(pattern)) {
        content = content.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
      }
    }

    this.advance();

    return {
      type: LaTeXInlineType.Text,
      content,
      position: this.tokenPosition(startToken),
      raw: startToken.value,
    };
  }

  private parseInlineCommand(): LaTeXInlineNode | null {
    const startToken = this.currentToken;
    const command = this.currentToken.value.substring(1);

    // 特殊字符命令
    if (SPECIAL_CHAR_MAP['\\' + command]) {
      this.advance();
      return {
        type: LaTeXInlineType.SpecialChar,
        char: SPECIAL_CHAR_MAP['\\' + command],
        command,
        position: this.tokenPosition(startToken),
        raw: startToken.value,
      } as SpecialCharNode;
    }

    // 文本格式命令
    if (TEXT_FORMAT_COMMANDS.has(command)) {
      return this.parseTextFormat(command);
    }

    // 引用命令
    if (CITATION_COMMANDS.has(command)) {
      return this.parseCitation(command);
    }

    // 交叉引用命令
    if (REFERENCE_COMMANDS.has(command)) {
      return this.parseReference(command);
    }

    // 其他特殊命令
    if (command === 'label') {
      return this.parseLabel();
    }

    if (command === 'href' || command === 'url') {
      return this.parseHyperlink(command);
    }

    if (command === 'footnote') {
      return this.parseFootnoteInline();
    }

    // 通用命令
    return this.parseGenericCommand(command);
  }

  private parseTextFormat(command: string): BoldNode | ItalicNode | MonospaceNode {
    const startToken = this.currentToken;
    this.advance();
    this.skipWhitespace();

    const children: LaTeXInlineNode[] = [];

    if (this.match(TokenType.BeginGroup)) {
      this.advance();
      while (!this.match(TokenType.EndGroup) && !this.match(TokenType.EOF)) {
        const node = this.parseInlineToken();
        if (node) {
          children.push(node);
        } else {
          this.advance();
        }
      }
      if (this.match(TokenType.EndGroup)) {
        this.advance();
      }
    }

    const raw = this.rawFrom(startToken);

    if (command === 'textbf' || command === 'bfseries' || command === 'bf') {
      return {
        type: LaTeXInlineType.Bold,
        children,
        command: command as 'textbf' | 'bfseries' | 'bf',
        position: this.spanFrom(startToken),
        raw,
      };
    }

    if (command === 'texttt' || command === 'ttfamily' || command === 'tt' || command === 'verb') {
      return {
        type: LaTeXInlineType.Monospace,
        children,
        command: command as 'texttt' | 'ttfamily' | 'verb',
        position: this.spanFrom(startToken),
        raw,
      };
    }

    return {
      type: LaTeXInlineType.Italic,
      children,
      command: command as 'textit' | 'itshape' | 'it' | 'emph',
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseCitation(command: string): CitationNode {
    const startToken = this.currentToken;
    this.advance();
    this.skipWhitespace();

    let prefix: string | undefined;
    let suffix: string | undefined;
    let keys: string[] = [];

    // 解析可选参数
    if (this.match(TokenType.BeginOptional)) {
      this.advance();
      prefix = this.readUntilEndOptional();
      this.skipWhitespace();

      // 第二个可选参数
      if (this.match(TokenType.BeginOptional)) {
        this.advance();
        suffix = this.readUntilEndOptional();
        this.skipWhitespace();
      }
    }

    // 解析必选参数（引用键）
    if (this.match(TokenType.BeginGroup)) {
      this.advance();
      const { text, origin } = this.readArgument(TokenType.EndGroup);
      keys = this.indexKeys(this.crossRefs.citations, command, text, origin, true).map((entry) => entry.key);
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXInlineType.Citation,
      keys,
      command,
      prefix,
      suffix,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseReference(command: string): ReferenceNode {
    const startToken = this.currentToken;
    this.advance();
    this.skipWhitespace();

    let label = '';

    if (this.match(TokenType.BeginGroup)) {
      this.advance();
      const { text, origin } = this.readArgument(TokenType.EndGroup);
      label = text.trim();
      this.indexKeys(
        this.crossRefs.references,
        command,
        text,
        origin,
        MULTI_KEY_REFERENCE_COMMANDS.has(command)
      );
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXInlineType.Reference,
      label,
      command,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseLabel(): LabelNode {
    const startToken = this.currentToken;
    const name = this.readLabel();

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXInlineType.Label,
      name,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseHyperlink(command: string): HyperlinkNode {
    const startToken = this.currentToken;
    this.advance();
    this.skipWhitespace();

    let url = '';
    let text = '';

    if (command === 'href') {
      // \href{url}{text}
      if (this.match(TokenType.BeginGroup)) {
        this.advance();
        url = this.readUntilEndGroup();
      }
      this.skipWhitespace();
      if (this.match(TokenType.BeginGroup)) {
        this.advance();
        text = this.readUntilEndGroup();
      }
    } else {
      // \url{url}
      if (this.match(TokenType.BeginGroup)) {
        this.advance();
        url = this.readUntilEndGroup();
        text = url;
      }
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXInlineType.Hyperlink,
      url,
      text,
      command: command as 'href' | 'hyperref',
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseFootnoteInline(): LaTeXInlineNode {
    const startToken = this.currentToken;
    this.advance();
    this.skipWhitespace();

    const children: LaTeXInlineNode[] = [];

    if (this.match(TokenType.BeginGroup)) {
      this.advance();
      while (!this.match(TokenType.EndGroup) && !this.match(TokenType.EOF)) {
        const node = this.parseInlineToken();
        if (node) {
          children.push(node);
        } else {
          this.advance();
        }
      }
      if (this.match(TokenType.EndGroup)) {
        this.advance();
      }
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXInlineType.FootnoteRef,
      content: children,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseGenericCommand(command: string): CommandNode {
    const startToken = this.currentToken;
    this.advance();
    this.skipWhitespace();

    const args: string[] = [];
    const optArgs: string[] = [];

    // 解析可选参数
    while (this.match(TokenType.BeginOptional)) {
      this.advance();
      optArgs.push(this.readUntilEndOptional());
      this.skipWhitespace();
    }

    // 解析必选参数
    while (this.match(TokenType.BeginGroup)) {
      this.advance();
      const { text, origin } = this.readArgument(TokenType.EndGroup);
      if (args.length === 0 && INDEXED_ARGUMENT_COMMANDS.has(command)) {
        this.indexCommandArgument(command, text, origin);
      }
      args.push(text);
      this.skipWhitespace();
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXInlineType.Command,
      name: command,
      args,
      optArgs,
      position: this.spanFrom(startToken),
      raw,
    };
  }

  private parseMathInline(): MathInlineNode {
    const startToken = this.currentToken;
    const content = this.currentToken.value;
    this.advance();

    return {
      type: LaTeXInlineType.MathInline,
      content,
      delimiter: '$',
      position: this.spanFrom(startToken),
      raw: this.rawFrom(startToken),
    };
  }

  private parseGroup(): GroupNode {
    const startToken = this.currentToken;
    this.advance(); // 跳过 {

    const children: LaTeXInlineNode[] = [];

    while (!this.match(TokenType.EndGroup) && !this.match(TokenType.EOF)) {
      const node = this.parseInlineToken();
      if (node) {
        children.push(node);
      } else {
        this.advance();
      }
    }

    if (this.match(TokenType.EndGroup)) {
      this.advance();
    }

    const raw = this.rawFrom(startToken);

    return {
      type: LaTeXInlineType.Group,
      children,
      position: this.spanFrom(startToken),
      raw,
    };
  }


  // ================================
  // 辅助方法
  // ================================

  private skipWhitespace(): void {
    while (
      this.match(TokenType.Whitespace) ||
      this.match(TokenType.Newline)
    ) {
      this.advance();
    }
  }

  private skipWhitespaceAndComments(): void {
    while (
      this.match(TokenType.Whitespace) ||
      this.match(TokenType.Newline) ||
      this.match(TokenType.Comment)
    ) {
      this.advance();
    }
  }

  /**
   * 以参数原文解析行内内容（当前 Token 为左括号之后的第一个 Token）
   */
  private readInlineArgument(close: TokenType.EndGroup | TokenType.EndOptional): LaTeXInlineNode[] {
    const { text, origin } = this.readArgument(close);
    const parser = new LaTeXParser(this.options);
    return parser.parseInlineAt(text, origin, this.crossRefs);
  }

  /**
   * 读取当前位置的 \label{name}，并登记到交叉引用索引
   */
  private readLabel(): string {
    this.advance(); // 跳过 \label
    this.skipWhitespace();
    if (!this.match(TokenType.BeginGroup)) return '';
    this.advance();
    const { text, origin } = this.readArgument(TokenType.EndGroup);
    const [entry] = this.indexKeys(this.crossRefs.labels, 'label', text, origin, false);
    return entry?.key ?? '';
  }

  /**
   * 把参数中的键登记到索引；split 为真时按逗号拆分为多个键，每个键使用其自身的位置
   */
  private indexKeys(
    target: CrossReferenceEntry[],
    command: string,
    text: string,
    origin: SourceOrigin,
    split: boolean
  ): CrossReferenceEntry[] {
    const entries: CrossReferenceEntry[] = [];
    const pattern = split ? /[^,]+/g : /[\s\S]+/g;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const key = match[0].trim();
      if (!key) continue;
      const from = match.index + (match[0].length - match[0].trimStart().length);
      const entry = { key, command, position: positionWithin(origin, text, from, from + key.length) };
      target.push(entry);
      entries.push(entry);
    }
    return entries;
  }

  /**
   * 登记导言区或正文中与交叉引用相关的命令参数（\bibitem、\bibliography、\input 等）
   */
  private indexCommandArgument(command: string, text: string, origin: SourceOrigin): void {
    switch (command) {
      case 'bibitem':
        this.indexKeys(this.crossRefs.bibItems, command, text, origin, false);
        break;
      case 'bibliography':
      case 'addbibresource':
        this.crossRefs.bibliographySources.push(
          ...text.split(',').map((source) => source.trim()).filter(Boolean)
        );
        break;
      default:
        this.crossRefs.includedFiles.push(text.trim());
    }
  }

  private readUntilEndGroup(): string {
    return this.readArgument(TokenType.EndGroup).text;
  }

  private readUntilEndOptional(): string {
    return this.readArgument(TokenType.EndOptional).text;
  }

  /**
   * 读取到配对的右括号（当前 Token 为左括号之后的第一个 Token），返回括号内的源码原文与其起点
   */
  private readArgument(close: TokenType.EndGroup | TokenType.EndOptional): { text: string; origin: SourceOrigin } {
    const open = close === TokenType.EndGroup ? TokenType.BeginGroup : TokenType.BeginOptional;
    const origin: SourceOrigin = {
      offset: this.currentToken.offset,
      line: this.currentToken.line,
      column: this.currentToken.column,
    };
    let end = origin.offset;
    let depth = 1;

    while (!this.match(TokenType.EOF)) {
      if (this.match(open)) {
        depth++;
      } else if (this.match(close)) {
        depth--;
        if (depth === 0) {
          end = this.currentToken.offset;
          this.advance();
          break;
        }
      }
      this.advance();
      end = this.currentToken.offset;
    }

    return { text: this.sourceBetween(origin.offset, end), origin };
  }
}

/**
 * 参数原文中 [from, to) 的位置（origin 为参数原文第一个字符的位置）
 */
function positionWithin(origin: SourceOrigin, text: string, from: number, to: number): Position {
  let line = origin.line;
  let column = origin.column;
  let startLine = line;
  let startColumn = column;
  for (let i = 0; i < to; i++) {
    if (i === from) {
      startLine = line;
      startColumn = column;
    }
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  if (from === to) {
    startLine = line;
    startColumn = column;
  }
  return {
    startLine,
    startColumn,
    endLine: line,
    endColumn: column,
    startOffset: origin.offset + from,
    endOffset: origin.offset + to,
  };
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 LaTeX 解析器实例
 */
export function createLaTeXParser(options?: LaTeXParserOptions): LaTeXParser {
  return new LaTeXParser(options);
}

/**
 * 快速解析 LaTeX 文档
 */
export function parseLaTeX(
  input: string,
  options?: LaTeXParserOptions
): LaTeXParseResult {
  const parser = new LaTeXParser(options);
  return parser.parse(input);
}

/**
 * 快速解析 LaTeX 行内内容
 */
export function parseLaTeXInline(
  input: string,
  options?: LaTeXParserOptions
): LaTeXInlineNode[] {
  const parser = new LaTeXParser(options);
  return parser.parseInline(input);
}
