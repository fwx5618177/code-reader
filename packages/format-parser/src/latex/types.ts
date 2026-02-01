// ================================
// @code-reader/parser - LaTeX 解析器
// 类型定义
// ================================

// ================================
// 节点类型枚举
// ================================

/** LaTeX 块级节点类型 */
export const enum LaTeXBlockType {
  /** 文档根节点 */
  Document = 'document',
  /** 段落 */
  Paragraph = 'paragraph',
  /** 标题章节 */
  Section = 'section',
  /** 子章节 */
  Subsection = 'subsection',
  /** 子子章节 */
  Subsubsection = 'subsubsection',
  /** 环境 */
  Environment = 'environment',
  /** 数学环境（行间公式） */
  MathBlock = 'math_block',
  /** 代码块 */
  CodeBlock = 'code_block',
  /** 列表 */
  List = 'list',
  /** 列表项 */
  ListItem = 'list_item',
  /** 表格 */
  Table = 'table',
  /** 表格行 */
  TableRow = 'table_row',
  /** 表格单元格 */
  TableCell = 'table_cell',
  /** 图片浮动体 */
  Figure = 'figure',
  /** 引用块 */
  Quote = 'quote',
  /** 定理/引理等 */
  Theorem = 'theorem',
  /** 脚注 */
  Footnote = 'footnote',
  /** 参考文献 */
  Bibliography = 'bibliography',
  /** 参考文献项 */
  BibItem = 'bib_item',
  /** 抽象 */
  Abstract = 'abstract',
  /** 标题区域 */
  TitleBlock = 'title_block',
  /** 注释 */
  Comment = 'comment',
  /** 原始内容 */
  Raw = 'raw',
}

/** LaTeX 行内节点类型 */
export const enum LaTeXInlineType {
  /** 纯文本 */
  Text = 'text',
  /** 行内数学公式 */
  MathInline = 'math_inline',
  /** 粗体 */
  Bold = 'bold',
  /** 斜体 */
  Italic = 'italic',
  /** 下划线 */
  Underline = 'underline',
  /** 等宽字体 */
  Monospace = 'monospace',
  /** 小型大写 */
  SmallCaps = 'small_caps',
  /** 强调 */
  Emphasis = 'emphasis',
  /** 引用 */
  Citation = 'citation',
  /** 交叉引用 */
  Reference = 'reference',
  /** 标签 */
  Label = 'label',
  /** 超链接 */
  Hyperlink = 'hyperlink',
  /** URL */
  Url = 'url',
  /** 脚注引用 */
  FootnoteRef = 'footnote_ref',
  /** 命令 */
  Command = 'command',
  /** 特殊字符 */
  SpecialChar = 'special_char',
  /** 空白 */
  Whitespace = 'whitespace',
  /** 换行 */
  LineBreak = 'line_break',
  /** 组（花括号包裹） */
  Group = 'group',
}

// ================================
// 位置信息
// ================================

/** 位置信息 */
export interface Position {
  /** 起始行（从 1 开始） */
  startLine: number;
  /** 起始列（从 1 开始） */
  startColumn: number;
  /** 结束行 */
  endLine: number;
  /** 结束列 */
  endColumn: number;
  /** 起始偏移量 */
  startOffset: number;
  /** 结束偏移量 */
  endOffset: number;
}

// ================================
// 节点基础接口
// ================================

/** 节点基础接口 */
export interface LaTeXNodeBase {
  /** 位置信息 */
  position: Position;
  /** 原始文本 */
  raw: string;
}

// ================================
// 行内节点
// ================================

/** 文本节点 */
export interface TextNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Text;
  /** 文本内容 */
  content: string;
}

/** 行内数学公式节点 */
export interface MathInlineNode extends LaTeXNodeBase {
  type: LaTeXInlineType.MathInline;
  /** 数学公式内容 */
  content: string;
  /** 分隔符类型：$ 或 \( \) */
  delimiter: '$' | '\\(\\)';
}

/** 粗体节点 */
export interface BoldNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Bold;
  /** 子节点 */
  children: LaTeXInlineNode[];
  /** 使用的命令：\textbf 或 \bfseries */
  command: 'textbf' | 'bfseries' | 'bf';
}

/** 斜体节点 */
export interface ItalicNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Italic;
  /** 子节点 */
  children: LaTeXInlineNode[];
  /** 使用的命令 */
  command: 'textit' | 'itshape' | 'it' | 'emph';
}

/** 下划线节点 */
export interface UnderlineNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Underline;
  /** 子节点 */
  children: LaTeXInlineNode[];
}

/** 等宽字体节点 */
export interface MonospaceNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Monospace;
  /** 子节点 */
  children: LaTeXInlineNode[];
  /** 使用的命令 */
  command: 'texttt' | 'ttfamily' | 'verb';
}

/** 小型大写节点 */
export interface SmallCapsNode extends LaTeXNodeBase {
  type: LaTeXInlineType.SmallCaps;
  /** 子节点 */
  children: LaTeXInlineNode[];
}

/** 强调节点 */
export interface EmphasisNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Emphasis;
  /** 子节点 */
  children: LaTeXInlineNode[];
}

/** 引用节点 */
export interface CitationNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Citation;
  /** 引用键列表 */
  keys: string[];
  /** 引用命令：cite, citep, citet 等 */
  command: string;
  /** 前缀文本（可选） */
  prefix?: string;
  /** 后缀文本（可选） */
  suffix?: string;
}

/** 交叉引用节点 */
export interface ReferenceNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Reference;
  /** 引用的标签 */
  label: string;
  /** 引用命令：ref, eqref, pageref 等 */
  command: string;
}

/** 标签节点 */
export interface LabelNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Label;
  /** 标签名称 */
  name: string;
}

/** 超链接节点 */
export interface HyperlinkNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Hyperlink;
  /** 链接 URL */
  url: string;
  /** 显示文本 */
  text: string;
  /** 使用的命令 */
  command: 'href' | 'hyperref';
}

/** URL 节点 */
export interface UrlNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Url;
  /** URL 地址 */
  url: string;
}

/** 脚注引用节点 */
export interface FootnoteRefNode extends LaTeXNodeBase {
  type: LaTeXInlineType.FootnoteRef;
  /** 脚注内容 */
  content: LaTeXInlineNode[];
}

/** 命令节点 */
export interface CommandNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Command;
  /** 命令名称 */
  name: string;
  /** 必选参数 */
  args: string[];
  /** 可选参数 */
  optArgs: string[];
}

/** 特殊字符节点 */
export interface SpecialCharNode extends LaTeXNodeBase {
  type: LaTeXInlineType.SpecialChar;
  /** 字符内容 */
  char: string;
  /** 原始命令 */
  command: string;
}

/** 空白节点 */
export interface WhitespaceNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Whitespace;
  /** 空白数量 */
  count: number;
}

/** 换行节点 */
export interface LineBreakNode extends LaTeXNodeBase {
  type: LaTeXInlineType.LineBreak;
  /** 是否硬换行（\\） */
  hard: boolean;
}

/** 组节点（花括号包裹） */
export interface GroupNode extends LaTeXNodeBase {
  type: LaTeXInlineType.Group;
  /** 子节点 */
  children: LaTeXInlineNode[];
}

/** 行内节点联合类型 */
export type LaTeXInlineNode =
  | TextNode
  | MathInlineNode
  | BoldNode
  | ItalicNode
  | UnderlineNode
  | MonospaceNode
  | SmallCapsNode
  | EmphasisNode
  | CitationNode
  | ReferenceNode
  | LabelNode
  | HyperlinkNode
  | UrlNode
  | FootnoteRefNode
  | CommandNode
  | SpecialCharNode
  | WhitespaceNode
  | LineBreakNode
  | GroupNode;

// ================================
// 块级节点
// ================================

/** 文档节点 */
export interface DocumentNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Document;
  /** 文档类 */
  documentClass?: DocumentClass;
  /** 导言区内容 */
  preamble: PreambleItem[];
  /** 文档主体 */
  children: LaTeXBlockNode[];
  /** 文档元数据 */
  metadata: DocumentMetadata;
}

/** 文档类 */
export interface DocumentClass {
  /** 类名 */
  name: string;
  /** 选项 */
  options: string[];
}

/** 导言区项目 */
export interface PreambleItem {
  /** 类型 */
  type: 'usepackage' | 'newcommand' | 'renewcommand' | 'input' | 'include' | 'other';
  /** 命令名称 */
  command: string;
  /** 参数 */
  args: string[];
  /** 可选参数 */
  optArgs: string[];
  /** 原始文本 */
  raw: string;
}

/** 文档元数据 */
export interface DocumentMetadata {
  /** 标题 */
  title?: string;
  /** 作者 */
  author?: string[];
  /** 日期 */
  date?: string;
  /** 摘要 */
  abstract?: string;
  /** 关键词 */
  keywords?: string[];
}

/** 段落节点 */
export interface ParagraphNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Paragraph;
  /** 行内子节点 */
  children: LaTeXInlineNode[];
}

/** 章节节点 */
export interface SectionNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Section | LaTeXBlockType.Subsection | LaTeXBlockType.Subsubsection;
  /** 章节级别（0=chapter, 1=section, 2=subsection, 3=subsubsection） */
  level: number;
  /** 标题内容 */
  title: LaTeXInlineNode[];
  /** 短标题（用于目录） */
  shortTitle?: LaTeXInlineNode[];
  /** 是否编号 */
  numbered: boolean;
  /** 标签 */
  label?: string;
  /** 子节点 */
  children: LaTeXBlockNode[];
}

/** 环境节点 */
export interface EnvironmentNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Environment;
  /** 环境名称 */
  name: string;
  /** 必选参数 */
  args: string[];
  /** 可选参数 */
  optArgs: string[];
  /** 子节点 */
  children: LaTeXBlockNode[];
}

/** 数学块节点 */
export interface MathBlockNode extends LaTeXNodeBase {
  type: LaTeXBlockType.MathBlock;
  /** 数学内容 */
  content: string;
  /** 环境类型：equation, align, gather 等 */
  environment: string;
  /** 是否编号 */
  numbered: boolean;
  /** 标签 */
  label?: string;
}

/** 代码块节点 */
export interface CodeBlockNode extends LaTeXNodeBase {
  type: LaTeXBlockType.CodeBlock;
  /** 代码内容 */
  content: string;
  /** 语言 */
  language?: string;
  /** 环境名称 */
  environment: string;
  /** 选项 */
  options: Record<string, string>;
}

/** 列表节点 */
export interface ListNode extends LaTeXNodeBase {
  type: LaTeXBlockType.List;
  /** 列表类型 */
  listType: 'itemize' | 'enumerate' | 'description';
  /** 列表项 */
  children: ListItemNode[];
}

/** 列表项节点 */
export interface ListItemNode extends LaTeXNodeBase {
  type: LaTeXBlockType.ListItem;
  /** 标签（用于 description） */
  label?: LaTeXInlineNode[];
  /** 内容 */
  children: (LaTeXBlockNode | LaTeXInlineNode)[];
}

/** 表格节点 */
export interface TableNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Table;
  /** 列对齐方式 */
  columnAlignment: ('l' | 'c' | 'r' | 'p')[];
  /** 表格行 */
  children: TableRowNode[];
  /** 表格标题 */
  caption?: LaTeXInlineNode[];
  /** 标签 */
  label?: string;
}

/** 表格行节点 */
export interface TableRowNode extends LaTeXNodeBase {
  type: LaTeXBlockType.TableRow;
  /** 单元格 */
  children: TableCellNode[];
  /** 是否为表头行 */
  isHeader: boolean;
}

/** 表格单元格节点 */
export interface TableCellNode extends LaTeXNodeBase {
  type: LaTeXBlockType.TableCell;
  /** 内容 */
  children: LaTeXInlineNode[];
  /** 列跨度 */
  colspan: number;
  /** 行跨度 */
  rowspan: number;
  /** 对齐方式 */
  alignment?: 'l' | 'c' | 'r';
}

/** 图片浮动体节点 */
export interface FigureNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Figure;
  /** 图片路径 */
  path?: string;
  /** 图片选项 */
  options: Record<string, string>;
  /** 标题 */
  caption?: LaTeXInlineNode[];
  /** 标签 */
  label?: string;
  /** 位置选项 */
  placement?: string;
  /** 子节点 */
  children: LaTeXBlockNode[];
}

/** 引用块节点 */
export interface QuoteNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Quote;
  /** 环境类型：quote 或 quotation */
  environment: 'quote' | 'quotation';
  /** 子节点 */
  children: LaTeXBlockNode[];
}

/** 定理节点 */
export interface TheoremNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Theorem;
  /** 定理类型：theorem, lemma, corollary, definition, proof 等 */
  theoremType: string;
  /** 标题（可选） */
  title?: LaTeXInlineNode[];
  /** 标签 */
  label?: string;
  /** 内容 */
  children: LaTeXBlockNode[];
}

/** 脚注节点 */
export interface FootnoteNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Footnote;
  /** 脚注内容 */
  children: LaTeXInlineNode[];
}

/** 参考文献节点 */
export interface BibliographyNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Bibliography;
  /** 样式 */
  style?: string;
  /** 文件 */
  files?: string[];
  /** 条目 */
  children: BibItemNode[];
}

/** 参考文献项节点 */
export interface BibItemNode extends LaTeXNodeBase {
  type: LaTeXBlockType.BibItem;
  /** 引用键 */
  key: string;
  /** 标签 */
  label?: string;
  /** 内容 */
  children: LaTeXInlineNode[];
}

/** 摘要节点 */
export interface AbstractNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Abstract;
  /** 内容 */
  children: LaTeXBlockNode[];
}

/** 标题区域节点 */
export interface TitleBlockNode extends LaTeXNodeBase {
  type: LaTeXBlockType.TitleBlock;
  /** 标题 */
  title?: LaTeXInlineNode[];
  /** 作者 */
  authors?: AuthorInfo[];
  /** 日期 */
  date?: LaTeXInlineNode[];
}

/** 作者信息 */
export interface AuthorInfo {
  /** 姓名 */
  name: LaTeXInlineNode[];
  /** 机构 */
  affiliation?: string;
  /** 邮箱 */
  email?: string;
}

/** 注释节点 */
export interface CommentNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Comment;
  /** 注释内容 */
  content: string;
}

/** 原始内容节点 */
export interface RawNode extends LaTeXNodeBase {
  type: LaTeXBlockType.Raw;
  /** 内容 */
  content: string;
}

/** 块级节点联合类型 */
export type LaTeXBlockNode =
  | DocumentNode
  | ParagraphNode
  | SectionNode
  | EnvironmentNode
  | MathBlockNode
  | CodeBlockNode
  | ListNode
  | ListItemNode
  | TableNode
  | TableRowNode
  | TableCellNode
  | FigureNode
  | QuoteNode
  | TheoremNode
  | FootnoteNode
  | BibliographyNode
  | BibItemNode
  | AbstractNode
  | TitleBlockNode
  | CommentNode
  | RawNode;

/** 所有节点联合类型 */
export type LaTeXNode = LaTeXBlockNode | LaTeXInlineNode;

// ================================
// 解析配置
// ================================

/** 解析选项 */
export interface LaTeXParserOptions {
  /** 是否解析导言区 */
  parsePreamble?: boolean;
  /** 是否解析数学公式 */
  parseMath?: boolean;
  /** 是否保留注释 */
  preserveComments?: boolean;
  /** 是否保留空白 */
  preserveWhitespace?: boolean;
  /** 最大嵌套深度 */
  maxNestingDepth?: number;
  /** 已知的定理环境 */
  theoremEnvironments?: string[];
  /** 已知的代码环境 */
  codeEnvironments?: string[];
  /** 已知的数学环境 */
  mathEnvironments?: string[];
}

/** 解析结果 */
export interface LaTeXParseResult {
  /** 文档 AST */
  document: DocumentNode;
  /** 解析警告 */
  warnings: ParseWarning[];
  /** 解析耗时（毫秒） */
  duration: number;
}

/** 解析警告 */
export interface ParseWarning {
  /** 警告消息 */
  message: string;
  /** 位置 */
  position: Position;
  /** 警告类型 */
  type: 'syntax' | 'semantic' | 'unknown_command' | 'unmatched_brace' | 'other';
}

// ================================
// 默认配置
// ================================

/** 默认解析选项 */
export const DEFAULT_LATEX_OPTIONS: Required<LaTeXParserOptions> = {
  parsePreamble: true,
  parseMath: true,
  preserveComments: false,
  preserveWhitespace: false,
  maxNestingDepth: 100,
  theoremEnvironments: [
    'theorem',
    'lemma',
    'corollary',
    'proposition',
    'definition',
    'example',
    'remark',
    'proof',
    'conjecture',
    'axiom',
  ],
  codeEnvironments: ['verbatim', 'lstlisting', 'minted', 'Verbatim'],
  mathEnvironments: [
    'equation',
    'equation*',
    'align',
    'align*',
    'gather',
    'gather*',
    'multline',
    'multline*',
    'split',
    'flalign',
    'flalign*',
    'alignat',
    'alignat*',
    'eqnarray',
    'eqnarray*',
    'displaymath',
    'math',
  ],
};
