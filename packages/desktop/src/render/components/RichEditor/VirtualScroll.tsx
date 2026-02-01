// ================================
// 虚拟滚动组件
//
// 用于超大文件的高效渲染，只渲染可视区域内的内容
//
// 核心特性：
// 1. 只渲染可视区域 + 上下缓冲区的内容
// 2. 动态高度测量和缓存
// 3. 平滑滚动支持
// 4. 支持 ResizeObserver 自动调整
// 5. 与 Source Map 集成，支持滚动同步
// ================================

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  memo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import styles from './RichEditor.module.scss';

// ================================
// 类型定义
// ================================

/** 虚拟滚动项 */
export interface VirtualScrollItem {
  /** 唯一标识 */
  readonly id: string;
  /** 估算高度（像素） */
  readonly estimatedHeight: number;
  /** 渲染内容（HTML 字符串或 React 节点） */
  readonly content: string | React.ReactNode;
  /** 源码起始行 */
  readonly sourceStartLine?: number;
  /** 源码结束行 */
  readonly sourceEndLine?: number;
  /** 项类型 */
  readonly type?: string;
}

/** 虚拟滚动配置 */
export interface VirtualScrollConfig {
  /** 上方缓冲区项数 */
  overscanTop?: number;
  /** 下方缓冲区项数 */
  overscanBottom?: number;
  /** 默认项高度 */
  defaultItemHeight?: number;
  /** 滚动节流延迟（毫秒） */
  scrollThrottleMs?: number;
  /** 是否启用平滑滚动 */
  smoothScroll?: boolean;
}

/** 可见项信息 */
export interface VisibleItem {
  /** 项索引 */
  readonly index: number;
  /** 项数据 */
  readonly item: VirtualScrollItem;
  /** 顶部偏移量 */
  readonly top: number;
  /** 高度 */
  readonly height: number;
  /** 是否在缓冲区内 */
  readonly isOverscan: boolean;
}

/** 滚动信息 */
export interface ScrollInfo {
  /** 滚动位置 */
  readonly scrollTop: number;
  /** 可视区域高度 */
  readonly clientHeight: number;
  /** 总内容高度 */
  readonly scrollHeight: number;
  /** 滚动比例（0-1） */
  readonly scrollRatio: number;
  /** 第一个可见项索引 */
  readonly firstVisibleIndex: number;
  /** 最后一个可见项索引 */
  readonly lastVisibleIndex: number;
}

/** 虚拟滚动组件 Props */
export interface VirtualScrollProps {
  /** 项列表 */
  items: readonly VirtualScrollItem[];
  /** 配置 */
  config?: VirtualScrollConfig;
  /** 容器类名 */
  className?: string;
  /** 内容区域类名 */
  contentClassName?: string;
  /** 项渲染器 */
  renderItem?: (item: VirtualScrollItem, index: number) => React.ReactNode;
  /** 滚动事件回调 */
  onScroll?: (scrollInfo: ScrollInfo) => void;
  /** 可见项变化回调 */
  onVisibleItemsChange?: (visibleItems: readonly VisibleItem[]) => void;
  /** 外部控制的滚动位置 */
  scrollTo?: { ratio?: number; index?: number; top?: number } | null;
  /** 是否显示加载指示器 */
  isLoading?: boolean;
  /** 空状态渲染 */
  emptyContent?: React.ReactNode;
}

/** 虚拟滚动组件暴露的方法 */
export interface VirtualScrollHandle {
  /** 滚动到指定位置 */
  scrollTo: (options: { ratio?: number; index?: number; top?: number }) => void;
  /** 获取当前滚动信息 */
  getScrollInfo: () => ScrollInfo;
  /** 刷新高度缓存 */
  refreshHeights: () => void;
  /** 获取容器元素 */
  getContainer: () => HTMLDivElement | null;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<VirtualScrollConfig> = {
  overscanTop: 3,
  overscanBottom: 3,
  defaultItemHeight: 100,
  scrollThrottleMs: 16,
  smoothScroll: true,
};

// ================================
// 虚拟滚动组件
// ================================

/**
 * 虚拟滚动组件
 *
 * 实现高效的大列表渲染，只渲染可视区域内的项。
 * 使用动态高度测量和缓存，支持变高项。
 */
export const VirtualScroll = memo(
  forwardRef<VirtualScrollHandle, VirtualScrollProps>(
    (
      {
        items,
        config: configProp,
        className,
        contentClassName,
        renderItem,
        onScroll,
        onVisibleItemsChange,
        scrollTo,
        isLoading,
        emptyContent,
      },
      ref
    ) => {
      // 合并配置
      const config = useMemo(() => ({ ...DEFAULT_CONFIG, ...configProp }), [configProp]);

      // Refs
      const containerRef = useRef<HTMLDivElement>(null);
      const contentRef = useRef<HTMLDivElement>(null);
      const heightCacheRef = useRef<Map<string, number>>(new Map());
      const measureRafRef = useRef<number | null>(null);
      const scrollRafRef = useRef<number | null>(null);
      const lastScrollTopRef = useRef(0);

      // State
      const [scrollTop, setScrollTop] = useState(0);
      const [containerHeight, setContainerHeight] = useState(0);
      const [, forceUpdate] = useState({});

      // ================================
      // 高度计算
      // ================================

      /**
       * 获取项的高度（使用缓存或估算值）
       */
      const getItemHeight = useCallback(
        (item: VirtualScrollItem): number => {
          const cached = heightCacheRef.current.get(item.id);
          return cached ?? item.estimatedHeight ?? config.defaultItemHeight;
        },
        [config.defaultItemHeight]
      );

      /**
       * 计算所有项的位置信息
       */
      const itemPositions = useMemo(() => {
        const positions: { top: number; height: number }[] = [];
        let currentTop = 0;

        for (const item of items) {
          const height = getItemHeight(item);
          positions.push({ top: currentTop, height });
          currentTop += height;
        }

        return positions;
      }, [items, getItemHeight]);

      /**
       * 计算总高度
       */
      const totalHeight = useMemo(() => {
        if (itemPositions.length === 0) return 0;
        const lastPosition = itemPositions[itemPositions.length - 1];
        return lastPosition.top + lastPosition.height;
      }, [itemPositions]);

      // ================================
      // 可见项计算
      // ================================

      /**
       * 计算可见项列表
       */
      const visibleItems = useMemo((): readonly VisibleItem[] => {
        if (items.length === 0 || containerHeight === 0) {
          return [];
        }

        const viewportTop = scrollTop;
        const viewportBottom = scrollTop + containerHeight;

        // 二分查找第一个可见项
        let startIndex = 0;
        let endIndex = items.length - 1;

        // 查找第一个底部在视口内的项
        let low = 0;
        let high = items.length - 1;

        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const pos = itemPositions[mid];
          if (pos.top + pos.height < viewportTop) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }

        startIndex = Math.max(0, low - config.overscanTop);

        // 查找最后一个顶部在视口内的项
        low = startIndex;
        high = items.length - 1;

        while (low < high) {
          const mid = Math.floor((low + high + 1) / 2);
          const pos = itemPositions[mid];
          if (pos.top > viewportBottom) {
            high = mid - 1;
          } else {
            low = mid;
          }
        }

        endIndex = Math.min(items.length - 1, low + config.overscanBottom);

        // 构建可见项列表
        const visible: VisibleItem[] = [];
        const firstVisibleIndex = Math.max(0, startIndex + config.overscanTop);
        const lastVisibleIndex = Math.min(items.length - 1, endIndex - config.overscanBottom);

        for (let i = startIndex; i <= endIndex; i++) {
          const pos = itemPositions[i];
          visible.push({
            index: i,
            item: items[i],
            top: pos.top,
            height: pos.height,
            isOverscan: i < firstVisibleIndex || i > lastVisibleIndex,
          });
        }

        return visible;
      }, [items, itemPositions, scrollTop, containerHeight, config]);

      // ================================
      // 滚动信息
      // ================================

      /**
       * 获取当前滚动信息
       */
      const getScrollInfo = useCallback((): ScrollInfo => {
        const firstVisible = visibleItems.find((v) => !v.isOverscan);
        const lastVisible = [...visibleItems].reverse().find((v) => !v.isOverscan);

        return {
          scrollTop,
          clientHeight: containerHeight,
          scrollHeight: totalHeight,
          scrollRatio:
            totalHeight > containerHeight ? scrollTop / (totalHeight - containerHeight) : 0,
          firstVisibleIndex: firstVisible?.index ?? 0,
          lastVisibleIndex: lastVisible?.index ?? 0,
        };
      }, [scrollTop, containerHeight, totalHeight, visibleItems]);

      // ================================
      // 滚动处理
      // ================================

      /**
       * 处理滚动事件
       */
      const handleScroll = useCallback(() => {
        if (!containerRef.current) return;

        const newScrollTop = containerRef.current.scrollTop;

        // 使用 RAF 节流
        if (scrollRafRef.current !== null) {
          cancelAnimationFrame(scrollRafRef.current);
        }

        scrollRafRef.current = requestAnimationFrame(() => {
          setScrollTop(newScrollTop);
          lastScrollTopRef.current = newScrollTop;

          if (onScroll) {
            const info = getScrollInfo();
            onScroll(info);
          }

          scrollRafRef.current = null;
        });
      }, [onScroll, getScrollInfo]);

      /**
       * 滚动到指定位置
       */
      const scrollToPosition = useCallback(
        (options: { ratio?: number; index?: number; top?: number }) => {
          if (!containerRef.current) return;

          let targetTop: number;

          if (options.top !== undefined) {
            targetTop = options.top;
          } else if (options.index !== undefined) {
            const pos = itemPositions[options.index];
            targetTop = pos ? pos.top : 0;
          } else if (options.ratio !== undefined) {
            const maxScroll = totalHeight - containerHeight;
            targetTop = options.ratio * maxScroll;
          } else {
            return;
          }

          targetTop = Math.max(0, Math.min(totalHeight - containerHeight, targetTop));

          if (config.smoothScroll) {
            containerRef.current.scrollTo({
              top: targetTop,
              behavior: 'smooth',
            });
          } else {
            containerRef.current.scrollTop = targetTop;
          }
        },
        [itemPositions, totalHeight, containerHeight, config.smoothScroll]
      );

      // ================================
      // 高度测量
      // ================================

      /**
       * 测量项的实际高度
       */
      const measureItems = useCallback(() => {
        if (!contentRef.current) return;

        const itemElements = contentRef.current.querySelectorAll('[data-virtual-item-id]');
        let hasChanges = false;

        itemElements.forEach((element) => {
          const id = element.getAttribute('data-virtual-item-id');
          if (!id) return;

          const height = element.getBoundingClientRect().height;
          const cached = heightCacheRef.current.get(id);

          if (cached !== height && height > 0) {
            heightCacheRef.current.set(id, height);
            hasChanges = true;
          }
        });

        if (hasChanges) {
          // 强制重新计算
          forceUpdate({});
        }
      }, []);

      /**
       * 刷新所有高度缓存
       */
      const refreshHeights = useCallback(() => {
        heightCacheRef.current.clear();
        forceUpdate({});
      }, []);

      // ================================
      // Effects
      // ================================

      // 监听容器大小变化
      useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            setContainerHeight(entry.contentRect.height);
          }
        });

        resizeObserver.observe(containerRef.current);
        setContainerHeight(containerRef.current.clientHeight);

        return () => {
          resizeObserver.disconnect();
        };
      }, []);

      // 渲染后测量高度
      useEffect(() => {
        if (measureRafRef.current !== null) {
          cancelAnimationFrame(measureRafRef.current);
        }

        measureRafRef.current = requestAnimationFrame(() => {
          measureItems();
          measureRafRef.current = null;
        });

        return () => {
          if (measureRafRef.current !== null) {
            cancelAnimationFrame(measureRafRef.current);
          }
        };
      }, [visibleItems, measureItems]);

      // 响应外部滚动控制
      useEffect(() => {
        if (scrollTo) {
          scrollToPosition(scrollTo);
        }
      }, [scrollTo, scrollToPosition]);

      // 通知可见项变化
      useEffect(() => {
        if (onVisibleItemsChange) {
          onVisibleItemsChange(visibleItems);
        }
      }, [visibleItems, onVisibleItemsChange]);

      // 清理
      useEffect(() => {
        return () => {
          if (scrollRafRef.current !== null) {
            cancelAnimationFrame(scrollRafRef.current);
          }
          if (measureRafRef.current !== null) {
            cancelAnimationFrame(measureRafRef.current);
          }
        };
      }, []);

      // ================================
      // 暴露方法
      // ================================

      useImperativeHandle(
        ref,
        () => ({
          scrollTo: scrollToPosition,
          getScrollInfo,
          refreshHeights,
          getContainer: () => containerRef.current,
        }),
        [scrollToPosition, getScrollInfo, refreshHeights]
      );

      // ================================
      // 渲染
      // ================================

      /**
       * 默认项渲染器
       */
      const defaultRenderItem = useCallback((item: VirtualScrollItem): React.ReactNode => {
        if (typeof item.content === 'string') {
          return (
            <div
              className={styles.virtualScrollItemContent}
              dangerouslySetInnerHTML={{ __html: item.content }}
            />
          );
        }
        return item.content;
      }, []);

      const itemRenderer = renderItem || defaultRenderItem;

      // 空状态
      if (items.length === 0 && !isLoading) {
        return (
          <div className={`${styles.virtualScrollContainer} ${className || ''}`}>
            {emptyContent || <div className={styles.virtualScrollEmpty}>暂无内容</div>}
          </div>
        );
      }

      return (
        <div
          ref={containerRef}
          className={`${styles.virtualScrollContainer} ${className || ''}`}
          onScroll={handleScroll}
        >
          {/* 占位元素，撑起总高度 */}
          <div className={styles.virtualScrollSpacer} style={{ height: totalHeight }} />

          {/* 内容区域 */}
          <div
            ref={contentRef}
            className={`${styles.virtualScrollContent} ${contentClassName || ''}`}
            style={{
              transform: `translateY(${visibleItems[0]?.top ?? 0}px)`,
            }}
          >
            {visibleItems.map(({ index, item, height }) => (
              <div
                key={item.id}
                data-virtual-item-id={item.id}
                data-virtual-item-index={index}
                className={styles.virtualScrollItem}
                style={{
                  minHeight: height,
                }}
              >
                {itemRenderer(item, index)}
              </div>
            ))}
          </div>

          {/* 加载指示器 */}
          {isLoading && (
            <div className={styles.virtualScrollLoading}>
              <span>加载中...</span>
            </div>
          )}
        </div>
      );
    }
  )
);

VirtualScroll.displayName = 'VirtualScroll';

// ================================
// 辅助 Hook
// ================================

/**
 * 将 HTML 字符串分割为虚拟滚动项
 */
export function useHtmlToVirtualItems(
  html: string,
  options?: {
    blockSelector?: string;
    defaultHeight?: number;
  }
): VirtualScrollItem[] {
  return useMemo(() => {
    if (!html) return [];

    const { blockSelector = '[data-block-id]', defaultHeight = 100 } = options || {};

    // 创建临时 DOM 解析 HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const blocks = doc.querySelectorAll(blockSelector);

    if (blocks.length === 0) {
      // 没有块标记，作为单个项返回
      return [
        {
          id: 'content-0',
          estimatedHeight: defaultHeight,
          content: html,
        },
      ];
    }

    const items: VirtualScrollItem[] = [];

    blocks.forEach((block, index) => {
      const id = block.getAttribute('data-block-id') || `block-${index}`;
      const type = block.getAttribute('data-block-type') || 'unknown';
      const startLine = parseInt(block.getAttribute('data-source-start-line') || '0', 10);
      const endLine = parseInt(block.getAttribute('data-source-end-line') || '0', 10);

      items.push({
        id,
        estimatedHeight: defaultHeight,
        content: block.outerHTML,
        type,
        sourceStartLine: startLine,
        sourceEndLine: endLine,
      });
    });

    return items;
  }, [html, options]);
}

/**
 * 虚拟滚动滚动同步 Hook
 */
export function useVirtualScrollSync(
  sourceRef: React.RefObject<VirtualScrollHandle>,
  targetRef: React.RefObject<VirtualScrollHandle>,
  options?: {
    enabled?: boolean;
    debounceMs?: number;
  }
): {
  syncFromSource: () => void;
  syncFromTarget: () => void;
} {
  const { enabled = true, debounceMs = 16 } = options || {};
  const isSyncingRef = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncFromSource = useCallback(() => {
    if (!enabled || isSyncingRef.current) return;
    if (!sourceRef.current || !targetRef.current) return;

    isSyncingRef.current = true;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      const sourceInfo = sourceRef.current?.getScrollInfo();
      if (sourceInfo) {
        targetRef.current?.scrollTo({ ratio: sourceInfo.scrollRatio });
      }
      isSyncingRef.current = false;
    }, debounceMs);
  }, [enabled, debounceMs, sourceRef, targetRef]);

  const syncFromTarget = useCallback(() => {
    if (!enabled || isSyncingRef.current) return;
    if (!sourceRef.current || !targetRef.current) return;

    isSyncingRef.current = true;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      const targetInfo = targetRef.current?.getScrollInfo();
      if (targetInfo) {
        sourceRef.current?.scrollTo({ ratio: targetInfo.scrollRatio });
      }
      isSyncingRef.current = false;
    }, debounceMs);
  }, [enabled, debounceMs, sourceRef, targetRef]);

  // 清理
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  return { syncFromSource, syncFromTarget };
}

// ================================
// 导出
// ================================

export default VirtualScroll;
