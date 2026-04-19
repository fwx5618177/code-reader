// ================================
// 增量解析库 - 主入口
//
// 提供高性能增量解析功能：
// - 增量解析：基于 Lezer 的 O(log n) 增量解析
// - LaTeX Block Scanner：快速文档结构扫描
// - AST 缓存：LRU 缓存策略，节点级缓存
// - Worker 支持：后台解析，避免阻塞主线程
// - 手写 LaTeX 增量解析器：无需依赖 @lezer/latex
//
// 注意：文本存储（Piece Table / Rope / Gap Buffer）已移至 @code-reader/text-buffer
//
// 使用场景：
// - 代码编辑器：语法高亮、自动补全、错误检查
// - LaTeX 编辑器：实时渲染、增量编译
// - Markdown 编辑器：实时预览、大文件编辑
// ================================

// ================================
// 类型导出
// ================================

export type {
  // 文本变更类型
  TextChange,
  TextChangeSet,
  Position,
  Range,
  // 文本缓冲区类型（兼容，实际实现在 @code-reader/text-buffer）
  ITextBuffer,
  TextBufferType,
  TextBufferConfig,
  // AST 节点类型
  ASTNode,
  ASTNodeWithContent,
  ASTRoot,
  // 解析类型
  ParseResult,
  IncrementalParseResult,
  ParseError,
  ParseWarning,
  ParserConfig,
  IIncrementalParser,
  // 缓存类型
  CacheEntry,
  CacheStats,
  ASTCacheConfig,
  IASTCache,
  // 渲染类型
  RenderBlock,
  RenderResult,
  RenderConfig,
  // Worker 类型
  WorkerMessageType,
  WorkerRequest,
  WorkerResponse,
  // 性能类型
  PerformanceMetrics,
  IncrementalStrategy,
  IncrementalStrategyConfig,
  // 辅助类型
  DeepReadonly,
  DeepPartial,
  NodeIdGenerator,
  HashFunction,
} from './types';

// ================================
// Lezer 增量解析
// ================================

export {
  // 解析器
  LezerIncrementalParser,
  createLezerParser,
  // 缓存
  ASTCache,
  createASTCache,
  createHighPerformanceCache,
  createLightweightCache,
  // 便捷函数
  createCachedLezerParser,
  // 工具函数
  estimateSize,
  hashString,
} from './lezer';

export type { LezerParserConfig, NodeMapping, ParseState } from './lezer';

// ================================
// LaTeX 解析器（手写实现，无需 @lezer/latex）
// ================================

export {
  // 节点类型
  LatexNodeType,
  LatexNodeNames,
  type LatexNodeTypeValue,
  type LatexASTNode,
  type CommandASTNode,
  type EnvironmentASTNode,
  type MathASTNode,
  type SectionASTNode,
  type ItemASTNode,
  type TableCellASTNode,
  type LatexCommentASTNode,
  type LatexErrorASTNode,
  // 配置类型
  type LatexLezerConfig,
  DEFAULT_LATEX_LEZER_CONFIG,
  // 解析结果类型
  type LatexParseError,
  type LatexLezerParseResult,
  type LatexLezerIncrementalResult,
  // 常量
  SECTION_COMMANDS,
  LIST_ENVIRONMENTS,
  MATH_ENVIRONMENTS,
  TABLE_ENVIRONMENTS,
  FLOAT_ENVIRONMENTS,
  VERBATIM_ENVIRONMENTS,
  SPECIAL_CHARS,
  COMMAND_ARG_COUNTS,
  // Tokenizer
  LatexTokenType,
  type LatexTokenTypeValue,
  type LatexToken,
  type LatexTokenizerState,
  LatexTokenizer,
  createLatexTokenizer,
  tokenizeLatex,
  // Parser
  LatexLezerParser,
  createLatexLezerParser,
  parseLatexDocument,
  // 便捷函数
  getLatexLezerParser,
  destroyLatexLezerParser,
  parseLatex,
  parseLatexIncremental,
} from './lezer';

// ================================
// LaTeX Block Scanner（块级结构扫描器）
// ================================

export {
  // 块级扫描器
  LatexBlockScanner,
  createLatexBlockScanner,
  // 后向兼容别名
  LatexBlockScanner as TSTreeSitterParser,
  createLatexBlockScanner as createTSTreeSitterParser,
  // 语言配置
  SUPPORTED_LANGUAGES,
  getLanguageByExtension,
  getLanguageByName,
  isLanguageSupported,
} from './block-scanner';

export type {
  // Block scanner 类型
  TSNode,
  TSTree,
  LatexBlockScannerConfig,
  LatexBlockScannerConfig as TSTreeSitterConfig,
  // 位置和范围
  TreeSitterPoint,
  TreeSitterRange,
  LanguageConfig,
} from './block-scanner';

// ================================
// 语言注册系统
// ================================

export {
  // 注册中心
  LanguageRegistry,
  getLanguageRegistry,
  registerLanguage,
  createParserForFile,
  // 高亮引擎
  HighlightEngine,
  createHighlightEngine,
  // Lezer 适配器（快速接入新语言）
  createLezerLanguageContribution,
  // 内置语言
  LATEX_CONTRIBUTION,
  LATEX_HIGHLIGHT_RULES,
  LATEX_LANGUAGE_CONFIGURATION,
  // 适配器
  BlockScannerAdapter,
  BlockScannerAdapter as TreeSitterParserAdapter,
  // 初始化
  initBuiltinLanguages,
} from './language-registry';

export type {
  // 语言标识
  LanguageId,
  // Token 类型
  TokenKind,
  TokenModifier,
  HighlightToken,
  HighlightResult,
  // 高亮规则
  HighlightRule,
  HighlightCondition,
  // 解析器接口
  ILanguageParser,
  LanguageParserFactory,
  // 语言贡献
  LanguageContribution,
  // 语言配置
  LanguageConfiguration,
  AutoClosingPair,
  IndentationRules,
  FoldingMarkers,
  // Lezer 适配器选项
  LezerLanguageContributionOptions,
  // 事件
  LanguageRegistryEvent,
  LanguageRegistryListener,
} from './language-registry';

// ================================
// 文本缓冲区已移至 @code-reader/text-buffer
// 请直接使用：import { PieceTable, Rope, GapBuffer } from '@code-reader/text-buffer'
// ================================

// ================================
// 重新导入用于默认导出
// ================================

import {
  LezerIncrementalParser,
  ASTCache,
  createLezerParser,
  createASTCache,
  createCachedLezerParser,
  LatexLezerParser,
  getLatexLezerParser,
} from './lezer';

import { LatexBlockScanner, createLatexBlockScanner, SUPPORTED_LANGUAGES } from './block-scanner';

// 文本缓冲区已移至 @code-reader/text-buffer，不再从此处导出

// ================================
// 解析器选择指南
// ================================

/**
 * 解析器选择指南：
 *
 * 使用 Lezer（推荐，真正增量解析）：
 * - 需要外部 LRParser 语法，适合有 Lezer 生态的语言
 * - O(log n) 增量解析，性能最优
 * - 与 CodeMirror 6 深度集成
 *
 * 使用手写 LaTeX 解析器 (LatexLezerParser)：
 * - 无需任何外部依赖
 * - 完整的 LaTeX 语法支持（token 级解析）
 * - 适合语法高亮和深度代码分析
 *
 * 使用 LaTeX Block Scanner (LatexBlockScanner)：
 * - 块级粒度，适合文档大纲/结构导航
 * - 速度快，适合实时预览
 * - 不适合精细语法高亮
 */

// ================================
// 默认导出
// ================================

export default {
  // Lezer 解析器
  LezerIncrementalParser,
  ASTCache,
  createLezerParser,
  createASTCache,
  createCachedLezerParser,

  // LaTeX 解析器（手写实现）
  LatexLezerParser,
  getLatexLezerParser,

  // LaTeX Block Scanner
  LatexBlockScanner,
  createLatexBlockScanner,
  SUPPORTED_LANGUAGES,
};
