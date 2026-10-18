// ================================
// CommonMark 规范解析器
// 完全自主实现，不依赖第三方库
// 支持链接、图片、HTML 标签、强调等
// ================================

// ================================
// 类型定义
// ================================

/** 内联元素类型 */
export const enum InlineType {
  Text = 'text',
  Bold = 'bold',
  Italic = 'italic',
  BoldItalic = 'bold_italic',
  Strikethrough = 'strikethrough',
  Code = 'code',
  Link = 'link',
  Image = 'image',
  AutoLink = 'autolink',
  HtmlTag = 'html_tag',
  LineBreak = 'line_break',
  SoftBreak = 'soft_break',
  Escape = 'escape',
  /** 脚注引用 */
  FootnoteRef = 'footnote_ref',
}

/** 块级元素类型 */
export const enum BlockType {
  Document = 'document',
  Paragraph = 'paragraph',
  Heading = 'heading',
  CodeBlock = 'code_block',
  FencedCode = 'fenced_code',
  Blockquote = 'blockquote',
  List = 'list',
  ListItem = 'list_item',
  ThematicBreak = 'thematic_break',
  HtmlBlock = 'html_block',
  BlankLine = 'blank_line',
  /** GFM 表格 */
  Table = 'table',
  /** 表格行 */
  TableRow = 'table_row',
  /** 表格单元格 */
  TableCell = 'table_cell',
  /** 任务列表项 */
  TaskListItem = 'task_list_item',
  /** 脚注定义块 */
  FootnoteDefinition = 'footnote_definition',
}

/** 表格对齐方式 */
export type TableAlignment = 'left' | 'center' | 'right' | null;

/** 表格单元格节点 */
export interface TableCellNode extends BlockNode {
  type: BlockType.TableCell;
  /** 是否为表头单元格 */
  isHeader: boolean;
  /** 对齐方式 */
  alignment: TableAlignment;
}

/** 表格行节点 */
export interface TableRowNode extends BlockNode {
  type: BlockType.TableRow;
  /** 是否为表头行 */
  isHeader: boolean;
  /** 单元格列表 */
  cells: TableCellNode[];
}

/** 表格节点 */
export interface TableNode extends BlockNode {
  type: BlockType.Table;
  /** 列对齐方式 */
  alignments: TableAlignment[];
  /** 表头行 */
  header: TableRowNode;
  /** 数据行 */
  rows: TableRowNode[];
}

/** 位置信息 */
export interface Position {
  /** 起始偏移（字符） */
  start: number;
  /** 结束偏移（字符） */
  end: number;
  /** 起始行（1-based） */
  startLine: number;
  /** 起始列（1-based） */
  startColumn: number;
  /** 结束行 */
  endLine: number;
  /** 结束列 */
  endColumn: number;
}

/** 内联节点 */
export interface InlineNode {
  type: InlineType;
  content: string;
  position: Position;
  /** 链接/图片 URL */
  url?: string;
  /** 链接/图片标题 */
  title?: string;
  /** 图片 alt 文本 */
  alt?: string;
  /** HTML 标签名 */
  tagName?: string;
  /** HTML 属性 */
  attributes?: Record<string, string>;
  /** 子节点 */
  children?: InlineNode[];
  /** 脚注引用标识符 */
  footnoteId?: string;
  /** 脚注引用索引 */
  footnoteIndex?: number;
}

/** 块级节点 */
export interface BlockNode {
  type: BlockType;
  position: Position;
  /** 原始文本 */
  raw: string;
  /** 标题级别 (1-6) */
  level?: number;
  /** 代码块语言 */
  language?: string;
  /** 列表是否有序 */
  ordered?: boolean;
  /** 列表起始数字 */
  start?: number;
  /** 列表标记字符 */
  marker?: string;
  /** 是否紧凑列表 */
  tight?: boolean;
  /** 子块节点 */
  children?: BlockNode[];
  /** 内联节点（用于段落、标题等） */
  inline?: InlineNode[];
  /** 纯文本内容 */
  content?: string;
  /** 任务列表项是否已完成 */
  checked?: boolean;
  /** 脚注标识符 */
  footnoteId?: string;
  /** 脚注索引（用于显示） */
  footnoteIndex?: number;
}

/** 解析选项 */
export interface CommonMarkOptions {
  /** 是否启用 GFM 扩展 */
  gfm?: boolean;
  /** 是否解析 HTML */
  html?: boolean;
  /** 是否启用删除线 */
  strikethrough?: boolean;
  /** 是否启用自动链接 */
  autolink?: boolean;
  /** 是否启用智能标点 */
  smartPunctuation?: boolean;
  /** 是否启用硬换行 */
  hardBreaks?: boolean;
  /** 最大嵌套深度 */
  maxNestingDepth?: number;
}

/** 默认选项 */
const DEFAULT_OPTIONS: Required<CommonMarkOptions> = {
  gfm: true,
  html: true,
  strikethrough: true,
  autolink: true,
  smartPunctuation: false,
  hardBreaks: false,
  maxNestingDepth: 100,
};

/** 解析结果 */
export interface ParseResult {
  /** 根节点 */
  document: BlockNode;
  /** 解析耗时（毫秒） */
  duration: number;
  /** 解析警告 */
  warnings: ParseWarning[];
}

/** 解析警告 */
export interface ParseWarning {
  message: string;
  line: number;
  column: number;
}

// ================================
// 字符常量
// ================================

const CHAR_NEWLINE = 10; // \n
const CHAR_CR = 13; // \r
const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_BACKTICK = 96; // `
const CHAR_TILDE = 126; // ~
const CHAR_ASTERISK = 42; // *
const CHAR_UNDERSCORE = 95; // _
const CHAR_HYPHEN = 45; // -
const CHAR_BRACKET_OPEN = 91; // [
const CHAR_BRACKET_CLOSE = 93; // ]
const CHAR_PAREN_OPEN = 40; // (
const CHAR_PAREN_CLOSE = 41; // )
const CHAR_EXCLAMATION = 33; // !
const CHAR_LESS_THAN = 60; // <
const CHAR_GREATER = 62; // >
const CHAR_BACKSLASH = 92; // \
const CHAR_QUOTE_DOUBLE = 34; // "
const CHAR_QUOTE_SINGLE = 39; // '
const CHAR_EQUALS = 61; // =
const CHAR_SLASH = 47; // /

// 可转义字符集
const ESCAPABLE_CHARS = new Set([
  '\\',
  '`',
  '*',
  '_',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '#',
  '+',
  '-',
  '.',
  '!',
  '|',
  '<',
  '>',
  '~',
]);

// HTML 块级标签
const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'pre',
  'script',
  'section',
  'source',
  'style',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
]);

// HTML 自闭合标签
const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// ================================
// 工具函数
// ================================

/** 判断是否为空白字符 */
function isWhitespace(code: number): boolean {
  return code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_NEWLINE || code === CHAR_CR;
}

/** 判断是否为行尾 */
function isLineEnd(code: number): boolean {
  return code === CHAR_NEWLINE || code === CHAR_CR;
}

/** 判断是否为数字 */
function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** 判断是否为字母 */
function isAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** 判断是否为字母或数字 */
function isAlphaNumeric(code: number): boolean {
  return isAlpha(code) || isDigit(code);
}

/** 判断是否为 Unicode 标点符号 */
function isPunctuation(code: number): boolean {
  return (
    (code >= 33 && code <= 47) || // ! " # $ % & ' ( ) * + , - . /
    (code >= 58 && code <= 64) || // : ; < = > ? @
    (code >= 91 && code <= 96) || // [ \ ] ^ _ `
    (code >= 123 && code <= 126) // { | } ~
  );
}

/** 创建位置信息 */
function createPosition(
  start: number,
  end: number,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): Position {
  return { start, end, startLine, startColumn, endLine, endColumn };
}

// ================================
// 内联解析器
// ================================

/**
 * 内联元素解析器
 * 解析段落、标题等内的内联元素
 */
class InlineParser {
  private input: string = '';
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private options: Required<CommonMarkOptions>;

  constructor(options: Required<CommonMarkOptions>) {
    this.options = options;
  }

  /**
   * 解析内联内容
   */
  parse(input: string, startLine: number = 1): InlineNode[] {
    this.input = input;
    this.pos = 0;
    this.line = startLine;
    this.column = 1;

    const nodes: InlineNode[] = [];
    let textBuffer = '';
    let textStart = 0;

    while (this.pos < this.input.length) {
      const char = this.peek();

      // 转义字符
      if (char === CHAR_BACKSLASH && this.pos + 1 < this.input.length) {
        const nextChar = String.fromCharCode(this.input.charCodeAt(this.pos + 1));
        if (ESCAPABLE_CHARS.has(nextChar)) {
          if (textBuffer) {
            nodes.push(this.createTextNode(textBuffer, textStart));
            textBuffer = '';
          }
          this.advance();
          textStart = this.pos;
          textBuffer = nextChar;
          this.advance();
          continue;
        }
      }

      // 行内代码
      if (char === CHAR_BACKTICK) {
        if (textBuffer) {
          nodes.push(this.createTextNode(textBuffer, textStart));
          textBuffer = '';
        }
        const codeNode = this.parseInlineCode();
        if (codeNode) {
          nodes.push(codeNode);
          textStart = this.pos;
          continue;
        }
      }

      // 强调（粗体/斜体）
      if (char === CHAR_ASTERISK || char === CHAR_UNDERSCORE) {
        if (textBuffer) {
          nodes.push(this.createTextNode(textBuffer, textStart));
          textBuffer = '';
        }
        const emphNodes = this.parseEmphasis();
        if (emphNodes.length > 0) {
          nodes.push(...emphNodes);
          textStart = this.pos;
          continue;
        }
      }

      // 删除线（GFM）
      if (this.options.strikethrough && char === CHAR_TILDE) {
        if (textBuffer) {
          nodes.push(this.createTextNode(textBuffer, textStart));
          textBuffer = '';
        }
        const strikeNode = this.parseStrikethrough();
        if (strikeNode) {
          nodes.push(strikeNode);
          textStart = this.pos;
          continue;
        }
      }

      // 脚注引用 [^id]
      if (this.options.gfm && char === CHAR_BRACKET_OPEN && this.peekAt(1) === 0x5e) {
        // 0x5e = '^'
        if (textBuffer) {
          nodes.push(this.createTextNode(textBuffer, textStart));
          textBuffer = '';
        }
        const footnoteRef = this.parseFootnoteRef();
        if (footnoteRef) {
          nodes.push(footnoteRef);
          textStart = this.pos;
          continue;
        }
      }

      // 链接或图片
      if (
        char === CHAR_BRACKET_OPEN ||
        (char === CHAR_EXCLAMATION && this.peekAt(1) === CHAR_BRACKET_OPEN)
      ) {
        if (textBuffer) {
          nodes.push(this.createTextNode(textBuffer, textStart));
          textBuffer = '';
        }
        const linkOrImage = this.parseLinkOrImage();
        if (linkOrImage) {
          nodes.push(linkOrImage);
          textStart = this.pos;
          continue;
        }
      }

      // 自动链接 <url> 或 <email>
      if (this.options.autolink && char === CHAR_LESS_THAN) {
        if (textBuffer) {
          nodes.push(this.createTextNode(textBuffer, textStart));
          textBuffer = '';
        }
        const autoLink = this.parseAutoLink();
        if (autoLink) {
          nodes.push(autoLink);
          textStart = this.pos;
          continue;
        }
      }

      // HTML 标签
      if (this.options.html && char === CHAR_LESS_THAN) {
        if (textBuffer) {
          nodes.push(this.createTextNode(textBuffer, textStart));
          textBuffer = '';
        }
        const htmlTag = this.parseHtmlTag();
        if (htmlTag) {
          nodes.push(htmlTag);
          textStart = this.pos;
          continue;
        }
      }

      // 硬换行（两个空格 + 换行）
      if (char === CHAR_SPACE && this.options.hardBreaks) {
        if (this.peekAt(1) === CHAR_SPACE && isLineEnd(this.peekAt(2))) {
          if (textBuffer) {
            nodes.push(this.createTextNode(textBuffer, textStart));
            textBuffer = '';
          }
          this.advance();
          this.advance();
          this.advance();
          nodes.push({
            type: InlineType.LineBreak,
            content: '\n',
            position: this.createCurrentPosition(2),
          });
          textStart = this.pos;
          continue;
        }
      }

      // 软换行
      if (isLineEnd(char)) {
        if (textBuffer) {
          nodes.push(this.createTextNode(textBuffer, textStart));
          textBuffer = '';
        }
        this.advance();
        if (char === CHAR_CR && this.peek() === CHAR_NEWLINE) {
          this.advance();
        }
        nodes.push({
          type: InlineType.SoftBreak,
          content: '\n',
          position: this.createCurrentPosition(1),
        });
        textStart = this.pos;
        continue;
      }

      // 普通文本
      if (!textBuffer) {
        textStart = this.pos;
      }
      textBuffer += String.fromCharCode(char);
      this.advance();
    }

    // 处理剩余文本
    if (textBuffer) {
      nodes.push(this.createTextNode(textBuffer, textStart));
    }

    return nodes;
  }

  /** 获取当前字符码 */
  private peek(): number {
    return this.pos < this.input.length ? this.input.charCodeAt(this.pos) : -1;
  }

  /** 获取指定偏移处的字符码 */
  private peekAt(offset: number): number {
    const pos = this.pos + offset;
    return pos < this.input.length ? this.input.charCodeAt(pos) : -1;
  }

  /** 前进一个字符 */
  private advance(): void {
    if (this.pos < this.input.length) {
      if (this.input.charCodeAt(this.pos) === CHAR_NEWLINE) {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      this.pos++;
    }
  }

  /** 创建文本节点 */
  private createTextNode(text: string, startPos: number): InlineNode {
    return {
      type: InlineType.Text,
      content: text,
      position: createPosition(
        startPos,
        this.pos,
        this.line,
        this.column - text.length,
        this.line,
        this.column
      ),
    };
  }

  /** 创建当前位置信息 */
  private createCurrentPosition(length: number): Position {
    return createPosition(
      this.pos - length,
      this.pos,
      this.line,
      this.column - length,
      this.line,
      this.column
    );
  }

  /** 解析行内代码 */
  private parseInlineCode(): InlineNode | null {
    const startPos = this.pos;
    const startColumn = this.column;
    let backtickCount = 0;

    // 计算开始反引号数量
    while (this.peek() === CHAR_BACKTICK) {
      backtickCount++;
      this.advance();
    }

    const contentStart = this.pos;

    // 寻找匹配的结束反引号
    while (this.pos < this.input.length) {
      if (this.peek() === CHAR_BACKTICK) {
        let endCount = 0;
        const endPos = this.pos;

        while (this.peek() === CHAR_BACKTICK) {
          endCount++;
          this.advance();
        }

        if (endCount === backtickCount) {
          // 找到匹配
          let content = this.input.slice(contentStart, endPos);
          // 移除首尾各一个空格（如果两端都有空格且不全是空格）
          if (
            content.length > 0 &&
            content.charCodeAt(0) === CHAR_SPACE &&
            content.charCodeAt(content.length - 1) === CHAR_SPACE &&
            content.trim().length > 0
          ) {
            content = content.slice(1, -1);
          }

          return {
            type: InlineType.Code,
            content,
            position: createPosition(
              startPos,
              this.pos,
              this.line,
              startColumn,
              this.line,
              this.column
            ),
          };
        }
      } else {
        this.advance();
      }
    }

    // 没有找到匹配，回退
    this.pos = startPos;
    this.column = startColumn;
    return null;
  }

  /** 解析强调（粗体/斜体） */
  private parseEmphasis(): InlineNode[] {
    const startPos = this.pos;
    const startColumn = this.column;
    const emphChar = this.peek();
    let count = 0;

    // 计算强调字符数量
    while (this.peek() === emphChar && count < 3) {
      count++;
      this.advance();
    }

    if (count === 0) return [];

    // 检查左侧是否可以开启强调
    const canOpen = this.canOpenEmphasis(startPos, emphChar, count);
    if (!canOpen) {
      this.pos = startPos;
      this.column = startColumn;
      return [];
    }

    // 寻找匹配的结束标记
    const contentStart = this.pos;
    let endPos = -1;

    while (this.pos < this.input.length) {
      const char = this.peek();

      // 跳过转义字符
      if (char === CHAR_BACKSLASH && this.pos + 1 < this.input.length) {
        this.advance();
        this.advance();
        continue;
      }

      // 检查是否是结束标记
      if (char === emphChar) {
        const checkPos = this.pos;
        let checkCount = 0;
        while (this.peek() === emphChar) {
          checkCount++;
          this.advance();
        }

        if (checkCount >= count && this.canCloseEmphasis(checkPos, emphChar, checkCount)) {
          endPos = checkPos;
          break;
        }
      } else if (isLineEnd(char)) {
        // 强调不能跨段落
        break;
      } else {
        this.advance();
      }
    }

    if (endPos === -1) {
      // 没有找到结束标记，回退
      this.pos = startPos;
      this.column = startColumn;
      return [];
    }

    const content = this.input.slice(contentStart, endPos);
    const emphType =
      count >= 3 ? InlineType.BoldItalic : count === 2 ? InlineType.Bold : InlineType.Italic;

    // 递归解析内部内容
    const innerNodes = new InlineParser(this.options).parse(content, this.line);

    return [
      {
        type: emphType,
        content,
        position: createPosition(
          startPos,
          this.pos,
          this.line,
          startColumn,
          this.line,
          this.column
        ),
        children: innerNodes,
      },
    ];
  }

  /** 检查是否可以开启强调 */
  private canOpenEmphasis(pos: number, char: number, _count: number): boolean {
    // 后面不能是空白
    const nextChar = this.peek();
    if (isWhitespace(nextChar) || nextChar === -1) return false;

    // 如果是下划线，前面必须是空白或标点
    if (char === CHAR_UNDERSCORE && pos > 0) {
      const prevChar = this.input.charCodeAt(pos - 1);
      if (!isWhitespace(prevChar) && !isPunctuation(prevChar)) return false;
    }

    return true;
  }

  /** 检查是否可以关闭强调 */
  private canCloseEmphasis(pos: number, char: number, _count: number): boolean {
    // 前面不能是空白
    if (pos === 0) return false;
    const prevChar = this.input.charCodeAt(pos - 1);
    if (isWhitespace(prevChar)) return false;

    // 如果是下划线，后面必须是空白或标点
    if (char === CHAR_UNDERSCORE) {
      const nextChar = this.peek();
      if (nextChar !== -1 && !isWhitespace(nextChar) && !isPunctuation(nextChar)) return false;
    }

    return true;
  }

  /** 解析删除线 */
  private parseStrikethrough(): InlineNode | null {
    const startPos = this.pos;
    const startColumn = this.column;

    // 需要两个 ~
    if (this.peek() !== CHAR_TILDE || this.peekAt(1) !== CHAR_TILDE) {
      return null;
    }

    this.advance();
    this.advance();

    const contentStart = this.pos;
    let endPos = -1;

    // 寻找结束的 ~~
    while (this.pos < this.input.length - 1) {
      if (this.peek() === CHAR_TILDE && this.peekAt(1) === CHAR_TILDE) {
        endPos = this.pos;
        this.advance();
        this.advance();
        break;
      } else if (isLineEnd(this.peek())) {
        break;
      } else {
        this.advance();
      }
    }

    if (endPos === -1) {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }

    const content = this.input.slice(contentStart, endPos);
    const innerNodes = new InlineParser(this.options).parse(content, this.line);

    return {
      type: InlineType.Strikethrough,
      content,
      position: createPosition(startPos, this.pos, this.line, startColumn, this.line, this.column),
      children: innerNodes,
    };
  }

  /** 解析链接或图片 */
  private parseLinkOrImage(): InlineNode | null {
    const startPos = this.pos;
    const startColumn = this.column;
    let isImage = false;

    // 检查是否是图片
    if (this.peek() === CHAR_EXCLAMATION) {
      isImage = true;
      this.advance();
    }

    // 必须以 [ 开始
    if (this.peek() !== CHAR_BRACKET_OPEN) {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }
    this.advance();

    // 解析链接文本
    const textStart = this.pos;
    let bracketDepth = 1;
    let textEnd = -1;

    while (this.pos < this.input.length && bracketDepth > 0) {
      const char = this.peek();

      if (char === CHAR_BACKSLASH && this.pos + 1 < this.input.length) {
        this.advance();
        this.advance();
        continue;
      }

      if (char === CHAR_BRACKET_OPEN) {
        bracketDepth++;
      } else if (char === CHAR_BRACKET_CLOSE) {
        bracketDepth--;
        if (bracketDepth === 0) {
          textEnd = this.pos;
        }
      }
      this.advance();
    }

    if (textEnd === -1) {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }

    const linkText = this.input.slice(textStart, textEnd);

    // 检查 (url) 或 (url "title")
    if (this.peek() !== CHAR_PAREN_OPEN) {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }
    this.advance();

    // 跳过空白
    while (isWhitespace(this.peek()) && !isLineEnd(this.peek())) {
      this.advance();
    }

    // 解析 URL
    let url = '';
    let title = '';

    // URL 可以用 <> 包裹
    if (this.peek() === CHAR_LESS_THAN) {
      this.advance();
      const urlStart = this.pos;
      while (this.pos < this.input.length && this.peek() !== CHAR_GREATER) {
        if (isLineEnd(this.peek())) {
          this.pos = startPos;
          this.column = startColumn;
          return null;
        }
        this.advance();
      }
      url = this.input.slice(urlStart, this.pos);
      this.advance(); // 跳过 >
    } else {
      // 普通 URL
      const urlStart = this.pos;
      let parenDepth = 0;
      while (this.pos < this.input.length) {
        const char = this.peek();
        if (char === CHAR_PAREN_OPEN) {
          parenDepth++;
        } else if (char === CHAR_PAREN_CLOSE) {
          if (parenDepth === 0) break;
          parenDepth--;
        } else if (isWhitespace(char)) {
          break;
        }
        this.advance();
      }
      url = this.input.slice(urlStart, this.pos);
    }

    // 跳过空白
    while (isWhitespace(this.peek()) && !isLineEnd(this.peek())) {
      this.advance();
    }

    // 解析可选的标题
    const titleChar = this.peek();
    if (
      titleChar === CHAR_QUOTE_DOUBLE ||
      titleChar === CHAR_QUOTE_SINGLE ||
      titleChar === CHAR_PAREN_OPEN
    ) {
      const closingChar = titleChar === CHAR_PAREN_OPEN ? CHAR_PAREN_CLOSE : titleChar;
      this.advance();
      const titleStart = this.pos;

      while (this.pos < this.input.length && this.peek() !== closingChar) {
        if (this.peek() === CHAR_BACKSLASH && this.pos + 1 < this.input.length) {
          this.advance();
        }
        this.advance();
      }

      title = this.input.slice(titleStart, this.pos);
      this.advance(); // 跳过结束引号
    }

    // 跳过空白
    while (isWhitespace(this.peek()) && !isLineEnd(this.peek())) {
      this.advance();
    }

    // 必须以 ) 结束
    if (this.peek() !== CHAR_PAREN_CLOSE) {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }
    this.advance();

    // 解析链接文本中的内联元素
    const innerNodes = new InlineParser(this.options).parse(linkText, this.line);

    if (isImage) {
      return {
        type: InlineType.Image,
        content: linkText,
        alt: linkText,
        url,
        title: title || undefined,
        position: createPosition(
          startPos,
          this.pos,
          this.line,
          startColumn,
          this.line,
          this.column
        ),
      };
    } else {
      return {
        type: InlineType.Link,
        content: linkText,
        url,
        title: title || undefined,
        position: createPosition(
          startPos,
          this.pos,
          this.line,
          startColumn,
          this.line,
          this.column
        ),
        children: innerNodes,
      };
    }
  }

  /** 解析自动链接 */
  private parseAutoLink(): InlineNode | null {
    const startPos = this.pos;
    const startColumn = this.column;

    if (this.peek() !== CHAR_LESS_THAN) {
      return null;
    }
    this.advance();

    const contentStart = this.pos;

    // 解析内容直到 >
    while (this.pos < this.input.length && this.peek() !== CHAR_GREATER) {
      if (isLineEnd(this.peek()) || isWhitespace(this.peek())) {
        this.pos = startPos;
        this.column = startColumn;
        return null;
      }
      this.advance();
    }

    if (this.peek() !== CHAR_GREATER) {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }

    const content = this.input.slice(contentStart, this.pos);
    this.advance(); // 跳过 >

    // 判断是 URL 还是 email
    const urlPattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
    const emailPattern =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    let url = content;
    if (urlPattern.test(content)) {
      // URL - 保持原样
    } else if (emailPattern.test(content)) {
      url = 'mailto:' + content;
    } else {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }

    return {
      type: InlineType.AutoLink,
      content,
      url,
      position: createPosition(startPos, this.pos, this.line, startColumn, this.line, this.column),
    };
  }

  /** 解析 HTML 标签 */
  private parseHtmlTag(): InlineNode | null {
    const startPos = this.pos;
    const startColumn = this.column;

    if (this.peek() !== CHAR_LESS_THAN) {
      return null;
    }
    this.advance();

    // 检查是否是结束标签
    const isClosingTag = this.peek() === CHAR_SLASH;
    if (isClosingTag) {
      this.advance();
    }

    // 解析标签名
    const tagNameStart = this.pos;
    if (!isAlpha(this.peek())) {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }

    while (isAlphaNumeric(this.peek()) || this.peek() === CHAR_HYPHEN) {
      this.advance();
    }

    const tagName = this.input.slice(tagNameStart, this.pos).toLowerCase();

    // 解析属性（简化处理）
    const attributes: Record<string, string> = {};

    while (this.pos < this.input.length) {
      // 跳过空白
      while (isWhitespace(this.peek()) && !isLineEnd(this.peek())) {
        this.advance();
      }

      // 自闭合 />
      if (this.peek() === CHAR_SLASH && this.peekAt(1) === CHAR_GREATER) {
        this.advance();
        this.advance();
        break;
      }

      // 结束 >
      if (this.peek() === CHAR_GREATER) {
        this.advance();
        break;
      }

      // 解析属性名
      const attrNameStart = this.pos;
      while (
        isAlphaNumeric(this.peek()) ||
        this.peek() === CHAR_HYPHEN ||
        this.peek() === CHAR_UNDERSCORE
      ) {
        this.advance();
      }

      if (this.pos === attrNameStart) {
        // 无效字符
        this.pos = startPos;
        this.column = startColumn;
        return null;
      }

      const attrName = this.input.slice(attrNameStart, this.pos);

      // 跳过空白
      while (isWhitespace(this.peek()) && !isLineEnd(this.peek())) {
        this.advance();
      }

      // 检查是否有值
      if (this.peek() === CHAR_EQUALS) {
        this.advance();

        // 跳过空白
        while (isWhitespace(this.peek()) && !isLineEnd(this.peek())) {
          this.advance();
        }

        // 解析属性值
        let attrValue = '';
        const quoteChar = this.peek();

        if (quoteChar === CHAR_QUOTE_DOUBLE || quoteChar === CHAR_QUOTE_SINGLE) {
          this.advance();
          const valueStart = this.pos;
          while (this.pos < this.input.length && this.peek() !== quoteChar) {
            this.advance();
          }
          attrValue = this.input.slice(valueStart, this.pos);
          this.advance(); // 跳过结束引号
        } else {
          // 无引号属性值
          const valueStart = this.pos;
          while (
            this.pos < this.input.length &&
            !isWhitespace(this.peek()) &&
            this.peek() !== CHAR_GREATER
          ) {
            this.advance();
          }
          attrValue = this.input.slice(valueStart, this.pos);
        }

        attributes[attrName] = attrValue;
      } else {
        attributes[attrName] = '';
      }
    }

    const raw = this.input.slice(startPos, this.pos);

    return {
      type: InlineType.HtmlTag,
      content: raw,
      tagName,
      attributes,
      position: createPosition(startPos, this.pos, this.line, startColumn, this.line, this.column),
    };
  }

  /** 解析脚注引用 [^id] */
  private parseFootnoteRef(): InlineNode | null {
    const startPos = this.pos;
    const startColumn = this.column;

    // 期望 [^
    if (this.peek() !== CHAR_BRACKET_OPEN) return null;
    this.advance();

    if (this.peek() !== 0x5e) {
      // '^'
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }
    this.advance();

    // 解析脚注 ID
    const idStart = this.pos;
    while (this.pos < this.input.length) {
      const char = this.peek();
      // 脚注 ID 可以包含字母、数字、连字符、下划线
      if (isAlphaNumeric(char) || char === CHAR_HYPHEN || char === CHAR_UNDERSCORE) {
        this.advance();
      } else {
        break;
      }
    }

    if (this.pos === idStart) {
      // 没有有效的 ID
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }

    const footnoteId = this.input.slice(idStart, this.pos);

    // 期望 ]
    if (this.peek() !== CHAR_BRACKET_CLOSE) {
      this.pos = startPos;
      this.column = startColumn;
      return null;
    }
    this.advance();

    return {
      type: InlineType.FootnoteRef,
      content: `[^${footnoteId}]`,
      footnoteId,
      position: createPosition(startPos, this.pos, this.line, startColumn, this.line, this.column),
    };
  }
}

// ================================
// 块级解析器
// ================================

/**
 * 块级元素解析器
 */
class BlockParser {
  private lines: string[] = [];
  private lineIndex: number = 0;
  private options: Required<CommonMarkOptions>;
  private warnings: ParseWarning[] = [];

  constructor(options: Required<CommonMarkOptions>) {
    this.options = options;
  }

  /**
   * 解析文档
   */
  parse(input: string): { document: BlockNode; warnings: ParseWarning[] } {
    this.lines = this.splitLines(input);
    this.lineIndex = 0;
    this.warnings = [];

    const children = this.parseBlocks(0);

    const document: BlockNode = {
      type: BlockType.Document,
      position: createPosition(
        0,
        input.length,
        1,
        1,
        this.lines.length,
        this.getLineLength(this.lines.length - 1) + 1
      ),
      raw: input,
      children,
    };

    return { document, warnings: this.warnings };
  }

  /** 分割输入为行 */
  private splitLines(input: string): string[] {
    return input.split(/\r?\n/);
  }

  /** 按索引读取行内容，越界时返回空串 */
  private lineAt(lineIndex: number): string {
    return this.lines[lineIndex] ?? '';
  }

  /** 获取行长度 */
  private getLineLength(lineIndex: number): number {
    return this.lineAt(lineIndex).length;
  }

  /** 解析块级元素 */
  private parseBlocks(indentLevel: number): BlockNode[] {
    const blocks: BlockNode[] = [];

    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);

      // 空行
      if (this.isBlankLine(line)) {
        this.lineIndex++;
        continue;
      }

      // 检查缩进
      const indent = this.getIndent(line);
      if (indent < indentLevel * 4 && indentLevel > 0) {
        break;
      }

      // ATX 标题
      const heading = this.parseATXHeading(line);
      if (heading) {
        blocks.push(heading);
        this.lineIndex++;
        continue;
      }

      // Setext 标题（需要向前看一行）
      if (this.lineIndex + 1 < this.lines.length) {
        const setextHeading = this.parseSetextHeading(line, this.lineAt(this.lineIndex + 1));
        if (setextHeading) {
          blocks.push(setextHeading);
          this.lineIndex += 2;
          continue;
        }
      }

      // 主题分隔线
      const thematicBreak = this.parseThematicBreak(line);
      if (thematicBreak) {
        blocks.push(thematicBreak);
        this.lineIndex++;
        continue;
      }

      // 代码围栏
      const fencedCode = this.parseFencedCode();
      if (fencedCode) {
        blocks.push(fencedCode);
        continue;
      }

      // 缩进代码块
      if (indent >= 4) {
        const indentedCode = this.parseIndentedCode();
        if (indentedCode) {
          blocks.push(indentedCode);
          continue;
        }
      }

      // 块引用
      if (line.trimStart().startsWith('>')) {
        const blockquote = this.parseBlockquote();
        if (blockquote) {
          blocks.push(blockquote);
          continue;
        }
      }

      // GFM 表格（需要检查当前行和下一行）
      if (this.options.gfm && this.lineIndex + 1 < this.lines.length) {
        const table = this.parseTable();
        if (table) {
          blocks.push(table);
          continue;
        }
      }

      // 脚注定义 [^id]: 内容
      if (this.options.gfm && /^\[\^[^\]]+\]:/.test(line.trim())) {
        const footnote = this.parseFootnoteDefinition();
        if (footnote) {
          blocks.push(footnote);
          continue;
        }
      }

      // 列表
      const list = this.parseList();
      if (list) {
        blocks.push(list);
        continue;
      }

      // HTML 块
      if (this.options.html && line.trimStart().startsWith('<')) {
        const htmlBlock = this.parseHtmlBlock();
        if (htmlBlock) {
          blocks.push(htmlBlock);
          continue;
        }
      }

      // 段落
      const paragraph = this.parseParagraph();
      if (paragraph) {
        blocks.push(paragraph);
      }
    }

    return blocks;
  }

  /** 检查是否为空行 */
  private isBlankLine(line: string): boolean {
    return /^\s*$/.test(line);
  }

  /** 获取缩进空格数 */
  private getIndent(line: string): number {
    let indent = 0;
    for (const char of line) {
      if (char === ' ') {
        indent++;
      } else if (char === '\t') {
        indent += 4 - (indent % 4);
      } else {
        break;
      }
    }
    return indent;
  }

  /** 解析 ATX 标题 */
  private parseATXHeading(line: string): BlockNode | null {
    const match = line.match(/^(#{1,6})([ \t]+(.*))?$/);
    if (!match) return null;

    const level = (match[1] ?? '').length;
    let content = (match[3] || '').trim();

    // 移除尾部的 #
    content = content.replace(/[ \t]+#+[ \t]*$/, '').trim();

    const inlineParser = new InlineParser(this.options);
    const inline = inlineParser.parse(content, this.lineIndex + 1);

    return {
      type: BlockType.Heading,
      level,
      content,
      raw: line,
      position: this.createLinePosition(line),
      inline,
    };
  }

  /** 解析 Setext 标题 */
  private parseSetextHeading(contentLine: string, underline: string): BlockNode | null {
    // 内容行不能是空行或其他块级元素的开始
    if (this.isBlankLine(contentLine)) return null;
    if (/^[ ]{0,3}([-*_][ ]*){3,}$/.test(contentLine)) return null;
    if (/^#{1,6}[ \t]/.test(contentLine)) return null;
    if (/^[ ]{0,3}```/.test(contentLine)) return null;
    if (/^[ ]{0,3}>/.test(contentLine)) return null;

    // 检查下划线
    const setextMatch = underline.match(/^[ ]{0,3}(=+|-+)[ \t]*$/);
    if (!setextMatch) return null;

    const level = setextMatch[1]?.startsWith('=') ? 1 : 2;
    const content = contentLine.trim();

    const inlineParser = new InlineParser(this.options);
    const inline = inlineParser.parse(content, this.lineIndex + 1);

    return {
      type: BlockType.Heading,
      level,
      content,
      raw: contentLine + '\n' + underline,
      position: this.createMultiLinePosition(2),
      inline,
    };
  }

  /** 解析主题分隔线 */
  private parseThematicBreak(line: string): BlockNode | null {
    // 匹配至少 3 个 -, *, _ 字符（可以有空格）
    if (!/^[ ]{0,3}([-*_][ ]*){3,}$/.test(line)) return null;

    return {
      type: BlockType.ThematicBreak,
      raw: line,
      position: this.createLinePosition(line),
    };
  }

  /** 解析代码围栏 */
  private parseFencedCode(): BlockNode | null {
    const startLine = this.lineAt(this.lineIndex);
    const match = startLine.match(/^[ ]{0,3}(`{3,}|~{3,})(.*)?$/);
    if (!match) return null;

    const fence = match[1] ?? '';
    const fenceChar = fence.charAt(0);
    const fenceLength = fence.length;
    const info = (match[2] || '').trim();

    // 语言标识不能包含反引号
    if (fenceChar === '`' && info.includes('`')) return null;

    const language = info.split(/\s+/)[0] || '';
    const startLineIndex = this.lineIndex;
    this.lineIndex++;

    const codeLines: string[] = [];

    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);

      // 检查结束围栏
      const endMatch = line.match(new RegExp(`^[ ]{0,3}${fenceChar}{${fenceLength},}[ ]*$`));
      if (endMatch) {
        this.lineIndex++;
        break;
      }

      codeLines.push(line);
      this.lineIndex++;
    }

    const content = codeLines.join('\n');
    const raw = this.lines.slice(startLineIndex, this.lineIndex).join('\n');

    return {
      type: BlockType.FencedCode,
      language: language || undefined,
      content,
      raw,
      position: this.createMultiLinePosition(this.lineIndex - startLineIndex, startLineIndex),
    };
  }

  /** 解析缩进代码块 */
  private parseIndentedCode(): BlockNode | null {
    const startLineIndex = this.lineIndex;
    const codeLines: string[] = [];

    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);

      if (this.isBlankLine(line)) {
        // 保留空行（暂时）
        codeLines.push('');
        this.lineIndex++;
        continue;
      }

      if (this.getIndent(line) >= 4) {
        // 移除 4 个空格的缩进
        codeLines.push(line.replace(/^[ ]{1,4}/, '').replace(/^\t/, ''));
        this.lineIndex++;
      } else {
        break;
      }
    }

    // 移除尾部空行
    while (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') {
      codeLines.pop();
    }

    if (codeLines.length === 0) {
      this.lineIndex = startLineIndex;
      return null;
    }

    const content = codeLines.join('\n');
    const raw = this.lines.slice(startLineIndex, this.lineIndex).join('\n');

    return {
      type: BlockType.CodeBlock,
      content,
      raw,
      position: this.createMultiLinePosition(this.lineIndex - startLineIndex, startLineIndex),
    };
  }

  /** 解析块引用 */
  private parseBlockquote(): BlockNode | null {
    const startLineIndex = this.lineIndex;
    const contentLines: string[] = [];

    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);

      // 检查是否是引用行
      const match = line.match(/^[ ]{0,3}>[ ]?(.*)?$/);
      if (match) {
        contentLines.push(match[1] || '');
        this.lineIndex++;
      } else if (!this.isBlankLine(line) && contentLines.length > 0) {
        // 懒惰续行
        const prevLine = contentLines[contentLines.length - 1] ?? '';
        if (!this.isBlankLine(prevLine)) {
          contentLines.push(line);
          this.lineIndex++;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if (contentLines.length === 0) {
      this.lineIndex = startLineIndex;
      return null;
    }

    // 递归解析引用内容
    const innerContent = contentLines.join('\n');
    const innerParser = new BlockParser(this.options);
    const { document } = innerParser.parse(innerContent);

    const raw = this.lines.slice(startLineIndex, this.lineIndex).join('\n');

    return {
      type: BlockType.Blockquote,
      raw,
      position: this.createMultiLinePosition(this.lineIndex - startLineIndex, startLineIndex),
      children: document.children,
    };
  }

  /** 解析列表 */
  private parseList(): BlockNode | null {
    const startLine = this.lineAt(this.lineIndex);

    // 检查是否是列表项
    const bulletMatch = startLine.match(/^[ ]{0,3}([-*+])[ \t]+/);
    const orderedMatch = startLine.match(/^[ ]{0,3}(\d{1,9})([.)])[ \t]+/);

    if (!bulletMatch && !orderedMatch) return null;

    const ordered = orderedMatch !== null;
    const marker = (orderedMatch ? orderedMatch[2] : bulletMatch?.[1]) ?? '';
    const start = orderedMatch ? parseInt(orderedMatch[1] ?? '1', 10) : undefined;
    const startLineIndex = this.lineIndex;
    const items: BlockNode[] = [];

    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);

      // 检查是否是同类型的列表项
      let itemMatch: RegExpMatchArray | null;
      if (ordered) {
        itemMatch = line.match(/^[ ]{0,3}(\d{1,9})([.)])[ \t]+/);
        if (itemMatch && itemMatch[2] !== marker) itemMatch = null;
      } else {
        itemMatch = line.match(/^[ ]{0,3}([-*+])[ \t]+/);
        if (itemMatch && itemMatch[1] !== marker) itemMatch = null;
      }

      if (itemMatch) {
        const itemContent = line.slice(itemMatch[0].length);
        const itemStartLine = this.lineIndex;
        this.lineIndex++;

        // 收集列表项的后续行
        const itemLines: string[] = [itemContent];
        const itemIndent = itemMatch[0].length;

        while (this.lineIndex < this.lines.length) {
          const nextLine = this.lineAt(this.lineIndex);

          if (this.isBlankLine(nextLine)) {
            itemLines.push('');
            this.lineIndex++;
            continue;
          }

          const nextIndent = this.getIndent(nextLine);
          if (nextIndent >= itemIndent) {
            itemLines.push(nextLine.slice(itemIndent));
            this.lineIndex++;
          } else {
            // 检查是否是新的列表项
            const newItemMatch = ordered
              ? nextLine.match(/^[ ]{0,3}(\d{1,9})([.)])[ \t]+/)
              : nextLine.match(/^[ ]{0,3}([-*+])[ \t]+/);
            if (newItemMatch) {
              break;
            }
            break;
          }
        }

        // 移除尾部空行
        while (itemLines.length > 0 && itemLines[itemLines.length - 1] === '') {
          itemLines.pop();
        }

        const itemRaw = this.lines.slice(itemStartLine, this.lineIndex).join('\n');
        let itemContentStr = itemLines.join('\n');

        // 检查是否是任务列表项（GFM 扩展）
        let isTaskItem = false;
        let checked: boolean | undefined = undefined;
        if (this.options.gfm) {
          const taskMatch = itemContentStr.match(/^\[([ xX])\][ \t]+/);
          if (taskMatch) {
            isTaskItem = true;
            checked = (taskMatch[1] ?? '').toLowerCase() === 'x';
            // 移除任务列表复选框标记
            itemContentStr = itemContentStr.slice(taskMatch[0].length);
          }
        }

        // 解析列表项内容
        const innerParser = new BlockParser(this.options);
        const { document } = innerParser.parse(itemContentStr);

        const listItemNode: BlockNode = {
          type: isTaskItem ? BlockType.TaskListItem : BlockType.ListItem,
          raw: itemRaw,
          position: this.createMultiLinePosition(this.lineIndex - itemStartLine, itemStartLine),
          children: document.children,
        };

        // 如果是任务列表项，添加 checked 属性
        if (isTaskItem) {
          listItemNode.checked = checked;
        }

        items.push(listItemNode);
      } else if (this.isBlankLine(line)) {
        this.lineIndex++;
      } else {
        break;
      }
    }

    if (items.length === 0) {
      this.lineIndex = startLineIndex;
      return null;
    }

    const raw = this.lines.slice(startLineIndex, this.lineIndex).join('\n');

    // 判断是否是紧凑列表
    let tight = true;
    for (const item of items) {
      if (item.children && item.children.length > 1) {
        tight = false;
        break;
      }
    }

    return {
      type: BlockType.List,
      ordered,
      start,
      marker,
      tight,
      raw,
      position: this.createMultiLinePosition(this.lineIndex - startLineIndex, startLineIndex),
      children: items,
    };
  }

  /** 解析 HTML 块 */
  private parseHtmlBlock(): BlockNode | null {
    const startLine = this.lineAt(this.lineIndex);
    const trimmed = startLine.trimStart();

    // 检查是否是 HTML 块的开始
    if (!trimmed.startsWith('<')) return null;

    const tagMatch = trimmed.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!tagMatch) return null;

    const tagName = (tagMatch[1] ?? '').toLowerCase();

    // 只处理块级 HTML 标签
    if (!HTML_BLOCK_TAGS.has(tagName)) return null;

    const startLineIndex = this.lineIndex;
    const htmlLines: string[] = [];

    // 收集 HTML 块内容
    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);
      htmlLines.push(line);
      this.lineIndex++;

      // 检查是否是自闭合或结束标签
      if (HTML_VOID_TAGS.has(tagName)) {
        break;
      }

      if (line.includes(`</${tagName}`)) {
        break;
      }

      // 如果遇到空行，可能结束
      if (this.isBlankLine(line)) {
        break;
      }
    }

    const raw = htmlLines.join('\n');

    return {
      type: BlockType.HtmlBlock,
      raw,
      content: raw,
      position: this.createMultiLinePosition(this.lineIndex - startLineIndex, startLineIndex),
    };
  }

  // ================================
  // GFM 表格解析
  // ================================

  /**
   * 检查是否为表格分隔行（定义列对齐）
   * 格式：| :--- | :---: | ---: | 或不带外部管道
   */
  private isTableDelimiterRow(line: string): TableAlignment[] | null {
    const trimmed = line.trim();

    // 分隔行必须只包含 |, -, :, 空格
    if (!/^[\|\-:\s]+$/.test(trimmed)) {
      return null;
    }

    // 去除首尾管道符
    let content = trimmed;
    if (content.startsWith('|')) content = content.slice(1);
    if (content.endsWith('|')) content = content.slice(0, -1);

    const cells = content.split('|').map((c) => c.trim());

    if (cells.length === 0) return null;

    const alignments: TableAlignment[] = [];

    for (const cell of cells) {
      // 必须至少有一个连字符
      if (!/^:?-+:?$/.test(cell)) {
        return null;
      }

      const leftColon = cell.startsWith(':');
      const rightColon = cell.endsWith(':');

      if (leftColon && rightColon) {
        alignments.push('center');
      } else if (rightColon) {
        alignments.push('right');
      } else if (leftColon) {
        alignments.push('left');
      } else {
        alignments.push(null);
      }
    }

    return alignments;
  }

  /**
   * 解析表格行的单元格
   */
  private parseTableRowCells(line: string): string[] {
    let content = line.trim();

    // 去除首尾管道符
    if (content.startsWith('|')) content = content.slice(1);
    if (content.endsWith('|')) content = content.slice(0, -1);

    // 分割单元格，需要处理转义的管道符
    const cells: string[] = [];
    let current = '';
    let escaped = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        current += char;
        continue;
      }

      if (char === '|') {
        cells.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim());
    return cells;
  }

  /**
   * 检查行是否看起来像表格行（包含管道符）
   */
  private looksLikeTableRow(line: string): boolean {
    const trimmed = line.trim();
    // 表格行必须包含管道符
    return trimmed.includes('|');
  }

  /**
   * 解析 GFM 表格
   */
  private parseTable(): BlockNode | null {
    const startLineIndex = this.lineIndex;

    // 第一行是表头
    const headerLine = this.lineAt(this.lineIndex);
    if (!this.looksLikeTableRow(headerLine)) {
      return null;
    }

    // 第二行必须是分隔行
    if (this.lineIndex + 1 >= this.lines.length) {
      return null;
    }

    const delimiterLine = this.lineAt(this.lineIndex + 1);
    const alignments = this.isTableDelimiterRow(delimiterLine);

    if (!alignments) {
      return null;
    }

    // 解析表头单元格
    const headerCells = this.parseTableRowCells(headerLine);

    // 表头单元格数量必须与分隔符列数匹配（允许有差异，按较小的来）
    const columnCount = Math.max(headerCells.length, alignments.length);

    // 规范化对齐数组
    while (alignments.length < columnCount) {
      alignments.push(null);
    }

    // 创建表头行
    const headerRow: TableRowNode = {
      type: BlockType.TableRow,
      raw: headerLine,
      position: this.createLinePosition(headerLine),
      isHeader: true,
      cells: headerCells.map((content, index) => {
        const inlineParser = new InlineParser(this.options);
        const inline = inlineParser.parse(content, this.lineIndex + 1);
        return {
          type: BlockType.TableCell,
          raw: content,
          content,
          position: this.createLinePosition(content),
          isHeader: true,
          alignment: alignments[index] ?? null,
          inline,
        } as TableCellNode;
      }),
    };

    // 跳过表头和分隔行
    this.lineIndex += 2;

    // 解析数据行
    const dataRows: TableRowNode[] = [];

    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);

      // 空行结束表格
      if (this.isBlankLine(line)) {
        break;
      }

      // 不像表格行则结束
      if (!this.looksLikeTableRow(line)) {
        break;
      }

      const rowCells = this.parseTableRowCells(line);

      const row: TableRowNode = {
        type: BlockType.TableRow,
        raw: line,
        position: this.createLinePosition(line),
        isHeader: false,
        cells: rowCells.map((content, index) => {
          const inlineParser = new InlineParser(this.options);
          const inline = inlineParser.parse(content, this.lineIndex + 1);
          return {
            type: BlockType.TableCell,
            raw: content,
            content,
            position: this.createLinePosition(content),
            isHeader: false,
            alignment: alignments[index] ?? null,
            inline,
          } as TableCellNode;
        }),
      };

      dataRows.push(row);
      this.lineIndex++;
    }

    // 收集原始文本
    const rawLines = this.lines.slice(startLineIndex, this.lineIndex);
    const raw = rawLines.join('\n');

    // 创建表格节点
    const table: TableNode = {
      type: BlockType.Table,
      raw,
      position: this.createMultiLinePosition(this.lineIndex - startLineIndex, startLineIndex),
      alignments,
      header: headerRow,
      rows: dataRows,
      children: [headerRow, ...dataRows],
    };

    return table;
  }

  /** 解析段落 */
  private parseParagraph(): BlockNode | null {
    const startLineIndex = this.lineIndex;
    const paragraphLines: string[] = [];

    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);

      if (this.isBlankLine(line)) break;

      // Setext 标题：段落（可以是多行）之后的 === / --- 下划线，整段成为标题；
      // 须先于主题分隔线判断（段落后的 --- 是二级标题而不是分隔线）
      const underline = paragraphLines.length > 0 ? /^[ ]{0,3}(=+|-+)[ \t]*$/.exec(line) : null;
      if (underline) {
        this.lineIndex++;
        return this.createSetextHeading(paragraphLines, line, underline[1]!.startsWith('=') ? 1 : 2, startLineIndex);
      }

      // 其他块级元素可以打断段落；第一行未被任何块规则接受时（如信息串含反引号的“围栏”）按段落文本处理，
      // 保证解析总能前进
      if (paragraphLines.length > 0 && this.interruptsParagraph(line)) break;

      paragraphLines.push(line);
      this.lineIndex++;
    }

    if (paragraphLines.length === 0) return null;

    const content = paragraphLines.join('\n').trim();
    const raw = paragraphLines.join('\n');

    const inlineParser = new InlineParser(this.options);
    const inline = inlineParser.parse(content, startLineIndex + 1);

    return {
      type: BlockType.Paragraph,
      content,
      raw,
      position: this.createMultiLinePosition(paragraphLines.length, startLineIndex),
      inline,
    };
  }

  /** 能打断段落的块级元素开头 */
  private interruptsParagraph(line: string): boolean {
    return (
      /^[ ]{0,3}#{1,6}([ \t]|$)/.test(line) ||
      /^[ ]{0,3}([-*_][ ]*){3,}$/.test(line) ||
      /^[ ]{0,3}(`{3,}(?!.*`)|~{3,})/.test(line) ||
      /^[ ]{0,3}>/.test(line) ||
      /^[ ]{0,3}[-*+][ \t]+\S/.test(line) ||
      /^[ ]{0,3}1[.)][ \t]+\S/.test(line)
    );
  }

  /** Setext 标题：标题内容为下划线之前的全部段落行 */
  private createSetextHeading(contentLines: string[], underline: string, level: number, startLineIndex: number): BlockNode {
    const content = contentLines.map((line) => line.trim()).join('\n');
    const inlineParser = new InlineParser(this.options);
    return {
      type: BlockType.Heading,
      level,
      content,
      raw: [...contentLines, underline].join('\n'),
      position: this.createMultiLinePosition(contentLines.length + 1, startLineIndex),
      inline: inlineParser.parse(content, startLineIndex + 1),
    };
  }

  /** 创建单行位置信息 */
  private createLinePosition(line: string): Position {
    return createPosition(
      0,
      line.length,
      this.lineIndex + 1,
      1,
      this.lineIndex + 1,
      line.length + 1
    );
  }

  /** 创建多行位置信息 */
  private createMultiLinePosition(lineCount: number, startLineIndex?: number): Position {
    const start = startLineIndex ?? this.lineIndex;
    const end = start + lineCount - 1;
    return createPosition(0, 0, start + 1, 1, end + 1, this.getLineLength(end) + 1);
  }

  /** 解析脚注定义 [^id]: 内容 */
  private parseFootnoteDefinition(): BlockNode | null {
    const startLine = this.lineAt(this.lineIndex);
    const startLineIndex = this.lineIndex;

    // 匹配脚注定义 [^id]: 内容
    const match = startLine.match(/^\[\^([^\]]+)\]:[ \t]*(.*)?$/);
    if (!match) return null;

    const footnoteId = match[1];
    const firstLineContent = match[2] || '';
    this.lineIndex++;

    // 收集脚注内容（可能跨多行）
    const contentLines: string[] = [firstLineContent];
    const baseIndent = 4; // 脚注后续行需要至少4个空格缩进

    while (this.lineIndex < this.lines.length) {
      const line = this.lineAt(this.lineIndex);

      // 空行可以是脚注内容的一部分
      if (this.isBlankLine(line)) {
        contentLines.push('');
        this.lineIndex++;
        continue;
      }

      // 检查缩进
      const indent = this.getIndent(line);
      if (indent >= baseIndent) {
        // 移除基础缩进
        contentLines.push(line.slice(baseIndent));
        this.lineIndex++;
      } else {
        // 缩进不足，脚注结束
        break;
      }
    }

    // 移除尾部空行
    while (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') {
      contentLines.pop();
    }

    const raw = this.lines.slice(startLineIndex, this.lineIndex).join('\n');
    const contentStr = contentLines.join('\n').trim();

    // 解析脚注内容
    const innerParser = new BlockParser(this.options);
    const { document } = innerParser.parse(contentStr);

    return {
      type: BlockType.FootnoteDefinition,
      footnoteId,
      content: contentStr,
      raw,
      position: this.createMultiLinePosition(this.lineIndex - startLineIndex, startLineIndex),
      children: document.children,
    };
  }
}

// ================================
// CommonMark 解析器
// ================================

/**
 * CommonMark 规范解析器
 * 高性能、完全自主实现
 */
export class CommonMarkParser {
  private options: Required<CommonMarkOptions>;

  constructor(options?: CommonMarkOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 解析 Markdown 文本
   */
  parse(input: string): ParseResult {
    const startTime = performance.now();

    const blockParser = new BlockParser(this.options);
    const { document, warnings } = blockParser.parse(input);

    const duration = performance.now() - startTime;

    return {
      document,
      duration,
      warnings,
    };
  }

  /**
   * 仅解析内联元素
   */
  parseInline(input: string, startLine: number = 1): InlineNode[] {
    const inlineParser = new InlineParser(this.options);
    return inlineParser.parse(input, startLine);
  }

  /**
   * 获取配置
   */
  getOptions(): Readonly<CommonMarkOptions> {
    return this.options;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 CommonMark 解析器
 */
export function createCommonMarkParser(options?: CommonMarkOptions): CommonMarkParser {
  return new CommonMarkParser(options);
}

/**
 * 快速解析 Markdown
 */
export function parseCommonMark(input: string, options?: CommonMarkOptions): ParseResult {
  return new CommonMarkParser(options).parse(input);
}

/**
 * 快速解析内联内容
 */
export function parseInline(input: string, options?: CommonMarkOptions): InlineNode[] {
  return new CommonMarkParser(options).parseInline(input);
}
