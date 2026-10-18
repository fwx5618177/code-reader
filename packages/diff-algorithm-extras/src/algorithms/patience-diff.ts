// ================================
// Patience Diff 算法实现
// 产生更易读的差分结果，特别适合代码对比
// 基于 Bram Cohen 的 Patience Diff 算法
// ================================

/**
 * Patience Diff 算法
 *
 * 核心思想：
 * 1. 找出两个序列中的唯一公共元素
 * 2. 对这些唯一元素使用 Patience Sorting 找 LIS (最长递增子序列)
 * 3. 用 LIS 作为锚点，递归处理锚点之间的区域
 *
 * 优点：
 * - 产生更"人类可读"的差分结果
 * - 更好地处理代码移动
 * - 避免匹配无意义的公共行（如空行、括号）
 */

// ================================
// 类型定义
// ================================

/**
 * 差分操作类型
 */
export type PatienceDiffOp = 'equal' | 'insert' | 'delete';

/**
 * 差分行
 */
export interface DiffLine {
  /** 操作类型 */
  readonly op: PatienceDiffOp;
  /** 行内容 */
  readonly line: string;
  /** 在源文件中的行号（0-indexed，仅 equal/delete） */
  readonly oldIndex?: number;
  /** 在目标文件中的行号（0-indexed，仅 equal/insert） */
  readonly newIndex?: number;
}

/**
 * 差分结果
 */
export interface PatienceDiffResult {
  /** 差分行列表 */
  readonly lines: readonly DiffLine[];
  /** 源行数 */
  readonly oldLineCount: number;
  /** 目标行数 */
  readonly newLineCount: number;
  /** 统计信息 */
  readonly stats: PatienceDiffStats;
  /** 计算耗时（毫秒） */
  readonly computeTimeMs: number;
}

/**
 * 差分统计
 */
export interface PatienceDiffStats {
  /** 相同行数 */
  readonly equalLines: number;
  /** 插入行数 */
  readonly insertedLines: number;
  /** 删除行数 */
  readonly deletedLines: number;
  /** 变化率 (0-1) */
  readonly changeRatio: number;
}

/**
 * 唯一行匹配
 */
interface UniqueMatch {
  /** 行内容 */
  line: string;
  /** 在源序列中的索引 */
  oldIndex: number;
  /** 在目标序列中的索引 */
  newIndex: number;
}

/**
 * Patience Sorting 的栈元素
 */
interface PatienceCard {
  /** 新序列中的索引 */
  newIndex: number;
  /** 旧序列中的索引 */
  oldIndex: number;
  /** 指向前一个元素（用于回溯 LIS） */
  prev: PatienceCard | null;
}

// ================================
// 核心算法实现
// ================================

/**
 * Patience Diff 引擎
 *
 * @example
 * ```typescript
 * const engine = new PatienceDiffEngine();
 *
 * const result = engine.diff(
 *   'function foo() {\n  return 1;\n}',
 *   'function foo() {\n  return 2;\n}'
 * );
 *
 * result.lines.forEach(line => {
 *   const prefix = line.op === 'equal' ? ' ' : line.op === 'insert' ? '+' : '-';
 *   console.log(`${prefix} ${line.line}`);
 * });
 * ```
 */
export class PatienceDiffEngine {
  /**
   * 计算两个文本的 Patience Diff
   *
   * @param oldText 源文本
   * @param newText 目标文本
   * @returns 差分结果
   */
  diff(oldText: string, newText: string): PatienceDiffResult {
    const startTime = performance.now();

    // 分割成行
    const oldLines = this.splitLines(oldText);
    const newLines = this.splitLines(newText);

    // 计算差分
    const diffLines = this.computeDiff(oldLines, newLines, 0, oldLines.length, 0, newLines.length);

    // 统计
    let equalLines = 0;
    let insertedLines = 0;
    let deletedLines = 0;

    for (const line of diffLines) {
      switch (line.op) {
        case 'equal':
          equalLines++;
          break;
        case 'insert':
          insertedLines++;
          break;
        case 'delete':
          deletedLines++;
          break;
      }
    }

    const totalLines = equalLines + insertedLines + deletedLines;
    const changeRatio = totalLines > 0 ? (insertedLines + deletedLines) / totalLines : 0;

    const endTime = performance.now();

    return {
      lines: diffLines,
      oldLineCount: oldLines.length,
      newLineCount: newLines.length,
      stats: {
        equalLines,
        insertedLines,
        deletedLines,
        changeRatio,
      },
      computeTimeMs: endTime - startTime,
    };
  }

  /**
   * 分割文本为行数组
   */
  private splitLines(text: string): string[] {
    if (text.length === 0) {
      return [];
    }
    // 保留换行符以便精确重建
    return text.split(/(?<=\n)/);
  }

  /**
   * 递归计算差分
   */
  private computeDiff(
    oldLines: string[],
    newLines: string[],
    oldStart: number,
    oldEnd: number,
    newStart: number,
    newEnd: number
  ): DiffLine[] {
    const result: DiffLine[] = [];

    // 基本情况：空范围
    if (oldStart >= oldEnd && newStart >= newEnd) {
      return result;
    }

    // 基本情况：只有删除
    if (newStart >= newEnd) {
      for (let i = oldStart; i < oldEnd; i++) {
        result.push({ op: 'delete', line: oldLines[i], oldIndex: i });
      }
      return result;
    }

    // 基本情况：只有插入
    if (oldStart >= oldEnd) {
      for (let i = newStart; i < newEnd; i++) {
        result.push({ op: 'insert', line: newLines[i], newIndex: i });
      }
      return result;
    }

    // 找出公共前缀
    let commonPrefixLen = 0;
    while (
      oldStart + commonPrefixLen < oldEnd &&
      newStart + commonPrefixLen < newEnd &&
      oldLines[oldStart + commonPrefixLen] === newLines[newStart + commonPrefixLen]
    ) {
      commonPrefixLen++;
    }

    // 找出公共后缀
    let commonSuffixLen = 0;
    while (
      commonSuffixLen < oldEnd - oldStart - commonPrefixLen &&
      commonSuffixLen < newEnd - newStart - commonPrefixLen &&
      oldLines[oldEnd - 1 - commonSuffixLen] === newLines[newEnd - 1 - commonSuffixLen]
    ) {
      commonSuffixLen++;
    }

    // 添加公共前缀
    for (let i = 0; i < commonPrefixLen; i++) {
      result.push({
        op: 'equal',
        line: oldLines[oldStart + i],
        oldIndex: oldStart + i,
        newIndex: newStart + i,
      });
    }

    // 计算中间部分
    const middleOldStart = oldStart + commonPrefixLen;
    const middleOldEnd = oldEnd - commonSuffixLen;
    const middleNewStart = newStart + commonPrefixLen;
    const middleNewEnd = newEnd - commonSuffixLen;

    if (middleOldStart < middleOldEnd || middleNewStart < middleNewEnd) {
      // 找唯一公共行
      const uniqueMatches = this.findUniqueMatches(
        oldLines,
        newLines,
        middleOldStart,
        middleOldEnd,
        middleNewStart,
        middleNewEnd
      );

      if (uniqueMatches.length === 0) {
        // 没有唯一公共行，使用简单的删除+插入
        for (let i = middleOldStart; i < middleOldEnd; i++) {
          result.push({ op: 'delete', line: oldLines[i], oldIndex: i });
        }
        for (let i = middleNewStart; i < middleNewEnd; i++) {
          result.push({ op: 'insert', line: newLines[i], newIndex: i });
        }
      } else {
        // 使用 Patience Sorting 找 LIS
        const lis = this.patienceLIS(uniqueMatches);

        // 递归处理 LIS 锚点之间的区域
        let prevOldEnd = middleOldStart;
        let prevNewEnd = middleNewStart;

        for (const match of lis) {
          // 递归处理锚点之前的区域
          const subResult = this.computeDiff(
            oldLines,
            newLines,
            prevOldEnd,
            match.oldIndex,
            prevNewEnd,
            match.newIndex
          );
          result.push(...subResult);

          // 添加匹配行
          result.push({
            op: 'equal',
            line: match.line,
            oldIndex: match.oldIndex,
            newIndex: match.newIndex,
          });

          prevOldEnd = match.oldIndex + 1;
          prevNewEnd = match.newIndex + 1;
        }

        // 处理最后一个锚点之后的区域
        const subResult = this.computeDiff(
          oldLines,
          newLines,
          prevOldEnd,
          middleOldEnd,
          prevNewEnd,
          middleNewEnd
        );
        result.push(...subResult);
      }
    }

    // 添加公共后缀
    for (let i = 0; i < commonSuffixLen; i++) {
      result.push({
        op: 'equal',
        line: oldLines[oldEnd - commonSuffixLen + i],
        oldIndex: oldEnd - commonSuffixLen + i,
        newIndex: newEnd - commonSuffixLen + i,
      });
    }

    return result;
  }

  /**
   * 找出两个序列中的唯一公共行
   */
  private findUniqueMatches(
    oldLines: string[],
    newLines: string[],
    oldStart: number,
    oldEnd: number,
    newStart: number,
    newEnd: number
  ): UniqueMatch[] {
    // 统计旧序列中每行的出现次数和位置
    const oldLineMap = new Map<string, { count: number; index: number }>();
    for (let i = oldStart; i < oldEnd; i++) {
      const line = oldLines[i];
      const existing = oldLineMap.get(line);
      if (existing) {
        existing.count++;
      } else {
        oldLineMap.set(line, { count: 1, index: i });
      }
    }

    // 统计新序列中每行的出现次数和位置
    const newLineMap = new Map<string, { count: number; index: number }>();
    for (let i = newStart; i < newEnd; i++) {
      const line = newLines[i];
      const existing = newLineMap.get(line);
      if (existing) {
        existing.count++;
      } else {
        newLineMap.set(line, { count: 1, index: i });
      }
    }

    // 找出在两个序列中都唯一的行
    const matches: UniqueMatch[] = [];
    for (const [line, oldInfo] of oldLineMap) {
      if (oldInfo.count === 1) {
        const newInfo = newLineMap.get(line);
        if (newInfo && newInfo.count === 1) {
          matches.push({
            line,
            oldIndex: oldInfo.index,
            newIndex: newInfo.index,
          });
        }
      }
    }

    // 按新序列中的顺序排序
    matches.sort((a, b) => a.newIndex - b.newIndex);

    return matches;
  }

  /**
   * 使用 Patience Sorting 找最长递增子序列
   */
  private patienceLIS(matches: UniqueMatch[]): UniqueMatch[] {
    if (matches.length === 0) {
      return [];
    }

    // Patience 排序的栈
    const stacks: PatienceCard[][] = [];

    for (const match of matches) {
      const card: PatienceCard = {
        newIndex: match.newIndex,
        oldIndex: match.oldIndex,
        prev: null,
      };

      // 二分查找合适的栈
      let lo = 0;
      let hi = stacks.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const topCard = stacks[mid][stacks[mid].length - 1];
        if (topCard.oldIndex < match.oldIndex) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }

      // 链接到前一个栈的栈顶
      if (lo > 0) {
        card.prev = stacks[lo - 1][stacks[lo - 1].length - 1];
      }

      // 放入栈
      if (lo === stacks.length) {
        stacks.push([card]);
      } else {
        stacks[lo].push(card);
      }
    }

    // 回溯得到 LIS
    if (stacks.length === 0) {
      return [];
    }

    const lis: UniqueMatch[] = [];
    let current: PatienceCard | null =
      stacks[stacks.length - 1][stacks[stacks.length - 1].length - 1];

    while (current) {
      const match = matches.find(
        (m) => m.oldIndex === current!.oldIndex && m.newIndex === current!.newIndex
      );
      if (match) {
        lis.unshift(match);
      }
      current = current.prev;
    }

    return lis;
  }

  /**
   * 格式化差分为统一格式字符串
   */
  formatUnified(result: PatienceDiffResult, _contextLines: number = 3): string {
    const lines: string[] = [];

    // 简化版本：输出所有差分行
    for (const line of result.lines) {
      const prefix = line.op === 'equal' ? ' ' : line.op === 'insert' ? '+' : '-';
      // 移除尾部换行符以便格式化
      const content = line.line.replace(/\n$/, '');
      lines.push(`${prefix}${content}`);
    }

    return lines.join('\n');
  }

  /**
   * 格式化差分为 HTML
   */
  formatHtml(result: PatienceDiffResult): string {
    const lines: string[] = [];

    for (const line of result.lines) {
      const escaped = line.line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n$/, '');

      switch (line.op) {
        case 'insert':
          lines.push(`<div class="diff-insert" style="background:#e6ffe6;">+ ${escaped}</div>`);
          break;
        case 'delete':
          lines.push(`<div class="diff-delete" style="background:#ffe6e6;">- ${escaped}</div>`);
          break;
        default:
          lines.push(`<div class="diff-equal">  ${escaped}</div>`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 应用差分重建目标文本
   */
  applyDiff(_oldText: string, result: PatienceDiffResult): string {
    const newLines: string[] = [];

    for (const line of result.lines) {
      if (line.op !== 'delete') {
        newLines.push(line.line);
      }
    }

    return newLines.join('');
  }

  /**
   * 反转差分（交换插入和删除）
   */
  reverseDiff(result: PatienceDiffResult): PatienceDiffResult {
    const reversedLines: DiffLine[] = result.lines.map((line) => {
      if (line.op === 'insert') {
        return {
          op: 'delete' as const,
          line: line.line,
          oldIndex: line.newIndex,
        };
      } else if (line.op === 'delete') {
        return {
          op: 'insert' as const,
          line: line.line,
          newIndex: line.oldIndex,
        };
      }
      return {
        op: 'equal' as const,
        line: line.line,
        oldIndex: line.newIndex,
        newIndex: line.oldIndex,
      };
    });

    return {
      lines: reversedLines,
      oldLineCount: result.newLineCount,
      newLineCount: result.oldLineCount,
      stats: {
        equalLines: result.stats.equalLines,
        insertedLines: result.stats.deletedLines,
        deletedLines: result.stats.insertedLines,
        changeRatio: result.stats.changeRatio,
      },
      computeTimeMs: 0,
    };
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Patience Diff 引擎
 */
export function createPatienceDiffEngine(): PatienceDiffEngine {
  return new PatienceDiffEngine();
}

// ================================
// 便捷函数
// ================================

let defaultEngine: PatienceDiffEngine | null = null;

function getDefaultEngine(): PatienceDiffEngine {
  if (!defaultEngine) {
    defaultEngine = new PatienceDiffEngine();
  }
  return defaultEngine;
}

/**
 * 快速计算 Patience Diff
 */
export function quickPatienceDiff(oldText: string, newText: string): PatienceDiffResult {
  return getDefaultEngine().diff(oldText, newText);
}

/**
 * 快速格式化为统一格式
 */
export function quickFormatUnified(
  oldText: string,
  newText: string,
  contextLines?: number
): string {
  const result = getDefaultEngine().diff(oldText, newText);
  return getDefaultEngine().formatUnified(result, contextLines);
}

/**
 * 快速格式化为 HTML
 */
export function quickFormatHtml(oldText: string, newText: string): string {
  const result = getDefaultEngine().diff(oldText, newText);
  return getDefaultEngine().formatHtml(result);
}

/**
 * 重置默认引擎
 */
export function resetDefaultPatienceDiffEngine(): void {
  defaultEngine = null;
}
