// ================================
// LaTeX 语言配置：编辑器适配层（桌面端 CodeMirror）直接按这些字段生成注释、自动配对与缩进行为
// ================================

import { describe, expect, it } from 'vitest';
import { LATEX_LANGUAGE_CONFIGURATION } from '../src';

describe('LATEX_LANGUAGE_CONFIGURATION', () => {
  it('行注释为 %，自动配对包含 { [ ( $', () => {
    expect(LATEX_LANGUAGE_CONFIGURATION.lineComment).toBe('%');
    const opens = LATEX_LANGUAGE_CONFIGURATION.autoClosingPairs?.map((pair) => pair.open);
    expect(opens).toEqual(expect.arrayContaining(['{', '[', '(', '$']));
  });

  it('缩进规则匹配环境的开始与结束，document 环境除外', () => {
    const increase = new RegExp(LATEX_LANGUAGE_CONFIGURATION.indentationRules!.increaseIndentPattern!);
    const decrease = new RegExp(LATEX_LANGUAGE_CONFIGURATION.indentationRules!.decreaseIndentPattern!);
    expect(increase.test('\\begin{itemize}')).toBe(true);
    expect(increase.test('\\begin{align*}')).toBe(true);
    expect(increase.test('\\begin{document}')).toBe(false);
    expect(decrease.test('\\end{itemize}')).toBe(true);
    expect(decrease.test('\\end{document}')).toBe(false);
  });

  it('单词定义包含命令前的反斜杠与 @', () => {
    const word = new RegExp(`^${LATEX_LANGUAGE_CONFIGURATION.wordPattern}$`);
    expect(word.test('\\makeatletter')).toBe(true);
    expect(word.test('\\@ifnextchar')).toBe(true);
    expect(word.test('section')).toBe(true);
  });
});
