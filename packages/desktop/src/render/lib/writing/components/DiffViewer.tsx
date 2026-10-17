// ================================
// DiffViewer 组件
// 可复用的差分查看组件，用于可视化文本差异
// ================================

import React, { useMemo, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { useContentDiff } from '../useWritingService';
import type { DiffStats } from '@code-reader/diff-algorithm';
import { diffsToLines, type Diff, type DiffLine } from './diff-lines';
import styles from './DiffViewer.module.scss';

// ================================
// 类型定义
// ================================

export type DiffViewMode = 'inline' | 'split' | 'unified';

export interface DiffViewerProps {
  /** 源文本 */
  source: string;
  /** 目标文本 */
  target: string;
  /** 视图模式 */
  mode?: DiffViewMode;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 是否显示统计信息 */
  showStats?: boolean;
  /** 是否折叠未更改的行 */
  collapseUnchanged?: boolean;
  /** 折叠阈值（连续未更改行数） */
  collapseThreshold?: number;
  /** 是否启用语法高亮（预留） */
  syntaxHighlight?: boolean;
  /** 语言类型（预留） */
  language?: string;
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 标题 - 源 */
  sourceTitle?: string;
  /** 标题 - 目标 */
  targetTitle?: string;
  /** 差分计算完成回调 */
  onDiffComputed?: (stats: DiffStats) => void;
}

export interface DiffViewerHandle {
  /** 刷新差分计算 */
  refresh: () => Promise<void>;
  /** 获取当前差分统计 */
  getStats: () => DiffStats | null;
  /** 滚动到第一个变更 */
  scrollToFirstChange: () => void;
}

// ================================
// 辅助类型
// ================================

interface CollapsedLine {
  type: 'collapsed';
  count: number;
  startIndex: number;
}

type DisplayLine = DiffLine | CollapsedLine;

// ================================
// 辅助函数
// ================================

/**
 * 折叠连续的未更改行
 */
function collapseEqualLines(lines: DiffLine[], threshold: number): DisplayLine[] {
  if (threshold <= 0) return lines;

  const result: DisplayLine[] = [];
  let equalCount = 0;
  let equalStart = -1;

  const flushEquals = () => {
    if (equalCount > threshold) {
      // 保留前2行和后2行，折叠中间部分
      const contextLines = 2;
      const collapsedCount = equalCount - contextLines * 2;

      if (collapsedCount > 0) {
        for (let i = 0; i < contextLines; i++) {
          result.push(lines[equalStart + i]);
        }
        result.push({
          type: 'collapsed',
          count: collapsedCount,
          startIndex: equalStart + contextLines,
        });
        for (let i = 0; i < contextLines; i++) {
          result.push(lines[equalStart + equalCount - contextLines + i]);
        }
      } else {
        for (let i = 0; i < equalCount; i++) {
          result.push(lines[equalStart + i]);
        }
      }
    } else {
      for (let i = 0; i < equalCount; i++) {
        result.push(lines[equalStart + i]);
      }
    }
    equalCount = 0;
    equalStart = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type === 'equal') {
      if (equalStart === -1) {
        equalStart = i;
      }
      equalCount++;
    } else {
      if (equalCount > 0) {
        flushEquals();
      }
      result.push(line);
    }
  }

  if (equalCount > 0) {
    flushEquals();
  }

  return result;
}

/** 渲染一行的片段：只高亮实际发生变化的部分 */
function renderSegments(line: DiffLine): React.ReactNode {
  const changedClassName = line.type === 'insert' ? styles.textInsert : styles.textDelete;
  return line.segments.map((segment, index) =>
    segment.changed ? (
      <span key={index} className={changedClassName}>
        {segment.text}
      </span>
    ) : (
      <React.Fragment key={index}>{segment.text}</React.Fragment>
    )
  );
}

// ================================
// 加载动画组件
// ================================

const Spinner: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={styles.spinner}
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

// ================================
// DiffViewer 组件
// ================================

export const DiffViewer = forwardRef<DiffViewerHandle, DiffViewerProps>(
  (
    {
      source,
      target,
      mode: initialMode = 'inline',
      showLineNumbers = true,
      showStats = true,
      collapseUnchanged = true,
      collapseThreshold = 10,
      className = '',
      style,
      sourceTitle = '原始版本',
      targetTitle = '修改版本',
      onDiffComputed,
    },
    ref
  ) => {
    const [mode, setMode] = useState<DiffViewMode>(initialMode);
    const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

    // 使用差分 Hook
    const { compare, lastDiff, lastStats, isComputing, isInitialized } = useContentDiff();

    // 当源/目标文本变更时计算差分
    React.useEffect(() => {
      if (isInitialized && source !== undefined && target !== undefined) {
        compare(source, target).then((result) => {
          if (result?.stats) {
            onDiffComputed?.(result.stats);
          }
        });
      }
    }, [source, target, isInitialized, compare, onDiffComputed]);

    // 将差分转换为行
    const diffLines = useMemo(() => {
      if (!lastDiff?.diffs) return [];
      return diffsToLines(lastDiff.diffs as readonly Diff[]);
    }, [lastDiff]);

    // 应用折叠
    const displayLines = useMemo(() => {
      if (!collapseUnchanged) return diffLines;
      return collapseEqualLines(diffLines, collapseThreshold);
    }, [diffLines, collapseUnchanged, collapseThreshold]);

    // 检查是否有变更
    const hasChanges = useMemo(() => {
      return diffLines.some((line) => line.type !== 'equal');
    }, [diffLines]);

    // 暴露命令式方法
    useImperativeHandle(ref, () => ({
      refresh: async () => {
        await compare(source, target);
      },
      getStats: () => lastStats,
      scrollToFirstChange: () => {
        // 滚动到第一个变更的实现
      },
    }));

    // 切换折叠区域
    const toggleCollapsed = useCallback((index: number) => {
      setExpandedSections((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
    }, []);

    // 获取行的类名
    const getLineClassName = useCallback((type: 'insert' | 'delete' | 'equal') => {
      switch (type) {
        case 'insert':
          return styles.lineInsert;
        case 'delete':
          return styles.lineDelete;
        default:
          return styles.lineEqual;
      }
    }, []);

    // 渲染行
    const renderInlineLine = useCallback(
      (line: DisplayLine, index: number): React.ReactNode => {
        if (line.type === 'collapsed') {
          if (expandedSections.has(line.startIndex)) {
            // 渲染展开的行
            const expandedLines = diffLines.slice(line.startIndex, line.startIndex + line.count);
            return (
              <React.Fragment key={`collapsed-${index}`}>
                {expandedLines.map((l, i) => renderInlineLine(l, index * 1000 + i))}
                <div
                  className={styles.collapsedSection}
                  onClick={() => toggleCollapsed(line.startIndex)}
                >
                  ▲ 收起 {line.count} 行未更改内容
                </div>
              </React.Fragment>
            );
          }

          return (
            <div
              key={`collapsed-${index}`}
              className={styles.collapsedSection}
              onClick={() => toggleCollapsed(line.startIndex)}
            >
              ▼ 展开 {line.count} 行未更改内容
            </div>
          );
        }

        const lineClassName = `${styles.inlineLine} ${getLineClassName(line.type)}`;
        const lineNum = line.type === 'delete' ? line.sourceLineNum : line.targetLineNum;
        const prefix = line.type === 'insert' ? '+ ' : line.type === 'delete' ? '- ' : '  ';

        return (
          <div key={`line-${index}`} className={lineClassName}>
            {showLineNumbers && <div className={styles.lineNumber}>{lineNum}</div>}
            <div className={styles.lineContent}>
              {prefix}
              {renderSegments(line)}
            </div>
          </div>
        );
      },
      [showLineNumbers, expandedSections, diffLines, toggleCollapsed, getLineClassName]
    );

    // 渲染分栏视图
    const renderSplitView = useCallback(() => {
      const sourceLines = diffLines.filter((l) => l.type !== 'insert');
      const targetLines = diffLines.filter((l) => l.type !== 'delete');

      return (
        <div className={styles.splitContainer}>
          <div className={`${styles.splitPane} ${styles.left}`}>
            <div className={styles.splitHeader}>{sourceTitle}</div>
            <div className={styles.inlineContent}>
              {sourceLines.map((line, index) => (
                <div
                  key={`source-${index}`}
                  className={`${styles.inlineLine} ${getLineClassName(line.type)}`}
                >
                  {showLineNumbers && <div className={styles.lineNumber}>{line.sourceLineNum}</div>}
                  <div className={styles.lineContent}>{renderSegments(line)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.splitPane}>
            <div className={styles.splitHeader}>{targetTitle}</div>
            <div className={styles.inlineContent}>
              {targetLines.map((line, index) => (
                <div
                  key={`target-${index}`}
                  className={`${styles.inlineLine} ${getLineClassName(line.type)}`}
                >
                  {showLineNumbers && <div className={styles.lineNumber}>{line.targetLineNum}</div>}
                  <div className={styles.lineContent}>{renderSegments(line)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }, [diffLines, showLineNumbers, sourceTitle, targetTitle, getLineClassName]);

    // 根据模式渲染内容
    const renderContent = useCallback(() => {
      if (isComputing) {
        return (
          <div className={styles.loading}>
            <Spinner />
            <span>正在计算差异...</span>
          </div>
        );
      }

      if (!lastDiff) {
        return <div className={styles.empty}>请输入要比较的文本</div>;
      }

      if (!hasChanges) {
        return (
          <div className={styles.noChanges}>
            <div>✓</div>
            <div>未发现差异</div>
          </div>
        );
      }

      if (mode === 'split') {
        return renderSplitView();
      }

      return (
        <div className={styles.inlineContent}>
          {displayLines.map((line, index) => renderInlineLine(line, index))}
        </div>
      );
    }, [isComputing, lastDiff, hasChanges, mode, displayLines, renderInlineLine, renderSplitView]);

    // 模式按钮类名
    const getModeBtnClassName = (m: DiffViewMode) => {
      return `${styles.modeButton} ${mode === m ? styles.active : ''}`;
    };

    return (
      <div style={style} className={`${styles.container} ${className}`}>
        {/* 头部 */}
        <div className={styles.header}>
          <span className={styles.headerTitle}>差异对比</span>
          <div className={styles.headerControls}>
            <button className={getModeBtnClassName('inline')} onClick={() => setMode('inline')}>
              行内
            </button>
            <button className={getModeBtnClassName('split')} onClick={() => setMode('split')}>
              分栏
            </button>
          </div>
        </div>

        {/* 统计栏 */}
        {showStats && lastStats && (
          <div className={styles.statsBar}>
            <div className={`${styles.statItem} ${styles.statInsert}`}>
              <span>+{lastStats.insertions}</span>
              <span>新增</span>
            </div>
            <div className={`${styles.statItem} ${styles.statDelete}`}>
              <span>-{lastStats.deletions}</span>
              <span>删除</span>
            </div>
            <div className={styles.statItem}>
              <span>{lastStats.unchanged}</span>
              <span>未更改</span>
            </div>
            {lastStats.changeRatio !== undefined && (
              <div className={styles.statItem}>
                <span>{(lastStats.changeRatio * 100).toFixed(1)}%</span>
                <span>变更率</span>
              </div>
            )}
          </div>
        )}

        {/* 内容区域 */}
        <div className={styles.content}>{renderContent()}</div>
      </div>
    );
  }
);

export default DiffViewer;
