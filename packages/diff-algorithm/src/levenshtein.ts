// ================================
// Levenshtein - 编辑距离算法实现
// 用于拼写检查、模糊匹配、相似度计算
// 高性能实现，支持多种优化策略
// ================================

import type {
  LevenshteinResult,
  LevenshteinConfig,
  EditStep,
  EditOperation,
  ILevenshteinAlgorithm,
} from './types';

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<LevenshteinConfig> = {
  caseSensitive: true,
  insertCost: 1,
  deleteCost: 1,
  substituteCost: 1,
  computeSteps: false,
  maxDistance: Infinity,
};

// ================================
// LevenshteinEngine 类
// ================================

/**
 * Levenshtein 编辑距离引擎
 *
 * 提供多种编辑距离计算方法：
 * - 标准 Levenshtein 距离
 * - Damerau-Levenshtein 距离（支持转置）
 * - 相似度计算
 * - 编辑步骤追踪
 *
 * 性能优化：
 * - 空间优化：O(min(m,n)) 空间复杂度
 * - 提前退出：支持最大距离限制
 * - 对角线优化：减少不必要的计算
 *
 * @example
 * ```typescript
 * const engine = new LevenshteinEngine();
 *
 * // 计算编辑距离
 * const result = engine.distance('kitten', 'sitting');
 * console.log(result.distance); // 3
 *
 * // 计算相似度
 * const similarity = engine.similarity('hello', 'hallo');
 * console.log(similarity); // 0.8
 *
 * // 查找最相似项
 * const words = ['cat', 'car', 'card', 'care'];
 * const closest = engine.findMostSimilar('cart', words, w => w);
 * console.log(closest); // 'cart' 或 'car'
 * ```
 */
export class LevenshteinEngine implements ILevenshteinAlgorithm {
  private readonly defaultConfig: Required<LevenshteinConfig>;

  constructor(config: LevenshteinConfig = {}) {
    this.defaultConfig = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 核心算法
  // ================================

  /**
   * 计算两个字符串之间的编辑距离
   *
   * 使用 Wagner-Fischer 算法的空间优化版本
   * 时间复杂度: O(m*n)
   * 空间复杂度: O(min(m,n))
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @param config 配置选项
   * @returns 编辑距离结果
   */
  distance(source: string, target: string, config?: LevenshteinConfig): LevenshteinResult {
    const startTime = performance.now();
    const cfg = { ...this.defaultConfig, ...config };

    // 预处理：大小写处理
    let s = source;
    let t = target;
    if (!cfg.caseSensitive) {
      s = s.toLowerCase();
      t = t.toLowerCase();
    }

    const m = s.length;
    const n = t.length;

    // 需要编辑步骤时必须走完整矩阵版本：
    // 边界快速路径不产生 steps，若放在其后会导致相同串 / 空串时 steps 缺失
    if (cfg.computeSteps) {
      return this.distanceWithSteps(s, t, cfg, startTime);
    }

    // 边界情况
    if (m === 0) {
      const endTime = performance.now();
      return this.createResult(n * cfg.insertCost, m, n, endTime - startTime);
    }
    if (n === 0) {
      const endTime = performance.now();
      return this.createResult(m * cfg.deleteCost, m, n, endTime - startTime);
    }
    if (s === t) {
      const endTime = performance.now();
      return this.createResult(0, m, n, endTime - startTime);
    }

    // 空间优化版本：只保留两行
    const dist = this.computeDistanceOptimized(s, t, cfg);

    const endTime = performance.now();
    return this.createResult(dist, m, n, endTime - startTime);
  }

  /**
   * 空间优化的距离计算
   */
  private computeDistanceOptimized(
    s: string,
    t: string,
    cfg: Required<LevenshteinConfig>
  ): number {
    const m = s.length;
    const n = t.length;

    // 确保 s 是较短的字符串，减少空间使用
    if (m > n) {
      return this.computeDistanceOptimized(t, s, {
        ...cfg,
        insertCost: cfg.deleteCost,
        deleteCost: cfg.insertCost,
      });
    }

    // 使用两行而不是完整矩阵
    let prevRow = new Array<number>(m + 1);
    let currRow = new Array<number>(m + 1);

    // 初始化第一行
    for (let i = 0; i <= m; i++) {
      prevRow[i] = i * cfg.deleteCost;
    }

    // 填充矩阵
    for (let j = 1; j <= n; j++) {
      currRow[0] = j * cfg.insertCost;

      // 提前退出检查
      let minInRow = currRow[0];

      for (let i = 1; i <= m; i++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : cfg.substituteCost;

        currRow[i] = Math.min(
          prevRow[i] + cfg.insertCost, // 插入
          currRow[i - 1] + cfg.deleteCost, // 删除
          prevRow[i - 1] + cost // 替换或匹配
        );

        minInRow = Math.min(minInRow, currRow[i]);
      }

      // 如果当前行最小值已超过最大距离，提前退出
      if (cfg.maxDistance !== Infinity && minInRow > cfg.maxDistance) {
        return cfg.maxDistance + 1;
      }

      // 交换行
      [prevRow, currRow] = [currRow, prevRow];
    }

    return prevRow[m];
  }

  /**
   * 计算距离并追踪编辑步骤
   */
  private distanceWithSteps(
    s: string,
    t: string,
    cfg: Required<LevenshteinConfig>,
    startTime: number
  ): LevenshteinResult {
    const m = s.length;
    const n = t.length;

    // 完整矩阵用于回溯
    const matrix: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1));

    // 初始化
    for (let i = 0; i <= m; i++) {
      matrix[i][0] = i * cfg.deleteCost;
    }
    for (let j = 0; j <= n; j++) {
      matrix[0][j] = j * cfg.insertCost;
    }

    // 填充矩阵
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : cfg.substituteCost;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + cfg.deleteCost,
          matrix[i][j - 1] + cfg.insertCost,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    // 回溯获取编辑步骤
    const steps = this.backtrackSteps(matrix, s, t, cfg);

    const endTime = performance.now();
    return {
      distance: matrix[m][n],
      similarity: this.calculateSimilarity(matrix[m][n], m, n),
      sourceLength: m,
      targetLength: n,
      computeTimeMs: endTime - startTime,
      steps,
    };
  }

  /**
   * 回溯获取编辑步骤
   */
  private backtrackSteps(
    matrix: number[][],
    s: string,
    t: string,
    cfg: Required<LevenshteinConfig>
  ): EditStep[] {
    const steps: EditStep[] = [];
    let i = s.length;
    let j = t.length;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && s[i - 1] === t[j - 1]) {
        // 匹配
        steps.unshift({
          operation: 'match',
          sourceIndex: i - 1,
          targetIndex: j - 1,
          char: s[i - 1],
        });
        i--;
        j--;
      } else if (i > 0 && j > 0 && matrix[i][j] === matrix[i - 1][j - 1] + cfg.substituteCost) {
        // 替换
        steps.unshift({
          operation: 'substitute',
          sourceIndex: i - 1,
          targetIndex: j - 1,
          char: t[j - 1],
          originalChar: s[i - 1],
        });
        i--;
        j--;
      } else if (j > 0 && matrix[i][j] === matrix[i][j - 1] + cfg.insertCost) {
        // 插入
        steps.unshift({
          operation: 'insert',
          sourceIndex: i,
          targetIndex: j - 1,
          char: t[j - 1],
        });
        j--;
      } else if (i > 0) {
        // 删除
        steps.unshift({
          operation: 'delete',
          sourceIndex: i - 1,
          targetIndex: j,
          char: s[i - 1],
        });
        i--;
      }
    }

    return steps;
  }

  /**
   * 创建结果对象
   */
  private createResult(
    distance: number,
    sourceLength: number,
    targetLength: number,
    computeTimeMs: number
  ): LevenshteinResult {
    return {
      distance,
      similarity: this.calculateSimilarity(distance, sourceLength, targetLength),
      sourceLength,
      targetLength,
      computeTimeMs,
    };
  }

  /**
   * 计算相似度
   */
  private calculateSimilarity(distance: number, m: number, n: number): number {
    const maxLen = Math.max(m, n);
    if (maxLen === 0) return 1;
    return 1 - distance / maxLen;
  }

  // ================================
  // 便捷方法
  // ================================

  /**
   * 计算两个字符串的相似度 (0-1)
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @param config 配置选项
   * @returns 相似度 (0-1)
   */
  similarity(source: string, target: string, config?: LevenshteinConfig): number {
    return this.distance(source, target, config).similarity;
  }

  /**
   * 从列表中查找最相似的项
   *
   * @param query 查询字符串
   * @param items 候选项列表
   * @param getKey 获取比较键的函数
   * @param config 配置选项
   * @returns 最相似的项，如果列表为空则返回 null
   */
  findMostSimilar<T>(
    query: string,
    items: readonly T[],
    getKey: (item: T) => string,
    config?: LevenshteinConfig
  ): T | null {
    if (items.length === 0) return null;

    let bestItem: T = items[0];
    let bestDistance = Infinity;

    for (const item of items) {
      const key = getKey(item);
      const result = this.distance(query, key, config);

      if (result.distance < bestDistance) {
        bestDistance = result.distance;
        bestItem = item;

        // 完全匹配，直接返回
        if (bestDistance === 0) break;
      }
    }

    return bestItem;
  }

  /**
   * 查找所有相似项（按相似度排序）
   *
   * @param query 查询字符串
   * @param items 候选项列表
   * @param getKey 获取比较键的函数
   * @param threshold 相似度阈值 (0-1)
   * @param config 配置选项
   * @returns 相似项列表（按相似度降序）
   */
  findSimilar<T>(
    query: string,
    items: readonly T[],
    getKey: (item: T) => string,
    threshold: number = 0.5,
    config?: LevenshteinConfig
  ): SimilarItem<T>[] {
    const results: SimilarItem<T>[] = [];

    for (const item of items) {
      const key = getKey(item);
      const result = this.distance(query, key, config);

      if (result.similarity >= threshold) {
        results.push({
          item,
          key,
          distance: result.distance,
          similarity: result.similarity,
        });
      }
    }

    // 按相似度降序排序
    results.sort((a, b) => b.similarity - a.similarity);

    return results;
  }

  /**
   * 检查两个字符串是否在编辑距离阈值内
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @param maxDistance 最大距离阈值
   * @param config 配置选项
   * @returns 是否在阈值内
   */
  isWithinDistance(
    source: string,
    target: string,
    maxDistance: number,
    config?: LevenshteinConfig
  ): boolean {
    const result = this.distance(source, target, {
      ...config,
      maxDistance,
    });
    return result.distance <= maxDistance;
  }

  // ================================
  // Damerau-Levenshtein 距离
  // ================================

  /**
   * 计算 Damerau-Levenshtein 距离
   *
   * 除了插入、删除、替换外，还支持相邻字符转置操作
   * 更适合检测拼写错误（如 "teh" -> "the"）
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @param config 配置选项
   * @returns 编辑距离结果
   */
  damerauDistance(source: string, target: string, config?: LevenshteinConfig): LevenshteinResult {
    const startTime = performance.now();
    const cfg = { ...this.defaultConfig, ...config };

    let s = source;
    let t = target;
    if (!cfg.caseSensitive) {
      s = s.toLowerCase();
      t = t.toLowerCase();
    }

    const m = s.length;
    const n = t.length;

    if (m === 0) {
      const endTime = performance.now();
      return this.createResult(n * cfg.insertCost, m, n, endTime - startTime);
    }
    if (n === 0) {
      const endTime = performance.now();
      return this.createResult(m * cfg.deleteCost, m, n, endTime - startTime);
    }
    if (s === t) {
      const endTime = performance.now();
      return this.createResult(0, m, n, endTime - startTime);
    }

    // 使用完整矩阵以支持转置操作
    const matrix: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1));

    for (let i = 0; i <= m; i++) matrix[i][0] = i * cfg.deleteCost;
    for (let j = 0; j <= n; j++) matrix[0][j] = j * cfg.insertCost;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : cfg.substituteCost;

        matrix[i][j] = Math.min(
          matrix[i - 1][j] + cfg.deleteCost,
          matrix[i][j - 1] + cfg.insertCost,
          matrix[i - 1][j - 1] + cost
        );

        // 转置操作
        if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
          matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cfg.substituteCost);
        }
      }
    }

    const endTime = performance.now();
    return this.createResult(matrix[m][n], m, n, endTime - startTime);
  }

  // ================================
  // 拼写检查辅助
  // ================================

  /**
   * 生成拼写建议
   *
   * @param word 拼写错误的单词
   * @param dictionary 词典
   * @param maxSuggestions 最大建议数
   * @param maxDistance 最大编辑距离
   * @returns 拼写建议列表
   */
  suggestSpelling(
    word: string,
    dictionary: readonly string[],
    maxSuggestions: number = 5,
    maxDistance: number = 2
  ): SpellingSuggestion[] {
    const suggestions: SpellingSuggestion[] = [];

    for (const dictWord of dictionary) {
      const result = this.damerauDistance(word, dictWord, { maxDistance });

      if (result.distance <= maxDistance) {
        suggestions.push({
          word: dictWord,
          distance: result.distance,
          similarity: result.similarity,
        });
      }
    }

    // 按距离升序、相似度降序排序
    suggestions.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.similarity - a.similarity;
    });

    return suggestions.slice(0, maxSuggestions);
  }

  /**
   * 检查单词是否拼写正确
   *
   * @param word 要检查的单词
   * @param dictionary 词典
   * @returns 是否正确
   */
  isCorrectSpelling(word: string, dictionary: readonly string[]): boolean {
    const normalizedWord = word.toLowerCase();
    return dictionary.some((w) => w.toLowerCase() === normalizedWord);
  }
}

// ================================
// 类型定义
// ================================

/**
 * 相似项结果
 */
export interface SimilarItem<T> {
  /** 原始项 */
  readonly item: T;
  /** 比较键 */
  readonly key: string;
  /** 编辑距离 */
  readonly distance: number;
  /** 相似度 (0-1) */
  readonly similarity: number;
}

/**
 * 拼写建议
 */
export interface SpellingSuggestion {
  /** 建议的单词 */
  readonly word: string;
  /** 编辑距离 */
  readonly distance: number;
  /** 相似度 (0-1) */
  readonly similarity: number;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Levenshtein 引擎实例
 *
 * @param config 配置
 * @returns Levenshtein 引擎
 */
export function createLevenshteinEngine(config?: LevenshteinConfig): LevenshteinEngine {
  return new LevenshteinEngine(config);
}

// ================================
// 便捷函数
// ================================

// 默认实例（延迟初始化）
let defaultEngine: LevenshteinEngine | null = null;

/**
 * 获取默认引擎
 */
function getDefaultEngine(): LevenshteinEngine {
  if (!defaultEngine) {
    defaultEngine = new LevenshteinEngine();
  }
  return defaultEngine;
}

/**
 * 快速计算编辑距离
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @returns 编辑距离
 */
export function quickLevenshteinDistance(source: string, target: string): number {
  return getDefaultEngine().distance(source, target).distance;
}

/**
 * 快速计算相似度
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @returns 相似度 (0-1)
 */
export function quickSimilarity(source: string, target: string): number {
  return getDefaultEngine().similarity(source, target);
}

/**
 * 快速查找最相似项
 *
 * @param query 查询字符串
 * @param items 候选项列表
 * @returns 最相似的项
 */
export function quickFindMostSimilar(query: string, items: readonly string[]): string | null {
  return getDefaultEngine().findMostSimilar(query, items, (s) => s);
}

/**
 * 快速生成拼写建议
 *
 * @param word 拼写错误的单词
 * @param dictionary 词典
 * @param maxSuggestions 最大建议数
 * @returns 拼写建议列表
 */
export function quickSpellingSuggestions(
  word: string,
  dictionary: readonly string[],
  maxSuggestions?: number
): SpellingSuggestion[] {
  return getDefaultEngine().suggestSpelling(word, dictionary, maxSuggestions);
}

/**
 * 重置默认引擎
 */
export function resetDefaultLevenshteinEngine(): void {
  defaultEngine = null;
}

// ================================
// 导出
// ================================

export type { LevenshteinResult, LevenshteinConfig, EditStep, EditOperation };
