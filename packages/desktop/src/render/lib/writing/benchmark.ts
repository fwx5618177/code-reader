// ================================
// 性能基准测试工具
// 测量写作模块的真实性能指标
// ================================

import {
  PerformanceMonitor,
  createPerformanceMonitor,
  type PerformanceReport,
} from './performance-monitor';
import { WritingService, createWritingService } from './writing-service';
import type { IndexableDocument } from './types';

// ================================
// 类型定义
// ================================

/**
 * 基准测试配置
 */
export interface BenchmarkConfig {
  /** 测试迭代次数 */
  iterations?: number;
  /** 预热次数 */
  warmupIterations?: number;
  /** 是否输出详细日志 */
  verbose?: boolean;
  /** 测试数据大小配置 */
  dataSizes?: {
    small?: number; // 默认 1KB
    medium?: number; // 默认 10KB
    large?: number; // 默认 100KB
    xlarge?: number; // 默认 1MB
  };
}

/**
 * 单次测试结果
 */
export interface BenchmarkResult {
  /** 测试名称 */
  name: string;
  /** 测试类型 */
  type: 'diff' | 'search' | 'index' | 'persist';
  /** 数据大小（字节） */
  dataSize: number;
  /** 迭代次数 */
  iterations: number;
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
  /** 所有耗时（毫秒） */
  durations: number[];
}

/**
 * 完整基准测试报告
 */
export interface BenchmarkReport {
  /** 生成时间 */
  generatedAt: Date;
  /** 配置 */
  config: Required<BenchmarkConfig>;
  /** 测试结果 */
  results: BenchmarkResult[];
  /** 性能监控报告 */
  performanceReport?: PerformanceReport;
  /** 系统信息 */
  systemInfo: {
    userAgent: string;
    platform: string;
    memory?: number;
    cores?: number;
  };
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<BenchmarkConfig> = {
  iterations: 100,
  warmupIterations: 10,
  verbose: false,
  dataSizes: {
    small: 1024, // 1KB
    medium: 10 * 1024, // 10KB
    large: 100 * 1024, // 100KB
    xlarge: 1024 * 1024, // 1MB
  },
};

// ================================
// 辅助函数
// ================================

/**
 * 生成指定大小的随机文本
 */
function generateText(size: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n';
  let result = '';
  for (let i = 0; i < size; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成带有部分修改的文本
 */
function generateModifiedText(original: string, changeRatio: number): string {
  const changeCount = Math.floor(original.length * changeRatio);
  const result = original.split('');

  for (let i = 0; i < changeCount; i++) {
    const pos = Math.floor(Math.random() * result.length);
    const action = Math.random();

    if (action < 0.33) {
      // 插入
      result.splice(pos, 0, 'X');
    } else if (action < 0.66) {
      // 删除
      result.splice(pos, 1);
    } else {
      // 替换
      result[pos] = 'Y';
    }
  }

  return result.join('');
}

/**
 * 生成测试文档
 */
function generateDocuments(count: number, contentSize: number): IndexableDocument[] {
  const docs: IndexableDocument[] = [];
  for (let i = 0; i < count; i++) {
    docs.push({
      id: `doc-${i}`,
      title: `测试文档 ${i}`,
      content: generateText(contentSize),
      path: `/documents/doc-${i}.md`,
      type: 'document',
    });
  }
  return docs;
}

/**
 * 计算百分位数
 */
function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * 执行计时测试
 */
async function runTimedTest(fn: () => Promise<void> | void, iterations: number): Promise<number[]> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    durations.push(end - start);
  }

  return durations;
}

// ================================
// 基准测试类
// ================================

/**
 * 写作模块基准测试
 *
 * 提供真实的性能测量：
 * - 差分计算性能
 * - 搜索性能
 * - 索引性能
 * - 持久化性能
 *
 * 使用示例：
 * ```typescript
 * const benchmark = new WritingBenchmark({ iterations: 50 });
 * const report = await benchmark.runAll();
 * console.log(formatBenchmarkReport(report));
 * ```
 */
export class WritingBenchmark {
  private readonly config: Required<BenchmarkConfig>;
  private monitor: PerformanceMonitor;
  private service: WritingService | null = null;

  constructor(config: BenchmarkConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      dataSizes: { ...DEFAULT_CONFIG.dataSizes, ...config.dataSizes },
    };
    this.monitor = createPerformanceMonitor({
      enabled: true,
      consoleLog: this.config.verbose,
    });
  }

  // ================================
  // 差分测试
  // ================================

  /**
   * 运行差分基准测试
   */
  async runDiffBenchmarks(): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const sizes = this.config.dataSizes;

    await this.ensureService();

    // 测试不同大小
    for (const [sizeName, size] of Object.entries(sizes)) {
      this.log(`运行差分测试: ${sizeName} (${size} bytes)`);

      const original = generateText(size);

      // 测试 5% 变更率
      results.push(await this.runDiffTest(`diff-${sizeName}-5pct`, original, 0.05));

      // 测试 20% 变更率
      results.push(await this.runDiffTest(`diff-${sizeName}-20pct`, original, 0.2));

      // 测试 50% 变更率
      results.push(await this.runDiffTest(`diff-${sizeName}-50pct`, original, 0.5));
    }

    return results;
  }

  private async runDiffTest(
    name: string,
    original: string,
    changeRatio: number
  ): Promise<BenchmarkResult> {
    const modified = generateModifiedText(original, changeRatio);

    // 预热
    for (let i = 0; i < this.config.warmupIterations; i++) {
      await this.service!.computeDiff(original, modified);
    }

    // 正式测试
    const durations = await runTimedTest(async () => {
      await this.service!.computeDiff(original, modified);
    }, this.config.iterations);

    return this.createResult(name, 'diff', original.length + modified.length, durations);
  }

  // ================================
  // 搜索测试
  // ================================

  /**
   * 运行搜索基准测试
   */
  async runSearchBenchmarks(): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    await this.ensureService();

    // 测试不同文档数量
    const docCounts = [10, 50, 100, 500];
    const contentSize = 1024; // 每个文档 1KB

    for (const count of docCounts) {
      this.log(`运行搜索测试: ${count} 个文档`);

      // 生成并索引文档
      const docs = generateDocuments(count, contentSize);
      await this.service!.indexDocuments(docs);

      // 测试简单搜索
      results.push(await this.runSearchTest(`search-${count}docs-simple`, '测试'));

      // 测试模糊搜索
      results.push(
        await this.runSearchTest(`search-${count}docs-fuzzy`, '测试文档', { fuzzy: true })
      );

      // 清空索引准备下一轮
      await this.service!.clearIndex();
    }

    return results;
  }

  private async runSearchTest(
    name: string,
    query: string,
    options?: { fuzzy?: boolean }
  ): Promise<BenchmarkResult> {
    // 预热
    for (let i = 0; i < this.config.warmupIterations; i++) {
      await this.service!.search(query, options);
    }

    // 正式测试
    const durations = await runTimedTest(async () => {
      await this.service!.search(query, options);
    }, this.config.iterations);

    return this.createResult(name, 'search', query.length, durations);
  }

  // ================================
  // 索引测试
  // ================================

  /**
   * 运行索引基准测试
   */
  async runIndexBenchmarks(): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    await this.ensureService();

    const sizes = this.config.dataSizes;

    // 测试单文档索引
    for (const [sizeName, size] of Object.entries(sizes)) {
      this.log(`运行索引测试: ${sizeName} (${size} bytes)`);
      results.push(await this.runIndexTest(`index-single-${sizeName}`, 1, size));
    }

    // 测试批量索引
    results.push(await this.runIndexTest('index-batch-10', 10, 1024));
    results.push(await this.runIndexTest('index-batch-50', 50, 1024));
    results.push(await this.runIndexTest('index-batch-100', 100, 1024));

    return results;
  }

  private async runIndexTest(
    name: string,
    docCount: number,
    contentSize: number
  ): Promise<BenchmarkResult> {
    const totalSize = docCount * contentSize;

    // 预热
    for (let i = 0; i < Math.min(this.config.warmupIterations, 3); i++) {
      const docs = generateDocuments(docCount, contentSize);
      await this.service!.indexDocuments(docs);
      await this.service!.clearIndex();
    }

    // 正式测试
    const durations = await runTimedTest(
      async () => {
        const docs = generateDocuments(docCount, contentSize);
        await this.service!.indexDocuments(docs);
        await this.service!.clearIndex();
      },
      Math.min(this.config.iterations, 20)
    ); // 索引测试减少迭代次数

    return this.createResult(name, 'index', totalSize, durations);
  }

  // ================================
  // 运行所有测试
  // ================================

  /**
   * 运行所有基准测试
   */
  async runAll(): Promise<BenchmarkReport> {
    this.log('开始基准测试...');
    const startTime = Date.now();

    const diffResults = await this.runDiffBenchmarks();
    const searchResults = await this.runSearchBenchmarks();
    const indexResults = await this.runIndexBenchmarks();

    const endTime = Date.now();
    this.log(`基准测试完成，总耗时: ${endTime - startTime}ms`);

    // 清理
    await this.cleanup();

    return {
      generatedAt: new Date(),
      config: this.config,
      results: [...diffResults, ...searchResults, ...indexResults],
      performanceReport: this.monitor.generateReport(),
      systemInfo: this.getSystemInfo(),
    };
  }

  // ================================
  // 辅助方法
  // ================================

  private async ensureService(): Promise<void> {
    if (!this.service) {
      this.service = createWritingService({
        enableSearchIndex: true,
        enableDiffCache: true,
        enableWorker: true,
        debug: this.config.verbose,
      });
      await this.service.initialize();
    }
  }

  private async cleanup(): Promise<void> {
    if (this.service) {
      this.service.destroy();
      this.service = null;
    }
  }

  private createResult(
    name: string,
    type: 'diff' | 'search' | 'index' | 'persist',
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
      iterations: durations.length,
      totalDuration: total,
      avgDuration: avg,
      minDuration: sorted[0],
      maxDuration: sorted[sorted.length - 1],
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      opsPerSecond: (durations.length / total) * 1000,
      bytesPerSecond: ((dataSize * durations.length) / total) * 1000,
      durations,
    };
  }

  private getSystemInfo(): BenchmarkReport['systemInfo'] {
    const info: BenchmarkReport['systemInfo'] = {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js',
      platform: typeof navigator !== 'undefined' ? navigator.platform : process.platform,
    };

    // 尝试获取内存信息
    if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
      info.memory = (navigator as { deviceMemory?: number }).deviceMemory;
    }

    // 尝试获取 CPU 核心数
    if (typeof navigator !== 'undefined' && 'hardwareConcurrency' in navigator) {
      info.cores = navigator.hardwareConcurrency;
    }

    return info;
  }

  private log(...args: unknown[]): void {
    if (this.config.verbose) {
      console.log('[Benchmark]', ...args);
    }
  }
}

// ================================
// 格式化函数
// ================================

/**
 * 格式化基准测试报告为文本
 */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [
    '╔════════════════════════════════════════════════════════════════╗',
    '║              写作模块性能基准测试报告                            ║',
    '╠════════════════════════════════════════════════════════════════╣',
    '',
    `生成时间: ${report.generatedAt.toLocaleString()}`,
    `迭代次数: ${report.config.iterations}`,
    `预热次数: ${report.config.warmupIterations}`,
    '',
    '系统信息:',
    `  平台: ${report.systemInfo.platform}`,
    `  内存: ${report.systemInfo.memory ? `${report.systemInfo.memory}GB` : '未知'}`,
    `  核心: ${report.systemInfo.cores ?? '未知'}`,
    '',
    '╠════════════════════════════════════════════════════════════════╣',
    '',
  ];

  // 按类型分组结果
  const groupedResults = new Map<string, BenchmarkResult[]>();
  for (const result of report.results) {
    const group = groupedResults.get(result.type) ?? [];
    group.push(result);
    groupedResults.set(result.type, group);
  }

  for (const [type, results] of groupedResults) {
    lines.push(`【${type.toUpperCase()} 测试】`);
    lines.push('─'.repeat(66));
    lines.push(
      '名称'.padEnd(30) + '平均(ms)'.padStart(10) + 'P95(ms)'.padStart(10) + '吞吐量'.padStart(16)
    );
    lines.push('─'.repeat(66));

    for (const result of results) {
      const throughput =
        result.type === 'diff' || result.type === 'index'
          ? `${formatBytes(result.bytesPerSecond)}/s`
          : `${result.opsPerSecond.toFixed(1)} ops/s`;

      lines.push(
        result.name.padEnd(30) +
          result.avgDuration.toFixed(2).padStart(10) +
          result.p95.toFixed(2).padStart(10) +
          throughput.padStart(16)
      );
    }

    lines.push('');
  }

  lines.push('╚════════════════════════════════════════════════════════════════╝');

  return lines.join('\n');
}

/**
 * 格式化字节数
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

/**
 * 导出基准测试结果为 JSON
 */
export function exportBenchmarkAsJSON(report: BenchmarkReport): string {
  return JSON.stringify(
    {
      ...report,
      generatedAt: new Date(report.generatedAt).toISOString(),
      performanceReport: report.performanceReport
        ? {
            ...report.performanceReport,
            generatedAt: new Date(report.performanceReport.generatedAt).toISOString(),
            timeRange: {
              start: new Date(report.performanceReport.timeRange.start).toISOString(),
              end: new Date(report.performanceReport.timeRange.end).toISOString(),
            },
          }
        : undefined,
      // 排除原始 durations 数组以减小文件大小
      results: report.results.map(({ durations: _, ...rest }) => rest),
    },
    null,
    2
  );
}

// ================================
// 便捷函数
// ================================

/**
 * 快速运行基准测试
 */
export async function runQuickBenchmark(): Promise<BenchmarkReport> {
  const benchmark = new WritingBenchmark({
    iterations: 20,
    warmupIterations: 3,
    verbose: true,
  });
  return benchmark.runAll();
}

/**
 * 运行完整基准测试
 */
export async function runFullBenchmark(): Promise<BenchmarkReport> {
  const benchmark = new WritingBenchmark({
    iterations: 100,
    warmupIterations: 10,
    verbose: true,
  });
  return benchmark.runAll();
}

export default WritingBenchmark;
