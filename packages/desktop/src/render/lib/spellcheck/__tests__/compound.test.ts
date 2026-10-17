// ================================
// Hunspell 复合词测试：COMPOUNDRULE（* / ? 量词、括号标记、long / num FLAG）、COMPOUNDMIN、ONLYINCOMPOUND，
// 以及 COMPOUNDFLAG 与 COMPOUNDRULE 共用同一切分流程。
// 用例仿照 Hunspell 官方测试 tests/compoundrule*.aff/.dic 的 good / wrong 词表
// ================================

import { describe, it, expect } from 'vitest';
import { Hunspell } from '../hunspell';
import { parseAffix, parseCompoundRule } from '../affix';
import { acceptsStates, advanceStates, startStates } from '../compound-rule';

function expectWords(h: Hunspell, good: string[], wrong: string[]): void {
  for (const word of good) expect(h.check(word), `应接受 ${word}`).toBe(true);
  for (const word of wrong) expect(h.check(word), `应拒绝 ${word}`).toBe(false);
}

describe('parseCompoundRule', () => {
  it('char 标记直接书写，量词作用于前一个标记；括号只界定标记', () => {
    expect(parseCompoundRule('n*1t', 'char')).toEqual([
      { flag: 'n', quantifier: '*' },
      { flag: '1', quantifier: '' },
      { flag: 't', quantifier: '' },
    ]);
    // 与 Hunspell 一致：括号内的多个标记依次展开，量词只作用于最后一个
    expect(parseCompoundRule('A(BC)?', 'char')).toEqual([
      { flag: 'A', quantifier: '' },
      { flag: 'B', quantifier: '' },
      { flag: 'C', quantifier: '?' },
    ]);
  });

  it('long / num 标记写在括号内', () => {
    expect(parseCompoundRule('(aa)*(bb)?(cc)', 'long')).toEqual([
      { flag: 'aa', quantifier: '*' },
      { flag: 'bb', quantifier: '?' },
      { flag: 'cc', quantifier: '' },
    ]);
    expect(parseCompoundRule('(1001)*(1002)', 'num')).toEqual([
      { flag: '1001', quantifier: '*' },
      { flag: '1002', quantifier: '' },
    ]);
    // 不带量词时可以不加括号，按 FLAG 格式整体拆分
    expect(parseCompoundRule('aabb', 'long').map((e) => e.flag)).toEqual(['aa', 'bb']);
  });

  it('语法错误时抛错', () => {
    expect(() => parseCompoundRule('*A', 'char')).toThrow('量词');
    expect(() => parseCompoundRule('A*?', 'char')).toThrow('量词');
    expect(() => parseCompoundRule('(aa', 'long')).toThrow(')');
    expect(() => parseCompoundRule('()', 'long')).toThrow('括号内');
    expect(() => parseCompoundRule('aa*', 'long')).toThrow('括号');
    expect(() => parseCompoundRule('', 'char')).toThrow('为空');
  });

  it('解析 .aff 中带计数头的 COMPOUNDRULE 表与 COMPOUNDMIN', () => {
    const aff = parseAffix('COMPOUNDMIN 0\nCOMPOUNDRULE 2\nCOMPOUNDRULE AB\nCOMPOUNDRULE 12');
    expect(aff.compoundRules.map((rule) => rule.map((e) => e.flag).join(''))).toEqual(['AB', '12']);
    // 小于 1 按 1 处理（与 Hunspell 一致），缺省为 3
    expect(aff.compoundMin).toBe(1);
    expect(parseAffix('').compoundMin).toBe(3);
  });
});

describe('COMPOUNDRULE 匹配（NFA）', () => {
  it('逐部分推进状态集合，等价于对标记序列做正则匹配', () => {
    const rule = parseCompoundRule('A*B?C', 'char');
    const run = (parts: string[][]) =>
      acceptsStates(
        rule,
        parts.reduce((states, flags) => advanceStates(rule, states, [flags]), startStates(rule))
      );
    expect(run([['C']])).toBe(true);
    expect(run([['A'], ['A'], ['B'], ['C']])).toBe(true);
    expect(run([['A'], ['C']])).toBe(true);
    expect(run([['B'], ['B'], ['C']])).toBe(false);
    expect(run([['A'], ['B']])).toBe(false);
    // 同形词条：任一组标记匹配即可
    expect(acceptsStates(rule, advanceStates(rule, startStates(rule), [['X'], ['C']]))).toBe(true);
    // 不可能匹配时状态集合为空，用于切分剪枝
    expect(advanceStates(rule, startStates(rule), [['X']]).size).toBe(0);
  });
});

describe('Hunspell COMPOUNDRULE', () => {
  it('compoundrule：ABC', () => {
    const h = new Hunspell('COMPOUNDMIN 1\nCOMPOUNDRULE 1\nCOMPOUNDRULE ABC', '3\na/A\nb/B\nc/BC');
    expectWords(h, ['abc', 'acc'], ['ab', 'aab', 'abb', 'ba', 'bc', 'abcc', 'aabc', 'cba', 'aaabbbccc']);
  });

  it('compoundrule2：A*B*C*', () => {
    const h = new Hunspell('COMPOUNDMIN 1\nCOMPOUNDRULE 1\nCOMPOUNDRULE A*B*C*', '3\na/A\nb/B\nc/C');
    expectWords(
      h,
      ['aa', 'ab', 'abc', 'ac', 'bc', 'cc', 'aaabbbccc', 'aabbcc', 'bbbccc'],
      ['ba', 'cba', 'acb', 'abca', 'aaabbbcccb', 'ccb']
    );
  });

  it('compoundrule3：A?B?C?', () => {
    const h = new Hunspell('COMPOUNDMIN 1\nCOMPOUNDRULE 1\nCOMPOUNDRULE A?B?C?', '3\na/A\nb/B\nc/C');
    expectWords(h, ['ab', 'abc', 'ac', 'bc'], ['aa', 'aab', 'abcc', 'ba', 'cb', 'bb']);
  });

  it('compoundrule4：英语序数词（n*1t、n*mp，ONLYINCOMPOUND 的词尾不能单独出现）', () => {
    const aff = 'COMPOUNDMIN 1\nONLYINCOMPOUND c\nCOMPOUNDRULE 2\nCOMPOUNDRULE n*1t\nCOMPOUNDRULE n*mp';
    const digits = ['0/nm', '1/n1', ...'23456789'.split('').map((d) => `${d}/nm`)];
    const ordinals = [
      '0th/pt', '1st/p', '1th/tc', '2nd/p', '2th/tc', '3rd/p', '3th/tc',
      ...'456789'.split('').map((d) => `${d}th/pt`),
    ];
    const h = new Hunspell(aff, [digits.length + ordinals.length, ...digits, ...ordinals].join('\n'));
    expectWords(
      h,
      ['1st', '2nd', '4th', '10th', '11th', '12th', '13th', '14th', '21st', '22nd', '23rd', '101st', '111th', '113th', '1024th'],
      ['1th', '2th', '3th', '11st', '12nd', '13rd', '21th', '23th', '113rd', '1000nd']
    );
  });

  it('FLAG long：(aa)*(bb)*(cc)?', () => {
    const h = new Hunspell(
      'FLAG long\nCOMPOUNDMIN 1\nCOMPOUNDRULE 1\nCOMPOUNDRULE (aa)*(bb)*(cc)?',
      '4\na/aa\nb/bb\nc/cc\nd/dd'
    );
    expectWords(h, ['ab', 'aabb', 'abc', 'aaabbbc', 'bc', 'ac'], ['ba', 'abcc', 'ca', 'ad', 'dd']);
  });

  it('FLAG num：多条规则任一匹配即可', () => {
    const h = new Hunspell(
      'FLAG num\nCOMPOUNDMIN 1\nCOMPOUNDRULE 2\nCOMPOUNDRULE (1001)*(1002)\nCOMPOUNDRULE (1003)(1001)?',
      '3\nfoo/1001\nbar/1002\nbaz/1003,1001'
    );
    expectWords(h, ['foobar', 'foofoobar', 'bazbar', 'bazfoo'], ['barfoo', 'foofoo', 'foobarbar', 'bazbazfoo']);
  });

  it('组成部分必须是词根，带词缀的词形不参与规则', () => {
    const h = new Hunspell(
      'COMPOUNDMIN 1\nSFX S Y 1\nSFX S 0 s .\nCOMPOUNDRULE 1\nCOMPOUNDRULE AB',
      '2\na/AS\nb/B'
    );
    expect(h.check('as')).toBe(true);
    expectWords(h, ['ab'], ['asb']);
  });

  it('禁用词与 NEEDAFFIX 词根不能作为组成部分', () => {
    const h = new Hunspell(
      'COMPOUNDMIN 1\nFORBIDDENWORD !\nNEEDAFFIX N\nCOMPOUNDRULE 1\nCOMPOUNDRULE A*',
      '3\na/A\nb/A!\nc/AN'
    );
    expectWords(h, ['aa'], ['ab', 'ca']);
  });
});

describe('COMPOUNDMIN 与 ONLYINCOMPOUND', () => {
  it('每个组成部分至少 COMPOUNDMIN 个字符（按码点计数）', () => {
    const dic = '4\na/A\nab/A\ncd/A\n𝒳𝒴/A';
    const strict = new Hunspell('COMPOUNDMIN 2\nCOMPOUNDRULE 1\nCOMPOUNDRULE A*', dic);
    expectWords(strict, ['abcd', 'abab', 'ab𝒳𝒴'], ['aab', 'aba', 'acd']);
    const loose = new Hunspell('COMPOUNDMIN 1\nCOMPOUNDRULE 1\nCOMPOUNDRULE A*', dic);
    expectWords(loose, ['aab', 'aba', 'aa'], []);
  });

  it('ONLYINCOMPOUND 的词只能出现在复合词中', () => {
    const h = new Hunspell('COMPOUNDFLAG Z\nONLYINCOMPOUND O\nCOMPOUNDMIN 1', '2\nfoot/Z\nball/ZO');
    expectWords(h, ['foot', 'football', 'ballfoot'], ['ball']);
  });

  it('COMPOUNDFLAG 与 COMPOUNDRULE 共用切分流程，但每种切分只按一种机制成立', () => {
    const h = new Hunspell(
      'COMPOUNDFLAG Z\nCOMPOUNDMIN 1\nCOMPOUNDRULE 1\nCOMPOUNDRULE AB',
      '4\nx/Z\ny/Z\na/A\nb/B'
    );
    expectWords(h, ['xy', 'xyx', 'ab'], ['ax', 'xa', 'ba', 'abx', 'xab']);
  });

  it('COMPOUNDBEGIN / COMPOUNDEND 按位置限制组成部分', () => {
    const h = new Hunspell('COMPOUNDBEGIN B\nCOMPOUNDMIDDLE M\nCOMPOUNDEND E\nCOMPOUNDMIN 1', '3\nx/B\ny/M\nz/E');
    expectWords(h, ['xz', 'xyz', 'xyyz'], ['zx', 'xy', 'yz', 'xx']);
  });
});
