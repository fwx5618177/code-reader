// ================================
// LaTeX 语言配置：注释、括号、自动配对、缩进与折叠标记、单词定义
// 格式参照 VS Code 的 language-configuration.json，编辑器适配层按需取用
// ================================

/**
 * 语言配置（括号匹配、注释格式等）
 *
 * 类似 VSCode 的 language-configuration.json
 */
export interface LanguageConfiguration {
  /** 行注释标记 */
  readonly lineComment?: string;
  /** 块注释标记 */
  readonly blockComment?: readonly [string, string];
  /** 括号对 */
  readonly brackets?: readonly (readonly [string, string])[];
  /** 自动闭合对 */
  readonly autoClosingPairs?: readonly AutoClosingPair[];
  /** 缩进规则 */
  readonly indentationRules?: IndentationRules;
  /** 折叠区域标记 */
  readonly foldingMarkers?: FoldingMarkers;
  /** 单词定义正则 */
  readonly wordPattern?: string;
}

/**
 * 自动闭合对
 */
export interface AutoClosingPair {
  readonly open: string;
  readonly close: string;
  readonly notIn?: readonly string[];
}

/**
 * 缩进规则
 */
export interface IndentationRules {
  readonly increaseIndentPattern?: string;
  readonly decreaseIndentPattern?: string;
  readonly indentNextLinePattern?: string;
  readonly unIndentedLinePattern?: string;
}

/**
 * 折叠区域标记
 */
export interface FoldingMarkers {
  readonly start: string;
  readonly end: string;
}

/** LaTeX 的语言配置 */
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
  // document 环境的正文不缩进
  indentationRules: {
    increaseIndentPattern: '\\\\begin\\{(?!document\\})[^}]*\\}',
    decreaseIndentPattern: '\\\\end\\{(?!document\\})[^}]*\\}',
  },
  foldingMarkers: {
    start: '\\\\begin\\{',
    end: '\\\\end\\{',
  },
  wordPattern: '\\\\?[a-zA-Z@]+',
};
