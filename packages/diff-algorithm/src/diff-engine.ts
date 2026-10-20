// ================================
// DiffEngine - 统一差分引擎
// 整合所有差分算法：文本差分、二进制差分、编辑距离、模糊匹配
// 提供统一接口，自动选择最佳算法
// ================================

import {
  type DiffAlgorithm,
  type TextDiff,
  type TextDiffResult,
  type BinaryDelta,
  type Patch,
  type PatchResult,
  type DiffStats,
  type DiffEngineConfig,
  type AlgorithmHints,
  type LevenshteinResult,
  type LevenshteinConfig,
  type MatchResult,
  type SearchResultItem,
  type FuzzyMatchConfig,
  type FuzzySearchConfig,
  type IDiffEngine,
  type DiffOperation,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from './types';

import { TextDiffEngine, createTextDiffEngine, type TextDiffConfig } from './text-diff';

import { BinaryDiffEngine, createBinaryDiffEngine } from './binary-diff';

import { LevenshteinEngine, createLevenshteinEngine } from './levenshtein';

import { FuzzyMatchEngine, createFuzzyMatchEngine } from './fuzzy-match';

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<DiffEngineConfig> = {
  timeout: 1.0,
  semanticCleanup: true,
  efficiencyCleanup: true,
  editCost: 4,
  patchMargin: 4,
  patchDeleteThreshold: 0.5,
  matchThreshold: 0.5,
  matchDistance: 1000,
  defaultAlgorithm: 'dmp',
  enableCache: false,
  maxCacheSize: 100,
};

// ================================
// 文件扩展名分类
// ================================

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'pyw',
  'java',
  'kt',
  'scala',
  'c',
  'cpp',
  'cc',
  'cxx',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'dart',
  'lua',
  'r',
  'sql',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'vue',
  'svelte',
  'html',
  'htm',
  'xml',
  'xhtml',
  'css',
  'scss',
  'sass',
  'less',
  'json',
  'yaml',
  'yml',
  'toml',
  'md',
  'mdx',
]);

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'ico',
  'svg',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'tar',
  'gz',
  'rar',
  '7z',
  'exe',
  'dll',
  'so',
  'dylib',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'mp4',
  'avi',
  'mkv',
  'mov',
  'wasm',
  'bin',
  'dat',
]);

// ================================
// DiffEngine 类
// ================================

/**
 * 统一差分引擎
 *
 * 整合多种差分算法，提供统一接口：
 * - 文本差分 (diff-match-patch)
 * - 二进制差分 (fossil-delta)
 * - 编辑距离 (Levenshtein)
 * - 模糊匹配 (Fuzzy)
 *
 * @example
 * ```typescript
 * const engine = new DiffEngine();
 *
 * // 文本差分
 * const textResult = engine.diff('hello', 'hello world');
 *
 * // 二进制差分
 * const binaryResult = engine.binaryDiff(sourceBytes, targetBytes);
 *
 * // 编辑距离
 * const distance = engine.distance('kitten', 'sitting');
 *
 * // 模糊搜索
 * const results = engine.search('app', ['apple', 'application', 'banana']);
 *
 * // 自动选择算法
 * const autoResult = engine.autoDiff(source, target, { isCode: true });
 * ```
 */
export class DiffEngine implements IDiffEngine {
  public readonly name = 'dmp' as const;
  private config: Required<DiffEngineConfig>;
  private textEngine: TextDiffEngine;
  private binaryEngine: BinaryDiffEngine;
  private levenshteinEngine: LevenshteinEngine;
  private fuzzyEngine: FuzzyMatchEngine;

  constructor(config: DiffEngineConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化各个引擎
    this.textEngine = createTextDiffEngine(this.getTextConfig());
    this.binaryEngine = createBinaryDiffEngine();
    this.levenshteinEngine = createLevenshteinEngine();
    this.fuzzyEngine = createFuzzyMatchEngine();
  }

  /**
   * 获取文本差分配置
   */
  private getTextConfig(): TextDiffConfig {
    return {
      timeout: this.config.timeout,
      semanticCleanup: this.config.semanticCleanup,
      efficiencyCleanup: this.config.efficiencyCleanup,
      editCost: this.config.editCost,
      patchMargin: this.config.patchMargin,
      patchDeleteThreshold: this.config.patchDeleteThreshold,
      matchThreshold: this.config.matchThreshold,
      matchDistance: this.config.matchDistance,
    };
  }

  // ================================
  // 文本差分操作 (IDiffEngine)
  // ================================

  /**
   * 计算两个字符串之间的字符级差分
   *
   * @param source 源文本
   * @param target 目标文本
   * @returns 差分结果
   */
  diff(source: string, target: string): TextDiffResult {
    return this.textEngine.diff(source, target);
  }

  /**
   * 文本差分（IDiffEngine 接口实现）
   *
   * @param source 源文本
   * @param target 目标文本
   * @returns 差分结果
   */
  textDiff(source: string, target: string): TextDiffResult {
    return this.textEngine.diff(source, target);
  }

  /**
   * 应用文本差分（IDiffEngine 接口实现）
   *
   * @param source 源文本
   * @param diffs 差分操作列表
   * @returns 应用差分后的文本
   */
  applyTextDiff(source: string, diffs: readonly TextDiff[]): string {
    return this.textEngine.applyDiff(source, diffs);
  }

  /**
   * 计算行级差分（适合代码比较）
   *
   * @param source 源文本
   * @param target 目标文本
   * @returns 差分结果
   */
  lineDiff(source: string, target: string): TextDiffResult {
    return this.textEngine.lineDiff(source, target);
  }

  /**
   * 应用差分到源文本
   *
   * @param source 源文本
   * @param diffs 差分操作列表
   * @returns 应用差分后的文本
   */
  applyDiff(source: string, diffs: readonly TextDiff[]): string {
    return this.textEngine.applyDiff(source, diffs);
  }

  /**
   * 反转差分（交换插入和删除）
   *
   * @param diffs 原始差分
   * @returns 反转后的差分
   */
  reverseDiff(diffs: readonly TextDiff[]): TextDiff[] {
    return this.textEngine.reverseDiff(diffs);
  }

  /**
   * 获取差分统计信息
   *
   * @param diffs 差分操作列表
   * @returns 统计信息
   */
  getStats(diffs: readonly TextDiff[]): DiffStats {
    return this.textEngine.getStats(diffs);
  }

  /**
   * 从差分创建补丁
   *
   * @param source 源文本
   * @param diffs 差分操作列表
   * @returns 补丁列表
   */
  makePatch(source: string, diffs: readonly TextDiff[]): Patch[] {
    return this.textEngine.makePatch(source, diffs);
  }

  /**
   * 从两个字符串直接创建补丁
   *
   * @param source 源文本
   * @param target 目标文本
   * @returns 补丁列表
   */
  createPatch(source: string, target: string): Patch[] {
    return this.textEngine.createPatch(source, target);
  }

  /**
   * 应用补丁到文本
   *
   * @param text 源文本
   * @param patches 补丁列表
   * @returns 应用结果
   */
  applyPatch(text: string, patches: readonly Patch[]): PatchResult {
    return this.textEngine.applyPatch(text, patches);
  }

  /**
   * 将补丁序列化为文本格式
   *
   * @param patches 补丁列表
   * @returns 序列化的补丁文本
   */
  patchToText(patches: readonly Patch[]): string {
    return this.textEngine.patchToText(patches);
  }

  /**
   * 从文本格式解析补丁
   *
   * @param text 补丁文本
   * @returns 补丁列表
   */
  patchFromText(text: string): Patch[] {
    return this.textEngine.patchFromText(text);
  }

  /**
   * 从差分中提取源文本
   *
   * @param diffs 差分操作列表
   * @returns 源文本
   */
  getSourceText(diffs: readonly TextDiff[]): string {
    return this.textEngine.getSourceText(diffs);
  }

  /**
   * 从差分中提取目标文本
   *
   * @param diffs 差分操作列表
   * @returns 目标文本
   */
  getTargetText(diffs: readonly TextDiff[]): string {
    return this.textEngine.getTargetText(diffs);
  }

  /**
   * 格式化差分为可读文本
   *
   * @param diffs 差分操作列表
   * @returns 格式化的文本
   */
  formatDiff(diffs: readonly TextDiff[]): string {
    return this.textEngine.formatDiff(diffs);
  }

  /**
   * 格式化差分为 HTML
   *
   * @param diffs 差分操作列表
   * @returns HTML 字符串
   */
  formatDiffHtml(diffs: readonly TextDiff[]): string {
    return this.textEngine.formatDiffHtml(diffs);
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
    return this.textEngine.findBestMatch(text, pattern, loc);
  }

  // ================================
  // 二进制差分操作 (IBinaryDiffAlgorithm)
  // ================================

  /**
   * 计算二进制差分 (实现 IBinaryDiffAlgorithm.diff)
   *
   * 注意：此方法名与 ITextDiffAlgorithm.diff 冲突，
   * 使用 binaryDiff 作为显式调用方式
   /**
    * 计算两个二进制数据之间的差分
    *
    * @param source 源数据
    * @param target 目标数据
    * @returns 差分结果
    */
  binaryDiff(source: Uint8Array | number[], target: Uint8Array | number[]): BinaryDelta {
    return this.binaryEngine.diff(source, target);
  }

  /**
   * 应用差分到源数据以获得目标数据
   *
   * @param source 源数据
   * @param delta 差分数据
   * @returns 目标数据
   */
  apply(source: Uint8Array | number[], delta: readonly number[]): Uint8Array {
    return this.binaryEngine.apply(source, delta);
  }

  /**
   * 应用二进制差分（IDiffEngine 接口实现）
   *
   * @param source 源数据
   * @param delta 差分数据
   * @returns 目标数据
   */
  applyBinaryDiff(source: Uint8Array | number[], delta: readonly number[]): Uint8Array {
    return this.binaryEngine.apply(source, delta);
  }

  /**
   * 从字符串创建二进制差分
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @returns 差分结果
   */
  binaryDiffString(source: string, target: string): BinaryDelta {
    return this.binaryEngine.diffString(source, target);
  }

  /**
   * 应用二进制差分到字符串
   *
   * @param source 源字符串
   * @param delta 差分数据
   * @returns 目标字符串
   */
  applyBinaryDiffString(source: string, delta: readonly number[]): string {
    return this.binaryEngine.applyString(source, delta);
  }

  // ================================
  // 编辑距离操作 (ILevenshteinAlgorithm)
  // ================================

  /**
   * 计算编辑距离
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @param config 配置选项
   * @returns 编辑距离结果
   */
  distance(source: string, target: string, config?: LevenshteinConfig): LevenshteinResult {
    return this.levenshteinEngine.distance(source, target, config);
  }

  /**
   * 计算相似度 (0-1)
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @param config 配置选项
   * @returns 相似度
   */
  similarity(source: string, target: string, config?: LevenshteinConfig): number {
    return this.levenshteinEngine.similarity(source, target, config);
  }

  /**
   * 从列表中查找最相似的项
   *
   * @param query 查询字符串
   * @param items 候选项列表
   * @param getKey 获取比较键的函数
   * @param config 配置选项
   * @returns 最相似的项
   */
  findMostSimilar<T>(
    query: string,
    items: readonly T[],
    getKey: (item: T) => string,
    config?: LevenshteinConfig
  ): T | null {
    return this.levenshteinEngine.findMostSimilar(query, items, getKey, config);
  }

  /**
   * 计算 Damerau-Levenshtein 距离（支持转置）
   *
   * @param source 源字符串
   * @param target 目标字符串
   * @param config 配置选项
   * @returns 编辑距离结果
   */
  damerauDistance(source: string, target: string, config?: LevenshteinConfig): LevenshteinResult {
    return this.levenshteinEngine.damerauDistance(source, target, config);
  }

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
    maxSuggestions?: number,
    maxDistance?: number
  ) {
    return this.levenshteinEngine.suggestSpelling(word, dictionary, maxSuggestions, maxDistance);
  }

  // ================================
  // 模糊匹配操作 (IFuzzyMatchAlgorithm)
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
    return this.fuzzyEngine.match(pattern, text, config);
  }

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
    return this.fuzzyEngine.search(pattern, items, config);
  }

  /**
   * 高亮文本
   *
   * @param pattern 搜索模式
   * @param text 要高亮的文本
   * @returns HTML 字符串
   */
  highlightMatch(pattern: string, text: string): string {
    return this.fuzzyEngine.highlight(pattern, text).html;
  }

  // ================================
  // 统一接口方法
  // ================================

  /**
   * 获取当前配置
   *
   * @returns 配置对象
   */
  getConfig(): DiffEngineConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   *
   * @param config 新配置
   */
  updateConfig(config: Partial<DiffEngineConfig>): void {
    this.config = { ...this.config, ...config };
    this.textEngine.updateConfig(this.getTextConfig());
  }

  /**
   * 选择最佳算法
   *
   * @param source 源数据
   * @param target 目标数据
   * @param hints 算法选择提示
   * @returns 推荐的算法
   */
  selectAlgorithm(
    source: string | Uint8Array,
    target: string | Uint8Array,
    hints?: AlgorithmHints
  ): DiffAlgorithm {
    // 如果指定了优先算法，直接使用
    if (hints?.preferredAlgorithm) {
      return hints.preferredAlgorithm;
    }

    // 二进制数据
    if (hints?.isBinary || source instanceof Uint8Array || target instanceof Uint8Array) {
      return 'binary';
    }

    // 根据文件扩展名判断
    if (hints?.fileExtension) {
      const ext = hints.fileExtension.toLowerCase().replace(/^\./, '');

      if (BINARY_EXTENSIONS.has(ext)) {
        return 'binary';
      }

      if (CODE_EXTENSIONS.has(ext) || hints?.isCode) {
        return 'myers'; // 代码使用行级差分
      }
    }

    // 代码模式
    if (hints?.isCode) {
      return 'myers';
    }

    // 默认使用字符级差分
    return 'dmp';
  }

  /**
   * 自动差分（自动选择算法）
   *
   * @param source 源数据
   * @param target 目标数据
   * @param hints 算法选择提示
   * @returns 差分结果
   */
  autoDiff(
    source: string | Uint8Array,
    target: string | Uint8Array,
    hints?: AlgorithmHints
  ): TextDiffResult | BinaryDelta {
    const algorithm = this.selectAlgorithm(source, target, hints);

    switch (algorithm) {
      case 'binary': {
        const sourceBytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
        const targetBytes = typeof target === 'string' ? new TextEncoder().encode(target) : target;
        return this.binaryDiff(sourceBytes, targetBytes);
      }

      case 'myers': {
        const sourceText = typeof source === 'string' ? source : new TextDecoder().decode(source);
        const targetText = typeof target === 'string' ? target : new TextDecoder().decode(target);
        return this.lineDiff(sourceText, targetText);
      }

      case 'dmp':
      default: {
        const sourceText = typeof source === 'string' ? source : new TextDecoder().decode(source);
        const targetText = typeof target === 'string' ? target : new TextDecoder().decode(target);
        return this.diff(sourceText, targetText);
      }
    }
  }

  /**
   * 判断是否应该使用增量保存
   *
   * @param source 源文本
   * @param target 目标文本
   * @param changeRatioThreshold 变化率阈值
   * @returns 判断结果和统计信息
   */
  shouldUseIncremental(
    source: string,
    target: string,
    changeRatioThreshold: number = 0.5
  ): { result: boolean; stats: DiffStats } {
    // 快速长度检查
    const lengthRatio =
      Math.abs(source.length - target.length) / Math.max(source.length, target.length, 1);

    if (lengthRatio > changeRatioThreshold) {
      const result = this.diff(source, target);
      const stats = this.getStats(result.diffs);
      return { result: false, stats };
    }

    const result = this.diff(source, target);
    const stats = this.getStats(result.diffs);

    return {
      result: stats.changeRatio < changeRatioThreshold,
      stats,
    };
  }

  /**
   * 将差分转换为操作格式（用于增量保存）
   *
   * @param diffs 差分操作列表
   * @returns 操作列表
   */
  diffsToOperations(diffs: readonly TextDiff[]): DiffOperation[] {
    return diffs.map(([op, value]) => ({
      type: op === DIFF_INSERT ? 'insert' : op === DIFF_DELETE ? 'delete' : 'retain',
      value: op === DIFF_EQUAL ? value.length : value,
    }));
  }

  /**
   * 将操作转换回差分格式
   *
   * @param operations 操作列表
   * @param sourceText 源文本（用于 retain 操作）
   * @returns 差分操作列表
   */
  operationsToDiffs(operations: readonly DiffOperation[], sourceText: string): TextDiff[] {
    const diffs: TextDiff[] = [];
    let sourceIndex = 0;

    for (const op of operations) {
      switch (op.type) {
        case 'insert':
          if (typeof op.value === 'string') {
            diffs.push([DIFF_INSERT, op.value]);
          }
          break;

        case 'delete':
          if (typeof op.value === 'string') {
            diffs.push([DIFF_DELETE, op.value]);
            sourceIndex += op.value.length;
          } else if (typeof op.value === 'number') {
            const text = sourceText.substring(sourceIndex, sourceIndex + op.value);
            diffs.push([DIFF_DELETE, text]);
            sourceIndex += op.value;
          }
          break;

        case 'retain':
          if (typeof op.value === 'number') {
            const text = sourceText.substring(sourceIndex, sourceIndex + op.value);
            diffs.push([DIFF_EQUAL, text]);
            sourceIndex += op.value;
          } else if (typeof op.value === 'string') {
            diffs.push([DIFF_EQUAL, op.value]);
            sourceIndex += op.value.length;
          }
          break;
      }
    }

    return diffs;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建差分引擎实例
 *
 * @param config 配置
 * @returns 差分引擎
 */
export function createDiffEngine(config?: DiffEngineConfig): DiffEngine {
  return new DiffEngine(config);
}

/**
 * 创建针对代码优化的差分引擎
 *
 * @returns 代码差分引擎
 */
export function createCodeDiffEngine(): DiffEngine {
  return new DiffEngine({
    semanticCleanup: false,
    efficiencyCleanup: true,
    timeout: 2.0,
    defaultAlgorithm: 'myers',
  });
}

/**
 * 创建快速差分引擎（禁用清理，提高速度）
 *
 * @returns 快速差分引擎
 */
export function createFastDiffEngine(): DiffEngine {
  return new DiffEngine({
    semanticCleanup: false,
    efficiencyCleanup: false,
    timeout: 0.5,
  });
}

// ================================
// 便捷函数
// ================================

// 默认实例（延迟初始化）
let defaultEngine: DiffEngine | null = null;

/**
 * 获取默认引擎
 */
function getDefaultEngine(): DiffEngine {
  if (!defaultEngine) {
    defaultEngine = new DiffEngine();
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
export function quickDiff(source: string, target: string): TextDiffResult {
  return getDefaultEngine().diff(source, target);
}

/**
 * 快速应用差分
 *
 * @param source 源文本
 * @param diffs 差分操作列表
 * @returns 应用后的文本
 */
export function quickApplyDiff(source: string, diffs: readonly TextDiff[]): string {
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
 * 快速计算二进制差分
 *
 * @param source 源数据
 * @param target 目标数据
 * @returns 差分结果
 */
export function quickBinaryDiff(
  source: Uint8Array | number[],
  target: Uint8Array | number[]
): BinaryDelta {
  return getDefaultEngine().binaryDiff(source, target);
}

/**
 * 快速应用二进制差分
 *
 * @param source 源数据
 * @param delta 差分数据
 * @returns 目标数据
 */
export function quickApplyBinaryDiff(
  source: Uint8Array | number[],
  delta: readonly number[]
): Uint8Array {
  return getDefaultEngine().apply(source, delta);
}

/**
 * 快速计算编辑距离
 *
 * @param source 源字符串
 * @param target 目标字符串
 * @returns 编辑距离
 */
export function quickDistance(source: string, target: string): number {
  return getDefaultEngine().distance(source, target).distance;
}

/**
 * 快速模糊搜索
 *
 * @param pattern 搜索模式
 * @param items 候选项列表
 * @returns 匹配结果列表
 */
export function quickSearch<T>(
  pattern: string,
  items: readonly T[],
  config?: FuzzySearchConfig<T>
): SearchResultItem<T>[] {
  return getDefaultEngine().search(pattern, items, config);
}

/**
 * 重置默认引擎
 */
export function resetDefaultDiffEngine(): void {
  defaultEngine = null;
}

// ================================
// 导出常量
// ================================

export { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT };

// ================================
// 导出类型
// ================================

export type {
  DiffAlgorithm,
  TextDiff,
  TextDiffResult,
  BinaryDelta,
  Patch,
  PatchResult,
  DiffStats,
  DiffEngineConfig,
  AlgorithmHints,
  DiffOperation,
};
