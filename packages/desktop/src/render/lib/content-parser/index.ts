// ================================
// 内容解析器模块入口
// 提供高性能的 Markdown 内容解析功能
// ================================

// ================================
// 增量解析器导出
// ================================

export {
  IncrementalParser,
  createIncrementalParser,
  parseMarkdown,
  parseMarkdownStream,
} from './incremental-parser';

export type {
  Token,
  ParseResult as IncrementalParseResult,
  ParseError,
  ParserConfig,
} from './incremental-parser';

export { ParserState, TokenType } from './incremental-parser';

// ================================
// 增量编辑解析器导出
// ================================

export {
  IncrementalEditParser,
  createIncrementalEditParser,
  parseWithEdit,
  createEditOperation,
} from './incremental-edit-parser';

export type {
  EditOperation,
  AffectedRange,
  IncrementalParseResult as IncrementalEditParseResult,
  IncrementalEditParserConfig,
} from './incremental-edit-parser';

export { EditOperationType } from './incremental-edit-parser';

// ================================
// CommonMark 规范解析器导出
// ================================

export {
  CommonMarkParser,
  createCommonMarkParser,
  parseCommonMark,
  parseInline,
} from './commonmark-parser';

export type {
  // 结果类型
  ParseResult,
  ParseWarning,

  // 节点类型
  InlineNode,
  BlockNode,
  Position,

  // 表格类型
  TableAlignment,
  TableCellNode,
  TableRowNode,
  TableNode,

  // 配置类型
  CommonMarkOptions,
} from './commonmark-parser';

export { InlineType, BlockType } from './commonmark-parser';

// ================================
// 便捷工具函数
// ================================

import { parseMarkdown, type ParserConfig as IncrementalConfig } from './incremental-parser';
import { parseCommonMark, type CommonMarkOptions } from './commonmark-parser';

/**
 * 解析模式
 */
export const enum ParseMode {
  /** 增量解析（适合大文件流式处理） */
  Incremental = 'incremental',
  /** CommonMark 规范解析（完整 AST） */
  CommonMark = 'commonmark',
}

/**
 * 统一解析配置
 */
export interface UnifiedParseConfig {
  /** 解析模式 */
  mode?: ParseMode;
  /** 增量解析配置 */
  incremental?: IncrementalConfig;
  /** CommonMark 解析配置 */
  commonmark?: CommonMarkOptions;
}

/**
 * 统一解析结果
 */
export interface UnifiedParseResult {
  /** 解析模式 */
  mode: ParseMode;
  /** 解析耗时（毫秒） */
  duration: number;
  /** 增量解析结果（当 mode 为 Incremental 时） */
  incremental?: import('./incremental-parser').ParseResult;
  /** CommonMark 解析结果（当 mode 为 CommonMark 时） */
  commonmark?: import('./commonmark-parser').ParseResult;
}

/**
 * 统一解析函数
 * 根据配置选择合适的解析器
 *
 * @param input Markdown 文本
 * @param config 解析配置
 * @returns 解析结果
 */
export function parse(input: string, config?: UnifiedParseConfig): UnifiedParseResult {
  const mode = config?.mode ?? ParseMode.Incremental;

  if (mode === ParseMode.CommonMark) {
    const result = parseCommonMark(input, config?.commonmark);
    return {
      mode: ParseMode.CommonMark,
      duration: result.duration,
      commonmark: result,
    };
  } else {
    const result = parseMarkdown(input, config?.incremental);
    return {
      mode: ParseMode.Incremental,
      duration: result.duration,
      incremental: result,
    };
  }
}

/**
 * 自动选择解析器
 * 根据输入大小和复杂度自动选择最佳解析器
 *
 * @param input Markdown 文本
 * @param threshold 切换阈值（字符数），超过此值使用增量解析
 * @returns 解析结果
 */
export function autoParse(input: string, threshold: number = 100000): UnifiedParseResult {
  // 大文件使用增量解析
  if (input.length > threshold) {
    return parse(input, { mode: ParseMode.Incremental });
  }

  // 小文件使用 CommonMark 解析以获得完整 AST
  return parse(input, { mode: ParseMode.CommonMark });
}

/**
 * 检查输入是否包含复杂 Markdown 语法
 * 用于辅助选择解析器
 */
export function hasComplexSyntax(input: string): boolean {
  // 检查是否包含需要完整解析的复杂语法
  const complexPatterns = [
    /\[.+\]\(.+\)/, // 链接
    /!\[.+\]\(.+\)/, // 图片
    /\*\*[^*]+\*\*/, // 粗体
    /\*[^*]+\*/, // 斜体
    /~~[^~]+~~/, // 删除线
    /<[a-zA-Z][^>]*>/, // HTML 标签
    /\|.+\|/, // 表格
  ];

  for (const pattern of complexPatterns) {
    if (pattern.test(input)) {
      return true;
    }
  }

  return false;
}

/**
 * 估算解析复杂度
 * 返回 0-100 的分数，越高越复杂
 */
export function estimateComplexity(input: string): number {
  let score = 0;
  const length = input.length;

  // 基于长度的基础分数
  score += Math.min(length / 10000, 30);

  // 检查特殊语法
  const patterns: [RegExp, number][] = [
    [/```[\s\S]*?```/g, 5], // 代码块
    [/\[.+?\]\(.+?\)/g, 3], // 链接
    [/!\[.+?\]\(.+?\)/g, 3], // 图片
    [/\*\*[^*]+?\*\*/g, 2], // 粗体
    [/\*[^*]+?\*/g, 1], // 斜体
    [/#{1,6} /g, 1], // 标题
    [/^\s*[-*+] /gm, 1], // 无序列表
    [/^\s*\d+\. /gm, 1], // 有序列表
    [/^\s*>/gm, 2], // 引用
    [/<[a-zA-Z][^>]*>/g, 4], // HTML 标签
    [/^\|.+\|$/gm, 3], // 表格行
  ];

  for (const [pattern, weight] of patterns) {
    const matches = input.match(pattern);
    if (matches) {
      score += Math.min(matches.length * weight, 20);
    }
  }

  return Math.min(score, 100);
}
