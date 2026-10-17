// ================================
// 数学公式模块
// 自主实现的 LaTeX 数学公式解析和渲染
//
// 不依赖任何外部库（如 KaTeX、MathJax）
// 完全使用纯 TypeScript/CSS 实现
// ================================

// ================================
// 导出扩展数学符号
// ================================

export {
  // 希腊字母
  EXTENDED_GREEK_LETTERS,
  // 关系运算符
  EXTENDED_RELATIONS,
  // 二元运算符
  EXTENDED_BINARY_OPERATORS,
  // 大型运算符
  EXTENDED_LARGE_OPERATORS,
  // 箭头符号
  EXTENDED_ARROWS,
  // 杂项符号
  MISC_SYMBOLS,
  // 扩展函数名
  EXTENDED_FUNCTION_NAMES,
  // 扩展分隔符
  EXTENDED_DELIMITERS,
  // 扩展重音符号
  EXTENDED_ACCENTS,
  // 黑板粗体
  BLACKBOARD_BOLD,
  // 花体
  CALLIGRAPHIC,
  // 哥特体
  FRAKTUR,
  // 组合数学符号
  COMBINATORIAL_SYMBOLS,
  // 物理符号
  PHYSICS_SYMBOLS,
  // 合并符号表
  ALL_SYMBOLS,
  // 符号集合
  LARGE_OPERATOR_NAMES,
  RELATION_NAMES,
  BINARY_OPERATOR_NAMES,
  ARROW_NAMES,
  // 符号查找函数
  lookupSymbol,
  isKnownSymbol,
  isFunctionName,
  getBlackboardBold,
  getCalligraphic,
  getFraktur,
  getAccent,
  getDelimiter,
} from './extended-symbols';

// ================================
// 导出解析器
// ================================

export type {
  MathNodeType,
  MathNode,
  AtomClass,
  TextNode,
  NumberNode,
  OperatorNode,
  SymbolNode,
  VariableNode,
  FunctionNode,
  GroupNode,
  FracNode,
  BinomNode,
  SqrtNode,
  SuperscriptNode,
  SubscriptNode,
  SubSupNode,
  MatrixNode,
  CasesNode,
  AlignedNode,
  GatheredNode,
  SpaceNode,
  AccentNode,
  DelimiterNode,
  SizedDelimiterNode,
  FontNode,
  StyleNode,
  ColorNode,
  EncloseNode,
  OverUnderNode,
  XArrowNode,
  PhantomNode,
  ErrorNode,
  RootNode,
  AnyMathNode,
  ParserOptions,
  LineBreakNode,
} from './parser';

export { MathParser, parseMath, parseDimension } from './parser';

// ================================
// 导出渲染器
// ================================

export type { RenderOptions, RenderResult } from './renderer';

export { MathRenderer, renderMathAST } from './renderer';

// ================================
// 导入依赖
// ================================

import { parseMath, type ParserOptions } from './parser';
import { renderMathAST, type RenderOptions, type RenderResult } from './renderer';

// ================================
// 统一的渲染 API
// ================================

/** 完整的渲染选项 */
export interface MathRenderOptions extends ParserOptions, RenderOptions {}

/**
 * 渲染 LaTeX 公式为 HTML
 * 这是主要的 API 入口
 *
 * @param latex LaTeX 公式字符串
 * @param options 渲染选项
 * @returns 渲染结果
 */
export function renderMath(latex: string, options?: MathRenderOptions): RenderResult {
  if (!latex || !latex.trim()) {
    return {
      html: '',
      success: true,
    };
  }

  try {
    const ast = parseMath(latex, {
      displayMode: options?.displayMode,
      strict: options?.strict,
      maxIterations: options?.maxIterations,
      maxNodes: options?.maxNodes,
    });

    return renderMathAST(ast, {
      displayMode: options?.displayMode,
      baseFontSize: options?.baseFontSize,
      showErrors: options?.showErrors,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      html:
        `<span class="math-error" title="${escapeHtml(errorMessage)}">` +
        `<span class="math-error-message">解析错误</span>` +
        `<span class="math-error-raw">${escapeHtml(latex.slice(0, 50))}${latex.length > 50 ? '...' : ''}</span>` +
        `</span>`,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 渲染行内公式
 * @param latex LaTeX 公式字符串
 * @param options 渲染选项（不含 displayMode）
 * @returns 渲染结果
 */
export function renderInlineMath(
  latex: string,
  options?: Omit<MathRenderOptions, 'displayMode'>
): RenderResult {
  return renderMath(latex, { ...options, displayMode: false });
}

/**
 * 渲染块级公式
 * @param latex LaTeX 公式字符串
 * @param options 渲染选项（不含 displayMode）
 * @returns 渲染结果
 */
export function renderBlockMath(
  latex: string,
  options?: Omit<MathRenderOptions, 'displayMode'>
): RenderResult {
  return renderMath(latex, { ...options, displayMode: true });
}

// ================================
// 公式匹配和提取
// ================================

/** 公式匹配结果 */
export interface MathMatch {
  /** 原始文本 */
  raw: string;
  /** 公式内容 */
  content: string;
  /** 起始位置 */
  start: number;
  /** 结束位置 */
  end: number;
  /** 是否为块级公式 */
  isBlock: boolean;
}

/** 行内公式正则：$...$（不匹配 $$） */
const INLINE_MATH_REGEX = /(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g;

/** 行内公式正则：\(...\) */
const INLINE_PAREN_REGEX = /\\\(([^)]+?)\\\)/g;

/** 块级公式正则：$$...$$ */
const BLOCK_MATH_REGEX = /\$\$([^\$]+?)\$\$/gs;

/** 块级公式正则：\[...\] */
const BLOCK_BRACKET_REGEX = /\\\[([\s\S]+?)\\\]/g;

/** LaTeX 环境正则：\begin{equation}...\end{equation} 等 */
const LATEX_ENV_REGEX =
  /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}([\s\S]+?)\\end\{\1\*?\}/g;

/**
 * 检查位置是否与已有匹配重叠
 */
function isOverlapping(matches: MathMatch[], start: number, end: number): boolean {
  return matches.some(
    (m) =>
      (start >= m.start && start < m.end) ||
      (end > m.start && end <= m.end) ||
      (start <= m.start && end >= m.end)
  );
}

/**
 * 查找文本中的所有数学公式
 * 支持以下语法：
 * - $...$ 行内公式
 * - $$...$$ 块级公式
 * - \(...\) 行内公式
 * - \[...\] 块级公式
 * - \begin{equation}...\end{equation} 等 LaTeX 环境
 *
 * @param text 输入文本
 * @returns 匹配结果数组
 */
export function findMathExpressions(text: string): MathMatch[] {
  const matches: MathMatch[] = [];
  let match: RegExpExecArray | null;

  // 1. 查找 $$...$$ 块级公式（优先级最高，避免被 $...$ 误匹配）
  BLOCK_MATH_REGEX.lastIndex = 0;
  while ((match = BLOCK_MATH_REGEX.exec(text)) !== null) {
    const content = match[1];
    if (content && content.trim()) {
      matches.push({
        raw: match[0],
        content: content.trim(),
        start: match.index,
        end: match.index + match[0].length,
        isBlock: true,
      });
    }
  }

  // 2. 查找 \[...\] 块级公式
  BLOCK_BRACKET_REGEX.lastIndex = 0;
  while ((match = BLOCK_BRACKET_REGEX.exec(text)) !== null) {
    const content = match[1];
    if (
      content &&
      content.trim() &&
      !isOverlapping(matches, match.index, match.index + match[0].length)
    ) {
      matches.push({
        raw: match[0],
        content: content.trim(),
        start: match.index,
        end: match.index + match[0].length,
        isBlock: true,
      });
    }
  }

  // 3. 查找 LaTeX 环境（equation, align 等）
  LATEX_ENV_REGEX.lastIndex = 0;
  while ((match = LATEX_ENV_REGEX.exec(text)) !== null) {
    const content = match[2]; // 第二个捕获组是内容
    if (
      content &&
      content.trim() &&
      !isOverlapping(matches, match.index, match.index + match[0].length)
    ) {
      matches.push({
        raw: match[0],
        content: content.trim(),
        start: match.index,
        end: match.index + match[0].length,
        isBlock: true,
      });
    }
  }

  // 4. 查找 $...$ 行内公式（排除已匹配的块级区域）
  INLINE_MATH_REGEX.lastIndex = 0;
  while ((match = INLINE_MATH_REGEX.exec(text)) !== null) {
    const content = match[1];
    if (
      content &&
      content.trim() &&
      !isOverlapping(matches, match.index, match.index + match[0].length)
    ) {
      matches.push({
        raw: match[0],
        content: content.trim(),
        start: match.index,
        end: match.index + match[0].length,
        isBlock: false,
      });
    }
  }

  // 5. 查找 \(...\) 行内公式
  INLINE_PAREN_REGEX.lastIndex = 0;
  while ((match = INLINE_PAREN_REGEX.exec(text)) !== null) {
    const content = match[1];
    if (
      content &&
      content.trim() &&
      !isOverlapping(matches, match.index, match.index + match[0].length)
    ) {
      matches.push({
        raw: match[0],
        content: content.trim(),
        start: match.index,
        end: match.index + match[0].length,
        isBlock: false,
      });
    }
  }

  // 按位置排序
  matches.sort((a, b) => a.start - b.start);

  return matches;
}

/**
 * 检查文本是否包含数学公式
 * @param text 输入文本
 * @returns 是否包含公式
 */
export function containsMath(text: string): boolean {
  // 重置所有正则的 lastIndex
  INLINE_MATH_REGEX.lastIndex = 0;
  INLINE_PAREN_REGEX.lastIndex = 0;
  BLOCK_MATH_REGEX.lastIndex = 0;
  BLOCK_BRACKET_REGEX.lastIndex = 0;
  LATEX_ENV_REGEX.lastIndex = 0;

  return (
    INLINE_MATH_REGEX.test(text) ||
    INLINE_PAREN_REGEX.test(text) ||
    BLOCK_MATH_REGEX.test(text) ||
    BLOCK_BRACKET_REGEX.test(text) ||
    LATEX_ENV_REGEX.test(text)
  );
}

/**
 * 将文本中的数学公式渲染为 HTML
 * @param text 输入文本
 * @returns 渲染后的 HTML
 */
export function renderMathInText(text: string): string {
  const matches = findMathExpressions(text);
  if (matches.length === 0) {
    return escapeHtml(text);
  }

  let result = '';
  let lastEnd = 0;

  for (const match of matches) {
    // 添加公式前的文本
    result += escapeHtml(text.slice(lastEnd, match.start));

    // 渲染公式
    const rendered = renderMath(match.content, { displayMode: match.isBlock });

    if (match.isBlock) {
      result += `<div class="math-block-wrapper">${rendered.html}</div>`;
    } else {
      result += `<span class="math-inline-wrapper">${rendered.html}</span>`;
    }

    lastEnd = match.end;
  }

  // 添加剩余文本
  result += escapeHtml(text.slice(lastEnd));

  return result;
}

// ================================
// 工具函数
// ================================

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 验证 LaTeX 公式语法
 * @param latex LaTeX 公式字符串
 * @returns 验证结果
 */
export function validateLatex(latex: string): { valid: boolean; error?: string } {
  try {
    parseMath(latex, { strict: true });
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 获取公式的纯文本表示
 * @param latex LaTeX 公式字符串
 * @returns 纯文本
 */
export function getMathPlainText(latex: string): string {
  return latex
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}^_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ================================
// 样式说明
// ================================

/**
 * 数学公式样式位于 src/render/styles/math-rendering.scss，
 * 由 styles/global.scss 全局引入。渲染器只输出类名，颜色跟随主题变量。
 */

// ================================
// 默认导出
// ================================

export default {
  renderMath,
  renderInlineMath,
  renderBlockMath,
  renderMathInText,
  findMathExpressions,
  containsMath,
  validateLatex,
  getMathPlainText,
  parseMath,
  renderMathAST,
};
