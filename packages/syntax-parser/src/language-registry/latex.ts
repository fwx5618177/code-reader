// ================================
// LaTeX 语言定义
//
// 职责：定义 LaTeX 的高亮规则、语言配置、语言贡献
// 使用 BlockScannerAdapter 适配器进行块级结构扫描
// ================================

import type { LanguageContribution, HighlightRule, LanguageConfiguration } from './types';
import type { ParserConfig } from '../types';
import { BlockScannerAdapter } from './block-scanner-adapter';

// ================================
// LaTeX 高亮规则
// ================================

/**
 * LaTeX 语法高亮规则
 *
 * 将 TSTreeSitterParser 产出的 AST 节点类型映射到 TokenKind
 */
export const LATEX_HIGHLIGHT_RULES: HighlightRule[] = [
  // 文档结构命令
  { nodeType: 'DocumentClass', tokenKind: 'command' },
  { nodeType: 'UsePackage', tokenKind: 'keyword.import' },

  // 章节标题
  { nodeType: 'SectionChapter', tokenKind: 'command.section' },
  { nodeType: 'SectionSection', tokenKind: 'command.section' },
  { nodeType: 'SectionSubsection', tokenKind: 'command.section' },
  { nodeType: 'SectionSubsubsection', tokenKind: 'command.section' },
  { nodeType: 'SectionParagraph', tokenKind: 'command.section' },
  { nodeType: 'SectionSubparagraph', tokenKind: 'command.section' },

  // 数学环境
  { nodeType: 'MathEnvironment', tokenKind: 'math.display' },
  { nodeType: 'DisplayMath', tokenKind: 'math.display' },
  { nodeType: 'MatrixEnvironment', tokenKind: 'math.display' },
  { nodeType: 'CasesEnvironment', tokenKind: 'math.display' },

  // 环境
  { nodeType: 'DocumentBody', tokenKind: 'environment' },
  { nodeType: 'Environment', tokenKind: 'environment' },
  { nodeType: 'ListEnvironment', tokenKind: 'environment' },
  { nodeType: 'TableEnvironment', tokenKind: 'environment' },

  // 注释
  { nodeType: 'Comment', tokenKind: 'comment.line' },

  // 元数据
  { nodeType: 'Title', tokenKind: 'heading' },
  { nodeType: 'Author', tokenKind: 'meta' },
  { nodeType: 'Date', tokenKind: 'meta' },
  { nodeType: 'Maketitle', tokenKind: 'command' },

  // 通用命令
  { nodeType: 'Command', tokenKind: 'command' },

  // 段落分隔
  { nodeType: 'ParagraphBreak', tokenKind: 'text' },

  // 正文段落
  { nodeType: 'Paragraph', tokenKind: 'text' },

  // 文档根节点
  { nodeType: 'Document', tokenKind: 'text' },
];

// ================================
// LaTeX 语言配置
// ================================

export const LATEX_LANGUAGE_CONFIGURATION: LanguageConfiguration = {
  lineComment: '%',
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$', notIn: ['string', 'comment'] },
    { open: '\\(', close: '\\)' },
    { open: '\\[', close: '\\]' },
  ],
  indentationRules: {
    increaseIndentPattern: '\\\\begin\\{[^}]*\\}',
    decreaseIndentPattern: '\\\\end\\{[^}]*\\}',
  },
  foldingMarkers: {
    start: '\\\\begin\\{',
    end: '\\\\end\\{',
  },
  wordPattern: '\\\\?[a-zA-Z@]+',
};

// ================================
// LaTeX 语言贡献
// ================================

/**
 * LaTeX 完整语言贡献配置
 *
 * 使用 BlockScannerAdapter 进行块级结构扫描，无需外部依赖
 *
 * ```typescript
 * import { getLanguageRegistry, LATEX_CONTRIBUTION } from '@code-reader/syntax-parser';
 *
 * const registry = getLanguageRegistry();
 * registry.register(LATEX_CONTRIBUTION);
 *
 * const parser = registry.createParser('latex');
 * const result = parser.parse(latexContent);
 * ```
 */
export const LATEX_CONTRIBUTION: LanguageContribution = {
  language: {
    id: 'latex',
    name: 'LaTeX',
    aliases: ['tex', 'TeX', 'LaTeX'],
    extensions: ['.tex', '.latex', '.ltx', '.sty', '.cls', '.bib'],
    filenames: [],
    mimeTypes: ['text/x-latex', 'application/x-latex'],
    icon: '📄',
  },

  parserFactory: (config?: ParserConfig) => new BlockScannerAdapter('latex', config),

  highlightRules: LATEX_HIGHLIGHT_RULES,

  configuration: LATEX_LANGUAGE_CONFIGURATION,
};
