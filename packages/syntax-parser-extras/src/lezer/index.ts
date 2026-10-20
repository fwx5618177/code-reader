// ================================
// Lezer 增量解析模块 - 统一导出
//
// 提供基于 Lezer 的高性能增量解析功能：
// - 真正的增量解析（O(log n) 复杂度）
// - TreeFragment 缓存和重用
// - AST 转换和缓存
// - 与 CodeMirror 6 深度集成
// 手写 LaTeX 解析器在 @code-reader/syntax-parser
// ================================

// ================================
// 类型导出
// ================================

// 将 @lezer/lr 的 LRParser 类型从此处统一导出
// 其他模块应从此处导入，而不是直接引用 @lezer/lr
export type { LRParser } from '@lezer/lr';

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

export { LezerIncrementalParser, createLezerParser, type LezerParserConfig } from './lezer-parser';

export type { NodeMapping, ParseState } from './lezer-parser';

import { LezerIncrementalParser } from './lezer-parser';
import { ASTCache } from './ast-cache';

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
// 便捷工厂函数
// ================================

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
