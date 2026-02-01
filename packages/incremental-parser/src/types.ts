// ================================
// 增量解析库 - 核心类型定义
//
// 提供增量解析、AST 缓存、文本数据结构等功能所需的类型
// ================================

// ================================
// 文本变更类型
// ================================

/** 文本变更操作 */
export interface TextChange {
  /** 变更起始位置（字符偏移量） */
  readonly from: number;
  /** 变更结束位置（字符偏移量，不包含） */
  readonly to: number;
  /** 插入的文本 */
  readonly insert: string;
  /** 被删除的文本（可选，用于撤销） */
  readonly deleted?: string;
}

/** 批量文本变更 */
export interface TextChangeSet {
  /** 变更列表（按位置排序） */
  readonly changes: readonly TextChange[];
  /** 变更前的文档长度 */
  readonly oldLength: number;
  /** 变更后的文档长度 */
  readonly newLength: number;
}

/** 位置信息 */
export interface Position {
  /** 行号（从 0 开始） */
  readonly line: number;
  /** 列号（从 0 开始） */
  readonly column: number;
  /** 字符偏移量 */
  readonly offset: number;
}

/** 范围信息 */
export interface Range {
  /** 起始位置 */
  readonly start: Position;
  /** 结束位置 */
  readonly end: Position;
}

// ================================
// 文本缓冲区类型
// ================================

/** 文本缓冲区接口 */
export interface ITextBuffer {
  /** 获取文档总长度 */
  readonly length: number;
  /** 获取行数 */
  readonly lineCount: number;

  /** 获取完整文本 */
  toString(): string;

  /** 获取指定范围的文本 */
  slice(start: number, end?: number): string;

  /** 获取指定行的文本 */
  getLine(line: number): string;

  /** 获取指定行的起始偏移量 */
  getLineOffset(line: number): number;

  /** 根据偏移量获取位置 */
  positionAt(offset: number): Position;

  /** 根据位置获取偏移量 */
  offsetAt(position: Position): number;

  /** 应用变更 */
  apply(changes: TextChangeSet): ITextBuffer;

  /** 插入文本 */
  insert(offset: number, text: string): ITextBuffer;

  /** 删除文本 */
  delete(from: number, to: number): ITextBuffer;

  /** 替换文本 */
  replace(from: number, to: number, text: string): ITextBuffer;
}

/** 文本缓冲区类型 */
export type TextBufferType = 'piece-table' | 'rope' | 'gap-buffer' | 'simple';

/** 文本缓冲区配置 */
export interface TextBufferConfig {
  /** 缓冲区类型 */
  type?: TextBufferType;
  /** 初始文本 */
  initialContent?: string;
  /** 是否启用行缓存 */
  enableLineCache?: boolean;
}

// ================================
// AST 节点类型
// ================================

/** 基础 AST 节点 */
export interface ASTNode {
  /** 节点类型 */
  readonly type: string;
  /** 节点 ID（唯一标识） */
  readonly id: string;
  /** 起始位置（字符偏移量） */
  readonly from: number;
  /** 结束位置（字符偏移量） */
  readonly to: number;
  /** 父节点 ID */
  readonly parent?: string;
  /** 子节点 ID 列表 */
  readonly children?: readonly string[];
  /** 节点哈希值（用于缓存比较） */
  readonly hash?: string;
}

/** 带内容的 AST 节点 */
export interface ASTNodeWithContent extends ASTNode {
  /** 节点原始文本内容 */
  readonly content: string;
}

/** AST 根节点 */
export interface ASTRoot<T extends ASTNode = ASTNode> {
  /** 根节点 */
  readonly root: T;
  /** 所有节点的映射表 */
  readonly nodes: ReadonlyMap<string, T>;
  /** AST 版本号 */
  readonly version: number;
  /** 文档长度 */
  readonly length: number;
}

// ================================
// 增量解析类型
// ================================

/** 解析结果 */
export interface ParseResult<T extends ASTNode = ASTNode> {
  /** AST 根节点 */
  readonly ast: ASTRoot<T>;
  /** 解析是否成功 */
  readonly success: boolean;
  /** 解析错误列表 */
  readonly errors: readonly ParseError[];
  /** 解析警告列表 */
  readonly warnings: readonly ParseWarning[];
  /** 解析耗时（毫秒） */
  readonly parseTime: number;
}

/** 增量解析结果 */
export interface IncrementalParseResult<T extends ASTNode = ASTNode> extends ParseResult<T> {
  /** 受影响的节点 ID 列表 */
  readonly affectedNodeIds: readonly string[];
  /** 需要重新渲染的节点 ID 列表 */
  readonly dirtyNodeIds: readonly string[];
  /** 是否执行了完整重新解析 */
  readonly fullReparse: boolean;
  /** 重用的节点数量 */
  readonly reusedNodeCount: number;
  /** 新创建的节点数量 */
  readonly newNodeCount: number;
}

/** 解析错误 */
export interface ParseError {
  /** 错误消息 */
  readonly message: string;
  /** 错误位置 */
  readonly position: Position;
  /** 错误范围 */
  readonly range?: Range;
  /** 错误代码 */
  readonly code?: string;
}

/** 解析警告 */
export interface ParseWarning {
  /** 警告消息 */
  readonly message: string;
  /** 警告位置 */
  readonly position: Position;
  /** 警告范围 */
  readonly range?: Range;
  /** 警告代码 */
  readonly code?: string;
}

/** 解析器配置 */
export interface ParserConfig {
  /** 是否严格模式 */
  strict?: boolean;
  /** 最大解析深度 */
  maxDepth?: number;
  /** 解析超时时间（毫秒） */
  timeout?: number;
  /** 是否保留注释 */
  preserveComments?: boolean;
  /** 是否保留空白 */
  preserveWhitespace?: boolean;
}

/** 增量解析器接口 */
export interface IIncrementalParser<T extends ASTNode = ASTNode> {
  /** 解析完整文档 */
  parse(content: string, config?: ParserConfig): ParseResult<T>;

  /** 增量解析 */
  parseIncremental(
    content: string,
    changes: TextChangeSet,
    previousAST: ASTRoot<T>,
    config?: ParserConfig
  ): IncrementalParseResult<T>;

  /** 获取支持的语言 */
  readonly language: string;

  /** 清除缓存 */
  clearCache(): void;
}

// ================================
// AST 缓存类型
// ================================

/** 缓存条目 */
export interface CacheEntry<T> {
  /** 缓存值 */
  readonly value: T;
  /** 创建时间 */
  readonly createdAt: number;
  /** 最后访问时间 */
  readonly lastAccessedAt: number;
  /** 访问次数 */
  readonly accessCount: number;
  /** 条目大小（字节） */
  readonly size: number;
  /** 缓存键的哈希值 */
  readonly hash: string;
}

/** 缓存统计 */
export interface CacheStats {
  /** 缓存命中次数 */
  readonly hits: number;
  /** 缓存未命中次数 */
  readonly misses: number;
  /** 命中率 */
  readonly hitRate: number;
  /** 当前条目数 */
  readonly entryCount: number;
  /** 当前缓存大小（字节） */
  readonly totalSize: number;
  /** 最大缓存大小（字节） */
  readonly maxSize: number;
  /** 驱逐次数 */
  readonly evictionCount: number;
}

/** AST 缓存配置 */
export interface ASTCacheConfig {
  /** 最大缓存条目数 */
  maxEntries?: number;
  /** 最大缓存大小（字节） */
  maxSize?: number;
  /** 条目过期时间（毫秒） */
  ttl?: number;
  /** 缓存策略 */
  strategy?: 'lru' | 'lfu' | 'arc';
  /** 是否启用节点级缓存 */
  enableNodeCache?: boolean;
}

/** AST 缓存接口 */
export interface IASTCache<T extends ASTNode = ASTNode> {
  /** 获取缓存的 AST */
  get(key: string): ASTRoot<T> | undefined;

  /** 设置缓存的 AST */
  set(key: string, ast: ASTRoot<T>): void;

  /** 检查缓存是否存在 */
  has(key: string): boolean;

  /** 删除缓存 */
  delete(key: string): boolean;

  /** 清除所有缓存 */
  clear(): void;

  /** 获取缓存统计 */
  getStats(): CacheStats;

  /** 获取缓存的节点 */
  getNode(nodeId: string): T | undefined;

  /** 缓存单个节点 */
  cacheNode(node: T): void;

  /** 使指定节点失效 */
  invalidateNode(nodeId: string): void;

  /** 使指定范围的节点失效 */
  invalidateRange(from: number, to: number): void;
}

// ================================
// 渲染相关类型
// ================================

/** 渲染块 */
export interface RenderBlock {
  /** 块 ID */
  readonly id: string;
  /** 对应的 AST 节点 ID */
  readonly nodeId: string;
  /** 渲染后的 HTML */
  readonly html: string;
  /** 块的起始位置 */
  readonly from: number;
  /** 块的结束位置 */
  readonly to: number;
  /** 是否可见 */
  visible?: boolean;
  /** 渲染优先级 */
  priority?: number;
}

/** 渲染结果 */
export interface RenderResult {
  /** 完整的 HTML */
  readonly html: string;
  /** 渲染块列表 */
  readonly blocks: readonly RenderBlock[];
  /** 是否成功 */
  readonly success: boolean;
  /** 错误信息 */
  readonly error?: string;
  /** 渲染耗时（毫秒） */
  readonly renderTime: number;
}

/** 渲染配置 */
export interface RenderConfig {
  /** 是否显示错误 */
  showErrors?: boolean;
  /** CSS 类名前缀 */
  classPrefix?: string;
  /** 是否启用块级缓存 */
  enableBlockCache?: boolean;
  /** 可见区域（用于优先渲染） */
  visibleRange?: { from: number; to: number };
}

// ================================
// Worker 相关类型
// ================================

/** Worker 消息类型 */
export type WorkerMessageType =
  | 'parse'
  | 'parse_incremental'
  | 'render'
  | 'cancel'
  | 'clear_cache'
  | 'get_stats';

/** Worker 请求 */
export interface WorkerRequest {
  /** 请求 ID */
  readonly id: string;
  /** 消息类型 */
  readonly type: WorkerMessageType;
  /** 请求数据 */
  readonly data?: unknown;
}

/** Worker 响应 */
export interface WorkerResponse {
  /** 请求 ID */
  readonly id: string;
  /** 消息类型 */
  readonly type: WorkerMessageType;
  /** 是否成功 */
  readonly success: boolean;
  /** 响应数据 */
  readonly data?: unknown;
  /** 错误信息 */
  readonly error?: string;
  /** 处理耗时（毫秒） */
  readonly duration?: number;
}

// ================================
// 性能相关类型
// ================================

/** 性能指标 */
export interface PerformanceMetrics {
  /** 解析耗时（毫秒） */
  readonly parseTime: number;
  /** 渲染耗时（毫秒） */
  readonly renderTime: number;
  /** 缓存命中率 */
  readonly cacheHitRate: number;
  /** 重用节点比例 */
  readonly nodeReuseRate: number;
  /** 内存使用（字节） */
  readonly memoryUsage: number;
}

/** 增量解析策略 */
export type IncrementalStrategy =
  | 'always'      // 总是尝试增量解析
  | 'smart'       // 智能判断（根据变更大小和位置）
  | 'never';      // 从不使用增量解析

/** 增量解析策略配置 */
export interface IncrementalStrategyConfig {
  /** 策略类型 */
  strategy?: IncrementalStrategy;
  /** 完整重解析的变更阈值（相对于文档长度的百分比） */
  fullReparseThreshold?: number;
  /** 强制完整重解析的绝对变更大小（字符数） */
  forceFullReparseSize?: number;
  /** 是否在结构变更时强制完整重解析 */
  fullReparseOnStructuralChange?: boolean;
}

// ================================
// 辅助类型
// ================================

/** 深只读类型 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** 深可选类型 */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/** 节点 ID 生成器 */
export interface NodeIdGenerator {
  /** 生成下一个 ID */
  next(): string;
  /** 重置生成器 */
  reset(): void;
}

/** 哈希函数 */
export type HashFunction = (content: string) => string;
