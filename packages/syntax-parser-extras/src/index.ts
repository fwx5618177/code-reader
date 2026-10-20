// ================================
// @code-reader/syntax-parser-extras
// 语言注册表与高亮引擎、Lezer 增量解析封装与 AST 缓存、正则 LaTeX 块扫描器。
// 桌面端编辑器高亮由 CodeMirror 承担、LaTeX 分块由桌面端 block-segmenter 承担，这些能力与
// @code-reader/syntax-parser（手写 LaTeX 解析器、语言配置）分开，按需引入
// ================================

// ================================
// 共享类型
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
// Lezer 增量解析与 AST 缓存
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
// LaTeX 块扫描器
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
