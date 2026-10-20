// ================================
// 搜索命中摘要：按高亮边界（shared/search-highlight）拆成文字与高亮片段，只以文本节点渲染
// ================================

import React from 'react';
import { splitHighlights } from '../../../shared/search-highlight';
import styles from './Snippet.module.scss';

export interface SnippetProps {
  snippet: string;
  /** 替换默认样式（列表行的字号、行数不同） */
  className?: string;
}

export const Snippet: React.FC<SnippetProps> = ({ snippet, className }) => (
  <div className={className ?? styles.snippet}>
    {splitHighlights(snippet.replace(/\s+/g, ' ').trim()).map((segment, index) =>
      segment.highlight ? <mark key={index}>{segment.text}</mark> : <React.Fragment key={index}>{segment.text}</React.Fragment>
    )}
  </div>
);
