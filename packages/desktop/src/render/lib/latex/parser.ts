// ================================
// LaTeX 解析器
// 采用两阶段解析：1. Preamble 解析 2. 正文解析
// 增量引擎按块调用：前言块与每个正文块分别独立解析（块内相对坐标）
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
  PackageInfo,
  MacroDefinition,
  LatexParserOptions,
  LatexParseResult,
} from './types';
import { findClosingBrace, isAccentSymbol, isAccentWord } from './text-symbols';

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

/**
 * 从 from 开始查找与当前环境配对的 \end{name}：同名的 \begin{name} 使深度加一，未找到返回 -1
 */
function findEnvironmentEnd(input: string, from: number, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\\\(begin|end)\\{${escaped}\\}`, 'g');
  pattern.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    depth += match[1] === 'begin' ? 1 : -1;
    if (depth === 0) return match.index;
  }
  return -1;
}

/**
 * 读取前言中 `\name[可选]{参数}` 的必选参数（花括号配对，忽略被注释掉的行）；
 * 未出现时返回 undefined
 */
function readCommandArgument(content: string, name: string): string | undefined {
  const pattern = new RegExp(`\\\\${name}(?![a-zA-Z])\\s*(?:\\[[^\\]]*\\])?\\s*\\{`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    if (/(^|[^\\])%/.test(content.slice(lineStart, match.index))) continue;
    const open = match.index + match[0].length;
    const close = findClosingBrace(content, open);
    return content.slice(open, close === -1 ? content.length : close);
  }
  return undefined;
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
  private errors: string[];
  private depth: number;

  constructor(input: string, options?: LatexParserOptions) {
    this.input = input;
    this.pos = 0;
    this.length = input.length;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.errors = [];
    this.depth = 0;
  }

  /**
   * 从 pos（反斜杠处）解析一个命令，返回节点与结束位置。
   * 渲染器处理原文片段（列表项、标题、环境内容）时用它，保证与正文 AST 走同一套命令解析与渲染
   */
  static parseCommandAt(input: string, pos: number): { node: LatexNode | null; end: number } {
    const parser = new LatexParser(input);
    parser.pos = pos;
    const node = parser.parseCommand(0);
    return { node, end: Math.max(parser.pos, pos + 1) };
  }

  /**
   * 解析整个文档
   */
  parse(): LatexParseResult {
    this.errors = [];
    this.pos = 0;
    this.depth = 0;

    try {
      return { ast: this.parseRoot(), errors: this.errors };
    } catch (error) {
      this.errors.push(error instanceof Error ? error.message : String(error));
      // 返回一个最小的有效 AST
      return { ast: this.createRootNode(null, null), errors: this.errors };
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

    // \title / \author / \date 的参数常含嵌套命令（\textbf{..}、\thanks{..}），按花括号配对读取
    title = readCommandArgument(content, 'title');
    author = readCommandArgument(content, 'author');
    date = readCommandArgument(content, 'date');

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
      // 段落分隔（空行）先于空白跳过判断，否则空行会被当作普通空白吞掉
      if (this.checkParagraphBreak()) {
        if (currentParagraph.length > 0) {
          children.push(this.createParagraphNode(currentParagraph, offset));
          currentParagraph = [];
        }
        this.consumeParagraphBreak();
        continue;
      }

      // 只跳过段首空白；段内节点之间的空格是正文的一部分（\% \& 之间、\textbf{x} 之后）
      if (currentParagraph.length === 0) {
        this.skipWhitespace();
        if (this.pos >= this.length) break;
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

      // 单字符重音（\'e、\"{o}、\^\i）：被修饰的字符作为参数读入，渲染时合成为带重音的字符
      const args = isAccentSymbol(charCmd) ? [this.parseAccentArgument(offset)] : [];
      const raw = this.input.slice(start, this.pos);
      return {
        type: 'command',
        id: generateNodeId(),
        start: offset + start,
        end: offset + this.pos,
        raw,
        hash: hashString(raw),
        name: charCmd,
        options: [],
        args,
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
    this.skipArgumentWhitespace();
    if (this.peek() === '[') {
      options.push(this.parseOptionalArg());
    }

    // 解析必选参数
    const args: LatexNode[][] = [];
    this.skipArgumentWhitespace();
    while (this.peek() === '{') {
      args.push(this.parseRequiredArg(offset));
    }

    // 字母重音的参数也可以不加花括号：\c c、\v s
    if (isAccentWord(name) && args.length === 0) {
      args.push(this.parseAccentArgument(offset));
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
   * 读取重音命令的参数（{x}、\i 等控制词或下一个字符）；参数为单个文本/命令节点，读不到时为空
   */
  private parseAccentArgument(offset: number): LatexNode[] {
    while (this.peek() === ' ') this.pos++;
    const char = this.peek();
    if (!char || char === '}' || char === '\n') return [];
    if (char === '{') return this.parseRequiredArg(offset);
    if (char === '\\') {
      const node = this.parseCommand(offset);
      return node ? [node] : [];
    }
    const start = this.pos;
    const text = String.fromCodePoint(this.input.codePointAt(start)!);
    this.pos += text.length;
    return [{
      type: 'text',
      id: generateNodeId(),
      start: offset + start,
      end: offset + this.pos,
      raw: text,
      hash: hashString(text),
      content: text,
    } as TextNode];
  }

  /**
   * 解析环境
   */
  private parseEnvironment(
    offset: number,
    start: number
  ): EnvironmentNode | ListNode | MathBlockNode | null {
    // 解析环境名称
    this.skipWhitespace();
    if (this.peek() !== '{') {
      this.errors.push('期望 { 开始环境名称');
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

    // 查找配对的 \end{envName}（同名环境可以嵌套：枚举中的枚举）
    const endPattern = `\\end{${envName}}`;
    const endIndex = findEnvironmentEnd(this.input, this.pos, envName);

    if (endIndex === -1) {
      this.errors.push(`找不到 \\end{${envName}}`);
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
        delimiter: envName.replace('*', ''),
        numbered: !envName.endsWith('*'),
      };
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
    // 只在本层切分 \item：嵌套环境（子列表）内的 \item 属于子列表；\itemsep 等不是条目
    const tokenRegex = /\\(begin|end)\s*\{[^}]*\}|\\item(?![a-zA-Z])(?:\s*\[([^\]]*)\])?/g;
    let match: RegExpExecArray | null;
    const positions: { itemStart: number; start: number; label?: string }[] = [];
    let depth = 0;

    while ((match = tokenRegex.exec(content)) !== null) {
      if (match[1] === 'begin') depth++;
      else if (match[1] === 'end') depth = Math.max(0, depth - 1);
      else if (depth === 0) {
        positions.push({ itemStart: match.index, start: match.index + match[0].length, label: match[2] });
      }
    }

    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].start;
      const end = i + 1 < positions.length ? positions[i + 1].itemStart : content.length;

      const itemContent = content.slice(start, end).trim();
      const itemRaw = content.slice(positions[i].itemStart, end);

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
      this.errors.push('嵌套深度超过限制');
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
      this.errors.push('未闭合的分组');
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

    // 顶层的 } ~ ^ _ 没有专门的解析分支：至少消耗一个字符作为文本，否则调用方会原地死循环
    if (this.pos === start && this.pos < this.length) {
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
   * 命令与参数之间的空白：与 TeX 一致，只跳过空格和至多一个换行，不跨过空行（空行是段落分隔）
   */
  private skipArgumentWhitespace(): void {
    const isBlank = (char: string | undefined) => char === ' ' || char === '\t' || char === '\r';
    let pos = this.pos;
    while (isBlank(this.input[pos])) pos++;
    if (this.input[pos] === '\n') {
      let next = pos + 1;
      while (isBlank(this.input[next])) next++;
      if (this.input[next] !== '\n') pos = next;
    }
    this.pos = pos;
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

}
