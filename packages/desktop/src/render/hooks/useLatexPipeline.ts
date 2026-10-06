// ================================
// LaTeX 管道集成 Hooks
//
// 核心功能：
// 1. 完全集成流式解析管道
// 2. 使用 Web Worker 进行后台解析
// 3. 精确的滚动同步
// 4. 大文件粘贴性能优化
// ================================

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { RootNode, DocumentChange, LatexNode, LatexNodeType } from '../lib/latex/types';
import type {
  ParseBlock,
  ParseBlockType,
  PositionMapping,
} from '../lib/latex/streaming-pipeline';
import type { HeightMap as HeightMapType, HeightBlockType } from '../lib/latex/height-map';
// 仅导入类型：运行时仍通过动态 import 加载，避免循环依赖
import type { PipelineIntegration } from '../lib/latex/pipeline-integration';
import type { ParseWorkerService } from '../lib/latex/parse-worker-service';
import type { ScrollSyncController } from '../lib/latex/scroll-sync';

// 内联定义需要的类型，避免循环依赖
interface ScrollSyncResultType {
  targetScrollTop: number;
  isExact: boolean;
  confidence: number;
  method?: string;
  sourceLine?: number;
  renderPosition?: number;
}

interface ScrollStateType {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  timestamp: number;
}

// ================================
// 类型映射
// ================================

/** 作为解析块收集的 AST 节点类型及其对应的块类型（根节点视为整篇文档块） */
const BLOCK_NODE_TYPE_MAP: Partial<Record<LatexNodeType, ParseBlockType>> = {
  root: 'document',
  section: 'section',
  paragraph: 'paragraph',
  math_block: 'math_block',
  environment: 'environment',
  list: 'list',
};

/** 解析块类型到 HeightMap 块类型的映射（两者命名风格不同：下划线 / 连字符） */
const HEIGHT_BLOCK_TYPE_MAP: Record<ParseBlockType, HeightBlockType> = {
  preamble: 'preamble',
  document: 'document',
  section: 'section',
  paragraph: 'paragraph',
  math_inline: 'math-inline',
  math_block: 'math-block',
  environment: 'environment',
  list: 'list',
  table: 'table',
  command: 'command',
  text: 'text',
  comment: 'unknown',
  error: 'error',
};

/**
 * 根据管道统计的真实命中/未命中次数计算缓存命中率（0-1）
 */
function computeCacheHitRate(pipeline: PipelineIntegration | null): number {
  if (!pipeline) return 0;
  const { cacheHits, cacheMisses } = pipeline.getStats();
  const total = cacheHits + cacheMisses;
  return total > 0 ? cacheHits / total : 0;
}

// ================================
// 类型定义
// ================================

/** 管道配置 */
export interface LatexPipelineConfig {
  /** 是否启用流式解析 */
  enableStreaming: boolean;
  /** 是否启用 Worker */
  enableWorker: boolean;
  /** 是否启用虚拟滚动 */
  enableVirtualScroll: boolean;
  /** 大文件阈值（字节） */
  largeFileThreshold: number;
  /** 超大文件阈值（字节） */
  hugeFileThreshold: number;
  /** 防抖延迟（毫秒） */
  debounceMs: number;
  /** 滚动同步延迟（毫秒） */
  scrollSyncDelay: number;
  /** 是否启用调试 */
  debug: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: LatexPipelineConfig = {
  enableStreaming: true,
  enableWorker: true,
  enableVirtualScroll: true,
  largeFileThreshold: 50 * 1024,
  hugeFileThreshold: 500 * 1024,
  debounceMs: 150,
  scrollSyncDelay: 16,
  debug: false,
};

/** 解析状态 */
export interface ParseState {
  /** 是否正在解析 */
  isParsing: boolean;
  /** 解析进度（0-1） */
  progress: number;
  /** 解析时间（毫秒） */
  parseTime: number;
  /** 渲染时间（毫秒） */
  renderTime: number;
  /** 块数量 */
  blockCount: number;
  /** 缓存命中率 */
  cacheHitRate: number;
  /** 错误信息 */
  error: string | null;
}

/** 文件大小类型 */
export type FileSizeType = 'small' | 'large' | 'huge';

/** 滚动同步源 */
export type ScrollSyncSource = 'editor' | 'preview';

/** 管道钩子返回值 */
export interface LatexPipelineResult {
  // 状态
  html: string;
  ast: RootNode | null;
  blocks: ParseBlock[];
  parseState: ParseState;
  fileSizeType: FileSizeType;
  isReady: boolean;

  // 方法
  setContent: (content: string) => Promise<void>;
  applyChanges: (changes: DocumentChange[]) => Promise<void>;
  getPositionMapping: (line: number, column?: number) => PositionMapping | null;
  updateBlockMeasurement: (blockId: string, height: number, top?: number) => void;
  syncScroll: (
    source: ScrollSyncSource,
    scrollTop: number,
    viewportHeight: number,
    contentHeight: number
  ) => ScrollSyncResultType | null;
  cancelParsing: () => void;
  clearCache: () => void;
  destroy: () => void;
}

// ================================
// 工具函数
// ================================

/**
 * 获取文件大小类型
 */
function getFileSizeType(content: string, config: LatexPipelineConfig): FileSizeType {
  const size = new Blob([content]).size;
  if (size >= config.hugeFileThreshold) return 'huge';
  if (size >= config.largeFileThreshold) return 'large';
  return 'small';
}

/**
 * 获取防抖延迟
 */
function getDebounceMs(fileSizeType: FileSizeType, baseDebounce: number): number {
  switch (fileSizeType) {
    case 'huge':
      return baseDebounce * 3;
    case 'large':
      return baseDebounce * 2;
    default:
      return baseDebounce;
  }
}

// ================================
// 主 Hook
// ================================

/**
 * LaTeX 管道集成 Hook
 *
 * 提供完整的 LaTeX 解析、渲染和滚动同步功能
 */
export function useLatexPipeline(
  initialContent: string = '',
  config: Partial<LatexPipelineConfig> = {}
): LatexPipelineResult {
  const fullConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);

  // 状态
  const [html, setHtml] = useState<string>('');
  const [ast, setAst] = useState<RootNode | null>(null);
  const [blocks, setBlocks] = useState<ParseBlock[]>([]);
  const [parseState, setParseState] = useState<ParseState>({
    isParsing: false,
    progress: 0,
    parseTime: 0,
    renderTime: 0,
    blockCount: 0,
    cacheHitRate: 0,
    error: null,
  });
  const [fileSizeType, setFileSizeType] = useState<FileSizeType>('small');
  const [isReady, setIsReady] = useState(false);

  // Refs
  const contentRef = useRef<string>(initialContent);
  const versionRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineRef = useRef<PipelineIntegration | null>(null);
  const workerServiceRef = useRef<ParseWorkerService | null>(null);
  const scrollControllerRef = useRef<ScrollSyncController | null>(null);
  const heightMapRef = useRef<HeightMapType | null>(null);
  const blockIndexRef = useRef<Map<string, ParseBlock>>(new Map());

  // 初始化
  useEffect(() => {
    const initPipeline = async () => {
      try {
        // 动态导入模块，避免循环依赖
        const [{ PipelineIntegration }, { ParseWorkerService }, { ScrollSyncController }] =
          await Promise.all([
            import('../lib/latex/pipeline-integration'),
            import('../lib/latex/parse-worker-service'),
            import('../lib/latex/scroll-sync'),
          ]);

        // 创建管道集成器
        pipelineRef.current = new PipelineIntegration({
          enableStreaming: fullConfig.enableStreaming,
          enableWorker: fullConfig.enableWorker,
          enableVirtualScroll: fullConfig.enableVirtualScroll,
          largeFileThreshold: fullConfig.largeFileThreshold,
          hugeFileThreshold: fullConfig.hugeFileThreshold,
          debug: fullConfig.debug,
        });

        // 创建 Worker 服务（如果启用）
        if (fullConfig.enableWorker) {
          const workerService = new ParseWorkerService({
            largeFileThreshold: fullConfig.largeFileThreshold,
            hugeFileThreshold: fullConfig.hugeFileThreshold,
            debug: fullConfig.debug,
          });
          workerServiceRef.current = workerService;
          await workerService.init();
        }

        // 创建滚动同步控制器
        scrollControllerRef.current = new ScrollSyncController({
          syncDelay: fullConfig.scrollSyncDelay,
          debug: fullConfig.debug,
        });

        setIsReady(true);

        // 如果有初始内容，立即解析
        if (initialContent) {
          await parseContent(initialContent);
        }
      } catch (error) {
        console.error('[useLatexPipeline] 初始化失败:', error);
        setIsReady(true); // 即使失败也标记为就绪，使用 fallback
      }
    };

    initPipeline();

    // 清理
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (pipelineRef.current) {
        pipelineRef.current.destroy();
      }
      if (workerServiceRef.current) {
        workerServiceRef.current.destroy();
      }
      if (scrollControllerRef.current) {
        scrollControllerRef.current.destroy();
      }
    };
  }, []);

  // 解析内容
  const parseContent = useCallback(
    async (content: string) => {
      // 取消之前的解析
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      contentRef.current = content;
      const currentVersion = ++versionRef.current;

      // 更新文件大小类型
      const sizeType = getFileSizeType(content, fullConfig);
      setFileSizeType(sizeType);

      setParseState((prev) => ({
        ...prev,
        isParsing: true,
        progress: 0,
        error: null,
      }));

      const startTime = performance.now();

      try {
        let result: { html: string; ast: RootNode | null; blocks: ParseBlock[] };

        // 根据配置选择解析方式
        const workerService = workerServiceRef.current;
        const pipeline = pipelineRef.current;
        if (fullConfig.enableWorker && workerService && sizeType !== 'small') {
          // 使用 Worker 进行后台解析
          result = await parseWithWorker(workerService, content, abortController.signal);
        } else if (pipeline) {
          // 使用管道集成器
          result = await parseWithPipeline(pipeline, content, abortController.signal);
        } else {
          // Fallback: 同步解析
          result = await parseFallback(content);
        }

        // 检查版本
        if (versionRef.current !== currentVersion || abortController.signal.aborted) {
          return;
        }

        const parseTime = performance.now() - startTime;

        // 更新状态
        setHtml(result.html);
        setAst(result.ast);
        setBlocks(result.blocks);

        // 更新块索引
        blockIndexRef.current.clear();
        for (const block of result.blocks) {
          blockIndexRef.current.set(block.id, block);
        }

        // 更新 HeightMap
        updateHeightMap(content, result.blocks);

        // 更新滚动控制器
        if (scrollControllerRef.current) {
          scrollControllerRef.current.setBlocks(result.blocks);
          scrollControllerRef.current.setHeightMap(heightMapRef.current);
        }

        setParseState({
          isParsing: false,
          progress: 1,
          parseTime,
          renderTime: 0,
          blockCount: result.blocks.length,
          cacheHitRate: computeCacheHitRate(pipelineRef.current),
          error: null,
        });

        if (fullConfig.debug) {
          console.log(
            `[useLatexPipeline] 解析完成: ${parseTime.toFixed(1)}ms, ${result.blocks.length} 块`
          );
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[useLatexPipeline] 解析错误:', errorMessage);

        setParseState((prev) => ({
          ...prev,
          isParsing: false,
          error: errorMessage,
        }));

        // 设置错误 HTML
        setHtml(createErrorHtml(errorMessage));
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [fullConfig]
  );

  // 使用 Worker 解析
  const parseWithWorker = async (
    workerService: ParseWorkerService,
    content: string,
    signal: AbortSignal
  ): Promise<{ html: string; ast: RootNode | null; blocks: ParseBlock[] }> => {
    const ast = await workerService.parse(content, {
      chunked: true,
      onProgress: (progress: number) => {
        setParseState((prev) => ({ ...prev, progress: progress * 0.5 }));
      },
    });

    if (signal.aborted) {
      throw new Error('已取消');
    }

    setParseState((prev) => ({ ...prev, progress: 0.5 }));

    const html = ast
      ? await workerService.render(ast, {
          onProgress: (progress: number) => {
            setParseState((prev) => ({ ...prev, progress: 0.5 + progress * 0.5 }));
          },
        })
      : '';

    // 从 AST 构建块
    const blocks = buildBlocksFromAST(ast, content);

    return { html, ast, blocks };
  };

  // 使用管道解析
  const parseWithPipeline = async (
    pipeline: PipelineIntegration,
    content: string,
    signal: AbortSignal
  ): Promise<{ html: string; ast: RootNode | null; blocks: ParseBlock[] }> => {
    const result = await pipeline.setContent(content, {
      onProgress: (progress: number) => {
        setParseState((prev) => ({ ...prev, progress }));
      },
      signal,
    });

    return {
      html: result.html,
      ast: result.ast,
      blocks: result.blocks,
    };
  };

  // Fallback 解析
  const parseFallback = async (
    content: string
  ): Promise<{ html: string; ast: RootNode | null; blocks: ParseBlock[] }> => {
    const { LatexParser } = await import('../lib/latex/parser');
    const { LatexRenderer } = await import('../lib/latex/renderer');

    const parser = new LatexParser(content);
    const parseResult = parser.parse();

    const renderer = new LatexRenderer();
    const renderResult = renderer.render(parseResult.ast);

    const blocks = buildBlocksFromAST(parseResult.ast, content);

    return {
      html: renderResult.html,
      ast: parseResult.ast,
      blocks,
    };
  };

  // 从 AST 构建块
  const buildBlocksFromAST = (ast: RootNode | null, content: string): ParseBlock[] => {
    if (!ast) return [];

    const blocks: ParseBlock[] = [];
    let blockId = 0;

    const traverse = (node: LatexNode): void => {
      const blockType = BLOCK_NODE_TYPE_MAP[node.type];

      if (blockType) {
        const start = node.start || 0;
        const end = node.end || content.length;
        const raw = node.raw || content.slice(start, end);

        blocks.push({
          id: node.id || `block-${blockId++}`,
          type: blockType,
          sourceStart: start,
          sourceEnd: end,
          sourceStartLine: getLineNumber(content, start),
          sourceEndLine: getLineNumber(content, end),
          hash: hashString(raw),
          html: '',
          measuredHeight: -1,
          estimatedHeight: estimateHeight(raw),
          renderTop: 0,
          children: [],
          rendered: false,
          dirty: false,
          version: versionRef.current,
        });
      }

      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(ast);

    // 计算渲染位置
    let currentTop = 0;
    for (const block of blocks) {
      block.renderTop = currentTop;
      currentTop += block.estimatedHeight;
    }

    return blocks;
  };

  // 更新 HeightMap
  const updateHeightMap = async (content: string, blocks: ParseBlock[]) => {
    try {
      const { createHeightMap } = await import('../lib/latex/height-map');

      const lineCount = (content.match(/\n/g) || []).length + 1;

      heightMapRef.current = createHeightMap({
        defaultLineHeight: 22,
        containerHeight: 600,
        totalLines: lineCount,
        debug: fullConfig.debug,
      });

      for (const block of blocks) {
        heightMapRef.current.addBlock({
          id: block.id,
          sourceStartLine: block.sourceStartLine,
          sourceEndLine: block.sourceEndLine,
          sourceStartOffset: block.sourceStart,
          sourceEndOffset: block.sourceEnd,
          type: HEIGHT_BLOCK_TYPE_MAP[block.type],
          renderTop: block.renderTop,
          renderHeight: block.estimatedHeight,
          measured: false,
          priority: 50,
        });
      }
    } catch (error) {
      console.warn('[useLatexPipeline] HeightMap 更新失败:', error);
    }
  };

  // 设置内容（带防抖）
  const setContent = useCallback(
    async (content: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      const sizeType = getFileSizeType(content, fullConfig);
      const debounceMs = getDebounceMs(sizeType, fullConfig.debounceMs);

      return new Promise<void>((resolve) => {
        debounceTimerRef.current = setTimeout(async () => {
          await parseContent(content);
          resolve();
        }, debounceMs);
      });
    },
    [parseContent, fullConfig]
  );

  // 应用变更
  const applyChanges = useCallback(
    async (changes: DocumentChange[]) => {
      // 应用变更到内容
      let content = contentRef.current;
      for (const change of changes) {
        const before = content.slice(0, change.from);
        const after = content.slice(change.to);
        content = before + (change.insert || '') + after;
      }

      await setContent(content);
    },
    [setContent]
  );

  // 获取位置映射
  const getPositionMapping = useCallback(
    (line: number, column: number = 0): PositionMapping | null => {
      // 查找对应的块
      let targetBlock: ParseBlock | null = null;

      for (const block of blocks) {
        if (line >= block.sourceStartLine && line <= block.sourceEndLine) {
          targetBlock = block;
          break;
        }
      }

      if (!targetBlock) {
        // 估算位置
        const totalLines = blocks.length > 0 ? blocks[blocks.length - 1].sourceEndLine : 1;

        const totalHeight = blocks.reduce(
          (sum, b) => sum + (b.measuredHeight > 0 ? b.measuredHeight : b.estimatedHeight),
          0
        );

        const estimatedPosition = totalLines > 0 ? (line / totalLines) * totalHeight : 0;

        return {
          sourceLine: line,
          sourceColumn: column,
          sourceOffset: 0,
          blockId: '',
          renderPosition: estimatedPosition,
          exact: false,
        };
      }

      // 计算块内位置
      const lineOffset = line - targetBlock.sourceStartLine;
      const totalLines = targetBlock.sourceEndLine - targetBlock.sourceStartLine + 1;
      const ratio = totalLines > 0 ? lineOffset / totalLines : 0;

      const blockHeight =
        targetBlock.measuredHeight > 0 ? targetBlock.measuredHeight : targetBlock.estimatedHeight;

      return {
        sourceLine: line,
        sourceColumn: column,
        sourceOffset: 0,
        blockId: targetBlock.id,
        renderPosition: targetBlock.renderTop + ratio * blockHeight,
        exact: targetBlock.measuredHeight > 0,
      };
    },
    [blocks]
  );

  // 更新块测量
  const updateBlockMeasurement = useCallback((blockId: string, height: number, top?: number) => {
    const block = blockIndexRef.current.get(blockId);
    if (block) {
      block.measuredHeight = height;
      if (top !== undefined) {
        block.renderTop = top;
      }

      // 更新 HeightMap
      if (heightMapRef.current && top !== undefined) {
        heightMapRef.current.updateBlockPosition(blockId, top, height);
      }
    }
  }, []);

  // 滚动同步
  const syncScroll = useCallback(
    (
      source: ScrollSyncSource,
      scrollTop: number,
      viewportHeight: number,
      contentHeight: number
    ): ScrollSyncResultType | null => {
      if (!scrollControllerRef.current) {
        // Fallback: 简单比例同步
        const ratio = contentHeight > 0 ? scrollTop / contentHeight : 0;
        return {
          targetScrollTop: ratio * viewportHeight,
          isExact: false,
          confidence: 0.3,
          method: 'ratio',
        };
      }

      const state: ScrollStateType = {
        scrollTop,
        viewportHeight,
        contentHeight,
        timestamp: performance.now(),
      };

      if (source === 'editor') {
        scrollControllerRef.current.handleEditorScroll(state);
      } else {
        scrollControllerRef.current.handlePreviewScroll(state);
      }

      return scrollControllerRef.current.computeSync(source);
    },
    []
  );

  // 取消解析
  const cancelParsing = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setParseState((prev) => ({
      ...prev,
      isParsing: false,
    }));
  }, []);

  // 清除缓存
  const clearCache = useCallback(() => {
    if (pipelineRef.current) {
      // pipelineRef.current.clearCache?.();
    }
    if (workerServiceRef.current) {
      workerServiceRef.current.clearCache();
    }
  }, []);

  // 销毁
  const destroy = useCallback(() => {
    cancelParsing();

    if (pipelineRef.current) {
      pipelineRef.current.destroy();
      pipelineRef.current = null;
    }
    if (workerServiceRef.current) {
      workerServiceRef.current.destroy();
      workerServiceRef.current = null;
    }
    if (scrollControllerRef.current) {
      scrollControllerRef.current.destroy();
      scrollControllerRef.current = null;
    }

    heightMapRef.current = null;
    blockIndexRef.current.clear();
  }, [cancelParsing]);

  return {
    html,
    ast,
    blocks,
    parseState,
    fileSizeType,
    isReady,
    setContent,
    applyChanges,
    getPositionMapping,
    updateBlockMeasurement,
    syncScroll,
    cancelParsing,
    clearCache,
    destroy,
  };
}

// ================================
// 辅助函数
// ================================

/**
 * 获取行号
 */
function getLineNumber(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
    }
  }
  return line;
}

/**
 * 估算高度
 */
function estimateHeight(content: string): number {
  const lineCount = (content.match(/\n/g) || []).length + 1;
  const baseHeight = 22;

  if (content.includes('\\begin{equation}') || content.includes('\\[')) {
    return lineCount * baseHeight * 1.5;
  }

  if (content.includes('\\section') || content.includes('\\chapter')) {
    return lineCount * baseHeight * 1.3;
  }

  return lineCount * baseHeight;
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
 * 创建错误 HTML
 */
function createErrorHtml(message: string): string {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<div class="latex-error">
    <div class="latex-error-title">解析错误</div>
    <div class="latex-error-message">${escaped}</div>
  </div>`;
}

// ================================
// 导出类型已在上方定义
// ================================
