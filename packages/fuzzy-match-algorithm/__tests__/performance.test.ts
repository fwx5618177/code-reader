// ================================
// 长列表性能：命令面板规模的模糊评分、补全规模的 Radix Tree 前缀与模糊检索
// 预算按开发机设定并留有余量，用来发现数量级的退化；CI 上由 PERF_BUDGET_SCALE 统一放宽（见 @code-reader/test-support）
// ================================

import { describe, expect, it } from 'vitest';
import { RadixTree, fuzzyScore, getAllMatchPositions } from '../src';
import { perfBudget } from '@code-reader/test-support';

/** 可复现的伪随机数 */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const next = random(42);
const syllables = ['ka', 'ri', 'to', 'men', 'sel', 'ect', 'doc', 'ument', 'plug', 'in', 'wri', 'ting', 'note', 'graph', 'tag'];
const word = () => Array.from({ length: 2 + Math.floor(next() * 4) }, () => syllables[Math.floor(next() * syllables.length)]).join('');

/** 中位数耗时（毫秒） */
function median(run: () => void, times = 7): number {
  const samples = Array.from({ length: times }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return samples[Math.floor(times / 2)]!;
}

describe('fuzzyScore 长列表', () => {
  const titles = Array.from({ length: 20_000 }, (_, i) => `${word()} ${word()} 命令 ${i}`);

  it('2 万条标题逐条评分 + 排序在 60ms 内（命令面板每次输入的工作量）', () => {
    let matched = 0;
    const ms = median(() => {
      const ranked = titles
        .map((title) => ({ title, result: fuzzyScore('wrnote', title) }))
        .filter((entry) => entry.result.matched)
        .sort((a, b) => b.result.score - a.result.score);
      matched = ranked.length;
    });
    expect(matched).toBeGreaterThan(0);
    expect(ms).toBeLessThan(perfBudget(60));
  });

  it('长文本（2000 字符的说明）单次 < 0.5ms（回归：原递归枚举所有对齐，指数级，长文本不会结束）', () => {
    const long = Array.from({ length: 200 }, word).join(' ').slice(0, 2000);
    const ms = median(() => {
      for (let i = 0; i < 500; i++) fuzzyScore('plugintag', long);
    });
    expect(ms / 500).toBeLessThan(perfBudget(0.5));
  });
});

describe('RadixTree 大词表', () => {
  const tree = new RadixTree<number>({ maxResults: 50 });
  const words = Array.from({ length: 50_000 }, word);
  words.forEach((w, i) => tree.insert(w, i));

  it('5 万词前缀检索单次 < 5ms', () => {
    expect(tree.prefixSearch('kari').length).toBeGreaterThan(0);
    expect(median(() => {
      for (let i = 0; i < 100; i++) tree.prefixSearch(syllables[i % syllables.length]!);
    }) / 100).toBeLessThan(perfBudget(5));
  });

  it('5 万词模糊检索（编辑距离 1）单次 < 50ms', () => {
    const target = words[123]!;
    const typo = target.slice(0, -1) + (target.endsWith('a') ? 'e' : 'a');
    expect(tree.fuzzySearch(typo, { maxEditDistance: 1 }).some((result) => result.key === target)).toBe(true);
    expect(median(() => tree.fuzzySearch(typo, { maxEditDistance: 1 }), 5)).toBeLessThan(perfBudget(50));
  });
});

describe('fuzzyScore 取全局最优对齐', () => {
  /** 与实现一致的计分（默认参数），用于穷举对照 */
  function scoreOf(positions: number[], text: string): number {
    const boundary = (index: number) =>
      index === 0 ||
      /[_-]/.test(text[index - 1]!) ||
      (/[a-z]/.test(text[index - 1]!) && /[A-Z]/.test(text[index]!)) ||
      /\d/.test(text[index - 1]!) !== /\d/.test(text[index]!) ||
      /\s/.test(text[index - 1]!);
    let score = 0;
    let run = 0;
    positions.forEach((pos, i) => {
      score += 10 + (pos === 0 ? 25 : 0) + (boundary(pos) ? 20 : 0);
      if (i > 0) {
        if (pos === positions[i - 1]! + 1) score += 15 * ++run;
        else {
          run = 0;
          score -= Math.min((pos - positions[i - 1]! - 1) * 3, 10);
        }
      }
    });
    return Math.max(0, score + (positions.length / text.length) * 20);
  }

  it('随机短串上与穷举全部对齐的最高分一致', () => {
    const rand = random(7);
    const alphabet = 'abAB_- 1';
    for (let round = 0; round < 400; round++) {
      const text = Array.from({ length: 4 + Math.floor(rand() * 9) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
      const pattern = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => 'ab1'[Math.floor(rand() * 3)]).join('');
      const all = getAllMatchPositions(pattern, text, false, 100_000);
      const result = fuzzyScore(pattern, text);
      expect(result.matched, `${pattern} / ${text}`).toBe(all.length > 0);
      if (!result.matched) continue;
      const best = Math.max(...all.map((positions) => scoreOf(positions, text)));
      expect(scoreOf(result.positions, text), `${pattern} / ${JSON.stringify(text)}`).toBeCloseTo(best, 9);
    }
  });
});
