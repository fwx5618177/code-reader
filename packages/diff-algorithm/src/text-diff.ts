// ================================
// Text Diff - 文本差分算法实现
// 基于 diff-match-patch 库
// 支持字符级差分、行级差分、补丁创建与应用
// ================================

import DiffMatchPatch from 'diff-match-patch';
import {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  type DiffOpType,
  type TextDiff,
  type TextDiffResult,
  type Patch,
  type PatchResult,
  type DiffStats,
  type TextDiffConfig,
  type ITextDiffAlgorithm,
} from './types';

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<TextDiffConfig> = {
  timeout: 1.0,
  semanticCleanup: true,
  efficiencyCleanup: true,
  editCost: 4,
  patchMargin: 4,
  patchDeleteThreshold: 0.5,
  matchThreshold: 0.5,
  matchDistance: 1000,
};

// ================================
// TextDiffEngine 类
// ================================

/**
 * 文本差分引擎
 *
 * 基于 Google 的 diff-match-patch 库实现，提供：
 * - 字符级差分（默认）
 * - 行级差分（Myers 算法）
 * - 补丁创建与应用
 * - 语义清理与效率优化
 *
 * @example
 * ```typescript
 * const engine = new TextDiffEngine();
 *
 * // 字符级差分
 * const result = engine.diff('hello', 'hello world');
 *
 * // 行级差分
 * const lineResult = engine.lineDiff(source, target);
 *
 * // 应用差分
 * const applied = engine.applyDiff('hello', result.diffs);
 *
 * // 创建补丁
 * const patches = engine.createPatch('hello', 'hello world');
 *
 * // 应用补丁
 * const patched = engine.applyPatch('hello', patches);
 * ```
 */
export class TextDiffEngine implements ITextDiffAlgorithm {
  public readonly name = 'dmp' as const;
  private readonly config: Required<TextDiffConfig>;
  private readonly dmp: DiffMatchPatch;

  constructor(config: TextDiffConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dmp = new DiffMatchPatch();
    this.applyConfig();
  }

  /**
   * 应用配置到 diff-match-patch 实例
   */
  private applyConfig(): void {
    this.dmp.Diff_Timeout = this.config.timeout;
    this.dmp.Diff_EditCost = this.config.editCost;
    this.dmp.Patch_Margin = this.config.patchMargin;
    this.dmp.Patch_DeleteThreshold = this.config.patchDeleteThreshold;
    this.dmp.Match_Threshold = this.config.matchThreshold;
    this.dmp.Match_Distance = this.config.matchDistance;
  }

  // ================================
  // 核心差分操作
  // ================================

  /**
   * 计算两个字符串之间的字符级差分
   *
   * @param source 源文本
   * @param target 目标文本
   * @returns 差分结果
   */
  diff(source: string, target: string): TextDiffResult {
    const startTime = performance.now();

    const diffs = this.dmp.diff_main(source, target);

    // 应用清理
    if (this.config.semanticCleanup) {
      this.dmp.diff_cleanupSemantic(diffs);
    }
    if (this.config.efficiencyCleanup) {
      this.dmp.diff_cleanupEfficiency(diffs);
    }

    const endTime = performance.now();

    return {
      diffs: diffs as TextDiff[],
      sourceLength: source.length,
      targetLength: target.length,
      computeTimeMs: endTime - startTime,
      algorithm: 'dmp',
    };
  }

  /**
   * 计算行级差分（适合代码比较）
   *
   * 使用 diff-match-patch 的 linesToChars 方法将行转换为字符，
   * 然后进行差分，最后再转换回行。
   *
   * @param source 源文本
   * @param target 目标文本
   * @returns 差分结果
   */
  lineDiff(source: string, target: string): TextDiffResult {
    const startTime = performance.now();

    // 将行转换为字符以提高效率
    const { chars1, chars2, lineArray } = this.dmp.diff_linesToChars_(source, target);
    const diffs = this.dmp.diff_main(chars1, chars2, false);
    this.dmp.diff_charsToLines_(diffs, lineArray);

    // 清理
    if (this.config.semanticCleanup) {
      this.dmp.diff_cleanupSemantic(diffs);
    }

    const endTime = performance.now();

    return {
      diffs: diffs as TextDiff[],
      sourceLength: source.length,
      targetLength: target.length,
      computeTimeMs: endTime - startTime,
      algorithm: 'myers',
    };
  }

  /**
   * 应用差分到源文本以获得目标文本
   *
   * @param source 源文本
   * @param diffs 差分操作列表
   * @returns 应用差分后的文本
   */
  applyDiff(source: string, diffs: readonly TextDiff[]): string {
    const result: string[] = [];
    let sourceIndex = 0;

    for (const [op, text] of diffs) {
      switch (op) {
        case DIFF_EQUAL:
          result.push(source.substring(sourceIndex, sourceIndex + text.length));
          sourceIndex += text.length;
          break;
        case DIFF_INSERT:
          result.push(text);
          break;
        case DIFF_DELETE:
          sourceIndex += text.length;
          break;
      }
    }

    return result.join('');
  }

  /**
   * 反转差分（交换插入和删除）
   *
   * @param diffs 原始差分
   * @returns 反转后的差分
   */
  reverseDiff(diffs: readonly TextDiff[]): TextDiff[] {
    return diffs.map(([op, text]) => {
      if (op === DIFF_INSERT) return [DIFF_DELETE, text] as TextDiff;
      if (op === DIFF_DELETE) return [DIFF_INSERT, text] as TextDiff;
      return [DIFF_EQUAL, text] as TextDiff;
    });
  }

  /**
   * 获取差分统计信息
   *
   * @param diffs 差分操作列表
   * @returns 统计信息
   */
  getStats(diffs: readonly TextDiff[]): DiffStats {
    let insertions = 0;
    let deletions = 0;
    let unchanged = 0;

    for (const [op, text] of diffs) {
      switch (op) {
        case DIFF_INSERT:
          insertions += text.length;
          break;
        case DIFF_DELETE:
          deletions += text.length;
          break;
        case DIFF_EQUAL:
          unchanged += text.length;
          break;
      }
    }

    const totalChars = insertions + deletions + unchanged;
    const changeRatio = totalChars > 0 ? (insertions + deletions) / totalChars : 0;

    return {
      insertions,
      deletions,
      unchanged,
      totalChars,
      changeRatio,
      levenshtein: this.dmp.diff_levenshtein(diffs as DiffMatchPatch.Diff[]),
    };
  }

  // ================================
  // 补丁操作
  // ================================

  /**
   * 从差分创建补丁
   *
   * @param source 源文本
   * @param diffs 差分操作列表
   * @returns 补丁列表
   */
  makePatch(source: string, diffs: readonly TextDiff[]): Patch[] {
    const patches = this.dmp.patch_make(source, diffs as DiffMatchPatch.Diff[]);
    return (patches as unknown as DiffMatchPatch.patch_obj[]).map((p) => ({
      start1: p.start1 ?? 0,
      length1: p.length1,
      start2: p.start2 ?? 0,
      length2: p.length2,
      diffs: p.diffs as TextDiff[],
    }));
  }

  /**
   * 从两个字符串直接创建补丁
   *
   * @param source 源文本
   * @param target 目标文本
   * @returns 补丁列表
   */
  createPatch(source: string, target: string): Patch[] {
    const patches = this.dmp.patch_make(source, target);
    return (patches as unknown as DiffMatchPatch.patch_obj[]).map((p) => ({
      start1: p.start1 ?? 0,
      length1: p.length1,
      start2: p.start2 ?? 0,
      length2: p.length2,
      diffs: p.diffs as TextDiff[],
    }));
  }

  /**
   * 应用补丁到文本
   *
   * @param text 源文本
   * @param patches 补丁列表
   * @returns 应用结果
   */
  applyPatch(text: string, patches: readonly Patch[]): PatchResult {
    // 转换为 DMP 格式 - 使用对象字面量而非构造函数
    const dmpPatches = patches.map((p) => ({
      start1: p.start1,
      start2: p.start2,
      length1: p.length1,
      length2: p.length2,
      diffs: p.diffs as DiffMatchPatch.Diff[],
    }));

    const [resultText, results] = this.dmp.patch_apply(
      dmpPatches as unknown as Array<typeof DiffMatchPatch.patch_obj>,
      text
    );

    return {
      text: resultText,
      results,
      success: results.every((r) => r),
    };
  }

  /**
   * 将补丁序列化为文本格式
   *
   * @param patches 补丁列表
   * @returns 序列化的补丁文本
   */
  patchToText(patches: readonly Patch[]): string {
    // 使用对象字面量而非构造函数
    const dmpPatches = patches.map((p) => ({
      start1: p.start1,
      start2: p.start2,
      length1: p.length1,
      length2: p.length2,
      diffs: p.diffs as DiffMatchPatch.Diff[],
    }));
    return this.dmp.patch_toText(dmpPatches as unknown as Array<typeof DiffMatchPatch.patch_obj>);
  }

  /**
   * 从文本格式解析补丁
   *
   * @param text 补丁文本
   * @returns 补丁列表
   */
  patchFromText(text: string): Patch[] {
    const patches = this.dmp.patch_fromText(text);
    return (patches as unknown as DiffMatchPatch.patch_obj[]).map((p) => ({
      start1: p.start1 ?? 0,
      length1: p.length1,
      start2: p.start2 ?? 0,
      length2: p.length2,
      diffs: p.diffs as TextDiff[],
    }));
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 从差分中提取源文本
   *
   * @param diffs 差分操作列表
   * @returns 源文本
   */
  getSourceText(diffs: readonly TextDiff[]): string {
    return diffs
      .filter(([op]) => op !== DIFF_INSERT)
      .map(([, text]) => text)
      .join('');
  }

  /**
   * 从差分中提取目标文本
   *
   * @param diffs 差分操作列表
   * @returns 目标文本
   */
  getTargetText(diffs: readonly TextDiff[]): string {
    return diffs
      .filter(([op]) => op !== DIFF_DELETE)
      .map(([, text]) => text)
      .join('');
  }

  /**
   * 格式化差分为可读文本
   *
   * @param diffs 差分操作列表
   * @returns 格式化的文本
   */
  formatDiff(diffs: readonly TextDiff[]): string {
    return diffs
      .map(([op, text]) => {
        switch (op) {
          case DIFF_INSERT:
            return `+[${text}]`;
          case DIFF_DELETE:
            return `-[${text}]`;
          default:
            return text;
        }
      })
      .join('');
  }

  /**
   * 格式化差分为 HTML
   *
   * @param diffs 差分操作列表
   * @returns HTML 字符串
   */
  formatDiffHtml(diffs: readonly TextDiff[]): string {
    return diffs
      .map(([op, text]) => {
        const escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');

        switch (op) {
          case DIFF_INSERT:
            return `<ins style="background:#e6ffe6;">${escaped}</ins>`;
          case DIFF_DELETE:
            return `<del style="background:#ffe6e6;">${escaped}</del>`;
          default:
            return `<span>${escaped}</span>`;
        }
      })
      .join('');
  }

  /**
   * 查找模式在文本中的最佳匹配位置
   *
   * @param text 要搜索的文本
   * @param pattern 要查找的模式
   * @param loc 期望的位置
   * @returns 最佳匹配位置，-1 表示未找到
   */
  findBestMatch(text: string, pattern: string, loc: number = 0): number {
    return this.dmp.match_main(text, pattern, loc);
  }

  // ================================
  // 配置管理
  // ================================

  /**
   * 更新配置
   *
   * @param config 新配置
   */
  updateConfig(config: Partial<TextDiffConfig>): void {
    Object.assign(this.config, config);
    this.applyConfig();
  }

  /**
   * 获取当前配置
   *
   * @returns 当前配置
   */
  getConfig(): Required<TextDiffConfig> {
    return { ...this.config };
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建文本差分引擎实例
 *
 * @param config 配置
 * @returns 文本差分引擎
 */
export function createTextDiffEngine(config?: TextDiffConfig): TextDiffEngine {
  return new TextDiffEngine(config);
}

/**
 * 创建针对代码优化的差分引擎
 *
 * @returns 代码差分引擎
 */
export function createCodeDiffEngine(): TextDiffEngine {
  return new TextDiffEngine({
    semanticCleanup: false,
    efficiencyCleanup: true,
    timeout: 2.0,
  });
}

/**
 * 创建快速差分引擎（禁用清理，提高速度）
 *
 * @returns 快速差分引擎
 */
export function createFastTextDiffEngine(): TextDiffEngine {
  return new TextDiffEngine({
    semanticCleanup: false,
    efficiencyCleanup: false,
    timeout: 0.5,
  });
}

// ================================
// 便捷函数
// ================================

// 默认实例（延迟初始化）
let defaultEngine: TextDiffEngine | null = null;

/**
 * 获取默认引擎
 */
function getDefaultEngine(): TextDiffEngine {
  if (!defaultEngine) {
    defaultEngine = new TextDiffEngine();
  }
  return defaultEngine;
}

/**
 * 快速计算差分
 *
 * @param source 源文本
 * @param target 目标文本
 * @returns 差分结果
 */
export function quickTextDiff(source: string, target: string): TextDiffResult {
  return getDefaultEngine().diff(source, target);
}

/**
 * 快速计算行级差分
 *
 * @param source 源文本
 * @param target 目标文本
 * @returns 差分结果
 */
export function quickLineDiff(source: string, target: string): TextDiffResult {
  return getDefaultEngine().lineDiff(source, target);
}

/**
 * 快速应用差分
 *
 * @param source 源文本
 * @param diffs 差分操作列表
 * @returns 应用后的文本
 */
export function quickApplyTextDiff(source: string, diffs: readonly TextDiff[]): string {
  return getDefaultEngine().applyDiff(source, diffs);
}

/**
 * 快速创建补丁
 *
 * @param source 源文本
 * @param target 目标文本
 * @returns 补丁列表
 */
export function quickCreatePatch(source: string, target: string): Patch[] {
  return getDefaultEngine().createPatch(source, target);
}

/**
 * 快速应用补丁
 *
 * @param text 源文本
 * @param patches 补丁列表
 * @returns 应用结果
 */
export function quickApplyPatch(text: string, patches: readonly Patch[]): PatchResult {
  return getDefaultEngine().applyPatch(text, patches);
}

/**
 * 快速获取差分统计
 *
 * @param diffs 差分操作列表
 * @returns 统计信息
 */
export function quickDiffStats(diffs: readonly TextDiff[]): DiffStats {
  return getDefaultEngine().getStats(diffs);
}

/**
 * 重置默认引擎
 */
export function resetDefaultTextDiffEngine(): void {
  defaultEngine = null;
}

// ================================
// 导出常量
// ================================

export { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT };
export type { DiffOpType, TextDiff, TextDiffResult, Patch, PatchResult, DiffStats, TextDiffConfig };
