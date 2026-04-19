// ================================
// 语言注册系统 - 统一导出
// ================================

// ================================
// 核心类型
// ================================

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
  // 事件
  LanguageRegistryEvent,
  LanguageRegistryListener,
} from './types';

// ================================
// 注册中心
// ================================

export {
  LanguageRegistry,
  getLanguageRegistry,
  registerLanguage,
  createParserForFile,
} from './registry';

// ================================
// 高亮引擎
// ================================

export { HighlightEngine, createHighlightEngine } from './highlight-engine';

// ================================
// 适配器
// ================================

export {
  BlockScannerAdapter,
  BlockScannerAdapter as TreeSitterParserAdapter,
} from './block-scanner-adapter';

export {
  createLezerLanguageContribution,
  type LezerLanguageContributionOptions,
} from './lezer-adapter';

// ================================
// LaTeX 语言定义
// ================================

export { LATEX_CONTRIBUTION, LATEX_HIGHLIGHT_RULES, LATEX_LANGUAGE_CONFIGURATION } from './latex';

// ================================
// 便捷函数：初始化内置语言
// ================================

import { LanguageRegistry } from './registry';
import { LATEX_CONTRIBUTION } from './latex';

/**
 * 初始化内置语言注册
 *
 * 调用此函数会将内置语言（如 LaTeX）注册到全局 LanguageRegistry
 *
 * ```typescript
 * import { initBuiltinLanguages, getLanguageRegistry } from '@code-reader/syntax-parser';
 *
 * initBuiltinLanguages();
 *
 * const registry = getLanguageRegistry();
 * const parser = registry.createParser('latex');
 * ```
 */
export function initBuiltinLanguages(): void {
  const registry = LanguageRegistry.getInstance();

  // LaTeX
  if (!registry.hasLanguage('latex')) {
    registry.register(LATEX_CONTRIBUTION);
  }
}
