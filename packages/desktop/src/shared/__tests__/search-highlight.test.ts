import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_END, HIGHLIGHT_START, highlight, splitHighlights } from '../search-highlight';

describe('搜索摘要的高亮边界', () => {
  it('按私用区边界拆成文字与高亮片段，正文里的 <mark> 只是文字', () => {
    expect(splitHighlights(`前${highlight('命中')}后 <mark>原文</mark>${highlight('再次')}`)).toEqual([
      { text: '前', highlight: false },
      { text: '命中', highlight: true },
      { text: '后 <mark>原文</mark>', highlight: false },
      { text: '再次', highlight: true },
    ]);
  });

  it('没有高亮、空高亮与不成对的边界', () => {
    expect(splitHighlights('普通文字')).toEqual([{ text: '普通文字', highlight: false }]);
    expect(splitHighlights(`a${HIGHLIGHT_START}${HIGHLIGHT_END}b`)).toEqual([
      { text: 'a', highlight: false },
      { text: 'b', highlight: false },
    ]);
    expect(splitHighlights(`截断${HIGHLIGHT_START}半个`)).toEqual([{ text: '截断半个', highlight: false }]);
    expect(splitHighlights('')).toEqual([]);
  });
});
