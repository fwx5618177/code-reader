// ================================
// LaTeX 解析器：文档结构、元数据、位置与交叉引用索引
// ================================

import { describe, it, expect } from 'vitest';
import { parseLaTeX, LaTeXBlockType, LaTeXInlineType } from '../src/latex';
import type { CrossReferenceEntry, LaTeXBlockNode, LaTeXNode } from '../src/latex';

/** 按条目位置截取源码，验证位置是绝对且精确的 */
function textOf(source: string, entry: CrossReferenceEntry): string {
  return source.slice(entry.position.startOffset, entry.position.endOffset);
}

function blockTypes(blocks: LaTeXBlockNode[]): string[] {
  return blocks.map((block) => block.type);
}

const ARTICLE = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath}
\newtheorem{remark}{注}[section]
\title{My Paper}
\author{Alice \and Bob}
\date{2026}

\begin{document}
\maketitle
\begin{abstract}
Short abstract.
\end{abstract}

\section{Intro}\label{sec:intro}
See \ref{sec:intro}, \eqref{eq:one} and \cref{fig:a, thm:x}. Cite \cite{knuth, lamport} and \citep[p.~3]{nobody}.

\begin{equation}\label{eq:one}
  x = 1
\end{equation}

\begin{align}
  a &= b \label{eq:a} \\
  c &= d \label{eq:c}
\end{align}

\[ e = mc^2 \label{eq:display} \]

\begin{figure}
  \caption{Uses \ref{eq:a}}\label{fig:a}
\end{figure}

\begin{theorem}\label{thm:x}
  Text with an inline \label{inline:y}.
\end{theorem}

\begin{thebibliography}{9}
\bibitem{knuth} D. Knuth.
\bibitem[L]{lamport} L. Lamport.
\end{thebibliography}
\end{document}
`;

describe('LaTeX 文档结构', () => {
  it('导言区之后的正文完整解析（不被导言区命令或 \\end{abstract} 截断）', () => {
    const { document } = parseLaTeX(ARTICLE);
    expect(document.documentClass).toEqual({ name: 'article', options: ['11pt'] });
    expect(blockTypes(document.children)).toEqual([LaTeXBlockType.Abstract, LaTeXBlockType.Section]);
    expect(document.preamble.map((item) => item.command)).toContain('\\newtheorem');
  });

  it('提取标题、作者与日期', () => {
    expect(parseLaTeX(ARTICLE).document.metadata).toEqual({
      title: 'My Paper',
      author: ['Alice', 'Bob'],
      date: '2026',
    });
  });

  it('没有 \\begin{document} 的片段整体作为正文解析', () => {
    const { document, crossReferences } = parseLaTeX('\\section{A}\\label{a}\nSee \\ref{a}.');
    expect(blockTypes(document.children)).toEqual([LaTeXBlockType.Section]);
    expect(crossReferences.labels.map((entry) => entry.key)).toEqual(['a']);
  });

  it('正文中多余的 \\end 只记警告，后续内容继续解析', () => {
    const { document, warnings } = parseLaTeX('\\begin{document}\nA\n\\end{itemize}\n\\section{B}\n\\end{document}');
    expect(warnings.some((warning) => warning.message.includes('多余的'))).toBe(true);
    expect(document.children.some((block) => block.type === LaTeXBlockType.Section)).toBe(true);
  });

  it('\\[ ... \\] 解析为行间公式', () => {
    const { document } = parseLaTeX('\\[ x^2 \\]');
    expect(document.children[0]).toMatchObject({ type: LaTeXBlockType.MathBlock, environment: '\\[', content: 'x^2' });
  });

  it('参数保留原文（标题中的行内公式不丢失 $）', () => {
    const { document } = parseLaTeX('\\section{About $x$}');
    const section = document.children[0];
    expect(section?.type).toBe(LaTeXBlockType.Section);
    const title = section && 'title' in section ? (section.title as LaTeXNode[]) : [];
    expect(title.some((node) => node.type === LaTeXInlineType.MathInline)).toBe(true);
  });
});

describe('LaTeX 节点位置', () => {
  it('行内节点的范围恰好覆盖其源码', () => {
    const source = 'See \\ref{a} and $x+1$.';
    const paragraph = parseLaTeX(source).document.children[0];
    const children = paragraph && 'children' in paragraph ? (paragraph.children as LaTeXNode[]) : [];
    const reference = children.find((node) => node.type === LaTeXInlineType.Reference)!;
    const math = children.find((node) => node.type === LaTeXInlineType.MathInline)!;
    expect(source.slice(reference.position.startOffset, reference.position.endOffset)).toBe('\\ref{a}');
    expect(source.slice(math.position.startOffset, math.position.endOffset)).toBe('$x+1$');
    expect(math.raw).toBe('$x+1$');
  });

  it('章节标题中的节点使用整篇文档的绝对位置', () => {
    const source = 'intro\n\n\\section{Title \\ref{z}}';
    const { crossReferences } = parseLaTeX(source);
    const [reference] = crossReferences.references;
    expect(reference && textOf(source, reference)).toBe('z');
    expect(reference?.position.startLine).toBe(3);
  });
});

describe('LaTeX 交叉引用索引', () => {
  const { crossReferences } = parseLaTeX(ARTICLE);

  it('收集所有位置的 \\label（章节、公式、多行公式、行间公式、图、定理、行内）', () => {
    expect(crossReferences.labels.map((entry) => entry.key)).toEqual([
      'sec:intro',
      'eq:one',
      'eq:a',
      'eq:c',
      'eq:display',
      'fig:a',
      'thm:x',
      'inline:y',
    ]);
    for (const entry of crossReferences.labels) {
      expect(textOf(ARTICLE, entry)).toBe(entry.key);
    }
  });

  it('收集引用，多标签的 \\cref 拆为多条，图题中的引用也被收集', () => {
    expect(crossReferences.references.map((entry) => `${entry.command}:${entry.key}`)).toEqual([
      'ref:sec:intro',
      'eqref:eq:one',
      'cref:fig:a',
      'cref:thm:x',
      'ref:eq:a',
    ]);
    for (const entry of crossReferences.references) {
      expect(textOf(ARTICLE, entry)).toBe(entry.key);
    }
  });

  it('文献引用按键拆分并定位到每个键', () => {
    expect(crossReferences.citations.map((entry) => `${entry.command}:${entry.key}`)).toEqual([
      'cite:knuth',
      'cite:lamport',
      'citep:nobody',
    ]);
    for (const entry of crossReferences.citations) {
      expect(textOf(ARTICLE, entry)).toBe(entry.key);
    }
  });

  it('收集 \\bibitem 键（含可选标签的写法）', () => {
    expect(crossReferences.bibItems.map((entry) => entry.key)).toEqual(['knuth', 'lamport']);
    expect(textOf(ARTICLE, crossReferences.bibItems[1]!)).toBe('lamport');
  });

  it('收集外部文献库与引入的文件', () => {
    const result = parseLaTeX(
      '\\documentclass{article}\n\\addbibresource{refs.bib}\n\\begin{document}\n\\input{chapter1}\n\\bibliography{a, b}\n\\end{document}'
    );
    expect(result.crossReferences.bibliographySources).toEqual(['refs.bib', 'a', 'b']);
    expect(result.crossReferences.includedFiles).toEqual(['chapter1']);
  });
});
