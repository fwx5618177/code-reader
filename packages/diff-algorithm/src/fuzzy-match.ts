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
  /** 连续匹配加分 */
  CONSECUTIVE_BONUS: 15,
  /** 单词开头匹配加分 */
  WORD_START_BONUS: 30,
  /** 驼峰/下划线后匹配加分 */
  CAMEL_CASE_BONUS: 25,
  /** 字符串开头匹配加分 */
  STRING_START_BONUS: 50,
  /** 完全匹配加分 */
  EXACT_MATCH_BONUS: 100,
  /** 未匹配字符惩罚 */
  UNMATCHED_PENALTY: -1,
  /** 间隔惩罚 */
  GAP_PENALTY: -3,
  /** 长间隔惩罚 */
  LONG_GAP_PENALTY: -5,
};

// ================================
// FuzzyMatchEngine 类
// ================================

/**
 * 模糊匹配引擎
 *
 * 实现智能模糊匹配算法，特点：
 * - 子序列匹配（不要求连续）
 * - 连续匹配加分
 * - 单词边界识别
 * - 驼峰命名支持
 * - 高亮位置返回
 *
 * @example
 * ```typescript
 * const engine = new FuzzyMatchEngine();
 *
 * // 匹配单个字符串
 * const result = engine.match('abc', 'abracadabra');
 * console.log(result.matched); // true
 * console.log(result.score);   // 0.xxx
 *
 * // 搜索列表
 * const items = ['apple', 'application', 'apply', 'banana'];
 * const results = engine.search('app', items);
 * // 返回按分数排序的匹配结果
 *
 * // 搜索对象列表
 * const files = [
 *   { name: 'index.ts', path: '/src/index.ts' },
 *   { name: 'app.tsx', path: '/src/app.tsx' },
 * ];
 * const fileResults = engine.search('idx', files, {
 *   keys: ['name', 'path']
 * });
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
   * @param pattern 搜索模式
   * @param text 要搜索的文本
   * @param config 配置选项
   * @returns 匹配结果
   */
  match(pattern: string, text: string, config?: FuzzyMatchConfig): MatchResult {
    const startTime = performance.now();
    const cfg = { ...this.defaultConfig, ...config };

    // 处理空模式
    if (pattern.length === 0) {
      return this.createNoMatchResult(startTime);
    }

    // 处理空文本
    if (text.length === 0) {
      return this.createNoMatchResult(startTime);
    }

    // 预处理
    let p = pattern;
    let t = text;
    if (!cfg.caseSensitive) {
      p = p.toLowerCase();
      t = t.toLowerCase();
    }

    // 检查是否完全匹配
    if (p === t) {
      return this.createExactMatchResult(text, startTime, cfg);
    }

    // 检查是否包含匹配
    const containsIndex = t.indexOf(p);
    if (containsIndex !== -1) {
      return this.createContainsMatchResult(text, containsIndex, p.length, startTime, cfg);
    }

    // 模糊匹配
    return this.fuzzyMatch(p, t, text, startTime, cfg);
  }

  /**
   * 核心模糊匹配算法
   */
  private fuzzyMatch(
    pattern: string,
    text: string,
    originalText: string,
    startTime: number,
    cfg: Required<FuzzyMatchConfig>
  ): MatchResult {
    const patternLen = pattern.length;
    const textLen = text.length;

    // 快速检查：模式长度不能超过文本长度
    if (patternLen > textLen) {
      return this.createNoMatchResult(startTime);
    }

    // 使用动态规划找到最佳匹配
    const result = this.findBestMatch(pattern, text, originalText, cfg);

    if (!result.matched) {
      return this.createNoMatchResult(startTime);
    }

    const endTime = performance.now();

    // 计算归一化分数 (0-1)
    const maxScore =
      patternLen * (SCORE_WEIGHTS.STRING_START_BONUS + SCORE_WEIGHTS.CONSECUTIVE_BONUS);
    const normalizedScore = Math.max(0, Math.min(1, result.score / maxScore));

    // 检查是否达到阈值
    if (normalizedScore < cfg.threshold) {
      return this.createNoMatchResult(startTime);
    }

    return {
      matched: true,
      score: normalizedScore,
      position: result.matches.length > 0 ? result.matches[0].start : 0,
      length: patternLen,
      computeTimeMs: endTime - startTime,
    };
  }

  /**
   * 使用贪心算法找到最佳匹配
   */
  private findBestMatch(
    pattern: string,
    text: string,
    originalText: string,
    cfg: Required<FuzzyMatchConfig>
  ): FuzzyMatchInternalResult {
    const patternLen = pattern.length;
    const textLen = text.length;

    let patternIdx = 0;
    let score = 0;
    let lastMatchIdx = -1;
    let consecutiveCount = 0;
    const matches: MatchHighlight[] = [];
    let currentMatchStart = -1;

    for (let textIdx = 0; textIdx < textLen && patternIdx < patternLen; textIdx++) {
      if (pattern[patternIdx] === text[textIdx]) {
        // 匹配成功
        let charScore = 1;

        // 连续匹配加分
        if (lastMatchIdx === textIdx - 1) {
          consecutiveCount++;
          charScore += SCORE_WEIGHTS.CONSECUTIVE_BONUS * Math.min(consecutiveCount, 5);

          // 扩展当前匹配区域
          if (currentMatchStart === -1) {
            currentMatchStart = textIdx - 1;
          }
        } else {
          // 新的匹配序列
          if (currentMatchStart !== -1 && cfg.includeMatches) {
            matches.push({ start: currentMatchStart, end: lastMatchIdx + 1 });
          }
          currentMatchStart = textIdx;
          consecutiveCount = 0;

          // 间隔惩罚
          if (lastMatchIdx !== -1) {
            const gap = textIdx - lastMatchIdx - 1;
            if (gap > 4) {
              charScore += SCORE_WEIGHTS.LONG_GAP_PENALTY;
            } else if (gap > 0) {
              charScore += SCORE_WEIGHTS.GAP_PENALTY;
            }
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

        score += charScore;
        lastMatchIdx = textIdx;
        patternIdx++;
      }
    }

    // 添加最后一个匹配区域
    if (currentMatchStart !== -1 && cfg.includeMatches) {
      matches.push({ start: currentMatchStart, end: lastMatchIdx + 1 });
    }

    // 检查是否完全匹配模式
    if (patternIdx !== patternLen) {
      return { matched: false, score: 0, matches: [] };
    }

    // 未匹配字符惩罚
    const unmatchedChars = textLen - patternLen;
    score += unmatchedChars * SCORE_WEIGHTS.UNMATCHED_PENALTY;

    return { matched: true, score, matches };
  }

  /**
   * 检查是否为单词边界
   */
  private isWordBoundary(text: string, index: number): boolean {
    if (index === 0) return true;
    const prevChar = text[index - 1];
    return /[\s\-_./\\]/.test(prevChar);
  }

  /**
   * 检查是否为驼峰边界
   */
  private isCamelCaseBoundary(text: string, index: number): boolean {
    if (index === 0) return false;
    const prevChar = text[index - 1];
    const currChar = text[index];

    // 小写到大写的转换 (如 myFunction 中的 F)
    if (/[a-z]/.test(prevChar) && /[A-Z]/.test(currChar)) {
      return true;
    }

    // 数字到字母的转换
    if (/[0-9]/.test(prevChar) && /[a-zA-Z]/.test(currChar)) {
      return true;
    }

    return false;
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
      const result = this.match(pattern, item, cfg);
      if (result.matched) {
        return {
          item,
          score: result.score,
          matches: cfg.includeMatches ? this.getMatchHighlights(pattern, item, cfg) : undefined,
        };
      }
      return null;
    }

    // 如果是对象，搜索指定字段
    if (typeof item === 'object' && item !== null) {
      let bestScore = 0;
      let bestField: string | undefined;
      let bestMatches: MatchHighlight[] | undefined;

      const keys = cfg.keys.length > 0 ? cfg.keys : Object.keys(item as object);

      for (const key of keys) {
        const value = this.getNestedValue(item, key as string);
        if (typeof value === 'string') {
          const result = this.match(pattern, value, cfg);
          if (result.matched && result.score > bestScore) {
            bestScore = result.score;
            bestField = key as string;
            if (cfg.includeMatches) {
              bestMatches = this.getMatchHighlights(pattern, value, cfg);
            }
          }
        }
      }

      if (bestScore > 0) {
        return {
          item,
          score: bestScore,
          matchedField: bestField,
          matches: bestMatches,
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

  /**
   * 获取匹配高亮位置
   */
  private getMatchHighlights(
    pattern: string,
    text: string,
    cfg: Required<FuzzyMatchConfig>
  ): MatchHighlight[] {
    let p = pattern;
    let t = text;
    if (!cfg.caseSensitive) {
      p = p.toLowerCase();
      t = t.toLowerCase();
    }

    const highlights: MatchHighlight[] = [];
    let patternIdx = 0;
    let currentStart = -1;
    let currentEnd = -1;

    for (let i = 0; i < t.length && patternIdx < p.length; i++) {
      if (t[i] === p[patternIdx]) {
        if (currentStart === -1) {
          currentStart = i;
          currentEnd = i + 1;
        } else if (i === currentEnd) {
          currentEnd = i + 1;
        } else {
          highlights.push({ start: currentStart, end: currentEnd });
          currentStart = i;
          currentEnd = i + 1;
        }
        patternIdx++;
      }
    }

    if (currentStart !== -1) {
      highlights.push({ start: currentStart, end: currentEnd });
    }

    return highlights;
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 创建无匹配结果
   */
  private createNoMatchResult(startTime: number): MatchResult {
    return {
      matched: false,
      score: 0,
      position: -1,
      length: 0,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * 创建完全匹配结果
   */
  private createExactMatchResult(
    text: string,
    startTime: number,
    _cfg: Required<FuzzyMatchConfig>
  ): MatchResult {
    return {
      matched: true,
      score: 1,
      position: 0,
      length: text.length,
      computeTimeMs: performance.now() - startTime,
    };
  }

  /**
   * 创建包含匹配结果
   */
  private createContainsMatchResult(
    text: string,
    position: number,
    length: number,
    startTime: number,
    _cfg: Required<FuzzyMatchConfig>
  ): MatchResult {
    // 包含匹配的分数，考虑位置
    let score = 0.8;
    if (position === 0) {
      score = 0.95; // 前缀匹配更高分
    } else if (position + length === text.length) {
      score = 0.85; // 后缀匹配
    }

    return {
      matched: true,
      score,
      position,
      length,
      computeTimeMs: performance.now() - startTime,
    };
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
      const escaped = t.replace(/[&<>"']/g, (c) => {
        const map: Record<string, string> = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        };
        return map[c] || c;
      });
      return isHighlight ? `<${highlightTag}>${escaped}</${highlightTag}>` : escaped;
    }).join('');
  }
}

// ================================
// 内部类型
// ================================

interface FuzzyMatchInternalResult {
  matched: boolean;
  score: number;
  matches: MatchHighlight[];
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
  // 获取默认引擎（用于确保引擎已初始化）
  getDefaultEngine();

  let p = pattern.toLowerCase();
  let t = text.toLowerCase();

  const highlights: MatchHighlight[] = [];
  let patternIdx = 0;
  let currentStart = -1;
  let currentEnd = -1;

  for (let i = 0; i < t.length && patternIdx < p.length; i++) {
    if (t[i] === p[patternIdx]) {
      if (currentStart === -1) {
        currentStart = i;
        currentEnd = i + 1;
      } else if (i === currentEnd) {
        currentEnd = i + 1;
      } else {
        highlights.push({ start: currentStart, end: currentEnd });
        currentStart = i;
        currentEnd = i + 1;
      }
      patternIdx++;
    }
  }

  if (currentStart !== -1) {
    highlights.push({ start: currentStart, end: currentEnd });
  }

  const engine = getDefaultEngine();
  return engine.highlightHtml(text, highlights);
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
