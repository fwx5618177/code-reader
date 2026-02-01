// ================================
// 滚动同步 Hook
//
// 核心功能：
// 1. 编辑器和预览之间的精确滚动同步
// 2. 基于 HeightMap 的位置计算
// 3. 防抖和节流优化
// 4. 平滑滚动动画
// ================================

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { HeightMap as HeightMapType } from '../lib/latex/height-map';
import type { ParseBlock } from '../lib/latex/streaming-pipeline';

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
  /** 时间戳 */
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
  /** 锁定持续时间（毫秒） */
  lockDuration: number;
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
  lockDuration: 100,
};

/** 滚动同步回调 */
export type ScrollSyncCallback = (
  target: ScrollSyncSource,
  scrollTop: number,
  options?: { smooth?: boolean }
) => void;

/** Hook 返回值 */
export interface ScrollSyncResult {
  // 状态
  isLocked: boolean;
  activeSource: ScrollSyncSource | null;
  lastSyncResult: SyncResult | null;

  // 方法
  handleEditorScroll: (scrollTop: number, viewportHeight: number, contentHeight: number) => void;
  handlePreviewScroll: (scrollTop: number, viewportHeight: number, contentHeight: number) => void;
  syncToLine: (line: number) => SyncResult | null;
  syncToBlock: (blockId: string) => SyncResult | null;
  setHeightMap: (heightMap: HeightMapType | null) => void;
  setBlocks: (blocks: ParseBlock[]) => void;
  unlock: () => void;
  forceSync: (source: ScrollSyncSource) => void;
}

// ================================
// 主 Hook
// ================================

/**
 * 滚动同步 Hook
 *
 * 提供编辑器和预览之间的精确滚动同步功能
 */
export function useScrollSync(
  onSync: ScrollSyncCallback,
  config: Partial<ScrollSyncConfig> = {}
): ScrollSyncResult {
  const fullConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);

  // 状态
  const [isLocked, setIsLocked] = useState(false);
  const [activeSource, setActiveSource] = useState<ScrollSyncSource | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  // Refs
  const editorStateRef = useRef<ScrollState | null>(null);
  const previewStateRef = useRef<ScrollState | null>(null);
  const heightMapRef = useRef<HeightMapType | null>(null);
  const blocksRef = useRef<ParseBlock[]>([]);
  const blockIndexRef = useRef<Map<string, ParseBlock>>(new Map());
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const onSyncRef = useRef(onSync);

  // 更新回调 ref
  useEffect(() => {
    onSyncRef.current = onSync;
  }, [onSync]);

  // 清理
  useEffect(() => {
    return () => {
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
      }
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, []);

  // 设置 HeightMap
  const setHeightMap = useCallback((heightMap: HeightMapType | null) => {
    heightMapRef.current = heightMap;
  }, []);

  // 设置块列表
  const setBlocks = useCallback((blocks: ParseBlock[]) => {
    blocksRef.current = blocks;
    blockIndexRef.current.clear();
    for (const block of blocks) {
      blockIndexRef.current.set(block.id, block);
    }
  }, []);

  // 锁定同步
  const lock = useCallback(
    (source: ScrollSyncSource) => {
      setIsLocked(true);
      setActiveSource(source);

      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
      }

      lockTimerRef.current = setTimeout(() => {
        setIsLocked(false);
        setActiveSource(null);
        lockTimerRef.current = null;
      }, fullConfig.lockDuration);
    },
    [fullConfig.lockDuration]
  );

  // 解锁同步
  const unlock = useCallback(() => {
    setIsLocked(false);
    setActiveSource(null);
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
  }, []);

  // 计算比例同步
  const computeRatioSync = useCallback(
    (source: ScrollSyncSource, state: ScrollState): SyncResult => {
      const targetState = source === 'editor' ? previewStateRef.current : editorStateRef.current;

      const targetContentHeight = targetState?.contentHeight || state.contentHeight;
      const targetViewportHeight = targetState?.viewportHeight || state.viewportHeight;

      const maxScroll = state.contentHeight - state.viewportHeight;
      const scrollRatio = maxScroll > 0 ? state.scrollTop / maxScroll : 0;

      const targetMaxScroll = targetContentHeight - targetViewportHeight;
      const targetScrollTop = Math.max(0, Math.min(scrollRatio * targetMaxScroll, targetMaxScroll));

      return {
        targetScrollTop,
        isExact: false,
        confidence: 0.3,
      };
    },
    []
  );

  // 计算行同步
  const computeLineSync = useCallback(
    (source: ScrollSyncSource, state: ScrollState): SyncResult => {
      const heightMap = heightMapRef.current;

      if (!heightMap) {
        return computeRatioSync(source, state);
      }

      if (source === 'editor') {
        // 编辑器到预览
        const centerOffset = state.scrollTop + state.viewportHeight / 2;
        const centerLine = Math.floor(centerOffset / fullConfig.editorLineHeight);

        const posResult = heightMap.getPositionForLine(centerLine);
        const previewCenterPosition = posResult.interpolatedPosition;

        const targetViewportHeight =
          previewStateRef.current?.viewportHeight || state.viewportHeight;
        const targetScrollTop = Math.max(0, previewCenterPosition - targetViewportHeight / 2);

        return {
          targetScrollTop,
          isExact: posResult.exact,
          confidence: posResult.exact ? 0.9 : 0.5,
          sourceLine: centerLine,
          renderPosition: previewCenterPosition,
        };
      } else {
        // 预览到编辑器
        const centerPosition = state.scrollTop + state.viewportHeight / 2;
        const lineResult = heightMap.getLineForPosition(centerPosition);

        const editorCenterOffset = lineResult.interpolatedLine * fullConfig.editorLineHeight;
        const targetViewportHeight = editorStateRef.current?.viewportHeight || state.viewportHeight;
        const targetScrollTop = Math.max(0, editorCenterOffset - targetViewportHeight / 2);

        return {
          targetScrollTop,
          isExact: lineResult.exact,
          confidence: lineResult.exact ? 0.9 : 0.5,
          sourceLine: Math.floor(lineResult.interpolatedLine),
          renderPosition: centerPosition,
        };
      }
    },
    [fullConfig.editorLineHeight, computeRatioSync]
  );

  // 计算块同步
  const computeBlockSync = useCallback(
    (source: ScrollSyncSource, state: ScrollState): SyncResult => {
      const blocks = blocksRef.current;

      if (blocks.length === 0) {
        return computeRatioSync(source, state);
      }

      // 找到视口中心的块
      const viewportCenter = state.scrollTop + state.viewportHeight / 2;
      let centerBlock: ParseBlock | null = null;
      let blockOffset = 0;

      for (const block of blocks) {
        const blockTop =
          source === 'editor'
            ? block.sourceStartLine * fullConfig.editorLineHeight
            : block.renderTop;

        const blockHeight =
          source === 'editor'
            ? (block.sourceEndLine - block.sourceStartLine + 1) * fullConfig.editorLineHeight
            : block.measuredHeight > 0
              ? block.measuredHeight
              : block.estimatedHeight;

        const blockBottom = blockTop + blockHeight;

        if (viewportCenter >= blockTop && viewportCenter <= blockBottom) {
          centerBlock = block;
          blockOffset = blockHeight > 0 ? (viewportCenter - blockTop) / blockHeight : 0;
          break;
        }
      }

      if (!centerBlock) {
        return computeRatioSync(source, state);
      }

      if (source === 'editor') {
        // 编辑器到预览
        const blockHeight =
          centerBlock.measuredHeight > 0 ? centerBlock.measuredHeight : centerBlock.estimatedHeight;

        const targetCenterPosition = centerBlock.renderTop + blockOffset * blockHeight;
        const targetViewportHeight =
          previewStateRef.current?.viewportHeight || state.viewportHeight;
        const targetScrollTop = Math.max(0, targetCenterPosition - targetViewportHeight / 2);

        return {
          targetScrollTop,
          isExact: centerBlock.measuredHeight > 0,
          confidence: centerBlock.measuredHeight > 0 ? 0.95 : 0.6,
          sourceLine: centerBlock.sourceStartLine,
          renderPosition: targetCenterPosition,
        };
      } else {
        // 预览到编辑器
        const lineCount = centerBlock.sourceEndLine - centerBlock.sourceStartLine + 1;
        const targetLine = centerBlock.sourceStartLine + Math.floor(blockOffset * lineCount);
        const targetCenterOffset = targetLine * fullConfig.editorLineHeight;
        const targetViewportHeight = editorStateRef.current?.viewportHeight || state.viewportHeight;
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
        };
      }
    },
    [fullConfig.editorLineHeight, computeRatioSync]
  );

  // 计算混合同步
  const computeHybridSync = useCallback(
    (source: ScrollSyncSource, state: ScrollState): SyncResult => {
      const heightMap = heightMapRef.current;
      const measurementRate = heightMap?.getMeasurementRate() || 0;

      // 如果测量率高，优先使用行同步
      if (measurementRate >= 0.3) {
        const lineResult = computeLineSync(source, state);
        if (lineResult.isExact) {
          return lineResult;
        }
      }

      // 尝试块同步
      const blockResult = computeBlockSync(source, state);
      if (blockResult.confidence > 0.5) {
        return blockResult;
      }

      // 混合块同步和比例同步
      const ratioResult = computeRatioSync(source, state);
      const blockWeight = blockResult.confidence;
      const ratioWeight = 1 - blockWeight;

      return {
        targetScrollTop:
          blockResult.targetScrollTop * blockWeight + ratioResult.targetScrollTop * ratioWeight,
        isExact: false,
        confidence: Math.max(blockResult.confidence, ratioResult.confidence),
        sourceLine: blockResult.sourceLine,
        renderPosition: blockResult.renderPosition,
      };
    },
    [computeLineSync, computeBlockSync, computeRatioSync]
  );

  // 计算同步
  const computeSync = useCallback(
    (source: ScrollSyncSource, state: ScrollState): SyncResult => {
      switch (fullConfig.mode) {
        case 'ratio':
          return computeRatioSync(source, state);
        case 'line':
          return computeLineSync(source, state);
        case 'block':
          return computeBlockSync(source, state);
        case 'hybrid':
        default:
          return computeHybridSync(source, state);
      }
    },
    [fullConfig.mode, computeRatioSync, computeLineSync, computeBlockSync, computeHybridSync]
  );

  // 执行同步
  const performSync = useCallback(
    (source: ScrollSyncSource) => {
      const state = source === 'editor' ? editorStateRef.current : previewStateRef.current;

      if (!state) return;

      const result = computeSync(source, state);
      setLastSyncResult(result);

      // 检查死区
      const targetState = source === 'editor' ? previewStateRef.current : editorStateRef.current;
      if (
        targetState &&
        Math.abs(result.targetScrollTop - targetState.scrollTop) < fullConfig.deadzone
      ) {
        return;
      }

      // 锁定防止循环
      lock(source);

      // 目标
      const target: ScrollSyncSource = source === 'editor' ? 'preview' : 'editor';

      // 调用回调
      if (fullConfig.smoothScroll) {
        // 动画滚动
        animateToPosition(target, result.targetScrollTop, targetState?.scrollTop || 0);
      } else {
        onSyncRef.current(target, result.targetScrollTop, { smooth: false });
      }

      if (fullConfig.debug) {
        console.log(`[useScrollSync] ${source} -> ${target}:`, {
          target: result.targetScrollTop,
          exact: result.isExact,
          confidence: result.confidence,
        });
      }
    },
    [computeSync, fullConfig, lock]
  );

  // 动画到目标位置
  const animateToPosition = useCallback(
    (target: ScrollSyncSource, targetScrollTop: number, startScrollTop: number) => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }

      // 如果距离太小，直接设置
      if (Math.abs(targetScrollTop - startScrollTop) < 10) {
        onSyncRef.current(target, targetScrollTop, { smooth: false });
        return;
      }

      const startTime = performance.now();
      const duration = fullConfig.smoothDuration;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // easeOutCubic 缓动
        const eased = 1 - Math.pow(1 - progress, 3);
        const currentValue = startScrollTop + (targetScrollTop - startScrollTop) * eased;

        onSyncRef.current(target, currentValue, { smooth: false });

        if (progress < 1) {
          animationIdRef.current = requestAnimationFrame(animate);
        } else {
          animationIdRef.current = null;
        }
      };

      animationIdRef.current = requestAnimationFrame(animate);
    },
    [fullConfig.smoothDuration]
  );

  // 调度同步
  const scheduleSync = useCallback(
    (source: ScrollSyncSource) => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }

      if (fullConfig.syncDelay > 0) {
        syncTimerRef.current = setTimeout(() => {
          performSync(source);
          syncTimerRef.current = null;
        }, fullConfig.syncDelay);
      } else {
        performSync(source);
      }
    },
    [fullConfig.syncDelay, performSync]
  );

  // 处理编辑器滚动
  const handleEditorScroll = useCallback(
    (scrollTop: number, viewportHeight: number, contentHeight: number) => {
      editorStateRef.current = {
        scrollTop,
        viewportHeight,
        contentHeight,
        timestamp: performance.now(),
      };

      if (isLocked && activeSource !== 'editor') {
        return;
      }

      scheduleSync('editor');
    },
    [isLocked, activeSource, scheduleSync]
  );

  // 处理预览滚动
  const handlePreviewScroll = useCallback(
    (scrollTop: number, viewportHeight: number, contentHeight: number) => {
      previewStateRef.current = {
        scrollTop,
        viewportHeight,
        contentHeight,
        timestamp: performance.now(),
      };

      if (isLocked && activeSource !== 'preview') {
        return;
      }

      scheduleSync('preview');
    },
    [isLocked, activeSource, scheduleSync]
  );

  // 同步到指定行
  const syncToLine = useCallback((line: number): SyncResult | null => {
    const heightMap = heightMapRef.current;

    if (!heightMap) {
      return null;
    }

    const posResult = heightMap.getPositionForLine(line);

    return {
      targetScrollTop: posResult.interpolatedPosition,
      isExact: posResult.exact,
      confidence: posResult.exact ? 1 : 0.5,
      sourceLine: line,
      renderPosition: posResult.interpolatedPosition,
    };
  }, []);

  // 同步到指定块
  const syncToBlock = useCallback((blockId: string): SyncResult | null => {
    const block = blockIndexRef.current.get(blockId);

    if (!block) return null;

    return {
      targetScrollTop: block.renderTop,
      isExact: block.measuredHeight > 0,
      confidence: block.measuredHeight > 0 ? 1 : 0.7,
      sourceLine: block.sourceStartLine,
      renderPosition: block.renderTop,
    };
  }, []);

  // 强制同步
  const forceSync = useCallback(
    (source: ScrollSyncSource) => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      performSync(source);
    },
    [performSync]
  );

  return {
    isLocked,
    activeSource,
    lastSyncResult,
    handleEditorScroll,
    handlePreviewScroll,
    syncToLine,
    syncToBlock,
    setHeightMap,
    setBlocks,
    unlock,
    forceSync,
  };
}

// ================================
// 便捷 Hooks
// ================================

/**
 * 创建防抖的滚动处理器
 */
export function useDebouncedScrollHandler(
  handler: (scrollTop: number, viewportHeight: number, contentHeight: number) => void,
  delay: number = 16
): (scrollTop: number, viewportHeight: number, contentHeight: number) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgsRef = useRef<[number, number, number] | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return useCallback(
    (scrollTop: number, viewportHeight: number, contentHeight: number) => {
      lastArgsRef.current = [scrollTop, viewportHeight, contentHeight];

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        if (lastArgsRef.current) {
          handler(...lastArgsRef.current);
        }
        timerRef.current = null;
      }, delay);
    },
    [handler, delay]
  );
}

/**
 * 创建节流的滚动处理器
 */
export function useThrottledScrollHandler(
  handler: (scrollTop: number, viewportHeight: number, contentHeight: number) => void,
  interval: number = 16
): (scrollTop: number, viewportHeight: number, contentHeight: number) => void {
  const lastTimeRef = useRef<number>(0);
  const pendingArgsRef = useRef<[number, number, number] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return useCallback(
    (scrollTop: number, viewportHeight: number, contentHeight: number) => {
      const now = performance.now();
      const elapsed = now - lastTimeRef.current;

      if (elapsed >= interval) {
        lastTimeRef.current = now;
        handler(scrollTop, viewportHeight, contentHeight);
      } else {
        pendingArgsRef.current = [scrollTop, viewportHeight, contentHeight];

        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            if (pendingArgsRef.current) {
              lastTimeRef.current = performance.now();
              handler(...pendingArgsRef.current);
              pendingArgsRef.current = null;
            }
            timerRef.current = null;
          }, interval - elapsed);
        }
      }
    },
    [handler, interval]
  );
}

// ================================
// 类型已在上方定义并导出
// ================================
