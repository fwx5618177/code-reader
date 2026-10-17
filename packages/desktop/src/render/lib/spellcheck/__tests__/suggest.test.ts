// ================================
// 拼写建议测试：排序规则（编辑距离、REP、键盘相邻、交换、大小写还原）与候选生成，
// 以及内置 en_US 词典的加载与常见错误建议
// ================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Hunspell } from '../hunspell';
import { rankSuggestions, suggest } from '../suggest';

const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

describe('rankSuggestions', () => {
  it('编辑距离小者优先', () => {
    const ranked = rankSuggestions(
      'acommodate',
      [
        { word: 'accumulate', source: 'near' },
        { word: 'accommodate', source: 'edit' },
        { word: 'commode', source: 'near' },
      ],
      KEYS
    );
    expect(ranked).toEqual(['accommodate', 'commode', 'accumulate']);
  });

  it('相邻交换优先于普通替换', () => {
    expect(
      rankSuggestions(
        'teh',
        [
          { word: 'ten', source: 'edit' },
          { word: 'the', source: 'edit' },
        ],
        KEYS
      )[0]
    ).toBe('the');
  });

  it('键盘相邻字符的替换优先', () => {
    expect(
      rankSuggestions(
        'cyt',
        [
          { word: 'cat', source: 'edit' },
          { word: 'cut', source: 'edit' },
        ],
        KEYS
      )[0]
    ).toBe('cut');
  });

  it('REP 命中优先，拆词靠后', () => {
    const ranked = rankSuggestions(
      'fone',
      [
        { word: 'fine', source: 'edit' },
        { word: 'phone', source: 'rep' },
        { word: 'f one', source: 'split' },
      ],
      KEYS
    );
    expect(ranked).toEqual(['phone', 'fine', 'f one']);
  });

  it('按输入还原大小写并去重，专有名词保持原样', () => {
    expect(rankSuggestions('Teh', [{ word: 'the', source: 'edit' }], KEYS)).toEqual(['The']);
    expect(rankSuggestions('TEH', [{ word: 'the', source: 'edit' }], KEYS)).toEqual(['THE']);
    expect(
      rankSuggestions(
        'paris',
        [
          { word: 'Paris', source: 'edit' },
          { word: 'Paris', source: 'near' },
        ],
        KEYS
      )
    ).toEqual(['Paris']);
  });

  it('限制数量', () => {
    const candidates = ['aa', 'ab', 'ac', 'ad'].map((word) => ({ word, source: 'edit' as const }));
    expect(rankSuggestions('ax', candidates, KEYS, 2)).toHaveLength(2);
  });
});

describe('suggest', () => {
  const h = new Hunspell(
    `TRY esiarntolcdugmphbyfvkwz
NOSUGGEST X
REP 1
REP f ph
SFX D Y 2
SFX D y ied [^aeiou]y
SFX D 0 ed [^ey]`,
    '7\ntry/D\nphone\nlock/D\ndoor\nParis\ndamn/X\ndam'
  );

  it('一次编辑、REP、词形展开与专有名词', () => {
    expect(suggest(h, 'tryed')).toContain('tried');
    expect(suggest(h, 'fone')[0]).toBe('phone');
    expect(suggest(h, 'paris')[0]).toBe('Paris');
    expect(suggest(h, 'Lockd')).toEqual(expect.arrayContaining(['Lock', 'Locked']));
  });

  it('拆成两个词', () => {
    expect(suggest(h, 'lockdoor')).toContain('lock door');
  });

  it('不建议 NOSUGGEST 词条', () => {
    const suggestions = suggest(h, 'damm');
    expect(suggestions).toContain('dam');
    expect(suggestions).not.toContain('damn');
  });
});

describe('内置 en_US 词典', () => {
  const dir = resolve(__dirname, '../../../../../assets/dictionaries/en_US');
  const en = Hunspell.fromBytes(readFileSync(resolve(dir, 'en_US.aff')), readFileSync(resolve(dir, 'en_US.dic')));

  it('常见词形', () => {
    for (const word of ['hello', 'running', 'unhappiness', 'tomorrow', "don't", 'don’t', 'Wednesday', 'THE']) {
      expect(en.check(word), word).toBe(true);
    }
    for (const word of ['recieve', 'teh', 'wednesday', 'speling']) {
      expect(en.check(word), word).toBe(false);
    }
  });

  it('常见拼写错误的建议', () => {
    expect(suggest(en, 'recieve')[0]).toBe('receive');
    expect(suggest(en, 'speling')).toContain('spelling');
    expect(suggest(en, 'Teh')).toContain('The');
  });
});
