// ================================
// LaTeX AST 类型定义
// 用于增量编译和缓存的统一类型系统
// ================================

// ================================
// 基础节点类型
// ================================

/** 节点类型枚举 */
type LatexNodeType =
  | 'root'           // 根节点
  | 'preamble'       // 前言区域
  | 'document'       // 文档正文
  | 'command'        // 命令 \xxx
  | 'environment'    // 环境 \begin{xxx}...\end{xxx}
  | 'group'          // 分组 {...}
  | 'text'           // 纯文本
  | 'math_inline'    // 行内公式 $...$
  | 'math_block'     // 块级公式 $$...$$ 或 \[...\]
  | 'comment'        // 注释 %...
  | 'paragraph'      // 段落
  | 'section'        // 章节标题
  | 'list'           // 列表环境
  | 'list_item'      // 列表项
  | 'error';         // 错误节点

/** 基础节点接口 */
export interface LatexNode {
  /** 节点类型 */
  type: LatexNodeType;
  /** 节点唯一标识符（用于增量更新） */
  id: string;
  /** 原始文本在源码中的起始位置 */
  start: number;
  /** 原始文本在源码中的结束位置 */
  end: number;
  /** 原始文本内容 */
  raw: string;
  /** 节点哈希值（用于快速比较） */
  hash: string;
  /** 子节点 */
  children?: LatexNode[];
}

// ================================
// 具体节点类型
// ================================

/** 根节点 */
export interface RootNode extends LatexNode {
  type: 'root';
  /** 前言区域 */
  preamble: PreambleNode | null;
  /** 文档正文 */
  document: DocumentNode | null;
  /** 文档类 */
  documentClass: string | null;
  /** 解析版本（用于缓存失效） */
  version: number;
}

/** 前言节点 */
export interface PreambleNode extends LatexNode {
  type: 'preamble';
  /** 使用的宏包 */
  packages: PackageInfo[];
  /** 自定义命令定义 */
  commands: MacroDefinition[];
  /** 自定义环境定义 */
  environments: MacroDefinition[];
  /** 标题信息 */
  title?: string;
  /** 作者信息 */
  author?: string;
  /** 日期信息 */
  date?: string;
}

/** 宏包信息 */
export interface PackageInfo {
  /** 包名 */
  name: string;
  /** 选项 */
  options: string[];
}

/** 宏定义 */
export interface MacroDefinition {
  /** 宏名称 */
  name: string;
  /** 参数数量 */
  numArgs: number;
  /** 默认参数 */
  defaultArgs: string[];
  /** 展开后的内容 */
  expansion: string;
  /** 原始定义 */
  raw: string;
}

/** 文档节点 */
export interface DocumentNode extends LatexNode {
  type: 'document';
  /** 段落列表 */
  children: LatexNode[];
}

/** 命令节点 */
export interface CommandNode extends LatexNode {
  type: 'command';
  /** 命令名称（不含反斜杠） */
  name: string;
  /** 可选参数 */
  options: string[];
  /** 必选参数 */
  args: LatexNode[][];
  /** 是否为星号版本 */
  star: boolean;
}

/** 环境节点 */
export interface EnvironmentNode extends LatexNode {
  type: 'environment';
  /** 环境名称 */
  name: string;
  /** 可选参数 */
  options: string[];
  /** 必选参数 */
  args: LatexNode[][];
  /** 环境内容 */
  children: LatexNode[];
}

/** 分组节点 */
export interface GroupNode extends LatexNode {
  type: 'group';
  /** 分组内容 */
  children: LatexNode[];
}

/** 文本节点 */
export interface TextNode extends LatexNode {
  type: 'text';
  /** 文本内容 */
  content: string;
}

/** 行内公式节点 */
export interface MathInlineNode extends LatexNode {
  type: 'math_inline';
  /** 公式内容（不含分隔符） */
  content: string;
  /** 使用的分隔符类型 */
  delimiter: '$' | '\\(';
}

/**
 * 块级公式分隔符
 * 取值为 $$、\[ 或数学环境名（equation、align、gather、pmatrix、cases 等），
 * 解析器遇到未知数学环境时会原样保留环境名，因此需要允许任意字符串
 */
type MathBlockDelimiter = '$$' | '\\[' | (string & {});

/** 块级公式节点 */
export interface MathBlockNode extends LatexNode {
  type: 'math_block';
  /** 公式内容（不含分隔符） */
  content: string;
  /** 使用的分隔符类型或数学环境名 */
  delimiter: MathBlockDelimiter;
  /** 是否有编号 */
  numbered: boolean;
  /** 标签 */
  label?: string;
}

/** 注释节点 */
export interface CommentNode extends LatexNode {
  type: 'comment';
  /** 注释内容 */
  content: string;
}


/** 段落节点 */
export interface ParagraphNode extends LatexNode {
  type: 'paragraph';
  /** 段落内容 */
  children: LatexNode[];
}

/** 章节节点 */
export interface SectionNode extends LatexNode {
  type: 'section';
  /** 章节级别：part, chapter, section, subsection, subsubsection, paragraph, subparagraph */
  level: 'part' | 'chapter' | 'section' | 'subsection' | 'subsubsection' | 'paragraph' | 'subparagraph';
  /** 标题内容 */
  title: LatexNode[];
  /** 是否为星号版本（无编号） */
  star: boolean;
  /** 标签 */
  label?: string;
}

/** 列表节点 */
export interface ListNode extends LatexNode {
  type: 'list';
  /** 列表类型 */
  listType: 'itemize' | 'enumerate' | 'description';
  /** 列表项 */
  children: ListItemNode[];
}

/** 列表项节点 */
export interface ListItemNode extends LatexNode {
  type: 'list_item';
  /** 描述列表的标签 */
  label?: string;
  /** 列表项内容 */
  children: LatexNode[];
}

/** 错误节点 */
export interface ErrorNode extends LatexNode {
  type: 'error';
  /** 错误消息 */
  message: string;
  /** 错误严重程度 */
  severity: 'error' | 'warning' | 'info';
}

/** 所有节点类型的联合类型 */
export type AnyLatexNode =
  | RootNode
  | PreambleNode
  | DocumentNode
  | CommandNode
  | EnvironmentNode
  | GroupNode
  | TextNode
  | MathInlineNode
  | MathBlockNode
  | CommentNode
  | ParagraphNode
  | SectionNode
  | ListNode
  | ListItemNode
  | ErrorNode;

// ================================
// 解析器选项和结果
// ================================

/** 解析器选项 */
export interface LatexParserOptions {
  /** 是否保留注释 */
  preserveComments?: boolean;
  /** 是否保留空白 */
  preserveWhitespace?: boolean;
  /** 最大解析深度 */
  maxDepth?: number;
}

/** 解析结果 */
export interface LatexParseResult {
  /** 解析后的 AST */
  ast: RootNode;
  /** 错误消息列表 */
  errors: string[];
}

// ================================
// 渲染相关类型
// ================================

/** 渲染选项 */
export interface LatexRenderOptions {
  /** 是否显示错误 */
  showErrors?: boolean;
  /** 自定义 CSS 类前缀 */
  classPrefix?: string;
}


// ================================
// 增量渲染块与渲染 Worker 消息
// ================================

/** 全文 section 索引条目（\tableofcontents 渲染依据） */
export interface TocEntry {
  /** 锚点 ID（section-节点ID） */
  id: string;
  /** 标题纯文本 */
  title: string;
  /** 章节级别 */
  level: string;
  /** 缩进深度 */
  depth: number;
}

/** 块类型：前言块只产出标题，正文块渲染其顶层节点 */
export type LatexBlockKind = 'preamble' | 'body';

/** 发送给渲染 Worker 的块 */
export interface RenderJob {
  id: string;
  renderKey: string;
  kind: LatexBlockKind;
  nodes: readonly LatexNode[];
}

/** 块渲染结果 */
export interface RenderedBlock {
  id: string;
  /** 渲染时使用的 renderKey，提交前用来判断结果是否仍然有效 */
  renderKey: string;
  html: string;
}

/** 渲染 Worker 请求：一批块 + 渲染所需的全局上下文 */
export interface RenderWorkerRequest {
  id: number;
  options: LatexRenderOptions;
  preamble: PreambleNode | null;
  sectionIndex: TocEntry[];
  jobs: RenderJob[];
}

/** 渲染 Worker 响应 */
export interface RenderWorkerResponse {
  id: number;
  results?: RenderedBlock[];
  error?: string;
}
