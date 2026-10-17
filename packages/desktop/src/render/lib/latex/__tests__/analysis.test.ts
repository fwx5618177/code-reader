import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { analyzeLatex } from '../analysis';
import { requestLatexAnalysis } from '../analysis-client';

const DOC = String.raw`\documentclass{article}
\title{Paper on \textbf{Things}}
\author{Alice \and Bob}
\begin{document}
\section{Intro}\label{sec:intro}
See \ref{sec:intro} and \ref{missing}. Cite \cite{knuth,ghost}.
\begin{itemize}
  \item one
  \item two
\end{itemize}
\subsection{Detail}
Text \label{unused}
\section{Second}
\begin{equation}\label{dup}
x
\end{equation}
\begin{equation}\label{dup}
y
\end{equation}
\begin{thebibliography}{9}
\bibitem{knuth} K.
\bibitem{spare} S.
\end{thebibliography}
\end{document}
`;

describe('analyzeLatex', () => {
  const analysis = analyzeLatex(DOC);
  const messages = (severity: string) =>
    analysis.diagnostics.filter((d) => d.severity === severity).map((d) => `${DOC.slice(d.from, d.to)}|${d.message}`);

  it('交叉引用：未定义引用、找不到的文献、重复标签为警告', () => {
    expect(messages('warning')).toEqual([
      'missing|未定义的引用 \\ref{missing}',
      'ghost|找不到文献「ghost」：文档中没有对应的 \\bibitem',
      'dup|标签「dup」重复定义',
    ]);
  });

  it('交叉引用：未被引用的标签与文献条目为提示', () => {
    expect(messages('info')).toEqual([
      'unused|标签「unused」未被引用',
      'dup|标签「dup」未被引用',
      'spare|文献条目「spare」未被引用',
    ]);
  });

  it('语法错误与交叉引用合并为同一份诊断，按位置排序', () => {
    const source = '\\begin{itemize}\n\\item \\ref{nowhere}\n';
    const { diagnostics } = analyzeLatex(source);
    expect(diagnostics.map((d) => [d.source, d.severity, source.slice(d.from, d.to)])).toEqual([
      ['syntax', 'error', '\\begin{itemize}'],
      ['reference', 'warning', 'nowhere'],
    ]);
  });

  it('引入其他文件或使用外部文献库时不判断未定义与未引用', () => {
    const { diagnostics } = analyzeLatex('\\input{defs}\n\\ref{elsewhere} \\label{local}\n\\bibliography{refs}\\cite{x}');
    expect(diagnostics).toEqual([]);
  });

  it('大纲：章节层级、纯文本标题与位置', () => {
    expect(analysis.outline.map((entry) => [entry.level, entry.text, DOC.startsWith('\\', entry.from)])).toEqual([
      [2, 'Intro', true],
      [3, 'Detail', true],
      [2, 'Second', true],
    ]);
  });

  it('文档信息：标题与作者为纯文本', () => {
    expect(analysis.info).toEqual({ title: 'Paper on Things', authors: ['Alice', 'Bob'] });
  });

  it('折叠：多行环境折叠到 \\end 之前，章节折叠到下一个同级章节之前', () => {
    const folded = analysis.folds.map((fold) => DOC.slice(fold.from, fold.to));
    const itemize = folded.find((text) => text.trimStart().startsWith('\\item one'))!;
    expect(itemize.trim()).toBe('\\item one\n  \\item two');
    const intro = folded.find((text) => text.includes('\\subsection{Detail}'))!;
    expect(intro).not.toContain('\\section{Second}');
    expect(intro.trimEnd()).toBe(intro);
    const second = folded.find((text) => text.includes('\\bibitem{spare}') && !text.includes('\\subsection'))!;
    expect(second).not.toContain('\\end{document}');
    expect(analysis.folds.every((fold, i, all) => i === 0 || all[i - 1]!.from <= fold.from)).toBe(true);
  });

  it('客户端合并同一内容的并发请求并缓存结果（无 Worker 时主线程分析）', async () => {
    const first = requestLatexAnalysis(DOC);
    expect(requestLatexAnalysis(DOC)).toBe(first);
    const result = await first;
    expect(result.outline).toHaveLength(3);
    expect(await requestLatexAnalysis(DOC)).toBe(result);
  });

  it('示例大文档：无语法误报且分析足够快', () => {
    const huge = readFileSync(resolve(__dirname, '../../../../../assets/examples/huge-document.tex'), 'utf8');
    const start = performance.now();
    const result = analyzeLatex(huge);
    const elapsed = performance.now() - start;
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.outline.length).toBeGreaterThan(10);
    expect(elapsed).toBeLessThan(500);
  });
});
