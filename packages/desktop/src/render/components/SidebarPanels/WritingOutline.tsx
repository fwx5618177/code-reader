// ================================
// 写作大纲：当前文档的标题层级，点击在编辑器中定位到该标题
// ================================

import React, { useDeferredValue, useMemo } from 'react';
import { extractHeadings, headingOccurrence } from '../../lib/markdown';
import { PanelEmpty } from './PanelEmpty';
import styles from './WritingOutline.module.scss';

export interface WritingOutlineProps {
  /** 当前文档的 Markdown 内容 */
  content: string;
  /** occurrence：该标题在同名标题中的序号（从 0 计），用于区分重名标题 */
  onSelectHeading: (heading: string, occurrence: number) => void;
}

export const WritingOutline: React.FC<WritingOutlineProps> = ({ content, onSelectHeading }) => {
  // 输入时延迟解析，长文档逐键编辑不被大纲重算阻塞
  const deferredContent = useDeferredValue(content);
  const headings = useMemo(() => extractHeadings(deferredContent), [deferredContent]);
  const minLevel = useMemo(() => headings.reduce((min, heading) => Math.min(min, heading.level), 6), [headings]);

  if (headings.length === 0) return <PanelEmpty>文档中还没有标题。以 # 开头的行会出现在这里</PanelEmpty>;
  return (
    <nav className={styles.outline} aria-label="文档大纲">
      {headings.map((heading, index) => (
        <button
          key={`${heading.line}-${heading.text}`}
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
