// ================================
// Fuzzy Score 模糊评分算法
// 用于模糊匹配和智能排序
// 支持多种评分策略
// ================================

// ================================
// 类型定义
// ================================

/**
 * 匹配结果
 */
export interface FuzzyMatch {
  /** 是否匹配成功 */
  matched: boolean;
  /** 匹配分数（0-100） */
  score: number;
  /** 匹配位置索引 */
  positions: number[];
}

/**
 * 评分选项
 */
export interface FuzzyScoreOptions {
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 连续匹配奖励 */
  consecutiveBonus?: number;
  /** 首字符匹配奖励 */
  startBonus?: number;
  /** 驼峰/下划线边界匹配奖励 */
  boundaryBonus?: number;
  /** 不匹配惩罚 */
  mismatchPenalty?: number;
  /** 间隔惩罚（匹配字符之间的距离） */
  gapPenalty?: number;
  /** 基础匹配分数 */
  baseMatchScore?: number;
}

/**
 * 批量匹配结果
 */
export interface FuzzyBatchResult<T> {
  /** 原始项目 */
  item: T;
  /** 匹配分数 */
  score: number;
  /** 匹配位置 */
  positions: number[];
  /** 用于匹配的文本 */
  text: string;
}

// ================================
// 默认配置
// ================================

const DEFAULT_OPTIONS: Required<FuzzyScoreOptions> = {
  caseSensitive: false,
  consecutiveBonus: 15,
  startBonus: 25,
  boundaryBonus: 20,
  mismatchPenalty: 0,
  gapPenalty: 3,
  baseMatchScore: 10,
};

// ================================
// 辅助函数
// ================================

/**
 * 检查字符是否为分隔符（空白、下划线、连字符、点、路径分隔符）
 */
function isSeparator(char: string): boolean {
  return /[\s_\-./\\]/.test(char);
}

/**
 * 检查字符是否为单词边界
 * 包括：分隔符之后（空白、下划线、连字符、点、路径分隔符）、驼峰边界、数字与字母交界
 */
function isBoundaryChar(text: string, index: number): boolean {
  if (index === 0) return true;

  const char = text[index];
  const prevChar = text[index - 1];

  // 分隔符之后
  if (isSeparator(prevChar)) return true;

  // 驼峰边界：前一个小写，当前大写
  if (/[a-z]/.test(prevChar) && /[A-Z]/.test(char)) return true;

  // 数字与字母交界
  if (/\d/.test(prevChar) !== /\d/.test(char)) return true;

  return false;
}

// ================================
// 核心算法实现
// ================================

/**
 * 计算模糊匹配分数
 * 使用贪心算法匹配模式字符
 *
 * @param pattern 搜索模式
 * @param text 目标文本
 * @param options 评分选项
 * @returns 匹配结果
 *
 * @example
 * ```ts
 * fuzzyScore('abc', 'abracadabra'); // { matched: true, score: 75, positions: [0, 1, 4] }
 * fuzzyScore('xyz', 'hello');       // { matched: false, score: 0, positions: [] }
 * ```
 */
export function fuzzyScore(
  pattern: string,
  text: string,
  options?: FuzzyScoreOptions
): FuzzyMatch {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 空模式总是匹配
  if (pattern.length === 0) {
    return { matched: true, score: 100, positions: [] };
  }

  // 文本太短
  if (text.length === 0 || pattern.length > text.length) {
    return { matched: false, score: 0, positions: [] };
  }

  // 处理大小写
  const patternNorm = opts.caseSensitive ? pattern : pattern.toLowerCase();
  const textNorm = opts.caseSensitive ? text : text.toLowerCase();

  // 快速检查：模式中所有字符是否都在文本中
  for (const char of patternNorm) {
    if (!textNorm.includes(char)) {
      return { matched: false, score: 0, positions: [] };
    }
  }

  // 使用递归搜索找到最佳匹配
  const result = findBestMatch(patternNorm, textNorm, text, 0, 0, [], opts);

  if (!result.matched) {
    return { matched: false, score: 0, positions: [] };
  }

  // 归一化分数到 0-100
  const maxPossibleScore = calculateMaxScore(pattern.length, opts);
  const normalizedScore = Math.min(100, Math.round((result.score / maxPossibleScore) * 100));

  return {
    matched: true,
    score: normalizedScore,
    positions: result.positions,
  };
}

/**
 * 递归查找最佳匹配
 */
function findBestMatch(
  pattern: string,
  textNorm: string,
  textOriginal: string,
  patternIndex: number,
  textIndex: number,
  currentPositions: number[],
  opts: Required<FuzzyScoreOptions>
): { matched: boolean; score: number; positions: number[] } {
  // 模式已完全匹配
  if (patternIndex === pattern.length) {
    const score = calculateMatchScore(currentPositions, textOriginal, opts);
    return { matched: true, score, positions: [...currentPositions] };
  }

  // 文本已遍历完但模式未完成
  if (textIndex >= textNorm.length) {
    return { matched: false, score: 0, positions: [] };
  }

  const patternChar = pattern[patternIndex];
  let bestResult: { matched: boolean; score: number; positions: number[] } = {
    matched: false,
    score: 0,
    positions: [],
  };

  // 在文本中查找下一个匹配字符
  for (let i = textIndex; i < textNorm.length; i++) {
    if (textNorm[i] === patternChar) {
      // 找到匹配，递归查找剩余部分
      const newPositions = [...currentPositions, i];
      const result = findBestMatch(pattern, textNorm, textOriginal, patternIndex + 1, i + 1, newPositions, opts);

      if (result.matched && result.score > bestResult.score) {
        bestResult = result;
      }

      // 优化：如果找到边界匹配，可以提前停止搜索
      if (isBoundaryChar(textOriginal, i) && result.matched) {
        break;
      }
    }
  }

  return bestResult;
}

/**
 * 计算匹配分数
 */
function calculateMatchScore(
  positions: number[],
  text: string,
  opts: Required<FuzzyScoreOptions>
): number {
  if (positions.length === 0) return 0;

  let score = 0;
  let consecutiveCount = 0;

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];

    // 基础匹配分数
    score += opts.baseMatchScore;

    // 首字符奖励
    if (pos === 0) {
      score += opts.startBonus;
    }

    // 边界匹配奖励
    if (isBoundaryChar(text, pos)) {
      score += opts.boundaryBonus;
    }

    // 连续匹配奖励
    if (i > 0) {
      const prevPos = positions[i - 1];
      if (pos === prevPos + 1) {
        consecutiveCount++;
        score += opts.consecutiveBonus * consecutiveCount;
      } else {
        consecutiveCount = 0;
        // 间隔惩罚
        const gap = pos - prevPos - 1;
        score -= Math.min(gap * opts.gapPenalty, opts.baseMatchScore);
      }
    }
  }

  // 长度比例奖励（匹配字符占总长度的比例）
  const lengthRatio = positions.length / text.length;
  score += lengthRatio * 20;

  return Math.max(0, score);
}

/**
 * 计算理论最高分
 */
function calculateMaxScore(patternLength: number, opts: Required<FuzzyScoreOptions>): number {
  if (patternLength === 0) return 1;

  let maxScore = 0;

  // 每个字符的基础分
  maxScore += patternLength * opts.baseMatchScore;

  // 首字符奖励
  maxScore += opts.startBonus;

  // 假设所有字符都在边界
  maxScore += patternLength * opts.boundaryBonus;

  // 假设所有字符连续
  for (let i = 1; i < patternLength; i++) {
    maxScore += opts.consecutiveBonus * i;
  }

  // 长度比例奖励
  maxScore += 20;

  return maxScore;
}

/**
 * 简化版模糊匹配
 * 只检查是否匹配，不计算详细分数
 *
 * @param pattern 搜索模式
 * @param text 目标文本
 * @param caseSensitive 是否区分大小写
 * @returns 是否匹配
 */
export function fuzzyMatch(
  pattern: string,
  text: string,
  caseSensitive = false
): boolean {
  if (pattern.length === 0) return true;
  if (text.length === 0 || pattern.length > text.length) return false;

  const p = caseSensitive ? pattern : pattern.toLowerCase();
  const t = caseSensitive ? text : text.toLowerCase();

  let patternIdx = 0;
  for (let i = 0; i < t.length && patternIdx < p.length; i++) {
    if (t[i] === p[patternIdx]) {
      patternIdx++;
    }
  }

  return patternIdx === p.length;
}

/**
 * 快速模糊评分
 * 使用简化算法，性能更好但精度略低
 *
 * @param pattern 搜索模式
 * @param text 目标文本
 * @param caseSensitive 是否区分大小写
 * @returns 分数（0-100）
 */
export function quickFuzzyScore(
  pattern: string,
  text: string,
  caseSensitive = false
): number {
  if (pattern.length === 0) return 100;
  if (text.length === 0) return 0;

  const p = caseSensitive ? pattern : pattern.toLowerCase();
  const t = caseSensitive ? text : text.toLowerCase();

  let patternIdx = 0;
  let consecutiveBonus = 0;
  let lastMatchIdx = -1;
  let score = 0;
  let matches = 0;

  for (let i = 0; i < t.length && patternIdx < p.length; i++) {
    if (t[i] === p[patternIdx]) {
      matches++;

      // 首字符奖励
      if (i === 0) {
        score += 25;
      }

      // 边界奖励
      if (isBoundaryChar(text, i)) {
        score += 15;
      }

      // 连续匹配奖励
      if (lastMatchIdx >= 0 && i === lastMatchIdx + 1) {
        consecutiveBonus += 10;
        score += consecutiveBonus;
      } else {
        consecutiveBonus = 0;
        // 间隔惩罚
        if (lastMatchIdx >= 0) {
          score -= Math.min((i - lastMatchIdx - 1) * 2, 10);
        }
      }

      lastMatchIdx = i;
      patternIdx++;
    }
  }

  // 未完全匹配
  if (patternIdx < p.length) {
    return 0;
  }

  // 基础分数
  score += matches * 10;

  // 长度比例奖励
  const lengthRatio = matches / text.length;
  score += lengthRatio * 20;

  // 归一化到 0-100
  const maxScore = pattern.length * 35 + 45; // 估算最大分数
  return Math.min(100, Math.round((score / maxScore) * 100));
}

/**
 * 批量模糊匹配并排序
 *
 * @param pattern 搜索模式
 * @param items 要搜索的项目数组
 * @param getText 获取项目文本的函数
 * @param options 选项
 * @returns 排序后的匹配结果
 */
export function fuzzyFilter<T>(
  pattern: string,
  items: T[],
  getText: (item: T) => string,
  options?: FuzzyScoreOptions & { limit?: number; threshold?: number }
): FuzzyBatchResult<T>[] {
  const threshold = options?.threshold ?? 0;
  const limit = options?.limit ?? items.length;

  const results: FuzzyBatchResult<T>[] = [];

  for (const item of items) {
    const text = getText(item);
    const match = fuzzyScore(pattern, text, options);

    if (match.matched && match.score >= threshold) {
      results.push({
        item,
        score: match.score,
        positions: match.positions,
        text,
      });
    }
  }

  // 按分数降序排序
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

/**
 * 高亮匹配文本
 * 返回带有标记的高亮文本
 *
 * @param text 原始文本
 * @param positions 匹配位置
 * @param highlightStart 高亮开始标记
 * @param highlightEnd 高亮结束标记
 * @returns 高亮后的文本
 */
export function highlightMatches(
  text: string,
  positions: number[],
  highlightStart = '<mark>',
  highlightEnd = '</mark>'
): string {
  if (positions.length === 0) return text;

  const posSet = new Set(positions);
  let result = '';
  let inHighlight = false;

  for (let i = 0; i < text.length; i++) {
    const isMatch = posSet.has(i);

    if (isMatch && !inHighlight) {
      result += highlightStart;
      inHighlight = true;
    } else if (!isMatch && inHighlight) {
      result += highlightEnd;
      inHighlight = false;
    }

    result += text[i];
  }

  if (inHighlight) {
    result += highlightEnd;
  }

  return result;
}

/**
 * 计算两个字符串的模糊相似度
 * 结合正向和反向匹配
 *
 * @param a 字符串 A
 * @param b 字符串 B
 * @param caseSensitive 是否区分大小写
 * @returns 相似度（0-100）
 */
export function fuzzySimilarity(
  a: string,
  b: string,
  caseSensitive = false
): number {
  if (a === b) return 100;
  if (a.length === 0 || b.length === 0) return 0;

  // 双向匹配取平均
  const scoreAB = quickFuzzyScore(a, b, caseSensitive);
  const scoreBA = quickFuzzyScore(b, a, caseSensitive);

  return Math.round((scoreAB + scoreBA) / 2);
}

/**
 * 子序列匹配检查
 * 检查 pattern 是否是 text 的子序列
 *
 * @param pattern 模式
 * @param text 文本
 * @param caseSensitive 是否区分大小写
 * @returns 是否为子序列
 */
export function isSubsequence(
  pattern: string,
  text: string,
  caseSensitive = false
): boolean {
  return fuzzyMatch(pattern, text, caseSensitive);
}

/**
 * 获取所有可能的匹配位置
 *
 * @param pattern 搜索模式
 * @param text 目标文本
 * @param caseSensitive 是否区分大小写
 * @param maxResults 最大结果数
 * @returns 所有可能的匹配位置数组
 */
export function getAllMatchPositions(
  pattern: string,
  text: string,
  caseSensitive = false,
  maxResults = 10
): number[][] {
  if (pattern.length === 0) return [[]];
  if (text.length === 0 || pattern.length > text.length) return [];

  const p = caseSensitive ? pattern : pattern.toLowerCase();
  const t = caseSensitive ? text : text.toLowerCase();

  const results: number[][] = [];

  function backtrack(patternIdx: number, textIdx: number, positions: number[]): void {
    if (results.length >= maxResults) return;

    if (patternIdx === p.length) {
      results.push([...positions]);
      return;
    }

    for (let i = textIdx; i < t.length; i++) {
      if (t[i] === p[patternIdx]) {
        positions.push(i);
        backtrack(patternIdx + 1, i + 1, positions);
        positions.pop();
      }
    }
  }

  backtrack(0, 0, []);
  return results;
}

// ================================
// 导出
// ================================

export default {
  fuzzyScore,
  fuzzyMatch,
  quickFuzzyScore,
  fuzzyFilter,
  highlightMatches,
  fuzzySimilarity,
  isSubsequence,
  getAllMatchPositions,
};
