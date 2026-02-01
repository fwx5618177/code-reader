// ================================
// 统一的数学环境处理工具
// 合并重复的数学环境检测和包装逻辑
// ================================

/**
 * 数学环境类型
 */
export type MathEnvType =
  | 'align'        // 对齐环境 (align, flalign, alignat, eqnarray)
  | 'gather'       // 居中多行环境 (gather, multline)
  | 'equation'     // 单行公式环境
  | 'matrix'       // 矩阵环境
  | 'cases'        // 分段函数环境
  | 'nested'       // 嵌套环境 (aligned, gathered, split)
  | 'display'      // 显示公式 ($$, \[...\])
  | 'inline'       // 行内公式 ($, \(...\))
  | 'unknown';     // 未知类型

/**
 * 数学环境信息
 */
export interface MathEnvInfo {
  /** 环境类型 */
  type: MathEnvType;
  /** 基础环境名（去除星号） */
  baseName: string;
  /** 原始环境名（可能带星号） */
  originalName: string;
  /** 是否带编号 */
  numbered: boolean;
  /** 是否为顶层环境（需要包装） */
  isTopLevel: boolean;
  /** 是否为嵌套环境（不需要包装） */
  isNested: boolean;
  /** 是否为自包含环境（已有完整结构） */
  isSelfContained: boolean;
}

/**
 * 数学内容分析结果
 */
export interface MathContentAnalysis {
  /** 是否包含对齐符号 & */
  hasAlignment: boolean;
  /** 是否包含换行符 \\ */
  hasLineBreak: boolean;
  /** 换行符数量 */
  lineBreakCount: number;
  /** 是否已经包含环境包装 */
  hasWrapper: boolean;
  /** 检测到的包装环境名 */
  wrapperEnvName: string | null;
  /** 是否为完整环境结构 */
  isCompleteEnvironment: boolean;
  /** 内容起始匹配（如果是完整环境） */
  envStartMatch: RegExpMatchArray | null;
  /** 内容结束匹配（如果是完整环境） */
  envEndMatch: RegExpMatchArray | null;
}

/**
 * 包装建议
 */
export interface WrapSuggestion {
  /** 是否需要包装 */
  shouldWrap: boolean;
  /** 建议的包装环境名 */
  wrapperEnv: string | null;
  /** 原因说明 */
  reason: string;
}

// ================================
// 环境名称集合（预编译，避免重复创建）
// ================================

/** 顶层对齐环境（需要包装为 aligned） */
const TOP_LEVEL_ALIGN_ENVS = new Set([
  'align', 'align*',
  'flalign', 'flalign*',
  'alignat', 'alignat*',
  'eqnarray', 'eqnarray*',
]);

/** 顶层居中多行环境（需要包装为 gathered） */
const TOP_LEVEL_GATHER_ENVS = new Set([
  'gather', 'gather*',
  'multline', 'multline*',
]);

/** 单行公式环境 */
const EQUATION_ENVS = new Set([
  'equation', 'equation*',
]);

/** 嵌套/子环境（本身就是正确格式，不需要再包装） */
const NESTED_ENVS = new Set([
  'aligned',
  'gathered',
  'split',
  'alignedat',
]);

/** 矩阵环境 */
const MATRIX_ENVS = new Set([
  'matrix',
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Vmatrix',
  'Bmatrix',
  'smallmatrix',
  'array',
]);

/** 分段函数环境 */
const CASES_ENVS = new Set([
  'cases',
  'dcases',
  'rcases',
]);

/** 所有自包含环境（不需要额外包装） */
const SELF_CONTAINED_ENVS = new Set([
  ...MATRIX_ENVS,
  ...CASES_ENVS,
  ...NESTED_ENVS,
]);

/** 所有数学环境 */
const ALL_MATH_ENVS = new Set([
  ...TOP_LEVEL_ALIGN_ENVS,
  ...TOP_LEVEL_GATHER_ENVS,
  ...EQUATION_ENVS,
  ...NESTED_ENVS,
  ...MATRIX_ENVS,
  ...CASES_ENVS,
]);

// ================================
// 正则表达式（预编译）
// ================================

/** 环境开始标记 */
const ENV_BEGIN_REGEX = /^\\begin\{(\w+)\*?\}/;

/** 环境结束标记 */
const ENV_END_REGEX = /\\end\{(\w+)\*?\}\s*$/;

/** 换行符 \\ */
const LINE_BREAK_REGEX = /\\\\/g;

/** 环境名称提取 */
const ENV_NAME_REGEX = /\\begin\{([^}]+)\}/;

// ================================
// 核心函数
// ================================

/**
 * 获取环境信息
 * @param envName 环境名称（可能带星号）
 */
export function getEnvInfo(envName: string): MathEnvInfo {
  const baseName = envName.replace(/\*$/, '');
  const numbered = !envName.endsWith('*');

  let type: MathEnvType = 'unknown';
  let isTopLevel = false;
  let isNested = false;
  let isSelfContained = false;

  // 判断环境类型
  if (TOP_LEVEL_ALIGN_ENVS.has(envName) || TOP_LEVEL_ALIGN_ENVS.has(baseName)) {
    type = 'align';
    isTopLevel = true;
  } else if (TOP_LEVEL_GATHER_ENVS.has(envName) || TOP_LEVEL_GATHER_ENVS.has(baseName)) {
    type = 'gather';
    isTopLevel = true;
  } else if (EQUATION_ENVS.has(envName) || EQUATION_ENVS.has(baseName)) {
    type = 'equation';
    isTopLevel = true;
  } else if (MATRIX_ENVS.has(baseName)) {
    type = 'matrix';
    isSelfContained = true;
  } else if (CASES_ENVS.has(baseName)) {
    type = 'cases';
    isSelfContained = true;
  } else if (NESTED_ENVS.has(baseName)) {
    type = 'nested';
    isNested = true;
    isSelfContained = true;
  }

  return {
    type,
    baseName,
    originalName: envName,
    numbered,
    isTopLevel,
    isNested,
    isSelfContained,
  };
}

/**
 * 分析数学内容
 * @param content 数学内容（不含外层环境标记）
 */
export function analyzeMathContent(content: string): MathContentAnalysis {
  const trimmed = content.trim();

  // 检测对齐符号
  const hasAlignment = trimmed.includes('&');

  // 检测换行符
  const lineBreakMatches = trimmed.match(LINE_BREAK_REGEX);
  const hasLineBreak = lineBreakMatches !== null && lineBreakMatches.length > 0;
  const lineBreakCount = lineBreakMatches?.length ?? 0;

  // 检测是否已包含环境包装
  let hasWrapper = false;
  let wrapperEnvName: string | null = null;

  for (const env of SELF_CONTAINED_ENVS) {
    if (trimmed.includes(`\\begin{${env}}`)) {
      hasWrapper = true;
      wrapperEnvName = env;
      break;
    }
  }

  // 检测是否为完整环境结构
  const envStartMatch = trimmed.match(ENV_BEGIN_REGEX);
  const envEndMatch = trimmed.match(ENV_END_REGEX);
  const isCompleteEnvironment = !!(
    envStartMatch &&
    envEndMatch &&
    SELF_CONTAINED_ENVS.has(envStartMatch[1])
  );

  return {
    hasAlignment,
    hasLineBreak,
    lineBreakCount,
    hasWrapper,
    wrapperEnvName,
    isCompleteEnvironment,
    envStartMatch,
    envEndMatch,
  };
}

/**
 * 获取包装建议
 * @param envInfo 环境信息
 * @param analysis 内容分析结果
 */
export function getWrapSuggestion(
  envInfo: MathEnvInfo,
  analysis: MathContentAnalysis
): WrapSuggestion {
  // 如果内容已经是完整的自包含环境，不需要包装
  if (analysis.isCompleteEnvironment) {
    return {
      shouldWrap: false,
      wrapperEnv: null,
      reason: '内容已是完整的自包含环境',
    };
  }

  // 如果已经有包装，不需要再包装
  if (analysis.hasWrapper) {
    return {
      shouldWrap: false,
      wrapperEnv: null,
      reason: `内容已包含 ${analysis.wrapperEnvName} 环境`,
    };
  }

  // 矩阵环境：使用原始环境名包装
  if (envInfo.type === 'matrix') {
    return {
      shouldWrap: true,
      wrapperEnv: envInfo.baseName,
      reason: '矩阵环境需要用原始环境名包装',
    };
  }

  // 分段函数环境：使用原始环境名包装
  if (envInfo.type === 'cases') {
    return {
      shouldWrap: true,
      wrapperEnv: envInfo.baseName,
      reason: '分段函数环境需要用原始环境名包装',
    };
  }

  // 嵌套环境：需要完整的 \begin...\end 结构
  if (envInfo.isNested) {
    return {
      shouldWrap: true,
      wrapperEnv: envInfo.baseName,
      reason: '嵌套环境需要完整结构',
    };
  }

  // 顶层对齐环境：包装为 aligned
  if (envInfo.type === 'align') {
    return {
      shouldWrap: true,
      wrapperEnv: 'aligned',
      reason: '顶层对齐环境需要包装为 aligned',
    };
  }

  // 顶层居中多行环境：包装为 gathered
  if (envInfo.type === 'gather') {
    return {
      shouldWrap: true,
      wrapperEnv: 'gathered',
      reason: '顶层居中多行环境需要包装为 gathered',
    };
  }

  // equation 环境
  if (envInfo.type === 'equation') {
    if (analysis.hasAlignment && analysis.hasLineBreak) {
      return {
        shouldWrap: true,
        wrapperEnv: 'aligned',
        reason: 'equation 中有多行对齐，使用 aligned',
      };
    }
    if (analysis.hasLineBreak && !analysis.hasAlignment) {
      return {
        shouldWrap: true,
        wrapperEnv: 'gathered',
        reason: 'equation 中有换行无对齐，使用 gathered',
      };
    }
    // 单行 equation：不需要包装
    return {
      shouldWrap: false,
      wrapperEnv: null,
      reason: '单行 equation 不需要包装',
    };
  }

  // 普通公式（如 $$ 或 \[...\]）
  // 只有明确的多行情况才自动包装
  const isExplicitMultiline = analysis.lineBreakCount >= 2;

  if (isExplicitMultiline && analysis.hasAlignment) {
    return {
      shouldWrap: true,
      wrapperEnv: 'aligned',
      reason: '多行对齐公式，使用 aligned',
    };
  }

  if (isExplicitMultiline && !analysis.hasAlignment) {
    return {
      shouldWrap: true,
      wrapperEnv: 'gathered',
      reason: '多行居中公式，使用 gathered',
    };
  }

  // 单个 \\ 的普通公式：保持原样
  return {
    shouldWrap: false,
    wrapperEnv: null,
    reason: '普通公式保持原样',
  };
}

/**
 * 处理数学内容
 * 根据环境类型和内容特征，决定是否需要包装以及如何包装
 *
 * @param content 数学内容
 * @param envName 环境名称（可选，如果来自 \begin{...}）
 * @param delimiter 分隔符（可选，如 $$, \[）
 * @returns 处理后的内容
 */
export function processMathContent(
  content: string,
  envName?: string,
  delimiter?: string
): {
  processedContent: string;
  envInfo: MathEnvInfo;
  analysis: MathContentAnalysis;
  suggestion: WrapSuggestion;
} {
  // 清理内容
  const trimmedContent = content.trim();

  // 获取环境信息
  const envInfo = getEnvInfo(envName || delimiter || '');

  // 分析内容
  const analysis = analyzeMathContent(trimmedContent);

  // 如果内容已经是完整环境，直接返回
  if (analysis.isCompleteEnvironment) {
    return {
      processedContent: trimmedContent,
      envInfo,
      analysis,
      suggestion: {
        shouldWrap: false,
        wrapperEnv: null,
        reason: '内容已是完整环境',
      },
    };
  }

  // 获取包装建议
  const suggestion = getWrapSuggestion(envInfo, analysis);

  // 应用包装
  let processedContent = trimmedContent;
  if (suggestion.shouldWrap && suggestion.wrapperEnv) {
    processedContent = `\\begin{${suggestion.wrapperEnv}}${trimmedContent}\\end{${suggestion.wrapperEnv}}`;
  }

  return {
    processedContent,
    envInfo,
    analysis,
    suggestion,
  };
}

/**
 * 从原始内容提取数学内容
 * 去除 \begin{...} 和 \end{...} 标记
 *
 * @param raw 原始内容
 * @returns 提取的数学内容，如果无法提取则返回 null
 */
export function extractMathContent(raw: string): string | null {
  const beginMatch = raw.match(/\\begin\{[^}]+\}/);
  const endMatch = raw.match(/\\end\{[^}]+\}/);

  if (beginMatch && endMatch) {
    const beginEnd = raw.indexOf(beginMatch[0]) + beginMatch[0].length;
    const endStart = raw.lastIndexOf(endMatch[0]);

    if (endStart > beginEnd) {
      return raw.slice(beginEnd, endStart);
    }
  }

  return null;
}

/**
 * 从原始内容提取环境名称
 *
 * @param raw 原始内容
 * @returns 环境名称，如果无法提取则返回 null
 */
export function extractEnvName(raw: string): string | null {
  const match = raw.match(ENV_NAME_REGEX);
  return match ? match[1] : null;
}

/**
 * 判断是否为数学环境
 *
 * @param envName 环境名称
 */
export function isMathEnv(envName: string): boolean {
  const baseName = envName.replace(/\*$/, '');
  return ALL_MATH_ENVS.has(envName) || ALL_MATH_ENVS.has(baseName);
}

/**
 * 判断是否为矩阵环境
 *
 * @param envName 环境名称
 */
export function isMatrixEnv(envName: string): boolean {
  const baseName = envName.replace(/\*$/, '');
  return MATRIX_ENVS.has(baseName);
}

/**
 * 判断是否为分段函数环境
 *
 * @param envName 环境名称
 */
export function isCasesEnv(envName: string): boolean {
  const baseName = envName.replace(/\*$/, '');
  return CASES_ENVS.has(baseName);
}

/**
 * 判断是否为对齐环境
 *
 * @param envName 环境名称
 */
export function isAlignEnv(envName: string): boolean {
  const baseName = envName.replace(/\*$/, '');
  return (
    TOP_LEVEL_ALIGN_ENVS.has(envName) ||
    TOP_LEVEL_ALIGN_ENVS.has(baseName) ||
    baseName === 'aligned' ||
    baseName === 'alignedat'
  );
}

/**
 * 判断是否为居中多行环境
 *
 * @param envName 环境名称
 */
export function isGatherEnv(envName: string): boolean {
  const baseName = envName.replace(/\*$/, '');
  return (
    TOP_LEVEL_GATHER_ENVS.has(envName) ||
    TOP_LEVEL_GATHER_ENVS.has(baseName) ||
    baseName === 'gathered'
  );
}

/**
 * 获取环境对应的 CSS 类名
 *
 * @param envInfo 环境信息
 * @param prefix CSS 类前缀
 */
export function getEnvCssClass(envInfo: MathEnvInfo, prefix: string = 'latex'): string {
  const classes: string[] = [`${prefix}-math-block`];

  switch (envInfo.type) {
    case 'matrix':
      classes.push(`${prefix}-math-matrix`);
      break;
    case 'cases':
      classes.push(`${prefix}-math-cases`);
      break;
    case 'align':
    case 'nested':
      if (envInfo.baseName === 'aligned' || envInfo.baseName === 'alignedat' || envInfo.type === 'align') {
        classes.push(`${prefix}-math-align`);
      } else if (envInfo.baseName === 'gathered') {
        classes.push(`${prefix}-math-gather`);
      }
      break;
    case 'gather':
      classes.push(`${prefix}-math-gather`);
      break;
    case 'equation':
      classes.push(`${prefix}-math-equation`);
      break;
  }

  if (envInfo.numbered) {
    classes.push(`${prefix}-math-numbered`);
  }

  return classes.join(' ');
}

/**
 * 获取环境的 HTML 属性
 *
 * @param envInfo 环境信息
 */
export function getEnvHtmlAttributes(envInfo: MathEnvInfo): Record<string, string> {
  const attrs: Record<string, string> = {
    'data-env': envInfo.originalName,
    'data-env-type': envInfo.type,
  };

  if (envInfo.numbered) {
    attrs['data-numbered'] = 'true';
  }

  return attrs;
}

/**
 * 格式化 HTML 属性
 *
 * @param attrs 属性对象
 */
export function formatHtmlAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(' ');
}

/**
 * HTML 转义
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ================================
// 导出环境集合（供外部使用）
// ================================

export const ENV_SETS = {
  TOP_LEVEL_ALIGN: TOP_LEVEL_ALIGN_ENVS,
  TOP_LEVEL_GATHER: TOP_LEVEL_GATHER_ENVS,
  EQUATION: EQUATION_ENVS,
  NESTED: NESTED_ENVS,
  MATRIX: MATRIX_ENVS,
  CASES: CASES_ENVS,
  SELF_CONTAINED: SELF_CONTAINED_ENVS,
  ALL_MATH: ALL_MATH_ENVS,
} as const;
