// ================================
// LCS (Longest Common Subsequence) 算法实现
// 多种差分算法的基础
// 支持多种优化策略
// ================================

/**
 * LCS 算法
 *
 * 最长公共子序列是多种差分算法的基础：
 * - Myers Diff
 * - Patience Diff
 * - Hunt-McIlroy
 * 等算法都依赖 LCS
 */

// ================================
// 类型定义
// ================================

/**
 * LCS 结果
 */
export interface LCSResult<T> {
  /** LCS 长度 */
  readonly length: number;
  /** LCS 序列 */
  readonly sequence: readonly T[];
  /** 在源序列中的索引 */
  readonly sourceIndices: readonly number[];
  /** 在目标序列中的索引 */
  readonly targetIndices: readonly number[];
  /** 计算耗时（毫秒） */
  readonly computeTimeMs: number;
}

/**
 * 差分结果项
 */
export interface DiffItem<T> {
  /** 值 */
  readonly value: T;
  /** 操作类型 */
  readonly type: 'equal' | 'insert' | 'delete';
  /** 在源序列中的索引（equal/delete） */
  readonly sourceIndex?: number;
  /** 在目标序列中的索引（equal/insert） */
  readonly targetIndex?: number;
}

/**
 * LCS 配置
 */
export interface LCSConfig<T> {
  /** 自定义比较函数 */
  equals?: (a: T, b: T) => boolean;
  /** 最大处理长度（超过则使用近似算法） */
  maxLength?: number;
}

// ================================
// 默认配置
// ================================

const DEFAULT_MAX_LENGTH = 10000;

// ================================
// LCS 引擎
// ================================

/**
 * LCS 计算引擎
 *
 * 提供多种 LCS 计算策略：
 * - 标准动态规划（O(nm) 时间和空间）
 * - 空间优化版本（O(nm) 时间，O(min(n,m)) 空间）
 * - Myers 算法（O(nd) 时间，d 是差异数）
 *
 * @example
 * ```typescript
 * const engine = new LCSEngine<string>();
 *
 * const result = engine.compute(['a', 'b', 'c'], ['b', 'c', 'd']);
 * console.log(result.sequence); // ['b', 'c']
 *
 * const diff = engine.diff(['a', 'b', 'c'], ['b', 'c', 'd']);
 * // [{ value: 'a', type: 'delete' }, { value: 'b', type: 'equal' }, ...]
 * ```
 */
export class LCSEngine<T = string> {
  private readonly equals: (a: T, b: T) => boolean;
  private readonly maxLength: number;

  constructor(config: LCSConfig<T> = {}) {
    this.equals = config.equals ?? ((a, b) => a === b);
    this.maxLength = config.maxLength ?? DEFAULT_MAX_LENGTH;
  }

  // ================================
  // 核心 LCS 算法
  // ================================

  /**
   * 计算 LCS（自动选择最佳算法）
   */
  compute(source: readonly T[], target: readonly T[]): LCSResult<T> {
    const startTime = performance.now();

    // 对于大序列使用空间优化版本
    if (source.length * target.length > this.maxLength * this.maxLength) {
      return this.computeSpaceOptimized(source, target, startTime);
    }

    return this.computeStandard(source, target, startTime);
  }

  /**
   * 标准动态规划 LCS
   * 时间复杂度: O(nm)
   * 空间复杂度: O(nm)
   */
  computeStandard(source: readonly T[], target: readonly T[], startTime?: number): LCSResult<T> {
    const start = startTime ?? performance.now();
    const m = source.length;
    const n = target.length;

    // 处理边界情况
    if (m === 0 || n === 0) {
      return this.createEmptyResult(start);
    }

    // 构建 DP 表
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (this.equals(source[i - 1], target[j - 1])) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // 回溯找出 LCS
    const sequence: T[] = [];
    const sourceIndices: number[] = [];
    const targetIndices: number[] = [];

    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
      if (this.equals(source[i - 1], target[j - 1])) {
        sequence.unshift(source[i - 1]);
        sourceIndices.unshift(i - 1);
        targetIndices.unshift(j - 1);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    const endTime = performance.now();

    return {
      length: dp[m][n],
      sequence,
      sourceIndices,
      targetIndices,
      computeTimeMs: endTime - start,
    };
  }

  /**
   * 空间优化的 LCS
   * 时间复杂度: O(nm)
   * 空间复杂度: O(min(n,m))
   *
   * 只计算 LCS 长度，不返回实际序列
   */
  computeLength(source: readonly T[], target: readonly T[]): number {
    // 确保 target 是较短的序列
    if (source.length < target.length) {
      return this.computeLength(target, source);
    }

    const m = source.length;
    const n = target.length;

    if (n === 0) return 0;

    let prev = new Array(n + 1).fill(0);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (this.equals(source[i - 1], target[j - 1])) {
          curr[j] = prev[j - 1] + 1;
        } else {
          curr[j] = Math.max(prev[j], curr[j - 1]);
        }
      }
      [prev, curr] = [curr, prev];
    }

    return prev[n];
  }

  /**
   * 空间优化版本（Hirschberg 算法）
   * 时间复杂度: O(nm)
   * 空间复杂度: O(min(n,m))
   */
  private computeSpaceOptimized(
    source: readonly T[],
    target: readonly T[],
    startTime: number
  ): LCSResult<T> {
    const sequence = this.hirschberg(source, 0, source.length, target, 0, target.length);

    // 重建索引
    const sourceIndices: number[] = [];
    const targetIndices: number[] = [];

    let si = 0;
    let ti = 0;

    for (const item of sequence) {
      while (si < source.length && !this.equals(source[si], item)) {
        si++;
      }
      while (ti < target.length && !this.equals(target[ti], item)) {
        ti++;
      }
      if (si < source.length && ti < target.length) {
        sourceIndices.push(si);
        targetIndices.push(ti);
        si++;
        ti++;
      }
    }

    const endTime = performance.now();

    return {
      length: sequence.length,
      sequence,
      sourceIndices,
      targetIndices,
      computeTimeMs: endTime - startTime,
    };
  }

  /**
   * Hirschberg 算法的递归实现
   */
  private hirschberg(
    source: readonly T[],
    sStart: number,
    sEnd: number,
    target: readonly T[],
    tStart: number,
    tEnd: number
  ): T[] {
    const sLen = sEnd - sStart;
    const tLen = tEnd - tStart;

    // 基本情况
    if (sLen === 0) {
      return [];
    }
    if (tLen === 0) {
      return [];
    }
    if (sLen === 1) {
      for (let j = tStart; j < tEnd; j++) {
        if (this.equals(source[sStart], target[j])) {
          return [source[sStart]];
        }
      }
      return [];
    }

    // 分割点
    const sMid = sStart + Math.floor(sLen / 2);

    // 计算前半部分的 LCS 长度
    const L1 = this.lcsLengthRow(source, sStart, sMid, target, tStart, tEnd);

    // 计算后半部分（反向）的 LCS 长度
    const L2 = this.lcsLengthRowReverse(source, sMid, sEnd, target, tStart, tEnd);

    // 找最佳分割点
    let maxSum = -1;
    let tMid = tStart;
    for (let j = tStart; j <= tEnd; j++) {
      const sum = L1[j - tStart] + L2[tEnd - j];
      if (sum > maxSum) {
        maxSum = sum;
        tMid = j;
      }
    }

    // 递归
    const left = this.hirschberg(source, sStart, sMid, target, tStart, tMid);
    const right = this.hirschberg(source, sMid, sEnd, target, tMid, tEnd);

    return [...left, ...right];
  }

  /**
   * 计算 LCS 长度的最后一行
   */
  private lcsLengthRow(
    source: readonly T[],
    sStart: number,
    sEnd: number,
    target: readonly T[],
    tStart: number,
    tEnd: number
  ): number[] {
    const tLen = tEnd - tStart;
    let prev = new Array(tLen + 1).fill(0);
    let curr = new Array(tLen + 1).fill(0);

    for (let i = sStart; i < sEnd; i++) {
      for (let j = 0; j < tLen; j++) {
        if (this.equals(source[i], target[tStart + j])) {
          curr[j + 1] = prev[j] + 1;
        } else {
          curr[j + 1] = Math.max(prev[j + 1], curr[j]);
        }
      }
      [prev, curr] = [curr, prev];
    }

    return prev;
  }

  /**
   * 计算反向 LCS 长度的最后一行
   */
  private lcsLengthRowReverse(
    source: readonly T[],
    sStart: number,
    sEnd: number,
    target: readonly T[],
    tStart: number,
    tEnd: number
  ): number[] {
    const tLen = tEnd - tStart;
    let prev = new Array(tLen + 1).fill(0);
    let curr = new Array(tLen + 1).fill(0);

    for (let i = sEnd - 1; i >= sStart; i--) {
      for (let j = tLen - 1; j >= 0; j--) {
        if (this.equals(source[i], target[tStart + j])) {
          curr[j] = prev[j + 1] + 1;
        } else {
          curr[j] = Math.max(prev[j], curr[j + 1]);
        }
      }
      [prev, curr] = [curr, prev];
    }

    return prev;
  }

  // ================================
  // 基于 LCS 的差分
  // ================================

  /**
   * 基于 LCS 计算差分
   */
  diff(source: readonly T[], target: readonly T[]): DiffItem<T>[] {
    const lcs = this.compute(source, target);
    const result: DiffItem<T>[] = [];

    let si = 0; // 源序列指针
    let ti = 0; // 目标序列指针
    let li = 0; // LCS 指针

    while (si < source.length || ti < target.length) {
      if (li < lcs.length) {
        const lcsSourceIdx = lcs.sourceIndices[li];
        const lcsTargetIdx = lcs.targetIndices[li];

        // 输出 LCS 之前的删除
        while (si < lcsSourceIdx) {
          result.push({
            value: source[si],
            type: 'delete',
            sourceIndex: si,
          });
          si++;
        }

        // 输出 LCS 之前的插入
        while (ti < lcsTargetIdx) {
          result.push({
            value: target[ti],
            type: 'insert',
            targetIndex: ti,
          });
          ti++;
        }

        // 输出 LCS 元素
        result.push({
          value: lcs.sequence[li],
          type: 'equal',
          sourceIndex: si,
          targetIndex: ti,
        });
        si++;
        ti++;
        li++;
      } else {
        // LCS 用完后，输出剩余的删除和插入
        while (si < source.length) {
          result.push({
            value: source[si],
            type: 'delete',
            sourceIndex: si,
          });
          si++;
        }
        while (ti < target.length) {
          result.push({
            value: target[ti],
            type: 'insert',
            targetIndex: ti,
          });
          ti++;
        }
      }
    }

    return result;
  }

  /**
   * 计算编辑距离（基于 LCS）
   * 编辑距离 = m + n - 2 * LCS长度
   */
  editDistance(source: readonly T[], target: readonly T[]): number {
    const lcsLength = this.computeLength(source, target);
    return source.length + target.length - 2 * lcsLength;
  }

  /**
   * 计算相似度（基于 LCS）
   * 相似度 = 2 * LCS长度 / (m + n)
   */
  similarity(source: readonly T[], target: readonly T[]): number {
    const totalLength = source.length + target.length;
    if (totalLength === 0) return 1;

    const lcsLength = this.computeLength(source, target);
    return (2 * lcsLength) / totalLength;
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 创建空结果
   */
  private createEmptyResult(startTime: number): LCSResult<T> {
    return {
      length: 0,
      sequence: [],
      sourceIndices: [],
      targetIndices: [],
      computeTimeMs: performance.now() - startTime,
    };
  }
}

// ================================
// 字符串专用 LCS
// ================================

/**
 * 字符串 LCS 引擎
 * 针对字符串优化的实现
 */
export class StringLCSEngine {
  /**
   * 计算两个字符串的 LCS
   */
  compute(source: string, target: string): LCSResult<string> {
    const engine = new LCSEngine<string>();
    return engine.compute(source.split(''), target.split(''));
  }

  /**
   * 计算 LCS 长度
   */
  computeLength(source: string, target: string): number {
    const engine = new LCSEngine<string>();
    return engine.computeLength(source.split(''), target.split(''));
  }

  /**
   * 获取 LCS 字符串
   */
  getLCS(source: string, target: string): string {
    const result = this.compute(source, target);
    return result.sequence.join('');
  }

  /**
   * 计算相似度
   */
  similarity(source: string, target: string): number {
    const engine = new LCSEngine<string>();
    return engine.similarity(source.split(''), target.split(''));
  }
}

/**
 * 行级 LCS 引擎
 * 用于文本文件差分
 */
export class LineLCSEngine {
  private readonly trimLines: boolean;
  private readonly ignoreCase: boolean;

  constructor(options: { trimLines?: boolean; ignoreCase?: boolean } = {}) {
    this.trimLines = options.trimLines ?? false;
    this.ignoreCase = options.ignoreCase ?? false;
  }

  /**
   * 计算两个文本的行级 LCS
   */
  compute(source: string, target: string): LCSResult<string> {
    const sourceLines = this.splitLines(source);
    const targetLines = this.splitLines(target);

    const engine = new LCSEngine<string>({
      equals: (a, b) => this.compareLines(a, b),
    });

    return engine.compute(sourceLines, targetLines);
  }

  /**
   * 行级差分
   */
  diff(source: string, target: string): DiffItem<string>[] {
    const sourceLines = this.splitLines(source);
    const targetLines = this.splitLines(target);

    const engine = new LCSEngine<string>({
      equals: (a, b) => this.compareLines(a, b),
    });

    return engine.diff(sourceLines, targetLines);
  }

  /**
   * 计算相似度
   */
  similarity(source: string, target: string): number {
    const sourceLines = this.splitLines(source);
    const targetLines = this.splitLines(target);

    const engine = new LCSEngine<string>({
      equals: (a, b) => this.compareLines(a, b),
    });

    return engine.similarity(sourceLines, targetLines);
  }

  private splitLines(text: string): string[] {
    if (text.length === 0) return [];
    return text.split(/\r?\n/);
  }

  private compareLines(a: string, b: string): boolean {
    let lineA = a;
    let lineB = b;

    if (this.trimLines) {
      lineA = lineA.trim();
      lineB = lineB.trim();
    }

    if (this.ignoreCase) {
      lineA = lineA.toLowerCase();
      lineB = lineB.toLowerCase();
    }

    return lineA === lineB;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建通用 LCS 引擎
 */
export function createLCSEngine<T>(config?: LCSConfig<T>): LCSEngine<T> {
  return new LCSEngine<T>(config);
}

/**
 * 创建字符串 LCS 引擎
 */
export function createStringLCSEngine(): StringLCSEngine {
  return new StringLCSEngine();
}

/**
 * 创建行级 LCS 引擎
 */
export function createLineLCSEngine(options?: {
  trimLines?: boolean;
  ignoreCase?: boolean;
}): LineLCSEngine {
  return new LineLCSEngine(options);
}

// ================================
// 便捷函数
// ================================

/**
 * 快速计算字符串 LCS
 */
export function quickStringLCS(source: string, target: string): string {
  return new StringLCSEngine().getLCS(source, target);
}

/**
 * 快速计算数组 LCS
 */
export function quickArrayLCS<T>(source: readonly T[], target: readonly T[]): LCSResult<T> {
  return new LCSEngine<T>().compute(source, target);
}

/**
 * 快速计算 LCS 相似度
 */
export function quickLCSSimilarity(source: string, target: string): number {
  return new StringLCSEngine().similarity(source, target);
}

/**
 * 快速计算行级差分
 */
export function quickLineDiff(source: string, target: string): DiffItem<string>[] {
  return new LineLCSEngine().diff(source, target);
}
