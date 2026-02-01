// ================================
// LaTeX 引擎主入口
// 整合解析器、渲染器和 Web Worker
// 提供统一的 API 接口
//
// 包含：
// 1. LatexEngine - 基础引擎，使用手写解析器
// 2. IncrementalLatexEngine - 增量引擎，真正的增量解析 + AST 缓存
// 3. CodeMirror LaTeX 语法高亮扩展
// 4. 数学公式 Web Worker 渲染器
// ================================

// ================================
// 导出类型
// ================================

export type {
  // 节点类型
  LatexNodeType,
  LatexNode,
  RootNode,
  PreambleNode,
  DocumentNode,
  CommandNode,
  EnvironmentNode,
  GroupNode,
  TextNode,
  MathInlineNode,
  MathBlockNode,
  CommentNode,
  ParagraphNode,
  SectionNode,
  ListNode,
  ListItemNode,
  ErrorNode,
  AnyLatexNode,
  // 辅助类型
  PackageInfo,
  MacroDefinition,
  // 解析相关
  LatexParserOptions,
  LatexParseResult,
  ParseError,
  ParseWarning,
  DocumentChange as TypesDocumentChange,
  IncrementalParseResult,
  // 渲染相关
  LatexRenderOptions,
  LatexRenderResult,
  RenderBlock,
  RenderCacheEntry,
  CacheConfig,
  // Worker 相关
  WorkerMessageType,
  WorkerRequest,
  WorkerResponse,
} from './types';

// ================================
// 导出解析器
// ================================

export {
  LatexParser,
  IncrementalLatexParser,
  parseLatex,
  createIncrementalParser,
  resetNodeIdCounter,
} from './parser';

// ================================
// 导出渲染器
// ================================

export {
  LatexRenderer,
  VisibilityPriorityRenderer,
  renderLatexAST,
  createVisibilityRenderer,
} from './renderer';

// ================================
// 导出增量引擎
// ================================

export {
  IncrementalLatexEngine,
  createIncrementalEngine,
  getIncrementalEngine,
  destroyIncrementalEngine,
} from './incremental-engine';

export type { IncrementalEngineConfig } from './incremental-engine';

// ================================
// 导出 CodeMirror LaTeX 语法高亮
// ================================

export {
  latexLanguage,
  latexDarkHighlightStyle,
  latexLightHighlightStyle,
  latex,
  latexWithTheme,
} from './codemirror-latex';

// ================================
// 导出数学公式 Worker 类型和服务
// ================================

export type { MathRenderRequest, MathRenderResponse } from './math-worker';

export {
  MathWorkerService,
  getMathWorkerService,
  destroyMathWorkerService,
  renderMathBatch,
  renderMathFormula,
} from './math-worker-service';

export type {
  MathFormulaItem,
  MathRenderResultItem,
  MathWorkerServiceConfig,
} from './math-worker-service';

// ================================
// 导出 LaTeX 文档模型
// ================================

export {
  LatexDocument,
  createLatexDocument,
  createAutoLatexDocument,
  createLargeFileLatexDocument,
} from './latex-document';

export type {
  DocumentChange as LatexDocumentChange,
  EditOperation,
  EditHistoryConfig,
  SourceMapEntry,
  LineInfo,
  DocumentStats,
  DocumentChangeListener,
  LatexDocumentConfig,
} from './latex-document';

// ================================
// 导出增量渲染器
// ================================

export {
  IncrementalRenderer,
  ASTDiffer,
  createIncrementalRenderer,
  createASTDiffer,
} from './incremental-renderer';

export type {
  DiffType,
  NodeDiff,
  ASTDiffResult,
  DiffStats,
  RenderBlock as IncrementalRenderBlock,
  DOMUpdate,
  IncrementalRendererConfig,
} from './incremental-renderer';

// ================================
// 导出 Source Map 生成器
// ================================

export {
  SourceMapGenerator,
  createSourceMapGenerator,
  createSourceMapFromAST,
  computePreviewScrollPosition,
  computeSourceScrollPosition,
} from './source-map-generator';

export type {
  SourceMapEntry as SourceMapGeneratorEntry,
  SourceMapBlockType,
  PositionQueryResult,
  RenderBlockPosition,
  SourceMapStats,
} from './source-map-generator';

// ================================
// 导出 Worker 服务
// ================================

export {
  LatexWorkerService,
  getLatexWorkerService,
  destroyLatexWorkerService,
  createLatexWorkerService,
} from './worker-service';

// ================================
// 导出 AST 缓存管理器
// ================================

export {
  getASTCacheManager,
  destroyASTCacheManager,
  resetASTCacheManager,
} from './ast-cache-manager';

export type {
  ASTCacheManager,
  ASTCacheConfig,
  CacheStats,
  StringSlice,
  LightweightNode,
} from './ast-cache-manager';

// ================================
// 导出真实高度映射
// ================================

export {
  RealHeightMap,
  createRealHeightMap,
  measureBlockElements,
  createBlockResizeObserver as createRealHeightResizeObserver,
  createBlockVisibilityObserver as createRealHeightVisibilityObserver,
} from './real-height-map';

export type {
  RenderBlock as RealHeightRenderBlock,
  BlockType as RealHeightBlockType,
  PositionQueryResult as RealHeightPositionQueryResult,
  LineQueryResult as RealHeightLineQueryResult,
  MeasurementResult,
  RealHeightMapConfig,
} from './real-height-map';

export type {
  TaskStatus,
  TaskPriority,
  TaskType,
  TaskConfig,
  TaskResult,
  ParseTaskData,
  IncrementalParseTaskData,
  RenderTaskData,
  RenderBlockTaskData,
  WorkerServiceConfig,
  WorkerServiceStats,
} from './worker-service';

// ================================
// 导出性能监控模块
// ================================

export {
  PerformanceMonitor,
  getPerformanceMonitor,
  destroyPerformanceMonitor,
  measurePerformance,
  measurePerformanceAsync,
} from './performance-monitor';

export type {
  PerformanceEntry,
  PerformanceStats,
  PerformanceThresholds,
  PerformanceReport,
  PerformanceWarning,
} from './performance-monitor';

// ================================
// 导出流式解析器
// ================================

export { StreamingParser, createStreamingParser } from './streaming-parser';

export type {
  ChunkType,
  DocumentChunk,
  ChunkChangeType,
  ChunkChange,
  ChunkingResult,
  IncrementalChunkingResult,
  TextChange,
  StreamingParserConfig,
} from './streaming-parser';

// ================================
// 导出解析调度器
// ================================

export {
  ParseScheduler,
  MemoryController,
  TaskPriority as SchedulerTaskPriority,
  TaskStatus as SchedulerTaskStatus,
  createParseScheduler,
  createMemoryController,
} from './parse-scheduler';

export type {
  TaskType as SchedulerTaskType,
  ParseTask as SchedulerParseTask,
  SchedulerConfig,
  SchedulerStats,
  TaskCallback,
} from './parse-scheduler';

// ================================
// 导出对象池管理器
// ================================

export {
  ObjectPool,
  getASTNodePool,
  getRenderBlockPool,
  getStringBuilderPool,
  getMemoryMonitor,
  clearAllPools,
  destroyAllPools,
  getAllPoolStats,
  StringBuilder,
  MemoryPressure,
} from './chunk-pool';

export type {
  PoolConfig,
  PoolStats,
  Poolable,
  PoolableASTNode,
  PoolableRenderBlock,
} from './chunk-pool';

// ================================
// 导出流式解析引擎
// ================================

export {
  StreamingEngine,
  createStreamingEngine,
  createHighPerformanceEngine,
} from './streaming-engine';

export type {
  ParseChunkType,
  ParseChunkStatus,
  ParseChunk,
  FrameBudgetConfig,
  ParseTask as StreamingParseTask,
  StreamingParseResult,
  IncrementalChange,
  StreamingEngineConfig,
} from './streaming-engine';

// ================================
// 导出精确 Source Map
// ================================

export {
  PreciseSourceMap,
  createPreciseSourceMap,
  createSourceMapFromAST as createPreciseSourceMapFromAST,
  measureDOMBlocks,
  createBlockResizeObserver,
  createBlockVisibilityObserver,
} from './precise-source-map';

export type {
  BlockType,
  SourceMapEntry as PreciseSourceMapEntry,
  PositionQueryResult as PrecisePositionQueryResult,
  LineQueryResult,
  DOMBlockMeasurement,
  PreciseSourceMapConfig,
  DOMMeasurementOptions,
} from './precise-source-map';

// ================================
// 导出数学环境处理工具
// ================================

export {
  processMathContent,
  extractMathContent,
  extractEnvName,
  getEnvInfo,
  analyzeMathContent,
  getWrapSuggestion,
  getEnvCssClass,
  getEnvHtmlAttributes,
  formatHtmlAttributes,
  isMathEnv,
  isMatrixEnv,
  isCasesEnv,
  isAlignEnv,
  isGatherEnv,
  ENV_SETS,
} from './math-env-handler';

export type {
  MathEnvType,
  MathEnvInfo,
  MathContentAnalysis,
  WrapSuggestion,
} from './math-env-handler';

// ================================
// 导出高度映射系统 (HeightMap)
// ================================

export {
  HeightMap,
  createHeightMap,
  createHeightMapFromAST,
  measureDOMBlocks as measureHeightMapDOMBlocks,
  createBlockResizeObserver as createHeightMapResizeObserver,
  createBlockVisibilityObserver as createHeightMapVisibilityObserver,
  findBlockById,
  collectLeaves,
} from './height-map';

export type {
  HeightBlockType,
  HeightBlock,
  PositionQueryResult as HeightMapPositionQueryResult,
  LineQueryResult as HeightMapLineQueryResult,
  HeightMapConfig,
  DOMMeasurementOptions as HeightMapDOMMeasurementOptions,
} from './height-map';

// ================================
// 导出帧预算调度器 (FrameScheduler)
// ================================

export {
  FrameScheduler,
  TaskPriority as FrameTaskPriority,
  TaskStatus as FrameTaskStatus,
  MemoryPressure as FrameMemoryPressure,
  createFrameScheduler,
  createHighPerformanceScheduler,
  getGlobalScheduler,
  destroyGlobalScheduler,
} from './frame-scheduler';

export type {
  ScheduledTask,
  FrameBudgetConfig as FrameSchedulerConfig,
  SchedulerStats as FrameSchedulerStats,
} from './frame-scheduler';

// ================================
// 导出渲染管道 (RenderPipeline)
// ================================

export {
  RenderPipeline,
  createRenderPipeline,
  createHighPerformancePipeline,
} from './render-pipeline';

export type {
  RenderBlockStatus,
  RenderBlock as PipelineRenderBlock,
  RenderBlockType as PipelineRenderBlockType,
  VisibleRange,
  RenderPipelineConfig,
  ScrollSyncResult,
  PipelineRenderResult,
  PipelineEvent,
  PipelineEventListener,
} from './render-pipeline';

// ================================
// 导出流式解析器 V2 (高性能版)
// ================================

export {
  StreamingParserV2,
  createStreamingParserV2,
  createHighPerformanceParser,
  getGlobalStreamingParser,
  destroyGlobalStreamingParser,
} from './streaming-parser-v2';

export type {
  ChunkStatus,
  ChunkType as StreamingChunkType,
  ParseChunk as StreamingParseChunk,
  DocumentChange as StreamingDocumentChange,
  StreamingParseResult as StreamingParserResult,
  StreamingParserConfig as StreamingParserV2Config,
} from './streaming-parser-v2';

// ================================
// 导出流式解析管道 (高性能 Rope 数据结构)
// ================================

export {
  StreamingPipeline,
  createStreamingPipeline,
  FrameScheduler as PipelineFrameScheduler,
  LineOffsetIndex,
  hashString as pipelineHashString,
  generateId as pipelineGenerateId,
  detectBlockBoundaries,
  ropeFromString,
  ropeToString,
  ropeSlice,
  ropeInsert,
  ropeDelete,
  ropeLineToOffset,
  ropeOffsetToLine,
} from './streaming-pipeline';

export type {
  ParseBlockType,
  ParseBlock,
  EditOperation as PipelineEditOperation,
  PositionMapping,
  ParseProgressCallback,
  RenderProgressCallback,
  TaskPriority as PipelineTaskPriority,
  PipelineConfig,
} from './streaming-pipeline';

// ================================
// 导出帧调度解析器 (任务调度)
// ================================

export {
  FrameParseScheduler,
  ParseTaskPriority,
  ParseTaskStatus,
  MemoryPressureLevel,
  createFrameParseScheduler,
  createHighPerformanceScheduler as createHighPerfScheduler,
  getGlobalScheduler as getGlobalParseScheduler,
  destroyGlobalScheduler as destroyGlobalParseScheduler,
} from './frame-parse-scheduler';

export type {
  ParseTask as FrameParseTask,
  FrameParseSchedulerConfig,
  SchedulerStats as ParseSchedulerStats,
} from './frame-parse-scheduler';

// ================================
// 导出高性能后台解析 Worker 服务
// ================================

export {
  ParseWorkerService,
  getParseWorkerService,
  destroyParseWorkerService,
  parseLatex as parseLatexWithWorker,
  renderLatex as renderLatexWithWorker,
  parseAndRenderLatex,
} from './parse-worker-service';

export type {
  ParseProgressCallback as WorkerParseProgressCallback,
  RenderProgressCallback as WorkerRenderProgressCallback,
  ChunkCallback,
  ParseOptions as WorkerParseOptions,
  RenderOptions as WorkerRenderOptions,
  ParseWorkerServiceConfig,
} from './parse-worker-service';

export type {
  ParseWorkerRequest,
  ParseWorkerResponse,
  WorkerStats as ParseWorkerStats,
} from './parse-worker';

// ================================
// 导出流式管道集成器
// ================================

export {
  PipelineIntegration,
  createPipelineIntegration,
  getGlobalPipelineIntegration,
  destroyGlobalPipelineIntegration,
} from './pipeline-integration';

export type {
  IntegrationConfig,
  ParseRenderResult,
  IncrementalUpdateResult,
  ScrollSyncRequest,
  ScrollSyncResult as PipelineScrollSyncResult,
  VisibleBlockInfo,
  ProgressCallback,
  MeasurementCallback,
} from './pipeline-integration';

// ================================
// 导出精确滚动同步控制器
// ================================

export {
  ScrollSyncController,
  createScrollSyncController,
  getGlobalScrollSyncController,
  destroyGlobalScrollSyncController,
  computeEditorToPreviewPosition,
  computePreviewToEditorPosition,
  createDebouncedScrollHandler,
  createThrottledScrollHandler,
} from './scroll-sync';

export type {
  ScrollSyncSource,
  ScrollSyncMode,
  ScrollState,
  SyncResult,
  ScrollSyncConfig,
  ScrollSyncCallback,
  VisibleBlock,
} from './scroll-sync';

// ================================
// LaTeX 引擎类
// ================================

import type {
  RootNode,
  LatexParserOptions,
  LatexRenderOptions,
  LatexRenderResult,
  DocumentChange,
  IncrementalParseResult,
  WorkerRequest,
  WorkerResponse,
} from './types';
import { LatexParser, IncrementalLatexParser } from './parser';
import { LatexRenderer, VisibilityPriorityRenderer } from './renderer';

/** 引擎配置 */
export interface LatexEngineConfig {
  /** 是否使用 Web Worker */
  useWorker?: boolean;
  /** 解析选项 */
  parserOptions?: LatexParserOptions;
  /** 渲染选项 */
  renderOptions?: LatexRenderOptions;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
}

/** 默认配置 */
const DEFAULT_ENGINE_CONFIG: Required<LatexEngineConfig> = {
  useWorker: true,
  parserOptions: {},
  renderOptions: {},
  debounceMs: 150,
};

/**
 * LaTeX 引擎
 * 提供完整的解析和渲染功能
 * 支持增量编译、缓存和后台渲染
 */
export class LatexEngine {
  private config: Required<LatexEngineConfig>;
  private incrementalParser: IncrementalLatexParser;
  private renderer: LatexRenderer;
  private visibilityRenderer: VisibilityPriorityRenderer | null = null;
  private worker: Worker | null = null;
  private workerReady: boolean = false;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
  > = new Map();
  private requestIdCounter: number = 0;
  private cachedAST: RootNode | null = null;
  private cachedContent: string = '';
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onRenderCallback?: (html: string) => void;

  constructor(config?: LatexEngineConfig) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.incrementalParser = new IncrementalLatexParser();
    this.renderer = new LatexRenderer(this.config.renderOptions);

    // 初始化 Worker（如果配置启用）
    if (this.config.useWorker) {
      this.initWorker();
    }
  }

  /**
   * 初始化 Web Worker
   */
  private initWorker(): void {
    try {
      // 创建 Worker（使用 Vite 的 Worker 导入方式）
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerResponse(event.data);
      };

      this.worker.onerror = (error) => {
        console.error('LaTeX Worker 错误:', error);
        this.workerReady = false;
      };

      this.workerReady = true;
    } catch (error) {
      console.warn('无法创建 LaTeX Worker，将使用主线程:', error);
      this.worker = null;
      this.workerReady = false;
    }
  }

  /**
   * 处理 Worker 响应
   */
  private handleWorkerResponse(response: WorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);

    if (response.success) {
      pending.resolve(response.data);
    } else {
      pending.reject(new Error(response.error || '未知错误'));
    }
  }

  /**
   * 发送请求到 Worker
   */
  private sendToWorker<T>(type: WorkerRequest['type'], data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.workerReady) {
        reject(new Error('Worker 不可用'));
        return;
      }

      const id = `req_${++this.requestIdCounter}_${Date.now()}`;
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      const request: WorkerRequest = { id, type, data };
      this.worker.postMessage(request);
    });
  }

  /**
   * 解析 LaTeX 文档
   * @param content LaTeX 源码
   * @param useCache 是否使用缓存（增量解析）
   */
  async parse(content: string, useCache: boolean = true): Promise<RootNode> {
    // 检查内容是否变化
    if (useCache && content === this.cachedContent && this.cachedAST) {
      return this.cachedAST;
    }

    // 计算变更
    const changes: DocumentChange[] = [];
    if (useCache && this.cachedContent) {
      // 简化的变更检测：将整个文档作为一个变更
      changes.push({
        from: 0,
        to: this.cachedContent.length,
        insert: content,
        deleted: this.cachedContent,
      });
    }

    // 使用 Worker 或主线程解析
    let result: IncrementalParseResult;

    if (this.worker && this.workerReady && content.length > 5000) {
      // 大文档使用 Worker
      try {
        const data = await this.sendToWorker<{
          ast: RootNode;
          affectedNodeIds: string[];
          dirtyNodeIds: string[];
          fullReparse: boolean;
          parseTime: number;
        }>('parse_incremental', {
          content,
          changes,
          options: this.config.parserOptions,
        });

        result = data;
      } catch {
        // Worker 失败，回退到主线程
        result = this.incrementalParser.parse(content, changes, this.config.parserOptions);
      }
    } else {
      // 小文档使用主线程
      result = this.incrementalParser.parse(content, changes, this.config.parserOptions);
    }

    // 更新缓存
    this.cachedAST = result.ast;
    this.cachedContent = content;

    return result.ast;
  }

  /**
   * 渲染 LaTeX 文档
   * @param content LaTeX 源码
   */
  async render(content: string): Promise<LatexRenderResult> {
    const ast = await this.parse(content);
    return this.renderAST(ast);
  }

  /**
   * 渲染 AST
   * @param ast 解析后的 AST
   */
  renderAST(ast: RootNode): LatexRenderResult {
    return this.renderer.render(ast);
  }

  /**
   * 带防抖的渲染
   * @param content LaTeX 源码
   * @param callback 渲染完成回调
   */
  renderWithDebounce(content: string, callback: (result: LatexRenderResult) => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        const result = await this.render(content);
        callback(result);
        // 同时调用注册的渲染回调
        if (result.success && this.onRenderCallback) {
          this.onRenderCallback(result.html);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        callback({
          html: `<div class="latex-error">${message}</div>`,
          success: false,
          error: message,
          renderTime: 0,
        });
      }
    }, this.config.debounceMs);
  }

  /**
   * 设置渲染回调
   */
  setRenderCallback(callback: (html: string) => void): void {
    this.onRenderCallback = callback;
  }

  /**
   * 创建可视区域优先渲染器
   */
  createVisibilityRenderer(): VisibilityPriorityRenderer {
    if (!this.visibilityRenderer) {
      this.visibilityRenderer = new VisibilityPriorityRenderer(this.renderer);
    }
    return this.visibilityRenderer;
  }

  /**
   * 更新可视区域
   * @param visibleIds 可视区域内的节点 ID 列表
   */
  updateVisibility(visibleIds: string[]): void {
    if (this.visibilityRenderer) {
      this.visibilityRenderer.updateVisibility(visibleIds);
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.incrementalParser.clearCache();
    this.renderer.clearCache();
    this.cachedAST = null;
    this.cachedContent = '';
  }

  /**
   * 取消当前渲染
   */
  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.worker && this.workerReady) {
      this.worker.postMessage({ type: 'cancel' } as WorkerRequest);
    }

    // 清除待处理的请求
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('请求已取消'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.cancel();
    this.clearCache();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }

    this.visibilityRenderer = null;
  }

  /**
   * 获取缓存的 AST
   */
  getCachedAST(): RootNode | null {
    return this.cachedAST;
  }

  /**
   * 获取渲染器缓存大小
   */
  getCacheSize(): number {
    return this.renderer.getCacheSize();
  }
}

// ================================
// 便捷函数
// ================================

/** 全局引擎实例 */
let globalEngine: LatexEngine | null = null;

/**
 * 获取全局引擎实例
 */
export function getLatexEngine(config?: LatexEngineConfig): LatexEngine {
  if (!globalEngine) {
    globalEngine = new LatexEngine(config);
  }
  return globalEngine;
}

/**
 * 销毁全局引擎实例
 */
export function destroyLatexEngine(): void {
  if (globalEngine) {
    globalEngine.destroy();
    globalEngine = null;
  }
}

/**
 * 快速解析 LaTeX
 * @param content LaTeX 源码
 * @param options 解析选项
 */
export async function parseLatexContent(
  content: string,
  options?: LatexParserOptions
): Promise<RootNode> {
  const parser = new LatexParser(content, options);
  const result = parser.parse();
  return result.ast;
}

/**
 * 快速渲染 LaTeX
 * @param content LaTeX 源码
 * @param options 渲染选项
 */
export async function renderLatexContent(
  content: string,
  options?: LatexRenderOptions
): Promise<LatexRenderResult> {
  const engine = getLatexEngine({ renderOptions: options });
  return engine.render(content);
}

// ================================
// 默认导出
// ================================

import {
  IncrementalLatexEngine,
  createIncrementalEngine,
  getIncrementalEngine,
  destroyIncrementalEngine,
} from './incremental-engine';

export default {
  // 基础引擎
  LatexEngine,
  getLatexEngine,
  destroyLatexEngine,
  parseLatexContent,
  renderLatexContent,
  // 增量引擎（推荐）
  IncrementalLatexEngine,
  createIncrementalEngine,
  getIncrementalEngine,
  destroyIncrementalEngine,
};
