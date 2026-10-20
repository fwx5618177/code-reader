import { describe, expect, it } from 'vitest';
import { filterAndSortItems } from '@code-reader/autocomplete-service-extras';
import { LaTeXCompletionProvider } from '../latex-completion';
import { ALL_SYMBOLS } from '../../math';

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

  it('\\ 后有非空白内容才激活', () => {
    expect(provider.shouldActivate({ trigger: '\\', query: '' })).toBe(false);
    expect(provider.shouldActivate({ trigger: '\\', query: 'al pha' })).toBe(false);
    expect(provider.shouldActivate({ trigger: '\\', query: 'al' })).toBe(true);
  });
});
