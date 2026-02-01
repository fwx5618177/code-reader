// ================================
// 精确滚动同步模块
//
// 核心功能：
// 1. 编辑器到预览的精确滚动同步
// 2. 预览到编辑器的反向同步
// 3. 基于 HeightMap 的精确位置计算
// 4. 平滑滚动动画
// 5. 防抖和节流优化
// ================================

import type { HeightMap as HeightMapType } from './height-map';
import type { ParseBlock } from './streaming-pipeline';

// ================================
// 类型定义
// ================================

/** 滚动同步源 */
export type ScrollSyncSource = 'editor' | 'preview';

/** 滚动同步模式 */
export type ScrollSyncMode =
  | 'ratio' // 比例同步（简单）
  | 'line' // 基于行号同步
  | 'block' // 基于块同步
  | 'hybrid'; // 混合模式（推荐）

/** 滚动状态 */
export interface ScrollState {
  /** 滚动位置（像素） */
  scrollTop: number;
  /** 视口高度（像素） */
  viewportHeight: number;
  /** 内容总高度（像素） */
  contentHeight: number;
  /** 当前可见的第一行 */
  firstVisibleLine?: number;
  /** 当前可见的最后一行 */
  lastVisibleLine?: number;
  /** 滚动时间戳 */
  timestamp: number;
}

/** 同步结果 */
export interface SyncResult {
  /** 目标滚动位置 */
  targetScrollTop: number;
  /** 是否使用精确同步 */
  isExact: boolean;
  /** 置信度（0-1） */
  confidence: number;
  /** 对应的源码行号 */
  sourceLine?: number;
  /** 对应的渲染位置 */
  renderPosition?: number;
  /** 同步方法 */
  method: ScrollSyncMode;
}

/** 滚动同步配置 */
export interface ScrollSyncConfig {
  /** 同步模式 */
  mode: ScrollSyncMode;
  /** 同步延迟（毫秒） */
  syncDelay: number;
  /** 是否启用平滑滚动 */
  smoothScroll: boolean;
  /** 平滑滚动持续时间（毫秒） */
  smoothDuration: number;
  /** 死区阈值（像素），小于此值不触发同步 */
  deadzone: number;
  /** 是否启用调试日志 */
  debug: boolean;
  /** 编辑器行高（像素） */
  editorLineHeight: number;
  /** 测量率阈值，超过此值使用精确同步 */
  measurementThreshold: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: ScrollSyncConfig = {
  mode: 'hybrid',
  syncDelay: 16,
  smoothScroll: true,
  smoothDuration: 150,
  deadzone: 5,
  debug: false,
  editorLineHeight: 22,
  measurementThreshold: 0.3,
};

/** 滚动同步回调 */
export type ScrollSyncCallback = (
  target: ScrollSyncSource,
  scrollTop: number,
  options?: { smooth?: boolean }
) => void;

/** 可见块信息 */
export interface VisibleBlock {
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
  /** 在视口中的可见比例（0-1） */
  visibleRatio: number;
  /** 在视口中的位置（0=顶部，1=底部） */
  viewportPosition: number;
}

// ================================
// 滚动同步控制器
// ================================

/**
 * 精确滚动同步控制器
 *
 * 特性：
 * - 双向滚动同步
 * - 基于 HeightMap 的精确位置计算
 * - 防抖和节流
 * - 平滑滚动动画
 */
export class ScrollSyncController {
  private config: ScrollSyncConfig;
  private heightMap: HeightMapType | null = null;
  private blocks: ParseBlock[] = [];
  private blockIndex: Map<string, ParseBlock> = new Map();

  // 滚动状态
  private editorState: ScrollState | null = null;
  private previewState: ScrollState | null = null;
  private activeSource: ScrollSyncSource | null = null;

  // 锁定状态（防止循环触发）
  private isLocked: boolean = false;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private lockDuration: number = 100;

  // 防抖
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  // 动画
  private animationId: number | null = null;
  private animationStartTime: number = 0;
  private animationStartValue: number = 0;
  private animationTargetValue: number = 0;

  // 回调
  private onSync: ScrollSyncCallback | null = null;

  // 统计
  private stats = {
    syncCount: 0,
    exactSyncCount: 0,
    ratioSyncCount: 0,
    averageConfidence: 0,
  };

  constructor(config: Partial<ScrollSyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置 HeightMap
   */
  setHeightMap(heightMap: HeightMapType | null): void {
    this.heightMap = heightMap;
  }

  /**
   * 设置块列表
   */
  setBlocks(blocks: ParseBlock[]): void {
    this.blocks = blocks;
    this.blockIndex.clear();
    for (const block of blocks) {
      this.blockIndex.set(block.id, block);
    }
  }

  /**
   * 设置同步回调
   */
  setOnSync(callback: ScrollSyncCallback | null): void {
    this.onSync = callback;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ScrollSyncConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 处理编辑器滚动
   */
  handleEditorScroll(state: ScrollState): void {
    this.editorState = state;

    if (this.isLocked && this.activeSource !== 'editor') {
      return;
    }

    this.scheduleSync('editor');
  }

  /**
   * 处理预览滚动
   */
  handlePreviewScroll(state: ScrollState): void {
    this.previewState = state;

    if (this.isLocked && this.activeSource !== 'preview') {
      return;
    }

    this.scheduleSync('preview');
  }

  /**
   * 同步到指定行
   */
  syncToLine(line: number, source: ScrollSyncSource = 'editor'): SyncResult | null {
    if (!this.heightMap) {
      return this.fallbackSync(source);
    }

    // 获取行对应的渲染位置
    const posResult = this.heightMap.getPositionForLine(line);

    if (source === 'editor') {
      // 从编辑器同步到预览
      return {
        targetScrollTop: posResult.interpolatedPosition,
        isExact: posResult.exact,
        confidence: posResult.exact ? 1 : 0.5,
        sourceLine: line,
        renderPosition: posResult.interpolatedPosition,
        method: 'line',
      };
    } else {
      // 从预览同步到编辑器（需要反向计算）
      const editorLineHeight = this.config.editorLineHeight;
      const targetScrollTop = line * editorLineHeight;

      return {
        targetScrollTop,
        isExact: posResult.exact,
        confidence: posResult.exact ? 1 : 0.5,
        sourceLine: line,
        renderPosition: posResult.interpolatedPosition,
        method: 'line',
      };
    }
  }

  /**
   * 同步到指定块
   */
  syncToBlock(blockId: string, source: ScrollSyncSource = 'editor'): SyncResult | null {
    const block = this.blockIndex.get(blockId);
    if (!block) return null;

    if (source === 'editor') {
      return {
        targetScrollTop: block.renderTop,
        isExact: block.measuredHeight > 0,
        confidence: block.measuredHeight > 0 ? 1 : 0.7,
        sourceLine: block.sourceStartLine,
        renderPosition: block.renderTop,
        method: 'block',
      };
    } else {
      const editorLineHeight = this.config.editorLineHeight;
      const targetScrollTop = block.sourceStartLine * editorLineHeight;

      return {
        targetScrollTop,
        isExact: block.measuredHeight > 0,
        confidence: block.measuredHeight > 0 ? 1 : 0.7,
        sourceLine: block.sourceStartLine,
        renderPosition: block.renderTop,
        method: 'block',
      };
    }
  }

  /**
   * 计算同步位置
   */
  computeSync(source: ScrollSyncSource): SyncResult {
    const state = source === 'editor' ? this.editorState : this.previewState;

    if (!state) {
      return {
        targetScrollTop: 0,
        isExact: false,
        confidence: 0,
        method: 'ratio',
      };
    }

    // 根据模式选择同步方法
    switch (this.config.mode) {
      case 'ratio':
        return this.computeRatioSync(source, state);
      case 'line':
        return this.computeLineSync(source, state);
      case 'block':
        return this.computeBlockSync(source, state);
      case 'hybrid':
      default:
        return this.computeHybridSync(source, state);
    }
  }

  /**
   * 获取可见块列表
   */
  getVisibleBlocks(
    scrollTop: number,
    viewportHeight: number,
    source: ScrollSyncSource = 'preview'
  ): VisibleBlock[] {
    const result: VisibleBlock[] = [];
    const viewportBottom = scrollTop + viewportHeight;

    for (const block of this.blocks) {
      const blockTop =
        source === 'preview'
          ? block.renderTop
          : block.sourceStartLine * this.config.editorLineHeight;

      const blockHeight =
        source === 'preview'
          ? block.measuredHeight > 0
            ? block.measuredHeight
            : block.estimatedHeight
          : (block.sourceEndLine - block.sourceStartLine + 1) * this.config.editorLineHeight;

      const blockBottom = blockTop + blockHeight;

      // 检查是否在视口内
      if (blockBottom > scrollTop && blockTop < viewportBottom) {
        const visibleTop = Math.max(blockTop, scrollTop);
        const visibleBottom = Math.min(blockBottom, viewportBottom);
        const visibleHeight = visibleBottom - visibleTop;
        const visibleRatio = blockHeight > 0 ? visibleHeight / blockHeight : 0;
        const viewportPosition = (blockTop - scrollTop) / viewportHeight;

        result.push({
          id: block.id,
          type: block.type,
          sourceStartLine: block.sourceStartLine,
          sourceEndLine: block.sourceEndLine,
          renderTop: block.renderTop,
          renderHeight: blockHeight,
          visibleRatio,
          viewportPosition,
        });
      }
    }

    return result;
  }

  /**
   * 获取统计信息
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      syncCount: 0,
      exactSyncCount: 0,
      ratioSyncCount: 0,
      averageConfidence: 0,
    };
  }

  /**
   * 强制同步
   */
  forceSync(source: ScrollSyncSource): void {
    this.cancelPendingSync();
    this.performSync(source);
  }

  /**
   * 取消待处理的同步
   */
  cancelPendingSync(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * 停止动画
   */
  stopAnimation(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * 解锁同步
   */
  unlock(): void {
    this.isLocked = false;
    this.activeSource = null;
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.cancelPendingSync();
    this.stopAnimation();
    this.unlock();
    this.heightMap = null;
    this.blocks = [];
    this.blockIndex.clear();
    this.onSync = null;
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 调度同步
   */
  private scheduleSync(source: ScrollSyncSource): void {
    this.cancelPendingSync();

    if (this.config.syncDelay > 0) {
      this.syncTimer = setTimeout(() => {
        this.performSync(source);
      }, this.config.syncDelay);
    } else {
      this.performSync(source);
    }
  }

  /**
   * 执行同步
   */
  private performSync(source: ScrollSyncSource): void {
    const result = this.computeSync(source);

    // 更新统计
    this.stats.syncCount++;
    if (result.isExact) {
      this.stats.exactSyncCount++;
    } else {
      this.stats.ratioSyncCount++;
    }
    this.stats.averageConfidence =
      (this.stats.averageConfidence * (this.stats.syncCount - 1) + result.confidence) /
      this.stats.syncCount;

    // 检查死区
    const targetSource: ScrollSyncSource = source === 'editor' ? 'preview' : 'editor';
    const targetState = source === 'editor' ? this.previewState : this.editorState;

    if (
      targetState &&
      Math.abs(result.targetScrollTop - targetState.scrollTop) < this.config.deadzone
    ) {
      return;
    }

    // 锁定防止循环
    this.lock(source);

    // 调用回调
    if (this.onSync) {
      if (this.config.smoothScroll) {
        this.animateToPosition(targetSource, result.targetScrollTop);
      } else {
        this.onSync(targetSource, result.targetScrollTop, { smooth: false });
      }
    }

    if (this.config.debug) {
      console.log(`[ScrollSync] ${source} -> ${targetSource}:`, {
        target: result.targetScrollTop,
        exact: result.isExact,
        confidence: result.confidence,
        method: result.method,
      });
    }
  }

  /**
   * 锁定同步
   */
  private lock(source: ScrollSyncSource): void {
    this.isLocked = true;
    this.activeSource = source;

    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
    }

    this.lockTimer = setTimeout(() => {
      this.unlock();
    }, this.lockDuration);
  }

  /**
   * 比例同步
   */
  private computeRatioSync(source: ScrollSyncSource, state: ScrollState): SyncResult {
    const targetState = source === 'editor' ? this.previewState : this.editorState;
    const targetContentHeight = targetState?.contentHeight || state.contentHeight;

    const scrollRatio =
      state.contentHeight > 0
        ? state.scrollTop / (state.contentHeight - state.viewportHeight || 1)
        : 0;

    const maxScroll = targetContentHeight - (targetState?.viewportHeight || state.viewportHeight);
    const targetScrollTop = Math.max(0, scrollRatio * maxScroll);

    return {
      targetScrollTop,
      isExact: false,
      confidence: 0.3,
      method: 'ratio',
    };
  }

  /**
   * 行同步
   */
  private computeLineSync(source: ScrollSyncSource, state: ScrollState): SyncResult {
    if (!this.heightMap) {
      return this.computeRatioSync(source, state);
    }

    if (source === 'editor') {
      // 编辑器到预览
      const centerOffset = state.scrollTop + state.viewportHeight / 2;
      const centerLine = Math.floor(centerOffset / this.config.editorLineHeight);

      const posResult = this.heightMap.getPositionForLine(centerLine);
      const previewCenterPosition = posResult.interpolatedPosition;

      const targetViewportHeight = this.previewState?.viewportHeight || state.viewportHeight;
      const targetScrollTop = Math.max(0, previewCenterPosition - targetViewportHeight / 2);

      return {
        targetScrollTop,
        isExact: posResult.exact,
        confidence: posResult.exact ? 0.9 : 0.5,
        sourceLine: centerLine,
        renderPosition: previewCenterPosition,
        method: 'line',
      };
    } else {
      // 预览到编辑器
      const centerPosition = state.scrollTop + state.viewportHeight / 2;
      const lineResult = this.heightMap.getLineForPosition(centerPosition);

      const editorCenterOffset = lineResult.interpolatedLine * this.config.editorLineHeight;
      const targetViewportHeight = this.editorState?.viewportHeight || state.viewportHeight;
      const targetScrollTop = Math.max(0, editorCenterOffset - targetViewportHeight / 2);

      return {
        targetScrollTop,
        isExact: lineResult.exact,
        confidence: lineResult.exact ? 0.9 : 0.5,
        sourceLine: Math.floor(lineResult.interpolatedLine),
        renderPosition: centerPosition,
        method: 'line',
      };
    }
  }

  /**
   * 块同步
   */
  private computeBlockSync(source: ScrollSyncSource, state: ScrollState): SyncResult {
    if (this.blocks.length === 0) {
      return this.computeRatioSync(source, state);
    }

    // 找到视口中心的块
    const viewportCenter = state.scrollTop + state.viewportHeight / 2;
    let centerBlock: ParseBlock | null = null;
    let blockOffset = 0;

    for (const block of this.blocks) {
      const blockTop =
        source === 'editor'
          ? block.sourceStartLine * this.config.editorLineHeight
          : block.renderTop;

      const blockHeight =
        source === 'editor'
          ? (block.sourceEndLine - block.sourceStartLine + 1) * this.config.editorLineHeight
          : block.measuredHeight > 0
            ? block.measuredHeight
            : block.estimatedHeight;

      const blockBottom = blockTop + blockHeight;

      if (viewportCenter >= blockTop && viewportCenter <= blockBottom) {
        centerBlock = block;
        blockOffset = (viewportCenter - blockTop) / blockHeight;
        break;
      }
    }

    if (!centerBlock) {
      return this.computeRatioSync(source, state);
    }

    if (source === 'editor') {
      // 编辑器到预览
      const blockHeight =
        centerBlock.measuredHeight > 0 ? centerBlock.measuredHeight : centerBlock.estimatedHeight;

      const targetCenterPosition = centerBlock.renderTop + blockOffset * blockHeight;
      const targetViewportHeight = this.previewState?.viewportHeight || state.viewportHeight;
      const targetScrollTop = Math.max(0, targetCenterPosition - targetViewportHeight / 2);

      return {
        targetScrollTop,
        isExact: centerBlock.measuredHeight > 0,
        confidence: centerBlock.measuredHeight > 0 ? 0.95 : 0.6,
        sourceLine: centerBlock.sourceStartLine,
        renderPosition: targetCenterPosition,
        method: 'block',
      };
    } else {
      // 预览到编辑器
      const lineCount = centerBlock.sourceEndLine - centerBlock.sourceStartLine + 1;
      const targetLine = centerBlock.sourceStartLine + Math.floor(blockOffset * lineCount);
      const targetCenterOffset = targetLine * this.config.editorLineHeight;
      const targetViewportHeight = this.editorState?.viewportHeight || state.viewportHeight;
      const targetScrollTop = Math.max(0, targetCenterOffset - targetViewportHeight / 2);

      return {
        targetScrollTop,
        isExact: centerBlock.measuredHeight > 0,
        confidence: centerBlock.measuredHeight > 0 ? 0.95 : 0.6,
        sourceLine: targetLine,
        renderPosition:
          centerBlock.renderTop +
          blockOffset *
            (centerBlock.measuredHeight > 0
              ? centerBlock.measuredHeight
              : centerBlock.estimatedHeight),
        method: 'block',
      };
    }
  }

  /**
   * 混合同步
   */
  private computeHybridSync(source: ScrollSyncSource, state: ScrollState): SyncResult {
    // 检查测量率
    const measurementRate = this.heightMap?.getMeasurementRate() || 0;

    if (measurementRate >= this.config.measurementThreshold) {
      // 使用精确的行同步
      const lineResult = this.computeLineSync(source, state);

      // 如果行同步成功且精确，直接返回
      if (lineResult.isExact) {
        return lineResult;
      }
    }

    // 尝试块同步
    const blockResult = this.computeBlockSync(source, state);

    if (blockResult.confidence > 0.5) {
      return blockResult;
    }

    // 回退到比例同步，但混合块同步的结果
    const ratioResult = this.computeRatioSync(source, state);

    // 加权混合
    const blockWeight = blockResult.confidence;
    const ratioWeight = 1 - blockWeight;

    const targetScrollTop =
      blockResult.targetScrollTop * blockWeight + ratioResult.targetScrollTop * ratioWeight;

    return {
      targetScrollTop,
      isExact: false,
      confidence: Math.max(blockResult.confidence, ratioResult.confidence),
      sourceLine: blockResult.sourceLine,
      renderPosition: blockResult.renderPosition,
      method: 'hybrid',
    };
  }

  /**
   * 回退同步
   */
  private fallbackSync(source: ScrollSyncSource): SyncResult {
    const state = source === 'editor' ? this.editorState : this.previewState;

    if (!state) {
      return {
        targetScrollTop: 0,
        isExact: false,
        confidence: 0,
        method: 'ratio',
      };
    }

    return this.computeRatioSync(source, state);
  }

  /**
   * 动画到目标位置
   */
  private animateToPosition(target: ScrollSyncSource, targetScrollTop: number): void {
    this.stopAnimation();

    const startState = target === 'editor' ? this.editorState : this.previewState;
    const startScrollTop = startState?.scrollTop || 0;

    // 如果距离太小，直接设置
    if (Math.abs(targetScrollTop - startScrollTop) < 10) {
      this.onSync?.(target, targetScrollTop, { smooth: false });
      return;
    }

    this.animationStartTime = performance.now();
    this.animationStartValue = startScrollTop;
    this.animationTargetValue = targetScrollTop;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - this.animationStartTime;
      const progress = Math.min(elapsed / this.config.smoothDuration, 1);

      // 使用 easeOutCubic 缓动
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue =
        this.animationStartValue + (this.animationTargetValue - this.animationStartValue) * eased;

      this.onSync?.(target, currentValue, { smooth: false });

      if (progress < 1) {
        this.animationId = requestAnimationFrame(animate);
      } else {
        this.animationId = null;
      }
    };

    this.animationId = requestAnimationFrame(animate);
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建滚动同步控制器
 */
export function createScrollSyncController(
  config?: Partial<ScrollSyncConfig>
): ScrollSyncController {
  return new ScrollSyncController(config);
}

// ================================
// 便捷函数
// ================================

/**
 * 计算编辑器到预览的滚动位置
 */
export function computeEditorToPreviewPosition(
  editorScrollTop: number,
  editorViewportHeight: number,
  editorContentHeight: number,
  previewContentHeight: number,
  heightMap?: HeightMapType | null,
  editorLineHeight: number = 22
): { scrollTop: number; confidence: number } {
  if (!heightMap) {
    // 使用简单比例
    const ratio = editorContentHeight > 0 ? editorScrollTop / editorContentHeight : 0;

    return {
      scrollTop: ratio * previewContentHeight,
      confidence: 0.3,
    };
  }

  // 计算编辑器中心行
  const centerOffset = editorScrollTop + editorViewportHeight / 2;
  const centerLine = Math.floor(centerOffset / editorLineHeight);

  // 获取对应的预览位置
  const posResult = heightMap.getPositionForLine(centerLine);

  return {
    scrollTop: Math.max(0, posResult.interpolatedPosition - editorViewportHeight / 2),
    confidence: posResult.exact ? 0.9 : 0.5,
  };
}

/**
 * 计算预览到编辑器的滚动位置
 */
export function computePreviewToEditorPosition(
  previewScrollTop: number,
  previewViewportHeight: number,
  previewContentHeight: number,
  editorContentHeight: number,
  heightMap?: HeightMapType | null,
  editorLineHeight: number = 22
): { scrollTop: number; line: number; confidence: number } {
  if (!heightMap) {
    // 使用简单比例
    const ratio = previewContentHeight > 0 ? previewScrollTop / previewContentHeight : 0;

    const scrollTop = ratio * editorContentHeight;
    const line = Math.floor(scrollTop / editorLineHeight);

    return {
      scrollTop,
      line,
      confidence: 0.3,
    };
  }

  // 计算预览中心位置
  const centerPosition = previewScrollTop + previewViewportHeight / 2;

  // 获取对应的源码行
  const lineResult = heightMap.getLineForPosition(centerPosition);

  const editorCenterOffset = lineResult.interpolatedLine * editorLineHeight;
  const scrollTop = Math.max(0, editorCenterOffset - previewViewportHeight / 2);

  return {
    scrollTop,
    line: Math.floor(lineResult.interpolatedLine),
    confidence: lineResult.exact ? 0.9 : 0.5,
  };
}

/**
 * 创建防抖的滚动处理器
 */
export function createDebouncedScrollHandler(
  handler: (scrollTop: number, viewportHeight: number, contentHeight: number) => void,
  delay: number = 16
): (scrollTop: number, viewportHeight: number, contentHeight: number) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: [number, number, number] | null = null;

  return (scrollTop: number, viewportHeight: number, contentHeight: number) => {
    lastArgs = [scrollTop, viewportHeight, contentHeight];

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      if (lastArgs) {
        handler(...lastArgs);
      }
      timer = null;
    }, delay);
  };
}

/**
 * 创建节流的滚动处理器
 */
export function createThrottledScrollHandler(
  handler: (scrollTop: number, viewportHeight: number, contentHeight: number) => void,
  interval: number = 16
): (scrollTop: number, viewportHeight: number, contentHeight: number) => void {
  let lastTime = 0;
  let pendingArgs: [number, number, number] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (scrollTop: number, viewportHeight: number, contentHeight: number) => {
    const now = performance.now();
    const elapsed = now - lastTime;

    if (elapsed >= interval) {
      lastTime = now;
      handler(scrollTop, viewportHeight, contentHeight);
    } else {
      pendingArgs = [scrollTop, viewportHeight, contentHeight];

      if (!timer) {
        timer = setTimeout(() => {
          if (pendingArgs) {
            lastTime = performance.now();
            handler(...pendingArgs);
            pendingArgs = null;
          }
          timer = null;
        }, interval - elapsed);
      }
    }
  };
}

// ================================
// 全局实例管理
// ================================

let globalController: ScrollSyncController | null = null;

/**
 * 获取全局滚动同步控制器
 */
export function getGlobalScrollSyncController(
  config?: Partial<ScrollSyncConfig>
): ScrollSyncController {
  if (!globalController) {
    globalController = createScrollSyncController(config);
  }
  return globalController;
}

/**
 * 销毁全局滚动同步控制器
 */
export function destroyGlobalScrollSyncController(): void {
  if (globalController) {
    globalController.destroy();
    globalController = null;
  }
}
