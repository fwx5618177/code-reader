// ================================
// @code-reader/parser
// 高性能内容解析器
// 提供 Markdown、LaTeX 等格式的解析功能
// ================================

// ================================
// Markdown 模块导出
// ================================

export {
  // 解析器
  CommonMarkParser,
  createCommonMarkParser,
  parseCommonMark,
  parseInline,

  // 枚举
  InlineType,
  BlockType,
} from './markdown';

export type {
  // 解析结果
  ParseResult as MarkdownParseResult,
  ParseWarning as MarkdownParseWarning,

  // 位置
  Position as MarkdownPosition,

  // 节点类型
  InlineNode as MarkdownInlineNode,
  BlockNode as MarkdownBlockNode,

  // 表格类型
  TableAlignment,
  TableCellNode as MarkdownTableCellNode,
  TableRowNode as MarkdownTableRowNode,
  TableNode as MarkdownTableNode,

  // 配置类型
  CommonMarkOptions,
} from './markdown';

// ================================
// LaTeX 模块导出
// ================================

export {
  // 解析器
  LaTeXParser,
  createLaTeXParser,
  parseLaTeX,
  parseLaTeXInline,

  // 枚举
  LaTeXBlockType,
  LaTeXInlineType,

  // 默认配置
  DEFAULT_LATEX_OPTIONS,
} from './latex';

export type {
  // 解析配置
  LaTeXParserOptions,
  LaTeXParseResult,
  ParseWarning as LaTeXParseWarning,

  // 位置
  Position as LaTeXPosition,

  // 节点
  LaTeXNodeBase,
  LaTeXNode,
  LaTeXInlineNode,
  LaTeXBlockNode,

  // 行内节点类型
  TextNode as LaTeXTextNode,
  MathInlineNode,
  BoldNode as LaTeXBoldNode,
  ItalicNode as LaTeXItalicNode,
  MonospaceNode as LaTeXMonospaceNode,
  CitationNode,
  ReferenceNode as LaTeXReferenceNode,
  LabelNode,
  HyperlinkNode as LaTeXHyperlinkNode,
  CommandNode,

  // 块级节点类型
  DocumentNode as LaTeXDocumentNode,
  ParagraphNode as LaTeXParagraphNode,
  SectionNode as LaTeXSectionNode,
  EnvironmentNode,
  MathBlockNode,
  CodeBlockNode as LaTeXCodeBlockNode,
  ListNode as LaTeXListNode,
  ListItemNode as LaTeXListItemNode,
  TableNode as LaTeXTableNode,
  FigureNode,
  TheoremNode,

  // 文档相关
  DocumentClass,
  PreambleItem,
  DocumentMetadata,
} from './latex';

// ================================
// 增量解析模块导出
// ================================

export {
  // 增量解析器
  IncrementalParser,
  createIncrementalParser,
  parseMarkdown,
  parseMarkdownStream,
  ParserState,
  TokenType,

  // 增量编辑解析器
  IncrementalEditParser,
  createIncrementalEditParser,
  parseWithEdit,
  createEditOperation,
  EditOperationType,
} from './incremental';

export type {
  // 增量解析类型
  Token,
  IncrementalParseResult,
  ParseError,
  ParserConfig,

  // 增量编辑类型
  EditOperation,
  AffectedRange,
  IncrementalEditParseResult,
  IncrementalEditParserConfig,
} from './incremental';

// ================================
// 统一解析接口
// ================================

import { parseCommonMark, type CommonMarkOptions, type ParseResult } from './markdown';
import { parseLaTeX, type LaTeXParserOptions, type LaTeXParseResult } from './latex';
import { parseMarkdown as parseIncremental, type ParserConfig } from './incremental';

/**
 * 解析模式
 */
export const enum ParseMode {
  /** CommonMark 规范解析（完整 AST） */
  CommonMark = 'commonmark',
  /** LaTeX 解析 */
  LaTeX = 'latex',
  /** 增量解析（适合大文件流式处理） */
  Incremental = 'incremental',
}

/**
 * 统一解析配置
 */
export interface UnifiedParseConfig {
  /** 解析模式 */
  mode?: ParseMode;
  /** CommonMark 解析配置 */
  commonmark?: CommonMarkOptions;
  /** LaTeX 解析配置 */
  latex?: LaTeXParserOptions;
  /** 增量解析配置 */
  incremental?: ParserConfig;
}

/**
 * 统一解析结果
 */
export interface UnifiedParseResult {
  /** 解析模式 */
  mode: ParseMode;
  /** 解析耗时（毫秒） */
  duration: number;
  /** CommonMark 解析结果 */
  commonmark?: ParseResult;
  /** LaTeX 解析结果 */
  latex?: LaTeXParseResult;
  /** 增量解析结果 */
  incremental?: import('./incremental').IncrementalParseResult;
}

/**
 * 统一解析函数
 * 根据配置选择合适的解析器
 *
 * @param input 输入文本
 * @param config 解析配置
 * @returns 解析结果
 */
export function parse(input: string, config?: UnifiedParseConfig): UnifiedParseResult {
  const mode = config?.mode ?? ParseMode.CommonMark;

  if (mode === ParseMode.LaTeX) {
    const result = parseLaTeX(input, config?.latex);
    return {
      mode: ParseMode.LaTeX,
      duration: result.duration,
      latex: result,
    };
  }

  if (mode === ParseMode.Incremental) {
    const result = parseIncremental(input, config?.incremental);
    return {
      mode: ParseMode.Incremental,
      duration: result.duration,
      incremental: result,
    };
  }

  // 默认使用 CommonMark
  const result = parseCommonMark(input, config?.commonmark);
  return {
    mode: ParseMode.CommonMark,
    duration: result.duration,
    commonmark: result,
  };
}

/**
 * 自动检测文档类型并解析
 *
 * @param input 输入文本
 * @param config 解析配置
 * @returns 解析结果
 */
export function autoParse(input: string, config?: UnifiedParseConfig): UnifiedParseResult {
  // 检测是否为 LaTeX 文档
  if (isLaTeXDocument(input)) {
    return parse(input, { ...config, mode: ParseMode.LaTeX });
  }

  // 大文件使用增量解析
  if (input.length > 100000) {
    return parse(input, { ...config, mode: ParseMode.Incremental });
  }

  // 默认使用 CommonMark
  return parse(input, { ...config, mode: ParseMode.CommonMark });
}

/**
 * 检测是否为 LaTeX 文档
 */
export function isLaTeXDocument(input: string): boolean {
  // 检查是否包含 LaTeX 特征
  const latexPatterns = [
    /\\documentclass/,
    /\\begin\{document\}/,
    /\\usepackage/,
    /\\section\{/,
    /\\subsection\{/,
    /\\begin\{equation\}/,
    /\\begin\{align\}/,
    /\\begin\{figure\}/,
    /\\begin\{table\}/,
  ];

  for (const pattern of latexPatterns) {
    if (pattern.test(input)) {
      return true;
    }
  }

  return false;
}

/**
 * 检测是否为 Markdown 文档
 */
export function isMarkdownDocument(input: string): boolean {
  // 检查是否包含 Markdown 特征
  const markdownPatterns = [
    /^#{1,6}\s/m, // 标题
    /^\s*[-*+]\s/m, // 无序列表
    /^\s*\d+\.\s/m, // 有序列表
    /\[.+\]\(.+\)/, // 链接
    /!\[.+\]\(.+\)/, // 图片
    /```[\s\S]*?```/, // 代码块
    /^\s*>/m, // 引用
  ];

  for (const pattern of markdownPatterns) {
    if (pattern.test(input)) {
      return true;
    }
  }

  return false;
}
