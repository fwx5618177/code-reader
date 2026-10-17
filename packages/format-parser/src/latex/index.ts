// ================================
// @code-reader/parser - LaTeX 模块
// 入口文件
// ================================

// ================================
// 解析器导出
// ================================

export {
  LaTeXParser,
  createLaTeXParser,
  parseLaTeX,
  parseLaTeXInline,
} from './latex-parser';

// ================================
// 类型导出
// ================================

export {
  // 枚举
  LaTeXBlockType,
  LaTeXInlineType,

  // 默认配置
  DEFAULT_LATEX_OPTIONS,
} from './types';

export type {
  // 解析配置
  LaTeXParserOptions,
  LaTeXParseResult,
  ParseWarning,

  // 位置
  Position,

  // 节点基础
  LaTeXNodeBase,
  LaTeXNode,

  // 行内节点类型
  LaTeXInlineNode,
  TextNode,
  MathInlineNode,
  BoldNode,
  ItalicNode,
  UnderlineNode,
  MonospaceNode,
  SmallCapsNode,
  EmphasisNode,
  CitationNode,
  ReferenceNode,
  LabelNode,
  HyperlinkNode,
  UrlNode,
  FootnoteRefNode,
  CommandNode,
  SpecialCharNode,
  WhitespaceNode,
  LineBreakNode,
  GroupNode,

  // 块级节点类型
  LaTeXBlockNode,
  DocumentNode,
  ParagraphNode,
  SectionNode,
  EnvironmentNode,
  MathBlockNode,
  CodeBlockNode,
  ListNode,
  ListItemNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  FigureNode,
  QuoteNode,
  TheoremNode,
  FootnoteNode,
  BibliographyNode,
  BibItemNode,
  AbstractNode,
  TitleBlockNode,
  CommentNode,
  RawNode,

  // 文档相关
  DocumentClass,
  PreambleItem,
  DocumentMetadata,
  AuthorInfo,

  // 交叉引用
  CrossReferenceEntry,
  CrossReferenceIndex,
} from './types';
