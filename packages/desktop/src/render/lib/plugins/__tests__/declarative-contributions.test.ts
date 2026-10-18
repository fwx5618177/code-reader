// ================================
// 声明式贡献：插件主题只覆盖允许的颜色变量；插件语言注册为代码块语言并随停用移除
// ================================

import { describe, expect, it } from 'vitest';
import { getLanguageDefinition, getLanguageOptions } from '../../editor/languages';
import { syncPluginLanguages } from '../languages';
import { applyPluginThemeColors, isColorValue } from '../themes';

describe('插件主题', () => {
  it('颜色字面量校验：拒绝 url()、var() 与表达式', () => {
    for (const ok of ['#fff', '#f4ecd8', '#11223344', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(30 20% 90%)', 'hsl(30, 20%, 90%)']) {
      expect(isColorValue(ok), ok).toBe(true);
    }
    for (const bad of ['url(x)', 'var(--x)', 'red; background: url(x)', 'expression(alert(1))', '#ggg', '']) {
      expect(isColorValue(bad), bad).toBe(false);
    }
  });

  it('只覆盖允许的颜色变量', () => {
    const root = document.createElement('div');
    applyPluginThemeColors({ '--bg-primary': '#f4ecd8', '--font-family': '#000', '--text-primary': 'url(x)' }, root);
    expect(root.style.getPropertyValue('--bg-primary')).toBe('#f4ecd8');
    expect(root.style.getPropertyValue('--font-family')).toBe('');
    expect(root.style.getPropertyValue('--text-primary')).toBe('');
  });
});

describe('插件语言', () => {
  it('注册为代码块语言、按指定语法高亮；不覆盖内置别名；撤下后移除', () => {
    syncPluginLanguages([{ id: 'dataview', name: 'Dataview', aliases: ['dv', 'js'], extensions: [], grammar: 'sql' }]);
    expect(getLanguageDefinition('dataview')?.name).toBe('Dataview');
    expect(getLanguageDefinition('dv')?.id).toBe('dataview');
    expect(getLanguageDefinition('js')?.id).not.toBe('dataview');
    expect(getLanguageOptions().some((option) => option.value === 'dataview')).toBe(true);
    expect(getLanguageDefinition('dataview')!.create()).toBeTruthy();

    syncPluginLanguages([]);
    expect(getLanguageDefinition('dataview')?.id).not.toBe('dataview');
    expect(getLanguageOptions().some((option) => option.value === 'dataview')).toBe(false);
  });
});
