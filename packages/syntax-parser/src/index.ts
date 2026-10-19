// ================================
// @code-reader/syntax-parser
// 零依赖的手写 LaTeX 解析器（tokenizer + 递归下降，带错误恢复与诊断），
// 以及 LaTeX 的语言配置（注释、括号、自动配对）。
// 语言注册表、高亮引擎、Lezer 增量解析封装、AST 缓存、块扫描器在 @code-reader/syntax-parser-extras
// ================================

export {
  // 节点类型
  NodeType as LatexNodeType,
  NodeNames as LatexNodeNames,
  type NodeTypeValue as LatexNodeTypeValue,
  type LatexASTNode,
  type CommandASTNode,
  type EnvironmentASTNode,
  type MathASTNode,
  type SectionASTNode,
  type ItemASTNode,
  type TableCellASTNode,
  type CommentASTNode as LatexCommentASTNode,
  type ErrorASTNode as LatexErrorASTNode,
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
  TokenType as LatexTokenType,
  type TokenTypeValue as LatexTokenTypeValue,
  type Token as LatexToken,
  type TokenizerState as LatexTokenizerState,
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
} from './latex';

export {
  LATEX_LANGUAGE_CONFIGURATION,
  type LanguageConfiguration,
  type AutoClosingPair,
  type IndentationRules,
  type FoldingMarkers,
} from './language/latex-configuration';
