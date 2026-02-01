// ================================
// LaTeX 编辑器组件
//
// 高性能 LaTeX 编辑实现，完全重构版本
//
// 核心特性：
// 1. 使用 LatexDocument 模型作为数据源，支持高效增量编辑
// 2. RealHeightMap 实现精确的源码-渲染位置映射（基于 DOM 实测）
// 3. Web Worker 后台解析和渲染，避免主线程阻塞
// 4. 虚拟滚动支持超大文件
// 5. 分栏模式下的滚动同步（完全基于真实高度，禁止估算）
// 6. 增量更新：只更新变化的部分
// ================================

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useTransition,
  memo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
  Code,
  Eye,
  Columns,
  AlertTriangle,
  Loader2,
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import { latexWithTheme } from '../../lib/latex/codemirror-latex';
import {
  LatexDocument,
  createAutoLatexDocument,
  type DocumentChange,
  type SourceMapEntry,
} from '../../lib/latex/latex-document';
import { getIncrementalEngine, getMathWorkerService } from '../../lib/latex';
import { SourceMapGenerator, createSourceMapFromAST } from '../../lib/latex/source-map-generator';
import { RenderPipeline } from '../../lib/latex/render-pipeline';
import { HeightMap, createHeightMap } from '../../lib/latex/height-map';
import {
  RealHeightMap,
  createRealHeightMap,
  measureBlockElements,
  createBlockResizeObserver as createRealHeightResizeObserver,
} from '../../lib/latex/real-height-map';
import {
  VirtualScroll,
  type VirtualScrollItem,
  type VirtualScrollHandle,
  type ScrollInfo as VirtualScrollInfo,
} from './VirtualScroll';
import styles from './RichEditor.module.scss';

// ================================
// 常量定义
// ================================

/** 大文件阈值（字节） */
const LARGE_FILE_THRESHOLD = 50 * 1024; // 50KB

/** 超大文件阈值（字节） */
const HUGE_FILE_THRESHOLD = 200 * 1024; // 200KB

/** 虚拟滚动阈值（字节） */
const VIRTUAL_SCROLL_THRESHOLD = 100 * 1024; // 100KB

/** 渲染超时时间（毫秒） */
const RENDER_TIMEOUT_MS = 10000;

/** 大文件渲染超时时间（毫秒） */
const LARGE_FILE_RENDER_TIMEOUT_MS = 30000;

/** 超大文件渲染超时时间（毫秒） */
const HUGE_FILE_RENDER_TIMEOUT_MS = 60000;

/** 渲染防抖默认延迟 */
const DEFAULT_DEBOUNCE_MS = 150;

/** 大文件渲染防抖延迟 */
const LARGE_FILE_DEBOUNCE_MS = 300;

/** 超大文件渲染防抖延迟 */
const HUGE_FILE_DEBOUNCE_MS = 500;

/** 滚动同步延迟（毫秒） */
const SCROLL_SYNC_DELAY_MS = 50;

/** 滚动锁定时间（毫秒）- 防止滚动循环 */
const SCROLL_LOCK_DURATION_MS = 200;

/** 滚动同步最小变化阈值 - 小于此值的变化不触发同步 */
const SCROLL_SYNC_MIN_DELTA = 0.02;

/** 渲染期间滚动锁定时间（毫秒）- 防止渲染影响源码滚动 */
const RENDER_SCROLL_LOCK_DURATION_MS = 500;

/** 最大内容长度阈值（超过此长度使用虚拟滚动） */
const MAX_CONTENT_LENGTH_FOR_FULL_RENDER = 100 * 1024; // 100KB

// ================================
// 类型定义
// ================================

export interface LatexEditorProps {
  /** LaTeX 源码内容 */
  initialContent?: string;
  /** 内容变化回调 */
  onChange?: (content: string) => void;
  /** 是否只读 */
  readOnly?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 渲染防抖延迟（毫秒） */
  debounceMs?: number;
}

/** 编辑器视图模式 */
type ViewMode = 'source' | 'render' | 'split';

/** 解析状态信息 */
interface ParseStatus {
  /** 是否正在解析 */
  isParsing: boolean;
  /** 解析时间（毫秒） */
  parseTime: number;
  /** 渲染时间（毫秒） */
  renderTime: number;
  /** 缓存命中率 */
  cacheHitRate: number;
}

/** 文件大小类型 */
type FileSizeType = 'small' | 'large' | 'huge';

// ================================
// 工具函数
// ================================

/**
 * 超时包装函数
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * 获取文件大小类型
 */
function getFileSizeType(content: string): FileSizeType {
  const size = new Blob([content]).size;
  if (size >= HUGE_FILE_THRESHOLD) return 'huge';
  if (size >= LARGE_FILE_THRESHOLD) return 'large';
  return 'small';
}

/**
 * 检查是否需要虚拟滚动
 */
function shouldUseVirtualScroll(content: string): boolean {
  return new Blob([content]).size >= VIRTUAL_SCROLL_THRESHOLD;
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 标准化 LaTeX 源码
 */
function normalizeLatexSource(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ================================
// 源码编辑器组件
// ================================

interface SourceEditorProps {
  /** 文档模型 */
  document: LatexDocument;
  /** 内容变化回调 */
  onChange?: (changes: DocumentChange[]) => void;
  /** 是否只读 */
  readOnly?: boolean;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 滚动事件回调 */
  onScroll?: (scrollRatio: number) => void;
  /** 外部控制的滚动位置 */
  scrollToRatio?: number | null;
}

const SourceEditor = memo<SourceEditorProps>(
  ({ document, onChange, readOnly = false, showLineNumbers = true, onScroll, scrollToRatio }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorViewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onScrollRef = useRef(onScroll);
    const isInternalUpdateRef = useRef(false);
    const isScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    onChangeRef.current = onChange;
    onScrollRef.current = onScroll;

    // 滚动处理
    const handleScroll = useCallback(() => {
      if (isScrollingRef.current) return;

      const scroller = editorViewRef.current?.scrollDOM;
      if (!scroller || !onScrollRef.current) return;

      const scrollTop = scroller.scrollTop;
      const scrollHeight = scroller.scrollHeight;
      const clientHeight = scroller.clientHeight;
      const maxScroll = scrollHeight - clientHeight;
      const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;

      // 防抖处理滚动同步
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        onScrollRef.current?.(scrollRatio);
      }, SCROLL_SYNC_DELAY_MS);
    }, []);

    // CodeMirror 扩展
    const extensions = useMemo((): Extension[] => {
      const exts: Extension[] = [
        latexWithTheme(),
        history(),
        closeBrackets(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isInternalUpdateRef.current) {
            // 将 CodeMirror 的变更转换为 DocumentChange
            const changes: DocumentChange[] = [];
            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              const insertedText = inserted.toString();
              const deletedText = document.getTextRange(fromA, toA);

              changes.push({
                from: fromA,
                to: toA,
                insert: insertedText,
                deleted: deletedText,
                oldLength: document.length,
                newLength: document.length - (toA - fromA) + insertedText.length,
              });
            });

            if (changes.length > 0) {
              onChangeRef.current?.(changes);
            }
          }
        }),
        EditorView.domEventHandlers({
          scroll: handleScroll,
        }),
      ];

      if (showLineNumbers) {
        exts.push(lineNumbers(), highlightActiveLineGutter());
      }

      if (readOnly) {
        exts.push(EditorView.editable.of(false));
      }

      return exts;
    }, [document, showLineNumbers, readOnly, handleScroll]);

    // 初始化编辑器
    useEffect(() => {
      if (!containerRef.current) return;

      const state = EditorState.create({
        doc: document.getText(),
        extensions,
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      editorViewRef.current = view;

      return () => {
        view.destroy();
        editorViewRef.current = null;
      };
    }, []); // 只在挂载时创建

    // 响应外部滚动控制
    useEffect(() => {
      if (scrollToRatio === null || scrollToRatio === undefined) return;

      const view = editorViewRef.current;
      if (!view) return;

      isScrollingRef.current = true;

      const scroller = view.scrollDOM;
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      const targetScrollTop = scrollToRatio * maxScroll;

      scroller.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      });

      // 解除滚动锁定 - 使用更长的时间防止滚动循环
      setTimeout(() => {
        isScrollingRef.current = false;
      }, SCROLL_LOCK_DURATION_MS);
    }, [scrollToRatio]);

    // 同步文档内容变化到编辑器
    useEffect(() => {
      const view = editorViewRef.current;
      if (!view) return;

      const currentContent = view.state.doc.toString();
      const documentContent = document.getText();

      if (currentContent !== documentContent) {
        isInternalUpdateRef.current = true;
        view.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: documentContent,
          },
        });
        isInternalUpdateRef.current = false;
      }
    }, [document]);

    // 清理
    useEffect(() => {
      return () => {
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
      };
    }, []);

    return <div ref={containerRef} className={styles.latexSourceEditor} />;
  }
);

SourceEditor.displayName = 'SourceEditor';

// ================================
// 渲染预览组件
// ================================

/** 缩放级别配置 - 使用字体大小百分比 */
const ZOOM_LEVELS = [80, 100, 120, 150, 180, 200, 250, 300];
const DEFAULT_ZOOM = 100;
const MIN_ZOOM = 80;
const MAX_ZOOM = 300;
const ZOOM_STEP = 20;

interface RenderPreviewProps {
  /** 渲染的 HTML 内容 */
  html: string;
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 滚动事件回调 */
  onScroll?: (scrollRatio: number) => void;
  /** 外部控制的滚动位置 */
  scrollToRatio?: number | null;
  /** 是否正在渲染中（用于锁定滚动同步） */
  isRenderingLocked?: boolean;
  /** 是否使用虚拟滚动 */
  useVirtualScroll?: boolean;
  /** 虚拟滚动项列表 */
  virtualItems?: readonly VirtualScrollItem[];
  /** Source Map 生成器 */
  sourceMap?: SourceMapGenerator | null;
}

/** RenderPreview 的公开句柄 */
export interface RenderPreviewHandle {
  /** 获取容器元素 */
  getContainer: () => HTMLElement | null;
  /** 获取内容元素 */
  getContentElement: () => HTMLElement | null;
  /** 设置缩放级别 */
  setZoom: (zoom: number) => void;
  /** 获取当前缩放级别 */
  getZoom: () => number;
}

const RenderPreview = memo(
  forwardRef<RenderPreviewHandle, RenderPreviewProps>(
    (
      {
        html,
        isLoading,
        error,
        onScroll,
        scrollToRatio,
        useVirtualScroll: enableVirtualScroll = false,
        virtualItems = [],
        sourceMap: _sourceMap,
        isRenderingLocked = false,
      },
      ref
    ) => {
      const containerRef = useRef<HTMLDivElement>(null);
      const contentRef = useRef<HTMLDivElement>(null);

      // 缩放状态 (百分比，如 100 表示 100%)
      const [zoom, setZoom] = useState(DEFAULT_ZOOM);

      // 缩放控制函数
      const handleZoomIn = useCallback(() => {
        setZoom((prev) => {
          // 找到下一个更大的预设级别
          const nextLevel = ZOOM_LEVELS.find((level) => level > prev);
          return nextLevel ?? MAX_ZOOM;
        });
      }, []);

      const handleZoomOut = useCallback(() => {
        setZoom((prev) => {
          // 找到下一个更小的预设级别
          const prevLevels = ZOOM_LEVELS.filter((level) => level < prev);
          return prevLevels.length > 0 ? prevLevels[prevLevels.length - 1] : MIN_ZOOM;
        });
      }, []);

      const handleZoomReset = useCallback(() => {
        setZoom(DEFAULT_ZOOM);
      }, []);

      // 鼠标滚轮缩放（按住 Ctrl/Cmd）
      const handleWheel = useCallback(
        (e: React.WheelEvent) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.deltaY < 0) {
              handleZoomIn();
            } else {
              handleZoomOut();
            }
          }
        },
        [handleZoomIn, handleZoomOut]
      );

      // 暴露句柄给父组件
      useImperativeHandle(ref, () => ({
        getContainer: () => containerRef.current,
        getContentElement: () => contentRef.current,
        setZoom: (newZoom: number) =>
          setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(newZoom)))),
        getZoom: () => zoom,
      }));
      const virtualScrollRef = useRef<VirtualScrollHandle>(null);
      const isScrollingRef = useRef(false);
      const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
      const onScrollRef = useRef(onScroll);

      onScrollRef.current = onScroll;

      // 渲染锁定状态的 ref（避免闭包问题）
      const isRenderingLockedRef = useRef(isRenderingLocked);
      isRenderingLockedRef.current = isRenderingLocked;

      // 上一次的滚动比例，用于检测是否是有意义的滚动
      const lastScrollRatioRef = useRef<number | null>(null);

      // 普通滚动处理
      const handleScroll = useCallback(() => {
        // 如果正在外部控制滚动，忽略
        if (isScrollingRef.current) return;

        const container = containerRef.current;
        if (!container || !onScrollRef.current) return;

        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const maxScroll = scrollHeight - clientHeight;
        const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;

        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }

        scrollTimeoutRef.current = setTimeout(() => {
          // 在延迟回调中检查渲染锁定状态（此时才是真正要同步的时刻）
          if (isRenderingLockedRef.current) return;

          // 检查滚动比例是否有显著变化（避免微小的DOM变化触发滚动同步）
          const lastRatio = lastScrollRatioRef.current;
          if (lastRatio !== null && Math.abs(scrollRatio - lastRatio) < 0.01) {
            return;
          }
          lastScrollRatioRef.current = scrollRatio;

          onScrollRef.current?.(scrollRatio);
        }, SCROLL_SYNC_DELAY_MS);
      }, []);

      // 虚拟滚动处理
      const handleVirtualScroll = useCallback((scrollInfo: VirtualScrollInfo) => {
        // 如果正在外部控制滚动，忽略
        if (isScrollingRef.current || !onScrollRef.current) return;

        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }

        scrollTimeoutRef.current = setTimeout(() => {
          // 在延迟回调中检查渲染锁定状态
          if (isRenderingLockedRef.current) return;
          onScrollRef.current?.(scrollInfo.scrollRatio);
        }, SCROLL_SYNC_DELAY_MS);
      }, []);

      // 响应外部滚动控制
      useEffect(() => {
        if (scrollToRatio === null || scrollToRatio === undefined) return;

        isScrollingRef.current = true;

        if (enableVirtualScroll && virtualScrollRef.current) {
          virtualScrollRef.current.scrollTo({ ratio: scrollToRatio });
        } else if (containerRef.current) {
          const container = containerRef.current;
          const maxScroll = container.scrollHeight - container.clientHeight;
          const targetScrollTop = scrollToRatio * maxScroll;

          container.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth',
          });
        }

        setTimeout(() => {
          isScrollingRef.current = false;
        }, SCROLL_LOCK_DURATION_MS);
      }, [scrollToRatio, enableVirtualScroll]);

      // 清理
      useEffect(() => {
        return () => {
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
        };
      }, []);

      // 加载状态
      if (isLoading && !html) {
        return (
          <div className={styles.latexPreview}>
            <div className={styles.latexPreviewLoading}>
              <Loader2 className={styles.latexPreviewSpinner} />
              <span>渲染中...</span>
            </div>
          </div>
        );
      }

      // 错误状态
      if (error && !html) {
        return (
          <div className={styles.latexPreview}>
            <div className={styles.latexPreviewError}>
              <AlertTriangle size={24} />
              <span>{error}</span>
            </div>
          </div>
        );
      }

      // 虚拟滚动渲染
      if (enableVirtualScroll && virtualItems.length > 0) {
        return (
          <VirtualScroll
            ref={virtualScrollRef}
            items={virtualItems}
            className={styles.latexPreview}
            contentClassName={styles.latexPreviewContent}
            onScroll={handleVirtualScroll}
            isLoading={isLoading}
            config={{
              overscanTop: 3,
              overscanBottom: 5,
              defaultItemHeight: 100,
            }}
          />
        );
      }

      // 普通渲染
      return (
        <div
          ref={containerRef}
          className={`${styles.latexPreview} ${isLoading ? styles.syncScrolling : ''}`}
          onScroll={handleScroll}
          onWheel={handleWheel}
          style={{ position: 'relative' }}
        >
          {/* 缩放控制栏 */}
          <div className={styles.zoomControls}>
            <button
              className={styles.zoomButton}
              onClick={handleZoomOut}
              disabled={zoom <= MIN_ZOOM}
              title="缩小 (Ctrl + 滚轮下)"
            >
              <ZoomOut size={16} />
            </button>
            <span className={styles.zoomLevel} onClick={handleZoomReset} title="点击重置为100%">
              {zoom}%
            </span>
            <button
              className={styles.zoomButton}
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
              title="放大 (Ctrl + 滚轮上)"
            >
              <ZoomIn size={16} />
            </button>
            {zoom !== DEFAULT_ZOOM && (
              <button className={styles.zoomButton} onClick={handleZoomReset} title="重置缩放">
                <RotateCcw size={14} />
              </button>
            )}
          </div>
          <div
            ref={contentRef}
            className={styles.latexPreviewContent}
            style={{
              fontSize: `${zoom}%`,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {isLoading && (
            <div className={styles.latexPreviewLoading}>
              <Loader2 className={styles.latexPreviewSpinner} size={16} />
            </div>
          )}
        </div>
      );
    }
  )
);

RenderPreview.displayName = 'RenderPreview';

// ================================
// 视图模式切换组件
// ================================

interface ViewModeToggleProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  disabled?: boolean;
}

const ViewModeToggle = memo<ViewModeToggleProps>(({ mode, onModeChange, disabled }) => {
  const modes: Array<{ value: ViewMode; icon: React.ReactNode; label: string }> = [
    { value: 'source', icon: <Code size={16} />, label: '源码' },
    { value: 'render', icon: <Eye size={16} />, label: '预览' },
    { value: 'split', icon: <Columns size={16} />, label: '分栏' },
  ];

  return (
    <div className={styles.latexViewModeGroup}>
      {modes.map(({ value, icon, label }) => (
        <button
          key={value}
          type="button"
          className={`${styles.latexViewModeBtn} ${mode === value ? styles.latexViewModeBtnActive : ''}`}
          onClick={() => onModeChange(value)}
          disabled={disabled}
          title={label}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
});

ViewModeToggle.displayName = 'ViewModeToggle';

// ================================
// 状态指示器组件
// ================================

interface StatusIndicatorsProps {
  fileSizeType: FileSizeType;
  parseError: string | null;
  parseStatus: ParseStatus;
  useVirtualScroll?: boolean;
  /** 文件大小（字节） */
  fileSize?: number;
}

/**
 * 格式化文件大小为可读字符串
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}

const StatusIndicators = memo<StatusIndicatorsProps>(
  ({ fileSizeType, parseError, parseStatus, useVirtualScroll, fileSize }) => (
    <div className={styles.latexEditorHeaderRight}>
      {/* 文件大小显示 */}
      {fileSize !== undefined && fileSize > 0 && (
        <div
          className={styles.latexFileSizeIndicator}
          title={`文件大小: ${formatFileSize(fileSize)}`}
        >
          <FileText size={14} />
          <span>{formatFileSize(fileSize)}</span>
        </div>
      )}

      {/* 文件类型指示器（大文件/超大文件） */}
      {fileSizeType !== 'small' && (
        <div
          className={
            fileSizeType === 'huge' ? styles.latexHugeFileIndicator : styles.latexLargeFileIndicator
          }
          title={fileSizeType === 'huge' ? '超大文件模式（启用高性能优化）' : '大文件模式'}
        >
          <span>{fileSizeType === 'huge' ? '超大文件' : '大文件'}</span>
        </div>
      )}

      {/* 虚拟滚动指示器 */}
      {useVirtualScroll && (
        <div className={styles.latexTreeSitterIndicator} title="虚拟滚动已启用">
          <span>虚拟滚动</span>
        </div>
      )}

      {/* 解析状态 */}
      {parseStatus.isParsing && (
        <div className={styles.latexEditorStatus}>
          <Loader2 size={14} className={styles.latexEditorSpinner} />
          <span>解析中...</span>
        </div>
      )}

      {/* 错误指示器 */}
      {parseError && (
        <div className={styles.latexEditorError} title={parseError}>
          <AlertTriangle size={14} />
          <span>错误</span>
        </div>
      )}

      {/* 性能指标 */}
      {!parseStatus.isParsing && parseStatus.parseTime > 0 && (
        <div className={styles.latexEditorMeta}>
          <span title="解析耗时">{parseStatus.parseTime.toFixed(0)}ms</span>
          {parseStatus.cacheHitRate > 0 && (
            <span title="缓存命中率">{(parseStatus.cacheHitRate * 100).toFixed(0)}%</span>
          )}
        </div>
      )}
    </div>
  )
);

StatusIndicators.displayName = 'StatusIndicators';

// ================================
// 主编辑器组件
// ================================

export const LatexEditor: React.FC<LatexEditorProps> = ({
  initialContent = '',
  onChange,
  readOnly = false,
  className = '',
  showLineNumbers = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}) => {
  // Refs
  const onChangeRef = useRef(onChange);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isParsingRef = useRef(false);
  const engineRef = useRef(getIncrementalEngine());
  const mathWorkerRef = useRef(getMathWorkerService());
  const abortControllerRef = useRef<AbortController | null>(null);
  const renderVersionRef = useRef(0);
  const lastParsedContentRef = useRef<string>('');
  const cachedHtmlRef = useRef<string>('');

  onChangeRef.current = onChange;

  // 文档模型 - 使用 LatexDocument
  const [latexDocument] = useState(() => createAutoLatexDocument(initialContent));

  // State
  const [, setContent] = useState(initialContent);
  const [renderedHtml, setRenderedHtml] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [fileSizeType, setFileSizeType] = useState<FileSizeType>('small');
  const [fileSize, setFileSize] = useState<number>(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<ParseStatus>({
    isParsing: false,
    parseTime: 0,
    renderTime: 0,
    cacheHitRate: 0,
  });

  // Source Map 和 HeightMap 状态
  const [sourceMap, setSourceMap] = useState<SourceMapGenerator | null>(null);
  const renderPipelineRef = useRef<RenderPipeline | null>(null);
  const heightMapRef = useRef<HeightMap | null>(null);
  const previewRef = useRef<RenderPreviewHandle>(null);

  // 真实高度映射（用于精确滚动同步）
  const realHeightMapRef = useRef<RealHeightMap | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // 虚拟滚动状态
  const [virtualItems, setVirtualItems] = useState<VirtualScrollItem[]>([]);
  const [enableVirtualScroll, setEnableVirtualScroll] = useState(false);

  // 滚动同步状态
  const [sourceScrollRatio, setSourceScrollRatio] = useState<number | null>(null);
  const [previewScrollRatio, setPreviewScrollRatio] = useState<number | null>(null);
  const scrollSyncSourceRef = useRef<'source' | 'preview' | null>(null);
  // 渲染期间锁定滚动同步，防止渲染引起的 DOM 变化触发滚动事件
  const isRenderingScrollLockRef = useRef(false);

  // React 18 并发特性
  const [isPending, startTransition] = useTransition();

  // 初始化文件大小
  useEffect(() => {
    const contentSize = new Blob([initialContent]).size;
    setFileSize(contentSize);
    setFileSizeType(getFileSizeType(initialContent));
    setEnableVirtualScroll(shouldUseVirtualScroll(initialContent));
  }, [initialContent]);

  // 获取当前渲染超时时间
  const getRenderTimeout = useCallback(() => {
    if (fileSizeType === 'huge') return HUGE_FILE_RENDER_TIMEOUT_MS;
    if (fileSizeType === 'large') return LARGE_FILE_RENDER_TIMEOUT_MS;
    return RENDER_TIMEOUT_MS;
  }, [fileSizeType]);

  // 获取实际防抖延迟
  const getActualDebounceMs = useCallback(() => {
    if (fileSizeType === 'huge') return HUGE_FILE_DEBOUNCE_MS;
    if (fileSizeType === 'large') return LARGE_FILE_DEBOUNCE_MS;
    return debounceMs;
  }, [fileSizeType, debounceMs]);

  // 检测文件大小和虚拟滚动需求
  useEffect(() => {
    const sizeType = getFileSizeType(initialContent);
    setFileSizeType(sizeType);
    setEnableVirtualScroll(shouldUseVirtualScroll(initialContent));
  }, [initialContent]);

  // 取消当前渲染
  const cancelCurrentRender = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 重置解析锁定状态，允许新的渲染请求
    isParsingRef.current = false;
  }, []);

  // 上一次同步的滚动比例，用于检测有意义的变化
  const lastSourceScrollRef = useRef<number>(0);
  const lastPreviewScrollRef = useRef<number>(0);

  // 处理源码编辑器滚动 - 使用比例方式，RealHeightMap 用于后续优化
  const handleSourceScroll = useCallback(
    (scrollRatio: number) => {
      // 如果正在从预览同步，或者不是分屏模式，或者渲染期间锁定，跳过
      if (
        viewMode !== 'split' ||
        scrollSyncSourceRef.current === 'preview' ||
        isRenderingScrollLockRef.current
      )
        return;

      // 检查滚动变化是否足够大（避免微小变化导致的循环）
      const lastRatio = lastSourceScrollRef.current;
      if (Math.abs(scrollRatio - lastRatio) < SCROLL_SYNC_MIN_DELTA) {
        return;
      }
      lastSourceScrollRef.current = scrollRatio;

      // 设置滚动源锁定
      scrollSyncSourceRef.current = 'source';

      // 简化的比例同步（禁用 RealHeightMap 映射，因为它会导致双向同步问题）
      // RealHeightMap 映射会计算出与输入不同的比例，导致另一侧滚动时
      // 反向计算又得出不同的比例，形成循环
      let targetRatio = scrollRatio;

      // 只在预览比例变化足够大时才同步
      if (Math.abs(targetRatio - lastPreviewScrollRef.current) >= SCROLL_SYNC_MIN_DELTA) {
        setPreviewScrollRatio(Math.max(0, Math.min(1, targetRatio)));
      }

      // 使用更长的锁定时间防止滚动循环
      setTimeout(() => {
        scrollSyncSourceRef.current = null;
      }, SCROLL_LOCK_DURATION_MS);
    },
    [viewMode]
  );

  // 处理预览滚动 - 使用比例方式
  const handlePreviewScroll = useCallback(
    (scrollRatio: number) => {
      // 如果正在从源码同步，或者不是分屏模式，或者渲染期间锁定，跳过
      if (
        viewMode !== 'split' ||
        scrollSyncSourceRef.current === 'source' ||
        isRenderingScrollLockRef.current
      )
        return;

      // 检查滚动变化是否足够大（避免微小变化导致的循环）
      const lastRatio = lastPreviewScrollRef.current;
      if (Math.abs(scrollRatio - lastRatio) < SCROLL_SYNC_MIN_DELTA) {
        return;
      }
      lastPreviewScrollRef.current = scrollRatio;

      // 设置滚动源锁定
      scrollSyncSourceRef.current = 'preview';

      // 简化的比例同步（禁用 RealHeightMap 映射，因为它会导致双向同步问题）
      let targetRatio = scrollRatio;

      // 只在源码比例变化足够大时才同步
      if (Math.abs(targetRatio - lastSourceScrollRef.current) >= SCROLL_SYNC_MIN_DELTA) {
        setSourceScrollRatio(Math.max(0, Math.min(1, targetRatio)));
      }

      // 使用更长的锁定时间防止滚动循环
      setTimeout(() => {
        scrollSyncSourceRef.current = null;
      }, SCROLL_LOCK_DURATION_MS);
    },
    [viewMode]
  );

  // 测量 DOM 块并更新真实高度映射
  const measureAndUpdateHeightMap = useCallback(() => {
    const previewContainer = previewRef.current?.getContainer();
    const heightMap = realHeightMapRef.current;

    if (!previewContainer || !heightMap) return;

    try {
      const measurements = measureBlockElements(previewContainer, {
        blockSelector: '[data-block-id]',
        blockIdAttribute: 'data-block-id',
        visibleOnly: false,
      });

      if (measurements.length > 0) {
        heightMap.updateMeasurements(measurements);

        // 更新容器高度
        heightMap.setContainerHeight(previewContainer.scrollHeight);
        heightMap.setViewportHeight(previewContainer.clientHeight);

        if (process.env.NODE_ENV === 'development') {
          const progress = heightMap.getMeasurementProgress();
          console.log(
            `[LatexEditor] DOM 测量完成: ${measurements.length} 个块, ` +
              `测量率: ${(progress.rate * 100).toFixed(1)}%`
          );
        }
      }
    } catch (err) {
      console.warn('[LatexEditor] DOM 测量失败:', err);
    }
  }, []);

  // 设置 ResizeObserver 监听块尺寸变化
  const setupResizeObserver = useCallback(() => {
    const previewContainer = previewRef.current?.getContainer();
    const heightMap = realHeightMapRef.current;

    if (!previewContainer || !heightMap) return;

    // 清理旧的 observer
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }

    // 创建新的 observer
    resizeObserverRef.current = createRealHeightResizeObserver(previewContainer, heightMap, {
      blockSelector: '[data-block-id]',
      blockIdAttribute: 'data-block-id',
      debounceMs: 100,
    });
  }, []);

  // 将 HTML 转换为虚拟滚动项
  const convertHtmlToVirtualItems = useCallback((html: string): VirtualScrollItem[] => {
    if (!html) return [];

    // 尝试按块分割
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const blocks = doc.querySelectorAll(
      '[data-block-id], .latex-section, .latex-paragraph, .latex-math-block, p, h1, h2, h3, h4, h5, h6'
    );

    if (blocks.length === 0) {
      // 没有块标记，作为单个项返回
      return [
        {
          id: 'content-0',
          estimatedHeight: 200,
          content: html,
        },
      ];
    }

    const items: VirtualScrollItem[] = [];
    blocks.forEach((block, index) => {
      const id = block.getAttribute('data-block-id') || `block-${index}`;
      const type = block.tagName.toLowerCase();

      // 根据类型估算高度
      let estimatedHeight = 100;
      if (type === 'h1') estimatedHeight = 60;
      else if (type === 'h2' || type === 'h3') estimatedHeight = 50;
      else if (type === 'p') estimatedHeight = 80;
      else if (block.classList.contains('latex-math-block')) estimatedHeight = 120;

      items.push({
        id,
        estimatedHeight,
        content: block.outerHTML,
        type,
      });
    });

    return items;
  }, []);

  /**
   * 解析和渲染
   */
  const parseAndRender = useCallback(
    async (sourceContent: string): Promise<void> => {
      // 如果内容未变化，直接使用缓存
      if (sourceContent === lastParsedContentRef.current && cachedHtmlRef.current) {
        setRenderedHtml(cachedHtmlRef.current);
        return;
      }

      // 防止在组件卸载后继续渲染
      if (!isMountedRef.current) return;

      // 如果正在解析，取消当前渲染并开始新的渲染
      if (isParsingRef.current) {
        cancelCurrentRender();
      }

      // 内容长度检查
      if (sourceContent.length > MAX_CONTENT_LENGTH_FOR_FULL_RENDER * 2) {
        console.warn(
          `[LaTeX Editor] 内容过长 (${(sourceContent.length / 1024).toFixed(1)}KB)，使用简化渲染`
        );
        const simplifiedHtml = `
          <div class="${styles.latexSimplifiedPreview}">
            <div class="${styles.latexSimplifiedNotice}">
              <strong>文件内容过长</strong>
              <p>为保证性能，当前显示简化预览。请使用源码模式编辑。</p>
            </div>
            <pre class="${styles.latexSimplifiedSource}">${escapeHtml(sourceContent.slice(0, 5000))}${sourceContent.length > 5000 ? '\n...(内容过长，已截断)' : ''}</pre>
          </div>
        `;
        setRenderedHtml(simplifiedHtml);
        cachedHtmlRef.current = simplifiedHtml;
        lastParsedContentRef.current = sourceContent;
        return;
      }

      // 取消之前的渲染操作
      cancelCurrentRender();

      // 创建新的中断控制器
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const signal = abortController.signal;

      // 增加渲染版本号
      const currentVersion = ++renderVersionRef.current;

      isParsingRef.current = true;
      setParseStatus((prev) => ({ ...prev, isParsing: true }));
      setIsRendering(true);
      setParseError(null);

      // 渲染开始时锁定滚动同步，防止渲染过程中的 DOM 变化触发滚动事件
      isRenderingScrollLockRef.current = true;

      try {
        const engine = engineRef.current;
        const normalizedContent = normalizeLatexSource(sourceContent);

        // 检查版本和中断
        const checkAborted = () => {
          if (signal.aborted || renderVersionRef.current !== currentVersion) {
            throw new Error('渲染已取消');
          }
        };

        checkAborted();

        // 使用超时保护的完整渲染
        const timeoutMs = getRenderTimeout();

        const result = await withTimeout(
          engine.parseAndRender(normalizedContent),
          timeoutMs,
          `渲染超时（${timeoutMs}ms）`
        );

        checkAborted();

        const { render, parseResult, ast } = result;

        if (render.success && render.html) {
          // 获取缓存统计
          const cacheStats = engine.getCacheStats();
          const mathStats = mathWorkerRef.current.getStats();

          if (!signal.aborted && renderVersionRef.current === currentVersion) {
            setRenderedHtml(render.html);
            cachedHtmlRef.current = render.html;
            lastParsedContentRef.current = normalizedContent;

            // 生成 Source Map 和 RealHeightMap
            if (ast) {
              const newSourceMap = createSourceMapFromAST(ast, normalizedContent, render.html);
              setSourceMap(newSourceMap);

              // 更新 LatexDocument 的 Source Map
              const entries = newSourceMap.getEntries().map((entry) => ({
                sourceLine: entry.sourceStartLine,
                sourceOffset: entry.sourceStartOffset,
                sourceEndOffset: entry.sourceEndOffset,
                renderBlockId: entry.blockId,
                renderBlockType: entry.blockType,
                renderPosition: entry.renderPosition,
              }));
              latexDocument.updateSourceMap(entries as SourceMapEntry[]);

              // 初始化或更新 RealHeightMap（用于精确滚动同步）
              const lineCount = (normalizedContent.match(/\n/g) || []).length + 1;

              if (!realHeightMapRef.current) {
                realHeightMapRef.current = createRealHeightMap({
                  defaultLineHeight: 22,
                  containerHeight: 600,
                  viewportHeight: 600,
                  measurementTTL: 5000,
                  debug: process.env.NODE_ENV === 'development',
                });
              }

              realHeightMapRef.current.setTotalLines(lineCount);

              // 清空旧块并添加新块（初始为估算值）
              realHeightMapRef.current.clear();

              // 从 Source Map 条目添加块到 RealHeightMap
              const sourceMapEntries = newSourceMap.getEntries();
              const blocks = sourceMapEntries.map((entry) => ({
                id: entry.blockId,
                type: entry.blockType as import('../../lib/latex/real-height-map').BlockType,
                sourceStartLine: entry.sourceStartLine,
                sourceEndLine: entry.sourceEndLine,
                sourceStartOffset: entry.sourceStartOffset,
                sourceEndOffset: entry.sourceEndOffset,
                renderTop: entry.renderPosition,
                renderHeight: entry.renderHeight,
                priority: 50,
              }));

              realHeightMapRef.current.addBlocks(blocks);

              // 兼容：同时更新旧的 HeightMap
              if (!heightMapRef.current) {
                heightMapRef.current = createHeightMap({
                  defaultLineHeight: 22,
                  containerHeight: 600,
                  totalLines: lineCount,
                  debug: false,
                });
              }

              for (const entry of sourceMapEntries) {
                heightMapRef.current.addBlock({
                  id: entry.blockId,
                  sourceStartLine: entry.sourceStartLine,
                  sourceEndLine: entry.sourceEndLine,
                  sourceStartOffset: entry.sourceStartOffset,
                  sourceEndOffset: entry.sourceEndOffset,
                  type: entry.blockType as import('../../lib/latex/height-map').HeightBlockType,
                  renderTop: entry.renderPosition,
                  renderHeight: entry.renderHeight,
                  measured: false,
                  priority: 50,
                });
              }

              // 延迟 DOM 测量（等待渲染完成）- 使用真实高度测量
              requestAnimationFrame(() => {
                // 测量并更新 RealHeightMap
                measureAndUpdateHeightMap();

                // 设置 ResizeObserver 监听尺寸变化
                setupResizeObserver();

                // 延迟解除渲染滚动锁定，确保 DOM 完全稳定后再允许滚动同步
                setTimeout(() => {
                  isRenderingScrollLockRef.current = false;
                }, RENDER_SCROLL_LOCK_DURATION_MS);
              });
            }

            // 如果启用虚拟滚动，生成虚拟滚动项
            if (enableVirtualScroll) {
              const items = convertHtmlToVirtualItems(render.html);
              setVirtualItems(items);
            }

            setParseStatus({
              isParsing: false,
              parseTime: parseResult.parseTime,
              renderTime: render.renderTime,
              cacheHitRate: (cacheStats.hitRate + mathStats.cacheHitRate) / 2,
            });
          }
        } else {
          throw new Error(render.error || '渲染失败');
        }

        if (!signal.aborted && renderVersionRef.current === currentVersion) {
          setIsRendering(false);
          // 如果没有 AST（没有进入上面的 DOM 测量分支），也要解除渲染滚动锁定
          if (!ast) {
            setTimeout(() => {
              isRenderingScrollLockRef.current = false;
            }, RENDER_SCROLL_LOCK_DURATION_MS);
          }
        }
      } catch (error) {
        if (signal.aborted || renderVersionRef.current !== currentVersion) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.includes('超时');

        console.error('[LaTeX Editor] 解析/渲染错误:', message);

        setParseError(message);

        const errorHtml = `
          <div class="${styles.latexErrorBlock}">
            <div class="${styles.latexErrorMessage}">
              ${isTimeout ? '渲染超时' : '渲染错误'}: ${escapeHtml(message)}
            </div>
            <details>
              <summary>显示源码</summary>
              <pre class="${styles.latexBlockSource}">${escapeHtml(sourceContent.slice(0, 2000))}${sourceContent.length > 2000 ? '\n...(内容过长，已截断)' : ''}</pre>
            </details>
          </div>
        `;
        setRenderedHtml(errorHtml);
        setIsRendering(false);
        // 错误情况下也要解除渲染滚动锁定
        setTimeout(() => {
          isRenderingScrollLockRef.current = false;
        }, RENDER_SCROLL_LOCK_DURATION_MS);
        setParseStatus((prev) => ({
          ...prev,
          isParsing: false,
        }));
      } finally {
        isParsingRef.current = false;
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      cancelCurrentRender,
      getRenderTimeout,
      enableVirtualScroll,
      convertHtmlToVirtualItems,
      latexDocument,
    ]
  );

  // 处理文档变更（来自 LatexDocument）
  const handleDocumentChanges = useCallback(
    (changes: DocumentChange[]) => {
      // 应用变更到文档模型
      for (const change of changes) {
        if (change.insert && change.from === change.to) {
          // 插入
          latexDocument.insert(change.from, change.insert);
        } else if (!change.insert && change.from !== change.to) {
          // 删除
          latexDocument.delete(change.from, change.to);
        } else {
          // 替换
          latexDocument.replace(change.from, change.to, change.insert);
        }
      }

      // 获取新内容
      const newContent = latexDocument.getText();
      setContent(newContent);

      // 更新文件大小和类型
      const contentSize = new Blob([newContent]).size;
      setFileSize(contentSize);

      const newSizeType = getFileSizeType(newContent);
      if (newSizeType !== fileSizeType) {
        setFileSizeType(newSizeType);
        setEnableVirtualScroll(shouldUseVirtualScroll(newContent));
      }

      // 通知外部
      onChangeRef.current?.(newContent);

      // 防抖渲染
      if (viewMode !== 'source') {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        const actualDebounce = getActualDebounceMs();
        debounceTimerRef.current = setTimeout(() => {
          startTransition(() => {
            parseAndRender(newContent);
          });
        }, actualDebounce);
      }
    },
    [viewMode, fileSizeType, getActualDebounceMs, parseAndRender, latexDocument]
  );

  // 处理视图模式变化
  const handleViewModeChange = useCallback(
    (newMode: ViewMode) => {
      setViewMode(newMode);

      // 切换到包含预览的模式时，触发渲染
      if (newMode !== 'source') {
        const currentContent = latexDocument.getText();
        if (currentContent === lastParsedContentRef.current && cachedHtmlRef.current) {
          setRenderedHtml(cachedHtmlRef.current);
        } else {
          startTransition(() => {
            parseAndRender(currentContent);
          });
        }
      }
    },
    [parseAndRender, latexDocument]
  );

  // 初始化渲染
  useEffect(() => {
    isMountedRef.current = true;

    if (initialContent && viewMode !== 'source') {
      const timer = setTimeout(() => {
        parseAndRender(initialContent);
      }, 100);
      return () => clearTimeout(timer);
    }

    return () => {
      isMountedRef.current = false;
      cancelCurrentRender();

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // 清理 ResizeObserver
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      // 清理 RealHeightMap
      if (realHeightMapRef.current) {
        realHeightMapRef.current.clear();
        realHeightMapRef.current = null;
      }

      // 清理 HeightMap 和 RenderPipeline
      if (heightMapRef.current) {
        heightMapRef.current.clear();
        heightMapRef.current = null;
      }
      if (renderPipelineRef.current) {
        renderPipelineRef.current.destroy();
        renderPipelineRef.current = null;
      }

      latexDocument.destroy();
    };
  }, [cancelCurrentRender, latexDocument]);

  // 计算容器类名
  const containerClassName = useMemo(() => {
    const classes = [styles.latexEditorContainer, className];
    if (readOnly) {
      classes.push(styles.latexEditorReadonly);
    }
    if (fileSizeType !== 'small') {
      classes.push(styles.latexEditorLargeFile);
    }
    if (fileSizeType === 'huge') {
      classes.push(styles.latexEditorHugeFile);
    }
    if (viewMode === 'split') {
      classes.push(styles.latexEditorSplit);
    }
    return classes.filter(Boolean).join(' ');
  }, [className, readOnly, fileSizeType, viewMode]);

  return (
    <div className={containerClassName}>
      {/* 编辑器头部 */}
      <div className={styles.latexEditorHeader}>
        <ViewModeToggle
          mode={viewMode}
          onModeChange={handleViewModeChange}
          disabled={parseStatus.isParsing}
        />
        <StatusIndicators
          fileSizeType={fileSizeType}
          parseError={parseError}
          parseStatus={parseStatus}
          useVirtualScroll={enableVirtualScroll}
          fileSize={fileSize}
        />
      </div>

      {/* 主内容区域 */}
      <div className={styles.latexEditorMain}>
        {/* 源码模式 */}
        {viewMode === 'source' && (
          <div className={styles.latexEditorPane}>
            <SourceEditor
              document={latexDocument}
              onChange={handleDocumentChanges}
              readOnly={readOnly}
              showLineNumbers={showLineNumbers}
            />
          </div>
        )}

        {/* 预览模式 */}
        {viewMode === 'render' && (
          <div className={styles.latexEditorPane}>
            <RenderPreview
              ref={previewRef}
              html={renderedHtml}
              isLoading={isPending || isRendering}
              error={parseError}
              useVirtualScroll={enableVirtualScroll}
              virtualItems={virtualItems}
              sourceMap={sourceMap}
            />
          </div>
        )}

        {/* 分栏模式 */}
        {viewMode === 'split' && (
          <>
            <div className={styles.latexEditorPaneLeft}>
              <SourceEditor
                document={latexDocument}
                onChange={handleDocumentChanges}
                readOnly={readOnly}
                showLineNumbers={showLineNumbers}
                onScroll={handleSourceScroll}
                scrollToRatio={sourceScrollRatio}
              />
            </div>
            <div className={styles.latexEditorDivider} />
            <div className={styles.latexEditorPaneRight}>
              <RenderPreview
                ref={previewRef}
                html={renderedHtml}
                isLoading={isPending || isRendering}
                error={parseError}
                onScroll={handlePreviewScroll}
                scrollToRatio={previewScrollRatio}
                useVirtualScroll={enableVirtualScroll}
                virtualItems={virtualItems}
                sourceMap={sourceMap}
                isRenderingLocked={isRendering}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default LatexEditor;
