// ================================
// 写作大纲：当前文档的标题层级，点击在编辑器中定位到该标题
// Markdown 取 # 标题；LaTeX 取 \part … \subparagraph 章节命令（经文档分析 Worker 解析）
// ================================

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { extractHeadings, headingOccurrence } from '../../lib/markdown';
import type { LatexAnalysis } from '../../lib/latex/analysis';
import { requestLatexAnalysis } from '../../lib/latex/analysis-client';
import { PanelEmpty } from './PanelEmpty';
import styles from './WritingOutline.module.scss';

export interface WritingOutlineProps {
  /** 当前文档内容 */
  content: string;
  /** 当前文档的标识；提供时逐键输入只重新解析改动附近的块（增量解析） */
  documentId?: string;
  /** occurrence：该标题在同名标题中的序号（从 0 计），用于区分重名标题 */
  onSelectHeading: (heading: string, occurrence: number) => void;
}

interface OutlineListProps {
  headings: ReadonlyArray<{ text: string; level: number }>;
  onSelectHeading: WritingOutlineProps['onSelectHeading'];
  /** 列表上方的文档信息 */
  header?: React.ReactNode;
}

const OutlineList: React.FC<OutlineListProps> = ({ headings, onSelectHeading, header }) => {
  const minLevel = useMemo(
    () => headings.reduce((min, heading) => Math.min(min, heading.level), Infinity),
    [headings]
  );
  return (
    <nav className={styles.outline} aria-label="文档大纲">
      {header}
      {headings.map((heading, index) => (
        <button
          key={`${index}-${heading.text}`}
          type="button"
          className={styles.heading}
          style={{ '--outline-depth': heading.level - minLevel } as React.CSSProperties}
          onClick={() => onSelectHeading(heading.text, headingOccurrence(headings, index))}
          title={heading.text}
        >
          {heading.text || '（空标题）'}
        </button>
      ))}
    </nav>
  );
};

export const WritingOutline: React.FC<WritingOutlineProps> = ({ content, documentId, onSelectHeading }) => {
  // 输入时延迟解析，长文档逐键编辑不被大纲重算阻塞
  const deferredContent = useDeferredValue(content);
  const headings = useMemo(() => extractHeadings(deferredContent, documentId), [deferredContent, documentId]);

  if (headings.length === 0) return <PanelEmpty>文档中还没有标题。以 # 开头的行会出现在这里</PanelEmpty>;
  return <OutlineList headings={headings} onSelectHeading={onSelectHeading} />;
};

/** 停止输入多久后重新分析（与编辑器诊断一致，同一内容只分析一次） */
const LATEX_OUTLINE_DELAY_MS = 400;

export const LatexOutline: React.FC<WritingOutlineProps> = ({ content, onSelectHeading }) => {
  const [analysis, setAnalysis] = useState<LatexAnalysis | null>(null);
  // 首次立即分析，之后等停止输入再分析
  const hasAnalysis = analysis !== null;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void requestLatexAnalysis(content).then((result) => {
          if (!cancelled) setAnalysis(result);
        });
      },
      hasAnalysis ? LATEX_OUTLINE_DELAY_MS : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, hasAnalysis]);

  if (!analysis) return null;
  const { outline, info } = analysis;
  const header =
    info.title || info.authors.length > 0 ? (
      <div className={styles.documentInfo}>
        {info.title && <div className={styles.documentTitle}>{info.title}</div>}
        {info.authors.length > 0 && <div className={styles.documentAuthors}>{info.authors.join('、')}</div>}
      </div>
    ) : undefined;

  if (outline.length === 0) {
    return <PanelEmpty>文档中还没有章节。\section{'{…}'} 等章节命令会出现在这里</PanelEmpty>;
  }
  return <OutlineList headings={outline} onSelectHeading={onSelectHeading} header={header} />;
};
