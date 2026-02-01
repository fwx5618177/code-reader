// ================================
// Lezer LaTeX 模块 - 导出入口
//
// 手写的 LaTeX 增量解析器
// 提供完整的词法分析和语法分析功能
//
// 特性：
// - 纯 TypeScript 实现，无需依赖 @lezer/latex
// - 支持增量解析
// - 完整的 LaTeX 语法支持
// - 错误恢复机制
// ================================

// ================================
// 类型导出
// ================================

export {
  // 节点类型
  NodeType,
  NodeNames,
  type NodeTypeValue,
  type LatexASTNode,
  type CommandASTNode,
  type EnvironmentASTNode,
  type MathASTNode,
  type SectionASTNode,
  type ItemASTNode,
  type TableCellASTNode,
  type CommentASTNode,
  type ErrorASTNode,
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
} from './types';

// ================================
// Tokenizer 导出
// ================================

export {
  // 类型
  TokenType,
  type TokenTypeValue,
  type Token,
  type TokenizerState,
  // 类
  LatexTokenizer,
  // 工厂函数
  createLatexTokenizer,
  tokenizeLatex,
} from './tokenizer';

// ================================
// Parser 导出
// ================================

export {
  // 类
  LatexLezerParser,
  // 工厂函数
  createLatexLezerParser,
  parseLatexDocument,
} from './parser';

// ================================
// 便捷函数
// ================================

import { LatexLezerParser } from './parser';
import type { LatexLezerConfig, LatexASTNode, LatexLezerParseResult } from './types';

/**
 * 全局解析器实例（用于增量解析）
 */
let globalLatexParser: LatexLezerParser | null = null;

/**
 * 获取全局 LaTeX 解析器实例
 */
export function getLatexLezerParser(config?: Partial<LatexLezerConfig>): LatexLezerParser {
  if (!globalLatexParser) {
    globalLatexParser = new LatexLezerParser(config);
  }
  return globalLatexParser;
}

/**
 * 销毁全局 LaTeX 解析器实例
 */
export function destroyLatexLezerParser(): void {
  if (globalLatexParser) {
    globalLatexParser.clearCache();
    globalLatexParser = null;
  }
}

/**
 * 解析 LaTeX 并返回 AST
 */
export function parseLatex(input: string, config?: Partial<LatexLezerConfig>): LatexASTNode {
  const parser = getLatexLezerParser(config);
  const result = parser.parse(input);
  return result.root;
}

/**
 * 增量解析 LaTeX
 */
export function parseLatexIncremental(
  input: string,
  changeFrom: number,
  changeTo: number,
  insertLength: number,
  config?: Partial<LatexLezerConfig>
): LatexLezerParseResult {
  const parser = getLatexLezerParser(config);
  return parser.parseIncremental(input, changeFrom, changeTo, insertLength);
}

// ================================
// 默认导出
// ================================

import { LatexTokenizer } from './tokenizer';

export default {
  // 解析器
  LatexLezerParser,
  getLatexLezerParser,
  destroyLatexLezerParser,
  parseLatex,
  parseLatexIncremental,
  // Tokenizer
  LatexTokenizer,
};
