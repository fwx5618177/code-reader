// ================================
// @code-reader/markdown-parser
// 零依赖的 Markdown 解析：CommonMark / GFM 解析器（块级与行内节点都带行列与偏移），
// 以及面向大文件的逐行 token 增量解析
// ================================

export {
  CommonMarkParser,
  createCommonMarkParser,
  parseCommonMark,
  parseInline,
  InlineType,
  BlockType,
} from './commonmark';

export { renderHtml, escapeHtml, normalizeUrl, isSafeUrl } from './commonmark/html-renderer';
export type { HtmlRenderOptions, ExtensionRenderContext } from './commonmark/html-renderer';
export { collectFootnotes } from './commonmark/footnotes';
export type { FootnoteEntry } from './commonmark/footnotes';
export { IncrementalCommonMarkParser } from './commonmark/incremental-document';
export type { DocumentUpdate } from './commonmark/incremental-document';
export { MarkdownItToken, toMarkdownItTokens, MarkdownItCompatTokenizer } from './commonmark';

export type {
  ParseResult,
  ParseWarning,
  LinkReference,
  Position,
  InlineNode,
  BlockNode,
  TableAlignment,
  TableCellNode,
  TableRowNode,
  TableNode,
  CommonMarkOptions,
  InlineExtension,
  InlineExtensionMatch,
  BlockExtension,
  BlockExtensionContext,
  BlockExtensionLine,
} from './commonmark';

export {
  IncrementalParser,
  createIncrementalParser,
  parseMarkdown,
  parseMarkdownStream,
  ParserState,
  TokenType,
  IncrementalEditParser,
  createIncrementalEditParser,
  parseWithEdit,
  createEditOperation,
  EditOperationType,
} from './incremental';

export type {
  Token,
  IncrementalParseResult,
  ParseError,
  ParserConfig,
  EditOperation,
  AffectedRange,
  IncrementalEditParseResult,
  IncrementalEditParserConfig,
} from './incremental';
