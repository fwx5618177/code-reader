// ================================
// CommonMark 规范解析器：类型定义与对外入口
// 块级解析见 block-parser.ts，行内解析见 inline-parser.ts，HTML 输出见 html-renderer.ts
// 零依赖；CommonMark 0.31.2 规范一致性由 __tests__/commonmark-spec.test.ts 统计
// ================================

// ================================
// 类型定义
// ================================

import { BlockParser } from './block-parser';
import { InlineParser } from './inline-parser';

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
  /** GFM 扩展：表格、任务列表项、脚注定义与引用 */
  gfm?: boolean;
  /** 识别 HTML 块与行内 HTML（关闭时按文本处理） */
  html?: boolean;
  /** GFM 删除线：~text~ 或 ~~text~~ */
  strikethrough?: boolean;
  /** 尖括号自动链接 <https://…>、<a@b.c> */
  autolink?: boolean;
  /** 智能标点：直引号变弯引号，-- / --- 变连接号 / 破折号，... 变省略号 */
  smartPunctuation?: boolean;
  /** 段落内的普通换行也按硬换行（<br />）处理 */
  hardBreaks?: boolean;
  /** 引用、列表、脚注的最大嵌套层数，超过时其余部分按文本处理并给出警告 */
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
    return new InlineParser(this.options).parse(input, startLine);
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
