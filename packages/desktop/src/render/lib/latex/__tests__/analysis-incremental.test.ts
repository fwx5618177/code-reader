// ================================
// 按块增量分析：与整篇分析结果一致（诊断、折叠、大纲、标题信息），只重新分析改动的块
// ================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LatexAnalyzer, analyzeLatex } from '../analysis';

const example = (name: string) => readFileSync(resolve(__dirname, `../../../../../assets/examples/${name}.tex`), 'utf8');

/** 含交叉引用、文献、语法问题与多级章节的文档 */
const REFERENCE_DOC = String.raw`\documentclass{article}
\title{Caf\'e \textbf{Report}}
\author{Alice \and Bob}
\begin{document}
\maketitle

\section{Intro}\label{sec:intro}
See Section~\ref{sec:method} and \ref{sec:missing}. Cite \cite{knuth} and \cite{nobody}.

\subsection{Background}
Text with braces {grouped} here.

\begin{itemize}
\item one
\item two \label{item:two}
\end{itemize}

\section{Method}\label{sec:method}
$$ a + b $$
\begin{equation}\label{eq:main}
E = mc^2
\end{equation}
Equation \eqref{eq:main}.

\begin{thebibliography}{9}
\bibitem{knuth} Knuth.
\bibitem{unused} Unused.
\bibitem{knuth} Duplicate.
\end{thebibliography}
\end{document}
`;

function expectSame(source: string, analyzer = new LatexAnalyzer()) {
  const incremental = analyzer.analyze(source);
  expect(incremental).toEqual(analyzeLatex(source));
  return analyzer;
}

/** 可复现的伪随机数 */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const RISKY_SNIPPETS = ['x', ' ', '\n', '\n\n', '{', '}', '$', '\\ref{sec:intro}', '\\begin{itemize}', '\\end{itemize}', '\\item ', '\\[', '\\]', '%'];
/** 在行首插入、不破坏结构的编辑（持续保留，文档一直处于可增量分析的状态） */
const SAFE_LINES = [
  'Plain words here.\n',
  '\n',
  'See \\ref{sec:intro} and \\cite{knuth}.\n',
  '\\label{extra} text\n',
  '\\section{Added}\n',
  '\\subsection{Added sub}\n',
  '\\begin{itemize}\n\\item a\n\\end{itemize}\n',
  '$$ x^2 $$\n',
  'Ref to \\ref{nowhere}.\n',
];

/** large-document 的正文重复多次（单个 document 环境） */
function largeDocument(times: number): string {
  const source = example('large-document');
  const begin = source.indexOf('\\begin{document}') + '\\begin{document}'.length;
  const end = source.indexOf('\\end{document}');
  return source.slice(0, begin) + source.slice(begin, end).repeat(times) + source.slice(end);
}

describe('LatexAnalyzer 按块增量分析', () => {
  it.each(['sample', 'large-document'])('示例文档 %s：与整篇分析一致，未改动时全部复用', (name) => {
    const source = example(name);
    const analyzer = expectSame(source);
    expect(analyzer.lastRun.fallback).toBe(false);
    analyzer.analyze(source);
    expect(analyzer.lastRun.reused).toBe(analyzer.lastRun.blocks);
  });

  it('document 环境标记不止一对（huge-document 末尾有第二个 \\end{document}）时回退整篇', () => {
    const analyzer = expectSame(example('huge-document'));
    expect(analyzer.lastRun.fallback).toBe(true);
  });

  it('交叉引用、文献与语法问题跨块合并后与整篇一致', () => {
    const analyzer = expectSame(REFERENCE_DOC);
    expect(analyzer.lastRun.fallback).toBe(false);
    const messages = analyzer.analyze(REFERENCE_DOC).diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes('sec:missing'))).toBe(true);
    expect(messages.some((m) => m.includes('nobody'))).toBe(true);
    expect(messages.some((m) => m.includes('sec:method'))).toBe(false);
  });

  it('只重新分析改动的块', () => {
    const source = largeDocument(6);
    const analyzer = new LatexAnalyzer();
    analyzer.analyze(source);
    const at = source.indexOf('\\section', source.length / 2);
    const edited = source.slice(0, at) + 'Edited paragraph.\n\n' + source.slice(at);
    expectSame(edited, analyzer);
    expect(analyzer.lastRun.fallback).toBe(false);
    expect(analyzer.lastRun.blocks - analyzer.lastRun.reused).toBe(1);
  });

  it('块内有语法错误时回退整篇：跨段落配对的花括号不误报', () => {
    const analyzer = new LatexAnalyzer();
    const source = REFERENCE_DOC.replace('Text with braces {grouped} here.', 'Open { here.\n\nClose } here.');
    expect(expectSame(source, analyzer).lastRun.fallback).toBe(true);
    expect(analyzer.analyze(source).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('未闭合环境或缺少 \\end{document} 时回退整篇分析', () => {
    const analyzer = new LatexAnalyzer();
    expectSame(REFERENCE_DOC.replace('\\end{itemize}', ''), analyzer);
    expect(analyzer.lastRun.fallback).toBe(true);
    expectSame(REFERENCE_DOC.replace('\\end{document}', ''), analyzer);
    expect(analyzer.lastRun.fallback).toBe(true);
  });

  it('没有 document 环境的片段同样一致', () => {
    expectSame(String.raw`\section{A}\label{a}
Text \ref{a} \ref{b}.

\subsection{B}
More.`);
  });

  it('随机编辑序列：每一步都与整篇分析一致', () => {
    const next = random(20261018);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    const analyzer = new LatexAnalyzer();
    let source = REFERENCE_DOC;
    let incremental = 0;
    for (let step = 0; step < 300; step++) {
      let candidate: string;
      if (next() < 0.6) {
        // 持续编辑：在正文段落边界（空行之后）插入完整的一行
        const bodyStart = source.indexOf('\\maketitle');
        const bodyEnd = source.indexOf('\\end{document}');
        const lines = [...source.matchAll(/\n\n/g)].map((m) => m.index! + 2).filter((i) => i > bodyStart && i < bodyEnd);
        const at = pick(lines);
        source = source.slice(0, at) + pick(SAFE_LINES) + source.slice(at);
        candidate = source;
      } else {
        // 临时编辑（输入到一半、随后修正）：任意位置插入或删除，不保留
        const at = Math.floor(next() * (source.length + 1));
        candidate =
          next() < 0.4
            ? source.slice(0, at) + source.slice(at + Math.floor(next() * 12))
            : source.slice(0, at) + pick(RISKY_SNIPPETS) + source.slice(at);
      }
      expect(analyzer.analyze(candidate), `第 ${step} 步`).toEqual(analyzeLatex(candidate));
      if (!analyzer.lastRun.fallback) incremental++;
    }
    // 确保随机序列确实覆盖了增量路径，而不是全部回退
    expect(incremental).toBeGreaterThan(150);
  });
});
