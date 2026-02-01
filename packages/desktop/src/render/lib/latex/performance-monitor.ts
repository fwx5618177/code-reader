// ================================
// LaTeX 渲染性能监控模块
//
// 功能：
// 1. 记录解析和渲染性能指标
// 2. 提供性能分析报告
// 3. 检测性能瓶颈
// 4. 支持 CI 基准测试集成
// ================================

// ================================
// 类型定义
// ================================

/** 性能指标条目 */
export interface PerformanceEntry {
  /** 操作名称 */
  name: string;
  /** 操作类型 */
  type: 'parse' | 'render' | 'worker' | 'cache' | 'total';
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳 */
  endTime: number;
  /** 耗时（毫秒） */
  duration: number;
  /** 文件大小（字节） */
  fileSize?: number;
  /** 节点数量 */
  nodeCount?: number;
  /** 缓存命中率 */
  cacheHitRate?: number;
  /** 使用的解析器类型 */
  parserType?: 'legacy' | 'lezer' | 'tree-sitter';
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/** 性能统计摘要 */
export interface PerformanceStats {
  /** 总操作数 */
  totalOperations: number;
  /** 平均耗时（毫秒） */
  averageDuration: number;
  /** 最小耗时（毫秒） */
  minDuration: number;
  /** 最大耗时（毫秒） */
  maxDuration: number;
  /** 中位数耗时（毫秒） */
  medianDuration: number;
  /** P90 耗时（毫秒） */
  p90Duration: number;
  /** P95 耗时（毫秒） */
  p95Duration: number;
  /** P99 耗时（毫秒） */
  p99Duration: number;
  /** 总耗时（毫秒） */
  totalDuration: number;
}

/** 性能阈值配置 */
export interface PerformanceThresholds {
  /** 解析超时阈值（毫秒） */
  parseTimeout: number;
  /** 渲染超时阈值（毫秒） */
  renderTimeout: number;
  /** 小文件解析阈值（毫秒） */
  smallFileParseLimit: number;
  /** 大文件解析阈值（毫秒） */
  largeFileParseLimit: number;
  /** 超大文件解析阈值（毫秒） */
  hugeFileParseLimit: number;
  /** 主线程阻塞警告阈值（毫秒） */
  mainThreadBlockWarning: number;
}

/** 性能报告 */
export interface PerformanceReport {
  /** 报告生成时间 */
  generatedAt: string;
  /** 监控时长（毫秒） */
  monitoringDuration: number;
  /** 各类型操作统计 */
  statsByType: Record<string, PerformanceStats>;
  /** 警告列表 */
  warnings: PerformanceWarning[];
  /** 建议列表 */
  recommendations: string[];
  /** 原始条目数 */
  entryCount: number;
}

/** 性能警告 */
export interface PerformanceWarning {
  /** 警告级别 */
  level: 'info' | 'warning' | 'error';
  /** 警告消息 */
  message: string;
  /** 相关条目 */
  entry?: PerformanceEntry;
  /** 时间戳 */
  timestamp: number;
}

// ================================
// 默认配置
// ================================

const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  parseTimeout: 10000,
  renderTimeout: 15000,
  smallFileParseLimit: 100, // 小文件应在 100ms 内解析完成
  largeFileParseLimit: 500, // 大文件应在 500ms 内解析完成
  hugeFileParseLimit: 2000, // 超大文件应在 2000ms 内解析完成
  mainThreadBlockWarning: 50, // 主线程阻塞超过 50ms 发出警告
};

/** 最大记录条目数 */
const MAX_ENTRIES = 1000;

/** 日志前缀 */
const LOG_PREFIX = '[PerformanceMonitor]';

// ================================
// PerformanceMonitor 类
// ================================

/**
 * LaTeX 渲染性能监控器
 *
 * 单例模式，提供全局性能监控能力
 */
export class PerformanceMonitor {
  /** 单例实例 */
  private static instance: PerformanceMonitor | null = null;

  /** 性能条目列表 */
  private readonly entries: PerformanceEntry[] = [];

  /** 警告列表 */
  private readonly warnings: PerformanceWarning[] = [];

  /** 性能阈值配置 */
  private readonly thresholds: PerformanceThresholds;

  /** 监控开始时间 */
  private readonly startTime: number;

  /** 是否启用 */
  private enabled: boolean = true;

  /** 是否启用控制台日志 */
  private logToConsole: boolean = process.env.NODE_ENV === 'development';

  /** 活动计时器（用于追踪正在进行的操作） */
  private readonly activeTimers: Map<
    string,
    {
      startTime: number;
      name: string;
      type: PerformanceEntry['type'];
      metadata?: Record<string, unknown>;
    }
  > = new Map();

  private constructor(thresholds?: Partial<PerformanceThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.startTime = performance.now();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(thresholds?: Partial<PerformanceThresholds>): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor(thresholds);
    }
    return PerformanceMonitor.instance;
  }

  /**
   * 销毁单例实例
   */
  public static destroyInstance(): void {
    PerformanceMonitor.instance = null;
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 启用监控
   */
  public enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用监控
   */
  public disable(): void {
    this.enabled = false;
  }

  /**
   * 设置是否输出到控制台
   */
  public setLogToConsole(value: boolean): void {
    this.logToConsole = value;
  }

  /**
   * 开始计时
   *
   * @param name 操作名称
   * @param type 操作类型
   * @param metadata 额外元数据
   * @returns 计时器 ID
   */
  public startTimer(
    name: string,
    type: PerformanceEntry['type'],
    metadata?: Record<string, unknown>
  ): string {
    if (!this.enabled) return '';

    const timerId = `${type}_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.activeTimers.set(timerId, {
      startTime: performance.now(),
      name,
      type,
      metadata,
    });

    return timerId;
  }

  /**
   * 结束计时并记录条目
   *
   * @param timerId 计时器 ID
   * @param additionalMetadata 额外元数据（合并到原有元数据）
   * @returns 性能条目或 null（如果计时器不存在）
   */
  public endTimer(
    timerId: string,
    additionalMetadata?: Record<string, unknown>
  ): PerformanceEntry | null {
    if (!this.enabled || !timerId) return null;

    const timer = this.activeTimers.get(timerId);
    if (!timer) {
      console.warn(`${LOG_PREFIX} 计时器不存在: ${timerId}`);
      return null;
    }

    this.activeTimers.delete(timerId);

    const endTime = performance.now();
    const duration = endTime - timer.startTime;

    const entry: PerformanceEntry = {
      name: timer.name,
      type: timer.type,
      startTime: timer.startTime,
      endTime,
      duration,
      metadata: { ...timer.metadata, ...additionalMetadata },
    };

    // 从 metadata 提取特定字段
    if (additionalMetadata) {
      if (typeof additionalMetadata.fileSize === 'number') {
        entry.fileSize = additionalMetadata.fileSize;
      }
      if (typeof additionalMetadata.nodeCount === 'number') {
        entry.nodeCount = additionalMetadata.nodeCount;
      }
      if (typeof additionalMetadata.cacheHitRate === 'number') {
        entry.cacheHitRate = additionalMetadata.cacheHitRate;
      }
      if (
        additionalMetadata.parserType === 'legacy' ||
        additionalMetadata.parserType === 'lezer' ||
        additionalMetadata.parserType === 'tree-sitter'
      ) {
        entry.parserType = additionalMetadata.parserType;
      }
    }

    this.recordEntry(entry);
    return entry;
  }

  /**
   * 直接记录性能条目
   *
   * @param entry 性能条目
   */
  public recordEntry(entry: PerformanceEntry): void {
    if (!this.enabled) return;

    // 添加条目
    this.entries.push(entry);

    // 限制条目数量
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    // 检查性能阈值
    this.checkThresholds(entry);

    // 输出日志
    if (this.logToConsole) {
      const sizeInfo = entry.fileSize
        ? ` | 大小: ${(entry.fileSize / 1024).toFixed(1)}KB`
        : '';
      const parserInfo = entry.parserType ? ` | 解析器: ${entry.parserType}` : '';
      console.log(
        `${LOG_PREFIX} [${entry.type}] ${entry.name}: ${entry.duration.toFixed(2)}ms${sizeInfo}${parserInfo}`
      );
    }
  }

  /**
   * 测量函数执行时间
   *
   * @param name 操作名称
   * @param type 操作类型
   * @param fn 要测量的函数
   * @param metadata 额外元数据
   * @returns 函数返回值
   */
  public measure<T>(
    name: string,
    type: PerformanceEntry['type'],
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const timerId = this.startTimer(name, type, metadata);
    try {
      const result = fn();
      this.endTimer(timerId);
      return result;
    } catch (error) {
      this.endTimer(timerId, { error: true });
      throw error;
    }
  }

  /**
   * 测量异步函数执行时间
   *
   * @param name 操作名称
   * @param type 操作类型
   * @param fn 要测量的异步函数
   * @param metadata 额外元数据
   * @returns Promise 包装的函数返回值
   */
  public async measureAsync<T>(
    name: string,
    type: PerformanceEntry['type'],
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const timerId = this.startTimer(name, type, metadata);
    try {
      const result = await fn();
      this.endTimer(timerId);
      return result;
    } catch (error) {
      this.endTimer(timerId, { error: true });
      throw error;
    }
  }

  /**
   * 获取所有条目
   */
  public getEntries(): ReadonlyArray<PerformanceEntry> {
    return [...this.entries];
  }

  /**
   * 按类型获取条目
   */
  public getEntriesByType(type: PerformanceEntry['type']): ReadonlyArray<PerformanceEntry> {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * 获取所有警告
   */
  public getWarnings(): ReadonlyArray<PerformanceWarning> {
    return [...this.warnings];
  }

  /**
   * 计算统计信息
   */
  public calculateStats(entries: PerformanceEntry[]): PerformanceStats {
    if (entries.length === 0) {
      return {
        totalOperations: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        medianDuration: 0,
        p90Duration: 0,
        p95Duration: 0,
        p99Duration: 0,
        totalDuration: 0,
      };
    }

    const durations = entries.map((e) => e.duration).sort((a, b) => a - b);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    return {
      totalOperations: entries.length,
      averageDuration: totalDuration / entries.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      medianDuration: this.percentile(durations, 50),
      p90Duration: this.percentile(durations, 90),
      p95Duration: this.percentile(durations, 95),
      p99Duration: this.percentile(durations, 99),
      totalDuration,
    };
  }

  /**
   * 生成性能报告
   */
  public generateReport(): PerformanceReport {
    const now = performance.now();
    const monitoringDuration = now - this.startTime;

    // 按类型分组统计
    const statsByType: Record<string, PerformanceStats> = {};
    const types: PerformanceEntry['type'][] = ['parse', 'render', 'worker', 'cache', 'total'];

    for (const type of types) {
      const typeEntries = this.entries.filter((e) => e.type === type);
      if (typeEntries.length > 0) {
        statsByType[type] = this.calculateStats(typeEntries);
      }
    }

    // 生成建议
    const recommendations = this.generateRecommendations(statsByType);

    return {
      generatedAt: new Date().toISOString(),
      monitoringDuration,
      statsByType,
      warnings: [...this.warnings],
      recommendations,
      entryCount: this.entries.length,
    };
  }

  /**
   * 打印性能报告到控制台
   */
  public printReport(): void {
    const report = this.generateReport();

    console.group(`${LOG_PREFIX} 性能报告`);
    console.log(`生成时间: ${report.generatedAt}`);
    console.log(`监控时长: ${(report.monitoringDuration / 1000).toFixed(2)}s`);
    console.log(`记录条目数: ${report.entryCount}`);
    console.log('');

    for (const [type, stats] of Object.entries(report.statsByType)) {
      console.group(`[${type}] 统计`);
      console.log(`操作数: ${stats.totalOperations}`);
      console.log(`平均耗时: ${stats.averageDuration.toFixed(2)}ms`);
      console.log(`最小/最大: ${stats.minDuration.toFixed(2)}ms / ${stats.maxDuration.toFixed(2)}ms`);
      console.log(`P50/P90/P95: ${stats.medianDuration.toFixed(2)}ms / ${stats.p90Duration.toFixed(2)}ms / ${stats.p95Duration.toFixed(2)}ms`);
      console.groupEnd();
    }

    if (report.warnings.length > 0) {
      console.group('警告');
      for (const warning of report.warnings) {
        console.warn(`[${warning.level}] ${warning.message}`);
      }
      console.groupEnd();
    }

    if (report.recommendations.length > 0) {
      console.group('建议');
      for (const rec of report.recommendations) {
        console.log(`• ${rec}`);
      }
      console.groupEnd();
    }

    console.groupEnd();
  }

  /**
   * 清空所有记录
   */
  public clear(): void {
    this.entries.length = 0;
    this.warnings.length = 0;
    this.activeTimers.clear();
  }

  /**
   * 导出数据为 JSON
   */
  public exportJSON(): string {
    return JSON.stringify(
      {
        entries: this.entries,
        warnings: this.warnings,
        report: this.generateReport(),
      },
      null,
      2
    );
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 检查性能阈值
   */
  private checkThresholds(entry: PerformanceEntry): void {
    const { duration, type, fileSize } = entry;

    // 主线程阻塞警告
    if (duration > this.thresholds.mainThreadBlockWarning && type !== 'worker') {
      this.addWarning(
        'warning',
        `主线程阻塞 ${duration.toFixed(0)}ms（阈值: ${this.thresholds.mainThreadBlockWarning}ms）- ${entry.name}`,
        entry
      );
    }

    // 解析超时检查
    if (type === 'parse') {
      if (duration > this.thresholds.parseTimeout) {
        this.addWarning('error', `解析超时: ${duration.toFixed(0)}ms - ${entry.name}`, entry);
      } else if (fileSize) {
        const sizeKB = fileSize / 1024;
        if (sizeKB < 50 && duration > this.thresholds.smallFileParseLimit) {
          this.addWarning(
            'warning',
            `小文件解析过慢: ${duration.toFixed(0)}ms（期望 < ${this.thresholds.smallFileParseLimit}ms）`,
            entry
          );
        } else if (sizeKB >= 50 && sizeKB < 200 && duration > this.thresholds.largeFileParseLimit) {
          this.addWarning(
            'warning',
            `大文件解析过慢: ${duration.toFixed(0)}ms（期望 < ${this.thresholds.largeFileParseLimit}ms）`,
            entry
          );
        } else if (sizeKB >= 200 && duration > this.thresholds.hugeFileParseLimit) {
          this.addWarning(
            'warning',
            `超大文件解析过慢: ${duration.toFixed(0)}ms（期望 < ${this.thresholds.hugeFileParseLimit}ms）`,
            entry
          );
        }
      }
    }

    // 渲染超时检查
    if (type === 'render' && duration > this.thresholds.renderTimeout) {
      this.addWarning('error', `渲染超时: ${duration.toFixed(0)}ms - ${entry.name}`, entry);
    }
  }

  /**
   * 添加警告
   */
  private addWarning(
    level: PerformanceWarning['level'],
    message: string,
    entry?: PerformanceEntry
  ): void {
    const warning: PerformanceWarning = {
      level,
      message,
      entry,
      timestamp: Date.now(),
    };

    this.warnings.push(warning);

    // 限制警告数量
    if (this.warnings.length > 100) {
      this.warnings.shift();
    }

    // 输出警告到控制台
    if (this.logToConsole) {
      if (level === 'error') {
        console.error(`${LOG_PREFIX} ${message}`);
      } else if (level === 'warning') {
        console.warn(`${LOG_PREFIX} ${message}`);
      }
    }
  }

  /**
   * 计算百分位数
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  /**
   * 生成优化建议
   */
  private generateRecommendations(statsByType: Record<string, PerformanceStats>): string[] {
    const recommendations: string[] = [];

    // 解析性能建议
    if (statsByType.parse) {
      const parseStats = statsByType.parse;
      if (parseStats.p90Duration > 500) {
        recommendations.push(
          '考虑使用 Tree-sitter 解析器处理大文件，可能获得更好的性能'
        );
      }
      if (parseStats.maxDuration > 2000) {
        recommendations.push('部分文件解析耗时过长，考虑启用分块解析策略');
      }
    }

    // 渲染性能建议
    if (statsByType.render) {
      const renderStats = statsByType.render;
      if (renderStats.p90Duration > 1000) {
        recommendations.push('渲染性能较慢，考虑启用可视区域优先渲染');
      }
      if (renderStats.averageDuration > 500) {
        recommendations.push('平均渲染时间较长，建议检查是否有复杂公式可以优化');
      }
    }

    // 缓存建议
    if (statsByType.cache) {
      const cacheStats = statsByType.cache;
      if (cacheStats.totalOperations < 10) {
        recommendations.push('缓存命中次数较少，考虑增加缓存容量');
      }
    }

    // Worker 建议
    if (!statsByType.worker && statsByType.render && statsByType.render.averageDuration > 200) {
      recommendations.push('未使用 Worker 进行数学渲染，启用 Worker 可减少主线程阻塞');
    }

    return recommendations;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 获取性能监控器实例
 */
export function getPerformanceMonitor(
  thresholds?: Partial<PerformanceThresholds>
): PerformanceMonitor {
  return PerformanceMonitor.getInstance(thresholds);
}

/**
 * 销毁性能监控器实例
 */
export function destroyPerformanceMonitor(): void {
  PerformanceMonitor.destroyInstance();
}

/**
 * 快捷函数：测量同步函数执行时间
 */
export function measurePerformance<T>(
  name: string,
  type: PerformanceEntry['type'],
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  return getPerformanceMonitor().measure(name, type, fn, metadata);
}

/**
 * 快捷函数：测量异步函数执行时间
 */
export async function measurePerformanceAsync<T>(
  name: string,
  type: PerformanceEntry['type'],
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  return getPerformanceMonitor().measureAsync(name, type, fn, metadata);
}

// ================================
// 默认导出
// ================================

export default PerformanceMonitor;
