// ================================
// Block Scanner 适配器
//
// 职责：将 LatexBlockScanner 包装为 ILanguageParser 接口
// 适配层，将块级扫描器转换为语言注册中心可用的解析器
// ================================

import type { ILanguageParser } from './types';
import type {
  ASTNode,
  ASTRoot,
  ParserConfig,
  ParseResult,
  IncrementalParseResult,
  TextChangeSet,
} from '../types';
import { createLatexBlockScanner } from '../block-scanner/latex-block-scanner';
import type { LatexBlockScanner } from '../block-scanner/latex-block-scanner';

/**
 * 将 LatexBlockScanner 包装为 ILanguageParser 接口
 *
 * 适配器模式，将块级扫描器适配到语言注册中心的统一接口。
 * 内部使用纯 TypeScript 实现的正则块级扫描器，无需外部依赖。
 *
 * ```typescript
 * // 创建 LaTeX 块级扫描适配器
 * const adapter = new BlockScannerAdapter('latex');
 *
 * // 带自定义配置
 * const adapter = new BlockScannerAdapter('latex', { timeout: 5000 });
 * ```
 */
export class BlockScannerAdapter implements ILanguageParser<ASTNode> {
  readonly languageId: string;
  private readonly parser: LatexBlockScanner;

  constructor(language: string, config?: ParserConfig) {
    this.languageId = language;
    this.parser = createLatexBlockScanner({
      language,
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

// 后向兼容别名
export { BlockScannerAdapter as TreeSitterParserAdapter };
