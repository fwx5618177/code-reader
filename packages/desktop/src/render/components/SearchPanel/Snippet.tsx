// ================================
// 搜索命中摘要：<mark> 片段以高亮文本渲染（不使用 innerHTML）
// ================================

import React from 'react';
import { splitHighlights } from './search-results';
import styles from './Snippet.module.scss';

export const Snippet: React.FC<{ snippet: string }> = ({ snippet }) => (
  <div className={styles.snippet}>
    {splitHighlights(snippet).map((segment, index) =>
      segment.highlight ? (
        <mark key={index}>{segment.text}</mark>
      ) : (
        <React.Fragment key={index}>{segment.text}</React.Fragment>
      )
    )}
  </div>
);
