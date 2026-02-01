// ================================
// Lezer 增量解析模块 - 统一导出
//
// 提供基于 Lezer 的高性能增量解析功能：
// - 真正的增量解析（O(log n) 复杂度）
// - TreeFragment 缓存和重用
// - AST 转换和缓存
// - 与 CodeMirror 6 深度集成
// - 手写 LaTeX 增量解析器
// ================================

// ================================
// 类型导出
// ================================

export type {
  ASTNode,
  ASTRoot,
  ParseResult,
  IncrementalParseResult,
  ParseError,
  ParseWarning,
  ParserConfig,
  TextChangeSet,
  IASTCache,
  CacheEntry,
  CacheStats,
  ASTCacheConfig,
} from '../types';

import type { ASTNode, ASTCacheConfig as ASTCacheConfigType } from '../types';
import type { LezerParserConfig as LezerParserConfigType } from './lezer-parser';

// ================================
// Lezer 解析器
// ================================

export {
  LezerIncrementalParser,
  createLezerParser,
  resetNodeIdCounter,
  type LezerParserConfig,
} from './lezer-parser';

export type { NodeMapping, ParseState } from './lezer-parser';

// ================================
// AST 缓存
// ================================

export {
  ASTCache,
  createASTCache,
  createHighPerformanceCache,
  createLightweightCache,
  estimateSize,
  hashString,
} from './ast-cache';

// ================================
// LaTeX 解析器（手写实现）
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

// ================================
// 便捷工厂函数
// ================================

import type { LRParser } from '@lezer/lr';
import { LezerIncrementalParser, createLezerParser } from './lezer-parser';
import { ASTCache, createASTCache } from './ast-cache';

/**
 * 创建带缓存的 Lezer 增量解析器
 *
 * @param parserConfig Lezer 解析器配置
 * @param cacheConfig AST 缓存配置
 */
export function createCachedLezerParser<T extends ASTNode = ASTNode>(
  parserConfig: LezerParserConfigType,
  cacheConfig?: ASTCacheConfigType
): {
  parser: LezerIncrementalParser;
  cache: ASTCache<T>;
} {
  const parser = new LezerIncrementalParser(parserConfig);
  const cache = new ASTCache<T>(cacheConfig);

  return { parser, cache };
}

/**
 * 创建 LaTeX 增量解析器（需要 @lezer/latex）
 *
 * 注意：需要安装 @lezer/latex 包
 * pnpm add @lezer/latex
 *
 * @param latexParser @lezer/latex 的 parser 实例
 */
export function createLatexLezerParserFromLR(latexParser: LRParser): LezerIncrementalParser {
  return new LezerIncrementalParser({
    parser: latexParser,
    language: 'latex',
    enableFragmentCache: true,
    maxCachedFragments: 200,
    parseTimeout: 5000,
  });
}

/**
 * 创建 Markdown 增量解析器（需要 @lezer/markdown）
 *
 * 注意：需要安装 @lezer/markdown 包
 * pnpm add @lezer/markdown
 *
 * @param markdownParser @lezer/markdown 的 parser 实例
 */
export function createMarkdownLezerParser(markdownParser: LRParser): LezerIncrementalParser {
  return new LezerIncrementalParser({
    parser: markdownParser,
    language: 'markdown',
    enableFragmentCache: true,
    maxCachedFragments: 200,
    parseTimeout: 5000,
  });
}

/**
 * 创建 JavaScript 增量解析器（需要 @lezer/javascript）
 *
 * 注意：需要安装 @lezer/javascript 包
 * pnpm add @lezer/javascript
 *
 * @param jsParser @lezer/javascript 的 parser 实例
 */
export function createJavaScriptLezerParser(jsParser: LRParser): LezerIncrementalParser {
  return new LezerIncrementalParser({
    parser: jsParser,
    language: 'javascript',
    enableFragmentCache: true,
    maxCachedFragments: 300,
    parseTimeout: 10000,
  });
}

// ================================
// 重新导入用于默认导出
// ================================

import { LatexLezerParser, getLatexLezerParser } from './latex';

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
};
