// ================================
// 文档服务与写作服务集成模块
// 负责集成搜索索引、差分缓存和性能监控
// ================================

import {
  WritingService,
  getDefaultWritingService,
  PerformanceMonitor,
  getDefaultPerformanceMonitor,
  type IndexableDocument,
  type DocumentSearchResult,
  type DocumentSearchOptions,
  type DiffOptions,
} from '../writing';
import type { TextDiffResult, DiffStats } from '@code-reader/diff-algorithm';

// ================================
// 类型定义
// ================================

/**
 * 文档索引项
 */
export interface DocumentIndexItem {
  /** 文档 ID */
  id: string;
  /** 文档标题 */
  title: string;
  /** 文档内容 */
  content: string;
  /** 文档路径（可选） */
  path?: string;
}

/**
 * 写作集成配置
 */
export interface WritingIntegrationConfig {
  /** 是否启用搜索索引 */
  enableSearchIndex?: boolean;
  /** 是否启用差分缓存 */
  enableDiffCache?: boolean;
  /** 是否启用性能监控 */
  enablePerformanceMonitor?: boolean;
  /** 增量保存阈值（字节） */
  incrementalThreshold?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * 增量保存决策结果
 */
export interface IncrementalSaveDecision {
  /** 是否使用增量保存 */
  useIncremental: boolean;
  /** 决策原因 */
  reason: string;
  /** 差分统计（如果计算了的话） */
  stats?: DiffStats;
  /** 差分结果（如果计算了的话） */
  diff?: TextDiffResult;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<WritingIntegrationConfig> = {
  enableSearchIndex: true,
  enableDiffCache: true,
  enablePerformanceMonitor: true,
  incrementalThreshold: 1024, // 1KB
  debug: false,
};

// ================================
// 写作集成类
// ================================

/**
 * 写作集成服务
 *
 * 提供文档服务与写作服务之间的集成层：
 * - 自动管理搜索索引
 * - 智能差分计算和缓存
 * - 性能监控埋点
 *
 * 使用示例：
 * ```typescript
 * const integration = await WritingIntegration.getInstance();
 *
 * // 索引文档
 * await integration.indexDocument({ id: '1', title: '标题', content: '内容' });
 *
 * // 搜索文档
 * const results = await integration.search('关键词');
 *
 * // 计算差分
 * const decision = await integration.computeIncrementalSaveDecision(oldContent, newContent);
 * ```
 */
export class WritingIntegration {
  private static instance: WritingIntegration | null = null;

  private writingService: WritingService | null = null;
  private performanceMonitor: PerformanceMonitor | null = null;
  private readonly config: Required<WritingIntegrationConfig>;
  private initialized = false;

  private constructor(config: WritingIntegrationConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 单例模式
  // ================================

  /**
   * 获取单例实例
   */
  static async getInstance(config?: WritingIntegrationConfig): Promise<WritingIntegration> {
    if (!WritingIntegration.instance) {
      WritingIntegration.instance = new WritingIntegration(config);
      await WritingIntegration.instance.initialize();
    }
    return WritingIntegration.instance;
  }

  /**
   * 重置单例实例
   */
  static resetInstance(): void {
    if (WritingIntegration.instance) {
      WritingIntegration.instance.destroy();
      WritingIntegration.instance = null;
    }
  }

  // ================================
  // 生命周期
  // ================================

  /**
   * 初始化
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const timerId = this.startTiming('integration', 'init');

    try {
      // 初始化写作服务
      if (this.config.enableSearchIndex || this.config.enableDiffCache) {
        this.writingService = await getDefaultWritingService();
      }

      // 初始化性能监控
      if (this.config.enablePerformanceMonitor) {
        this.performanceMonitor = getDefaultPerformanceMonitor();
      }

      this.initialized = true;
      this.log('写作集成服务初始化完成');
    } finally {
      this.endTiming(timerId, true);
    }
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.writingService = null;
    this.performanceMonitor = null;
    this.initialized = false;
    this.log('写作集成服务已销毁');
  }

  // ================================
  // 搜索索引操作
  // ================================

  /**
   * 索引单个文档
   */
  async indexDocument(doc: DocumentIndexItem): Promise<void> {
    if (!this.config.enableSearchIndex || !this.writingService) {
      return;
    }

    const timerId = this.startTiming('index', `index-doc-${doc.id}`);

    try {
      const indexableDoc: IndexableDocument = {
        id: doc.id,
        title: doc.title,
        content: this.stripHtml(doc.content),
        path: doc.path,
        type: 'document',
      };

      await this.writingService.indexDocument(indexableDoc);
      this.log(`文档已索引: ${doc.id}`);
    } finally {
      this.endTiming(timerId, true, doc.content.length);
    }
  }

  /**
   * 批量索引文档
   */
  async indexDocuments(docs: DocumentIndexItem[]): Promise<void> {
    if (!this.config.enableSearchIndex || !this.writingService) {
      return;
    }

    const timerId = this.startTiming('index', `index-docs-batch-${docs.length}`);
    const totalSize = docs.reduce((acc, doc) => acc + doc.content.length, 0);

    try {
      const indexableDocs: IndexableDocument[] = docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        content: this.stripHtml(doc.content),
        path: doc.path,
        type: 'document',
      }));

      await this.writingService.indexDocuments(indexableDocs);
      this.log(`批量索引完成: ${docs.length} 个文档`);
    } finally {
      this.endTiming(timerId, true, totalSize);
    }
  }

  /**
   * 更新文档索引
   */
  async updateDocumentIndex(doc: DocumentIndexItem): Promise<void> {
    if (!this.config.enableSearchIndex || !this.writingService) {
      return;
    }

    const timerId = this.startTiming('index', `update-doc-${doc.id}`);

    try {
      const indexableDoc: IndexableDocument = {
        id: doc.id,
        title: doc.title,
        content: this.stripHtml(doc.content),
        path: doc.path,
        type: 'document',
      };

      await this.writingService.updateDocument(indexableDoc);
      this.log(`文档索引已更新: ${doc.id}`);
    } finally {
      this.endTiming(timerId, true, doc.content.length);
    }
  }

  /**
   * 从索引中移除文档
   */
  async removeDocumentFromIndex(docId: string): Promise<void> {
    if (!this.config.enableSearchIndex || !this.writingService) {
      return;
    }

    const timerId = this.startTiming('index', `remove-doc-${docId}`);

    try {
      await this.writingService.removeDocument(docId);
      this.log(`文档已从索引移除: ${docId}`);
    } finally {
      this.endTiming(timerId, true);
    }
  }

  /**
   * 清空索引
   */
  async clearIndex(): Promise<void> {
    if (!this.config.enableSearchIndex || !this.writingService) {
      return;
    }

    const timerId = this.startTiming('index', 'clear-all');

    try {
      await this.writingService.clearIndex();
      this.log('索引已清空');
    } finally {
      this.endTiming(timerId, true);
    }
  }

  // ================================
  // 搜索操作
  // ================================

  /**
   * 搜索文档
   */
  async search(query: string, options?: DocumentSearchOptions): Promise<DocumentSearchResult[]> {
    if (!this.config.enableSearchIndex || !this.writingService) {
      return [];
    }

    const timerId = this.startTiming('search', `search-${query.substring(0, 20)}`);

    try {
      const results = await this.writingService.search(query, options);
      this.log(`搜索完成: "${query}" -> ${results.length} 结果`);
      return results;
    } finally {
      this.endTiming(timerId, true);
    }
  }

  // ================================
  // 差分操作
  // ================================

  /**
   * 计算是否应使用增量保存
   */
  async computeIncrementalSaveDecision(
    oldContent: string,
    newContent: string,
    options?: DiffOptions
  ): Promise<IncrementalSaveDecision> {
    // 内容相同，无需保存
    if (oldContent === newContent) {
      return {
        useIncremental: false,
        reason: '内容相同，无需保存',
      };
    }

    // 内容太小，使用全量保存更高效
    if (newContent.length < this.config.incrementalThreshold) {
      return {
        useIncremental: false,
        reason: `内容长度 ${newContent.length} 小于阈值 ${this.config.incrementalThreshold}`,
      };
    }

    // 没有旧内容（新文档）
    if (!oldContent) {
      return {
        useIncremental: false,
        reason: '无旧内容，使用全量保存',
      };
    }

    // 使用写作服务计算差分
    if (this.config.enableDiffCache && this.writingService) {
      const timerId = this.startTiming('diff', 'compute-decision');

      try {
        const [shouldUse, diff] = await Promise.all([
          this.writingService.shouldUseIncremental(oldContent, newContent),
          this.writingService.computeDiff(oldContent, newContent, options),
        ]);

        const stats = await this.writingService.computeDiffStats(oldContent, newContent);

        this.log(
          `增量保存决策: ${shouldUse ? '是' : '否'}, 变更率: ${(stats.changeRatio * 100).toFixed(1)}%`
        );

        return {
          useIncremental: shouldUse,
          reason: shouldUse
            ? `变更率 ${(stats.changeRatio * 100).toFixed(1)}% 适合增量保存`
            : `变更率 ${(stats.changeRatio * 100).toFixed(1)}% 不适合增量保存`,
          stats,
          diff,
        };
      } finally {
        this.endTiming(timerId, true, oldContent.length + newContent.length);
      }
    }

    // 无写作服务，使用简单启发式判断
    const changeRatio =
      Math.abs(newContent.length - oldContent.length) / Math.max(oldContent.length, 1);
    const useIncremental = changeRatio < 0.3;

    return {
      useIncremental,
      reason: useIncremental
        ? `长度变化率 ${(changeRatio * 100).toFixed(1)}% 适合增量保存`
        : `长度变化率 ${(changeRatio * 100).toFixed(1)}% 不适合增量保存`,
    };
  }

  /**
   * 计算差分
   */
  async computeDiff(
    source: string,
    target: string,
    options?: DiffOptions
  ): Promise<TextDiffResult | null> {
    if (!this.config.enableDiffCache || !this.writingService) {
      return null;
    }

    const timerId = this.startTiming('diff', 'compute-diff');

    try {
      const result = await this.writingService.computeDiff(source, target, options);
      return result;
    } finally {
      this.endTiming(timerId, true, source.length + target.length);
    }
  }

  // ================================
  // 性能监控
  // ================================

  /**
   * 获取性能报告
   */
  getPerformanceReport(): string | null {
    if (!this.config.enablePerformanceMonitor || !this.performanceMonitor) {
      return null;
    }

    const report = this.performanceMonitor.generateReport();
    const lines: string[] = [
      '=== 写作模块性能报告 ===',
      `生成时间: ${report.generatedAt.toLocaleString()}`,
      `时间范围: ${report.timeRange.start.toLocaleString()} - ${report.timeRange.end.toLocaleString()}`,
      '',
      `总操作数: ${report.totalOperations}`,
      `成功率: ${(report.successRate * 100).toFixed(1)}%`,
      `平均耗时: ${report.overallAvgDuration.toFixed(2)}ms`,
      '',
      '--- 各类型统计 ---',
    ];

    for (const [type, summary] of report.summaries) {
      lines.push(`${type}:`);
      lines.push(`  操作数: ${summary.count}`);
      lines.push(`  平均耗时: ${summary.avgDuration.toFixed(2)}ms`);
      lines.push(
        `  最小/最大: ${summary.minDuration.toFixed(2)}ms / ${summary.maxDuration.toFixed(2)}ms`
      );
      lines.push(`  P95: ${summary.p95.toFixed(2)}ms`);
      if (summary.avgInputSize) {
        lines.push(`  平均输入大小: ${summary.avgInputSize.toFixed(0)} bytes`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 获取差分缓存统计
   */
  getDiffCacheStats(): { hits: number; misses: number; size: number; hitRate: number } | null {
    if (!this.writingService) {
      return null;
    }

    const stats = this.writingService.getDiffCacheStats();
    const total = stats.hits + stats.misses;
    const hitRate = total > 0 ? stats.hits / total : 0;

    return {
      ...stats,
      hitRate,
    };
  }

  /**
   * 清除差分缓存
   */
  clearDiffCache(): void {
    if (this.writingService) {
      this.writingService.clearDiffCache();
      this.log('差分缓存已清除');
    }
  }

  // ================================
  // 状态查询
  // ================================

  /**
   * 是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 是否启用搜索索引
   */
  isSearchEnabled(): boolean {
    return this.config.enableSearchIndex && this.writingService !== null;
  }

  /**
   * 是否启用差分缓存
   */
  isDiffCacheEnabled(): boolean {
    return this.config.enableDiffCache && this.writingService !== null;
  }

  /**
   * 是否启用性能监控
   */
  isPerformanceMonitorEnabled(): boolean {
    return this.config.enablePerformanceMonitor && this.performanceMonitor !== null;
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 剥离 HTML 标签
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  /**
   * 开始计时
   */
  private startTiming(type: string, label: string): string | null {
    if (!this.performanceMonitor) {
      return null;
    }
    // 使用 MetricType 类型，将通用 type 映射到有效的指标类型
    const metricType = this.mapToMetricType(type);
    return this.performanceMonitor.startTimer(metricType, { metadata: { label } });
  }

  /**
   * 将通用类型字符串映射到 MetricType
   */
  private mapToMetricType(
    type: string
  ):
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
    | 'hash_compute' {
    switch (type) {
      case 'diff':
      case 'diff_compute':
        return 'diff_compute';
      case 'diff_apply':
        return 'diff_apply';
      case 'search':
      case 'search_query':
        return 'search_query';
      case 'suggest':
      case 'search_suggest':
        return 'search_suggest';
      case 'index':
      case 'index_document':
        return 'index_document';
      case 'index_batch':
        return 'index_batch';
      case 'persist':
      case 'persist_index':
        return 'persist_index';
      case 'load':
      case 'load_index':
        return 'load_index';
      case 'worker':
      case 'worker_task':
        return 'worker_task';
      case 'cache':
      case 'cache_lookup':
        return 'cache_lookup';
      case 'hash':
      case 'hash_compute':
        return 'hash_compute';
      default:
        return 'diff_compute';
    }
  }

  /**
   * 结束计时
   */
  private endTiming(
    timerId: string | null,
    success: boolean,
    _inputSize?: number,
    outputSize?: number
  ): void {
    if (timerId === null || !this.performanceMonitor) {
      return;
    }
    this.performanceMonitor.endTimer(timerId, { success, outputSize });
  }

  /**
   * 调试日志
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[WritingIntegration]', ...args);
    }
  }
}

// ================================
// 便捷函数
// ================================

/**
 * 获取写作集成实例
 */
export async function getWritingIntegration(
  config?: WritingIntegrationConfig
): Promise<WritingIntegration> {
  return WritingIntegration.getInstance(config);
}

/**
 * 重置写作集成实例
 */
export function resetWritingIntegration(): void {
  WritingIntegration.resetInstance();
}

export default WritingIntegration;
