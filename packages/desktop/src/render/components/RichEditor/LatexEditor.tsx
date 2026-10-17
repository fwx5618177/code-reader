// ================================
// LaTeX 编辑器组件
//
// 唯一的增量渲染链路：
// CodeMirror 事务 → LatexDocument.applyChanges（事务前坐标的整批编辑）
//   → IncrementalLatexEngine.update（块级增量解析）
//   → RenderPipeline.applyUpdate（按块 diff 提交 DOM：可视区优先、Worker 批量、帧预算）
//   → measureDOMBlocks 回写 HeightMap
//   → 分栏滚动同步（源码行 ↔ 块 ↔ 实测位置，ScrollSyncLock 决定方向）
// ================================

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  memo,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
} from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { openLintPanel } from '@codemirror/lint';
import {
  Code,
  Eye,
  Columns,
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2,
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import { latex } from '../../lib/latex/codemirror-latex';
import { latexAnalysis } from '../../lib/latex/codemirror-analysis';
import type { LatexAnalysis } from '../../lib/latex/analysis';
import { requestLatexAnalysis } from '../../lib/latex/analysis-client';
import { findHeadingIndex } from '../../lib/markdown';
import { getEditorBridge, type EditorInstance } from '../../lib/plugins/editor-bridge';
import {
  LatexDocument,
  editorChangesToChangeSet,
  type DocumentChange,
} from '../../lib/latex/latex-document';
import { IncrementalLatexEngine, type LatexUpdateResult } from '../../lib/latex/incremental-engine';
import { RenderPipeline } from '../../lib/latex/render-pipeline';
import { ScrollSyncLock, type ScrollSyncEvent } from '../../lib/latex/scroll-sync';
import styles from './RichEditor.module.scss';
import latexStyles from './LatexEditor.module.scss';

// ================================
// 常量定义
// ================================

/** 大文件阈值（字节） */
const LARGE_FILE_THRESHOLD = 50 * 1024;

/** 超大文件阈值（字节） */
const HUGE_FILE_THRESHOLD = 200 * 1024;

/** 预览刷新防抖默认延迟（毫秒） */
const DEFAULT_DEBOUNCE_MS = 150;

// ================================
// 类型定义
// ================================

export interface LatexEditorProps {
  /** LaTeX 源码内容 */
  initialContent?: string;
  /** 内容变化回调（只由用户编辑触发） */
  onChange?: (content: string) => void;
  /** 是否只读 */
  readOnly?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 预览刷新防抖延迟（毫秒） */
  debounceMs?: number;
  /** 定位到章节（侧栏大纲点击）：occurrence 为同名章节中的序号 */
  revealHeading?: { heading: string; occurrence?: number } | null;
  /** 是否为聚焦的一栏（插件编辑器 API 作用于聚焦的一栏） */
  active?: boolean;
}

/** 编辑器视图模式 */
type ViewMode = 'source' | 'render' | 'split';

/** 解析状态信息 */
interface ParseStatus {
  /** 最近一次增量解析耗时（毫秒） */
  parseTime: number;
  /** 最近一次更新中复用（未重新解析）的块占比 */
  reuseRate: number;
}

/** 文件大小类型 */
type FileSizeType = 'small' | 'large' | 'huge';

/** 各级别诊断数量 */
type DiagnosticCounts = Record<'error' | 'warning' | 'info', number>;

const NO_DIAGNOSTICS: DiagnosticCounts = { error: 0, warning: 0, info: 0 };

function countDiagnostics(analysis: LatexAnalysis): DiagnosticCounts {
  const counts = { ...NO_DIAGNOSTICS };
  for (const diagnostic of analysis.diagnostics) counts[diagnostic.severity]++;
  return counts;
}

/** 已执行过的章节定位请求（编辑器重新挂载时不重复滚动） */
const revealedHeadingRequests = new WeakSet<object>();

// ================================
// 工具函数
// ================================

function getFileSize(content: string): number {
  return new Blob([content]).size;
}

function getFileSizeType(size: number): FileSizeType {
  if (size >= HUGE_FILE_THRESHOLD) return 'huge';
  if (size >= LARGE_FILE_THRESHOLD) return 'large';
  return 'small';
}

function toParseStatus(result: LatexUpdateResult): ParseStatus {
  const bodyBlocks = result.blocks.filter((b) => b.kind === 'body').length;
  return {
    parseTime: result.parseTime,
    reuseRate: bodyBlocks > 0 ? result.reusedBlocks / bodyBlocks : 1,
  };
}

/**
 * 统一换行符：CodeMirror 文档内部只使用 \n，LatexDocument 必须与其坐标一致
 */
function normalizeLatexSource(source: string): string {
  return source.replace(/\r\n?/g, '\n');
}

/**
 * 源码视口顶部所在的行（带小数，表示行内比例）
 */
function getTopVisibleLine(view: EditorView): number {
  const height = Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop);
  const block = view.lineBlockAtHeight(height);
  const line = view.state.doc.lineAt(block.from).number;
  const fraction = block.height > 0 ? (height - block.top) / block.height : 0;
  return line + Math.min(1, Math.max(0, fraction));
}

/**
 * 把源码滚动到指定行（带小数）位于视口顶部
 */
function scrollSourceToLine(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const lineNumber = Math.min(doc.lines, Math.max(1, Math.floor(line)));
  const block = view.lineBlockAt(doc.line(lineNumber).from);
  const scroller = view.scrollDOM;
  const documentOffset = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const target = documentOffset + block.top + (line - lineNumber) * block.height;
  if (Math.abs(scroller.scrollTop - target) >= 1) {
    scroller.scrollTop = target;
  }
}

// ================================
// 源码编辑器组件
// ================================

interface SourceEditorProps {
  /** 文档模型 */
  document: LatexDocument;
  /** 用户编辑已应用到文档模型后回调（事务前坐标系的变更） */
  onDocumentChange: (changes: DocumentChange[]) => void;
  /** 源码滚动 */
  onScroll: () => void;
  /** EditorView 创建/销毁 */
  onViewChange: (view: EditorView | null) => void;
  /** 语法/引用分析结果写入编辑器后回调 */
  onAnalysis: (analysis: LatexAnalysis) => void;
  /** 是否只读 */
  readOnly?: boolean;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
}

const SourceEditor = memo<SourceEditorProps>(
  ({
    document,
    onDocumentChange,
    onScroll,
    onViewChange,
    onAnalysis,
    readOnly = false,
    showLineNumbers = true,
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const onDocumentChangeRef = useRef(onDocumentChange);
    const onScrollRef = useRef(onScroll);
    const onViewChangeRef = useRef(onViewChange);
    const onAnalysisRef = useRef(onAnalysis);
    onDocumentChangeRef.current = onDocumentChange;
    onScrollRef.current = onScroll;
    onViewChangeRef.current = onViewChange;
    onAnalysisRef.current = onAnalysis;

    const extensions = useMemo((): Extension[] => {
      const exts: Extension[] = [
        latex(),
        history(),
        closeBrackets(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, indentWithTab]),
        latexAnalysis((analysis) => onAnalysisRef.current(analysis)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          // 一个事务内的多处变更都使用事务前坐标，必须整批应用
          const changes = document.applyChanges(editorChangesToChangeSet(update.changes));
          if (changes.length > 0) {
            onDocumentChangeRef.current(changes);
          }
        }),
      ];

      if (showLineNumbers) {
        exts.push(lineNumbers(), highlightActiveLineGutter());
      }

      if (readOnly) {
        exts.push(EditorView.editable.of(false));
      }

      return exts;
    }, [document, showLineNumbers, readOnly]);

    // 编辑器只在挂载时创建，内容来自文档模型
    useEffect(() => {
      if (!containerRef.current) return;

      const view = new EditorView({
        state: EditorState.create({ doc: document.getText(), extensions }),
        parent: containerRef.current,
      });
      const handleScroll = () => onScrollRef.current();
      view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });
      onViewChangeRef.current(view);

      return () => {
        view.scrollDOM.removeEventListener('scroll', handleScroll);
        onViewChangeRef.current(null);
        view.destroy();
      };
      // 只在挂载时创建：文档模型实例与扩展配置在组件生命周期内不变
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

interface RenderPreviewProps {
  /** 是否正在渲染 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 预览滚动容器的 scroll 事件 */
  onScroll: () => void;
  /** 预览区的用户输入（滚轮、触摸、指针、键盘） */
  onUserInput: () => void;
}

/** RenderPreview 的公开句柄 */
interface RenderPreviewHandle {
  /** 滚动容器 */
  getScrollContainer: () => HTMLElement | null;
  /** 渲染管线挂载块的根元素 */
  getContentRoot: () => HTMLElement | null;
}

const RenderPreview = memo(
  forwardRef<RenderPreviewHandle, RenderPreviewProps>(
    ({ isLoading, error, onScroll, onUserInput }, ref) => {
      const containerRef = useRef<HTMLDivElement>(null);
      const contentRef = useRef<HTMLDivElement>(null);

      // 缩放状态 (百分比，如 100 表示 100%)
      const [zoom, setZoom] = useState(DEFAULT_ZOOM);

      // 缩放比例通过 CSS 变量传给样式表，字号计算在 module.scss 中完成；
      // 块尺寸变化由渲染管线的 ResizeObserver 感知并重新测量
      useLayoutEffect(() => {
        contentRef.current?.style.setProperty('--latex-preview-zoom', String(zoom / 100));
      }, [zoom]);

      const handleZoomIn = useCallback(() => {
        setZoom((prev) => ZOOM_LEVELS.find((level) => level > prev) ?? MAX_ZOOM);
      }, []);

      const handleZoomOut = useCallback(() => {
        setZoom((prev) => {
          const prevLevels = ZOOM_LEVELS.filter((level) => level < prev);
          return prevLevels.length > 0 ? prevLevels[prevLevels.length - 1] : MIN_ZOOM;
        });
      }, []);

      const handleZoomReset = useCallback(() => {
        setZoom(DEFAULT_ZOOM);
      }, []);

      // 滚轮：普通滚动视为用户输入；按住 Ctrl/Cmd 时缩放
      const handleWheel = useCallback(
        (e: React.WheelEvent) => {
          onUserInput();
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.deltaY < 0) {
              handleZoomIn();
            } else {
              handleZoomOut();
            }
          }
        },
        [handleZoomIn, handleZoomOut, onUserInput]
      );

      useImperativeHandle(ref, () => ({
        getScrollContainer: () => containerRef.current,
        getContentRoot: () => contentRef.current,
      }));

      return (
        <div
          ref={containerRef}
          className={`${styles.latexPreview} ${styles.syncScrolling}`}
          onScroll={onScroll}
          onWheel={handleWheel}
          onTouchStart={onUserInput}
          onPointerDown={onUserInput}
          onKeyDown={onUserInput}
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
          {error && (
            <div className={styles.latexPreviewError}>
              <AlertTriangle size={24} />
              <span>{error}</span>
            </div>
          )}
          {/* 子节点由渲染管线按块命令式管理，React 不渲染任何子元素 */}
          <div ref={contentRef} className={styles.latexPreviewContent} />
          {isLoading && (
            <div className={styles.latexPreviewLoading}>
              <Loader2 className={styles.latexPreviewSpinner} size={16} />
              <span>渲染中...</span>
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
}

const ViewModeToggle = memo<ViewModeToggleProps>(({ mode, onModeChange }) => {
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
  fileSize: number;
  isRendering: boolean;
  parseError: string | null;
  parseStatus: ParseStatus;
  diagnostics: DiagnosticCounts;
  onOpenDiagnostics: () => void;
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
  ({ fileSize, isRendering, parseError, parseStatus, diagnostics, onOpenDiagnostics }) => {
    const fileSizeType = getFileSizeType(fileSize);
    const diagnosticTotal = diagnostics.error + diagnostics.warning + diagnostics.info;
    return (
      <div className={styles.latexEditorHeaderRight}>
        {diagnosticTotal > 0 && (
          <button
            type="button"
            className={latexStyles.diagnosticSummary}
            onClick={onOpenDiagnostics}
            title="打开诊断面板（⌘⇧M），F8 跳到下一处"
            aria-label={`诊断：${diagnostics.error} 个错误，${diagnostics.warning} 个警告，${diagnostics.info} 条提示`}
          >
            {diagnostics.error > 0 && (
              <span className={latexStyles.diagnosticError}>
                <AlertCircle size={13} />
                {diagnostics.error}
              </span>
            )}
            {diagnostics.warning > 0 && (
              <span className={latexStyles.diagnosticWarning}>
                <AlertTriangle size={13} />
                {diagnostics.warning}
              </span>
            )}
            {diagnostics.info > 0 && (
              <span className={latexStyles.diagnosticInfo}>
                <Info size={13} />
                {diagnostics.info}
              </span>
            )}
          </button>
        )}

        {fileSize > 0 && (
          <div className={styles.latexFileSizeIndicator} title={`文件大小: ${formatFileSize(fileSize)}`}>
            <FileText size={14} />
            <span>{formatFileSize(fileSize)}</span>
          </div>
        )}

        {fileSizeType !== 'small' && (
          <div
            className={
              fileSizeType === 'huge' ? styles.latexHugeFileIndicator : styles.latexLargeFileIndicator
            }
          >
            <span>{fileSizeType === 'huge' ? '超大文件' : '大文件'}</span>
          </div>
        )}

        {isRendering && (
          <div className={styles.latexEditorStatus}>
            <Loader2 size={14} className={styles.latexEditorSpinner} />
            <span>渲染中...</span>
          </div>
        )}

        {parseError && (
          <div className={styles.latexEditorError} title={parseError}>
            <AlertTriangle size={14} />
            <span>错误</span>
          </div>
        )}

        {!isRendering && parseStatus.parseTime > 0 && (
          <div className={styles.latexEditorMeta}>
            <span title="最近一次增量解析耗时">{parseStatus.parseTime.toFixed(1)}ms</span>
            <span title="未重新解析的块占比">{(parseStatus.reuseRate * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>
    );
  }
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
  revealHeading = null,
  active = true,
}) => {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const activeRef = useRef(active);
  activeRef.current = active;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // 文档模型与增量引擎（每个编辑器实例独立，组件以文档为 key 挂载）
  const [latexDocument] = useState(() => new LatexDocument(normalizeLatexSource(initialContent)));
  const [initial] = useState(() => {
    const engine = new IncrementalLatexEngine();
    try {
      return { engine, status: toParseStatus(engine.update(latexDocument.getText())), error: null };
    } catch (error) {
      console.error('[LatexEditor] 初始解析失败:', error);
      const message = error instanceof Error ? error.message : String(error);
      return { engine, status: { parseTime: 0, reuseRate: 0 }, error: message };
    }
  });
  const { engine } = initial;

  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [fileSize, setFileSize] = useState(() => getFileSize(latexDocument.getText()));
  const [isRendering, setIsRendering] = useState(false);
  const [parseError, setParseError] = useState<string | null>(initial.error);
  const [parseStatus, setParseStatus] = useState<ParseStatus>(initial.status);
  const [diagnosticCounts, setDiagnosticCounts] = useState<DiagnosticCounts>(NO_DIAGNOSTICS);

  const sourceViewRef = useRef<EditorView | null>(null);
  /** 在仅预览模式下请求打开诊断面板：源码编辑器挂载后再打开 */
  const openDiagnosticsOnMountRef = useRef(false);
  const previewRef = useRef<RenderPreviewHandle>(null);
  const pipelineRef = useRef<RenderPipeline | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollLockRef = useRef(new ScrollSyncLock());
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  // ================================
  // 增量解析
  // ================================

  /**
   * 把文档模型的最新内容交给引擎；changes 为事务前坐标系的编辑
   */
  const runEngineUpdate = useCallback(
    (changes: readonly DocumentChange[]) => {
      try {
        setParseStatus(toParseStatus(engine.update(latexDocument.getText(), changes)));
        setParseError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[LatexEditor] 增量解析失败:', error);
        setParseError(message);
      }
    },
    [engine, latexDocument]
  );

  /** 把引擎的最新块交给渲染管线 */
  const refreshPreview = useCallback(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    setIsRendering(true);
    pipeline.applyUpdate(engine.getBlocks());
  }, [engine]);

  // ================================
  // 滚动同步
  // ================================

  const syncPreviewToSource = useCallback(() => {
    const view = sourceViewRef.current;
    const pipeline = pipelineRef.current;
    const scroller = previewRef.current?.getScrollContainer();
    if (!view || !pipeline || !scroller) return;

    const target = pipeline.heightMap.getPositionForLine(getTopVisibleLine(view));
    if (target !== null && Math.abs(scroller.scrollTop - target) >= 1) {
      scroller.scrollTop = target;
    }
  }, []);

  const syncSourceToPreview = useCallback(() => {
    const view = sourceViewRef.current;
    const pipeline = pipelineRef.current;
    const scroller = previewRef.current?.getScrollContainer();
    if (!view || !pipeline || !scroller) return;

    const line = pipeline.heightMap.getLineForPosition(scroller.scrollTop);
    if (line !== null) {
      scrollSourceToLine(view, line);
    }
  }, []);

  /** 统一入口：只在分栏模式下按滚动所有权决定同步方向 */
  const handleScrollEvent = useCallback(
    (event: ScrollSyncEvent) => {
      if (viewModeRef.current !== 'split') return;
      const action = scrollLockRef.current.decide(event, performance.now());
      if (action === 'sync-preview') syncPreviewToSource();
      else if (action === 'sync-source') syncSourceToPreview();
    },
    [syncPreviewToSource, syncSourceToPreview]
  );

  const handleSourceScroll = useCallback(() => handleScrollEvent('source-scroll'), [handleScrollEvent]);

  const handlePreviewInput = useCallback(() => handleScrollEvent('preview-input'), [handleScrollEvent]);

  const handlePreviewScroll = useCallback(() => {
    pipelineRef.current?.prioritizeViewport();
    handleScrollEvent('preview-scroll');
  }, [handleScrollEvent]);

  const handleSourceView = useCallback((view: EditorView | null) => {
    sourceViewRef.current = view;
    if (view && openDiagnosticsOnMountRef.current) {
      openDiagnosticsOnMountRef.current = false;
      openLintPanel(view);
    }
  }, []);

  // ================================
  // 诊断与章节定位
  // ================================

  const handleAnalysis = useCallback((analysis: LatexAnalysis) => {
    setDiagnosticCounts(countDiagnostics(analysis));
  }, []);

  const openDiagnostics = useCallback(() => {
    const view = sourceViewRef.current;
    if (view) {
      openLintPanel(view);
    } else {
      openDiagnosticsOnMountRef.current = true;
      setViewMode('split');
    }
  }, []);

  // 侧栏大纲点击章节：源码可见时定位光标并滚动（分栏模式下预览跟随同步），仅预览时滚动预览
  useEffect(() => {
    if (!revealHeading || revealedHeadingRequests.has(revealHeading)) return;
    let cancelled = false;
    const text = latexDocument.getText();
    void requestLatexAnalysis(text).then(({ outline }) => {
      if (cancelled) return;
      revealedHeadingRequests.add(revealHeading);
      const entry = outline[findHeadingIndex(outline, revealHeading.heading, revealHeading.occurrence)];
      if (!entry) return;

      const view = sourceViewRef.current;
      if (view) {
        const anchor = Math.min(entry.from, view.state.doc.length);
        view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'start', yMargin: 24 }) });
        view.focus();
        return;
      }
      const scroller = previewRef.current?.getScrollContainer();
      const line = text.slice(0, entry.from).split('\n').length;
      const target = pipelineRef.current?.heightMap.getPositionForLine(line);
      if (scroller && target != null) scroller.scrollTop = target;
    });
    return () => {
      cancelled = true;
    };
  }, [revealHeading, latexDocument]);

  // ================================
  // 渲染管线生命周期（预览挂载期间存在）
  // ================================

  const previewVisible = viewMode !== 'source';

  useEffect(() => {
    if (!previewVisible) return;
    const scrollContainer = previewRef.current?.getScrollContainer();
    const root = previewRef.current?.getContentRoot();
    if (!scrollContainer || !root) return;

    const pipeline = new RenderPipeline({
      scrollContainer,
      root,
      classNames: {
        block: latexStyles.previewBlock,
        pending: latexStyles.pendingBlock,
        anchor: latexStyles.blockAnchor,
      },
      renderSync: (block) => engine.renderBlock(block),
      renderBatch: engine.canRenderInBackground()
        ? (blocks) => engine.renderInBackground(blocks)
        : undefined,
      onLayout: () => handleScrollEvent('preview-layout'),
      onIdle: () => setIsRendering(false),
    });
    pipelineRef.current = pipeline;
    refreshPreview();

    return () => {
      pipeline.destroy();
      pipelineRef.current = null;
      setIsRendering(false);
    };
  }, [previewVisible, engine, handleScrollEvent, refreshPreview]);

  // ================================
  // 用户编辑
  // ================================

  const handleDocumentChange = useCallback(
    (changes: DocumentChange[]) => {
      const content = latexDocument.getText();
      onChangeRef.current?.(content);
      getEditorBridge().notifyContentChange();
      runEngineUpdate(changes);

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        setFileSize(getFileSize(latexDocument.getText()));
        refreshPreview();
      }, debounceMs);
    },
    [latexDocument, runEngineUpdate, refreshPreview, debounceMs]
  );

  // 卸载：释放定时器与引擎 Worker
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      engine.destroy();
    };
  }, [engine]);

  // ================================
  // 插件编辑器桥接：读写作用于源码编辑器（行列号从 1 计）；仅预览时只能读取
  // ================================

  const bridgeEditorRef = useRef<EditorInstance | null>(null);

  useEffect(() => {
    const editableView = (): EditorView => {
      const view = sourceViewRef.current;
      if (!view) throw new Error('LaTeX 文档处于预览视图，请切换到源码或分栏后再修改');
      if (readOnlyRef.current) throw new Error('文档为只读');
      return view;
    };
    const instance: EditorInstance = {
      language: 'latex',
      getContent: () => sourceViewRef.current?.state.doc.toString() ?? latexDocument.getText(),
      setContent(content) {
        const view = editableView();
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
      },
      getSelection() {
        const view = sourceViewRef.current;
        if (!view) return '';
        const { from, to } = view.state.selection.main;
        return view.state.sliceDoc(from, to);
      },
      replaceSelection(text) {
        const view = editableView();
        view.dispatch(view.state.replaceSelection(text));
      },
      insertText(text) {
        const view = editableView();
        const at = view.state.selection.main.head;
        view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
      },
      getCursorPosition() {
        const view = sourceViewRef.current;
        if (!view) return { line: 1, column: 1 };
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        return { line: line.number, column: head - line.from + 1 };
      },
      setCursorPosition(line, column) {
        const view = editableView();
        const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
        view.dispatch({ selection: { anchor: Math.min(target.from + Math.max(column - 1, 0), target.to) } });
      },
      focus: () => sourceViewRef.current?.focus(),
    };
    const registration = getEditorBridge().registerEditor(instance, activeRef.current);
    bridgeEditorRef.current = instance;
    return () => {
      registration.dispose();
      bridgeEditorRef.current = null;
    };
  }, [latexDocument]);

  useEffect(() => {
    if (active && bridgeEditorRef.current) getEditorBridge().activate(bridgeEditorRef.current);
  }, [active]);

  // ================================
  // 布局
  // ================================

  const containerClassName = useMemo(() => {
    const classes = [styles.latexEditorContainer, className];
    if (viewMode === 'split') {
      classes.push(styles.latexEditorSplit);
    }
    return classes.filter(Boolean).join(' ');
  }, [className, viewMode]);

  // 源码与预览面板保持固定的树位置：切换视图模式时 CodeMirror 不会重建（不丢焦点、不丢撤销历史），
  // 预览在“预览/分栏”之间切换时渲染管线也不会重建
  return (
    <div className={containerClassName}>
      <div className={styles.latexEditorHeader}>
        <ViewModeToggle mode={viewMode} onModeChange={setViewMode} />
        <StatusIndicators
          fileSize={fileSize}
          isRendering={isRendering}
          parseError={parseError}
          parseStatus={parseStatus}
          diagnostics={diagnosticCounts}
          onOpenDiagnostics={openDiagnostics}
        />
      </div>

      <div className={styles.latexEditorMain}>
        {viewMode !== 'render' && (
          <div className={viewMode === 'split' ? styles.latexEditorPaneLeft : styles.latexEditorPane}>
            <SourceEditor
              document={latexDocument}
              onDocumentChange={handleDocumentChange}
              onScroll={handleSourceScroll}
              onViewChange={handleSourceView}
              onAnalysis={handleAnalysis}
              readOnly={readOnly}
              showLineNumbers={showLineNumbers}
            />
          </div>
        )}
        {viewMode === 'split' && <div className={styles.latexEditorDivider} />}
        {viewMode !== 'source' && (
          <div className={viewMode === 'split' ? styles.latexEditorPaneRight : styles.latexEditorPane}>
            <RenderPreview
              ref={previewRef}
              isLoading={isRendering}
              error={parseError}
              onScroll={handlePreviewScroll}
              onUserInput={handlePreviewInput}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default LatexEditor;
