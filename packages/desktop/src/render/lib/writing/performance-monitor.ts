// ================================
// Performance Monitor
// 性能监控 - 差分/搜索性能指标收集与报告
// ================================

// ================================
// Types
// ================================

/**
 * 性能指标类型
 */
export type MetricType =
  | 'diff_compute'
  | 'diff_apply'
  | 'search_query'
  | 'search_suggest'
  | 'index_document'
  | 'index_batch'
  | 'persist_index'
  | 'load_index'
  | 'worker_task'
  | 'cache_lookup'
  | 'hash_compute';

/**
 * 单个性能指标记录
 */
export interface PerformanceMetric {
  /** 指标类型 */
  readonly type: MetricType;
  /** 开始时间（高精度时间戳） */
  readonly startTime: number;
  /** 结束时间（高精度时间戳） */
  readonly endTime: number;
  /** 持续时间（毫秒） */
  readonly duration: number;
  /** 是否成功 */
  readonly success: boolean;
  /** 输入大小（字节） */
  readonly inputSize?: number;
  /** 输出大小（字节） */
  readonly outputSize?: number;
  /** 额外元数据 */
  readonly metadata?: Record<string, unknown>;
  /** 时间戳 */
  readonly timestamp: number;
}

/**
 * 指标统计摘要
 */
export interface MetricSummary {
  /** 指标类型 */
  readonly type: MetricType;
  /** 样本数量 */
  readonly count: number;
  /** 成功数量 */
  readonly successCount: number;
  /** 失败数量 */
  readonly failureCount: number;
  /** 平均持续时间 */
  readonly avgDuration: number;
  /** 最小持续时间 */
  readonly minDuration: number;
  /** 最大持续时间 */
  readonly maxDuration: number;
  /** P50 (中位数) */
  readonly p50: number;
  /** P90 */
  readonly p90: number;
  /** P95 */
  readonly p95: number;
  /** P99 */
  readonly p99: number;
  /** 标准差 */
  readonly stdDev: number;
  /** 吞吐量（每秒操作数） */
  readonly throughput: number;
  /** 平均输入大小 */
  readonly avgInputSize: number;
  /** 平均输出大小 */
  readonly avgOutputSize: number;
}

/**
 * 完整性能报告
 */
export interface PerformanceReport {
  /** 报告生成时间 */
  readonly generatedAt: number;
  /** 报告时间范围 */
  readonly timeRange: {
    readonly start: number;
    readonly end: number;
  };
  /** 各类型指标摘要 */
  readonly summaries: Map<MetricType, MetricSummary>;
  /** 总操作数 */
  readonly totalOperations: number;
  /** 总成功数 */
  readonly totalSuccessful: number;
  /** 整体成功率 */
  readonly successRate: number;
  /** 平均持续时间（跨所有类型） */
  readonly overallAvgDuration: number;
}

/**
 * 性能监控配置
 */
export interface PerformanceMonitorConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 最大保留指标数量 */
  maxMetrics?: number;
  /** 指标过期时间（毫秒） */
  metricTTL?: number;
  /** 是否启用控制台日志 */
  consoleLog?: boolean;
  /** 慢操作阈值（毫秒） */
  slowThreshold?: number;
  /** 是否收集输入/输出大小 */
  collectSizes?: boolean;
  /** 采样率（0-1，1 表示收集所有） */
  sampleRate?: number;
}

/**
 * 活跃计时器
 */
interface ActiveTimer {
  type: MetricType;
  startTime: number;
  metadata?: Record<string, unknown>;
  inputSize?: number;
}

// ================================
// Default Configuration
// ================================

const DEFAULT_CONFIG: Required<PerformanceMonitorConfig> = {
  enabled: true,
  maxMetrics: 10000,
  metricTTL: 60 * 60 * 1000, // 1 hour
  consoleLog: false,
  slowThreshold: 1000, // 1 second
  collectSizes: true,
  sampleRate: 1.0,
};

// ================================
// Performance Monitor Implementation
// ================================

/**
 * 性能监控器
 *
 * 提供差分/搜索等操作的性能指标收集与报告：
 * - 自动过期和清理旧指标
 * - 支持采样率控制
 * - 计算统计摘要（平均值、百分位数、吞吐量等）
 * - 慢操作检测和日志
 */
export class PerformanceMonitor {
  private readonly config: Required<PerformanceMonitorConfig>;
  private metrics: PerformanceMetric[] = [];
  private activeTimers = new Map<string, ActiveTimer>();
  private nextTimerId = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: PerformanceMonitorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 启动定期清理
    if (this.config.enabled && this.config.metricTTL > 0) {
      this.startCleanupTimer();
    }
  }

  // ================================
  // Public API - Timing
  // ================================

  /**
   * 开始计时
   * @returns 计时器 ID，用于结束计时
   */
  startTimer(
    type: MetricType,
    options: { metadata?: Record<string, unknown>; inputSize?: number } = {}
  ): string | null {
    if (!this.config.enabled) return null;

    // 采样率控制
    if (this.config.sampleRate < 1 && Math.random() > this.config.sampleRate) {
      return null;
    }

    const timerId = `timer_${++this.nextTimerId}`;
    this.activeTimers.set(timerId, {
      type,
      startTime: performance.now(),
      metadata: options.metadata,
      inputSize: options.inputSize,
    });

    return timerId;
  }

  /**
   * 结束计时并记录指标
   */
  endTimer(
    timerId: string | null,
    options: { success?: boolean; outputSize?: number; metadata?: Record<string, unknown> } = {}
  ): PerformanceMetric | null {
    if (!timerId || !this.config.enabled) return null;

    const timer = this.activeTimers.get(timerId);
    if (!timer) return null;

    this.activeTimers.delete(timerId);

    const endTime = performance.now();
    const duration = endTime - timer.startTime;
    const success = options.success ?? true;

    const metric: PerformanceMetric = {
      type: timer.type,
      startTime: timer.startTime,
      endTime,
      duration,
      success,
      inputSize: timer.inputSize,
      outputSize: options.outputSize,
      metadata: { ...timer.metadata, ...options.metadata },
      timestamp: Date.now(),
    };

    this.recordMetric(metric);

    // 慢操作日志
    if (this.config.consoleLog && duration > this.config.slowThreshold) {
      console.warn(
        `[PerformanceMonitor] Slow operation detected: ${timer.type} took ${duration.toFixed(2)}ms`,
        metric.metadata
      );
    }

    return metric;
  }

  /**
   * 便捷方法：测量异步操作
   */
  async measure<T>(
    type: MetricType,
    operation: () => Promise<T>,
    options: { metadata?: Record<string, unknown>; inputSize?: number } = {}
  ): Promise<T> {
    const timerId = this.startTimer(type, options);

    try {
      const result = await operation();
      this.endTimer(timerId, { success: true });
      return result;
    } catch (error) {
      this.endTimer(timerId, { success: false, metadata: { error: String(error) } });
      throw error;
    }
  }

  /**
   * 便捷方法：测量同步操作
   */
  measureSync<T>(
    type: MetricType,
    operation: () => T,
    options: { metadata?: Record<string, unknown>; inputSize?: number } = {}
  ): T {
    const timerId = this.startTimer(type, options);

    try {
      const result = operation();
      this.endTimer(timerId, { success: true });
      return result;
    } catch (error) {
      this.endTimer(timerId, { success: false, metadata: { error: String(error) } });
      throw error;
    }
  }

  // ================================
  // Public API - Metrics Access
  // ================================

  /**
   * 获取指定类型的指标
   */
  getMetrics(type?: MetricType): PerformanceMetric[] {
    if (type) {
      return this.metrics.filter((m) => m.type === type);
    }
    return [...this.metrics];
  }

  /**
   * 获取最近的指标
   */
  getRecentMetrics(count: number, type?: MetricType): PerformanceMetric[] {
    const filtered = type ? this.metrics.filter((m) => m.type === type) : this.metrics;
    return filtered.slice(-count);
  }

  /**
   * 获取指定时间范围内的指标
   */
  getMetricsInRange(startTime: number, endTime: number, type?: MetricType): PerformanceMetric[] {
    return this.metrics.filter((m) => {
      const inRange = m.timestamp >= startTime && m.timestamp <= endTime;
      return type ? inRange && m.type === type : inRange;
    });
  }

  /**
   * 计算指标摘要
   */
  getSummary(type: MetricType): MetricSummary | null {
    const typeMetrics = this.metrics.filter((m) => m.type === type);
    if (typeMetrics.length === 0) return null;

    return this.calculateSummary(type, typeMetrics);
  }

  /**
   * 生成完整性能报告
   */
  generateReport(): PerformanceReport {
    const now = Date.now();
    const summaries = new Map<MetricType, MetricSummary>();

    // 按类型分组计算摘要
    const types = new Set(this.metrics.map((m) => m.type));
    for (const type of types) {
      const summary = this.getSummary(type);
      if (summary) {
        summaries.set(type, summary);
      }
    }

    // 计算总体统计
    const totalOperations = this.metrics.length;
    const totalSuccessful = this.metrics.filter((m) => m.success).length;
    const successRate = totalOperations > 0 ? totalSuccessful / totalOperations : 1;
    const overallAvgDuration =
      totalOperations > 0
        ? this.metrics.reduce((sum, m) => sum + m.duration, 0) / totalOperations
        : 0;

    // 时间范围
    const timestamps = this.metrics.map((m) => m.timestamp);
    const start = timestamps.length > 0 ? Math.min(...timestamps) : now;
    const end = timestamps.length > 0 ? Math.max(...timestamps) : now;

    return {
      generatedAt: now,
      timeRange: { start, end },
      summaries,
      totalOperations,
      totalSuccessful,
      successRate,
      overallAvgDuration,
    };
  }

  // ================================
  // Public API - Management
  // ================================

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics = [];
    this.activeTimers.clear();
  }

  /**
   * 清除指定类型的指标
   */
  clearByType(type: MetricType): void {
    this.metrics = this.metrics.filter((m) => m.type !== type);
  }

  /**
   * 获取当前配置
   */
  getConfig(): Required<PerformanceMonitorConfig> {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<PerformanceMonitorConfig>): void {
    Object.assign(this.config, updates);

    // 重新配置清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.config.enabled && this.config.metricTTL > 0) {
      this.startCleanupTimer();
    }
  }

  /**
   * 获取活跃计时器数量
   */
  getActiveTimerCount(): number {
    return this.activeTimers.size;
  }

  /**
   * 获取指标数量
   */
  getMetricCount(): number {
    return this.metrics.length;
  }

  /**
   * 销毁监控器
   */
  destroy(): void {
    this.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ================================
  // Private Methods
  // ================================

  /**
   * 记录单个指标
   */
  private recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    // 限制最大数量
    if (this.metrics.length > this.config.maxMetrics) {
      this.metrics = this.metrics.slice(-this.config.maxMetrics);
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    // 每分钟清理一次过期指标
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredMetrics();
    }, 60000);
  }

  /**
   * 清理过期指标
   */
  private cleanupExpiredMetrics(): void {
    const cutoff = Date.now() - this.config.metricTTL;
    this.metrics = this.metrics.filter((m) => m.timestamp > cutoff);
  }

  /**
   * 计算指标摘要
   */
  private calculateSummary(type: MetricType, metrics: PerformanceMetric[]): MetricSummary {
    const durations = metrics.map((m) => m.duration).sort((a, b) => a - b);
    const count = metrics.length;
    const successCount = metrics.filter((m) => m.success).length;
    const failureCount = count - successCount;

    // 基本统计
    const sum = durations.reduce((s, d) => s + d, 0);
    const avgDuration = sum / count;
    const minDuration = durations[0];
    const maxDuration = durations[count - 1];

    // 百分位数
    const p50 = this.percentile(durations, 50);
    const p90 = this.percentile(durations, 90);
    const p95 = this.percentile(durations, 95);
    const p99 = this.percentile(durations, 99);

    // 标准差
    const variance = durations.reduce((s, d) => s + Math.pow(d - avgDuration, 2), 0) / count;
    const stdDev = Math.sqrt(variance);

    // 吞吐量（每秒操作数）
    const timeSpanMs = metrics.length > 1
      ? metrics[metrics.length - 1].timestamp - metrics[0].timestamp
      : 1000;
    const throughput = (count / timeSpanMs) * 1000;

    // 平均输入/输出大小
    const inputSizes = metrics.filter((m) => m.inputSize != null).map((m) => m.inputSize!);
    const outputSizes = metrics.filter((m) => m.outputSize != null).map((m) => m.outputSize!);
    const avgInputSize = inputSizes.length > 0
      ? inputSizes.reduce((s, v) => s + v, 0) / inputSizes.length
      : 0;
    const avgOutputSize = outputSizes.length > 0
      ? outputSizes.reduce((s, v) => s + v, 0) / outputSizes.length
      : 0;

    return {
      type,
      count,
      successCount,
      failureCount,
      avgDuration,
      minDuration,
      maxDuration,
      p50,
      p90,
      p95,
      p99,
      stdDev,
      throughput,
      avgInputSize,
      avgOutputSize,
    };
  }

  /**
   * 计算百分位数
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedValues[lower];
    }

    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }
}

// ================================
// Factory Functions
// ================================

/**
 * 创建性能监控器实例
 */
export function createPerformanceMonitor(config?: PerformanceMonitorConfig): PerformanceMonitor {
  return new PerformanceMonitor(config);
}

/**
 * 创建高精度性能监控器（收集所有指标）
 */
export function createDetailedMonitor(): PerformanceMonitor {
  return new PerformanceMonitor({
    enabled: true,
    maxMetrics: 50000,
    metricTTL: 2 * 60 * 60 * 1000, // 2 hours
    consoleLog: true,
    slowThreshold: 500,
    collectSizes: true,
    sampleRate: 1.0,
  });
}

/**
 * 创建轻量级性能监控器（采样收集）
 */
export function createLightweightMonitor(): PerformanceMonitor {
  return new PerformanceMonitor({
    enabled: true,
    maxMetrics: 1000,
    metricTTL: 30 * 60 * 1000, // 30 minutes
    consoleLog: false,
    slowThreshold: 2000,
    collectSizes: false,
    sampleRate: 0.1, // 10% sampling
  });
}

// ================================
// Singleton Instance
// ================================

let defaultMonitor: PerformanceMonitor | null = null;

/**
 * 获取默认性能监控器
 */
export function getDefaultPerformanceMonitor(): PerformanceMonitor {
  if (!defaultMonitor) {
    defaultMonitor = createPerformanceMonitor();
  }
  return defaultMonitor;
}

/**
 * 重置默认性能监控器
 */
export function resetDefaultPerformanceMonitor(): void {
  if (defaultMonitor) {
    defaultMonitor.destroy();
    defaultMonitor = null;
  }
}

// ================================
// Utility Functions
// ================================

/**
 * 格式化性能报告为字符串
 */
export function formatReport(report: PerformanceReport): string {
  const lines: string[] = [
    '=== Performance Report ===',
    `Generated: ${new Date(report.generatedAt).toISOString()}`,
    `Time Range: ${new Date(report.timeRange.start).toISOString()} - ${new Date(report.timeRange.end).toISOString()}`,
    `Total Operations: ${report.totalOperations}`,
    `Success Rate: ${(report.successRate * 100).toFixed(2)}%`,
    `Overall Avg Duration: ${report.overallAvgDuration.toFixed(2)}ms`,
    '',
    '--- Summaries by Type ---',
  ];

  for (const [type, summary] of report.summaries) {
    lines.push(`\n[${type}]`);
    lines.push(`  Count: ${summary.count}`);
    lines.push(`  Success: ${summary.successCount} / Failure: ${summary.failureCount}`);
    lines.push(`  Avg: ${summary.avgDuration.toFixed(2)}ms`);
    lines.push(`  Min: ${summary.minDuration.toFixed(2)}ms / Max: ${summary.maxDuration.toFixed(2)}ms`);
    lines.push(`  P50: ${summary.p50.toFixed(2)}ms / P90: ${summary.p90.toFixed(2)}ms / P99: ${summary.p99.toFixed(2)}ms`);
    lines.push(`  StdDev: ${summary.stdDev.toFixed(2)}ms`);
    lines.push(`  Throughput: ${summary.throughput.toFixed(2)} ops/sec`);
    if (summary.avgInputSize > 0) {
      lines.push(`  Avg Input Size: ${formatBytes(summary.avgInputSize)}`);
    }
    if (summary.avgOutputSize > 0) {
      lines.push(`  Avg Output Size: ${formatBytes(summary.avgOutputSize)}`);
    }
  }

  return lines.join('\n');
}

/**
 * 格式化字节大小
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 导出指标为 JSON
 */
export function exportMetricsAsJSON(monitor: PerformanceMonitor): string {
  const report = monitor.generateReport();
  const summariesObj: Record<string, MetricSummary> = {};

  for (const [type, summary] of report.summaries) {
    summariesObj[type] = summary;
  }

  return JSON.stringify(
    {
      ...report,
      summaries: summariesObj,
    },
    null,
    2
  );
}
