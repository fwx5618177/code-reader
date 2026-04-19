// ================================
// Levenshtein 编辑距离算法
// 用于计算两个字符串之间的最小编辑距离
// 支持模糊匹配和相似度计算
// ================================

// ================================
// 类型定义
// ================================

/**
 * 编辑操作类型
 */
export enum EditOperation {
  /** 无操作（字符相同） */
  None = 'none',
  /** 插入字符 */
  Insert = 'insert',
  /** 删除字符 */
  Delete = 'delete',
  /** 替换字符 */
  Replace = 'replace',
}

/**
 * 编辑步骤
 */
export interface EditStep {
  /** 操作类型 */
  operation: EditOperation;
  /** 源字符串位置 */
  sourceIndex: number;
  /** 目标字符串位置 */
  targetIndex: number;
  /** 涉及的字符（源或目标） */
  char?: string;
  /** 被替换的字符（仅替换操作） */
  replacedChar?: string;
}

/**
 * 编辑距离结果
 */
export interface LevenshteinResult {
  /** 编辑距离 */
  distance: number;
  /** 相似度（0-1） */
  similarity: number;
  /** 编辑步骤序列（可选） */
  steps?: EditStep[];
}

/**
 * 算法选项
 */
export interface LevenshteinOptions {
  /** 是否忽略大小写 */
  caseSensitive?: boolean;
  /** 插入操作的代价 */
  insertCost?: number;
  /** 删除操作的代价 */
  deleteCost?: number;
  /** 替换操作的代价 */
  replaceCost?: number;
  /** 是否计算编辑步骤 */
  computeSteps?: boolean;
  /** 最大距离限制（用于早期终止优化） */
  maxDistance?: number;
}

// ================================
// 默认配置
// ================================

const DEFAULT_OPTIONS: Required<LevenshteinOptions> = {
  caseSensitive: true,
  insertCost: 1,
  deleteCost: 1,
  replaceCost: 1,
  computeSteps: false,
  maxDistance: Infinity,
};

// ================================
// 核心算法实现
// ================================

/**
 * 计算 Levenshtein 编辑距离
 * 使用空间优化的动态规划算法，空间复杂度 O(min(m,n))
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @param options 算法选项
 * @returns 编辑距离
 *
 * @example
 * ```ts
 * levenshteinDistance('kitten', 'sitting'); // 3
 * levenshteinDistance('hello', 'hallo');    // 1
 * ```
 */
export function levenshteinDistance(
  source: string,
  target: string,
  options?: LevenshteinOptions
): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 处理大小写
  let s = source;
  let t = target;
  if (!opts.caseSensitive) {
    s = source.toLowerCase();
    t = target.toLowerCase();
  }

  const m = s.length;
  const n = t.length;

  // 边界情况
  if (m === 0) return n * opts.insertCost;
  if (n === 0) return m * opts.deleteCost;
  if (s === t) return 0;

  // 确保 source 是较短的字符串以优化空间
  if (m > n) {
    return levenshteinDistance(target, source, {
      ...opts,
      insertCost: opts.deleteCost,
      deleteCost: opts.insertCost,
    });
  }

  // 使用单行数组优化空间
  // row[j] 表示 s[0..i] 转换为 t[0..j] 的最小代价
  const row: number[] = new Array(n + 1);

  // 初始化第一行
  for (let j = 0; j <= n; j++) {
    row[j] = j * opts.insertCost;
  }

  // 填充矩阵
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!; // 存储左上角的值
    row[0] = i * opts.deleteCost;

    // 早期终止检查
    let minInRow = row[0];

    for (let j = 1; j <= n; j++) {
      const current = row[j]!;
      const cost = s[i - 1] === t[j - 1] ? 0 : opts.replaceCost;

      row[j] = Math.min(
        current + opts.deleteCost, // 删除
        row[j - 1]! + opts.insertCost, // 插入
        prev + cost // 替换或匹配
      );

      prev = current;
      minInRow = Math.min(minInRow, row[j]!);
    }

    // 早期终止：如果当前行最小值已超过限制，直接返回
    if (minInRow > opts.maxDistance) {
      return opts.maxDistance + 1;
    }
  }

  return row[n]!;
}

/**
 * 计算带有完整结果的 Levenshtein 编辑距离
 * 包括相似度和可选的编辑步骤
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @param options 算法选项
 * @returns 完整的编辑距离结果
 */
export function levenshteinFull(
  source: string,
  target: string,
  options?: LevenshteinOptions
): LevenshteinResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 处理大小写
  let s = source;
  let t = target;
  if (!opts.caseSensitive) {
    s = source.toLowerCase();
    t = target.toLowerCase();
  }

  const m = s.length;
  const n = t.length;

  // 边界情况
  if (m === 0 && n === 0) {
    return { distance: 0, similarity: 1, steps: opts.computeSteps ? [] : undefined };
  }

  if (m === 0) {
    const distance = n * opts.insertCost;
    const steps = opts.computeSteps
      ? Array.from({ length: n }, (_, i) => ({
          operation: EditOperation.Insert,
          sourceIndex: 0,
          targetIndex: i,
          char: t[i],
        }))
      : undefined;
    return { distance, similarity: 0, steps };
  }

  if (n === 0) {
    const distance = m * opts.deleteCost;
    const steps = opts.computeSteps
      ? Array.from({ length: m }, (_, i) => ({
          operation: EditOperation.Delete,
          sourceIndex: i,
          targetIndex: 0,
          char: s[i],
        }))
      : undefined;
    return { distance, similarity: 0, steps };
  }

  // 如果需要计算步骤，使用完整矩阵
  if (opts.computeSteps) {
    return levenshteinWithSteps(s, t, source, target, opts);
  }

  // 否则使用优化算法
  const distance = levenshteinDistance(source, target, opts);
  const maxLen = Math.max(m, n);
  const similarity = maxLen === 0 ? 1 : 1 - distance / maxLen;

  return { distance, similarity };
}

/**
 * 带编辑步骤的 Levenshtein 算法
 * 需要完整矩阵来回溯路径
 */
function levenshteinWithSteps(
  s: string,
  t: string,
  originalSource: string,
  originalTarget: string,
  opts: Required<LevenshteinOptions>
): LevenshteinResult {
  const m = s.length;
  const n = t.length;

  // 构建完整 DP 矩阵
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i]![0] = i * opts.deleteCost;
  for (let j = 0; j <= n; j++) dp[0]![j] = j * opts.insertCost;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : opts.replaceCost;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + opts.deleteCost,
        dp[i]![j - 1]! + opts.insertCost,
        dp[i - 1]![j - 1]! + cost
      );
    }
  }

  // 回溯编辑路径
  const steps: EditStep[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && s[i - 1] === t[j - 1]) {
      steps.unshift({
        operation: EditOperation.None,
        sourceIndex: i - 1,
        targetIndex: j - 1,
        char: originalSource[i - 1],
      });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + opts.replaceCost) {
      steps.unshift({
        operation: EditOperation.Replace,
        sourceIndex: i - 1,
        targetIndex: j - 1,
        char: originalTarget[j - 1],
        replacedChar: originalSource[i - 1],
      });
      i--;
      j--;
    } else if (j > 0 && dp[i]![j] === dp[i]![j - 1]! + opts.insertCost) {
      steps.unshift({
        operation: EditOperation.Insert,
        sourceIndex: i,
        targetIndex: j - 1,
        char: originalTarget[j - 1],
      });
      j--;
    } else {
      steps.unshift({
        operation: EditOperation.Delete,
        sourceIndex: i - 1,
        targetIndex: j,
        char: originalSource[i - 1],
      });
      i--;
    }
  }

  const distance = dp[m]![n]!;
  const maxLen = Math.max(m, n);
  const similarity = maxLen === 0 ? 1 : 1 - distance / maxLen;

  return { distance, similarity, steps };
}

// ================================
// 便捷函数
// ================================

/**
 * 计算两个字符串的相似度（0-1）
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @param options 算法选项
 * @returns 相似度，1 表示完全相同，0 表示完全不同
 */
export function stringSimilarity(
  source: string,
  target: string,
  options?: LevenshteinOptions
): number {
  const result = levenshteinFull(source, target, options);
  return result.similarity;
}

/**
 * 判断两个字符串的编辑距离是否不超过指定值
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @param maxDistance 最大允许距离
 * @param options 算法选项
 * @returns 是否在距离范围内
 */
export function isWithinDistance(
  source: string,
  target: string,
  maxDistance: number,
  options?: LevenshteinOptions
): boolean {
  const distance = levenshteinDistance(source, target, { ...options, maxDistance });
  return distance <= maxDistance;
}

/**
 * 批量计算一个源字符串与多个目标字符串的编辑距离
 *
 * @param source 源字符串
 * @param targets 目标字符串列表
 * @param options 算法选项
 * @returns 按距离排序的结果列表
 */
export function batchLevenshtein(
  source: string,
  targets: string[],
  options?: LevenshteinOptions
): Array<{ target: string; distance: number; similarity: number }> {
  return targets
    .map((target) => {
      const result = levenshteinFull(source, target, options);
      return { target, distance: result.distance, similarity: result.similarity };
    })
    .sort((a, b) => a.distance - b.distance);
}
