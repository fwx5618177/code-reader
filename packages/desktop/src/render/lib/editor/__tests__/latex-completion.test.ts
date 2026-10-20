import { describe, expect, it } from 'vitest';
import { filterAndSortItems, type EditorCompletionContext } from '@code-reader/autocomplete-service-extras';
import { LaTeXCompletionProvider, matchLatexCommands } from '../latex-completion';
import { ALL_SYMBOLS } from '../../math';
import { LatexParser } from '../../latex/parser';
import { LatexRenderer } from '../../latex/renderer';

const provider = new LaTeXCompletionProvider();
/** 与补全插件一致：提供者已匹配，插件按优先级排序 */
const complete = (query: string) => {
  const items = provider.getCompletions({ query });
  return filterAndSortItems(items, query, Infinity, new Set(items));
};

describe('LaTeXCompletionProvider', () => {
  it('完全相同 > 前缀 > 包含，同档内常用命令在前', () => {
    const labels = complete('in').map((item) => item.label);
    expect(labels[0]).toBe('\\in');
    expect(labels.indexOf('\\int')).toBeLessThan(labels.indexOf('\\sin'));
    expect(labels.indexOf('\\infty')).toBeLessThan(labels.indexOf('\\liminf'));
  });

  it('常用命令带模板与中文说明，符号预览取自渲染器的符号表', () => {
    expect(complete('frac')[0]).toMatchObject({ label: '\\frac{}{}', insertText: '\\frac{}{} ', detail: '分数' });
    expect(complete('partial')[0]).toMatchObject({ detail: `偏导 ${ALL_SYMBOLS.partial}` });
    expect(complete('alpha')[0]).toMatchObject({ insertText: '\\alpha ', detail: 'α' });
  });

  it('渲染器认识但不在常用表里的命令也能补全', () => {
    expect(complete('hbar').map((item) => item.label)).toContain('\\hbar');
    expect(complete('varnothing')[0]).toMatchObject({ detail: ALL_SYMBOLS.varnothing });
    expect(complete('gcd')[0]).toMatchObject({ label: '\\gcd', detail: '函数' });
    expect(complete('widehat')[0]).toMatchObject({ label: '\\widehat{}', insertText: '\\widehat{} ' });
    expect(complete('lfloor').map((item) => item.label)).toEqual(expect.arrayContaining(['\\lfloor \\rfloor', '\\lfloor']));
  });

  it('每个命令只出现一次', () => {
    const labels = complete('a').map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('\\ 后是字母才激活', () => {
    expect(provider.shouldActivate({ trigger: '\\', query: '' })).toBe(false);
    expect(provider.shouldActivate({ trigger: '\\', query: 'al pha' })).toBe(false);
    expect(provider.shouldActivate({ trigger: '\\', query: 'frac{' })).toBe(false);
    expect(provider.shouldActivate({ trigger: '\\', query: 'al' })).toBe(true);
  });

  it('Markdown 正文：\\ 在行首、空白后或未闭合的 $ 之内才激活', () => {
    const body = new LaTeXCompletionProvider({ markdownBody: true });
    /** textBefore 以 \\查询 结尾 */
    const at = (textBefore: string): EditorCompletionContext => {
      const index = textBefore.lastIndexOf('\\');
      const query = textBefore.slice(index + 1);
      return { trigger: '\\', query, textBefore, lineText: textBefore, pos: 0, from: index, to: textBefore.length };
    };
    expect(body.shouldActivate(at('\\al'))).toBe(true);
    expect(body.shouldActivate(at('公式 \\al'))).toBe(true);
    expect(body.shouldActivate(at('$x+\\al'))).toBe(true);
    expect(body.shouldActivate(at('$$a=b+\\al'))).toBe(true);
    expect(body.shouldActivate(at('价格 \\$5 x\\al'))).toBe(false);
    expect(body.shouldActivate(at('$a$ 与 b\\al'))).toBe(false);
    expect(body.shouldActivate(at('C:\\Users'))).toBe(false);
    expect(body.shouldActivate(at('$a \\\\al'))).toBe(false);
  });

  it('document 范围：正文命令与环境在前，另含文本符号；math 范围没有正文命令', () => {
    const rank = (scope: 'math' | 'document', query: string) => {
      const matched = matchLatexCommands(scope, query);
      return filterAndSortItems(matched, query, Infinity, new Set(matched));
    };
    expect(rank('document', 'sect')[0]).toMatchObject({ label: '\\section{}', detail: '节' });
    expect(rank('document', 'item')[0]!.label).toBe('\\item');
    expect(rank('document', 'begin').map((item) => item.label)).toContain('\\begin{itemize}');
    expect(rank('document', 'begin').find((item) => item.label === '\\begin{itemize}')!.insertText).toBe(
      '\\begin{itemize}\n  \\item \n\\end{itemize}'
    );
    expect(rank('document', 'copyright')[0]).toMatchObject({ label: '\\copyright', detail: '© 文本' });
    // 公式命令在 document 范围里同样可用
    expect(rank('document', 'frac')[0]!.label).toBe('\\frac{}{}');
    expect(rank('math', 'section')).toHaveLength(0);
  });

  it('document 范围列出的正文命令都是 .tex 渲染器认识的（不会被标为未识别命令）', () => {
    const labels = matchLatexCommands('document', '')
      .map((item) => item.label)
      .filter((label) => !label.startsWith('\\begin') && !matchLatexCommands('math', label.slice(1)).some((m) => m.label === label));
    // 标题、宏包、文档类写在导言区，其余写在正文
    const preambleOnly = new Set(['\\title{}', '\\author{}', '\\date{}', '\\usepackage{}', '\\documentclass{}']);
    const body = labels
      .filter((label) => !preambleOnly.has(label))
      .map((label) => label.replace(/\{\}/g, '{x}'))
      // \item 只在列表环境里有意义
      .map((label) => (label === '\\item' ? '\\begin{itemize}\n\\item x\n\\end{itemize}' : label))
      .join('\n\n');
    const { ast } = new LatexParser(`\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`).parse();
    const renderer = new LatexRenderer();
    const host = document.createElement('div');
    host.innerHTML = renderer.renderLatexBlock({ kind: 'body', nodes: ast.document!.children }, ast.preamble);
    const unknown = Array.from(host.querySelectorAll('.latex-unknown-command')).map((el) => el.textContent);
    expect(unknown).toEqual([]);
  });
});
