// ================================
// 编辑距离算法测试
// ================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LevenshteinEngine,
  createLevenshteinEngine,
  quickLevenshteinDistance,
  quickSimilarity,
  quickFindMostSimilar,
  quickSpellingSuggestions,
} from '../src';
import { perfBudget } from '@code-reader/test-support';

/** 恒等键提取函数（候选项本身就是字符串） */
const identity = (value: string): string => value;

/** 计算编辑步骤中的非匹配操作（即真正的编辑操作） */
function editOperations(engine: LevenshteinEngine, source: string, target: string) {
  const result = engine.distance(source, target, { computeSteps: true });
  return {
    distance: result.distance,
    operations: (result.steps ?? []).filter((step) => step.operation !== 'match'),
  };
}

describe('LevenshteinEngine', () => {
  let engine: LevenshteinEngine;
  /** 取编辑距离数值 */
  const dist = (source: string, target: string): number => engine.distance(source, target).distance;

  beforeEach(() => {
    engine = createLevenshteinEngine();
  });

  describe('distance', () => {
    it('应该正确计算相同字符串的距离为 0', () => {
      expect(dist('hello', 'hello')).toBe(0);
      expect(dist('', '')).toBe(0);
      expect(dist('测试', '测试')).toBe(0);
    });

    it('应该正确计算空字符串的距离', () => {
      expect(dist('', 'abc')).toBe(3);
      expect(dist('abc', '')).toBe(3);
    });

    it('应该正确计算单字符操作的距离', () => {
      // 插入
      expect(dist('ab', 'abc')).toBe(1);
      // 删除
      expect(dist('abc', 'ab')).toBe(1);
      // 替换
      expect(dist('abc', 'axc')).toBe(1);
    });

    it('应该正确计算多操作的距离', () => {
      expect(dist('kitten', 'sitting')).toBe(3);
      expect(dist('saturday', 'sunday')).toBe(3);
      expect(dist('intention', 'execution')).toBe(5);
    });

    it('应该正确处理中文字符', () => {
      expect(dist('你好', '你好世界')).toBe(2);
      expect(dist('中国', '中华')).toBe(1);
    });

    it('距离应该满足对称性', () => {
      expect(dist('abc', 'xyz')).toBe(dist('xyz', 'abc'));
      expect(dist('hello', 'world')).toBe(
        dist('world', 'hello')
      );
    });

    it('距离应该满足三角不等式', () => {
      const a = 'abc';
      const b = 'abd';
      const c = 'acd';

      const ab = dist(a, b);
      const bc = dist(b, c);
      const ac = dist(a, c);

      expect(ac).toBeLessThanOrEqual(ab + bc);
    });
  });

  describe('similarity', () => {
    it('应该返回相同字符串的相似度为 1', () => {
      expect(engine.similarity('hello', 'hello')).toBe(1);
      expect(engine.similarity('测试', '测试')).toBe(1);
    });

    it('应该返回完全不同字符串的相似度接近 0', () => {
      const sim = engine.similarity('abc', 'xyz');
      expect(sim).toBe(0);
    });

    it('应该返回空字符串的相似度为 1', () => {
      expect(engine.similarity('', '')).toBe(1);
    });

    it('应该返回部分匹配的合理相似度', () => {
      const sim = engine.similarity('hello', 'hallo');
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(1);
    });

    it('相似度应该在 0 到 1 之间', () => {
      const pairs = [
        ['a', 'b'],
        ['hello', 'world'],
        ['test', 'testing'],
        ['中文', '英文'],
      ];

      for (const [a, b] of pairs) {
        const sim = engine.similarity(a, b);
        expect(sim).toBeGreaterThanOrEqual(0);
        expect(sim).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('编辑步骤 (computeSteps)', () => {
    it('应该返回空数组当字符串相同时', () => {
      const result = engine.distance('hello', 'hello', { computeSteps: true });
      expect(result.steps).toBeDefined();
      expect(result.steps!.every((step) => step.operation === 'match')).toBe(true);
      expect(editOperations(engine, 'hello', 'hello').operations).toHaveLength(0);
    });

    it('应该正确识别插入操作', () => {
      const result = editOperations(engine, 'ab', 'abc');
      expect(result.distance).toBe(1);
      expect(result.operations).toEqual([
        { operation: 'insert', sourceIndex: 2, targetIndex: 2, char: 'c' },
      ]);
    });

    it('应该正确识别删除操作', () => {
      const result = editOperations(engine, 'abc', 'ab');
      expect(result.distance).toBe(1);
      expect(result.operations).toEqual([
        { operation: 'delete', sourceIndex: 2, targetIndex: 2, char: 'c' },
      ]);
    });

    it('应该正确识别替换操作', () => {
      const result = editOperations(engine, 'abc', 'axc');
      expect(result.distance).toBe(1);
      expect(result.operations).toEqual([
        { operation: 'substitute', sourceIndex: 1, targetIndex: 1, char: 'x', originalChar: 'b' },
      ]);
    });

    it('应该返回最小操作序列', () => {
      const result = editOperations(engine, 'kitten', 'sitting');
      expect(result.distance).toBe(3);
      expect(result.operations.length).toBe(3);
    });
  });

  describe('findMostSimilar', () => {
    it('应该找到最相似的字符串', () => {
      const candidates = ['hello', 'hallo', 'world', 'help'];
      const result = engine.findMostSimilar('hell', candidates, identity);

      // hello 与 help 距离均为 1，取先出现的 hello
      expect(result).toBe('hello');
    });

    it('应该在空候选列表时返回 null', () => {
      const result = engine.findMostSimilar('hello', [], identity);
      expect(result).toBeNull();
    });

    it('应该正确处理精确匹配', () => {
      const candidates = ['abc', 'abd', 'xyz'];
      const result = engine.findMostSimilar('abc', candidates, identity);

      expect(result).toBe('abc');
      expect(engine.distance('abc', result!).distance).toBe(0);
      expect(engine.similarity('abc', result!)).toBe(1);
    });

    it('应该支持对象候选项与自定义键', () => {
      const candidates = [
        { id: 1, word: 'testing' },
        { id: 2, word: 'test' },
        { id: 3, word: 'tester' },
        { id: 4, word: 'toast' },
      ];
      const result = engine.findMostSimilar('tests', candidates, (c) => c.word);

      expect(result?.id).toBe(2);
    });
  });

  describe('findSimilar', () => {
    it('应该返回所有满足阈值的结果', () => {
      const candidates = ['hello', 'hallo', 'world', 'help', 'held'];
      const results = engine.findSimilar('hell', candidates, identity, 0.5);

      // world 与 hell 相似度为 0.2，应被阈值过滤
      expect(results.map((r) => r.key).sort()).toEqual(['hallo', 'held', 'hello', 'help']);
      for (const result of results) {
        expect(result.similarity).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('应该按相似度降序排序', () => {
      const candidates = ['test', 'testing', 'tester', 'toast', 'best'];
      const results = engine.findSimilar('test', candidates, identity, 0.3);

      expect(results[0]!.key).toBe('test');
      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity).toBeLessThanOrEqual(
          results[i - 1].similarity
        );
      }
    });

    it('拼写建议应该尊重 maxSuggestions 上限', () => {
      const candidates = Array.from({ length: 100 }, (_, i) => `item${i}`);
      const suggestions = engine.suggestSpelling('item50', candidates, 5, 2);

      // 距离 <= 2 的候选远多于 5 个，因此应恰好截断为 5 个，且首位为精确匹配
      expect(suggestions).toHaveLength(5);
      expect(suggestions[0]).toMatchObject({ word: 'item50', distance: 0 });
    });
  });
});

describe('大小写不敏感的拼写建议', () => {
  it('应该提供拼写建议', () => {
    const engine = createLevenshteinEngine({ caseSensitive: false, maxDistance: 2 });
    const dictionary = [
      'apple',
      'application',
      'apply',
      'banana',
      'orange',
      'grape',
    ];

    expect(engine.findMostSimilar('aple', dictionary, identity)).toBe('apple');
    expect(engine.suggestSpelling('aple', dictionary)[0]?.word).toBe('apple');
    expect(engine.isCorrectSpelling('Apple', dictionary)).toBe(true);
  });
});

describe('便捷函数', () => {
  describe('quickLevenshteinDistance', () => {
    it('应该正确计算距离', () => {
      expect(quickLevenshteinDistance('hello', 'hallo')).toBe(1);
      expect(quickLevenshteinDistance('kitten', 'sitting')).toBe(3);
    });
  });

  describe('quickSimilarity', () => {
    it('应该正确计算相似度', () => {
      expect(quickSimilarity('hello', 'hello')).toBe(1);
      expect(quickSimilarity('abc', 'xyz')).toBe(0);

      const sim = quickSimilarity('hello', 'hallo');
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });
  });

  describe('quickFindMostSimilar', () => {
    it('应该找到最相似的项', () => {
      const candidates = ['cat', 'car', 'cart', 'bar'];
      expect(quickFindMostSimilar('cats', candidates)).toBe('cat');
      expect(quickFindMostSimilar('cats', [])).toBeNull();
    });
  });

  describe('quickSpellingSuggestions', () => {
    it('应该提供拼写建议', () => {
      const dictionary = ['hello', 'world', 'help', 'held', 'hero'];
      const suggestions = quickSpellingSuggestions('helo', dictionary, 3);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.length).toBeLessThanOrEqual(3);
      // 第一个建议应该是最相似的
      expect(suggestions[0]?.word).toBe('hello');
    });
  });
});

describe('边界情况', () => {
  let engine: LevenshteinEngine;

  beforeEach(() => {
    engine = createLevenshteinEngine();
  });

  it('应该处理非常长的字符串', () => {
    const str1 = 'a'.repeat(100);
    const str2 = 'a'.repeat(95) + 'bbbbb';

    const distance = engine.distance(str1, str2);
    expect(distance.distance).toBe(5);
  });

  it('应该处理 Unicode 字符', () => {
    const distance = engine.distance('🎉🎊', '🎉🎈');
    expect(distance.distance).toBe(1);
  });

  it('应该处理混合字符', () => {
    const distance = engine.distance('hello你好', 'hello世界');
    expect(distance.distance).toBe(2);
  });

  it('应该处理空格和特殊字符', () => {
    const distance = engine.distance('hello world', 'hello\tworld');
    expect(distance.distance).toBe(1);
  });

  it('应该处理大小写差异', () => {
    const distance = engine.distance('Hello', 'hello');
    expect(distance.distance).toBe(1);
  });
});

describe('性能验证', () => {
  it('应该在合理时间内处理中等长度字符串', () => {
    const engine = createLevenshteinEngine();
    const str1 = 'a'.repeat(500);
    const str2 = 'b'.repeat(500);

    const start = performance.now();
    engine.distance(str1, str2);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(perfBudget(1000));
  });

  it('应该能批量处理多个比较', () => {
    const engine = createLevenshteinEngine();
    const candidates = Array.from({ length: 1000 }, (_, i) => `word${i}`);

    const start = performance.now();
    const results = engine.findSimilar('word500', candidates, identity, 0.5);
    const duration = performance.now() - start;

    expect(results[0]?.key).toBe('word500');
    expect(duration).toBeLessThan(perfBudget(500));
  });
});
