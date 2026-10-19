// ================================
// 按内容识别格式：代码块、行内代码、公式里贴的 LaTeX 源码不让 Markdown 被误判为 LaTeX
// ================================

import { describe, expect, it } from 'vitest';
import { autoParse, isLaTeXDocument, isMarkdownDocument, ParseMode } from '../src';

describe('isLaTeXDocument', () => {
  it('完整的 LaTeX 文档', () => {
    expect(isLaTeXDocument('\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n')).toBe(true);
    expect(isLaTeXDocument('% 注释\n\\documentclass[12pt]{report}\n')).toBe(true);
  });

  it('没有 \\documentclass 的 LaTeX 片段', () => {
    expect(isLaTeXDocument('\\section{引言}\n正文 $x^2$。\n\\subsection*{背景}\n')).toBe(true);
    expect(isLaTeXDocument('\\begin{equation}\n  E = mc^2\n\\end{equation}\n')).toBe(true);
  });

  it('Markdown 的围栏代码块、行内代码、块级公式里的 LaTeX 不算', () => {
    const fenced = '# 笔记\n\n```latex\n\\documentclass{article}\n\\section{x}\n```\n';
    expect(isLaTeXDocument(fenced)).toBe(false);
    expect(isLaTeXDocument('用 `\\documentclass{article}` 开头。\n')).toBe(false);
    expect(isLaTeXDocument('$$\n\\begin{align}a&=b\\end{align}\n$$\n')).toBe(false);
  });

  it('有 Markdown 结构时，行首的章节命令不足以判为 LaTeX', () => {
    expect(isLaTeXDocument('# 标题\n\n\\section{x} 是 LaTeX 的章节命令\n')).toBe(false);
    expect(isLaTeXDocument('参见 [[另一篇]]\n\\section{x}\n')).toBe(false);
  });

  it('注释掉的标记不算', () => {
    expect(isLaTeXDocument('% \\documentclass{article}\n普通文字\n')).toBe(false);
  });

  it('未闭合的围栏代码块一直到文末都不参与判断', () => {
    expect(isLaTeXDocument('# 草稿\n\n```\n\\documentclass{article}\n')).toBe(false);
  });
});

describe('isMarkdownDocument', () => {
  it('识别标题、列表、链接、双链与代码块', () => {
    expect(isMarkdownDocument('# 标题')).toBe(true);
    expect(isMarkdownDocument('- 一项')).toBe(true);
    expect(isMarkdownDocument('见 [文档](a.md)')).toBe(true);
    expect(isMarkdownDocument('见 [[笔记]]')).toBe(true);
    expect(isMarkdownDocument('```js\nx\n```')).toBe(true);
    expect(isMarkdownDocument('一段普通文字。')).toBe(false);
  });
});

describe('autoParse', () => {
  it('LaTeX 文档走 LaTeX 解析，Markdown 走 CommonMark', () => {
    expect(autoParse('\\documentclass{article}\n\\begin{document}\n\\section{A}\n\\end{document}\n').mode).toBe(
      ParseMode.LaTeX
    );
    const markdown = autoParse('# 标题\n\n```tex\n\\section{x}\n```\n');
    expect(markdown.mode).toBe(ParseMode.CommonMark);
    expect(markdown.commonmark?.document.children?.length).toBeGreaterThan(0);
  });
});
