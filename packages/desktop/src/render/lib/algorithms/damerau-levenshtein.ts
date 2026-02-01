// ================================
// Damerau-Levenshtein 编辑距离算法
// 在标准 Levenshtein 基础上增加相邻字符交换操作
// 适用于拼写纠错、打字错误检测
// ================================

// ================================
// 类型定义
// ================================

/**
 * 编辑操作类型
 */
export enum DamerauEditOperation {
  /** 无操作（字符相同） */
  None = 'none',
  /** 插入字符 */
  Insert = 'insert',
  /** 删除字符 */
  Delete = 'delete',
  /** 替换字符 */
  Replace = 'replace',
  /** 相邻字符交换 */
  Transpose = 'transpose',
}

/**
 * 编辑步骤
 */
export interface DamerauEditStep {
  /** 操作类型 */
  operation: DamerauEditOperation;
  /** 源字符串位置 */
  sourceIndex: number;
  /** 目标字符串位置 */
  targetIndex: number;
  /** 涉及的字符 */
  char?: string;
  /** 被替换的字符（仅替换操作） */
  replacedChar?: string;
  /** 交换的另一个字符（仅交换操作） */
  transposedChar?: string;
}

/**
 * Damerau-Levenshtein 结果
 */
export interface DamerauLevenshteinResult {
  /** 编辑距离 */
  distance: number;
  /** 相似度（0-1） */
  similarity: number;
  /** 编辑步骤序列（可选） */
  steps?: DamerauEditStep[];
}

/**
 * 算法选项
 */
export interface DamerauLevenshteinOptions {
  /** 是否忽略大小写 */
  caseSensitive?: boolean;
  /** 插入操作的代价 */
  insertCost?: number;
  /** 删除操作的代价 */
  deleteCost?: number;
  /** 替换操作的代价 */
  replaceCost?: number;
  /** 交换操作的代价 */
  transposeCost?: number;
  /** 是否计算编辑步骤 */
  computeSteps?: boolean;
  /** 最大距离限制（用于早期终止优化） */
  maxDistance?: number;
}

// ================================
// 默认配置
// ================================

const DEFAULT_OPTIONS: Required<DamerauLevenshteinOptions> = {
  caseSensitive: true,
  insertCost: 1,
  deleteCost: 1,
  replaceCost: 1,
  transposeCost: 1,
  computeSteps: false,
  maxDistance: Infinity,
};

// ================================
// 核心算法实现
// ================================

/**
 * 计算 Damerau-Levenshtein 编辑距离
 * 在标准 Levenshtein 基础上增加相邻字符交换操作
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @param options 算法选项
 * @returns 编辑距离
 *
 * @example
 * ```ts
 * damerauLevenshteinDistance('ab', 'ba'); // 1 (交换)
 * damerauLevenshteinDistance('abc', 'acb'); // 1 (交换)
 * damerauLevenshteinDistance('hello', 'hlelo'); // 1 (交换)
 * ```
 */
export function damerauLevenshteinDistance(
  source: string,
  target: string,
  options?: DamerauLevenshteinOptions
): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };

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

  // 快速检查：长度差已超过限制
  const lenDiff = Math.abs(m - n);
  if (lenDiff > opts.maxDistance) return opts.maxDistance + 1;

  // 创建矩阵
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  // 初始化
  for (let i = 0; i <= m; i++) d[i][0] = i * opts.deleteCost;
  for (let j = 0; j <= n; j++) d[0][j] = j * opts.insertCost;

  // 填充矩阵
  for (let i = 1; i <= m; i++) {
    // 早期终止检查
    let minInRow = Infinity;

    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : opts.replaceCost;

      d[i][j] = Math.min(
        d[i - 1][j] + opts.deleteCost, // 删除
        d[i][j - 1] + opts.insertCost, // 插入
        d[i - 1][j - 1] + cost // 替换
      );

      // 检查相邻字符交换（Damerau 特有操作）
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + opts.transposeCost);
      }

      minInRow = Math.min(minInRow, d[i][j]);
    }

    // 早期终止：如果当前行最小值已超过限制
    if (minInRow > opts.maxDistance) {
      return opts.maxDistance + 1;
    }
  }

  return d[m][n];
}

/**
 * 计算带有完整结果的 Damerau-Levenshtein 编辑距离
 * 包括相似度和可选的编辑步骤
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @param options 算法选项
 * @returns 完整的编辑距离结果
 */
export function damerauLevenshteinFull(
  source: string,
  target: string,
  options?: DamerauLevenshteinOptions
): DamerauLevenshteinResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

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
          operation: DamerauEditOperation.Insert,
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
          operation: DamerauEditOperation.Delete,
          sourceIndex: i,
          targetIndex: 0,
          char: s[i],
        }))
      : undefined;
    return { distance, similarity: 0, steps };
  }

  // 创建矩阵
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  // 初始化
  for (let i = 0; i <= m; i++) d[i][0] = i * opts.deleteCost;
  for (let j = 0; j <= n; j++) d[0][j] = j * opts.insertCost;

  // 填充矩阵
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : opts.replaceCost;

      d[i][j] = Math.min(
        d[i - 1][j] + opts.deleteCost,
        d[i][j - 1] + opts.insertCost,
        d[i - 1][j - 1] + cost
      );

      // 检查相邻字符交换
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + opts.transposeCost);
      }
    }
  }

  const distance = d[m][n];
  const maxLen = Math.max(m, n);
  const similarity = maxLen === 0 ? 1 : 1 - distance / maxLen;

  // 如果需要计算步骤，进行回溯
  let steps: DamerauEditStep[] | undefined;
  if (opts.computeSteps) {
    steps = backtraceSteps(s, t, d, source, target, opts);
  }

  return { distance, similarity, steps };
}

/**
 * 回溯计算编辑步骤
 */
function backtraceSteps(
  s: string,
  t: string,
  d: number[][],
  originalSource: string,
  originalTarget: string,
  opts: Required<DamerauLevenshteinOptions>
): DamerauEditStep[] {
  const steps: DamerauEditStep[] = [];
  let i = s.length;
  let j = t.length;

  while (i > 0 || j > 0) {
    // 检查交换操作（优先检查）
    if (
      i > 1 &&
      j > 1 &&
      s[i - 1] === t[j - 2] &&
      s[i - 2] === t[j - 1] &&
      d[i][j] === d[i - 2][j - 2] + opts.transposeCost
    ) {
      steps.unshift({
        operation: DamerauEditOperation.Transpose,
        sourceIndex: i - 2,
        targetIndex: j - 2,
        char: originalSource[i - 2],
        transposedChar: originalSource[i - 1],
      });
      i -= 2;
      j -= 2;
      continue;
    }

    if (i > 0 && j > 0 && s[i - 1] === t[j - 1]) {
      // 字符相同，无操作
      steps.unshift({
        operation: DamerauEditOperation.None,
        sourceIndex: i - 1,
        targetIndex: j - 1,
        char: originalSource[i - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || d[i][j - 1] + opts.insertCost <= d[i][j])) {
      // 插入
      steps.unshift({
        operation: DamerauEditOperation.Insert,
        sourceIndex: i,
        targetIndex: j - 1,
        char: originalTarget[j - 1],
      });
      j--;
    } else if (i > 0 && (j === 0 || d[i - 1][j] + opts.deleteCost <= d[i][j])) {
      // 删除
      steps.unshift({
        operation: DamerauEditOperation.Delete,
        sourceIndex: i - 1,
        targetIndex: j,
        char: originalSource[i - 1],
      });
      i--;
    } else {
      // 替换
      steps.unshift({
        operation: DamerauEditOperation.Replace,
        sourceIndex: i - 1,
        targetIndex: j - 1,
        char: originalTarget[j - 1],
        replacedChar: originalSource[i - 1],
      });
      i--;
      j--;
    }
  }

  return steps;
}

/**
 * 计算两个字符串的 Damerau-Levenshtein 相似度
 * 返回 0-1 之间的值，1 表示完全相同
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @param caseSensitive 是否区分大小写
 * @returns 相似度（0-1）
 */
export function damerauSimilarity(
  source: string,
  target: string,
  caseSensitive = true
): number {
  if (source === target) return 1;
  if (source.length === 0 || target.length === 0) return 0;

  const distance = damerauLevenshteinDistance(source, target, { caseSensitive });
  const maxLen = Math.max(source.length, target.length);

  return 1 - distance / maxLen;
}

/**
 * 检查两个字符串是否在给定的 Damerau-Levenshtein 距离内
 * 使用早期终止优化
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @param maxDistance 最大编辑距离
 * @param caseSensitive 是否区分大小写
 * @returns 是否在距离内
 */
export function isWithinDamerauDistance(
  source: string,
  target: string,
  maxDistance: number,
  caseSensitive = true
): boolean {
  // 快速检查：长度差已超过限制
  const lenDiff = Math.abs(source.length - target.length);
  if (lenDiff > maxDistance) return false;

  const distance = damerauLevenshteinDistance(source, target, {
    caseSensitive,
    maxDistance,
  });

  return distance <= maxDistance;
}

/**
 * 检测两个字符串是否只差一个相邻交换
 * 这是一个常见的打字错误模式
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @returns 是否为单次交换
 */
export function isSingleTransposition(source: string, target: string): boolean {
  if (source.length !== target.length) return false;
  if (source === target) return false;

  let diffCount = 0;
  let firstDiffIndex = -1;

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== target[i]) {
      diffCount++;
      if (firstDiffIndex === -1) {
        firstDiffIndex = i;
      }
      if (diffCount > 2) return false;
    }
  }

  // 必须恰好有两个位置不同
  if (diffCount !== 2) return false;

  // 检查是否为相邻交换
  const secondDiffIndex = firstDiffIndex + 1;
  if (secondDiffIndex >= source.length) return false;

  return (
    source[firstDiffIndex] === target[secondDiffIndex] &&
    source[secondDiffIndex] === target[firstDiffIndex] &&
    // 确保只有这两个位置不同
    target[firstDiffIndex] === source[secondDiffIndex]
  );
}

/**
 * 批量计算字符串与目标的 Damerau-Levenshtein 距离
 * 返回按距离排序的结果
 *
 * @param source 源字符串
 * @param targets 目标字符串数组
 * @param options 选项
 * @returns 排序后的结果数组
 */
export function batchDamerauLevenshtein(
  source: string,
  targets: string[],
  options?: DamerauLevenshteinOptions & { limit?: number }
): Array<{ target: string; distance: number; similarity: number }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const limit = options?.limit ?? targets.length;

  const results = targets.map((target) => {
    const distance = damerauLevenshteinDistance(source, target, opts);
    const maxLen = Math.max(source.length, target.length);
    const similarity = maxLen === 0 ? 1 : 1 - distance / maxLen;
    return { target, distance, similarity };
  });

  // 按距离排序
  results.sort((a, b) => a.distance - b.distance);

  return results.slice(0, limit);
}

/**
 * 查找最相似的字符串
 *
 * @param source 源字符串
 * @param targets 候选字符串数组
 * @param caseSensitive 是否区分大小写
 * @returns 最相似的字符串及其距离，如果数组为空返回 null
 */
export function findClosest(
  source: string,
  targets: string[],
  caseSensitive = true
): { target: string; distance: number; similarity: number } | null {
  if (targets.length === 0) return null;

  let closestTarget = targets[0];
  let minDistance = damerauLevenshteinDistance(source, closestTarget, { caseSensitive });

  for (let i = 1; i < targets.length; i++) {
    const distance = damerauLevenshteinDistance(source, targets[i], {
      caseSensitive,
      maxDistance: minDistance - 1, // 早期终止优化
    });

    if (distance < minDistance) {
      minDistance = distance;
      closestTarget = targets[i];
    }
  }

  const maxLen = Math.max(source.length, closestTarget.length);
  const similarity = maxLen === 0 ? 1 : 1 - minDistance / maxLen;

  return {
    target: closestTarget,
    distance: minDistance,
    similarity,
  };
}

// ================================
// 导出
// ================================

export default {
  damerauLevenshteinDistance,
  damerauLevenshteinFull,
  damerauSimilarity,
  isWithinDamerauDistance,
  isSingleTransposition,
  batchDamerauLevenshtein,
  findClosest,
};
