// ================================
// @code-reader/format-parser
// LaTeX 解析（文档结构、元数据、交叉引用索引）与按内容选择解析器的统一入口。
// Markdown 解析在 @code-reader/markdown-parser
// ================================

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

  // 交叉引用
  CrossReferenceEntry,
  CrossReferenceIndex,
} from './latex';

// ================================
// 统一解析接口
// ================================

import {
  parseCommonMark,
  parseMarkdown as parseIncremental,
  type CommonMarkOptions,
  type ParseResult,
  type ParserConfig,
  type IncrementalParseResult,
} from '@code-reader/markdown-parser';
import { parseLaTeX, type LaTeXParserOptions, type LaTeXParseResult } from './latex';

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
  incremental?: IncrementalParseResult;
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

/** 只在 LaTeX 文档里出现的标记 */
const LATEX_DOCUMENT_MARKERS = [/\\documentclass\s*[[{]/, /\\begin\s*\{document\}/];

/** LaTeX 片段常见的行首命令；Markdown 笔记偶尔也会提到，需结合有无 Markdown 结构判断 */
const LATEX_LINE_COMMANDS =
  /^[ \t]*\\(?:usepackage\s*[[{]|(?:part|chapter|(?:sub){0,2}section|paragraph)\*?\s*[[{]|maketitle\b|begin\s*\{(?:equation|align|gather|figure|table|itemize|enumerate|abstract)\*?\})/m;

/** Markdown 的块级结构：ATX 标题、列表、引用、表格分隔行 */
const MARKDOWN_BLOCK_PATTERNS = [/^#{1,6}[ \t]/m, /^[ \t]*[-*+][ \t]/m, /^[ \t]*\d+[.)][ \t]/m, /^[ \t]*>/m, /^\|?[ \t]*:?-{3,}:?[ \t]*\|/m];

/** Markdown 的行内结构：链接、图片、双链 */
const MARKDOWN_INLINE_PATTERNS = [/!?\[[^\]\n]+\]\([^)\n]+\)/, /\[\[[^\]\n]+\]\]/];

/**
 * 去掉不参与判断的部分：Markdown 围栏代码块、行内代码、公式（Markdown 与 LaTeX 共有的语法），
 * 以及 LaTeX 注释。代码块里贴的 LaTeX 源码不应让整篇 Markdown 被当成 LaTeX
 */
function stripNeutralRegions(input: string): string {
  return input
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm, '')
    .replace(/`[^`\n]+`/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/(^|[^\\])%[^\n]*/g, '$1');
}

/**
 * 检测是否为 LaTeX 文档
 * - 代码块、行内代码、公式之外出现 \documentclass 或 \begin{document}：是
 * - 否则有行首的章节 / 宏包 / 常用环境命令，且没有 Markdown 的块级或行内结构：是
 */
export function isLaTeXDocument(input: string): boolean {
  const content = stripNeutralRegions(input);
  if (LATEX_DOCUMENT_MARKERS.some((pattern) => pattern.test(content))) return true;
  return LATEX_LINE_COMMANDS.test(content) && !hasMarkdownStructure(content);
}

function hasMarkdownStructure(content: string): boolean {
  return (
    MARKDOWN_BLOCK_PATTERNS.some((pattern) => pattern.test(content)) ||
    MARKDOWN_INLINE_PATTERNS.some((pattern) => pattern.test(content))
  );
}

/**
 * 检测是否为 Markdown 文档：有 Markdown 的块级或行内结构，或有围栏代码块
 */
export function isMarkdownDocument(input: string): boolean {
  return /^[ \t]*(`{3,}|~{3,})/m.test(input) || hasMarkdownStructure(input);
}
