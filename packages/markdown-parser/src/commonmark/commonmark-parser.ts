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
  /** 扩展语法（见 InlineExtension，节点名在 name 中） */
  Extension = 'extension',
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
  /** 扩展语法（见 BlockExtension，节点名在 name 中） */
  Extension = 'extension',
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

/** 位置信息（块级与行内节点都是源码中的绝对位置，容器前缀如 > 与列表缩进已计入） */
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
  /** 扩展节点名（type 为 Extension 时） */
  name?: string;
  /** 扩展节点的附加数据 */
  data?: Record<string, unknown>;
  /** 强调与删除线实际使用的分隔符（* / ** / _ / __ / ~~）、代码 span 的反引号序列 */
  marker?: string;
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
  /**
   * 标记：列表为标记字符（- * + 或 . )）；标题为写法（ATX 为 # 序列，Setext 为 = 或 -）；
   * 围栏代码块为开始围栏（``` 或 ~~~）
   */
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
  /** 围栏代码块开始围栏后的完整信息串（language 是其中第一个词） */
  info?: string;
  /** 扩展节点名（type 为 Extension 时） */
  name?: string;
  /** 扩展节点的附加数据 */
  data?: Record<string, unknown>;
}

// ================================
// 语法扩展
// ================================

/** 行内扩展的匹配结果 */
export interface InlineExtensionMatch {
  /** 消耗的字符数 */
  length: number;
  /** 节点内容 */
  content: string;
  data?: Record<string, unknown>;
}

/**
 * 行内扩展（公式 $…$、双向链接 [[…]] 等）：解析到触发字符时先于内置语法尝试，
 * 匹配成功的文本整体成为一个 Extension 节点（内部不再解析强调、链接等）
 */
export interface InlineExtension {
  /** 节点名 */
  name: string;
  /** 触发字符（单个字符） */
  trigger: string;
  /** 在 text 的 pos 处尝试匹配（text 为整段行内内容）；不匹配返回 null */
  match(text: string, pos: number): InlineExtensionMatch | null;
}

/** 块级扩展开始时所在的位置 */
export interface BlockExtensionContext {
  /** 是否是列表项的第一个块（与 markdown-it 一致，列表项一般以段落开头） */
  firstInListItem: boolean;
}

/** 块级扩展一行的处理结果 */
export interface BlockExtensionLine {
  /** 本行加入块内容的文本（省略则不加入） */
  content?: string;
  /** 块是否在本行结束 */
  closed: boolean;
  data?: Record<string, unknown>;
}

/**
 * 块级扩展：叶子块（如 $$ 公式、独占一行的嵌入）。与围栏代码块一样可以跨行、可以在引用与列表里，
 * 容器不再匹配时随容器一起结束；内部不再解析其他块。输出 type 为 Extension、content 为各行内容以换行连接
 */
export interface BlockExtension {
  /** 节点名 */
  name: string;
  /** 行首（去掉缩进）可能的开头字符，用于快速跳过不可能匹配的行 */
  trigger: string;
  /** 能否打断段落（默认不能） */
  interruptsParagraph?: boolean;
  /** 在一行（去掉容器前缀与缩进）尝试开始；不匹配返回 null */
  open(line: string, context: BlockExtensionContext): BlockExtensionLine | null;
  /** 块未结束时对之后每一行（去掉容器前缀）调用；不提供时块只有一行 */
  next?(line: string): BlockExtensionLine;
}

/** 解析选项 */
export interface CommonMarkOptions {
  /** GFM 扩展：表格、任务列表项、脚注定义与引用（下面两项可单独关闭） */
  gfm?: boolean;
  /** GFM 任务列表项 - [ ] / - [x]（默认同 gfm） */
  taskLists?: boolean;
  /** GFM 脚注 [^id]（默认同 gfm） */
  footnotes?: boolean;
  /** 识别 HTML 块与行内 HTML（关闭时按文本处理） */
  html?: boolean;
  /** GFM 删除线：~text~ 或 ~~text~~ */
  strikethrough?: boolean;
  /** 删除线是否接受单个 ~（GFM 接受；markdown-it 只接受 ~~，避免“约 ~5 分钟”误判） */
  singleTildeStrikethrough?: boolean;
  /** 尖括号自动链接 <https://…>、<a@b.c> */
  autolink?: boolean;
  /** 智能标点：直引号变弯引号，-- / --- 变连接号 / 破折号，... 变省略号 */
  smartPunctuation?: boolean;
  /** 段落内的普通换行也按硬换行（<br />）处理 */
  hardBreaks?: boolean;
  /** 引用、列表、脚注的最大嵌套层数，超过时其余部分按文本处理并给出警告 */
  maxNestingDepth?: number;
  /** 行内语法扩展（按顺序尝试） */
  inlineExtensions?: readonly InlineExtension[];
  /** 块级语法扩展（按顺序尝试，先于内置的叶子块） */
  blockExtensions?: readonly BlockExtension[];
}

/** 展开默认值后的选项 */
export type ResolvedOptions = Required<CommonMarkOptions>;

/** 默认选项（taskLists / footnotes 未指定时跟随 gfm） */
const DEFAULT_OPTIONS = {
  gfm: true,
  html: true,
  strikethrough: true,
  singleTildeStrikethrough: true,
  autolink: true,
  smartPunctuation: false,
  hardBreaks: false,
  maxNestingDepth: 100,
  inlineExtensions: [],
  blockExtensions: [],
} satisfies Omit<ResolvedOptions, 'taskLists' | 'footnotes'>;

function resolveOptions(options: CommonMarkOptions = {}): ResolvedOptions {
  const gfm = options.gfm ?? DEFAULT_OPTIONS.gfm;
  return { ...DEFAULT_OPTIONS, taskLists: gfm, footnotes: gfm, ...options, gfm };
}

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
  private options: ResolvedOptions;

  constructor(options?: CommonMarkOptions) {
    this.options = resolveOptions(options);
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
