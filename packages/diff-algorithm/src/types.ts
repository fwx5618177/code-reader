// ================================
// Diff 算法库 - 类型定义
// 定义所有差分算法相关的类型
// ================================

// ================================
// 基础类型
// ================================

/**
 * 差分算法类型
 */
export type DiffAlgorithm =
  | 'dmp' // diff-match-patch (字符级)
  | 'myers' // Myers diff (行级)
  | 'binary' // fossil-delta (二进制)
  | 'levenshtein' // 编辑距离
  | 'fuzzy'; // 模糊匹配

/**
 * 差分操作类型常量
 */
export const DIFF_DELETE = -1 as const;
export const DIFF_EQUAL = 0 as const;
export const DIFF_INSERT = 1 as const;

/**
 * 差分操作类型
 */
export type DiffOpType = typeof DIFF_DELETE | typeof DIFF_EQUAL | typeof DIFF_INSERT;

/**
 * 文本差分元组 [操作类型, 文本]
 */
export type TextDiff = readonly [DiffOpType, string];

// ================================
// 文本差分类型
// ================================

/**
 * 文本差分结果
 */
export interface TextDiffResult {
  /** 差分操作列表 */
  readonly diffs: readonly TextDiff[];
  /** 源文本长度 */
  readonly sourceLength: number;
  /** 目标文本长度 */
  readonly targetLength: number;
  /** 计算耗时（毫秒） */
  readonly computeTimeMs: number;
  /** 使用的算法 */
  readonly algorithm: DiffAlgorithm;
}

/**
 * 补丁对象
 */
export interface Patch {
  /** 补丁在源文本中的起始位置 */
  readonly start1: number;
  /** 补丁在源文本中的长度 */
  readonly length1: number;
  /** 补丁在目标文本中的起始位置 */
  readonly start2: number;
  /** 补丁在目标文本中的长度 */
  readonly length2: number;
  /** 差分操作列表 */
  readonly diffs: readonly TextDiff[];
}

/**
 * 补丁应用结果
 */
export interface PatchResult {
  /** 应用后的文本 */
  readonly text: string;
  /** 每个补丁是否成功应用 */
  readonly results: readonly boolean[];
  /** 是否全部成功 */
  readonly success: boolean;
}

/**
 * 差分统计
 */
export interface DiffStats {
  /** 插入的字符数 */
  readonly insertions: number;
  /** 删除的字符数 */
  readonly deletions: number;
  /** 未变化的字符数 */
  readonly unchanged: number;
  /** 总字符数 */
  readonly totalChars: number;
  /** 变化率 (0-1) */
  readonly changeRatio: number;
  /** Levenshtein 距离 */
  readonly levenshtein: number;
}

// ================================
// 二进制差分类型
// ================================

/**
 * 二进制差分结果
 */
export interface BinaryDelta {
  /** 差分数据 */
  readonly delta: readonly number[];
  /** 原始数据长度 */
  readonly sourceLength: number;
  /** 目标数据长度 */
  readonly targetLength: number;
  /** 差分大小 */
  readonly deltaSize: number;
  /** 压缩率 (deltaSize / targetLength) */
  readonly compressionRatio: number;
}

// ================================
// 编辑距离类型
// ================================

/**
 * 编辑操作类型
 */
export type EditOperation = 'insert' | 'delete' | 'substitute' | 'match';

/**
 * 编辑步骤
 */
export interface EditStep {
  /** 操作类型 */
  readonly operation: EditOperation;
  /** 源字符索引 */
  readonly sourceIndex: number;
  /** 目标字符索引 */
  readonly targetIndex: number;
  /** 涉及的字符 */
  readonly char: string;
  /** 替换操作时的原字符 */
  readonly originalChar?: string;
}

/**
 * 编辑距离结果
 */
export interface LevenshteinResult {
  /** 编辑距离 */
  readonly distance: number;
  /** 相似度 (0-1) */
  readonly similarity: number;
  /** 源字符串长度 */
  readonly sourceLength: number;
  /** 目标字符串长度 */
  readonly targetLength: number;
  /** 计算耗时（毫秒） */
  readonly computeTimeMs: number;
  /** 编辑步骤（可选，需要额外计算） */
  readonly steps?: readonly EditStep[];
}

/**
 * 编辑距离配置
 */
export interface LevenshteinConfig {
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 插入代价 */
  insertCost?: number;
  /** 删除代价 */
  deleteCost?: number;
  /** 替换代价 */
  substituteCost?: number;
  /** 是否计算编辑步骤 */
  computeSteps?: boolean;
  /** 最大距离限制（超过则提前退出，提高性能） */
  maxDistance?: number;
}

// ================================
// 模糊匹配类型
// ================================

/**
 * 匹配结果
 */
export interface MatchResult {
  /** 是否匹配 */
  readonly matched: boolean;
  /** 匹配分数 (0-1) */
  readonly score: number;
  /** 匹配位置（在目标字符串中的起始位置） */
  readonly position: number;
  /** 匹配长度 */
  readonly length: number;
  /** 计算耗时（毫秒） */
  readonly computeTimeMs: number;
}

/**
 * 搜索结果项
 */
export interface SearchResultItem<T = unknown> {
  /** 原始项 */
  readonly item: T;
  /** 匹配分数 (0-1) */
  readonly score: number;
  /** 匹配的字段 */
  readonly matchedField?: string;
  /** 匹配位置 */
  readonly matches?: readonly MatchHighlight[];
}

/**
 * 匹配高亮
 */
export interface MatchHighlight {
  /** 起始位置 */
  readonly start: number;
  /** 结束位置 */
  readonly end: number;
}

/**
 * 模糊匹配配置
 */
export interface FuzzyMatchConfig {
  /** 匹配阈值 (0-1)，低于此分数不算匹配 */
  threshold?: number;
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 匹配距离限制 */
  maxDistance?: number;
  /** 是否包含匹配位置信息 */
  includeMatches?: boolean;
  /** 是否使用音译匹配（拼音等） */
  useTransliteration?: boolean;
}

/**
 * 模糊搜索配置
 */
export interface FuzzySearchConfig<T> extends FuzzyMatchConfig {
  /** 要搜索的字段（如果是对象） */
  keys?: readonly (keyof T | string)[];
  /** 最大返回结果数 */
  limit?: number;
  /** 是否按分数排序 */
  sortByScore?: boolean;
}

// ================================
// 差分引擎配置
// ================================

/**
 * 文本差分配置
 */
export interface TextDiffConfig {
  /** 差分超时时间（秒），0 表示无限制 */
  timeout?: number;
  /** 是否启用语义清理（合并相邻的微小差异） */
  semanticCleanup?: boolean;
  /** 是否启用效率清理（减少差分数量） */
  efficiencyCleanup?: boolean;
  /** 编辑成本阈值（用于效率清理） */
  editCost?: number;
  /** 补丁边距（上下文行数） */
  patchMargin?: number;
  /** 补丁删除阈值 */
  patchDeleteThreshold?: number;
  /** 匹配阈值 (0-1) */
  matchThreshold?: number;
  /** 匹配距离 */
  matchDistance?: number;
}

/**
 * 统一差分引擎配置
 */
export interface DiffEngineConfig extends TextDiffConfig {
  /** 默认使用的算法 */
  defaultAlgorithm?: DiffAlgorithm;
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 缓存最大条目数 */
  maxCacheSize?: number;
}

// ================================
// 增量保存相关类型
// ================================

/**
 * 增量操作
 */
export interface DiffOperation {
  /** 操作类型 */
  readonly type: 'insert' | 'delete' | 'retain';
  /** 操作值（插入的文本或保留/删除的长度） */
  readonly value: string | number;
}

/**
 * 增量保存数据
 */
export interface IncrementalSaveData {
  /** 文档 ID */
  readonly documentId: string;
  /** 基准版本 ID */
  readonly baseVersionId: number;
  /** 基准内容哈希 */
  readonly baseContentHash: string;
  /** 目标版本 ID */
  readonly targetVersionId: number;
  /** 目标内容哈希 */
  readonly targetContentHash: string;
  /** 操作列表 */
  readonly operations: readonly DiffOperation[];
  /** 时间戳 */
  readonly timestamp: number;
}

// ================================
// 算法接口
// ================================

/**
 * 文本差分算法接口
 */
export interface ITextDiffAlgorithm {
  /** 算法名称 */
  readonly name: DiffAlgorithm;

  /** 计算差分 */
  diff(source: string, target: string): TextDiffResult;

  /** 应用差分 */
  applyDiff(source: string, diffs: readonly TextDiff[]): string;

  /** 反转差分 */
  reverseDiff(diffs: readonly TextDiff[]): TextDiff[];

  /** 获取统计信息 */
  getStats(diffs: readonly TextDiff[]): DiffStats;
}

/**
 * 二进制差分算法接口
 */
export interface IBinaryDiffAlgorithm {
  /** 算法名称 */
  readonly name: string;

  /** 计算差分 */
  diff(source: Uint8Array | number[], target: Uint8Array | number[]): BinaryDelta;

  /** 应用差分 */
  apply(source: Uint8Array | number[], delta: readonly number[]): Uint8Array;
}

/**
 * 编辑距离算法接口
 */
export interface ILevenshteinAlgorithm {
  /** 计算编辑距离 */
  distance(source: string, target: string, config?: LevenshteinConfig): LevenshteinResult;

  /** 计算相似度 */
  similarity(source: string, target: string, config?: LevenshteinConfig): number;

  /** 批量计算最相似项 */
  findMostSimilar<T>(
    query: string,
    items: readonly T[],
    getKey: (item: T) => string,
    config?: LevenshteinConfig
  ): T | null;
}

/**
 * 模糊匹配算法接口
 */
export interface IFuzzyMatchAlgorithm {
  /** 匹配单个字符串 */
  match(pattern: string, text: string, config?: FuzzyMatchConfig): MatchResult;

  /** 搜索列表 */
  search<T>(
    pattern: string,
    items: readonly T[],
    config?: FuzzySearchConfig<T>
  ): SearchResultItem<T>[];
}

/**
 * 统一差分引擎接口
 *
 * 注意：由于 ITextDiffAlgorithm 和 IBinaryDiffAlgorithm 的 diff 方法签名不同，
 * 这里使用组合而非继承来避免冲突。
 */
export interface IDiffEngine extends ILevenshteinAlgorithm, IFuzzyMatchAlgorithm {
  /** 算法名称 */
  readonly name: string;

  /** 文本差分 */
  textDiff(source: string, target: string): TextDiffResult;

  /** 应用文本差分 */
  applyTextDiff(source: string, diffs: readonly TextDiff[]): string;

  /** 反转文本差分 */
  reverseDiff(diffs: readonly TextDiff[]): TextDiff[];

  /** 获取文本差分统计 */
  getStats(diffs: readonly TextDiff[]): DiffStats;

  /** 二进制差分 */
  binaryDiff(source: Uint8Array | number[], target: Uint8Array | number[]): BinaryDelta;

  /** 应用二进制差分 */
  applyBinaryDiff(source: Uint8Array | number[], delta: readonly number[]): Uint8Array;

  /** 获取配置 */
  getConfig(): DiffEngineConfig;

  /** 更新配置 */
  updateConfig(config: Partial<DiffEngineConfig>): void;

  /** 选择最佳算法 */
  selectAlgorithm(
    source: string | Uint8Array,
    target: string | Uint8Array,
    hints?: AlgorithmHints
  ): DiffAlgorithm;

  /** 自动差分（自动选择算法） */
  autoDiff(
    source: string | Uint8Array,
    target: string | Uint8Array,
    hints?: AlgorithmHints
  ): TextDiffResult | BinaryDelta;

  /** 判断是否应该使用增量保存 */
  shouldUseIncremental(
    source: string,
    target: string,
    changeRatioThreshold?: number
  ): { result: boolean; stats: DiffStats };
}

/**
 * 算法选择提示
 */
export interface AlgorithmHints {
  /** 是否为代码 */
  isCode?: boolean;
  /** 是否为二进制 */
  isBinary?: boolean;
  /** 文件扩展名 */
  fileExtension?: string;
  /** 优先使用的算法 */
  preferredAlgorithm?: DiffAlgorithm;
}

// ================================
// 工具类型
// ================================

/**
 * 深度只读类型
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/**
 * 可选的深度部分类型
 */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
