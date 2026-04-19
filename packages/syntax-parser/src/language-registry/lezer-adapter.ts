// ================================
// Lezer 解析器适配器
//
// 将 LezerIncrementalParser 包装为 ILanguageParser 接口
// 实现语言注册系统与内部 Lezer 解析器的桥接
// ================================

import type { LRParser } from '../lezer';
import type {
  LanguageContribution,
  ILanguageParser,
  LanguageId,
  HighlightRule,
  LanguageConfiguration,
} from './types';
import type {
  ASTNode,
  ASTRoot,
  ParserConfig,
  ParseResult,
  IncrementalParseResult,
  TextChangeSet,
} from '../types';
import { LezerIncrementalParser } from '../lezer/lezer-parser';

// ================================
// Lezer 语言适配器
// ================================

/**
 * 将 LezerIncrementalParser 包装为 ILanguageParser
 */
class LezerLanguageAdapter implements ILanguageParser<ASTNode> {
  readonly languageId: string;
  private readonly parser: LezerIncrementalParser;

  constructor(languageId: string, lezerParser: LRParser, config?: ParserConfig) {
    this.languageId = languageId;
    this.parser = new LezerIncrementalParser({
      parser: lezerParser,
      language: languageId,
      enableFragmentCache: true,
      maxCachedFragments: 200,
      parseTimeout: 5000,
      ...config,
    });
  }

  parse(content: string, config?: ParserConfig): ParseResult<ASTNode> {
    return this.parser.parse(content, config);
  }

  parseIncremental(
    content: string,
    changes: TextChangeSet,
    previousAST: ASTRoot<ASTNode>,
    config?: ParserConfig
  ): IncrementalParseResult<ASTNode> {
    return this.parser.parseIncremental(content, changes, previousAST, config);
  }

  clearCache(): void {
    this.parser.clearCache();
  }

  dispose(): void {
    this.parser.clearCache();
  }
}

// ================================
// 工厂函数
// ================================

/**
 * Lezer 语言贡献的便捷创建参数
 */
export interface LezerLanguageContributionOptions {
  /** 语言元信息 */
  language: LanguageId;
  /** Lezer LRParser 实例 */
  lezerParser: LRParser;
  /** 高亮规则 */
  highlightRules?: HighlightRule[];
  /** 语言配置 */
  configuration?: LanguageConfiguration;
  /** 内嵌语言 */
  embeddedLanguages?: string[];
}

/**
 * 从 Lezer LRParser 创建语言贡献
 *
 * 这是通过 Lezer 解析器接入新语言的最简方式：
 *
 * ```typescript
 * import { createLezerLanguageContribution, registerLanguage } from '@code-reader/syntax-parser';
 * import { parser as jsParser } from 'some-lezer-grammar';
 *
 * const jsContribution = createLezerLanguageContribution({
 *   language: {
 *     id: 'javascript',
 *     name: 'JavaScript',
 *     extensions: ['.js', '.jsx', '.mjs'],
 *     aliases: ['js'],
 *   },
 *   lezerParser: jsParser,
 *   highlightRules: jsHighlightRules,
 *   configuration: {
 *     lineComment: '//',
 *     blockComment: ['/ *', '* /'],
 *     brackets: [
 *       ['{', '}'],
 *       ['[', ']'],
 *       ['(', ')'],
 *     ],
 *   },
 * });
 *
 * registerLanguage(jsContribution);
 * ```
 */
export function createLezerLanguageContribution(
  options: LezerLanguageContributionOptions
): LanguageContribution {
  return {
    language: options.language,
    parserFactory: (config?: ParserConfig) =>
      new LezerLanguageAdapter(options.language.id, options.lezerParser, config),
    highlightRules: options.highlightRules,
    configuration: options.configuration,
    embeddedLanguages: options.embeddedLanguages,
  };
}
