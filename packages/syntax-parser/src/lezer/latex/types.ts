// ================================
// Lezer LaTeX 语法解析器 - 类型定义
//
// 定义 LaTeX 文档的所有节点类型
// 用于构建增量解析 AST
// ================================

// ================================
// 节点类型 ID 定义
// ================================

/**
 * LaTeX 节点类型枚举
 * 用于标识 AST 中的不同节点
 */
export const NodeType = {
  // 根节点和文档结构
  Document: 1,
  Preamble: 2,
  DocumentBody: 3,

  // 命令相关
  Command: 10,
  CommandName: 11,
  CommandArgs: 12,
  OptionalArg: 13,
  RequiredArg: 14,
  StarModifier: 15,

  // 环境
  Environment: 20,
  BeginEnvironment: 21,
  EndEnvironment: 22,
  EnvironmentName: 23,
  EnvironmentContent: 24,

  // 数学模式
  InlineMath: 30,
  DisplayMath: 31,
  MathEnvironment: 32,
  MathContent: 33,
  MathDelimiter: 34,

  // 分组和括号
  Group: 40,
  BraceOpen: 41,
  BraceClose: 42,
  BracketOpen: 43,
  BracketClose: 44,
  ParenOpen: 45,
  ParenClose: 46,

  // 文本和内容
  Text: 50,
  Whitespace: 51,
  Newline: 52,
  ParagraphBreak: 53,

  // 注释
  Comment: 60,
  CommentContent: 61,

  // 特殊字符
  Escape: 70,
  SpecialChar: 71,
  Ampersand: 72,
  Tilde: 73,
  Caret: 74,
  Underscore: 75,

  // 章节命令
  Section: 80,
  Chapter: 81,
  Subsection: 82,
  Subsubsection: 83,
  Paragraph: 84,
  Subparagraph: 85,
  SectionTitle: 86,

  // 列表环境
  ItemizeEnv: 90,
  EnumerateEnv: 91,
  DescriptionEnv: 92,
  Item: 93,
  ItemLabel: 94,

  // 表格环境
  TabularEnv: 100,
  TableEnv: 101,
  TableRow: 102,
  TableCell: 103,
  ColumnSeparator: 104,
  RowSeparator: 105,

  // 图片和浮动体
  FigureEnv: 110,
  GraphicsCommand: 111,
  Caption: 112,
  Label: 113,
  Ref: 114,

  // 引用
  Cite: 120,
  Bibliography: 121,
  BibItem: 122,

  // 错误节点
  Error: 200,
  UnmatchedBrace: 201,
  UnmatchedEnvironment: 202,
  InvalidCommand: 203,
} as const;

export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType];

// ================================
// 节点名称映射
// ================================

/**
 * 节点类型 ID 到名称的映射
 */
export const NodeNames: Record<NodeTypeValue, string> = {
  [NodeType.Document]: 'Document',
  [NodeType.Preamble]: 'Preamble',
  [NodeType.DocumentBody]: 'DocumentBody',

  [NodeType.Command]: 'Command',
  [NodeType.CommandName]: 'CommandName',
  [NodeType.CommandArgs]: 'CommandArgs',
  [NodeType.OptionalArg]: 'OptionalArg',
  [NodeType.RequiredArg]: 'RequiredArg',
  [NodeType.StarModifier]: 'StarModifier',

  [NodeType.Environment]: 'Environment',
  [NodeType.BeginEnvironment]: 'BeginEnvironment',
  [NodeType.EndEnvironment]: 'EndEnvironment',
  [NodeType.EnvironmentName]: 'EnvironmentName',
  [NodeType.EnvironmentContent]: 'EnvironmentContent',

  [NodeType.InlineMath]: 'InlineMath',
  [NodeType.DisplayMath]: 'DisplayMath',
  [NodeType.MathEnvironment]: 'MathEnvironment',
  [NodeType.MathContent]: 'MathContent',
  [NodeType.MathDelimiter]: 'MathDelimiter',

  [NodeType.Group]: 'Group',
  [NodeType.BraceOpen]: 'BraceOpen',
  [NodeType.BraceClose]: 'BraceClose',
  [NodeType.BracketOpen]: 'BracketOpen',
  [NodeType.BracketClose]: 'BracketClose',
  [NodeType.ParenOpen]: 'ParenOpen',
  [NodeType.ParenClose]: 'ParenClose',

  [NodeType.Text]: 'Text',
  [NodeType.Whitespace]: 'Whitespace',
  [NodeType.Newline]: 'Newline',
  [NodeType.ParagraphBreak]: 'ParagraphBreak',

  [NodeType.Comment]: 'Comment',
  [NodeType.CommentContent]: 'CommentContent',

  [NodeType.Escape]: 'Escape',
  [NodeType.SpecialChar]: 'SpecialChar',
  [NodeType.Ampersand]: 'Ampersand',
  [NodeType.Tilde]: 'Tilde',
  [NodeType.Caret]: 'Caret',
  [NodeType.Underscore]: 'Underscore',

  [NodeType.Section]: 'Section',
  [NodeType.Chapter]: 'Chapter',
  [NodeType.Subsection]: 'Subsection',
  [NodeType.Subsubsection]: 'Subsubsection',
  [NodeType.Paragraph]: 'Paragraph',
  [NodeType.Subparagraph]: 'Subparagraph',
  [NodeType.SectionTitle]: 'SectionTitle',

  [NodeType.ItemizeEnv]: 'ItemizeEnv',
  [NodeType.EnumerateEnv]: 'EnumerateEnv',
  [NodeType.DescriptionEnv]: 'DescriptionEnv',
  [NodeType.Item]: 'Item',
  [NodeType.ItemLabel]: 'ItemLabel',

  [NodeType.TabularEnv]: 'TabularEnv',
  [NodeType.TableEnv]: 'TableEnv',
  [NodeType.TableRow]: 'TableRow',
  [NodeType.TableCell]: 'TableCell',
  [NodeType.ColumnSeparator]: 'ColumnSeparator',
  [NodeType.RowSeparator]: 'RowSeparator',

  [NodeType.FigureEnv]: 'FigureEnv',
  [NodeType.GraphicsCommand]: 'GraphicsCommand',
  [NodeType.Caption]: 'Caption',
  [NodeType.Label]: 'Label',
  [NodeType.Ref]: 'Ref',

  [NodeType.Cite]: 'Cite',
  [NodeType.Bibliography]: 'Bibliography',
  [NodeType.BibItem]: 'BibItem',

  [NodeType.Error]: 'Error',
  [NodeType.UnmatchedBrace]: 'UnmatchedBrace',
  [NodeType.UnmatchedEnvironment]: 'UnmatchedEnvironment',
  [NodeType.InvalidCommand]: 'InvalidCommand',
};

// ================================
// 节点接口定义
// ================================

/**
 * 基础节点接口
 */
export interface LatexASTNode {
  /** 节点类型 */
  type: NodeTypeValue;
  /** 节点名称 */
  name: string;
  /** 起始位置 */
  from: number;
  /** 结束位置 */
  to: number;
  /** 子节点 */
  children?: LatexASTNode[];
  /** 节点哈希值（用于增量更新） */
  hash?: string;
  /** 父节点引用 */
  parent?: LatexASTNode;
}

/**
 * 命令节点
 */
export interface CommandASTNode extends LatexASTNode {
  type: typeof NodeType.Command;
  /** 命令名称（不含反斜杠） */
  commandName: string;
  /** 是否为星号版本 */
  star: boolean;
  /** 可选参数 */
  optionalArgs: string[];
  /** 必选参数 */
  requiredArgs: string[];
}

/**
 * 环境节点
 */
export interface EnvironmentASTNode extends LatexASTNode {
  type: typeof NodeType.Environment;
  /** 环境名称 */
  environmentName: string;
  /** 可选参数 */
  optionalArgs: string[];
  /** 必选参数 */
  requiredArgs: string[];
}

/**
 * 数学节点
 */
export interface MathASTNode extends LatexASTNode {
  type: typeof NodeType.InlineMath | typeof NodeType.DisplayMath | typeof NodeType.MathEnvironment;
  /** 数学内容 */
  content: string;
  /** 分隔符类型 */
  delimiter: '$' | '$$' | '\\(' | '\\[' | 'equation' | 'align' | 'gather' | string;
  /** 是否有编号 */
  numbered: boolean;
}

/**
 * 章节节点
 */
export interface SectionASTNode extends LatexASTNode {
  type:
    | typeof NodeType.Section
    | typeof NodeType.Chapter
    | typeof NodeType.Subsection
    | typeof NodeType.Subsubsection
    | typeof NodeType.Paragraph
    | typeof NodeType.Subparagraph;
  /** 章节标题 */
  title: string;
  /** 章节级别 */
  level: number;
  /** 是否为星号版本（无编号） */
  star: boolean;
}

/**
 * 列表项节点
 */
export interface ItemASTNode extends LatexASTNode {
  type: typeof NodeType.Item;
  /** 标签（描述列表） */
  label?: string;
}

/**
 * 表格单元格节点
 */
export interface TableCellASTNode extends LatexASTNode {
  type: typeof NodeType.TableCell;
  /** 列索引 */
  columnIndex: number;
  /** 行索引 */
  rowIndex: number;
  /** 是否合并单元格 */
  colspan?: number;
  rowspan?: number;
}

/**
 * 注释节点
 */
export interface CommentASTNode extends LatexASTNode {
  type: typeof NodeType.Comment;
  /** 注释内容 */
  content: string;
}

/**
 * 错误节点
 */
export interface ErrorASTNode extends LatexASTNode {
  type:
    | typeof NodeType.Error
    | typeof NodeType.UnmatchedBrace
    | typeof NodeType.UnmatchedEnvironment
    | typeof NodeType.InvalidCommand;
  /** 错误信息 */
  message: string;
  /** 错误严重程度 */
  severity: 'error' | 'warning' | 'info';
}

// ================================
// 解析器配置接口
// ================================

/**
 * LaTeX Lezer 解析器配置
 */
export interface LatexLezerConfig {
  /** 是否保留注释节点 */
  preserveComments: boolean;
  /** 是否解析数学内容的内部结构 */
  parseMathContent: boolean;
  /** 是否保留空白节点 */
  preserveWhitespace: boolean;
  /** 最大解析深度 */
  maxDepth: number;
  /** 解析超时时间（毫秒） */
  timeout: number;
  /** 是否启用错误恢复 */
  errorRecovery: boolean;
  /** 是否启用增量解析 */
  incremental: boolean;
}

/**
 * 默认解析器配置
 */
export const DEFAULT_LATEX_LEZER_CONFIG: LatexLezerConfig = {
  preserveComments: true,
  parseMathContent: true,
  preserveWhitespace: false,
  maxDepth: 100,
  timeout: 5000,
  errorRecovery: true,
  incremental: true,
};

// ================================
// 解析结果接口
// ================================

/**
 * 解析错误
 */
export interface LatexParseError {
  /** 错误消息 */
  message: string;
  /** 起始位置 */
  from: number;
  /** 结束位置 */
  to: number;
  /** 行号 */
  line: number;
  /** 列号 */
  column: number;
  /** 严重程度 */
  severity: 'error' | 'warning' | 'info';
}

/**
 * 解析结果
 */
export interface LatexLezerParseResult {
  /** 根节点 */
  root: LatexASTNode;
  /** 所有节点的映射表 */
  nodeMap: Map<number, LatexASTNode>;
  /** 解析错误列表 */
  errors: LatexParseError[];
  /** 警告列表 */
  warnings: LatexParseError[];
  /** 解析是否成功 */
  success: boolean;
  /** 解析耗时（毫秒） */
  parseTime: number;
  /** 文档版本号 */
  version: number;
}

/**
 * 增量解析结果
 */
export interface LatexLezerIncrementalResult extends LatexLezerParseResult {
  /** 受影响的节点 ID 列表 */
  affectedNodes: number[];
  /** 需要重新渲染的节点 ID 列表 */
  dirtyNodes: number[];
  /** 是否进行了完整重新解析 */
  fullReparse: boolean;
  /** 重用的节点数量 */
  reusedNodeCount: number;
  /** 新创建的节点数量 */
  newNodeCount: number;
}

// ================================
// 常量定义
// ================================

/**
 * 章节命令及其级别
 */
export const SECTION_COMMANDS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

/**
 * 列表环境名称
 */
export const LIST_ENVIRONMENTS = ['itemize', 'enumerate', 'description'] as const;

/**
 * 数学环境名称
 */
export const MATH_ENVIRONMENTS = [
  // 基本公式环境
  'equation',
  'equation*',
  // 对齐公式环境
  'align',
  'align*',
  'alignat',
  'alignat*',
  'flalign',
  'flalign*',
  'eqnarray',
  'eqnarray*',
  // 居中多行公式环境
  'gather',
  'gather*',
  'multline',
  'multline*',
  // 嵌套/子环境
  'split',
  'aligned',
  'gathered',
  'alignedat',
  // 矩阵环境
  'array',
  'matrix',
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Vmatrix',
  'Bmatrix',
  'smallmatrix',
  // 分段函数环境
  'cases',
  'dcases',
  'rcases',
  // 子公式环境
  'subequations',
] as const;

/**
 * 表格环境名称
 */
export const TABLE_ENVIRONMENTS = ['tabular', 'tabular*', 'table', 'table*', 'longtable'] as const;

/**
 * 浮动体环境名称
 */
export const FLOAT_ENVIRONMENTS = ['figure', 'figure*', 'table', 'table*'] as const;

/**
 * 原样输出环境名称
 */
export const VERBATIM_ENVIRONMENTS = ['verbatim', 'lstlisting', 'minted', 'Verbatim'] as const;

/**
 * 特殊字符集
 */
export const SPECIAL_CHARS = new Set(['\\', '{', '}', '$', '&', '#', '^', '_', '%', '~']);

/**
 * 命令参数数量定义
 */
export const COMMAND_ARG_COUNTS: Record<string, { required: number; optional: number }> = {
  // 文档结构
  documentclass: { required: 1, optional: 1 },
  usepackage: { required: 1, optional: 1 },
  begin: { required: 1, optional: 0 },
  end: { required: 1, optional: 0 },

  // 章节
  part: { required: 1, optional: 1 },
  chapter: { required: 1, optional: 1 },
  section: { required: 1, optional: 1 },
  subsection: { required: 1, optional: 1 },
  subsubsection: { required: 1, optional: 1 },
  paragraph: { required: 1, optional: 1 },
  subparagraph: { required: 1, optional: 1 },

  // 引用
  label: { required: 1, optional: 0 },
  ref: { required: 1, optional: 0 },
  cite: { required: 1, optional: 1 },
  bibliography: { required: 1, optional: 0 },

  // 格式
  textbf: { required: 1, optional: 0 },
  textit: { required: 1, optional: 0 },
  emph: { required: 1, optional: 0 },
  underline: { required: 1, optional: 0 },
  texttt: { required: 1, optional: 0 },

  // 图片
  includegraphics: { required: 1, optional: 1 },
  caption: { required: 1, optional: 1 },

  // 链接
  href: { required: 2, optional: 0 },
  url: { required: 1, optional: 0 },

  // 列表
  item: { required: 0, optional: 1 },

  // 脚注
  footnote: { required: 1, optional: 0 },

  // 其他
  input: { required: 1, optional: 0 },
  include: { required: 1, optional: 0 },
  newcommand: { required: 2, optional: 1 },
  renewcommand: { required: 2, optional: 1 },
  newenvironment: { required: 3, optional: 1 },
};
