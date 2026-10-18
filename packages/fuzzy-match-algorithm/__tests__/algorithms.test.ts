// ================================
// fuzzy-match-algorithm：编辑距离、模糊评分、前缀树的行为测试
// ================================

import { describe, expect, it } from 'vitest';
import {
  levenshteinDistance,
  levenshteinFull,
  stringSimilarity,
  isWithinDistance,
  EditOperation,
} from '../src/levenshtein';
import {
  damerauLevenshteinDistance,
  isSingleTransposition,
  findClosest,
  isWithinDamerauDistance,
} from '../src/damerau-levenshtein';
import { fuzzyScore, fuzzyMatch, fuzzyFilter, highlightMatches, quickFuzzyScore } from '../src/fuzzy-score';
import { RadixTree } from '../src/radix-tree';

describe('levenshtein', () => {
  it('经典样例与边界', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('same', 'same')).toBe(0);
    expect(levenshteinDistance('ab', 'ba')).toBe(2);
  });

  it('对称、大小写选项与非 BMP 字符', () => {
    expect(levenshteinDistance('flaw', 'lawn')).toBe(levenshteinDistance('lawn', 'flaw'));
    expect(levenshteinDistance('Hello', 'hello')).toBe(1);
    expect(levenshteinDistance('Hello', 'hello', { caseSensitive: false })).toBe(0);
    expect(levenshteinDistance('中文写作', '中文阅读')).toBe(2);
  });

  it('编辑步骤可重放为目标串', () => {
    const result = levenshteinFull('sunday', 'saturday', { computeSteps: true });
    expect(result.distance).toBe(3);
    const ops = (result.steps ?? []).filter((step) => step.operation !== EditOperation.None);
    expect(ops).toHaveLength(3);
  });

  it('相似度与阈值判断', () => {
    expect(stringSimilarity('abc', 'abc')).toBe(1);
    expect(stringSimilarity('abc', 'xyz')).toBe(0);
    expect(isWithinDistance('kitten', 'sitting', 3)).toBe(true);
    expect(isWithinDistance('kitten', 'sitting', 2)).toBe(false);
  });
});

describe('damerau-levenshtein', () => {
  it('相邻换位只算一次编辑', () => {
    expect(damerauLevenshteinDistance('ab', 'ba')).toBe(1);
    expect(damerauLevenshteinDistance('teh', 'the')).toBe(1);
    expect(damerauLevenshteinDistance('ca', 'abc')).toBe(3);
    expect(isSingleTransposition('form', 'from')).toBe(true);
    expect(isSingleTransposition('form', 'farm')).toBe(false);
  });

  it('拼写建议：在候选中找最接近的词', () => {
    expect(findClosest('recieve', ['recipe', 'receive', 'relieve'])).toMatchObject({ target: 'receive', distance: 1 });
    expect(findClosest('x', [])).toBeNull();
    expect(isWithinDamerauDistance('acheive', 'achieve', 1)).toBe(true);
  });
});

describe('fuzzyScore', () => {
  it('子序列匹配并返回命中位置', () => {
    const match = fuzzyScore('fb', 'FooBar');
    expect(match.matched).toBe(true);
    expect(match.positions).toEqual([0, 3]);
    expect(fuzzyScore('xyz', 'FooBar').matched).toBe(false);
    expect(fuzzyMatch('obr', 'FooBar')).toBe(true);
  });

  it('连续、词首、边界命中得分更高', () => {
    expect(fuzzyScore('foo', 'foobar').score).toBeGreaterThan(fuzzyScore('foo', 'f_o_o_bar').score);
    expect(fuzzyScore('gs', 'getSize').score).toBeGreaterThan(fuzzyScore('gs', 'aagaas').score);
    expect(fuzzyScore('bar', 'bar').score).toBeGreaterThanOrEqual(fuzzyScore('bar', 'foobar').score);
  });

  it('分数在 0–100 之间；快速评分与完整评分对匹配与否一致', () => {
    for (const [pattern, text] of [['ab', 'aXbY'], ['zz', 'abc'], ['命令', '打开命令面板']] as const) {
      const full = fuzzyScore(pattern, text);
      expect(full.score).toBeGreaterThanOrEqual(0);
      expect(full.score).toBeLessThanOrEqual(100);
      expect(quickFuzzyScore(pattern, text) > 0).toBe(full.matched);
    }
  });

  it('fuzzyFilter 按分数排序并截断', () => {
    const items = ['Open File', 'Format Document', 'Toggle Fold', 'File: Save'];
    const result = fuzzyFilter('fil', items, (item) => item, { limit: 2 });
    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.item)).toEqual(expect.arrayContaining(['File: Save']));
    expect(result[0]!.score).toBeGreaterThanOrEqual(result[1]!.score);
  });

  it('highlightMatches 包裹命中字符', () => {
    expect(highlightMatches('FooBar', [0, 3])).toBe('<mark>F</mark>oo<mark>B</mark>ar');
    expect(highlightMatches('abc', [])).toBe('abc');
  });
});

describe('RadixTree', () => {
  const meta = (label: string, priority = 0) => ({ id: label, label, type: 'command', priority });

  it('插入、精确查找、删除与大小', () => {
    const tree = new RadixTree();
    tree.insertMany(['section', 'subsection', 'sum', 'summary'].map((key) => ({ key, value: meta(key) })));
    expect(tree.getSize()).toBe(4);
    expect(tree.find('sum')?.[0]?.label).toBe('sum');
    expect(tree.find('su')).toBeNull();
    expect(tree.delete('sum')).toBe(true);
    expect(tree.find('sum')).toBeNull();
    expect(tree.find('summary')?.[0]?.label).toBe('summary');
    expect(tree.getSize()).toBe(3);
    expect(tree.getAllKeys().sort()).toEqual(['section', 'subsection', 'summary']);
  });

  it('前缀搜索返回全部以该前缀开头的键', () => {
    const tree = new RadixTree();
    for (const key of ['section', 'subsection', 'subsubsection', 'sum', 'textbf']) tree.insert(key, meta(key));
    const keys = tree.prefixSearch('sub').map((result) => result.key).sort();
    expect(keys).toEqual(['subsection', 'subsubsection']);
    expect(tree.prefixSearch('zzz')).toEqual([]);
  });

  it('模糊搜索容忍拼写错误，按相似度排序', () => {
    const tree = new RadixTree();
    for (const key of ['section', 'subsection', 'textbf', 'textit']) tree.insert(key, meta(key));
    const results = tree.fuzzySearch('sectoin', { maxEditDistance: 2 });
    expect(results[0]?.key).toBe('section');
    expect(results.every((result) => result.matchType === 'fuzzy' && result.score < 1)).toBe(true);
    expect(tree.fuzzySearch('qqqqqq', { maxEditDistance: 1 })).toEqual([]);
  });
});
