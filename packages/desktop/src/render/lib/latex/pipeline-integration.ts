// ================================
// 流式解析管道集成器
//
// 核心功能：
// 1. 将流式解析管道完全集成到编辑器
// 2. 统一的解析-渲染-同步接口
// 3. 高性能的增量更新
// 4. 精确的滚动同步
// ================================

import type { ParseBlock, PositionMapping, EditOperation } from './streaming-pipeline';
import type { HeightMap as HeightMapType, HeightBlockType } from './height-map';
import type { RootNode, LatexNode } from './types';

// ================================
// 类型定义
// ================================

/** 集成管道配置 */
export interface IntegrationConfig {
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
  /** 每帧最大执行时间（毫秒） */
  maxFrameTime: number;
  /** 是否启用调试 */
  debug: boolean;
  /** 滚动同步延迟（毫秒） */
  scrollSyncDelay: number;
}

/** 默认配置 */
const DEFAULT_INTEGRATION_CONFIG: IntegrationConfig = {
  enableStreaming: true,
  enableWorker: true,
  enableVirtualScroll: true,
  largeFileThreshold: 50 * 1024, // 50KB
  hugeFileThreshold: 500 * 1024, // 500KB
  maxFrameTime: 8,
  debug: false,
  scrollSyncDelay: 16,
};

/** 解析结果 */
export interface ParseRenderResult {
  /** 是否成功 */
  success: boolean;
  /** 渲染 HTML */
  html: string;
  /** AST */
  ast: RootNode | null;
  /** 解析时间（毫秒） */
  parseTime: number;
  /** 渲染时间（毫秒） */
  renderTime: number;
  /** 解析块列表 */
  blocks: ParseBlock[];
  /** 错误信息 */
  error?: string;
}

/** 增量更新结果 */
export interface IncrementalUpdateResult {
  /** 是否成功 */
  success: boolean;
  /** 更新的块 ID 列表 */
  updatedBlockIds: string[];
  /** 新的 HTML */
  html: string;
  /** 更新时间（毫秒） */
  updateTime: number;
}

/** 滚动同步请求 */
export interface ScrollSyncRequest {
  /** 同步源 */
  source: 'editor' | 'preview';
  /** 滚动位置（像素） */
  scrollTop: number;
  /** 视口高度（像素） */
  viewportHeight: number;
  /** 内容总高度（像素） */
  contentHeight: number;
}

/** 滚动同步结果 */
export interface ScrollSyncResult {
  /** 目标滚动位置（像素） */
  targetScrollTop: number;
  /** 是否精确匹配 */
  exact: boolean;
  /** 对应的源码行号（如果从预览同步到编辑器） */
  sourceLine?: number;
  /** 对应的渲染位置（如果从编辑器同步到预览） */
  renderPosition?: number;
}

/** 可见块信息 */
export interface VisibleBlockInfo {
  /** 块 ID */
  id: string;
  /** 块类型 */
  type: string;
  /** 源码起始行 */
  sourceStartLine: number;
  /** 源码结束行 */
  sourceEndLine: number;
  /** 渲染顶部位置 */
  renderTop: number;
  /** 渲染高度 */
  renderHeight: number;
  /** 可见比例（0-1） */
  visibleRatio: number;
}

/** 进度回调 */
export type ProgressCallback = (progress: number, message?: string) => void;

/** DOM 测量回调 */
export type MeasurementCallback = (blockId: string, height: number, top: number) => void;

// ================================
// 管道集成器类
// ================================

/**
 * 流式解析管道集成器
 *
 * 特性：
 * - 统一的解析-渲染接口
 * - 自动选择最优解析策略
 * - 精确的滚动同步
 * - 增量更新支持
 */
export class PipelineIntegration {
  private config: IntegrationConfig;
  private content: string = '';
  private blocks: ParseBlock[] = [];
  private blockIndex: Map<string, ParseBlock> = new Map();
  private heightMap: HeightMapType | null = null;
  private cachedHtml: string = '';
  private version: number = 0;
  private isProcessing: boolean = false;
  private pendingChanges: EditOperation[] = [];
  private abortController: AbortController | null = null;

  // 性能统计
  private stats = {
    totalParseTime: 0,
    totalRenderTime: 0,
    parseCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(config: Partial<IntegrationConfig> = {}) {
    this.config = { ...DEFAULT_INTEGRATION_CONFIG, ...config };
  }

  /**
   * 设置内容并解析
   */
  async setContent(
    content: string,
    options?: {
      onProgress?: ProgressCallback;
      signal?: AbortSignal;
    }
  ): Promise<ParseRenderResult> {
    const startTime = performance.now();
    const { onProgress, signal } = options || {};

    // 取消之前的操作
    this.cancelPending();

    this.content = content;
    this.version++;
    this.isProcessing = true;

    try {
      // 检查是否取消
      if (signal?.aborted) {
        throw new Error('操作已取消');
      }

      // 根据内容大小选择解析策略
      const contentSize = new Blob([content]).size;
      const isLargeFile = contentSize >= this.config.largeFileThreshold;
      const isHugeFile = contentSize >= this.config.hugeFileThreshold;

      if (this.config.debug) {
        console.log(`[PipelineIntegration] 解析内容: ${(contentSize / 1024).toFixed(1)}KB`);
      }

      onProgress?.(0, '开始解析...');

      let result: ParseRenderResult;

      if (this.config.enableStreaming && (isLargeFile || isHugeFile)) {
        // 使用流式解析
        result = await this.streamingParse(content, {
          onProgress,
          signal,
          chunkSize: isHugeFile ? 8192 : 16384,
        });
      } else {
        // 使用常规解析
        result = await this.standardParse(content, { onProgress, signal });
      }

      // 更新缓存
      this.cachedHtml = result.html;
      this.blocks = result.blocks;
      this.rebuildBlockIndex();

      // 初始化 HeightMap
      await this.initHeightMap(content, result.blocks);

      onProgress?.(1, '解析完成');

      // 更新统计
      this.stats.totalParseTime += result.parseTime;
      this.stats.totalRenderTime += result.renderTime;
      this.stats.parseCount++;

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        html: this.createErrorHtml(errorMessage),
        ast: null,
        parseTime: performance.now() - startTime,
        renderTime: 0,
        blocks: [],
        error: errorMessage,
      };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 应用增量编辑
   */
  async applyEdit(
    edit: EditOperation,
    options?: {
      onProgress?: ProgressCallback;
      signal?: AbortSignal;
    }
  ): Promise<IncrementalUpdateResult> {
    const startTime = performance.now();
    const { onProgress, signal } = options || {};

    // 如果正在处理，加入队列
    if (this.isProcessing) {
      this.pendingChanges.push(edit);
      return {
        success: true,
        updatedBlockIds: [],
        html: this.cachedHtml,
        updateTime: 0,
      };
    }

    this.isProcessing = true;
    this.version++;

    try {
      // 应用编辑到内容
      this.content = this.applyEditToContent(this.content, edit);

      // 找出受影响的块
      const affectedBlocks = this.findAffectedBlocks(edit);

      onProgress?.(0.3, '更新受影响的块...');

      // 重新解析受影响的块
      const updatedBlocks = await this.reparseBlocks(affectedBlocks, {
        signal,
      });

      onProgress?.(0.7, '重建 HTML...');

      // 更新 HTML
      const html = this.rebuildHtml(updatedBlocks);
      this.cachedHtml = html;

      // 更新 HeightMap
      for (const block of updatedBlocks) {
        if (this.heightMap) {
          this.heightMap.updateBlockPosition(block.id, block.renderTop, block.estimatedHeight);
        }
      }

      onProgress?.(1, '更新完成');

      return {
        success: true,
        updatedBlockIds: updatedBlocks.map((b) => b.id),
        html,
        updateTime: performance.now() - startTime,
      };
    } catch (_error) {
      return {
        success: false,
        updatedBlockIds: [],
        html: this.cachedHtml,
        updateTime: performance.now() - startTime,
      };
    } finally {
      this.isProcessing = false;

      // 处理队列中的变更
      if (this.pendingChanges.length > 0) {
        const nextEdit = this.pendingChanges.shift()!;
        await this.applyEdit(nextEdit, options);
      }
    }
  }

  /**
   * 计算滚动同步位置
   */
  computeScrollSync(request: ScrollSyncRequest): ScrollSyncResult {
    const { source, scrollTop, viewportHeight, contentHeight } = request;

    // 如果没有 HeightMap，使用简单的比例同步
    if (!this.heightMap) {
      const ratio = contentHeight > 0 ? scrollTop / contentHeight : 0;
      return {
        targetScrollTop: ratio * viewportHeight,
        exact: false,
      };
    }

    if (source === 'editor') {
      // 从编辑器同步到预览
      return this.computeEditorToPreviewSync(scrollTop, viewportHeight, contentHeight);
    } else {
      // 从预览同步到编辑器
      return this.computePreviewToEditorSync(scrollTop, viewportHeight, contentHeight);
    }
  }

  /**
   * 获取可见块信息
   */
  getVisibleBlocks(
    scrollTop: number,
    viewportHeight: number,
    _source: 'editor' | 'preview' = 'preview'
  ): VisibleBlockInfo[] {
    if (!this.heightMap) return [];

    const visibleBlocks: VisibleBlockInfo[] = [];
    const viewportBottom = scrollTop + viewportHeight;

    for (const block of this.blocks) {
      const blockTop = block.renderTop;
      const blockHeight = block.measuredHeight > 0 ? block.measuredHeight : block.estimatedHeight;
      const blockBottom = blockTop + blockHeight;

      // 检查是否在视口内
      if (blockBottom > scrollTop && blockTop < viewportBottom) {
        // 计算可见比例
        const visibleTop = Math.max(blockTop, scrollTop);
        const visibleBottom = Math.min(blockBottom, viewportBottom);
        const visibleHeight = visibleBottom - visibleTop;
        const visibleRatio = blockHeight > 0 ? visibleHeight / blockHeight : 0;

        visibleBlocks.push({
          id: block.id,
          type: block.type,
          sourceStartLine: block.sourceStartLine,
          sourceEndLine: block.sourceEndLine,
          renderTop: blockTop,
          renderHeight: blockHeight,
          visibleRatio,
        });
      }
    }

    return visibleBlocks;
  }

  /**
   * 更新块的测量高度
   */
  updateBlockMeasurement(blockId: string, height: number, top?: number): void {
    const block = this.blockIndex.get(blockId);
    if (block) {
      block.measuredHeight = height;
      if (top !== undefined) {
        block.renderTop = top;
      }

      // 更新 HeightMap
      if (this.heightMap && top !== undefined) {
        this.heightMap.updateBlockPosition(blockId, top, height);
      }
    }
  }

  /**
   * 批量更新块测量
   */
  updateBlockMeasurements(measurements: Array<{ id: string; height: number; top: number }>): void {
    for (const m of measurements) {
      this.updateBlockMeasurement(m.id, m.height, m.top);
    }

    // 重新计算渲染位置
    this.recalculateRenderPositions();
  }

  /**
   * 获取位置映射
   */
  getPositionMapping(sourceLine: number, sourceColumn: number = 0): PositionMapping | null {
    // 找到对应的块
    let targetBlock: ParseBlock | null = null;

    for (const block of this.blocks) {
      if (sourceLine >= block.sourceStartLine && sourceLine <= block.sourceEndLine) {
        targetBlock = block;
        break;
      }
    }

    if (!targetBlock) {
      // 如果没找到块，返回估算位置
      const estimatedPosition = this.estimateRenderPosition(sourceLine);
      return {
        sourceLine,
        sourceColumn,
        sourceOffset: 0,
        blockId: '',
        renderPosition: estimatedPosition,
        exact: false,
      };
    }

    // 计算块内的相对位置
    const lineOffset = sourceLine - targetBlock.sourceStartLine;
    const totalLines = targetBlock.sourceEndLine - targetBlock.sourceStartLine + 1;
    const ratio = totalLines > 0 ? lineOffset / totalLines : 0;

    const blockHeight =
      targetBlock.measuredHeight > 0 ? targetBlock.measuredHeight : targetBlock.estimatedHeight;

    const renderPosition = targetBlock.renderTop + ratio * blockHeight;

    return {
      sourceLine,
      sourceColumn,
      sourceOffset: 0,
      blockId: targetBlock.id,
      renderPosition,
      exact: targetBlock.measuredHeight > 0,
    };
  }

  /**
   * 获取渲染的 HTML
   */
  getHtml(): string {
    return this.cachedHtml;
  }

  /**
   * 获取所有块
   */
  getBlocks(): ParseBlock[] {
    return [...this.blocks];
  }

  /**
   * 获取块数量
   */
  getBlockCount(): number {
    return this.blocks.length;
  }

  /**
   * 获取内容
   */
  getContent(): string {
    return this.content;
  }

  /**
   * 获取版本号
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * 获取 HeightMap
   */
  getHeightMap(): HeightMapType | null {
    return this.heightMap;
  }

  /**
   * 获取统计信息
   */
  getStats(): typeof this.stats & { averageParseTime: number; averageRenderTime: number } {
    const count = this.stats.parseCount || 1;
    return {
      ...this.stats,
      averageParseTime: this.stats.totalParseTime / count,
      averageRenderTime: this.stats.totalRenderTime / count,
    };
  }

  /**
   * 取消待处理操作
   */
  cancelPending(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.pendingChanges = [];
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.cancelPending();
    this.content = '';
    this.blocks = [];
    this.blockIndex.clear();
    this.heightMap = null;
    this.cachedHtml = '';
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 标准解析
   */
  private async standardParse(
    content: string,
    options: { onProgress?: ProgressCallback; signal?: AbortSignal }
  ): Promise<ParseRenderResult> {
    const { onProgress, signal } = options;
    const parseStartTime = performance.now();

    onProgress?.(0.2, '解析 LaTeX...');

    // 动态导入解析器
    const { LatexParser } = await import('./parser');
    const { LatexRenderer } = await import('./renderer');

    // 检查取消
    if (signal?.aborted) {
      throw new Error('操作已取消');
    }

    const parser = new LatexParser(content);
    const parseResult = parser.parse();
    const parseTime = performance.now() - parseStartTime;

    onProgress?.(0.5, '渲染 HTML...');

    const renderStartTime = performance.now();
    const renderer = new LatexRenderer();
    const renderResult = renderer.render(parseResult.ast);
    const renderTime = performance.now() - renderStartTime;

    // 检查取消
    if (signal?.aborted) {
      throw new Error('操作已取消');
    }

    onProgress?.(0.8, '构建块结构...');

    // 从 AST 构建块
    const blocks = this.buildBlocksFromAST(parseResult.ast, content);

    return {
      success: renderResult.success,
      html: renderResult.html,
      ast: parseResult.ast,
      parseTime,
      renderTime,
      blocks,
      error: renderResult.error,
    };
  }

  /**
   * 流式解析
   */
  private async streamingParse(
    content: string,
    options: {
      onProgress?: ProgressCallback;
      signal?: AbortSignal;
      chunkSize?: number;
    }
  ): Promise<ParseRenderResult> {
    const { onProgress, signal, chunkSize = 16384 } = options;
    const startTime = performance.now();

    const { LatexParser } = await import('./parser');
    const { LatexRenderer } = await import('./renderer');

    const blocks: ParseBlock[] = [];
    const htmlParts: string[] = [];
    let processedLength = 0;
    let blockId = 0;

    // 分块处理
    const chunks = this.splitIntoChunks(content, chunkSize);

    for (let i = 0; i < chunks.length; i++) {
      // 检查取消
      if (signal?.aborted) {
        throw new Error('操作已取消');
      }

      const chunk = chunks[i];
      const chunkStart = processedLength;
      const chunkEnd = chunkStart + chunk.length;

      // 解析块
      const parser = new LatexParser(chunk);
      const parseResult = parser.parse();

      // 渲染块
      const renderer = new LatexRenderer();
      const renderResult = renderer.render(parseResult.ast);

      // 创建块信息
      const block: ParseBlock = {
        id: `block-${blockId++}`,
        type: 'paragraph',
        sourceStart: chunkStart,
        sourceEnd: chunkEnd,
        sourceStartLine: this.getLineNumber(content, chunkStart),
        sourceEndLine: this.getLineNumber(content, chunkEnd),
        hash: this.hashString(chunk),
        html: renderResult.html,
        measuredHeight: -1,
        estimatedHeight: this.estimateBlockHeight(chunk),
        renderTop: 0,
        children: [],
        rendered: true,
        dirty: false,
        version: this.version,
      };

      blocks.push(block);
      htmlParts.push(renderResult.html);

      processedLength = chunkEnd;
      const progress = (i + 1) / chunks.length;
      onProgress?.(progress * 0.9, `解析中... ${Math.round(progress * 100)}%`);

      // 让出控制权
      await this.yieldToMain();
    }

    const parseTime = performance.now() - startTime;

    // 计算渲染位置
    let currentTop = 0;
    for (const block of blocks) {
      block.renderTop = currentTop;
      currentTop += block.estimatedHeight;
    }

    return {
      success: true,
      html: htmlParts.join('\n'),
      ast: null, // 流式解析不保留完整 AST
      parseTime,
      renderTime: 0,
      blocks,
    };
  }

  /**
   * 初始化 HeightMap
   */
  private async initHeightMap(content: string, blocks: ParseBlock[]): Promise<void> {
    const { createHeightMap } = await import('./height-map');

    const lineCount = (content.match(/\n/g) || []).length + 1;

    this.heightMap = createHeightMap({
      defaultLineHeight: 22,
      containerHeight: 600,
      totalLines: lineCount,
      debug: this.config.debug,
    });

    // 添加块到 HeightMap
    for (const block of blocks) {
      this.heightMap.addBlock({
        id: block.id,
        sourceStartLine: block.sourceStartLine,
        sourceEndLine: block.sourceEndLine,
        sourceStartOffset: block.sourceStart,
        sourceEndOffset: block.sourceEnd,
        type: block.type as HeightBlockType,
        renderTop: block.renderTop,
        renderHeight: block.estimatedHeight,
        measured: false,
        priority: 50,
      });
    }
  }

  /**
   * 从 AST 构建块
   */
  private buildBlocksFromAST(ast: RootNode | null, content: string): ParseBlock[] {
    const blocks: ParseBlock[] = [];

    if (!ast) return blocks;

    const traverse = (node: LatexNode, depth: number = 0): void => {
      // 根据节点类型决定是否创建块
      const blockTypes = ['section', 'paragraph', 'math_block', 'environment', 'list'];
      const nodeType = (node as { type?: string }).type || '';

      if (blockTypes.includes(nodeType) || depth === 0) {
        const nodeAny = node as {
          id?: string;
          start?: number;
          end?: number;
          raw?: string;
        };

        const start = nodeAny.start || 0;
        const end = nodeAny.end || content.length;
        const raw = nodeAny.raw || content.slice(start, end);

        const block: ParseBlock = {
          id: nodeAny.id || `block-${blocks.length}`,
          type: this.mapNodeTypeToBlockType(nodeType),
          sourceStart: start,
          sourceEnd: end,
          sourceStartLine: this.getLineNumber(content, start),
          sourceEndLine: this.getLineNumber(content, end),
          hash: this.hashString(raw),
          html: '',
          measuredHeight: -1,
          estimatedHeight: this.estimateBlockHeight(raw),
          renderTop: 0,
          children: [],
          rendered: false,
          dirty: false,
          version: this.version,
        };

        blocks.push(block);
      }

      // 遍历子节点
      const children = (node as { children?: LatexNode[] }).children;
      if (children) {
        for (const child of children) {
          traverse(child, depth + 1);
        }
      }
    };

    traverse(ast as unknown as LatexNode);

    // 计算渲染位置
    let currentTop = 0;
    for (const block of blocks) {
      block.renderTop = currentTop;
      currentTop += block.estimatedHeight;
    }

    return blocks;
  }

  /**
   * 重建块索引
   */
  private rebuildBlockIndex(): void {
    this.blockIndex.clear();
    for (const block of this.blocks) {
      this.blockIndex.set(block.id, block);
    }
  }

  /**
   * 查找受编辑影响的块
   */
  private findAffectedBlocks(edit: EditOperation): ParseBlock[] {
    const affected: ParseBlock[] = [];

    for (const block of this.blocks) {
      // 检查编辑范围是否与块重叠
      if (edit.from <= block.sourceEnd && edit.to >= block.sourceStart) {
        affected.push(block);
      }
    }

    // 如果没有找到受影响的块，返回包含编辑位置的块
    if (affected.length === 0) {
      for (const block of this.blocks) {
        if (edit.from >= block.sourceStart && edit.from <= block.sourceEnd) {
          affected.push(block);
          break;
        }
      }
    }

    return affected;
  }

  /**
   * 重新解析块
   */
  private async reparseBlocks(
    affectedBlocks: ParseBlock[],
    options: { signal?: AbortSignal }
  ): Promise<ParseBlock[]> {
    const { signal } = options;
    const { LatexParser } = await import('./parser');
    const { LatexRenderer } = await import('./renderer');

    const updatedBlocks: ParseBlock[] = [];

    for (const block of affectedBlocks) {
      if (signal?.aborted) break;

      const blockContent = this.content.slice(block.sourceStart, block.sourceEnd);
      const newHash = this.hashString(blockContent);

      // 如果内容没变，跳过
      if (newHash === block.hash) {
        this.stats.cacheHits++;
        continue;
      }

      this.stats.cacheMisses++;

      // 重新解析
      const parser = new LatexParser(blockContent);
      const parseResult = parser.parse();

      const renderer = new LatexRenderer();
      const renderResult = renderer.render(parseResult.ast);

      // 更新块
      block.html = renderResult.html;
      block.hash = newHash;
      block.dirty = false;
      block.version = this.version;
      block.estimatedHeight = this.estimateBlockHeight(blockContent);

      updatedBlocks.push(block);
    }

    return updatedBlocks;
  }

  /**
   * 重建 HTML
   */
  private rebuildHtml(_updatedBlocks: ParseBlock[]): string {
    const htmlParts: string[] = [];

    for (const block of this.blocks) {
      htmlParts.push(block.html);
    }

    return htmlParts.join('\n');
  }

  /**
   * 重新计算渲染位置
   */
  private recalculateRenderPositions(): void {
    let currentTop = 0;

    for (const block of this.blocks) {
      block.renderTop = currentTop;
      const height = block.measuredHeight > 0 ? block.measuredHeight : block.estimatedHeight;
      currentTop += height;
    }
  }

  /**
   * 从编辑器同步到预览
   */
  private computeEditorToPreviewSync(
    editorScrollTop: number,
    viewportHeight: number,
    editorContentHeight: number
  ): ScrollSyncResult {
    if (!this.heightMap || editorContentHeight <= 0) {
      return { targetScrollTop: 0, exact: false };
    }

    // 使用 HeightMap 计算预览位置
    const result = this.heightMap.computePreviewScrollPosition(
      editorScrollTop,
      viewportHeight,
      editorContentHeight
    );

    return {
      targetScrollTop: result,
      exact: this.heightMap.getMeasurementRate() > 0.5,
      renderPosition: result,
    };
  }

  /**
   * 从预览同步到编辑器
   */
  private computePreviewToEditorSync(
    previewScrollTop: number,
    viewportHeight: number,
    previewContentHeight: number
  ): ScrollSyncResult {
    if (!this.heightMap || previewContentHeight <= 0) {
      return { targetScrollTop: 0, exact: false };
    }

    // 使用 HeightMap 计算源码位置
    const result = this.heightMap.computeSourceScrollPosition(
      previewScrollTop,
      viewportHeight,
      previewContentHeight
    );

    // 获取对应的行号
    const lineResult = this.heightMap.getLineForPosition(previewScrollTop + viewportHeight / 2);

    return {
      targetScrollTop: result,
      exact: this.heightMap.getMeasurementRate() > 0.5,
      sourceLine: Math.floor(lineResult.interpolatedLine),
    };
  }

  /**
   * 估算渲染位置
   */
  private estimateRenderPosition(sourceLine: number): number {
    if (this.blocks.length === 0) return 0;

    const totalLines = this.blocks[this.blocks.length - 1].sourceEndLine;
    const totalHeight = this.blocks.reduce(
      (sum, b) => sum + (b.measuredHeight > 0 ? b.measuredHeight : b.estimatedHeight),
      0
    );

    return totalLines > 0 ? (sourceLine / totalLines) * totalHeight : 0;
  }

  /**
   * 应用编辑到内容
   */
  private applyEditToContent(content: string, edit: EditOperation): string {
    const before = content.slice(0, edit.from);
    const after = content.slice(edit.to);
    return before + edit.text + after;
  }

  /**
   * 分割内容为块
   */
  private splitIntoChunks(content: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    let pos = 0;

    while (pos < content.length) {
      let end = Math.min(pos + chunkSize, content.length);

      // 尝试在段落边界分割
      if (end < content.length) {
        const paragraphBreak = content.lastIndexOf('\n\n', end);
        if (paragraphBreak > pos) {
          end = paragraphBreak + 2;
        } else {
          const lineBreak = content.lastIndexOf('\n', end);
          if (lineBreak > pos) {
            end = lineBreak + 1;
          }
        }
      }

      chunks.push(content.slice(pos, end));
      pos = end;
    }

    return chunks;
  }

  /**
   * 获取行号
   */
  private getLineNumber(content: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === '\n') {
        line++;
      }
    }
    return line;
  }

  /**
   * 估算块高度
   */
  private estimateBlockHeight(content: string): number {
    const lineCount = (content.match(/\n/g) || []).length + 1;
    const baseHeight = 22; // 基础行高

    // 根据内容类型调整
    if (content.includes('\\begin{equation}') || content.includes('\\[')) {
      return lineCount * baseHeight * 1.5; // 数学块更高
    }

    if (content.includes('\\section') || content.includes('\\chapter')) {
      return lineCount * baseHeight * 1.3; // 标题更高
    }

    return lineCount * baseHeight;
  }

  /**
   * 映射节点类型到块类型
   */
  private mapNodeTypeToBlockType(nodeType: string): ParseBlock['type'] {
    const typeMap: Record<string, ParseBlock['type']> = {
      root: 'document',
      document: 'document',
      preamble: 'preamble',
      section: 'section',
      paragraph: 'paragraph',
      math_inline: 'math_inline',
      math_block: 'math_block',
      environment: 'environment',
      list: 'list',
      table: 'table',
      command: 'command',
      text: 'text',
      comment: 'comment',
      error: 'error',
    };

    return typeMap[nodeType] || 'text';
  }

  /**
   * 计算字符串哈希
   */
  private hashString(str: string): number {
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
  private createErrorHtml(message: string): string {
    const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `<div class="latex-error">
      <div class="latex-error-title">解析错误</div>
      <div class="latex-error-message">${escaped}</div>
    </div>`;
  }

  /**
   * 让出主线程控制权
   */
  private yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      const g = globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } };
      if (g.scheduler?.yield) {
        g.scheduler.yield().then(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建管道集成器
 */
export function createPipelineIntegration(
  config?: Partial<IntegrationConfig>
): PipelineIntegration {
  return new PipelineIntegration(config);
}

// ================================
// 全局实例管理
// ================================

let globalIntegration: PipelineIntegration | null = null;

/**
 * 获取全局管道集成器
 */
export function getGlobalPipelineIntegration(
  config?: Partial<IntegrationConfig>
): PipelineIntegration {
  if (!globalIntegration) {
    globalIntegration = createPipelineIntegration(config);
  }
  return globalIntegration;
}

/**
 * 销毁全局管道集成器
 */
export function destroyGlobalPipelineIntegration(): void {
  if (globalIntegration) {
    globalIntegration.destroy();
    globalIntegration = null;
  }
}
