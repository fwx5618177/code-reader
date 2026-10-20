// ================================
// LaTeX Block Scanner 模块
//
// 提供基于正则匹配的 LaTeX 文档块级结构扫描
// 纯 TypeScript 实现，零依赖
//
// 功能：
// - 块级结构提取（section、environment、math 等）
// - 文档大纲和结构导航
// - 与 ILanguageParser 接口兼容
//
// 使用场景：
// - LaTeX 文档结构快速扫描
// - 文档大纲/目录生成
// ================================

// ================================
// 类型导出
// ================================

export type {
  TSNode,
  TSTree,
  LatexBlockScannerConfig,
  // 后向兼容别名
  LatexBlockScannerConfig as TSTreeSitterConfig,
} from './latex-block-scanner';

// 导出通用类型
export interface TreeSitterPoint {
  row: number;
  column: number;
}

export interface TreeSitterRange {
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  startIndex: number;
  endIndex: number;
}

/** 语言配置 */
export interface LanguageConfig {
  name: string;
  extensions: string[];
  aliases?: string[];
}

// ================================
// 类和函数导出
// ================================

export {
  LatexBlockScanner,
  createLatexBlockScanner,
  // 后向兼容别名
  LatexBlockScanner as TSTreeSitterParser,
  createLatexBlockScanner as createTSTreeSitterParser,
} from './latex-block-scanner';

// ================================
// 预定义语言配置
// ================================

/** 当前支持的语言 */
export const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
  latex: {
    name: 'latex',
    extensions: ['.tex', '.latex', '.ltx'],
    aliases: ['tex'],
  },
};

/**
 * 根据文件扩展名获取语言配置
 */
export function getLanguageByExtension(extension: string): LanguageConfig | undefined {
  const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
  for (const lang of Object.values(SUPPORTED_LANGUAGES)) {
    if (lang.extensions.includes(normalizedExt)) {
      return lang;
    }
  }
  return undefined;
}

/**
 * 根据语言名称或别名获取语言配置
 */
export function getLanguageByName(name: string): LanguageConfig | undefined {
  const normalizedName = name.toLowerCase();

  if (SUPPORTED_LANGUAGES[normalizedName]) {
    return SUPPORTED_LANGUAGES[normalizedName];
  }

  for (const lang of Object.values(SUPPORTED_LANGUAGES)) {
    if (lang.aliases?.includes(normalizedName)) {
      return lang;
    }
  }

  return undefined;
}

/**
 * 检查语言是否支持
 */
export function isLanguageSupported(name: string): boolean {
  return getLanguageByName(name) !== undefined;
}

// ================================
// 默认导出
// ================================

import { LatexBlockScanner, createLatexBlockScanner } from './latex-block-scanner';

export default {
  LatexBlockScanner,
  createLatexBlockScanner,
  SUPPORTED_LANGUAGES,
  getLanguageByExtension,
  getLanguageByName,
  isLanguageSupported,
};
