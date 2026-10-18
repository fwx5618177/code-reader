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
});
