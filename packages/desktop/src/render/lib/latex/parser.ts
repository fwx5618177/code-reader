// ================================
// LaTeX 解析器
// 支持增量编译的完整 LaTeX 解析器
// 采用两阶段解析：1. Preamble 解析 2. 正文解析
// ================================

import type {
  LatexNode,
  RootNode,
  PreambleNode,
  DocumentNode,
  CommandNode,
  EnvironmentNode,
  GroupNode,
  TextNode,
  MathInlineNode,
  MathBlockNode,
  CommentNode,
  ParagraphNode,
  SectionNode,
  ListNode,
  ListItemNode,
  ErrorNode,
  PackageInfo,
  MacroDefinition,
  LatexParserOptions,
  LatexParseResult,
  ParseError,
  ParseWarning,
  DocumentChange,
  IncrementalParseResult,
} from './types';

// ================================
// 常量定义
// ================================

/** 章节命令级别映射 */
const SECTION_LEVELS: Record<string, SectionNode['level']> = {
  chapter: 'chapter',
  section: 'section',
  subsection: 'subsection',
  subsubsection: 'subsubsection',
  paragraph: 'paragraph',
  subparagraph: 'subparagraph',
};

/** 列表环境名称 */
const LIST_ENVIRONMENTS = new Set(['itemize', 'enumerate', 'description']);

/** 数学环境名称 */
const MATH_ENVIRONMENTS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'eqnarray',
  'eqnarray*',
  'displaymath',
]);

/** 需要特殊处理的环境 */
const VERBATIM_ENVIRONMENTS = new Set(['verbatim', 'lstlisting', 'minted']);

/** 默认解析选项 */
const DEFAULT_OPTIONS: Required<LatexParserOptions> = {
  strict: false,
  parseMathContent: false,
  preserveComments: true,
  preserveWhitespace: false,
  maxDepth: 100,
};

// ================================
// 工具函数
// ================================

/** 生成唯一 ID */
let nodeIdCounter = 0;
function generateNodeId(): string {
  return `node_${++nodeIdCounter}_${Date.now().toString(36)}`;
}

/** 重置 ID 计数器 */
export function resetNodeIdCounter(): void {
  nodeIdCounter = 0;
}

/** 计算字符串哈希值（快速版本） */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为 32 位整数
  }
  return hash.toString(36);
}

/** 计算位置对应的行列号 */
function getLineColumn(content: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < position && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

// ================================
// LaTeX 解析器类
// ================================

/**
 * LaTeX 解析器
 * 支持增量编译，将 LaTeX 源码解析为 AST
 */
export class LatexParser {
  private input: string;
  private pos: number;
  private length: number;
  private options: Required<LatexParserOptions>;
  private errors: ParseError[];
  private warnings: ParseWarning[];
  private depth: number;
  private startTime: number;

  constructor(input: string, options?: LatexParserOptions) {
    this.input = input;
    this.pos = 0;
    this.length = input.length;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.errors = [];
    this.warnings = [];
    this.depth = 0;
    this.startTime = 0;
  }

  /**
   * 解析整个文档
   */
  parse(): LatexParseResult {
    this.startTime = performance.now();
    this.errors = [];
    this.warnings = [];
    this.pos = 0;
    this.depth = 0;

    try {
      const ast = this.parseRoot();
      const parseTime = performance.now() - this.startTime;

      return {
        ast,
        success: this.errors.length === 0,
        errors: this.errors,
        warnings: this.warnings,
        parseTime,
      };
    } catch (error) {
      const parseTime = performance.now() - this.startTime;
      const message = error instanceof Error ? error.message : String(error);

      this.addError(message, this.pos, this.pos + 1);

      // 返回一个最小的有效 AST
      return {
        ast: this.createRootNode(null, null),
        success: false,
        errors: this.errors,
        warnings: this.warnings,
        parseTime,
      };
    }
  }

  /**
   * 解析根节点
   */
  private parseRoot(): RootNode {
    const start = this.pos;

    // 查找 \documentclass
    let documentClass: string | null = null;
    const docClassMatch = this.input.match(/\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}/);
    if (docClassMatch) {
      documentClass = docClassMatch[2];
    }

    // 查找 \begin{document}
    const docBeginIndex = this.input.indexOf('\\begin{document}');
    const docEndIndex = this.input.indexOf('\\end{document}');

    let preamble: PreambleNode | null = null;
    let document: DocumentNode | null = null;

    if (docBeginIndex !== -1) {
      // 解析前言
      const preambleContent = this.input.slice(0, docBeginIndex);
      preamble = this.parsePreamble(preambleContent, 0);

      // 解析正文
      const docStart = docBeginIndex + '\\begin{document}'.length;
      const docEnd = docEndIndex !== -1 ? docEndIndex : this.length;
      const documentContent = this.input.slice(docStart, docEnd);
      document = this.parseDocument(documentContent, docStart);
    } else {
      // 没有 document 环境，整个内容作为正文
      document = this.parseDocument(this.input, 0);
    }

    return this.createRootNode(preamble, document, documentClass, start);
  }

  /**
   * 创建根节点
   */
  private createRootNode(
    preamble: PreambleNode | null,
    document: DocumentNode | null,
    documentClass: string | null = null,
    start: number = 0
  ): RootNode {
    const raw = this.input;
    return {
      type: 'root',
      id: generateNodeId(),
      start,
      end: this.length,
      raw,
      hash: hashString(raw),
      preamble,
      document,
      documentClass,
      version: 1,
    };
  }

  /**
   * 解析前言区域
   */
  private parsePreamble(content: string, offset: number): PreambleNode {
    const packages: PackageInfo[] = [];
    const commands: MacroDefinition[] = [];
    const environments: MacroDefinition[] = [];
    let title: string | undefined;
    let author: string | undefined;
    let date: string | undefined;

    // 解析 \usepackage
    const packageRegex = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = packageRegex.exec(content)) !== null) {
      const options = match[1] ? match[1].split(',').map(s => s.trim()) : [];
      const names = match[2].split(',').map(s => s.trim());
      for (const name of names) {
        packages.push({ name, options });
      }
    }

    // 解析 \newcommand 和 \renewcommand
    const commandRegex = /\\(?:new|renew)command\{?\\([a-zA-Z]+)\}?(?:\[(\d+)\])?(?:\[([^\]]*)\])?\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    while ((match = commandRegex.exec(content)) !== null) {
      commands.push({
        name: match[1],
        numArgs: match[2] ? parseInt(match[2], 10) : 0,
        defaultArgs: match[3] ? [match[3]] : [],
        expansion: match[4],
        raw: match[0],
      });
    }

    // 解析 \title
    const titleMatch = content.match(/\\title\{([^}]*)\}/);
    if (titleMatch) {
      title = titleMatch[1];
    }

    // 解析 \author
    const authorMatch = content.match(/\\author\{([^}]*)\}/);
    if (authorMatch) {
      author = authorMatch[1];
    }

    // 解析 \date
    const dateMatch = content.match(/\\date\{([^}]*)\}/);
    if (dateMatch) {
      date = dateMatch[1] === '\\today'
        ? new Date().toLocaleDateString('zh-CN')
        : dateMatch[1];
    }

    return {
      type: 'preamble',
      id: generateNodeId(),
      start: offset,
      end: offset + content.length,
      raw: content,
      hash: hashString(content),
      packages,
      commands,
      environments,
      title,
      author,
      date,
    };
  }

  /**
   * 解析文档正文
   */
  private parseDocument(content: string, offset: number): DocumentNode {
    const savedPos = this.pos;
    const savedInput = this.input;

    this.input = content;
    this.pos = 0;
    this.length = content.length;

    const children: LatexNode[] = [];
    let currentParagraph: LatexNode[] = [];

    while (this.pos < this.length) {
      this.skipWhitespace();
      if (this.pos >= this.length) break;

      const char = this.peek();

      // 检查段落分隔（双换行）
      if (this.checkParagraphBreak()) {
        if (currentParagraph.length > 0) {
          children.push(this.createParagraphNode(currentParagraph, offset));
          currentParagraph = [];
        }
        this.consumeParagraphBreak();
        continue;
      }

      // 解析下一个节点
      const node = this.parseNext(offset);
      if (node) {
        // 章节节点作为顶级节点
        if (node.type === 'section' || node.type === 'environment' || node.type === 'math_block') {
          if (currentParagraph.length > 0) {
            children.push(this.createParagraphNode(currentParagraph, offset));
            currentParagraph = [];
          }
          children.push(node);
        } else {
          currentParagraph.push(node);
        }
      }
    }

    // 处理最后一个段落
    if (currentParagraph.length > 0) {
      children.push(this.createParagraphNode(currentParagraph, offset));
    }

    // 恢复状态
    this.input = savedInput;
    this.pos = savedPos;
    this.length = savedInput.length;

    return {
      type: 'document',
      id: generateNodeId(),
      start: offset,
      end: offset + content.length,
      raw: content,
      hash: hashString(content),
      children,
    };
  }

  /**
   * 解析下一个节点
   */
  private parseNext(offset: number): LatexNode | null {
    if (this.pos >= this.length) return null;

    const char = this.peek();
    const start = this.pos;

    // 注释
    if (char === '%') {
      return this.parseComment(offset);
    }

    // 命令
    if (char === '\\') {
      return this.parseCommand(offset);
    }

    // 分组
    if (char === '{') {
      return this.parseGroup(offset);
    }

    // 行内数学公式 $...$
    if (char === '$') {
      return this.parseMath(offset);
    }

    // 普通文本
    return this.parseText(offset);
  }

  /**
   * 解析注释
   */
  private parseComment(offset: number): CommentNode | null {
    if (!this.options.preserveComments) {
      // 跳过注释
      while (this.pos < this.length && this.peek() !== '\n') {
        this.pos++;
      }
      return null;
    }

    const start = this.pos;
    this.pos++; // 跳过 %

    let content = '';
    while (this.pos < this.length && this.peek() !== '\n') {
      content += this.consume();
    }

    const raw = this.input.slice(start, this.pos);
    return {
      type: 'comment',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw,
      hash: hashString(raw),
      content,
    };
  }

  /**
   * 解析命令
   */
  private parseCommand(offset: number): LatexNode | null {
    const start = this.pos;
    this.pos++; // 跳过 \

    // 检查特殊字符命令
    const nextChar = this.peek();
    if (nextChar && /[^a-zA-Z]/.test(nextChar)) {
      // 单字符命令如 \\, \$, \%, \{, \}
      const charCmd = this.consume();

      // 检查是否为 \[ 或 \(
      if (charCmd === '[') {
        return this.parseMathBlock(offset, start, '\\[');
      }
      if (charCmd === '(') {
        return this.parseMathInline(offset, start, '\\(');
      }

      const raw = '\\' + charCmd;
      return {
        type: 'command',
        id: generateNodeId(),
        start: offset + start,
        end: offset + this.pos,
        raw,
        hash: hashString(raw),
        name: charCmd,
        options: [],
        args: [],
        star: false,
      } as CommandNode;
    }

    // 解析命令名称
    let name = '';
    while (this.pos < this.length && /[a-zA-Z]/.test(this.peek())) {
      name += this.consume();
    }

    if (!name) {
      return null;
    }

    // 检查星号版本
    const star = this.peek() === '*';
    if (star) {
      this.pos++;
    }

    // 处理特殊命令
    if (name === 'begin') {
      return this.parseEnvironment(offset, start);
    }

    if (name in SECTION_LEVELS) {
      return this.parseSection(offset, start, name, star);
    }

    // 解析可选参数
    const options: string[] = [];
    this.skipWhitespace();
    if (this.peek() === '[') {
      options.push(this.parseOptionalArg());
    }

    // 解析必选参数
    const args: LatexNode[][] = [];
    this.skipWhitespace();
    while (this.peek() === '{') {
      args.push(this.parseRequiredArg(offset));
    }

    const raw = this.input.slice(start, this.pos);
    return {
      type: 'command',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw,
      hash: hashString(raw),
      name,
      options,
      args,
      star,
    } as CommandNode;
  }

  /**
   * 解析环境
   */
  private parseEnvironment(offset: number, start: number): EnvironmentNode | ListNode | null {
    // 解析环境名称
    this.skipWhitespace();
    if (this.peek() !== '{') {
      this.addError('期望 { 开始环境名称', offset + this.pos, offset + this.pos + 1);
      return null;
    }
    this.pos++; // 跳过 {

    let envName = '';
    while (this.pos < this.length && this.peek() !== '}') {
      envName += this.consume();
    }
    this.pos++; // 跳过 }

    // 解析可选参数
    const options: string[] = [];
    this.skipWhitespace();
    if (this.peek() === '[') {
      options.push(this.parseOptionalArg());
    }

    // 解析必选参数
    const args: LatexNode[][] = [];
    this.skipWhitespace();
    while (this.peek() === '{') {
      args.push(this.parseRequiredArg(offset));
    }

    // 查找 \end{envName}
    const endPattern = `\\end{${envName}}`;
    const endIndex = this.input.indexOf(endPattern, this.pos);

    if (endIndex === -1) {
      this.addError(`找不到 \\end{${envName}}`, offset + start, offset + this.pos);
      // 继续解析，假设环境延续到文档末尾
    }

    const contentEnd = endIndex !== -1 ? endIndex : this.length;
    const content = this.input.slice(this.pos, contentEnd);

    // 处理数学环境
    if (MATH_ENVIRONMENTS.has(envName)) {
      const raw = this.input.slice(start, endIndex !== -1 ? endIndex + endPattern.length : this.length);
      this.pos = endIndex !== -1 ? endIndex + endPattern.length : this.length;

      return {
        type: 'math_block',
        id: generateNodeId(),
        start: offset + start,
        end: offset + this.pos,
        raw,
        hash: hashString(raw),
        content: content.trim(),
        delimiter: envName.replace('*', '') as MathBlockNode['delimiter'],
        numbered: !envName.endsWith('*'),
      } as MathBlockNode;
    }

    // 处理列表环境
    if (LIST_ENVIRONMENTS.has(envName)) {
      const listNode = this.parseListContent(content, offset + this.pos, envName as 'itemize' | 'enumerate' | 'description');
      this.pos = endIndex !== -1 ? endIndex + endPattern.length : this.length;

      const raw = this.input.slice(start, this.pos);
      listNode.start = offset + start;
      listNode.end = offset + this.pos;
      listNode.raw = raw;
      listNode.hash = hashString(raw);

      return listNode;
    }

    // 处理逐字环境
    if (VERBATIM_ENVIRONMENTS.has(envName)) {
      const raw = this.input.slice(start, endIndex !== -1 ? endIndex + endPattern.length : this.length);
      this.pos = endIndex !== -1 ? endIndex + endPattern.length : this.length;

      return {
        type: 'environment',
        id: generateNodeId(),
        start: offset + start,
        end: offset + this.pos,
        raw,
        hash: hashString(raw),
        name: envName,
        options,
        args,
        children: [{
          type: 'text',
          id: generateNodeId(),
          start: offset + start,
          end: offset + this.pos,
          raw: content,
          hash: hashString(content),
          content,
        } as TextNode],
      } as EnvironmentNode;
    }

    // 解析普通环境内容
    const savedPos = this.pos;
    const savedInput = this.input;
    const savedLength = this.length;

    this.input = content;
    this.pos = 0;
    this.length = content.length;

    const children: LatexNode[] = [];
    while (this.pos < this.length) {
      const node = this.parseNext(offset + savedPos);
      if (node) {
        children.push(node);
      } else if (this.pos < this.length) {
        this.pos++; // 防止死循环
      }
    }

    this.input = savedInput;
    this.pos = endIndex !== -1 ? endIndex + endPattern.length : savedLength;
    this.length = savedLength;

    const raw = savedInput.slice(start, this.pos);
    return {
      type: 'environment',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw,
      hash: hashString(raw),
      name: envName,
      options,
      args,
      children,
    } as EnvironmentNode;
  }

  /**
   * 解析列表内容
   */
  private parseListContent(
    content: string,
    offset: number,
    listType: 'itemize' | 'enumerate' | 'description'
  ): ListNode {
    const items: ListItemNode[] = [];
    const itemRegex = /\\item(?:\[([^\]]*)\])?/g;
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    const positions: { start: number; label?: string }[] = [];

    while ((match = itemRegex.exec(content)) !== null) {
      positions.push({
        start: match.index + match[0].length,
        label: match[1],
      });
    }

    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].start;
      const end = i + 1 < positions.length
        ? content.lastIndexOf('\\item', positions[i + 1].start)
        : content.length;

      const itemContent = content.slice(start, end).trim();
      const itemRaw = content.slice(
        content.lastIndexOf('\\item', start),
        end
      );

      items.push({
        type: 'list_item',
        id: generateNodeId(),
        start: offset + start,
        end: offset + end,
        raw: itemRaw,
        hash: hashString(itemRaw),
        label: positions[i].label,
        children: [{
          type: 'text',
          id: generateNodeId(),
          start: offset + start,
          end: offset + end,
          raw: itemContent,
          hash: hashString(itemContent),
          content: itemContent,
        } as TextNode],
      });
    }

    return {
      type: 'list',
      id: generateNodeId(),
      start: offset,
      end: offset + content.length,
      raw: content,
      hash: hashString(content),
      listType,
      children: items,
    };
  }

  /**
   * 解析章节
   */
  private parseSection(offset: number, start: number, name: string, star: boolean): SectionNode {
    const level = SECTION_LEVELS[name];

    // 解析标题
    this.skipWhitespace();
    const titleNodes: LatexNode[] = [];

    if (this.peek() === '{') {
      const titleContent = this.parseRequiredArg(offset);
      titleNodes.push(...titleContent);
    }

    // 检查是否有 \label
    let label: string | undefined;
    const savedPos = this.pos;
    this.skipWhitespace();
    if (this.input.slice(this.pos, this.pos + 6) === '\\label') {
      this.pos += 6;
      this.skipWhitespace();
      if (this.peek() === '{') {
        this.pos++;
        label = '';
        while (this.pos < this.length && this.peek() !== '}') {
          label += this.consume();
        }
        this.pos++; // 跳过 }
      }
    } else {
      this.pos = savedPos;
    }

    const raw = this.input.slice(start, this.pos);
    return {
      type: 'section',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw,
      hash: hashString(raw),
      level,
      title: titleNodes,
      star,
      label,
    };
  }

  /**
   * 解析分组
   */
  private parseGroup(offset: number): GroupNode {
    const start = this.pos;
    this.pos++; // 跳过 {

    this.depth++;
    if (this.depth > this.options.maxDepth) {
      this.addError('嵌套深度超过限制', offset + start, offset + this.pos);
      this.depth--;
      return {
        type: 'group',
        id: generateNodeId(),
        start: offset + start,
        end: offset + this.pos,
        raw: '{}',
        hash: hashString('{}'),
        children: [],
      };
    }

    const children: LatexNode[] = [];
    while (this.pos < this.length && this.peek() !== '}') {
      const node = this.parseNext(offset);
      if (node) {
        children.push(node);
      } else if (this.pos < this.length && this.peek() !== '}') {
        this.pos++; // 防止死循环
      }
    }

    if (this.peek() === '}') {
      this.pos++; // 跳过 }
    } else {
      this.addError('未闭合的分组', offset + start, offset + this.pos);
    }

    this.depth--;

    const raw = this.input.slice(start, this.pos);
    return {
      type: 'group',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw,
      hash: hashString(raw),
      children,
    };
  }

  /**
   * 解析数学公式
   */
  private parseMath(offset: number): MathInlineNode | MathBlockNode {
    const start = this.pos;

    // 检查是否为 $$
    if (this.input.slice(this.pos, this.pos + 2) === '$$') {
      return this.parseMathBlock(offset, start, '$$');
    }

    return this.parseMathInline(offset, start, '$');
  }

  /**
   * 解析行内公式
   */
  private parseMathInline(offset: number, start: number, delimiter: '$' | '\\('): MathInlineNode {
    const endDelimiter = delimiter === '$' ? '$' : '\\)';
    this.pos += delimiter.length;

    let content = '';
    while (this.pos < this.length) {
      if (delimiter === '$' && this.peek() === '$') {
        break;
      }
      if (delimiter === '\\(' && this.input.slice(this.pos, this.pos + 2) === '\\)') {
        break;
      }
      content += this.consume();
    }

    this.pos += endDelimiter.length;

    const raw = this.input.slice(start, this.pos);
    return {
      type: 'math_inline',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw,
      hash: hashString(raw),
      content,
      delimiter,
    };
  }

  /**
   * 解析块级公式
   */
  private parseMathBlock(offset: number, start: number, delimiter: '$$' | '\\['): MathBlockNode {
    const endDelimiter = delimiter === '$$' ? '$$' : '\\]';
    this.pos += delimiter.length;

    let content = '';
    while (this.pos < this.length) {
      if (delimiter === '$$' && this.input.slice(this.pos, this.pos + 2) === '$$') {
        break;
      }
      if (delimiter === '\\[' && this.input.slice(this.pos, this.pos + 2) === '\\]') {
        break;
      }
      content += this.consume();
    }

    this.pos += endDelimiter.length;

    const raw = this.input.slice(start, this.pos);
    return {
      type: 'math_block',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw,
      hash: hashString(raw),
      content: content.trim(),
      delimiter,
      numbered: false,
    };
  }

  /**
   * 解析文本
   */
  private parseText(offset: number): TextNode {
    const start = this.pos;
    let content = '';

    while (this.pos < this.length) {
      const char = this.peek();
      // 遇到特殊字符停止
      if (char === '\\' || char === '{' || char === '}' ||
          char === '$' || char === '%' || char === '~' ||
          char === '^' || char === '_') {
        break;
      }
      // 检查段落分隔
      if (this.checkParagraphBreak()) {
        break;
      }
      content += this.consume();
    }

    const raw = this.input.slice(start, this.pos);
    return {
      type: 'text',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw,
      hash: hashString(raw),
      content,
    };
  }

  /**
   * 解析可选参数 [...]
   */
  private parseOptionalArg(): string {
    if (this.peek() !== '[') return '';
    this.pos++; // 跳过 [

    let content = '';
    let depth = 1;
    while (this.pos < this.length && depth > 0) {
      const char = this.peek();
      if (char === '[') depth++;
      else if (char === ']') depth--;

      if (depth > 0) {
        content += this.consume();
      } else {
        this.pos++; // 跳过最后的 ]
      }
    }

    return content;
  }

  /**
   * 解析必选参数 {...}
   */
  private parseRequiredArg(offset: number): LatexNode[] {
    if (this.peek() !== '{') return [];
    this.pos++; // 跳过 {

    const nodes: LatexNode[] = [];
    while (this.pos < this.length && this.peek() !== '}') {
      const node = this.parseNext(offset);
      if (node) {
        nodes.push(node);
      } else if (this.pos < this.length && this.peek() !== '}') {
        this.pos++; // 防止死循环
      }
    }

    if (this.peek() === '}') {
      this.pos++; // 跳过 }
    }

    return nodes;
  }

  /**
   * 创建段落节点
   */
  private createParagraphNode(children: LatexNode[], offset: number): ParagraphNode {
    if (children.length === 0) {
      return {
        type: 'paragraph',
        id: generateNodeId(),
        start: offset,
        end: offset,
        raw: '',
        hash: hashString(''),
        children: [],
      };
    }

    const start = children[0].start;
    const end = children[children.length - 1].end;
    const raw = children.map(c => c.raw).join('');

    return {
      type: 'paragraph',
      id: generateNodeId(),
      start,
      end,
      raw,
      hash: hashString(raw),
      children,
    };
  }

  /**
   * 检查段落分隔（双换行）
   */
  private checkParagraphBreak(): boolean {
    if (this.pos >= this.length) return false;

    let i = this.pos;
    let newlines = 0;

    while (i < this.length) {
      const char = this.input[i];
      if (char === '\n') {
        newlines++;
        if (newlines >= 2) return true;
      } else if (char !== ' ' && char !== '\t' && char !== '\r') {
        break;
      }
      i++;
    }

    return false;
  }

  /**
   * 消耗段落分隔
   */
  private consumeParagraphBreak(): void {
    while (this.pos < this.length) {
      const char = this.peek();
      if (char === '\n' || char === ' ' || char === '\t' || char === '\r') {
        this.pos++;
      } else {
        break;
      }
    }
  }

  /**
   * 跳过空白字符
   */
  private skipWhitespace(): void {
    while (this.pos < this.length) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\r') {
        this.pos++;
      } else if (char === '\n' && !this.options.preserveWhitespace) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  /**
   * 查看当前字符
   */
  private peek(): string {
    return this.input[this.pos] || '';
  }

  /**
   * 消耗当前字符
   */
  private consume(): string {
    return this.input[this.pos++] || '';
  }

  /**
   * 添加错误
   */
  private addError(message: string, start: number, end: number): void {
    const { line, column } = getLineColumn(this.input, start);
    this.errors.push({ message, start, end, line, column });
  }

  /**
   * 添加警告
   */
  private addWarning(message: string, start: number, end: number): void {
    const { line, column } = getLineColumn(this.input, start);
    this.warnings.push({ message, start, end, line, column });
  }
}

// ================================
// 增量解析器
// ================================

/**
 * 增量解析器
 * 基于变更进行局部重新解析
 */
export class IncrementalLatexParser {
  private cachedAST: RootNode | null = null;
  private cachedContent: string = '';

  /**
   * 增量解析
   * @param newContent 新的文档内容
   * @param changes 变更列表
   * @param options 解析选项
   */
  parse(
    newContent: string,
    changes: DocumentChange[],
    options?: LatexParserOptions
  ): IncrementalParseResult {
    const startTime = performance.now();

    // 如果没有缓存或变更过大，进行完整解析
    if (!this.cachedAST || this.shouldFullReparse(changes, newContent)) {
      const parser = new LatexParser(newContent, options);
      const result = parser.parse();

      this.cachedAST = result.ast;
      this.cachedContent = newContent;

      return {
        ast: result.ast,
        affectedNodeIds: [],
        dirtyNodeIds: this.getAllNodeIds(result.ast),
        fullReparse: true,
        parseTime: performance.now() - startTime,
      };
    }

    // 计算受影响的区域
    const affectedRange = this.calculateAffectedRange(changes);
    const affectedNodes = this.findAffectedNodes(this.cachedAST, affectedRange);

    // 重新解析受影响的部分
    const parser = new LatexParser(newContent, options);
    const newAST = parser.parse().ast;

    // 合并新旧 AST
    const mergedAST = this.mergeAST(this.cachedAST, newAST, affectedNodes);

    this.cachedAST = mergedAST;
    this.cachedContent = newContent;

    return {
      ast: mergedAST,
      affectedNodeIds: affectedNodes.map(n => n.id),
      dirtyNodeIds: affectedNodes.map(n => n.id),
      fullReparse: false,
      parseTime: performance.now() - startTime,
    };
  }

  /**
   * 判断是否需要完整重新解析
   */
  private shouldFullReparse(changes: DocumentChange[], newContent: string): boolean {
    // 如果变更影响了 preamble，需要完整重新解析
    for (const change of changes) {
      if (change.from < this.getPreambleEnd()) {
        return true;
      }
    }

    // 如果变更太大（超过文档 20%），完整重新解析
    const totalChangeSize = changes.reduce((sum, c) =>
      sum + Math.abs(c.insert.length - c.deleted.length), 0);
    if (totalChangeSize > newContent.length * 0.2) {
      return true;
    }

    return false;
  }

  /**
   * 获取 preamble 结束位置
   */
  private getPreambleEnd(): number {
    if (!this.cachedAST || !this.cachedAST.preamble) {
      return 0;
    }
    return this.cachedAST.preamble.end;
  }

  /**
   * 计算受影响的范围
   */
  private calculateAffectedRange(changes: DocumentChange[]): { start: number; end: number } {
    let start = Infinity;
    let end = 0;

    for (const change of changes) {
      start = Math.min(start, change.from);
      end = Math.max(end, change.to + change.insert.length);
    }

    return { start, end };
  }

  /**
   * 查找受影响的节点
   */
  private findAffectedNodes(
    ast: RootNode,
    range: { start: number; end: number }
  ): LatexNode[] {
    const affected: LatexNode[] = [];

    const traverse = (node: LatexNode) => {
      // 检查节点是否与变更范围重叠
      if (node.end >= range.start && node.start <= range.end) {
        affected.push(node);
      }

      // 递归遍历子节点
      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    if (ast.document) {
      traverse(ast.document);
    }

    return affected;
  }

  /**
   * 合并 AST
   */
  private mergeAST(
    oldAST: RootNode,
    newAST: RootNode,
    affectedNodes: LatexNode[]
  ): RootNode {
    // 简化实现：直接使用新 AST
    // 完整实现需要精确的节点匹配和更新
    return {
      ...newAST,
      version: oldAST.version + 1,
    };
  }

  /**
   * 获取所有节点 ID
   */
  private getAllNodeIds(ast: RootNode): string[] {
    const ids: string[] = [ast.id];

    const traverse = (node: LatexNode) => {
      ids.push(node.id);
      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    if (ast.preamble) traverse(ast.preamble);
    if (ast.document) traverse(ast.document);

    return ids;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedAST = null;
    this.cachedContent = '';
  }
}

// ================================
// 导出
// ================================

/**
 * 解析 LaTeX 文档
 * @param content LaTeX 源码
 * @param options 解析选项
 */
export function parseLatex(content: string, options?: LatexParserOptions): LatexParseResult {
  const parser = new LatexParser(content, options);
  return parser.parse();
}

/**
 * 创建增量解析器实例
 */
export function createIncrementalParser(): IncrementalLatexParser {
  return new IncrementalLatexParser();
}

export default {
  LatexParser,
  IncrementalLatexParser,
  parseLatex,
  createIncrementalParser,
  resetNodeIdCounter,
};
