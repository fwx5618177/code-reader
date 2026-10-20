// ================================
// CommonMark 规范解析器的对外入口（节点类型与选项见 types.ts）
// 块级解析见 block-parser.ts，行内解析见 inline-parser.ts，HTML 输出见 html-renderer.ts
// 零依赖；CommonMark 0.31.2 规范一致性由 __tests__/commonmark-spec.test.ts 统计
// ================================

import { BlockParser } from './block-parser';
import { numberInlineFootnotes } from './footnotes';
import { InlineParser } from './inline-parser';
import { resolveOptions, type CommonMarkOptions, type InlineNode, type ParseResult, type ResolvedOptions } from './types';

export * from './types';

// ================================
// CommonMark 解析器
// ================================

/**
 * CommonMark 规范解析器
 * 高性能、完全自主实现
 */
export class CommonMarkParser {
  private options: ResolvedOptions;

  constructor(options?: CommonMarkOptions) {
    this.options = resolveOptions(options);
  }

  /**
   * 解析 Markdown 文本
   */
  parse(input: string): ParseResult {
    const startTime = performance.now();

    const { document, warnings, references, abbreviations } = new BlockParser(this.options).parse(input);
    return { document, duration: performance.now() - startTime, warnings, references, abbreviations };
  }

  /**
   * 仅解析内联元素
   */
  parseInline(input: string, startLine: number = 1): InlineNode[] {
    const nodes = new InlineParser(this.options).parse(input, startLine);
    numberInlineFootnotes(nodes);
    return nodes;
  }

  /**
   * 获取配置
   */
  getOptions(): Readonly<CommonMarkOptions> {
    return this.options;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 CommonMark 解析器
 */
export function createCommonMarkParser(options?: CommonMarkOptions): CommonMarkParser {
  return new CommonMarkParser(options);
}

/**
 * 快速解析 Markdown
 */
export function parseCommonMark(input: string, options?: CommonMarkOptions): ParseResult {
  return new CommonMarkParser(options).parse(input);
}

/**
 * 快速解析内联内容
 */
export function parseInline(input: string, options?: CommonMarkOptions): InlineNode[] {
  return new CommonMarkParser(options).parseInline(input);
}
