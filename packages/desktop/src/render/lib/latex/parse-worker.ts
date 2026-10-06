// ================================
// 高性能后台解析 Worker
//
// 核心功能：
// 1. 大文件分块解析，避免主线程阻塞
// 2. 流式响应，实时返回解析进度
// 3. 内存优化，支持增量解析
// 4. 可取消的解析任务
// ================================

import type {
  LatexParserOptions,
  LatexRenderOptions,
  DocumentChange,
  RootNode,
  LatexNode,
  AnyLatexNode,
} from './types';
import { LatexParser, IncrementalLatexParser } from './parser';
import { LatexRenderer } from './renderer';

// ================================
// 消息类型定义
// ================================

/** Worker 请求消息类型 */
export type ParseWorkerRequestType =
  | 'parse'
  | 'parse_incremental'
  | 'parse_chunked'
  | 'render'
  | 'render_blocks'
  | 'cancel'
  | 'clear_cache'
  | 'get_stats';

/** Worker 响应消息类型 */
export type ParseWorkerResponseType =
  | 'parse_result'
  | 'parse_progress'
  | 'parse_chunk'
  | 'render_result'
  | 'render_progress'
  | 'cancelled'
  | 'error'
  | 'stats';

/** 解析请求 */
export interface ParseRequest {
  type: 'parse';
  id: string;
  content: string;
  options?: LatexParserOptions;
}

/** 增量解析请求 */
export interface IncrementalParseRequest {
  type: 'parse_incremental';
  id: string;
  content: string;
  changes: DocumentChange[];
  options?: LatexParserOptions;
}

/** 分块解析请求 */
export interface ChunkedParseRequest {
  type: 'parse_chunked';
  id: string;
  content: string;
  chunkSize?: number;
  options?: LatexParserOptions;
}

/** 渲染请求 */
export interface RenderRequest {
  type: 'render';
  id: string;
  ast: RootNode;
  options?: LatexRenderOptions;
}

/** 块渲染请求 */
export interface RenderBlocksRequest {
  type: 'render_blocks';
  id: string;
  nodes: LatexNode[];
  options?: LatexRenderOptions;
}

/** 取消请求 */
export interface CancelRequest {
  type: 'cancel';
  id?: string; // 如果不提供，取消所有任务
}

/** 清除缓存请求 */
export interface ClearCacheRequest {
  type: 'clear_cache';
  id: string;
}

/** 获取统计请求 */
export interface GetStatsRequest {
  type: 'get_stats';
  id: string;
}

/** Worker 请求 */
export type ParseWorkerRequest =
  | ParseRequest
  | IncrementalParseRequest
  | ChunkedParseRequest
  | RenderRequest
  | RenderBlocksRequest
  | CancelRequest
  | ClearCacheRequest
  | GetStatsRequest;

/** 解析结果响应 */
export interface ParseResultResponse {
  type: 'parse_result';
  id: string;
  success: boolean;
  ast?: RootNode;
  errors?: Array<{ message: string; line?: number; column?: number }>;
  warnings?: Array<{ message: string; line?: number; column?: number }>;
  parseTime: number;
}

/** 解析进度响应 */
export interface ParseProgressResponse {
  type: 'parse_progress';
  id: string;
  progress: number; // 0-1
  currentChunk: number;
  totalChunks: number;
  parsedLength: number;
  totalLength: number;
}

/** 分块解析结果响应 */
export interface ParseChunkResponse {
  type: 'parse_chunk';
  id: string;
  chunkIndex: number;
  totalChunks: number;
  nodes: LatexNode[];
  chunkStart: number;
  chunkEnd: number;
  isLast: boolean;
}

/** 渲染结果响应 */
export interface RenderResultResponse {
  type: 'render_result';
  id: string;
  success: boolean;
  html?: string;
  error?: string;
  renderTime: number;
}

/** 渲染进度响应 */
export interface RenderProgressResponse {
  type: 'render_progress';
  id: string;
  progress: number;
  renderedBlocks: number;
  totalBlocks: number;
}

/** 取消响应 */
export interface CancelledResponse {
  type: 'cancelled';
  id: string;
}

/** 错误响应 */
export interface ErrorResponse {
  type: 'error';
  id: string;
  error: string;
  stack?: string;
}

/** 统计响应 */
export interface StatsResponse {
  type: 'stats';
  id: string;
  stats: WorkerStats;
}

/** Worker 响应 */
export type ParseWorkerResponse =
  | ParseResultResponse
  | ParseProgressResponse
  | ParseChunkResponse
  | RenderResultResponse
  | RenderProgressResponse
  | CancelledResponse
  | ErrorResponse
  | StatsResponse;

/** Worker 统计信息 */
export interface WorkerStats {
  /** 总解析次数 */
  totalParses: number;
  /** 成功解析次数 */
  successfulParses: number;
  /** 失败解析次数 */
  failedParses: number;
  /** 平均解析时间（毫秒） */
  averageParseTime: number;
  /** 总渲染次数 */
  totalRenders: number;
  /** 平均渲染时间（毫秒） */
  averageRenderTime: number;
  /** 缓存命中次数 */
  cacheHits: number;
  /** 缓存未命中次数 */
  cacheMisses: number;
  /** 当前内存使用（估计） */
  estimatedMemory: number;
}

// ================================
// Worker 状态
// ================================

/** 增量解析器实例 */
let incrementalParser: IncrementalLatexParser | null = null;

/** 渲染器实例 */
let renderer: LatexRenderer | null = null;

/** 当前处理的请求集合 */
const activeRequests = new Set<string>();

/** 被取消的请求集合 */
const cancelledRequests = new Set<string>();

/** 统计信息 */
const stats: WorkerStats = {
  totalParses: 0,
  successfulParses: 0,
  failedParses: 0,
  averageParseTime: 0,
  totalRenders: 0,
  averageRenderTime: 0,
  cacheHits: 0,
  cacheMisses: 0,
  estimatedMemory: 0,
};

/** 解析时间累计（用于计算平均值） */
let totalParseTime = 0;

/** 渲染时间累计（用于计算平均值） */
let totalRenderTime = 0;

/** 分块解析默认块大小（字节） */
const DEFAULT_CHUNK_SIZE = 32768; // 32KB

/** 每批处理的最大节点数 */
const MAX_NODES_PER_BATCH = 50;

/** 让出控制权的间隔（毫秒） */
const YIELD_INTERVAL = 5;

// ================================
// 消息处理
// ================================

/**
 * 处理来自主线程的消息
 */
self.onmessage = async (event: MessageEvent<ParseWorkerRequest>) => {
  const request = event.data;

  // 处理取消请求
  if (request.type === 'cancel') {
    handleCancel(request);
    return;
  }

  // 记录活跃请求
  activeRequests.add(request.id);

  try {
    let response: ParseWorkerResponse;

    switch (request.type) {
      case 'parse':
        response = await handleParse(request);
        break;
      case 'parse_incremental':
        response = await handleIncrementalParse(request);
        break;
      case 'parse_chunked':
        await handleChunkedParse(request);
        return; // 分块解析会发送多个响应
      case 'render':
        response = await handleRender(request);
        break;
      case 'render_blocks':
        await handleRenderBlocks(request);
        return; // 块渲染会发送多个响应
      case 'clear_cache':
        response = handleClearCache(request);
        break;
      case 'get_stats':
        response = handleGetStats(request);
        break;
      default:
        response = {
          type: 'error',
          id: (request as ParseWorkerRequest).id || 'unknown',
          error: `未知的请求类型: ${(request as ParseWorkerRequest).type}`,
        };
    }

    // 检查是否已取消
    if (cancelledRequests.has(request.id)) {
      self.postMessage({
        type: 'cancelled',
        id: request.id,
      } as CancelledResponse);
      cancelledRequests.delete(request.id);
      return;
    }

    self.postMessage(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    self.postMessage({
      type: 'error',
      id: request.id,
      error: errorMessage,
      stack: errorStack,
    } as ErrorResponse);
  } finally {
    activeRequests.delete(request.id);
  }
};

// ================================
// 请求处理函数
// ================================

/**
 * 处理取消请求
 */
function handleCancel(request: CancelRequest): void {
  if (request.id) {
    // 取消特定请求
    if (activeRequests.has(request.id)) {
      cancelledRequests.add(request.id);
    }
    self.postMessage({
      type: 'cancelled',
      id: request.id,
    } as CancelledResponse);
  } else {
    // 取消所有请求
    for (const id of activeRequests) {
      cancelledRequests.add(id);
      self.postMessage({
        type: 'cancelled',
        id,
      } as CancelledResponse);
    }
  }
}

/**
 * 检查请求是否已取消
 */
function isCancelled(requestId: string): boolean {
  return cancelledRequests.has(requestId);
}

/**
 * 让出控制权给事件循环
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 带超时的让出控制权
 */
function yieldWithDelay(ms: number = YIELD_INTERVAL): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 处理完整解析请求
 */
async function handleParse(request: ParseRequest): Promise<ParseResultResponse> {
  const startTime = performance.now();

  stats.totalParses++;

  try {
    const parser = new LatexParser(request.content, request.options);
    const result = parser.parse();

    // 更新增量解析器缓存
    if (!incrementalParser) {
      incrementalParser = new IncrementalLatexParser();
    }

    const parseTime = performance.now() - startTime;
    totalParseTime += parseTime;
    stats.averageParseTime = totalParseTime / stats.totalParses;
    stats.successfulParses++;

    return {
      type: 'parse_result',
      id: request.id,
      success: result.success,
      ast: result.ast,
      errors: result.errors,
      warnings: result.warnings,
      parseTime,
    };
  } catch (error) {
    stats.failedParses++;
    throw error;
  }
}

/**
 * 处理增量解析请求
 */
async function handleIncrementalParse(
  request: IncrementalParseRequest
): Promise<ParseResultResponse> {
  const startTime = performance.now();

  stats.totalParses++;

  try {
    // 确保增量解析器存在
    if (!incrementalParser) {
      incrementalParser = new IncrementalLatexParser();
    }

    const result = incrementalParser.parse(request.content, request.changes, request.options);

    const parseTime = performance.now() - startTime;
    totalParseTime += parseTime;
    stats.averageParseTime = totalParseTime / stats.totalParses;
    stats.successfulParses++;

    // 更新缓存统计
    if (result.fullReparse) {
      stats.cacheMisses++;
    } else {
      stats.cacheHits++;
    }

    return {
      type: 'parse_result',
      id: request.id,
      success: true,
      ast: result.ast,
      parseTime,
    };
  } catch (error) {
    stats.failedParses++;
    throw error;
  }
}

/**
 * 处理分块解析请求（流式响应）
 */
async function handleChunkedParse(request: ChunkedParseRequest): Promise<void> {
  const startTime = performance.now();
  const { id, content, chunkSize = DEFAULT_CHUNK_SIZE, options } = request;

  stats.totalParses++;

  try {
    const totalLength = content.length;
    const chunks = splitIntoChunks(content, chunkSize);
    const totalChunks = chunks.length;

    let parsedLength = 0;
    const allNodes: LatexNode[] = [];

    for (let i = 0; i < chunks.length; i++) {
      // 检查是否取消
      if (isCancelled(id)) {
        cancelledRequests.delete(id);
        activeRequests.delete(id);
        return;
      }

      const chunk = chunks[i];
      const chunkStart = parsedLength;
      const chunkEnd = chunkStart + chunk.length;

      // 解析当前块
      const parser = new LatexParser(chunk, {
        ...options,
      });

      const result = parser.parse();

      // 收集解析出的节点
      const nodes = collectNodesFromAST(result.ast);

      // 调整节点偏移
      for (const node of nodes) {
        if ('start' in node) {
          (node as { start: number }).start += chunkStart;
        }
        if ('end' in node) {
          (node as { end: number }).end += chunkStart;
        }
        allNodes.push(node);
      }

      parsedLength = chunkEnd;

      // 发送块解析结果
      self.postMessage({
        type: 'parse_chunk',
        id,
        chunkIndex: i,
        totalChunks,
        nodes,
        chunkStart,
        chunkEnd,
        isLast: i === chunks.length - 1,
      } as ParseChunkResponse);

      // 发送进度
      self.postMessage({
        type: 'parse_progress',
        id,
        progress: (i + 1) / totalChunks,
        currentChunk: i + 1,
        totalChunks,
        parsedLength,
        totalLength,
      } as ParseProgressResponse);

      // 每处理一个块让出控制权
      await yieldToEventLoop();
    }

    const parseTime = performance.now() - startTime;
    totalParseTime += parseTime;
    stats.averageParseTime = totalParseTime / stats.totalParses;
    stats.successfulParses++;

    // 发送最终结果
    self.postMessage({
      type: 'parse_result',
      id,
      success: true,
      ast: buildASTFromNodes(allNodes, content),
      parseTime,
    } as ParseResultResponse);
  } catch (error) {
    stats.failedParses++;
    throw error;
  } finally {
    activeRequests.delete(id);
  }
}

/**
 * 处理渲染请求
 */
async function handleRender(request: RenderRequest): Promise<RenderResultResponse> {
  const startTime = performance.now();

  stats.totalRenders++;

  try {
    // 确保渲染器存在
    if (!renderer) {
      renderer = new LatexRenderer(request.options);
    }

    const result = renderer.render(request.ast);

    const renderTime = performance.now() - startTime;
    totalRenderTime += renderTime;
    stats.averageRenderTime = totalRenderTime / stats.totalRenders;

    return {
      type: 'render_result',
      id: request.id,
      success: result.success,
      html: result.html,
      error: result.error,
      renderTime,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 处理块渲染请求（流式响应）
 */
async function handleRenderBlocks(request: RenderBlocksRequest): Promise<void> {
  const startTime = performance.now();
  const { id, nodes, options } = request;

  stats.totalRenders++;

  try {
    // 确保渲染器存在
    if (!renderer) {
      renderer = new LatexRenderer(options);
    }

    const totalBlocks = nodes.length;
    const htmlParts: string[] = [];
    let renderedBlocks = 0;

    // 分批处理节点
    for (let i = 0; i < nodes.length; i += MAX_NODES_PER_BATCH) {
      // 检查是否取消
      if (isCancelled(id)) {
        cancelledRequests.delete(id);
        activeRequests.delete(id);
        return;
      }

      const batch = nodes.slice(i, Math.min(i + MAX_NODES_PER_BATCH, nodes.length));

      for (const node of batch) {
        const html = renderer.renderNode(node);
        htmlParts.push(html);
        renderedBlocks++;
      }

      // 发送进度
      self.postMessage({
        type: 'render_progress',
        id,
        progress: renderedBlocks / totalBlocks,
        renderedBlocks,
        totalBlocks,
      } as RenderProgressResponse);

      // 让出控制权
      await yieldWithDelay();
    }

    const renderTime = performance.now() - startTime;
    totalRenderTime += renderTime;
    stats.averageRenderTime = totalRenderTime / stats.totalRenders;

    // 发送最终结果
    self.postMessage({
      type: 'render_result',
      id,
      success: true,
      html: htmlParts.join('\n'),
      renderTime,
    } as RenderResultResponse);
  } catch (error) {
    throw error;
  } finally {
    activeRequests.delete(id);
  }
}

/**
 * 处理清除缓存请求
 */
function handleClearCache(request: ClearCacheRequest): StatsResponse {
  incrementalParser = null;
  renderer = null;

  // 重置统计
  stats.cacheHits = 0;
  stats.cacheMisses = 0;

  // 估算内存
  stats.estimatedMemory = estimateMemoryUsage();

  return {
    type: 'stats',
    id: request.id,
    stats: { ...stats },
  };
}

/**
 * 处理获取统计请求
 */
function handleGetStats(request: GetStatsRequest): StatsResponse {
  stats.estimatedMemory = estimateMemoryUsage();

  return {
    type: 'stats',
    id: request.id,
    stats: { ...stats },
  };
}

// ================================
// 工具函数
// ================================

/**
 * 将内容分割为块
 */
function splitIntoChunks(content: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let currentPos = 0;

  while (currentPos < content.length) {
    let endPos = Math.min(currentPos + chunkSize, content.length);

    // 尝试在自然边界处分割
    if (endPos < content.length) {
      // 优先在段落边界分割
      const paragraphBreak = content.lastIndexOf('\n\n', endPos);
      if (paragraphBreak > currentPos) {
        endPos = paragraphBreak + 2;
      } else {
        // 其次在行边界分割
        const lineBreak = content.lastIndexOf('\n', endPos);
        if (lineBreak > currentPos) {
          endPos = lineBreak + 1;
        }
      }
    }

    chunks.push(content.slice(currentPos, endPos));
    currentPos = endPos;
  }

  return chunks;
}

/**
 * 从 AST 收集所有节点
 */
function collectNodesFromAST(ast: RootNode | null): LatexNode[] {
  if (!ast) return [];

  const nodes: LatexNode[] = [];

  function traverse(node: LatexNode): void {
    nodes.push(node);

    // 遍历子节点
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }

    // 根节点：直接遍历文档正文的子节点
    const typed = node as AnyLatexNode;
    if (typed.type === 'root' && typed.document) {
      for (const child of typed.document.children) {
        traverse(child);
      }
    }
  }

  traverse(ast);

  return nodes;
}

/**
 * 从节点列表构建 AST
 */
function buildASTFromNodes(_nodes: LatexNode[], content: string): RootNode {
  // 简化实现：创建基本的 AST 结构
  return {
    type: 'root',
    id: `root-${Date.now()}`,
    start: 0,
    end: content.length,
    raw: content,
    hash: String(hashString(content)),
    preamble: null,
    document: {
      type: 'document',
      id: `doc-${Date.now()}`,
      start: 0,
      end: content.length,
      raw: content,
      hash: String(hashString(content)),
      children: [],
    },
    documentClass: null,
    version: 1,
  };
}

/**
 * 计算字符串哈希
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}

/**
 * 估算内存使用
 */
function estimateMemoryUsage(): number {
  let estimated = 0;

  // 基础开销
  estimated += 1024 * 10; // 10KB 基础开销

  // 增量解析器缓存估算
  if (incrementalParser) {
    estimated += 1024 * 100; // 估算 100KB
  }

  // 渲染器缓存估算
  if (renderer) {
    estimated += 1024 * 50; // 估算 50KB
  }

  return estimated;
}

// ================================
// Worker 错误处理
// ================================

self.onerror = (event) => {
  console.error('[ParseWorker] 错误:', event);
};

self.onmessageerror = (event) => {
  console.error('[ParseWorker] 消息错误:', event);
};

// ================================
// 导出类型（供主线程使用）
// 类型已在上方定义并导出
// ================================
