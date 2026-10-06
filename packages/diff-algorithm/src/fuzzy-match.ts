// ================================
// Fuzzy Match - 模糊匹配算法实现
// 用于搜索功能、命令面板、文件查找等场景
// 支持子序列匹配、连续匹配加分、智能排序
// ================================

import type {
  MatchResult,
  SearchResultItem,
  MatchHighlight,
  FuzzyMatchConfig,
  FuzzySearchConfig,
  IFuzzyMatchAlgorithm,
} from './types';

// ================================
// 默认配置
// ================================

const DEFAULT_MATCH_CONFIG: Required<FuzzyMatchConfig> = {
  threshold: 0.3,
  caseSensitive: false,
  maxDistance: 1000,
  includeMatches: true,
  useTransliteration: false,
};

const DEFAULT_SEARCH_CONFIG = {
  ...DEFAULT_MATCH_CONFIG,
  keys: [] as string[],
  limit: 50,
  sortByScore: true,
};

// ================================
// 评分权重
// ================================

const SCORE_WEIGHTS = {
  /** 每个匹配字符的基础分（保证命中字符在扣除间隔惩罚后仍为正贡献） */
  CHAR_MATCH: 16,
  /** 连续匹配加分（按连续长度递增，最多累计 5 级） */
  CONSECUTIVE_BONUS: 15,
  /** 单词开头匹配加分 */
  WORD_START_BONUS: 30,
  /** 驼峰/数字边界后匹配加分 */
  CAMEL_CASE_BONUS: 25,
  /** 字符串开头匹配加分 */
  STRING_START_BONUS: 50,
  /** 间隔惩罚 */
  GAP_PENALTY: -3,
  /** 长间隔惩罚（间隔超过 4 个字符） */
  LONG_GAP_PENALTY: -5,
};

/** 包含匹配的分档：前缀 > 单词边界 > 后缀 > 词中 */
const CONTAINS_SCORES = {
  PREFIX: 0.95,
  WORD_BOUNDARY: 0.9,
  SUFFIX: 0.85,
  INNER: 0.8,
};

/** 子序列模糊匹配的分数上限，保证其排在任何包含匹配之后 */
const FUZZY_SCORE_CEILING = 0.8;

/** 长度平局裁决系数：同等匹配质量下，目标越短分数越高（最大影响 0.02） */
const LENGTH_TIEBREAK = 0.02;

// ================================
// FuzzyMatchEngine 类
// ================================

/**
 * 模糊匹配引擎
 *
 * 匹配分为三个层级（分数依次降低）：
 * 1. 完全匹配：分数 1
 * 2. 包含匹配：按出现位置分档（前缀 / 单词边界 / 后缀 / 词中），取最佳出现位置
 * 3. 子序列匹配：连续、单词边界、驼峰边界加分，间隔扣分，
 *    以「理想对齐分」归一化后映射到 [0, FUZZY_SCORE_CEILING]
 *
 * 所有层级都返回真实的高亮区间，供 search 结果与 highlight 使用
 *
 * @example
 * ```typescript
 * const engine = new FuzzyMatchEngine();
 *
 * // 匹配单个字符串
 * const result = engine.match('btn', 'Button.tsx');
 * console.log(result.matched); // true
 *
 * // 搜索列表
 * const results = engine.search('app', ['apple', 'application', 'banana']);
 *
 * // 高亮
 * const { html } = engine.highlight('btn', 'Button.tsx');
 * // '<mark>B</mark>u<mark>t</mark>to<mark>n</mark>.tsx'
 * ```
 */
export class FuzzyMatchEngine implements IFuzzyMatchAlgorithm {
  private readonly defaultConfig: Required<FuzzyMatchConfig>;

  constructor(config: FuzzyMatchConfig = {}) {
    this.defaultConfig = { ...DEFAULT_MATCH_CONFIG, ...config };
  }

  // ================================
  // 核心匹配算法
  // ================================

  /**
   * 匹配模式和文本
   *
   * 空模式视为匹配任意文本（与 search 的空查询语义一致）
   *
   * @param pattern 搜索模式
   * @param text 要搜索的文本
   * @param config 配置选项
   * @returns 匹配结果
   */
  match(pattern: string, text: string, config?: FuzzyMatchConfig): MatchResult {
    const startTime = performance.now();
    const cfg = { ...this.defaultConfig, ...config };
    const internal = this.computeMatch(pattern, text, cfg);
    const computeTimeMs = performance.now() - startTime;

    if (!internal) {
      return { matched: false, score: 0, position: -1, length: 0, computeTimeMs };
    }

    return {
      matched: true,
      score: internal.score,
      position: internal.position,
      length: internal.length,
      computeTimeMs,
    };
  }

  /**
   * 计算匹配（含高亮区间），不满足阈值时返回 null
   */
  private computeMatch(
    pattern: string,
    text: string,
    cfg: Required<FuzzyMatchConfig>
  ): InternalMatch | null {
    if (pattern.length === 0) {
      return { score: 1, position: 0, length: 0, highlights: [] };
    }
    if (text.length === 0 || pattern.length > text.length) {
      return null;
    }

    const p = cfg.caseSensitive ? pattern : pattern.toLowerCase();
    const t = cfg.caseSensitive ? text : text.toLowerCase();

    const internal =
      p === t
        ? { score: 1, position: 0, length: text.length, highlights: [{ start: 0, end: text.length }] }
        : (this.containsMatch(p, t, text) ?? this.subsequenceMatch(p, t, text));

    if (!internal || internal.score < cfg.threshold) {
      return null;
    }
    return internal;
  }

  /**
   * 包含匹配：遍历所有出现位置，取分档最高者
   */
  private containsMatch(pattern: string, text: string, originalText: string): InternalMatch | null {
    let bestPosition = -1;
    let bestTier = -1;

    for (let idx = text.indexOf(pattern); idx !== -1; idx = text.indexOf(pattern, idx + 1)) {
      const tier = this.containsTier(originalText, idx, pattern.length);
      if (tier > bestTier) {
        bestTier = tier;
        bestPosition = idx;
        // 前缀已是最高档，无需继续查找
        if (tier === CONTAINS_SCORES.PREFIX) break;
      }
    }

    if (bestPosition === -1) return null;

    return {
      score: bestTier - this.lengthPenalty(pattern.length, text.length),
      position: bestPosition,
      length: pattern.length,
      highlights: [{ start: bestPosition, end: bestPosition + pattern.length }],
    };
  }

  /**
   * 计算包含匹配在指定位置的分档
   */
  private containsTier(text: string, position: number, length: number): number {
    if (position === 0) return CONTAINS_SCORES.PREFIX;
    if (this.isWordBoundary(text, position) || this.isCamelCaseBoundary(text, position)) {
      return CONTAINS_SCORES.WORD_BOUNDARY;
    }
    if (position + length === text.length) return CONTAINS_SCORES.SUFFIX;
    return CONTAINS_SCORES.INNER;
  }

  /**
   * 子序列匹配（贪心前向扫描）
   */
  private subsequenceMatch(pattern: string, text: string, originalText: string): InternalMatch | null {
    const patternLen = pattern.length;
    const positions: number[] = [];
    let rawScore = 0;
    let lastMatchIdx = -1;
    let consecutiveCount = 0;

    for (let textIdx = 0; textIdx < text.length && positions.length < patternLen; textIdx++) {
      if (pattern[positions.length] !== text[textIdx]) continue;

      let charScore = SCORE_WEIGHTS.CHAR_MATCH;

      if (lastMatchIdx !== -1 && lastMatchIdx === textIdx - 1) {
        // 连续匹配加分
        consecutiveCount++;
        charScore += SCORE_WEIGHTS.CONSECUTIVE_BONUS * Math.min(consecutiveCount, 5);
      } else {
        consecutiveCount = 0;
        // 间隔惩罚
        if (lastMatchIdx !== -1) {
          const gap = textIdx - lastMatchIdx - 1;
          charScore += gap > 4 ? SCORE_WEIGHTS.LONG_GAP_PENALTY : SCORE_WEIGHTS.GAP_PENALTY;
        }
      }

      // 位置加分
      if (textIdx === 0) {
        charScore += SCORE_WEIGHTS.STRING_START_BONUS;
      } else if (this.isWordBoundary(originalText, textIdx)) {
        charScore += SCORE_WEIGHTS.WORD_START_BONUS;
      } else if (this.isCamelCaseBoundary(originalText, textIdx)) {
        charScore += SCORE_WEIGHTS.CAMEL_CASE_BONUS;
      }

      rawScore += charScore;
      positions.push(textIdx);
      lastMatchIdx = textIdx;
    }

    if (positions.length !== patternLen) return null;

    const ratio = Math.max(0, Math.min(1, rawScore / this.idealSubsequenceScore(patternLen)));
    return {
      score: ratio * FUZZY_SCORE_CEILING - this.lengthPenalty(patternLen, text.length),
      position: positions[0] ?? 0,
      length: patternLen,
      highlights: mergePositions(positions),
    };
  }

  /**
   * 理想对齐分：首字符落在单词开头，其余字符全部连续
   */
  private idealSubsequenceScore(patternLen: number): number {
    let ideal = SCORE_WEIGHTS.CHAR_MATCH + SCORE_WEIGHTS.WORD_START_BONUS;
    for (let k = 1; k < patternLen; k++) {
      ideal += SCORE_WEIGHTS.CHAR_MATCH + SCORE_WEIGHTS.CONSECUTIVE_BONUS * Math.min(k, 5);
    }
    return ideal;
  }

  /**
   * 长度平局裁决：未被匹配覆盖的比例越高扣分越多
   */
  private lengthPenalty(patternLen: number, textLen: number): number {
    return LENGTH_TIEBREAK * (1 - patternLen / textLen);
  }

  /**
   * 检查是否为单词边界
   */
  private isWordBoundary(text: string, index: number): boolean {
    if (index === 0) return true;
    return /[\s\-_./\\]/.test(text.charAt(index - 1));
  }

  /**
   * 检查是否为驼峰边界
   */
  private isCamelCaseBoundary(text: string, index: number): boolean {
    if (index === 0) return false;
    const prevChar = text.charAt(index - 1);
    const currChar = text.charAt(index);

    // 小写到大写的转换 (如 myFunction 中的 F)
    if (/[a-z]/.test(prevChar) && /[A-Z]/.test(currChar)) {
      return true;
    }

    // 数字到字母的转换
    return /[0-9]/.test(prevChar) && /[a-zA-Z]/.test(currChar);
  }

  // ================================
  // 搜索列表
  // ================================

  /**
   * 在列表中搜索
   *
   * @param pattern 搜索模式
   * @param items 候选项列表
   * @param config 配置选项
   * @returns 匹配结果列表
   */
  search<T>(
    pattern: string,
    items: readonly T[],
    config?: FuzzySearchConfig<T>
  ): SearchResultItem<T>[] {
    const cfg = { ...DEFAULT_SEARCH_CONFIG, ...config } as Required<FuzzySearchConfig<T>>;

    if (pattern.length === 0) {
      // 空模式返回所有项（按原顺序）
      return items.slice(0, cfg.limit).map((item) => ({
        item,
        score: 1,
      }));
    }

    const results: SearchResultItem<T>[] = [];

    for (const item of items) {
      const searchResult = this.searchItem(pattern, item, cfg);
      if (searchResult) {
        results.push(searchResult);
      }
    }

    // 排序
    if (cfg.sortByScore) {
      results.sort((a, b) => b.score - a.score);
    }

    // 限制结果数量
    return results.slice(0, cfg.limit);
  }

  /**
   * 搜索单个项目
   */
  private searchItem<T>(
    pattern: string,
    item: T,
    cfg: Required<FuzzySearchConfig<T>>
  ): SearchResultItem<T> | null {
    // 如果是字符串，直接匹配
    if (typeof item === 'string') {
      const internal = this.computeMatch(pattern, item, cfg);
      if (!internal) return null;
      return {
        item,
        score: internal.score,
        matches: cfg.includeMatches ? internal.highlights : undefined,
      };
    }

    // 如果是对象，搜索指定字段
    if (typeof item === 'object' && item !== null) {
      let best: InternalMatch | null = null;
      let bestField: string | undefined;

      const keys = cfg.keys.length > 0 ? cfg.keys : Object.keys(item as object);

      for (const key of keys) {
        const value = this.getNestedValue(item, key as string);
        if (typeof value !== 'string') continue;
        const internal = this.computeMatch(pattern, value, cfg);
        if (internal && (best === null || internal.score > best.score)) {
          best = internal;
          bestField = key as string;
        }
      }

      if (best) {
        return {
          item,
          score: best.score,
          matchedField: bestField,
          matches: cfg.includeMatches ? best.highlights : undefined,
        };
      }
    }

    return null;
  }

  /**
   * 获取嵌套对象的值
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split('.');
    let value: unknown = obj;

    for (const key of keys) {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== 'object') return undefined;
      value = (value as Record<string, unknown>)[key];
    }

    return value;
  }

  // ================================
  // 高亮
  // ================================

  /**
   * 计算模式在文本中的高亮区间并生成 HTML
   *
   * 不满足匹配条件时返回空区间与转义后的原文
   *
   * @param pattern 搜索模式
   * @param text 要高亮的文本
   * @param highlightTag 高亮标签
   * @param config 配置选项
   * @returns 高亮区间与 HTML
   */
  highlight(
    pattern: string,
    text: string,
    highlightTag: string = 'mark',
    config?: FuzzyMatchConfig
  ): HighlightResult {
    const cfg = { ...this.defaultConfig, ...config };
    const highlights = this.computeMatch(pattern, text, cfg)?.highlights ?? [];
    return { highlights, html: this.highlightHtml(text, highlights, highlightTag) };
  }

  /**
   * 高亮文本
   *
   * @param text 原始文本
   * @param highlights 高亮位置
   * @param highlightFn 高亮函数
   * @returns 高亮后的片段
   */
  highlightText<R>(
    text: string,
    highlights: readonly MatchHighlight[],
    highlightFn: (text: string, isHighlight: boolean) => R
  ): R[] {
    if (highlights.length === 0) {
      return [highlightFn(text, false)];
    }

    const result: R[] = [];
    let lastEnd = 0;

    for (const { start, end } of highlights) {
      if (start > lastEnd) {
        result.push(highlightFn(text.slice(lastEnd, start), false));
      }
      result.push(highlightFn(text.slice(start, end), true));
      lastEnd = end;
    }

    if (lastEnd < text.length) {
      result.push(highlightFn(text.slice(lastEnd), false));
    }

    return result;
  }

  /**
   * 高亮为 HTML
   *
   * @param text 原始文本
   * @param highlights 高亮位置
   * @param highlightTag 高亮标签
   * @returns HTML 字符串
   */
  highlightHtml(
    text: string,
    highlights: readonly MatchHighlight[],
    highlightTag: string = 'mark'
  ): string {
    return this.highlightText(text, highlights, (t, isHighlight) => {
      const escaped = t.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c] ?? c);
      return isHighlight ? `<${highlightTag}>${escaped}</${highlightTag}>` : escaped;
    }).join('');
  }
}

// ================================
// 内部类型与工具
// ================================

/** 内部匹配结果 */
interface InternalMatch {
  score: number;
  position: number;
  length: number;
  highlights: MatchHighlight[];
}

/** 高亮结果 */
export interface HighlightResult {
  /** 高亮区间（已合并相邻位置） */
  readonly highlights: readonly MatchHighlight[];
  /** 高亮后的 HTML（已转义） */
  readonly html: string;
}

/** HTML 转义表 */
const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * 将升序的命中位置合并为连续区间
 */
function mergePositions(positions: readonly number[]): MatchHighlight[] {
  const highlights: MatchHighlight[] = [];
  let start = -1;
  let end = -1;

  for (const pos of positions) {
    if (pos === end) {
      end = pos + 1;
      continue;
    }
    if (start !== -1) highlights.push({ start, end });
    start = pos;
    end = pos + 1;
  }

  if (start !== -1) highlights.push({ start, end });
  return highlights;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建模糊匹配引擎实例
 *
 * @param config 配置
 * @returns 模糊匹配引擎
 */
export function createFuzzyMatchEngine(config?: FuzzyMatchConfig): FuzzyMatchEngine {
  return new FuzzyMatchEngine(config);
}

/**
 * 创建针对文件搜索优化的引擎
 *
 * @returns 文件搜索引擎
 */
export function createFileSearchEngine(): FuzzyMatchEngine {
  return new FuzzyMatchEngine({
    caseSensitive: false,
    threshold: 0.2,
    includeMatches: true,
  });
}

/**
 * 创建针对命令面板优化的引擎
 *
 * @returns 命令搜索引擎
 */
export function createCommandSearchEngine(): FuzzyMatchEngine {
  return new FuzzyMatchEngine({
    caseSensitive: false,
    threshold: 0.3,
    includeMatches: true,
  });
}

// ================================
// 便捷函数
// ================================

// 默认实例（延迟初始化）
let defaultEngine: FuzzyMatchEngine | null = null;

/**
 * 获取默认引擎
 */
function getDefaultEngine(): FuzzyMatchEngine {
  if (!defaultEngine) {
    defaultEngine = new FuzzyMatchEngine();
  }
  return defaultEngine;
}

/**
 * 快速模糊匹配
 *
 * @param pattern 搜索模式
 * @param text 要搜索的文本
 * @returns 匹配结果
 */
export function quickFuzzyMatch(pattern: string, text: string): MatchResult {
  return getDefaultEngine().match(pattern, text);
}

/**
 * 快速模糊搜索
 *
 * @param pattern 搜索模式
 * @param items 候选项列表
 * @returns 匹配结果列表
 */
export function quickFuzzySearch<T>(
  pattern: string,
  items: readonly T[],
  config?: FuzzySearchConfig<T>
): SearchResultItem<T>[] {
  return getDefaultEngine().search(pattern, items, config);
}

/**
 * 快速搜索字符串列表
 *
 * @param pattern 搜索模式
 * @param items 字符串列表
 * @param limit 最大返回数量
 * @returns 匹配的字符串列表
 */
export function quickSearchStrings(
  pattern: string,
  items: readonly string[],
  limit: number = 50
): string[] {
  const results = getDefaultEngine().search(pattern, items, { limit });
  return results.map((r) => r.item as string);
}

/**
 * 快速高亮
 *
 * @param pattern 搜索模式
 * @param text 要高亮的文本
 * @returns HTML 字符串
 */
export function quickHighlight(pattern: string, text: string): string {
  return getDefaultEngine().highlight(pattern, text).html;
}

/**
 * 重置默认引擎
 */
export function resetDefaultFuzzyMatchEngine(): void {
  defaultEngine = null;
}

// ================================
// 导出
// ================================

export type { MatchResult, SearchResultItem, MatchHighlight, FuzzyMatchConfig, FuzzySearchConfig };
