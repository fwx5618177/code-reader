// ================================
// LaTeX AST 类型定义
// 用于增量编译和缓存的统一类型系统
// ================================

// ================================
// 基础节点类型
// ================================

/** 节点类型枚举 */
export type LatexNodeType =
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
  | 'newline'        // 换行
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
export type MathBlockDelimiter = '$$' | '\\[' | (string & {});

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

/** 换行节点 */
export interface NewlineNode extends LatexNode {
  type: 'newline';
  /** 是否为段落分隔（双换行） */
  isParagraphBreak: boolean;
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
  /** 章节编号 */
  number?: string;
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
  | NewlineNode
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
  /** 是否为严格模式 */
  strict?: boolean;
  /** 是否解析数学公式内部结构 */
  parseMathContent?: boolean;
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
  /** 是否成功 */
  success: boolean;
  /** 错误列表 */
  errors: ParseError[];
  /** 警告列表 */
  warnings: ParseWarning[];
  /** 解析耗时（毫秒） */
  parseTime: number;
}

/** 解析错误 */
export interface ParseError {
  /** 错误消息 */
  message: string;
  /** 起始位置 */
  start: number;
  /** 结束位置 */
  end: number;
  /** 行号 */
  line: number;
  /** 列号 */
  column: number;
}

/** 解析警告 */
export interface ParseWarning {
  /** 警告消息 */
  message: string;
  /** 起始位置 */
  start: number;
  /** 结束位置 */
  end: number;
  /** 行号 */
  line: number;
  /** 列号 */
  column: number;
}

// ================================
// 渲染相关类型
// ================================

/** 渲染选项 */
export interface LatexRenderOptions {
  /** 基础字体大小 */
  baseFontSize?: number;
  /** 是否显示错误 */
  showErrors?: boolean;
  /** 是否渲染行号 */
  showLineNumbers?: boolean;
  /** 自定义 CSS 类前缀 */
  classPrefix?: string;
}

/** 渲染结果 */
export interface LatexRenderResult {
  /** 渲染后的 HTML */
  html: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 渲染耗时（毫秒） */
  renderTime: number;
}

/** 渲染块信息（用于可视区域优先渲染） */
export interface RenderBlock {
  /** 块 ID */
  id: string;
  /** 对应的 AST 节点 */
  node: LatexNode;
  /** 渲染后的 HTML（可能为 null 表示尚未渲染） */
  html: string | null;
  /** 估算高度（像素） */
  estimatedHeight: number;
  /** 是否在可视区域内 */
  isVisible: boolean;
  /** 优先级（越小越优先） */
  priority: number;
}

// ================================
// 增量更新相关类型
// ================================

/** 文档变更 */
export interface DocumentChange {
  /** 变更起始位置 */
  from: number;
  /** 变更结束位置 */
  to: number;
  /** 插入的文本 */
  insert: string;
  /** 删除的文本 */
  deleted: string;
}

/** 增量解析结果 */
export interface IncrementalParseResult {
  /** 更新后的 AST */
  ast: RootNode;
  /** 受影响的节点 ID 列表 */
  affectedNodeIds: string[];
  /** 需要重新渲染的节点 ID 列表 */
  dirtyNodeIds: string[];
  /** 是否需要完全重新解析 */
  fullReparse: boolean;
  /** 解析耗时（毫秒） */
  parseTime: number;
}

// ================================
// 缓存相关类型
// ================================

/** AST 缓存项 */
export interface ASTCacheEntry {
  /** 文档内容的哈希值 */
  contentHash: string;
  /** 缓存的 AST */
  ast: RootNode;
  /** 创建时间戳 */
  timestamp: number;
  /** 访问次数 */
  accessCount: number;
  /** 最后访问时间 */
  lastAccess: number;
}

/** 渲染缓存项 */
export interface RenderCacheEntry {
  /** 节点哈希值 */
  nodeHash: string;
  /** 渲染后的 HTML */
  html: string;
  /** 创建时间戳 */
  timestamp: number;
  /** 访问次数 */
  accessCount: number;
}

/** 缓存配置 */
export interface CacheConfig {
  /** 最大缓存条目数 */
  maxEntries: number;
  /** 缓存过期时间（毫秒） */
  ttl: number;
  /** 是否启用 LRU 淘汰策略 */
  useLRU: boolean;
}

// ================================
// Web Worker 消息类型
// ================================

/** Worker 消息类型 */
export type WorkerMessageType =
  | 'parse'
  | 'parse_incremental'
  | 'render'
  | 'render_block'
  | 'cancel'
  | 'reset';

/** 发送给 Worker 的消息 */
export interface WorkerRequest {
  /** 请求 ID */
  id: string;
  /** 消息类型 */
  type: WorkerMessageType;
  /** 请求数据 */
  data: unknown;
}

/** Worker 返回的消息 */
export interface WorkerResponse {
  /** 请求 ID */
  id: string;
  /** 是否成功 */
  success: boolean;
  /** 返回数据 */
  data?: unknown;
  /** 错误信息 */
  error?: string;
  /** 处理耗时 */
  time: number;
}

// ================================
// 导出所有类型
// ================================

export type {
  LatexNodeType as NodeType,
  LatexNode as Node,
  AnyLatexNode as AnyNode,
};
