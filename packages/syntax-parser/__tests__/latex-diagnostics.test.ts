// ================================
// LaTeX 语法诊断：错误位置、行列号与常见误报场景
// ================================

import { describe, it, expect } from 'vitest';
import { LatexLezerParser, tokenizeLatex } from '../src/index';

function problems(input: string) {
  const result = new LatexLezerParser().parse(input);
  return {
    errors: result.errors.map((e) => ({ message: e.message, text: input.slice(e.from, e.to), line: e.line, column: e.column })),
    warnings: result.warnings,
  };
}

describe('LaTeX 语法诊断', () => {
  it('未闭合的环境标在 \\begin{name} 上', () => {
    const { errors } = problems('intro\n\\begin{itemize}\n\\item a\n');
    expect(errors).toEqual([{ message: '缺少 \\end{itemize}', text: '\\begin{itemize}', line: 2, column: 0 }]);
  });

  it('结束标记写错时报不匹配，并标在 \\end 上', () => {
    const { errors } = problems('\\begin{itemize}\\item a\\end{enumerate}');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe('\\begin{itemize} 与 \\end{enumerate} 不匹配');
    expect(errors[0]!.text).toBe('\\end{enumerate}');
  });

  it('内层环境漏写结束标记时不吞掉外层的 \\end', () => {
    const { errors } = problems('\\begin{figure}\\begin{center}x\\end{figure}');
    expect(errors.map((e) => e.message)).toEqual(['缺少 \\end{center}']);
  });

  it('多余的 }、\\end 与 \\) 都会报告', () => {
    expect(problems('abc } def').errors.map((e) => e.text)).toEqual(['}']);
    expect(problems('text \\end{figure} more').errors[0]!.text).toBe('\\end{figure}');
    expect(problems('text \\) more').errors[0]!.text).toBe('\\)');
  });

  it('未闭合的花括号标在左花括号上', () => {
    const { errors } = problems('\\textbf{abc\n\nmore');
    expect(errors).toEqual([{ message: '缺少右花括号 }', text: '{', line: 1, column: 7 }]);
  });

  it('缺少 $ 的行内公式在段落结束处截断，不影响后文', () => {
    const { errors } = problems('a $x+1\n\nb $y$ c');
    expect(errors).toEqual([{ message: '公式缺少结束分隔符 $', text: '$', line: 1, column: 2 }]);
  });

  it('分组内未闭合的公式在分组的 } 处结束，后文的公式不错位', () => {
    const { errors } = problems('{a $b} text $x$ and\n$$ y $$');
    expect(errors).toEqual([{ message: '公式缺少结束分隔符 $', text: '$', line: 1, column: 3 }]);
  });

  it('标签键里的 $ 不影响下一行的行间公式', () => {
    expect(problems('\\label{e$xtra} text\n$$ x^2 $$\n').errors).toEqual([]);
  });

  it('公式内部的花括号分组照常配对', () => {
    expect(problems('\\textbf{see $\\frac{a}{b}$ here}').errors).toEqual([]);
  });

  it('未闭合的公式不吞掉外层环境的 \\end', () => {
    const { errors } = problems('\\begin{document}\n内容 $x+1\n\\end{document}');
    expect(errors.map((e) => e.message)).toEqual(['公式缺少结束分隔符 $']);
  });

  it('公式环境内多余的 $ 报错且不会卡死', () => {
    expect(problems('\\( a $ \\)').errors.map((e) => e.message)).toEqual(['公式中出现多余的 $']);
    expect(problems('\\begin{equation} a $ b \\end{equation}').errors).toHaveLength(1);
  });

  it('控制符号、行分隔、矩阵环境不误报', () => {
    expect(problems('a\\,b\\;c\\|d\\ e \\$ \\{ \\%').errors).toEqual([]);
    expect(problems('\\begin{tabular}{cc} a & b \\\\[2pt] c & d \\\\ \\end{tabular}').errors).toEqual([]);
    expect(problems('$\\begin{pmatrix} a \\end{pmatrix}$').errors).toEqual([]);
    expect(problems('\\begin{align} a &= b \\\\ c \\end{align}').errors).toEqual([]);
  });

  it('原样输出环境、\\verb 与 \\url 的内容不参与语法检查', () => {
    expect(problems('\\begin{verbatim}\n{ $ \\begin{x}\n\\end{verbatim}').errors).toEqual([]);
    expect(problems('\\begin{lstlisting}[language=C]\nint main() { $\n\\end{lstlisting}').errors).toEqual([]);
    expect(problems('\\verb|$x{| fine').errors).toEqual([]);
    expect(problems('see \\url{http://a.com/%20_x}.').errors).toEqual([]);
    expect(problems('\\verb|abc\nxyz').errors[0]!.message).toContain('\\verb');
  });

  it('宏定义体中不成对的环境不报错', () => {
    const source =
      '\\newcommand{\\foo}[1]{\\begin{center}#1}\\newenvironment{x}{\\begin{center}}{\\end{center}}';
    expect(problems(source).errors).toEqual([]);
  });

  it('无参环境后紧跟的分组属于环境内容', () => {
    expect(problems('\\begin{center}{\\bf x} y\\end{center}').errors).toEqual([]);
  });
});

describe('LaTeX 词法位置', () => {
  it('Token 记录起始行列（行列均从 0 计）', () => {
    const tokens = tokenizeLatex('a\n\n\\section{b}');
    const section = tokens.find((t) => t.value === 'section')!;
    expect(section.line).toBe(2);
    expect(section.column).toBe(0);
  });
});
