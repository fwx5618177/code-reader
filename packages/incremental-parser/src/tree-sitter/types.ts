// ================================
// Tree-sitter 适配器 - 类型定义
//
// 为 Tree-sitter 提供类型定义和接口抽象
// Tree-sitter 是 GitHub、Neovim、Helix、Zed 使用的增量解析器
//
// 注意：Tree-sitter 需要 WASM 运行时，适合 Native/Electron 场景
// 对于纯 Web 场景，推荐使用 Lezer
// ================================

import type { ASTNode, ASTRoot, ParseResult, IncrementalParseResult, ParserConfig, TextChangeSet } from '../types';

// ================================
// Tree-sitter 特定类型
// ================================

/** Tree-sitter 语言配置 */
export interface TreeSitterLanguageConfig {
  /** 语言名称 */
  name: string;
  /** WASM 文件路径或 URL */
  wasmPath: string;
  /** 文件扩展名 */
  extensions: string[];
  /** 语言别名 */
  aliases?: string[];
}

/** Tree-sitter 点位置 */
export interface TreeSitterPoint {
  /** 行号（从 0 开始） */
  row: number;
  /** 列号（字节偏移，从 0 开始） */
  column: number;
}

/** Tree-sitter 范围 */
export interface TreeSitterRange {
  /** 起始点 */
  startPosition: TreeSitterPoint;
  /** 结束点 */
  endPosition: TreeSitterPoint;
  /** 起始字节偏移 */
  startIndex: number;
  /** 结束字节偏移 */
  endIndex: number;
}

/** Tree-sitter 输入编辑 */
export interface TreeSitterInputEdit {
  /** 编辑起始字节 */
  startIndex: number;
  /** 编辑前的结束字节 */
  oldEndIndex: number;
  /** 编辑后的结束字节 */
  newEndIndex: number;
  /** 编辑起始位置 */
  startPosition: TreeSitterPoint;
  /** 编辑前的结束位置 */
  oldEndPosition: TreeSitterPoint;
  /** 编辑后的结束位置 */
  newEndPosition: TreeSitterPoint;
}

/** Tree-sitter 节点（WASM 绑定接口） */
export interface TreeSitterNode {
  /** 节点 ID */
  readonly id: number;
  /** 节点类型 */
  readonly type: string;
  /** 节点类型 ID */
  readonly typeId: number;
  /** 语法节点名称 */
  readonly grammarType: string;
  /** 是否命名节点 */
  readonly isNamed: boolean;
  /** 是否缺失节点（错误恢复） */
  readonly isMissing: boolean;
  /** 是否有错误 */
  readonly hasError: boolean;
  /** 是否有变更（相对于上次解析） */
  readonly hasChanges: boolean;
  /** 是否额外节点（如注释） */
  readonly isExtra: boolean;
  /** 节点文本 */
  readonly text: string;
  /** 起始字节偏移 */
  readonly startIndex: number;
  /** 结束字节偏移 */
  readonly endIndex: number;
  /** 起始位置 */
  readonly startPosition: TreeSitterPoint;
  /** 结束位置 */
  readonly endPosition: TreeSitterPoint;
  /** 父节点 */
  readonly parent: TreeSitterNode | null;
  /** 子节点数量 */
  readonly childCount: number;
  /** 命名子节点数量 */
  readonly namedChildCount: number;
  /** 第一个子节点 */
  readonly firstChild: TreeSitterNode | null;
  /** 第一个命名子节点 */
  readonly firstNamedChild: TreeSitterNode | null;
  /** 最后一个子节点 */
  readonly lastChild: TreeSitterNode | null;
  /** 最后一个命名子节点 */
  readonly lastNamedChild: TreeSitterNode | null;
  /** 下一个兄弟节点 */
  readonly nextSibling: TreeSitterNode | null;
  /** 下一个命名兄弟节点 */
  readonly nextNamedSibling: TreeSitterNode | null;
  /** 上一个兄弟节点 */
  readonly previousSibling: TreeSitterNode | null;
  /** 上一个命名兄弟节点 */
  readonly previousNamedSibling: TreeSitterNode | null;
  /** 子节点列表 */
  readonly children: TreeSitterNode[];
  /** 命名子节点列表 */
  readonly namedChildren: TreeSitterNode[];

  // 方法
  /** 获取第 n 个子节点 */
  child(index: number): TreeSitterNode | null;
  /** 获取第 n 个命名子节点 */
  namedChild(index: number): TreeSitterNode | null;
  /** 通过字段名获取子节点 */
  childForFieldName(fieldName: string): TreeSitterNode | null;
  /** 通过字段 ID 获取子节点 */
  childForFieldId(fieldId: number): TreeSitterNode | null;
  /** 获取包含指定位置的最深节点 */
  descendantForPosition(position: TreeSitterPoint): TreeSitterNode | null;
  /** 获取包含指定范围的最深节点 */
  descendantForPosition(startPosition: TreeSitterPoint, endPosition: TreeSitterPoint): TreeSitterNode | null;
  /** 获取包含指定字节范围的最深节点 */
  descendantForIndex(startIndex: number, endIndex?: number): TreeSitterNode | null;
  /** 创建遍历游标 */
  walk(): TreeSitterTreeCursor;
  /** 转换为 S 表达式 */
  toString(): string;
}

/** Tree-sitter 树遍历游标 */
export interface TreeSitterTreeCursor {
  /** 当前节点类型 */
  readonly nodeType: string;
  /** 当前节点类型 ID */
  readonly nodeTypeId: number;
  /** 当前节点是否命名 */
  readonly nodeIsNamed: boolean;
  /** 当前节点是否缺失 */
  readonly nodeIsMissing: boolean;
  /** 当前节点文本 */
  readonly nodeText: string;
  /** 当前节点起始位置 */
  readonly startPosition: TreeSitterPoint;
  /** 当前节点结束位置 */
  readonly endPosition: TreeSitterPoint;
  /** 当前节点起始字节 */
  readonly startIndex: number;
  /** 当前节点结束字节 */
  readonly endIndex: number;
  /** 当前节点 */
  readonly currentNode: TreeSitterNode;
  /** 当前字段名 */
  readonly currentFieldName: string | null;
  /** 当前字段 ID */
  readonly currentFieldId: number;
  /** 当前深度 */
  readonly currentDepth: number;

  // 导航方法
  /** 重置到指定节点 */
  reset(node: TreeSitterNode): void;
  /** 移动到父节点 */
  gotoParent(): boolean;
  /** 移动到第一个子节点 */
  gotoFirstChild(): boolean;
  /** 移动到第一个包含指定字节的子节点 */
  gotoFirstChildForIndex(index: number): boolean;
  /** 移动到第一个包含指定位置的子节点 */
  gotoFirstChildForPosition(position: TreeSitterPoint): boolean;
  /** 移动到最后一个子节点 */
  gotoLastChild(): boolean;
  /** 移动到下一个兄弟节点 */
  gotoNextSibling(): boolean;
  /** 移动到上一个兄弟节点 */
  gotoPreviousSibling(): boolean;
  /** 移动到后代节点（包含指定字节） */
  gotoDescendant(index: number): void;
}

/** Tree-sitter 语法树 */
export interface TreeSitterTree {
  /** 根节点 */
  readonly rootNode: TreeSitterNode;
  /** 语言 */
  readonly language: TreeSitterLanguage;
  /** 包含范围列表 */
  readonly includedRanges: TreeSitterRange[];

  // 方法
  /** 拷贝语法树 */
  copy(): TreeSitterTree;
  /** 删除语法树 */
  delete(): void;
  /** 编辑语法树（标记变更区域） */
  edit(edit: TreeSitterInputEdit): void;
  /** 创建遍历游标 */
  walk(): TreeSitterTreeCursor;
  /** 获取变更范围（与另一棵树对比） */
  getChangedRanges(other: TreeSitterTree): TreeSitterRange[];
  /** 获取编辑后的范围 */
  getEditedRange(): TreeSitterRange | null;
  /** 获取包含指定位置的最深节点 */
  rootNodeWithOffset(offsetBytes: number, offsetExtent: TreeSitterPoint): TreeSitterNode;
  /** 转换为 S 表达式 */
  toString(): string;
}

/** Tree-sitter 语言 */
export interface TreeSitterLanguage {
  /** 语言版本 */
  readonly version: number;
  /** 节点类型数量 */
  readonly nodeTypeCount: number;
  /** 字段数量 */
  readonly fieldCount: number;
  /** 状态数量 */
  readonly stateCount: number;
  /** 语言名称 */
  readonly name?: string;

  // 方法
  /** 获取节点类型名称 */
  nodeTypeForId(typeId: number): string | null;
  /** 获取节点类型 ID */
  idForNodeType(type: string, named: boolean): number;
  /** 获取字段名称 */
  fieldNameForId(fieldId: number): string | null;
  /** 获取字段 ID */
  fieldIdForName(fieldName: string): number;
  /** 节点类型是否命名 */
  nodeTypeIsNamed(typeId: number): boolean;
  /** 节点类型是否可见 */
  nodeTypeIsVisible(typeId: number): boolean;
  /** 下一个状态 */
  nextState(stateId: number, typeId: number): number;
}

/** Tree-sitter 解析器 */
export interface TreeSitterParser {
  /** 当前语言 */
  readonly language: TreeSitterLanguage | null;

  // 方法
  /** 设置语言 */
  setLanguage(language: TreeSitterLanguage | null): void;
  /** 获取语言 */
  getLanguage(): TreeSitterLanguage | null;
  /** 解析文本 */
  parse(input: string | TreeSitterInput, oldTree?: TreeSitterTree | null, options?: TreeSitterParseOptions): TreeSitterTree;
  /** 设置超时时间（微秒） */
  setTimeoutMicros(timeout: number): void;
  /** 获取超时时间（微秒） */
  getTimeoutMicros(): number;
  /** 设置包含范围 */
  setIncludedRanges(ranges: TreeSitterRange[]): void;
  /** 获取包含范围 */
  getIncludedRanges(): TreeSitterRange[];
  /** 重置解析器 */
  reset(): void;
  /** 打印 DOT 图 */
  printDotGraphs(enable: boolean): void;
  /** 删除解析器 */
  delete(): void;
}

/** Tree-sitter 解析输入回调 */
export type TreeSitterInput = (
  startIndex: number,
  startPoint: TreeSitterPoint | null,
  endIndex: number | null
) => string | null;

/** Tree-sitter 解析选项 */
export interface TreeSitterParseOptions {
  /** 包含范围 */
  includedRanges?: TreeSitterRange[];
}

/** Tree-sitter 查询 */
export interface TreeSitterQuery {
  /** 模式数量 */
  readonly patternCount: number;
  /** 捕获名称列表 */
  readonly captureNames: string[];

  // 方法
  /** 删除查询 */
  delete(): void;
  /** 在节点上执行查询 */
  matches(node: TreeSitterNode, options?: TreeSitterQueryOptions): TreeSitterQueryMatch[];
  /** 在节点上执行捕获 */
  captures(node: TreeSitterNode, options?: TreeSitterQueryOptions): TreeSitterQueryCapture[];
  /** 禁用模式 */
  disablePattern(index: number): void;
  /** 禁用捕获 */
  disableCapture(name: string): void;
  /** 检查模式是否保证在根节点 */
  isPatternGuaranteedAtStep(index: number): boolean;
  /** 检查模式是否不确定 */
  isPatternNonLocal(index: number): boolean;
  /** 检查模式是否可路由 */
  isPatternRooted(index: number): boolean;
}

/** Tree-sitter 查询选项 */
export interface TreeSitterQueryOptions {
  /** 起始位置 */
  startPosition?: TreeSitterPoint;
  /** 结束位置 */
  endPosition?: TreeSitterPoint;
  /** 起始字节 */
  startIndex?: number;
  /** 结束字节 */
  endIndex?: number;
  /** 匹配限制 */
  matchLimit?: number;
  /** 最大起始深度 */
  maxStartDepth?: number;
}

/** Tree-sitter 查询匹配 */
export interface TreeSitterQueryMatch {
  /** 模式索引 */
  pattern: number;
  /** 捕获列表 */
  captures: TreeSitterQueryCapture[];
}

/** Tree-sitter 查询捕获 */
export interface TreeSitterQueryCapture {
  /** 捕获名称 */
  name: string;
  /** 捕获节点 */
  node: TreeSitterNode;
}

// ================================
// 适配器解析器配置
// ================================

/** Tree-sitter 适配器配置 */
export interface TreeSitterAdapterConfig extends ParserConfig {
  /** 语言配置 */
  language: TreeSitterLanguageConfig;
  /** WASM 初始化函数（如果已经加载） */
  initWasm?: () => Promise<void>;
  /** 解析超时时间（毫秒） */
  parseTimeoutMs?: number;
  /** 是否启用增量解析 */
  enableIncremental?: boolean;
  /** 最大缓存树数量 */
  maxCachedTrees?: number;
}

/** Tree-sitter 解析状态 */
export interface TreeSitterParseState {
  /** 当前文档内容 */
  content: string;
  /** 当前语法树 */
  tree: TreeSitterTree | null;
  /** 版本号 */
  version: number;
  /** 节点映射表 */
  nodeMap: Map<string, TreeSitterNodeMapping>;
}

/** Tree-sitter 节点映射 */
export interface TreeSitterNodeMapping {
  /** 节点 ID */
  id: string;
  /** 原始 Tree-sitter 节点 ID */
  originalId: number;
  /** 节点类型 */
  type: string;
  /** 起始字节 */
  startIndex: number;
  /** 结束字节 */
  endIndex: number;
  /** 父节点 ID */
  parent?: string;
  /** 子节点 ID 列表 */
  children: string[];
  /** 节点哈希 */
  hash: string;
}

// ================================
// 适配器接口
// ================================

/** Tree-sitter 增量解析器接口 */
export interface ITreeSitterParser {
  /** 语言名称 */
  readonly language: string;

  /** 是否已初始化 */
  readonly isInitialized: boolean;

  /** 初始化解析器（加载 WASM） */
  initialize(): Promise<void>;

  /** 解析完整文档 */
  parse(content: string, config?: ParserConfig): ParseResult<ASTNode>;

  /** 增量解析 */
  parseIncremental(
    content: string,
    changes: TextChangeSet,
    previousAST: ASTRoot<ASTNode>,
    config?: ParserConfig
  ): IncrementalParseResult<ASTNode>;

  /** 获取当前语法树 */
  getTree(): TreeSitterTree | null;

  /** 获取当前内容 */
  getContent(): string;

  /** 获取当前版本号 */
  getVersion(): number;

  /** 清除缓存 */
  clearCache(): void;

  /** 销毁解析器（释放 WASM 资源） */
  dispose(): void;
}

// ================================
// 工具类型
// ================================

/** 将 Tree-sitter 节点转换为通用 AST 节点的转换器 */
export type TreeSitterNodeTransformer = (
  node: TreeSitterNode,
  content: string,
  parent?: ASTNode
) => ASTNode;

/** Tree-sitter 初始化状态 */
export type TreeSitterInitState = 'uninitialized' | 'initializing' | 'initialized' | 'error';

/** Tree-sitter 错误类型 */
export type TreeSitterErrorType =
  | 'wasm_load_failed'
  | 'language_load_failed'
  | 'parse_timeout'
  | 'parse_error'
  | 'not_initialized';
