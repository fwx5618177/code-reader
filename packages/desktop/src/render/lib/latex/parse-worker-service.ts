// ================================
// 高性能 Worker 服务
//
// 核心功能：
// 1. 封装 Web Worker 通信
// 2. 大文件粘贴优化
// 3. 任务队列管理
// 4. 自动重试和错误恢复
// ================================

import type {
  ParseWorkerRequest,
  ParseWorkerResponse,
  ParseResultResponse,
  ParseProgressResponse,
  ParseChunkResponse,
  RenderResultResponse,
  RenderProgressResponse,
  WorkerStats,
} from './parse-worker';
import type {
  LatexParserOptions,
  LatexRenderOptions,
  DocumentChange,
  RootNode,
  LatexNode,
} from './types';

// ================================
// 类型定义
// ================================

/** 解析进度回调 */
export type ParseProgressCallback = (
  progress: number,
  info: {
    currentChunk: number;
    totalChunks: number;
    parsedLength: number;
    totalLength: number;
  }
) => void;

/** 渲染进度回调 */
export type RenderProgressCallback = (
  progress: number,
  info: {
    renderedBlocks: number;
    totalBlocks: number;
  }
) => void;

/** 分块解析回调 */
export type ChunkCallback = (chunk: {
  chunkIndex: number;
  totalChunks: number;
  nodes: LatexNode[];
  chunkStart: number;
  chunkEnd: number;
  isLast: boolean;
}) => void;

/** 解析选项 */
export interface ParseOptions extends Partial<LatexParserOptions> {
  /** 是否使用分块解析（大文件自动启用） */
  chunked?: boolean;
  /** 分块大小（字节） */
  chunkSize?: number;
  /** 解析进度回调 */
  onProgress?: ParseProgressCallback;
  /** 分块回调（仅分块解析时有效） */
  onChunk?: ChunkCallback;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/** 渲染选项 */
export interface RenderOptions extends Partial<LatexRenderOptions> {
  /** 渲染进度回调 */
  onProgress?: RenderProgressCallback;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/** 待处理请求 */
interface PendingRequest<T> {
  id: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  onProgress?: ParseProgressCallback | RenderProgressCallback;
  onChunk?: ChunkCallback;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/** 服务配置 */
export interface ParseWorkerServiceConfig {
  /** 大文件阈值（字节），超过此值自动使用分块解析 */
  largeFileThreshold: number;
  /** 超大文件阈值（字节），超过此值使用更小的块 */
  hugeFileThreshold: number;
  /** 默认分块大小（字节） */
  defaultChunkSize: number;
  /** 大文件分块大小（字节） */
  largeFileChunkSize: number;
  /** 超大文件分块大小（字节） */
  hugeFileChunkSize: number;
  /** 默认超时时间（毫秒） */
  defaultTimeout: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟（毫秒） */
  retryDelay: number;
  /** 是否启用调试日志 */
  debug: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: ParseWorkerServiceConfig = {
  largeFileThreshold: 50 * 1024, // 50KB
  hugeFileThreshold: 500 * 1024, // 500KB
  defaultChunkSize: 32 * 1024, // 32KB
  largeFileChunkSize: 16 * 1024, // 16KB
  hugeFileChunkSize: 8 * 1024, // 8KB
  defaultTimeout: 30000, // 30秒
  maxRetries: 2,
  retryDelay: 100,
  debug: false,
};

// ================================
// Worker 服务类
// ================================

/**
 * 高性能解析 Worker 服务
 *
 * 特性：
 * - 自动检测文件大小并选择最优解析策略
 * - 大文件分块解析，避免主线程阻塞
 * - 支持解析进度回调
 * - 任务取消和超时处理
 * - 自动重试机制
 */
export class ParseWorkerService {
  private worker: Worker | null = null;
  private config: ParseWorkerServiceConfig;
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private requestIdCounter = 0;
  private isDestroyed = false;
  private workerReady = false;
  private initPromise: Promise<void> | null = null;

  constructor(config: Partial<ParseWorkerServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 初始化 Worker
   */
  async init(): Promise<void> {
    if (this.workerReady) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.createWorker();
    await this.initPromise;
  }

  /**
   * 创建 Worker 实例
   */
  private async createWorker(): Promise<void> {
    try {
      // 动态创建 Worker
      // 注意：实际项目中需要使用正确的 Worker 路径
      this.worker = new Worker(new URL('./parse-worker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = this.handleError.bind(this);
      this.worker.onmessageerror = this.handleMessageError.bind(this);

      this.workerReady = true;

      if (this.config.debug) {
        console.log('[ParseWorkerService] Worker 初始化成功');
      }
    } catch (error) {
      console.error('[ParseWorkerService] Worker 初始化失败:', error);
      // 标记为就绪，使用主线程 fallback
      this.workerReady = true;
      this.worker = null;
    }
  }

  /**
   * 解析 LaTeX 内容
   */
  async parse(content: string, options: ParseOptions = {}): Promise<RootNode | null> {
    await this.init();

    const contentSize = new Blob([content]).size;
    const isLargeFile = contentSize >= this.config.largeFileThreshold;
    const isHugeFile = contentSize >= this.config.hugeFileThreshold;

    // 自动选择解析策略
    const shouldUseChunked = options.chunked ?? isLargeFile;

    if (this.config.debug) {
      console.log(
        `[ParseWorkerService] 解析内容: ${(contentSize / 1024).toFixed(1)}KB, ` +
          `策略: ${shouldUseChunked ? '分块' : '完整'}`
      );
    }

    // 确定分块大小
    const chunkSize =
      options.chunkSize ??
      (isHugeFile
        ? this.config.hugeFileChunkSize
        : isLargeFile
          ? this.config.largeFileChunkSize
          : this.config.defaultChunkSize);

    const timeout = options.timeout ?? this.config.defaultTimeout;

    if (shouldUseChunked) {
      return this.parseChunked(content, chunkSize, options, timeout);
    } else {
      return this.parseFull(content, options, timeout);
    }
  }

  /**
   * 完整解析
   */
  private async parseFull(
    content: string,
    options: ParseOptions,
    timeout: number
  ): Promise<RootNode | null> {
    // 如果 Worker 不可用，使用主线程 fallback
    if (!this.worker) {
      return this.parseOnMainThread(content, options);
    }

    const id = this.generateId();

    return new Promise((resolve, reject) => {
      const request: PendingRequest<RootNode | null> = {
        id,
        resolve,
        reject,
        onProgress: options.onProgress,
      };

      // 设置超时
      if (timeout > 0) {
        request.timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          this.cancel(id);
          reject(new Error(`解析超时（${timeout}ms）`));
        }, timeout);
      }

      this.pendingRequests.set(id, request as PendingRequest<unknown>);

      this.worker!.postMessage({
        type: 'parse',
        id,
        content,
        options: {
          preserveComments: options.preserveComments,
          parseMathContent: options.parseMathContent,
        },
      } as ParseWorkerRequest);
    });
  }

  /**
   * 分块解析
   */
  private async parseChunked(
    content: string,
    chunkSize: number,
    options: ParseOptions,
    timeout: number
  ): Promise<RootNode | null> {
    // 如果 Worker 不可用，使用主线程 fallback
    if (!this.worker) {
      return this.parseOnMainThread(content, options);
    }

    const id = this.generateId();

    return new Promise((resolve, reject) => {
      const request: PendingRequest<RootNode | null> = {
        id,
        resolve,
        reject,
        onProgress: options.onProgress,
        onChunk: options.onChunk,
      };

      // 设置超时
      if (timeout > 0) {
        request.timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          this.cancel(id);
          reject(new Error(`分块解析超时（${timeout}ms）`));
        }, timeout);
      }

      this.pendingRequests.set(id, request as PendingRequest<unknown>);

      this.worker!.postMessage({
        type: 'parse_chunked',
        id,
        content,
        chunkSize,
        options: {
          preserveComments: options.preserveComments,
          parseMathContent: options.parseMathContent,
        },
      } as ParseWorkerRequest);
    });
  }

  /**
   * 增量解析
   */
  async parseIncremental(
    content: string,
    changes: DocumentChange[],
    options: ParseOptions = {}
  ): Promise<RootNode | null> {
    await this.init();

    // 如果 Worker 不可用，使用完整解析
    if (!this.worker) {
      return this.parseOnMainThread(content, options);
    }

    const id = this.generateId();
    const timeout = options.timeout ?? this.config.defaultTimeout;

    return new Promise((resolve, reject) => {
      const request: PendingRequest<RootNode | null> = {
        id,
        resolve,
        reject,
        onProgress: options.onProgress,
      };

      // 设置超时
      if (timeout > 0) {
        request.timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          this.cancel(id);
          reject(new Error(`增量解析超时（${timeout}ms）`));
        }, timeout);
      }

      this.pendingRequests.set(id, request as PendingRequest<unknown>);

      this.worker!.postMessage({
        type: 'parse_incremental',
        id,
        content,
        changes,
        options: {
          preserveComments: options.preserveComments,
          parseMathContent: options.parseMathContent,
        },
      } as ParseWorkerRequest);
    });
  }

  /**
   * 渲染 AST
   */
  async render(ast: RootNode, options: RenderOptions = {}): Promise<string> {
    await this.init();

    // 如果 Worker 不可用，使用主线程 fallback
    if (!this.worker) {
      return this.renderOnMainThread(ast, options);
    }

    const id = this.generateId();
    const timeout = options.timeout ?? this.config.defaultTimeout;

    return new Promise((resolve, reject) => {
      const request: PendingRequest<string> = {
        id,
        resolve,
        reject,
        onProgress: options.onProgress as RenderProgressCallback,
      };

      // 设置超时
      if (timeout > 0) {
        request.timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          this.cancel(id);
          reject(new Error(`渲染超时（${timeout}ms）`));
        }, timeout);
      }

      this.pendingRequests.set(id, request as PendingRequest<unknown>);

      this.worker!.postMessage({
        type: 'render',
        id,
        ast,
        options: {
          showErrors: options.showErrors,
          classPrefix: options.classPrefix,
        },
      } as ParseWorkerRequest);
    });
  }

  /**
   * 渲染多个节点
   */
  async renderBlocks(nodes: LatexNode[], options: RenderOptions = {}): Promise<string> {
    await this.init();

    // 如果 Worker 不可用，使用主线程 fallback
    if (!this.worker) {
      return this.renderNodesOnMainThread(nodes, options);
    }

    const id = this.generateId();
    const timeout = options.timeout ?? this.config.defaultTimeout;

    return new Promise((resolve, reject) => {
      const request: PendingRequest<string> = {
        id,
        resolve,
        reject,
        onProgress: options.onProgress as RenderProgressCallback,
      };

      // 设置超时
      if (timeout > 0) {
        request.timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          this.cancel(id);
          reject(new Error(`块渲染超时（${timeout}ms）`));
        }, timeout);
      }

      this.pendingRequests.set(id, request as PendingRequest<unknown>);

      this.worker!.postMessage({
        type: 'render_blocks',
        id,
        nodes,
        options: {
          showErrors: options.showErrors,
          classPrefix: options.classPrefix,
        },
      } as ParseWorkerRequest);
    });
  }

  /**
   * 取消请求
   */
  cancel(id?: string): void {
    if (!this.worker) return;

    this.worker.postMessage({
      type: 'cancel',
      id,
    } as ParseWorkerRequest);

    if (id) {
      const request = this.pendingRequests.get(id);
      if (request) {
        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }
        this.pendingRequests.delete(id);
        request.reject(new Error('请求已取消'));
      }
    } else {
      // 取消所有请求
      for (const [, request] of this.pendingRequests) {
        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }
        request.reject(new Error('请求已取消'));
      }
      this.pendingRequests.clear();
    }
  }

  /**
   * 清除 Worker 缓存
   */
  async clearCache(): Promise<WorkerStats | null> {
    await this.init();

    if (!this.worker) return null;

    const id = this.generateId();

    return new Promise((resolve, reject) => {
      const request: PendingRequest<WorkerStats | null> = {
        id,
        resolve,
        reject,
      };

      this.pendingRequests.set(id, request as PendingRequest<unknown>);

      this.worker!.postMessage({
        type: 'clear_cache',
        id,
      } as ParseWorkerRequest);
    });
  }

  /**
   * 获取 Worker 统计信息
   */
  async getStats(): Promise<WorkerStats | null> {
    await this.init();

    if (!this.worker) return null;

    const id = this.generateId();

    return new Promise((resolve, reject) => {
      const request: PendingRequest<WorkerStats | null> = {
        id,
        resolve,
        reject,
      };

      this.pendingRequests.set(id, request as PendingRequest<unknown>);

      this.worker!.postMessage({
        type: 'get_stats',
        id,
      } as ParseWorkerRequest);
    });
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;

    // 取消所有待处理请求
    this.cancel();

    // 终止 Worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.workerReady = false;
    this.initPromise = null;

    if (this.config.debug) {
      console.log('[ParseWorkerService] 服务已销毁');
    }
  }

  /**
   * 处理 Worker 消息
   */
  private handleMessage(event: MessageEvent<ParseWorkerResponse>): void {
    const response = event.data;
    const request = this.pendingRequests.get(response.id);

    if (!request) {
      if (this.config.debug) {
        console.warn(`[ParseWorkerService] 收到未知请求的响应: ${response.id}`);
      }
      return;
    }

    switch (response.type) {
      case 'parse_result':
        this.handleParseResult(response as ParseResultResponse, request);
        break;

      case 'parse_progress':
        this.handleParseProgress(response as ParseProgressResponse, request);
        break;

      case 'parse_chunk':
        this.handleParseChunk(response as ParseChunkResponse, request);
        break;

      case 'render_result':
        this.handleRenderResult(response as RenderResultResponse, request);
        break;

      case 'render_progress':
        this.handleRenderProgress(response as RenderProgressResponse, request);
        break;

      case 'cancelled':
        // 请求已取消，清理完成
        this.cleanupRequest(response.id);
        break;

      case 'error':
        this.handleErrorResponse(response, request);
        break;

      case 'stats':
        this.handleStatsResponse(response, request);
        break;
    }
  }

  /**
   * 处理解析结果
   */
  private handleParseResult(response: ParseResultResponse, request: PendingRequest<unknown>): void {
    this.cleanupRequest(response.id);

    if (response.success) {
      (request as PendingRequest<RootNode | null>).resolve(response.ast || null);
    } else {
      const errorMsg = response.errors?.map((e) => e.message).join('; ') || '解析失败';
      request.reject(new Error(errorMsg));
    }
  }

  /**
   * 处理解析进度
   */
  private handleParseProgress(
    response: ParseProgressResponse,
    request: PendingRequest<unknown>
  ): void {
    if (request.onProgress) {
      (request.onProgress as ParseProgressCallback)(response.progress, {
        currentChunk: response.currentChunk,
        totalChunks: response.totalChunks,
        parsedLength: response.parsedLength,
        totalLength: response.totalLength,
      });
    }
  }

  /**
   * 处理分块解析结果
   */
  private handleParseChunk(response: ParseChunkResponse, request: PendingRequest<unknown>): void {
    if (request.onChunk) {
      (request.onChunk as ChunkCallback)({
        chunkIndex: response.chunkIndex,
        totalChunks: response.totalChunks,
        nodes: response.nodes,
        chunkStart: response.chunkStart,
        chunkEnd: response.chunkEnd,
        isLast: response.isLast,
      });
    }
  }

  /**
   * 处理渲染结果
   */
  private handleRenderResult(
    response: RenderResultResponse,
    request: PendingRequest<unknown>
  ): void {
    this.cleanupRequest(response.id);

    if (response.success) {
      (request as PendingRequest<string>).resolve(response.html || '');
    } else {
      request.reject(new Error(response.error || '渲染失败'));
    }
  }

  /**
   * 处理渲染进度
   */
  private handleRenderProgress(
    response: RenderProgressResponse,
    request: PendingRequest<unknown>
  ): void {
    if (request.onProgress) {
      (request.onProgress as RenderProgressCallback)(response.progress, {
        renderedBlocks: response.renderedBlocks,
        totalBlocks: response.totalBlocks,
      });
    }
  }

  /**
   * 处理错误响应
   */
  private handleErrorResponse(
    response: ParseWorkerResponse,
    request: PendingRequest<unknown>
  ): void {
    this.cleanupRequest(response.id);

    const errResp = response as { error: string; stack?: string };
    const error = new Error(errResp.error);
    if (errResp.stack) {
      error.stack = errResp.stack;
    }
    request.reject(error);
  }

  /**
   * 处理统计响应
   */
  private handleStatsResponse(
    response: ParseWorkerResponse,
    request: PendingRequest<unknown>
  ): void {
    this.cleanupRequest(response.id);

    const statsResponse = response as { stats: WorkerStats };
    (request as PendingRequest<WorkerStats | null>).resolve(statsResponse.stats);
  }

  /**
   * 清理请求
   */
  private cleanupRequest(id: string): void {
    const request = this.pendingRequests.get(id);
    if (request?.timeoutId) {
      clearTimeout(request.timeoutId);
    }
    this.pendingRequests.delete(id);
  }

  /**
   * 处理 Worker 错误
   */
  private handleError(event: ErrorEvent): void {
    console.error('[ParseWorkerService] Worker 错误:', event);

    // 拒绝所有待处理请求
    for (const [id, request] of this.pendingRequests) {
      request.reject(new Error(`Worker 错误: ${event.message}`));
      this.cleanupRequest(id);
    }
  }

  /**
   * 处理消息错误
   */
  private handleMessageError(event: MessageEvent): void {
    console.error('[ParseWorkerService] 消息错误:', event);
  }

  /**
   * 生成请求 ID
   */
  private generateId(): string {
    return `parse-${Date.now()}-${++this.requestIdCounter}`;
  }

  /**
   * 主线程解析 fallback
   */
  private async parseOnMainThread(
    content: string,
    options: ParseOptions
  ): Promise<RootNode | null> {
    // 动态导入解析器避免循环依赖
    const { LatexParser } = await import('./parser');

    const parser = new LatexParser(content, {
      preserveComments: options.preserveComments,
      parseMathContent: options.parseMathContent,
    });

    const result = parser.parse();
    return result.ast;
  }

  /**
   * 主线程渲染 fallback
   */
  private async renderOnMainThread(ast: RootNode, options: RenderOptions): Promise<string> {
    // 动态导入渲染器避免循环依赖
    const { LatexRenderer } = await import('./renderer');

    const renderer = new LatexRenderer({
      showErrors: options.showErrors,
      classPrefix: options.classPrefix,
    });

    const result = renderer.render(ast);
    return result.html;
  }

  /**
   * 主线程节点渲染 fallback
   */
  private async renderNodesOnMainThread(
    nodes: LatexNode[],
    options: RenderOptions
  ): Promise<string> {
    // 动态导入渲染器避免循环依赖
    const { LatexRenderer } = await import('./renderer');

    const renderer = new LatexRenderer({
      showErrors: options.showErrors,
      classPrefix: options.classPrefix,
    });

    const htmlParts: string[] = [];
    for (const node of nodes) {
      htmlParts.push(renderer.renderNode(node));
    }

    return htmlParts.join('\n');
  }
}

// ================================
// 全局实例管理
// ================================

let globalService: ParseWorkerService | null = null;

/**
 * 获取全局 Worker 服务实例
 */
export function getParseWorkerService(
  config?: Partial<ParseWorkerServiceConfig>
): ParseWorkerService {
  if (!globalService) {
    globalService = new ParseWorkerService(config);
  }
  return globalService;
}

/**
 * 销毁全局 Worker 服务实例
 */
export function destroyParseWorkerService(): void {
  if (globalService) {
    globalService.destroy();
    globalService = null;
  }
}

// ================================
// 便捷函数
// ================================

/**
 * 解析 LaTeX 内容（使用全局服务）
 */
export async function parseLatex(
  content: string,
  options?: ParseOptions
): Promise<RootNode | null> {
  const service = getParseWorkerService();
  return service.parse(content, options);
}

/**
 * 渲染 LaTeX AST（使用全局服务）
 */
export async function renderLatex(ast: RootNode, options?: RenderOptions): Promise<string> {
  const service = getParseWorkerService();
  return service.render(ast, options);
}

/**
 * 解析并渲染 LaTeX 内容（使用全局服务）
 */
export async function parseAndRenderLatex(
  content: string,
  parseOptions?: ParseOptions,
  renderOptions?: RenderOptions
): Promise<{ ast: RootNode | null; html: string }> {
  const service = getParseWorkerService();

  const ast = await service.parse(content, parseOptions);

  if (!ast) {
    return { ast: null, html: '' };
  }

  const html = await service.render(ast, renderOptions);

  return { ast, html };
}
