// ================================
// 增量解析库 - 主入口
//
// 提供高性能增量解析功能：
// - 增量解析：基于 Lezer 的 O(log n) 增量解析
// - Tree-sitter 适配器：可选的高性能解析器
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
  resetNodeIdCounter,
  // 缓存
  ASTCache,
  createASTCache,
  createHighPerformanceCache,
  createLightweightCache,
  // 便捷函数
  createCachedLezerParser,
  createLatexLezerParserFromLR,
  createMarkdownLezerParser,
  createJavaScriptLezerParser,
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
// Tree-sitter 适配器
// ================================

export {
  // 适配器类
  TreeSitterAdapter,
  createTreeSitterAdapter,
  resetTreeSitterNodeIdCounter,
  // 纯 TypeScript 实现的 Tree-sitter 解析器（不依赖 WASM）
  TSTreeSitterParser,
  createTSTreeSitterParser,
  resetTSNodeIdCounter,
  // 语言配置
  TREE_SITTER_LANGUAGES,
  getLanguageByExtension,
  getLanguageByName,
} from './tree-sitter';

export type {
  // 纯 TS Tree-sitter 类型
  TSNode,
  TSTree,
  TSTreeSitterConfig,
  // 语言配置
  TreeSitterLanguageConfig,
  // 位置和范围
  TreeSitterPoint,
  TreeSitterRange,
  TreeSitterInputEdit,
  // 节点类型
  TreeSitterNode,
  TreeSitterTreeCursor,
  TreeSitterTree,
  TreeSitterLanguage,
  TreeSitterParser,
  TreeSitterInput,
  TreeSitterParseOptions,
  // 查询类型
  TreeSitterQuery,
  TreeSitterQueryOptions,
  TreeSitterQueryMatch,
  TreeSitterQueryCapture,
  // 适配器配置
  TreeSitterAdapterConfig,
  TreeSitterParseState,
  TreeSitterNodeMapping,
  // 接口
  ITreeSitterParser,
  // 工具类型
  TreeSitterNodeTransformer,
  TreeSitterInitState,
  TreeSitterErrorType,
} from './tree-sitter';

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

import {
  TreeSitterAdapter,
  createTreeSitterAdapter,
  TREE_SITTER_LANGUAGES,
  TSTreeSitterParser,
  createTSTreeSitterParser,
} from './tree-sitter';

// 文本缓冲区已移至 @code-reader/text-buffer，不再从此处导出

// ================================
// 解析器选择指南
// ================================

/**
 * Lezer vs Tree-sitter 选择指南：
 *
 * 使用 Lezer（推荐，当前默认）：
 * - 纯 Web 应用
 * - 与 CodeMirror 6 集成
 * - 包体积敏感
 * - 中等规模文档（< 1MB）
 *
 * 使用 Tree-sitter：
 * - Electron/Native 应用
 * - 需要解析超大文件（> 1MB）
 * - 需要与 GitHub/Neovim 保持语法一致
 * - 对解析性能有极高要求
 *
 * 使用手写 LaTeX 解析器：
 * - 无需安装 @lezer/latex 依赖
 * - 完整的 LaTeX 语法支持
 * - 支持增量解析
 * - 错误恢复机制
 *
 * 性能对比（参考值）：
 * | 场景 | Lezer | Tree-sitter | 手写 LaTeX |
 * |-----|-------|-------------|-----------|
 * | 100KB 增量解析 | < 5ms | < 2ms | < 10ms |
 * | 1MB 完整解析 | < 100ms | < 30ms | < 150ms |
 * | 包体积 | ~50KB | ~300KB（含 WASM）| ~20KB |
 * | 初始化时间 | 即时 | 需加载 WASM | 即时 |
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

  // Tree-sitter 适配器（需要 WASM）
  TreeSitterAdapter,
  createTreeSitterAdapter,
  TREE_SITTER_LANGUAGES,

  // 纯 TypeScript Tree-sitter 解析器（不需要 WASM，推荐大文件使用）
  TSTreeSitterParser,
  createTSTreeSitterParser,
};
