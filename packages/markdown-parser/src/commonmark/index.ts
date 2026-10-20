// ================================
// @code-reader/markdown-parser - CommonMark 解析
// 入口文件
// ================================

// ================================
// CommonMark 解析器导出
// ================================

export {
  CommonMarkParser,
  createCommonMarkParser,
  parseCommonMark,
  parseInline,
  InlineType,
  BlockType,
} from './commonmark-parser';

export type {
  // 解析结果
  ParseResult,
  ParseWarning,
  LinkReference,

  // 位置
  Position,

  // 节点类型
  InlineNode,
  BlockNode,

  // 表格类型
  TableAlignment,
  TableCellNode,
  TableRowNode,
  TableNode,

  // 配置类型
  CommonMarkOptions,

  // 语法扩展
  InlineExtension,
  InlineExtensionMatch,
  BlockExtension,
  BlockExtensionContext,
  BlockExtensionLine,
} from './commonmark-parser';

export { renderHtml, escapeHtml } from './html-renderer';
export { normalizeUrl, normalizeLink, normalizeLinkText, isSafeUrl, domainToAscii, domainToUnicode } from './url';
export type { HtmlRenderOptions, ExtensionRenderContext } from './html-renderer';
export { collectFootnotes } from './footnotes';
export type { FootnoteEntry } from './footnotes';
export { IncrementalCommonMarkParser } from './incremental-document';
export type { DocumentUpdate } from './incremental-document';
export { Token as MarkdownItToken, toMarkdownItTokens, MarkdownItCompatTokenizer } from './markdown-it-tokens';
export type { TokenOptions, TokenizerOptions, TokenizerEnv } from './markdown-it-tokens';
