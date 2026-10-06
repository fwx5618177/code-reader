// ================================
// MathWorkerService
// 管理数学公式 Web Worker 的单例服务
//
// 特性：
// 1. 单例模式，全局共享 Worker 实例
// 2. 批量渲染接口，减少通信开销
// 3. 请求队列管理，支持取消和超时
// 4. LRU 缓存，避免重复渲染
// 5. 主线程回退机制
// 6. 详细日志和性能监控
// 7. 不依赖 KaTeX，完全使用自研数学渲染模块
// ================================

import type { MathRenderRequest, MathRenderResponse } from './math-worker';
import { renderMath } from '../math';

// ================================
// 类型定义
// ================================

/** 公式渲染项 */
export interface MathFormulaItem {
  /** 唯一标识 */
  id: string;
  /** LaTeX 公式 */
  latex: string;
  /** 是否为块级公式 */
  displayMode: boolean;
}

/** 渲染结果项 */
export interface MathRenderResultItem {
  /** 唯一标识 */
  id: string;
  /** 渲染后的 HTML */
  html: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/** 待处理请求 */
interface PendingRequest {
  /** 请求 ID */
  id: string;
  /** 解析回调 */
  resolve: (value: MathRenderResultItem[]) => void;
  /** 拒绝回调 */
  reject: (reason: Error) => void;
  /** 超时定时器 */
  timeoutId: ReturnType<typeof setTimeout>;
  /** 请求时间戳 */
  timestamp: number;
}

/** 服务配置 */
export interface MathWorkerServiceConfig {
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 是否启用本地缓存 */
  enableCache?: boolean;
  /** 本地缓存最大条目数 */
  maxCacheSize?: number;
  /** 是否强制使用主线程（调试用） */
  forceMainThread?: boolean;
  /** 是否启用调试日志 */
  debug?: boolean;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<MathWorkerServiceConfig> = {
  timeout: 15000, // 增加超时时间，避免大文件渲染误报超时
  enableCache: true,
  maxCacheSize: 1000, // 增加缓存大小，提高大文件渲染效率
  forceMainThread: false,
  debug: process.env.NODE_ENV === 'development',
};

/** 日志前缀 */
const LOG_PREFIX = '[MathWorkerService]';

// ================================
// LRU 缓存实现
// ================================

class LRUCache<K, V> {
  private readonly maxSize: number;
  private readonly cache: Map<K, V>;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移动到末尾（最近使用）
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 删除最老的条目（第一个）
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ================================
// MathWorkerService 类
// ================================

/**
 * 数学公式 Worker 服务
 * 单例模式，提供批量渲染接口
 */
export class MathWorkerService {
  private static instance: MathWorkerService | null = null;

  private readonly config: Required<MathWorkerServiceConfig>;
  private worker: Worker | null = null;
  private workerReady: boolean = false;
  private workerError: Error | null = null;
  private readonly pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly cancelledRequests: Set<string> = new Set(); // 追踪已取消的请求 ID
  private readonly maxCancelledSize: number = 100; // 限制追踪集合大小
  private requestIdCounter: number = 0;
  private readonly cache: LRUCache<string, string>;

  // 统计信息
  private stats = {
    totalRequests: 0,
    workerRequests: 0,
    mainThreadRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
  };

  private constructor(config?: MathWorkerServiceConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new LRUCache<string, string>(this.config.maxCacheSize);

    if (this.config.debug) {
      console.log(`${LOG_PREFIX} 初始化服务，配置:`, {
        timeout: this.config.timeout,
        enableCache: this.config.enableCache,
        maxCacheSize: this.config.maxCacheSize,
        forceMainThread: this.config.forceMainThread,
      });
    }

    if (!this.config.forceMainThread) {
      this.initWorker();
    } else if (this.config.debug) {
      console.log(`${LOG_PREFIX} 强制使用主线程模式`);
    }
  }

  /**
   * 获取单例实例
   */
  public static getInstance(config?: MathWorkerServiceConfig): MathWorkerService {
    if (!MathWorkerService.instance) {
      MathWorkerService.instance = new MathWorkerService(config);
    }
    return MathWorkerService.instance;
  }

  /**
   * 销毁单例实例
   */
  public static destroyInstance(): void {
    if (MathWorkerService.instance) {
      MathWorkerService.instance.destroy();
      MathWorkerService.instance = null;
    }
  }

  /**
   * 初始化 Web Worker
   */
  private initWorker(): void {
    const startTime = performance.now();

    try {
      // 使用 Vite 的 Worker 导入方式
      this.worker = new Worker(new URL('./math-worker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);
      this.worker.onmessageerror = this.handleWorkerMessageError.bind(this);

      this.workerReady = true;
      this.workerError = null;

      if (this.config.debug) {
        const initTime = performance.now() - startTime;
        console.log(`${LOG_PREFIX} Worker 初始化成功，耗时: ${initTime.toFixed(2)}ms`);
      }
    } catch (error) {
      const initTime = performance.now() - startTime;
      console.warn(
        `${LOG_PREFIX} 无法创建 Worker，将使用主线程渲染 (耗时: ${initTime.toFixed(2)}ms):`,
        error
      );
      this.worker = null;
      this.workerReady = false;
      this.workerError = error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * 处理 Worker 消息
   */
  private handleWorkerMessage(event: MessageEvent<MathRenderResponse>): void {
    const response = event.data;
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      // 检查是否是已取消的请求
      if (this.cancelledRequests.has(response.id)) {
        // 已取消的请求，静默忽略其响应
        this.cancelledRequests.delete(response.id);
        return;
      }
      // 真正的未知请求 ID（这种情况较少见）
      if (this.config.debug) {
        console.warn(`${LOG_PREFIX} 收到未知请求 ID 的响应: ${response.id}`);
      }
      return;
    }

    // 计算请求处理时间
    const processingTime = Date.now() - pending.timestamp;

    // 清除超时定时器
    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(response.id);

    if (response.success && response.data?.results) {
      // 缓存结果
      if (this.config.enableCache) {
        for (const result of response.data.results) {
          if (result.success) {
            this.cache.set(result.id, result.html);
          }
        }
      }

      if (this.config.debug) {
        const resultCount = response.data.results.length;
        const successCount = response.data.results.filter((r) => r.success).length;
        console.log(
          `${LOG_PREFIX} 批量渲染完成: ${successCount}/${resultCount} 成功，` +
            `处理时间: ${processingTime}ms，Worker 耗时: ${response.time.toFixed(2)}ms`
        );
      }

      pending.resolve(response.data.results);
    } else {
      this.stats.errors++;
      if (this.config.debug) {
        console.error(`${LOG_PREFIX} 渲染失败: ${response.error}，处理时间: ${processingTime}ms`);
      }
      pending.reject(new Error(response.error || '渲染失败'));
    }
  }

  /**
   * 处理 Worker 错误
   */
  private handleWorkerError(event: ErrorEvent): void {
    console.error('[MathWorkerService] Worker 错误:', event);
    this.stats.errors++;
    this.workerError = new Error(event.message);

    // 拒绝所有待处理请求
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Worker 发生错误'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 处理 Worker 消息错误
   */
  private handleWorkerMessageError(event: MessageEvent): void {
    console.error('[MathWorkerService] Worker 消息错误:', event);
    this.stats.errors++;
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(latex: string, displayMode: boolean): string {
    return `${displayMode ? 'block' : 'inline'}:${latex}`;
  }

  /**
   * 在主线程渲染公式
   * 当 Worker 不可用或渲染失败时使用
   */
  private renderOnMainThread(formulas: MathFormulaItem[]): MathRenderResultItem[] {
    const startTime = performance.now();
    this.stats.mainThreadRequests++;

    if (this.config.debug) {
      console.log(`${LOG_PREFIX} 使用主线程渲染 ${formulas.length} 个公式`);
    }

    const results = formulas.map((formula) => {
      try {
        const result = renderMath(formula.latex, { displayMode: formula.displayMode });
        // 缓存结果
        if (this.config.enableCache && result.success) {
          const cacheKey = this.getCacheKey(formula.latex, formula.displayMode);
          this.cache.set(cacheKey, result.html);
        }
        return {
          id: formula.id,
          html: result.html,
          success: result.success,
          error: result.error,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          id: formula.id,
          html: `<span class="math-error">${this.escapeHtml(formula.latex)}</span>`,
          success: false,
          error: message,
        };
      }
    });

    if (this.config.debug) {
      const renderTime = performance.now() - startTime;
      const successCount = results.filter((r) => r.success).length;
      console.log(
        `${LOG_PREFIX} 主线程渲染完成: ${successCount}/${formulas.length} 成功，耗时: ${renderTime.toFixed(2)}ms`
      );
    }

    return results;
  }

  /**
   * 批量渲染数学公式
   * 优先使用 Worker，失败时回退到主线程
   *
   * 渲染策略：
   * 1. 首先检查 LRU 缓存，命中则直接返回
   * 2. 未命中的公式发送给 Worker 批量渲染
   * 3. Worker 不可用或超时时，回退到主线程渲染
   */
  public async renderBatch(formulas: MathFormulaItem[]): Promise<MathRenderResultItem[]> {
    if (formulas.length === 0) {
      return [];
    }

    const batchStartTime = performance.now();
    this.stats.totalRequests++;

    // 检查缓存
    const results: MathRenderResultItem[] = [];
    const uncached: MathFormulaItem[] = [];

    if (this.config.enableCache) {
      for (const formula of formulas) {
        const cacheKey = this.getCacheKey(formula.latex, formula.displayMode);
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
          this.stats.cacheHits++;
          results.push({
            id: formula.id,
            html: cached,
            success: true,
          });
        } else {
          this.stats.cacheMisses++;
          uncached.push(formula);
        }
      }
    } else {
      uncached.push(...formulas);
    }

    // 如果所有公式都已缓存，直接返回
    if (uncached.length === 0) {
      return results;
    }

    // 尝试使用 Worker
    if (this.worker && this.workerReady) {
      try {
        const workerResults = await this.renderWithWorker(uncached);
        this.stats.workerRequests++;

        if (this.config.debug) {
          const totalTime = performance.now() - batchStartTime;
          console.log(
            `${LOG_PREFIX} 批量渲染统计: 总数=${formulas.length}, 缓存命中=${results.length}, ` +
              `Worker渲染=${workerResults.length}, 总耗时=${totalTime.toFixed(2)}ms`
          );
        }

        return [...results, ...workerResults];
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // 对于已取消的请求，静默回退到主线程，不打印警告
        if (errorMsg !== '请求已取消') {
          console.warn(`${LOG_PREFIX} Worker 渲染失败，回退到主线程: ${errorMsg}`);
        }
        // 回退到主线程
        const mainThreadResults = this.renderOnMainThread(uncached);
        return [...results, ...mainThreadResults];
      }
    }

    // 使用主线程渲染
    if (this.config.debug) {
      console.log(`${LOG_PREFIX} Worker 不可用，使用主线程渲染 ${uncached.length} 个公式`);
    }
    const mainThreadResults = this.renderOnMainThread(uncached);
    return [...results, ...mainThreadResults];
  }

  /**
   * 使用 Worker 渲染
   */
  private renderWithWorker(formulas: MathFormulaItem[]): Promise<MathRenderResultItem[]> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.workerReady) {
        reject(new Error('Worker 不可用'));
        return;
      }

      const requestId = `batch_${++this.requestIdCounter}_${Date.now()}`;

      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('渲染请求超时'));
      }, this.config.timeout);

      // 保存待处理请求
      this.pendingRequests.set(requestId, {
        id: requestId,
        resolve,
        reject,
        timeoutId,
        timestamp: Date.now(),
      });

      // 发送请求
      const request: MathRenderRequest = {
        id: requestId,
        type: 'render_batch',
        data: {
          formulas: formulas.map((f) => ({
            id: f.id,
            latex: f.latex,
            displayMode: f.displayMode,
          })),
        },
      };

      this.worker.postMessage(request);
    });
  }

  /**
   * 渲染单个公式
   */
  public async render(
    latex: string,
    displayMode: boolean = false
  ): Promise<{ html: string; success: boolean; error?: string }> {
    const id = `single_${++this.requestIdCounter}`;
    const results = await this.renderBatch([{ id, latex, displayMode }]);
    const result = results[0];
    return result || { html: '', success: false, error: '未找到结果' };
  }

  /**
   * 清除缓存
   */
  public clearCache(): void {
    this.cache.clear();

    // 通知 Worker 清除缓存
    if (this.worker && this.workerReady) {
      const request: MathRenderRequest = {
        id: `clear_${Date.now()}`,
        type: 'clear_cache',
      };
      this.worker.postMessage(request);
    }
  }

  /**
   * 取消所有待处理请求
   */
  public cancelAll(): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('请求已取消'));
      // 追踪已取消的请求 ID，以便在 Worker 响应时静默忽略
      this.cancelledRequests.add(requestId);
    }
    this.pendingRequests.clear();

    // 限制追踪集合大小，避免内存泄漏
    if (this.cancelledRequests.size > this.maxCancelledSize) {
      const toDelete = this.cancelledRequests.size - this.maxCancelledSize;
      let count = 0;
      for (const id of this.cancelledRequests) {
        if (count >= toDelete) break;
        this.cancelledRequests.delete(id);
        count++;
      }
    }
  }

  /**
   * 获取统计信息
   * 返回服务运行状态和性能指标
   */
  public getStats(): {
    totalRequests: number;
    workerRequests: number;
    mainThreadRequests: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
    errors: number;
    pendingRequests: number;
    cacheSize: number;
    workerReady: boolean;
  } {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    return {
      ...this.stats,
      cacheHitRate: total > 0 ? this.stats.cacheHits / total : 0,
      pendingRequests: this.pendingRequests.size,
      cacheSize: this.cache.size,
      workerReady: this.workerReady,
    };
  }

  /**
   * 重置统计信息
   */
  public resetStats(): void {
    if (this.config.debug) {
      console.log(`${LOG_PREFIX} 重置统计信息`);
    }
    this.stats = {
      totalRequests: 0,
      workerRequests: 0,
      mainThreadRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
    };
  }

  /**
   * 检查 Worker 是否可用
   */
  public isWorkerReady(): boolean {
    return this.workerReady;
  }

  /**
   * 获取 Worker 错误信息
   */
  public getWorkerError(): Error | null {
    return this.workerError;
  }

  /**
   * 销毁服务
   */
  public destroy(): void {
    // 清理取消追踪集合
    this.cancelledRequests.clear();
    if (this.config.debug) {
      console.log(`${LOG_PREFIX} 销毁服务，最终统计:`, this.getStats());
    }

    // 取消所有待处理请求
    this.cancelAll();

    // 清除缓存
    this.cache.clear();

    // 终止 Worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }

    // 重置统计
    this.resetStats();
  }

  /**
   * 打印性能报告
   * 用于调试和性能分析
   */
  public printPerformanceReport(): void {
    const stats = this.getStats();
    const report = [
      `\n${LOG_PREFIX} 性能报告`,
      '='.repeat(50),
      `总请求数: ${stats.totalRequests}`,
      `Worker 请求: ${stats.workerRequests}`,
      `主线程请求: ${stats.mainThreadRequests}`,
      `缓存命中: ${stats.cacheHits}`,
      `缓存未命中: ${stats.cacheMisses}`,
      `缓存命中率: ${(stats.cacheHitRate * 100).toFixed(1)}%`,
      `缓存大小: ${stats.cacheSize}`,
      `错误数: ${stats.errors}`,
      `待处理请求: ${stats.pendingRequests}`,
      `Worker 状态: ${stats.workerReady ? '就绪' : '不可用'}`,
      '='.repeat(50),
    ];
    console.log(report.join('\n'));
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// ================================
// 便捷函数
// ================================

/**
 * 获取 MathWorkerService 实例
 */
export function getMathWorkerService(config?: MathWorkerServiceConfig): MathWorkerService {
  return MathWorkerService.getInstance(config);
}

/**
 * 销毁 MathWorkerService 实例
 */
export function destroyMathWorkerService(): void {
  MathWorkerService.destroyInstance();
}

/**
 * 批量渲染数学公式
 */
export async function renderMathBatch(
  formulas: MathFormulaItem[]
): Promise<MathRenderResultItem[]> {
  const service = getMathWorkerService();
  return service.renderBatch(formulas);
}

/**
 * 渲染单个数学公式
 */
export async function renderMathFormula(
  latex: string,
  displayMode: boolean = false
): Promise<{ html: string; success: boolean; error?: string }> {
  const service = getMathWorkerService();
  return service.render(latex, displayMode);
}

// ================================
// 导出
// ================================

export default MathWorkerService;
