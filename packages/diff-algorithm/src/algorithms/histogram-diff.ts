// ================================
// Histogram Diff 算法实现
// Git 默认的差分算法，对低重复内容优化
// 基于 JGit 的 Histogram Diff 实现
// ================================

/**
 * Histogram Diff 算法
 *
 * 核心思想：
 * 1. 构建行的直方图（统计每行出现次数）
 * 2. 优先匹配出现次数少的行（更有意义的锚点）
 * 3. 类似 Patience Diff，但处理非唯一行更好
 *
 * 优点：
 * - Git 默认算法，广泛验证
 * - 比 Myers 更好的结果质量
 * - 比 Patience 更好的边界情况处理
 * - 对低重复内容（如代码）特别优化
 */

// ================================
// 类型定义
// ================================

/**
 * 差分操作类型
 */
export type HistogramDiffOp = 'equal' | 'insert' | 'delete';

/**
 * 差分块
 */
export interface DiffHunk {
  /** 操作类型 */
  readonly op: HistogramDiffOp;
  /** 行内容列表 */
  readonly lines: readonly string[];
  /** 在源文件中的起始行号（0-indexed） */
  readonly oldStart: number;
  /** 在源文件中的行数 */
  readonly oldCount: number;
  /** 在目标文件中的起始行号（0-indexed） */
  readonly newStart: number;
  /** 在目标文件中的行数 */
  readonly newCount: number;
}

/**
 * 差分结果
 */
export interface HistogramDiffResult {
  /** 差分块列表 */
  readonly hunks: readonly DiffHunk[];
  /** 源行数 */
  readonly oldLineCount: number;
  /** 目标行数 */
  readonly newLineCount: number;
  /** 统计信息 */
  readonly stats: HistogramDiffStats;
  /** 计算耗时（毫秒） */
  readonly computeTimeMs: number;
}

/**
 * 差分统计
 */
export interface HistogramDiffStats {
  /** 相同行数 */
  readonly equalLines: number;
  /** 插入行数 */
  readonly insertedLines: number;
  /** 删除行数 */
  readonly deletedLines: number;
  /** 差分块数 */
  readonly hunkCount: number;
  /** 变化率 (0-1) */
  readonly changeRatio: number;
}

/**
 * 直方图条目
 */
interface HistogramEntry {
  /** 行内容 */
  line: string;
  /** 出现次数 */
  count: number;
  /** 在序列中的位置列表 */
  positions: number[];
}

/**
 * 区域匹配
 * 注意：此接口保留供未来更精细的区域匹配算法使用
 */
interface _RegionMatch {
  /** 旧序列起始 */
  oldStart: number;
  /** 旧序列结束（不含） */
  oldEnd: number;
  /** 新序列起始 */
  newStart: number;
  /** 新序列结束（不含） */
  newEnd: number;
}

// 导出类型别名以避免未使用警告，同时保持向后兼容
export type RegionMatch = _RegionMatch;

/**
 * LCS 锚点
 */
interface LCSAnchor {
  /** 旧序列位置 */
  oldIndex: number;
  /** 新序列位置 */
  newIndex: number;
  /** 匹配长度 */
  length: number;
}

// ================================
// 配置
// ================================

/**
 * Histogram Diff 配置
 */
export interface HistogramDiffConfig {
  /** 最大递归深度（防止栈溢出） */
  maxRecursionDepth?: number;
  /** 直方图最大大小（内存限制） */
  maxHistogramSize?: number;
  /** 是否忽略空白行 */
  ignoreBlankLines?: boolean;
  /** 是否忽略行尾空白 */
  ignoreTrailingWhitespace?: boolean;
}

const DEFAULT_CONFIG: Required<HistogramDiffConfig> = {
  maxRecursionDepth: 64,
  maxHistogramSize: 65536,
  ignoreBlankLines: false,
  ignoreTrailingWhitespace: false,
};

// ================================
// 核心算法实现
// ================================

/**
 * Histogram Diff 引擎
 *
 * @example
 * ```typescript
 * const engine = new HistogramDiffEngine();
 *
 * const result = engine.diff(
 *   'function foo() {\n  return 1;\n}',
 *   'function foo() {\n  return 2;\n}'
 * );
 *
 * result.hunks.forEach(hunk => {
 *   console.log(`${hunk.op}: ${hunk.lines.length} lines`);
 * });
 * ```
 */
export class HistogramDiffEngine {
  private readonly config: Required<HistogramDiffConfig>;

  constructor(config: HistogramDiffConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 计算两个文本的 Histogram Diff
   */
  diff(oldText: string, newText: string): HistogramDiffResult {
    const startTime = performance.now();

    // 分割成行
    const oldLines = this.splitLines(oldText);
    const newLines = this.splitLines(newText);

    // 计算差分
    const hunks = this.computeHistogramDiff(
      oldLines,
      newLines,
      0,
      oldLines.length,
      0,
      newLines.length,
      0
    );

    // 合并连续的相同类型块
    const mergedHunks = this.mergeHunks(hunks);

    // 统计
    let equalLines = 0;
    let insertedLines = 0;
    let deletedLines = 0;

    for (const hunk of mergedHunks) {
      switch (hunk.op) {
        case 'equal':
          equalLines += hunk.lines.length;
          break;
        case 'insert':
          insertedLines += hunk.lines.length;
          break;
        case 'delete':
          deletedLines += hunk.lines.length;
          break;
      }
    }

    const totalLines = equalLines + insertedLines + deletedLines;
    const changeRatio = totalLines > 0 ? (insertedLines + deletedLines) / totalLines : 0;

    const endTime = performance.now();

    return {
      hunks: mergedHunks,
      oldLineCount: oldLines.length,
      newLineCount: newLines.length,
      stats: {
        equalLines,
        insertedLines,
        deletedLines,
        hunkCount: mergedHunks.filter((h) => h.op !== 'equal').length,
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
    return text.split(/(?<=\n)/);
  }

  /**
   * 规范化行（用于比较）
   */
  private normalizeLine(line: string): string {
    let normalized = line;

    if (this.config.ignoreTrailingWhitespace) {
      normalized = normalized.replace(/\s+$/, '');
    }

    return normalized;
  }

  /**
   * 构建直方图
   */
  private buildHistogram(lines: string[], start: number, end: number): Map<string, HistogramEntry> {
    const histogram = new Map<string, HistogramEntry>();

    for (let i = start; i < end && histogram.size < this.config.maxHistogramSize; i++) {
      const line = lines[i];
      const normalized = this.normalizeLine(line);

      // 跳过空白行（如果配置）
      if (this.config.ignoreBlankLines && normalized.trim() === '') {
        continue;
      }

      const existing = histogram.get(normalized);
      if (existing) {
        existing.count++;
        existing.positions.push(i);
      } else {
        histogram.set(normalized, {
          line: normalized,
          count: 1,
          positions: [i],
        });
      }
    }

    return histogram;
  }

  /**
   * 递归计算 Histogram Diff
   */
  private computeHistogramDiff(
    oldLines: string[],
    newLines: string[],
    oldStart: number,
    oldEnd: number,
    newStart: number,
    newEnd: number,
    depth: number
  ): DiffHunk[] {
    const result: DiffHunk[] = [];

    // 防止栈溢出
    if (depth > this.config.maxRecursionDepth) {
      return this.fallbackDiff(oldLines, newLines, oldStart, oldEnd, newStart, newEnd);
    }

    // 基本情况
    if (oldStart >= oldEnd && newStart >= newEnd) {
      return result;
    }

    if (newStart >= newEnd) {
      // 只有删除
      result.push({
        op: 'delete',
        lines: oldLines.slice(oldStart, oldEnd),
        oldStart,
        oldCount: oldEnd - oldStart,
        newStart,
        newCount: 0,
      });
      return result;
    }

    if (oldStart >= oldEnd) {
      // 只有插入
      result.push({
        op: 'insert',
        lines: newLines.slice(newStart, newEnd),
        oldStart,
        oldCount: 0,
        newStart,
        newCount: newEnd - newStart,
      });
      return result;
    }

    // 找公共前缀
    let commonPrefix = 0;
    while (
      oldStart + commonPrefix < oldEnd &&
      newStart + commonPrefix < newEnd &&
      this.normalizeLine(oldLines[oldStart + commonPrefix]) ===
        this.normalizeLine(newLines[newStart + commonPrefix])
    ) {
      commonPrefix++;
    }

    // 找公共后缀
    let commonSuffix = 0;
    while (
      commonSuffix < oldEnd - oldStart - commonPrefix &&
      commonSuffix < newEnd - newStart - commonPrefix &&
      this.normalizeLine(oldLines[oldEnd - 1 - commonSuffix]) ===
        this.normalizeLine(newLines[newEnd - 1 - commonSuffix])
    ) {
      commonSuffix++;
    }

    // 添加公共前缀
    if (commonPrefix > 0) {
      result.push({
        op: 'equal',
        lines: oldLines.slice(oldStart, oldStart + commonPrefix),
        oldStart,
        oldCount: commonPrefix,
        newStart,
        newCount: commonPrefix,
      });
    }

    // 处理中间部分
    const midOldStart = oldStart + commonPrefix;
    const midOldEnd = oldEnd - commonSuffix;
    const midNewStart = newStart + commonPrefix;
    const midNewEnd = newEnd - commonSuffix;

    if (midOldStart < midOldEnd || midNewStart < midNewEnd) {
      const midResult = this.diffMiddle(
        oldLines,
        newLines,
        midOldStart,
        midOldEnd,
        midNewStart,
        midNewEnd,
        depth
      );
      result.push(...midResult);
    }

    // 添加公共后缀
    if (commonSuffix > 0) {
      result.push({
        op: 'equal',
        lines: oldLines.slice(oldEnd - commonSuffix, oldEnd),
        oldStart: oldEnd - commonSuffix,
        oldCount: commonSuffix,
        newStart: newEnd - commonSuffix,
        newCount: commonSuffix,
      });
    }

    return result;
  }

  /**
   * 处理中间不同的部分
   */
  private diffMiddle(
    oldLines: string[],
    newLines: string[],
    oldStart: number,
    oldEnd: number,
    newStart: number,
    newEnd: number,
    depth: number
  ): DiffHunk[] {
    // 构建新序列的直方图
    const histogram = this.buildHistogram(newLines, newStart, newEnd);

    // 在旧序列中找最佳匹配区域
    // 优先选择出现次数少的行作为锚点
    let bestAnchor: LCSAnchor | null = null;
    let bestCount = Infinity;

    for (let i = oldStart; i < oldEnd; i++) {
      const normalized = this.normalizeLine(oldLines[i]);
      const entry = histogram.get(normalized);

      if (entry && entry.count < bestCount) {
        // 找到一个更稀有的行，尝试扩展匹配
        for (const newPos of entry.positions) {
          if (newPos < newStart || newPos >= newEnd) continue;

          // 计算从这个位置开始能匹配多少行
          let length = 1;
          while (
            i + length < oldEnd &&
            newPos + length < newEnd &&
            this.normalizeLine(oldLines[i + length]) ===
              this.normalizeLine(newLines[newPos + length])
          ) {
            length++;
          }

          // 选择最长的匹配，或者出现次数更少的
          if (
            bestAnchor === null ||
            entry.count < bestCount ||
            (entry.count === bestCount && length > bestAnchor.length)
          ) {
            bestAnchor = {
              oldIndex: i,
              newIndex: newPos,
              length,
            };
            bestCount = entry.count;
          }
        }
      }
    }

    if (bestAnchor === null) {
      // 没有公共行，直接删除+插入
      return this.fallbackDiff(oldLines, newLines, oldStart, oldEnd, newStart, newEnd);
    }

    // 递归处理锚点前后的区域
    const result: DiffHunk[] = [];

    // 锚点之前
    const beforeResult = this.computeHistogramDiff(
      oldLines,
      newLines,
      oldStart,
      bestAnchor.oldIndex,
      newStart,
      bestAnchor.newIndex,
      depth + 1
    );
    result.push(...beforeResult);

    // 匹配的行
    result.push({
      op: 'equal',
      lines: oldLines.slice(bestAnchor.oldIndex, bestAnchor.oldIndex + bestAnchor.length),
      oldStart: bestAnchor.oldIndex,
      oldCount: bestAnchor.length,
      newStart: bestAnchor.newIndex,
      newCount: bestAnchor.length,
    });

    // 锚点之后
    const afterResult = this.computeHistogramDiff(
      oldLines,
      newLines,
      bestAnchor.oldIndex + bestAnchor.length,
      oldEnd,
      bestAnchor.newIndex + bestAnchor.length,
      newEnd,
      depth + 1
    );
    result.push(...afterResult);

    return result;
  }

  /**
   * 回退到简单差分（无法找到好的锚点时）
   */
  private fallbackDiff(
    oldLines: string[],
    newLines: string[],
    oldStart: number,
    oldEnd: number,
    newStart: number,
    newEnd: number
  ): DiffHunk[] {
    const result: DiffHunk[] = [];

    if (oldStart < oldEnd) {
      result.push({
        op: 'delete',
        lines: oldLines.slice(oldStart, oldEnd),
        oldStart,
        oldCount: oldEnd - oldStart,
        newStart,
        newCount: 0,
      });
    }

    if (newStart < newEnd) {
      result.push({
        op: 'insert',
        lines: newLines.slice(newStart, newEnd),
        oldStart: oldEnd,
        oldCount: 0,
        newStart,
        newCount: newEnd - newStart,
      });
    }

    return result;
  }

  /**
   * 合并连续的相同类型块
   */
  private mergeHunks(hunks: DiffHunk[]): DiffHunk[] {
    if (hunks.length === 0) return [];

    const merged: DiffHunk[] = [];
    let current = hunks[0];

    for (let i = 1; i < hunks.length; i++) {
      const next = hunks[i];

      if (current.op === next.op) {
        // 合并相同类型的块
        current = {
          op: current.op,
          lines: [...current.lines, ...next.lines],
          oldStart: current.oldStart,
          oldCount: current.oldCount + next.oldCount,
          newStart: current.newStart,
          newCount: current.newCount + next.newCount,
        };
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * 格式化差分为统一格式
   */
  formatUnified(result: HistogramDiffResult, _contextLines: number = 3): string {
    const output: string[] = [];

    for (const hunk of result.hunks) {
      for (const line of hunk.lines) {
        const prefix = hunk.op === 'equal' ? ' ' : hunk.op === 'insert' ? '+' : '-';
        const content = line.replace(/\n$/, '');
        output.push(`${prefix}${content}`);
      }
    }

    return output.join('\n');
  }

  /**
   * 格式化差分为 HTML
   */
  formatHtml(result: HistogramDiffResult): string {
    const output: string[] = [];

    for (const hunk of result.hunks) {
      for (const line of hunk.lines) {
        const escaped = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n$/, '');

        switch (hunk.op) {
          case 'insert':
            output.push(`<div class="diff-insert" style="background:#e6ffe6;">+ ${escaped}</div>`);
            break;
          case 'delete':
            output.push(`<div class="diff-delete" style="background:#ffe6e6;">- ${escaped}</div>`);
            break;
          default:
            output.push(`<div class="diff-equal">  ${escaped}</div>`);
        }
      }
    }

    return output.join('\n');
  }

  /**
   * 应用差分重建目标文本
   */
  applyDiff(_oldText: string, result: HistogramDiffResult): string {
    const newLines: string[] = [];

    for (const hunk of result.hunks) {
      if (hunk.op !== 'delete') {
        newLines.push(...hunk.lines);
      }
    }

    return newLines.join('');
  }

  /**
   * 反转差分
   */
  reverseDiff(result: HistogramDiffResult): HistogramDiffResult {
    const reversedHunks: DiffHunk[] = result.hunks.map((hunk) => {
      let newOp: HistogramDiffOp;
      if (hunk.op === 'insert') {
        newOp = 'delete';
      } else if (hunk.op === 'delete') {
        newOp = 'insert';
      } else {
        newOp = 'equal';
      }

      return {
        op: newOp,
        lines: hunk.lines,
        oldStart: hunk.newStart,
        oldCount: hunk.newCount,
        newStart: hunk.oldStart,
        newCount: hunk.oldCount,
      };
    });

    return {
      hunks: reversedHunks,
      oldLineCount: result.newLineCount,
      newLineCount: result.oldLineCount,
      stats: {
        equalLines: result.stats.equalLines,
        insertedLines: result.stats.deletedLines,
        deletedLines: result.stats.insertedLines,
        hunkCount: result.stats.hunkCount,
        changeRatio: result.stats.changeRatio,
      },
      computeTimeMs: 0,
    };
  }

  /**
   * 获取差分的行级表示
   */
  getLineChanges(result: HistogramDiffResult): LineChange[] {
    const changes: LineChange[] = [];
    let oldLineNum = 0;
    let newLineNum = 0;

    for (const hunk of result.hunks) {
      for (const line of hunk.lines) {
        switch (hunk.op) {
          case 'equal':
            changes.push({
              type: 'equal',
              line,
              oldLineNumber: oldLineNum++,
              newLineNumber: newLineNum++,
            });
            break;
          case 'delete':
            changes.push({
              type: 'delete',
              line,
              oldLineNumber: oldLineNum++,
              newLineNumber: undefined,
            });
            break;
          case 'insert':
            changes.push({
              type: 'insert',
              line,
              oldLineNumber: undefined,
              newLineNumber: newLineNum++,
            });
            break;
        }
      }
    }

    return changes;
  }
}

/**
 * 行级变更
 */
export interface LineChange {
  /** 变更类型 */
  readonly type: 'equal' | 'insert' | 'delete';
  /** 行内容 */
  readonly line: string;
  /** 在源文件中的行号（0-indexed） */
  readonly oldLineNumber?: number;
  /** 在目标文件中的行号（0-indexed） */
  readonly newLineNumber?: number;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Histogram Diff 引擎
 */
export function createHistogramDiffEngine(config?: HistogramDiffConfig): HistogramDiffEngine {
  return new HistogramDiffEngine(config);
}

/**
 * 创建忽略空白的 Histogram Diff 引擎
 */
export function createWhitespaceAgnosticDiffEngine(): HistogramDiffEngine {
  return new HistogramDiffEngine({
    ignoreBlankLines: true,
    ignoreTrailingWhitespace: true,
  });
}

// ================================
// 便捷函数
// ================================

let defaultEngine: HistogramDiffEngine | null = null;

function getDefaultEngine(): HistogramDiffEngine {
  if (!defaultEngine) {
    defaultEngine = new HistogramDiffEngine();
  }
  return defaultEngine;
}

/**
 * 快速计算 Histogram Diff
 */
export function quickHistogramDiff(oldText: string, newText: string): HistogramDiffResult {
  return getDefaultEngine().diff(oldText, newText);
}

/**
 * 快速格式化为统一格式
 */
export function quickHistogramFormatUnified(
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
export function quickHistogramFormatHtml(oldText: string, newText: string): string {
  const result = getDefaultEngine().diff(oldText, newText);
  return getDefaultEngine().formatHtml(result);
}

/**
 * 快速获取行级变更
 */
export function quickLineChanges(oldText: string, newText: string): LineChange[] {
  const result = getDefaultEngine().diff(oldText, newText);
  return getDefaultEngine().getLineChanges(result);
}

/**
 * 重置默认引擎
 */
export function resetDefaultHistogramDiffEngine(): void {
  defaultEngine = null;
}
