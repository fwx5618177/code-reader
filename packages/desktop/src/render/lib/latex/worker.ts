// ================================
// LaTeX Web Worker
// 后台处理 LaTeX 解析和渲染
// 避免阻塞主线程，提升大文档的响应速度
// ================================

import type {
  WorkerRequest,
  WorkerResponse,
  LatexParserOptions,
  LatexRenderOptions,
  DocumentChange,
} from './types';
import { LatexParser, IncrementalLatexParser } from './parser';
import { LatexRenderer } from './renderer';

// ================================
// Worker 状态
// ================================

/** 增量解析器实例 */
let incrementalParser: IncrementalLatexParser | null = null;

/** 渲染器实例 */
let renderer: LatexRenderer | null = null;

/** 当前处理的请求 ID */
let currentRequestId: string | null = null;

/** 是否已取消 */
let isCancelled = false;

// ================================
// 消息处理
// ================================

/**
 * 处理来自主线程的消息
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  // 取消请求
  if (request.type === 'cancel') {
    isCancelled = true;
    currentRequestId = null;
    return;
  }

  // 设置当前请求
  currentRequestId = request.id;
  isCancelled = false;

  try {
    let response: WorkerResponse;
    const startTime = performance.now();

    switch (request.type) {
      case 'parse':
        response = await handleParse(request);
        break;
      case 'parse_incremental':
        response = await handleIncrementalParse(request);
        break;
      case 'render':
        response = await handleRender(request);
        break;
      case 'render_block':
        response = await handleRenderBlock(request);
        break;
      default:
        response = {
          id: request.id,
          success: false,
          error: `未知的请求类型: ${request.type}`,
          time: performance.now() - startTime,
        };
    }

    // 检查是否已取消
    if (isCancelled || currentRequestId !== request.id) {
      return;
    }

    self.postMessage(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({
      id: request.id,
      success: false,
      error: message,
      time: 0,
    } as WorkerResponse);
  }
};

// ================================
// 请求处理函数
// ================================

/**
 * 处理完整解析请求
 */
async function handleParse(request: WorkerRequest): Promise<WorkerResponse> {
  const startTime = performance.now();
  const { content, options } = request.data as {
    content: string;
    options?: LatexParserOptions;
  };

  const parser = new LatexParser(content, options);
  const result = parser.parse();

  // 缓存增量解析器
  if (!incrementalParser) {
    incrementalParser = new IncrementalLatexParser();
  }

  return {
    id: request.id,
    success: result.success,
    data: {
      ast: result.ast,
      errors: result.errors,
      warnings: result.warnings,
      parseTime: result.parseTime,
    },
    time: performance.now() - startTime,
  };
}

/**
 * 处理增量解析请求
 */
async function handleIncrementalParse(request: WorkerRequest): Promise<WorkerResponse> {
  const startTime = performance.now();
  const { content, changes, options } = request.data as {
    content: string;
    changes: DocumentChange[];
    options?: LatexParserOptions;
  };

  // 确保增量解析器存在
  if (!incrementalParser) {
    incrementalParser = new IncrementalLatexParser();
  }

  const result = incrementalParser.parse(content, changes, options);

  return {
    id: request.id,
    success: true,
    data: {
      ast: result.ast,
      affectedNodeIds: result.affectedNodeIds,
      dirtyNodeIds: result.dirtyNodeIds,
      fullReparse: result.fullReparse,
      parseTime: result.parseTime,
    },
    time: performance.now() - startTime,
  };
}

/**
 * 处理渲染请求
 */
async function handleRender(request: WorkerRequest): Promise<WorkerResponse> {
  const startTime = performance.now();
  const { ast, options } = request.data as {
    ast: unknown;
    options?: LatexRenderOptions;
  };

  // 确保渲染器存在
  if (!renderer) {
    renderer = new LatexRenderer(options);
  }

  // 类型检查和转换
  const rootNode = ast as import('./types').RootNode;
  const result = renderer.render(rootNode);

  return {
    id: request.id,
    success: result.success,
    data: {
      html: result.html,
      renderTime: result.renderTime,
    },
    error: result.error,
    time: performance.now() - startTime,
  };
}

/**
 * 处理块渲染请求
 */
async function handleRenderBlock(request: WorkerRequest): Promise<WorkerResponse> {
  const startTime = performance.now();
  const { nodes, options } = request.data as {
    nodes: unknown[];
    options?: LatexRenderOptions;
  };

  // 确保渲染器存在
  if (!renderer) {
    renderer = new LatexRenderer(options);
  }

  // 渲染每个节点
  const results: { id: string; html: string }[] = [];
  const latexNodes = nodes as import('./types').LatexNode[];

  for (const node of latexNodes) {
    // 检查是否已取消
    if (isCancelled) {
      break;
    }

    const html = renderer.renderNode(node);
    results.push({ id: node.id, html });

    // 每处理 10 个节点让出控制权
    if (results.length % 10 === 0) {
      await yieldToEventLoop();
    }
  }

  return {
    id: request.id,
    success: true,
    data: {
      results,
      renderTime: performance.now() - startTime,
    },
    time: performance.now() - startTime,
  };
}

// ================================
// 工具函数
// ================================

/**
 * 让出控制权给事件循环
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * 重置 Worker 状态
 */
function resetState(): void {
  incrementalParser = null;
  renderer = null;
  currentRequestId = null;
  isCancelled = false;
}

// ================================
// Worker 错误处理
// ================================

self.onerror = (event) => {
  console.error('LaTeX Worker 错误:', event);
};

self.onmessageerror = (event) => {
  console.error('LaTeX Worker 消息错误:', event);
};

// ================================
// 导出类型（供主线程使用）
// ================================

export type { WorkerRequest, WorkerResponse };
