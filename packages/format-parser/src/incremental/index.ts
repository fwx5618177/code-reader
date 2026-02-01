// ================================
// @code-reader/parser - 增量解析模块
// 入口文件
// ================================

// ================================
// 增量解析器导出
// ================================

export {
  IncrementalParser,
  createIncrementalParser,
  parseMarkdown,
  parseMarkdownStream,
  ParserState,
  TokenType,
} from './incremental-parser';

export type {
  Token,
  ParseResult as IncrementalParseResult,
  ParseError,
  ParserConfig,
} from './incremental-parser';

// ================================
// 增量编辑解析器导出
// ================================

export {
  IncrementalEditParser,
  createIncrementalEditParser,
  parseWithEdit,
  createEditOperation,
  EditOperationType,
} from './incremental-edit-parser';

export type {
  EditOperation,
  AffectedRange,
  IncrementalParseResult as IncrementalEditParseResult,
  IncrementalEditParserConfig,
} from './incremental-edit-parser';
