import { describe, it, expect } from 'vitest';
import { findBodyRange, scanBlock, countNewlines } from '../block-segmenter';

/** 把整段正文切成块，返回每块源码 */
function segment(text: string): string[] {
  const { bodyStart, bodyEnd } = findBodyRange(text);
  const blocks: string[] = [];
  let pos = bodyStart;
  while (pos < bodyEnd) {
    const { end } = scanBlock(text, pos, bodyEnd);
    expect(end).toBeGreaterThan(pos);
    blocks.push(text.slice(pos, end));
    pos = end;
  }
  return blocks;
}

describe('findBodyRange', () => {
  it('定位 document 环境内的正文', () => {
    const text = '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n';
    const range = findBodyRange(text);
    expect(text.slice(range.bodyStart, range.bodyEnd)).toBe('\nHello\n');
  });

  it('没有 document 环境时整篇都是正文', () => {
    expect(findBodyRange('a\n\nb')).toEqual({ bodyStart: 0, bodyEnd: 4 });
  });
});

describe('scanBlock', () => {
  it('按空行分段，空行并入前一块，块首尾相接', () => {
    expect(segment('第一段\n第一段续\n\n\n第二段\n')).toEqual(['第一段\n第一段续\n\n\n', '第二段\n']);
  });

  it('环境内部的空行不切分，环境独立成块', () => {
    const text = '前文\n\\begin{itemize}\n\\item a\n\n\\item b\n\\end{itemize}\n后文\n';
    expect(segment(text)).toEqual([
      '前文\n',
      '\\begin{itemize}\n\\item a\n\n\\item b\n\\end{itemize}\n',
      '后文\n',
    ]);
  });

  it('同名嵌套环境匹配到最外层的 \\end', () => {
    const text = '\\begin{itemize}\n\\item \\begin{itemize}\n\\item x\n\n\\end{itemize}\n\\end{itemize}\nz\n';
    expect(segment(text)[0]).toBe(
      '\\begin{itemize}\n\\item \\begin{itemize}\n\\item x\n\n\\end{itemize}\n\\end{itemize}\n'
    );
  });

  it('章节命令独占一块，块级公式独立成块', () => {
    const text = '\\section{A}\n正文\n$$\nx\n\n$$\n\\[ y \\]\n尾\n';
    expect(segment(text)).toEqual(['\\section{A}\n', '正文\n', '$$\nx\n\n$$\n', '\\[ y \\]\n', '尾\n']);
  });

  it('段落行内开启的跨行环境不会被其中的空行切断', () => {
    const text = '文字 \\begin{center}\n甲\n\n乙\n\\end{center} 收尾\n\n下一段\n';
    expect(segment(text)).toEqual(['文字 \\begin{center}\n甲\n\n乙\n\\end{center} 收尾\n\n', '下一段\n']);
  });

  it('未闭合的 \\begin 不吞并后续文档，并标记 unmatched', () => {
    const text = '\\begin{equation}\nx = 1\n\n后续段落\n\n再一段\n';
    const first = scanBlock(text, 0, text.length);
    expect(first.unmatched).toBe(true);
    expect(text.slice(0, first.end)).toBe('\\begin{equation}\nx = 1\n\n');
    expect(segment(text)).toHaveLength(3);
  });

  it('注释中的 \\begin 不参与配对', () => {
    const text = 'a % \\begin{itemize}\n\nb\n';
    expect(segment(text)).toEqual(['a % \\begin{itemize}\n\n', 'b\n']);
  });
});

describe('countNewlines', () => {
  it('只统计区间内的换行', () => {
    expect(countNewlines('a\nb\nc\n', 0, 6)).toBe(3);
    expect(countNewlines('a\nb\nc\n', 2, 4)).toBe(1);
  });
});
