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
} from './commonmark-parser';

export { renderHtml, escapeHtml, normalizeUrl } from './html-renderer';
