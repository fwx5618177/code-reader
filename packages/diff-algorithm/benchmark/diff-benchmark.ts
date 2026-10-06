// ================================
// Diff 算法基准测试
// 测量差分算法的真实性能指标
// ================================

import {
  createTextDiffEngine,
  createBinaryDiffEngine,
  createLevenshteinEngine,
  createFuzzyMatchEngine,
  createDiffEngine,
  quickTextDiff,
  quickBinaryDiff,
  quickLevenshteinDistance,
  quickFuzzySearch,
} from '../src';

// ================================
// 类型定义
// ================================

/**
 * 采样策略（时间预算采样，与 tinybench / benchmark.js 一致）
 *
 * 每个用例先预热，再持续采样：样本数达到 minSamples 且累计耗时达到 timeBudgetMs 后停止，
 * 或样本数达到 maxSamples 时停止。小数据用例因此获得大量样本，
 * 大数据用例在合理时间内也能得到不少于 minSamples 的真实测量。
 */
export interface SamplingConfig {
  /** 预热次数（不计入结果，用于触发 JIT 优化） */
  warmupSamples: number;
  /** 每个用例的最少样本数 */
  minSamples: number;
  /** 每个用例的最多样本数 */
  maxSamples: number;
  /** 每个用例的采样时间预算（毫秒） */
  timeBudgetMs: number;
}

/** 基准测试配置 */
export interface BenchmarkConfig {
  /** 采样策略 */
  sampling: SamplingConfig;
  /** 是否输出详细日志 */
  verbose: boolean;
  /** 测试数据大小配置 */
  dataSizes: {
    small: number;
    medium: number;
    large: number;
    xlarge: number;
  };
}

/** 单次测试结果 */
export interface BenchmarkResult {
  /** 测试名称 */
  name: string;
  /** 测试类型 */
  type: 'text-diff' | 'binary-diff' | 'levenshtein' | 'fuzzy-match' | 'unified';
  /** 数据大小（字节） */
  dataSize: number;
  /** 实际采样次数 */
  samples: number;
  /** 总耗时（毫秒） */
  totalDuration: number;
  /** 平均耗时（毫秒） */
  avgDuration: number;
  /** 最小耗时（毫秒） */
  minDuration: number;
  /** 最大耗时（毫秒） */
  maxDuration: number;
  /** P50 耗时（毫秒） */
  p50: number;
  /** P95 耗时（毫秒） */
  p95: number;
  /** P99 耗时（毫秒） */
  p99: number;
  /** 吞吐量（操作/秒） */
  opsPerSecond: number;
  /** 吞吐量（字节/秒） */
  bytesPerSecond: number;
}

/** 完整基准测试报告 */
export interface BenchmarkReport {
  /** 生成时间 */
  generatedAt: Date;
  /** 配置 */
  config: BenchmarkConfig;
  /** 测试结果 */
  results: BenchmarkResult[];
  /** 系统信息 */
  systemInfo: {
    platform: string;
    nodeVersion?: string;
  };
}

// ================================
// 默认配置
// ================================

/** 完整档位：1KB ~ 1MB 数据，每用例 1 秒采样预算 */
export const FULL_PROFILE: Omit<BenchmarkConfig, 'verbose'> = {
  sampling: { warmupSamples: 3, minSamples: 5, maxSamples: 100, timeBudgetMs: 1000 },
  dataSizes: {
    small: 1024, // 1KB
    medium: 10 * 1024, // 10KB
    large: 100 * 1024, // 100KB
    xlarge: 1024 * 1024, // 1MB
  },
};

/** 快速档位：512B ~ 32KB 数据，每用例 200 毫秒采样预算 */
export const QUICK_PROFILE: Omit<BenchmarkConfig, 'verbose'> = {
  sampling: { warmupSamples: 3, minSamples: 5, maxSamples: 50, timeBudgetMs: 200 },
  dataSizes: {
    small: 512,
    medium: 2048,
    large: 8192,
    xlarge: 32768,
  },
};

const DEFAULT_CONFIG: BenchmarkConfig = { ...FULL_PROFILE, verbose: false };

// ================================
// 辅助函数
// ================================

/** 生成指定大小的随机文本 */
function generateText(size: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n';
  let result = '';
  for (let i = 0; i < size; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** 生成修改后的文本 */
function generateModifiedText(original: string, changeRatio: number): string {
  const changeCount = Math.floor(original.length * changeRatio);
  const result = original.split('');

  for (let i = 0; i < changeCount; i++) {
    const pos = Math.floor(Math.random() * result.length);
    const action = Math.random();

    if (action < 0.33) {
      // 删除
      result.splice(pos, 1);
    } else if (action < 0.66) {
      // 插入
      result.splice(pos, 0, String.fromCharCode(97 + Math.floor(Math.random() * 26)));
    } else {
      // 替换
      result[pos] = String.fromCharCode(97 + Math.floor(Math.random() * 26));
    }
  }

  return result.join('');
}

/** 生成二进制数据 */
function generateBinaryData(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  return data;
}

/** 生成修改后的二进制数据 */
function generateModifiedBinaryData(original: Uint8Array, changeRatio: number): Uint8Array {
  const result = new Uint8Array(original);
  const changeCount = Math.floor(original.length * changeRatio);

  for (let i = 0; i < changeCount; i++) {
    const pos = Math.floor(Math.random() * result.length);
    result[pos] = Math.floor(Math.random() * 256);
  }

  return result;
}

/** 计算百分位数 */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower] ?? 0;
  }

  const weight = index - lower;
  const lowerVal = sorted[lower] ?? 0;
  const upperVal = sorted[upper] ?? 0;
  return lowerVal + weight * (upperVal - lowerVal);
}

/** 按采样策略运行计时测试：预热后在时间预算内采样 */
function runTimedTest(fn: () => void, sampling: SamplingConfig): number[] {
  for (let i = 0; i < sampling.warmupSamples; i++) {
    fn();
  }

  const durations: number[] = [];
  let elapsed = 0;

  while (
    durations.length < sampling.maxSamples &&
    (durations.length < sampling.minSamples || elapsed < sampling.timeBudgetMs)
  ) {
    const start = performance.now();
    fn();
    const duration = performance.now() - start;
    durations.push(duration);
    elapsed += duration;
  }

  return durations;
}

/** 创建测试结果 */
function createResult(
  name: string,
  type: BenchmarkResult['type'],
  dataSize: number,
  durations: number[]
): BenchmarkResult {
  const sorted = [...durations].sort((a, b) => a - b);
  const total = durations.reduce((a, b) => a + b, 0);
  const avg = total / durations.length;

  return {
    name,
    type,
    dataSize,
    samples: durations.length,
    totalDuration: total,
    avgDuration: avg,
    minDuration: sorted[0] ?? 0,
    maxDuration: sorted[sorted.length - 1] ?? 0,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    opsPerSecond: 1000 / avg,
    bytesPerSecond: dataSize / (avg / 1000),
  };
}

// ================================
// 基准测试类
// ================================

/**
 * Diff 算法基准测试
 *
 * 提供真实的性能测量：
 * - 文本差分性能
 * - 二进制差分性能
 * - 编辑距离计算性能
 * - 模糊匹配性能
 *
 * 使用示例：
 * ```typescript
 * const benchmark = new DiffBenchmark({ ...QUICK_PROFILE, verbose: true });
 * const report = benchmark.runAll();
 * console.log(formatReport(report));
 * ```
 */
export class DiffBenchmark {
  private readonly config: BenchmarkConfig;

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      dataSizes: { ...DEFAULT_CONFIG.dataSizes, ...config.dataSizes },
    };
  }

  // ================================
  // 文本差分测试
  // ================================

  /** 运行文本差分基准测试 */
  runTextDiffBenchmarks(): BenchmarkResult[] {
    const results: BenchmarkResult[] = [];
    const sizes = this.config.dataSizes;
    const engine = createTextDiffEngine();

    for (const [sizeName, size] of Object.entries(sizes)) {
      this.log(`运行文本差分测试: ${sizeName} (${size} bytes)`);

      const original = generateText(size);

      // 测试 5% 变更率
      results.push(this.runTextDiffTest(engine, `text-diff-${sizeName}-5pct`, original, 0.05));

      // 测试 20% 变更率
      results.push(this.runTextDiffTest(engine, `text-diff-${sizeName}-20pct`, original, 0.2));

      // 测试 50% 变更率
      results.push(this.runTextDiffTest(engine, `text-diff-${sizeName}-50pct`, original, 0.5));
    }

    return results;
  }

  private runTextDiffTest(
    engine: ReturnType<typeof createTextDiffEngine>,
    name: string,
    original: string,
    changeRatio: number
  ): BenchmarkResult {
    const modified = generateModifiedText(original, changeRatio);

    const durations = runTimedTest(() => {
      engine.diff(original, modified);
    }, this.config.sampling);

    return createResult(name, 'text-diff', original.length + modified.length, durations);
  }

  // ================================
  // 二进制差分测试
  // ================================

  /** 运行二进制差分基准测试 */
  runBinaryDiffBenchmarks(): BenchmarkResult[] {
    const results: BenchmarkResult[] = [];
    const sizes = this.config.dataSizes;
    const engine = createBinaryDiffEngine();

    for (const [sizeName, size] of Object.entries(sizes)) {
      this.log(`运行二进制差分测试: ${sizeName} (${size} bytes)`);

      const original = generateBinaryData(size);

      // 测试 5% 变更率
      results.push(this.runBinaryDiffTest(engine, `binary-diff-${sizeName}-5pct`, original, 0.05));

      // 测试 20% 变更率
      results.push(this.runBinaryDiffTest(engine, `binary-diff-${sizeName}-20pct`, original, 0.2));
    }

    return results;
  }

  private runBinaryDiffTest(
    engine: ReturnType<typeof createBinaryDiffEngine>,
    name: string,
    original: Uint8Array,
    changeRatio: number
  ): BenchmarkResult {
    const modified = generateModifiedBinaryData(original, changeRatio);

    const durations = runTimedTest(() => {
      engine.diff(original, modified);
    }, this.config.sampling);

    return createResult(name, 'binary-diff', original.length + modified.length, durations);
  }

  // ================================
  // 编辑距离测试
  // ================================

  /** 运行编辑距离基准测试 */
  runLevenshteinBenchmarks(): BenchmarkResult[] {
    const results: BenchmarkResult[] = [];
    const engine = createLevenshteinEngine();

    // 测试不同长度的字符串
    const lengths = [10, 50, 100, 500, 1000];

    for (const length of lengths) {
      this.log(`运行编辑距离测试: ${length} 字符`);

      const str1 = generateText(length);
      const str2 = generateModifiedText(str1, 0.2);

      const durations = runTimedTest(() => {
        engine.distance(str1, str2);
      }, this.config.sampling);

      results.push(createResult(
        `levenshtein-${length}chars`,
        'levenshtein',
        str1.length + str2.length, durations));
    }

    return results;
  }

  // ================================
  // 模糊匹配测试
  // ================================

  /** 运行模糊匹配基准测试 */
  runFuzzyMatchBenchmarks(): BenchmarkResult[] {
    const results: BenchmarkResult[] = [];
    const engine = createFuzzyMatchEngine();

    // 生成候选项列表
    const candidateCounts = [100, 500, 1000, 5000];

    for (const count of candidateCounts) {
      this.log(`运行模糊匹配测试: ${count} 个候选项`);

      const candidates = Array.from({ length: count }, (_, i) =>
        `item-${i}-${generateText(20).replace(/\s/g, '')}`
      );
      const query = 'item-500';

      const durations = runTimedTest(() => {
        engine.search(query, candidates, { limit: 10 });
      }, this.config.sampling);

      const totalSize = candidates.reduce((acc, c) => acc + c.length, 0);
      results.push(createResult(
        `fuzzy-match-${count}items`,
        'fuzzy-match',
        totalSize, durations));
    }

    return results;
  }

  // ================================
  // 统一引擎测试
  // ================================

  /** 运行统一差分引擎基准测试 */
  runUnifiedEngineBenchmarks(): BenchmarkResult[] {
    const results: BenchmarkResult[] = [];
    const engine = createDiffEngine();

    const sizes = { medium: this.config.dataSizes.medium };

    for (const [sizeName, size] of Object.entries(sizes)) {
      this.log(`运行统一引擎测试: ${sizeName} (${size} bytes)`);

      const original = generateText(size);
      const modified = generateModifiedText(original, 0.2);

      const durations = runTimedTest(() => {
        engine.diff(original, modified);
      }, this.config.sampling);

      results.push(createResult(
        `unified-engine-${sizeName}`,
        'unified',
        original.length + modified.length, durations));
    }

    return results;
  }

  // ================================
  // 便捷函数测试
  // ================================

  /** 运行便捷函数基准测试 */
  runQuickFunctionsBenchmarks(): BenchmarkResult[] {
    const results: BenchmarkResult[] = [];
    const size = this.config.dataSizes.medium;

    this.log(`运行便捷函数测试`);

    // quickTextDiff
    const text1 = generateText(size);
    const text2 = generateModifiedText(text1, 0.2);

    let durations = runTimedTest(() => {
      quickTextDiff(text1, text2);
    }, this.config.sampling);

    results.push(createResult(
      'quick-text-diff',
      'text-diff',
      text1.length + text2.length, durations));

    // quickLevenshteinDistance
    const str1 = generateText(100);
    const str2 = generateModifiedText(str1, 0.2);

    durations = runTimedTest(() => {
      quickLevenshteinDistance(str1, str2);
    }, this.config.sampling);

    results.push(createResult(
      'quick-levenshtein',
      'levenshtein',
      str1.length + str2.length, durations));

    // quickFuzzySearch
    const candidates = Array.from({ length: 500 }, (_, i) => `file-${i}.ts`);
    const query = 'file-250';

    durations = runTimedTest(() => {
      quickFuzzySearch(query, candidates, { limit: 10 });
    }, this.config.sampling);

    const totalSize = candidates.reduce((acc, c) => acc + c.length, 0);
    results.push(createResult(
      'quick-fuzzy-search',
      'fuzzy-match',
      totalSize, durations));

    return results;
  }

  // ================================
  // 运行所有测试
  // ================================

  /** 运行所有基准测试 */
  runAll(): BenchmarkReport {
    const startTime = Date.now();

    const textDiffResults = this.runTextDiffBenchmarks();
    const binaryDiffResults = this.runBinaryDiffBenchmarks();
    const levenshteinResults = this.runLevenshteinBenchmarks();
    const fuzzyMatchResults = this.runFuzzyMatchBenchmarks();
    const unifiedResults = this.runUnifiedEngineBenchmarks();
    const quickResults = this.runQuickFunctionsBenchmarks();

    const endTime = Date.now();

    this.log(`基准测试完成，总耗时: ${endTime - startTime}ms`);

    return {
      generatedAt: new Date(),
      config: this.config,
      results: [
        ...textDiffResults,
        ...binaryDiffResults,
        ...levenshteinResults,
        ...fuzzyMatchResults,
        ...unifiedResults,
        ...quickResults,
      ],
      systemInfo: this.getSystemInfo(),
    };
  }

  // ================================
  // 辅助方法
  // ================================

  private getSystemInfo(): BenchmarkReport['systemInfo'] {
    return {
      platform: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
      nodeVersion: typeof process !== 'undefined' ? process.version : undefined,
    };
  }

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[DiffBenchmark] ${message}`);
    }
  }
}

// ================================
// 报告格式化
// ================================

/** 格式化基准测试报告 */
export function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [
    '================================',
    ' Diff 算法基准测试报告',
    '================================',
    '',
    `生成时间: ${report.generatedAt.toLocaleString()}`,
    `平台: ${report.systemInfo.platform}`,
    report.systemInfo.nodeVersion ? `Node 版本: ${report.systemInfo.nodeVersion}` : '',
    `采样策略: 预热 ${report.config.sampling.warmupSamples} 次，每用例 ${report.config.sampling.minSamples}~${report.config.sampling.maxSamples} 次，时间预算 ${report.config.sampling.timeBudgetMs}ms`,
    '',
    '--------------------------------',
    ' 测试结果',
    '--------------------------------',
    '',
  ];

  // 按类型分组
  const groupedResults = new Map<string, BenchmarkResult[]>();
  for (const result of report.results) {
    const group = groupedResults.get(result.type) || [];
    group.push(result);
    groupedResults.set(result.type, group);
  }

  for (const [type, results] of groupedResults) {
    lines.push(`## ${type.toUpperCase()}`);
    lines.push('');

    for (const result of results) {
      lines.push(`  ${result.name}:`);
      lines.push(`    平均耗时: ${result.avgDuration.toFixed(3)}ms（${result.samples} 次采样）`);
      lines.push(`    P50/P95/P99: ${result.p50.toFixed(3)}/${result.p95.toFixed(3)}/${result.p99.toFixed(3)}ms`);
      lines.push(`    吞吐量: ${result.opsPerSecond.toFixed(1)} ops/s, ${formatBytes(result.bytesPerSecond)}/s`);
      lines.push('');
    }
  }

  return lines.filter(Boolean).join('\n');
}

/** 格式化字节数 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes.toFixed(0)} B`;
}

/** 导出报告为 JSON */
export function exportReportAsJSON(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

// ================================
// 便捷函数
// ================================

/** 运行快速基准测试 */
export function runQuickBenchmark(verbose = false): BenchmarkReport {
  return new DiffBenchmark({ ...QUICK_PROFILE, verbose }).runAll();
}

/** 运行完整基准测试 */
export function runFullBenchmark(verbose = false): BenchmarkReport {
  return new DiffBenchmark({ ...FULL_PROFILE, verbose }).runAll();
}

// ================================
// CLI 入口
// ================================

if (typeof process !== 'undefined' && process.argv[1]?.includes('diff-benchmark')) {
  console.log('开始运行 Diff 算法基准测试...\n');

  const benchmark = new DiffBenchmark({ verbose: true });
  const report = benchmark.runAll();

  console.log('\n');
  console.log(formatReport(report));
}
