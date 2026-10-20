import { describe, it, expect } from 'vitest';
import { LatexParser } from '../parser';
import { LatexRenderer } from '../renderer';

/** 解析前言并只渲染标题块 */
function renderTitle(preambleSource: string): HTMLElement {
  const { ast } = new LatexParser(`${preambleSource}\n\\begin{document}\\maketitle\\end{document}`).parse();
  const renderer = new LatexRenderer();
  const host = document.createElement('div');
  host.innerHTML = renderer.renderLatexBlock({ kind: 'preamble', nodes: [] }, ast.preamble);
  return host;
}

describe('LatexRenderer 标题块', () => {
  it('\\and 拆分为多位作者，不再原样显示命令', () => {
    const host = renderTitle(String.raw`\title{论文}\author{甲 \and 乙 \and 丙}`);
    const authors = [...host.querySelectorAll('.latex-author')].map((el) => el.textContent);
    expect(authors).toEqual(['甲', '乙', '丙']);
    expect(host.textContent).not.toContain('\\and');
  });

  it('作者内的 \\\\ 换行与 \\thanks 脚注：换行保留、脚注去掉', () => {
    const host = renderTitle(String.raw`\author{Alice\thanks{Funded by \emph{X}} \\ MIT \and Bob}`);
    const authors = host.querySelectorAll('.latex-author');
    expect(authors).toHaveLength(2);
    expect(authors[0].querySelector('br')).not.toBeNull();
    expect(authors[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('Alice MIT');
    expect(host.textContent).not.toContain('Funded');
    expect(authors[1].textContent).toBe('Bob');
  });

  it('标题参数含嵌套花括号命令时完整读取并渲染格式', () => {
    const host = renderTitle(String.raw`\title{Paper on \textbf{Things}}`);
    const title = host.querySelector('.latex-title')!;
    expect(title.textContent).toBe('Paper on Things');
    expect(title.querySelector('strong')?.textContent).toBe('Things');
  });

  it('被注释的 \\author 行不生效；\\today 转为日期', () => {
    const host = renderTitle(String.raw`% \author{旧作者}
\author{新作者}
\date{\today}`);
    expect(host.querySelector('.latex-author')?.textContent).toBe('新作者');
    expect(host.querySelector('.latex-date')?.textContent).toBe(new Date().toLocaleDateString('zh-CN'));
  });

  it('作者里的 HTML 特殊字符被转义', () => {
    const host = renderTitle(String.raw`\author{<b>x</b> \and y}`);
    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('.latex-author')?.textContent).toBe('<b>x</b>');
  });

  it('标题里的重音与符号命令转为字符', () => {
    const host = renderTitle(String.raw`\title{Caf\'e \& \LaTeX{}}\author{Jos\'e Garc\'{\i}a}`);
    expect(host.querySelector('.latex-title')?.textContent).toBe('Café & LaTeX');
    expect(host.querySelector('.latex-author')?.textContent).toBe('José García');
  });
});

/** 渲染正文（与增量引擎一致：解析后逐个顶层节点渲染） */
function renderBody(body: string, preamble = ''): HTMLElement {
  const { ast } = new LatexParser(`${preamble}\n\\begin{document}\n${body}\n\\end{document}`).parse();
  const renderer = new LatexRenderer();
  renderer.setPreamble(ast.preamble);
  const host = document.createElement('div');
  host.innerHTML = renderer.renderLatexBlock({ kind: 'body', nodes: ast.document!.children }, ast.preamble);
  return host;
}

describe('LatexRenderer 文本模式符号', () => {
  it('转义字符、符号命令与重音', () => {
    const host = renderBody(String.raw`50\% \& \$5 \#1 a\_b \{x\} \ldots{} \textbackslash{} Stra\ss e \ae\o\AA{} \c{c}\'e\"o\^a\~n\`a \copyright\ \dag\S\P\textdegree`);
    expect(host.textContent?.trim()).toBe('50% & $5 #1 a_b {x} … \\ Straße æøÅ çéöâñà © †§¶°');
    expect(host.querySelector('.latex-unknown-command')).toBeNull();
  });

  it('破折号、引号、~ 与标志', () => {
    const host = renderBody("pages 1--2, a---b, ``quote'' Dr.~X \\TeX\\ and \\LaTeX");
    expect(host.textContent?.trim()).toBe('pages 1–2, a—b, “quote” Dr.\u00A0X TeX and LaTeX');
  });

  it('希腊字母等数学命令按行内公式渲染', () => {
    const host = renderBody(String.raw`angle \alpha here`);
    expect(host.querySelector('.latex-math-inline')).not.toBeNull();
    expect(host.querySelector('.latex-unknown-command')).toBeNull();
  });

  it('未识别的命令连同参数原样保留并标出', () => {
    const host = renderBody(String.raw`before \foo[opt]{bar} after`);
    const unknown = host.querySelector('.latex-unknown-command')!;
    expect(unknown.textContent).toBe('\\foo[opt]{bar}');
    expect(unknown.getAttribute('title')).toBe('未识别的命令 \\foo');
    expect(host.textContent?.trim()).toBe('before \\foo[opt]{bar} after');
  });

  it('列表项（原文路径）与正文使用同一套命令渲染', () => {
    const host = renderBody(String.raw`\begin{itemize}
\item Caf\'e \textbf{bold {nested}} \& \unknownthing{x}
\end{itemize}`);
    const item = host.querySelector('li')!;
    expect(item.textContent?.trim()).toBe('Café bold nested & \\unknownthing{x}');
    expect(item.querySelector('strong')?.textContent).toBe('bold nested');
    expect(item.querySelector('.latex-unknown-command')?.textContent).toBe('\\unknownthing{x}');
  });

  it('嵌套的同名列表：子列表的 \\item 与 \\end 归子列表，不会提前闭合外层', () => {
    const host = renderBody(String.raw`\begin{enumerate}
\item outer one
\item outer two:
  \begin{enumerate}
  \item inner a
  \item inner b
  \end{enumerate}
\item outer three
\end{enumerate}
after`);
    const outer = host.querySelector('ol')!;
    expect([...outer.children].filter((el) => el.tagName === 'LI')).toHaveLength(3);
    expect([...outer.querySelector('li > ol')!.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual(['inner a', 'inner b']);
    expect(host.querySelector('.latex-unknown-command')).toBeNull();
    expect(host.textContent).toContain('after');
  });

  it('\\par 不再误匹配 \\paragraph 等前缀相同的命令', () => {
    const host = renderBody(String.raw`\begin{itemize}
\item a \parbox{x} b
\end{itemize}`);
    expect(host.querySelector('li .latex-unknown-command')?.textContent).toBe('\\parbox{x}');
  });

  it('符号命令之后的空行仍是段落分隔', () => {
    const host = renderBody('First \\LaTeX\n\nSecond');
    expect([...host.querySelectorAll('p')].map((p) => p.textContent?.trim())).toEqual(['First LaTeX', 'Second']);
  });

  it('宏展开后按 LaTeX 渲染；自引用的宏不会无限展开', () => {
    const host = renderBody(
      String.raw`\name{} and \hi{Bob} and \loop`,
      String.raw`\newcommand{\name}{\textbf{Jos\'e}}
\newcommand{\hi}[1]{Hello #1}
\newcommand{\loop}{\loop}`
    );
    expect(host.querySelector('strong')?.textContent).toBe('José');
    expect(host.textContent).toContain('Hello Bob');
    expect(host.querySelector('.latex-unknown-command')?.textContent).toBe('\\loop');
  });
});
