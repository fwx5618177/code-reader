// ================================
// 编辑距离算法测试
// ================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LevenshteinEngine,
  createLevenshteinEngine,
  createSpellCheckEngine,
  quickLevenshteinDistance,
  quickSimilarity,
  quickFindMostSimilar,
  quickSpellingSuggestions,
} from '../src';

describe('LevenshteinEngine', () => {
  let engine: LevenshteinEngine;

  beforeEach(() => {
    engine = createLevenshteinEngine();
  });

  describe('distance', () => {
    it('应该正确计算相同字符串的距离为 0', () => {
      expect(engine.distance('hello', 'hello')).toBe(0);
      expect(engine.distance('', '')).toBe(0);
      expect(engine.distance('测试', '测试')).toBe(0);
    });

    it('应该正确计算空字符串的距离', () => {
      expect(engine.distance('', 'abc')).toBe(3);
      expect(engine.distance('abc', '')).toBe(3);
    });

    it('应该正确计算单字符操作的距离', () => {
      // 插入
      expect(engine.distance('ab', 'abc')).toBe(1);
      // 删除
      expect(engine.distance('abc', 'ab')).toBe(1);
      // 替换
      expect(engine.distance('abc', 'axc')).toBe(1);
    });

    it('应该正确计算多操作的距离', () => {
      expect(engine.distance('kitten', 'sitting')).toBe(3);
      expect(engine.distance('saturday', 'sunday')).toBe(3);
      expect(engine.distance('intention', 'execution')).toBe(5);
    });

    it('应该正确处理中文字符', () => {
      expect(engine.distance('你好', '你好世界')).toBe(2);
      expect(engine.distance('中国', '中华')).toBe(1);
    });

    it('距离应该满足对称性', () => {
      expect(engine.distance('abc', 'xyz')).toBe(engine.distance('xyz', 'abc'));
      expect(engine.distance('hello', 'world')).toBe(
        engine.distance('world', 'hello')
      );
    });

    it('距离应该满足三角不等式', () => {
      const a = 'abc';
      const b = 'abd';
      const c = 'acd';

      const ab = engine.distance(a, b);
      const bc = engine.distance(b, c);
      const ac = engine.distance(a, c);

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

  describe('getOperations', () => {
    it('应该返回空数组当字符串相同时', () => {
      const result = engine.getOperations('hello', 'hello');
      expect(result.operations).toHaveLength(0);
    });

    it('应该正确识别插入操作', () => {
      const result = engine.getOperations('ab', 'abc');
      expect(result.distance).toBe(1);
      expect(result.operations.some((op) => op.type === 'insert')).toBe(true);
    });

    it('应该正确识别删除操作', () => {
      const result = engine.getOperations('abc', 'ab');
      expect(result.distance).toBe(1);
      expect(result.operations.some((op) => op.type === 'delete')).toBe(true);
    });

    it('应该正确识别替换操作', () => {
      const result = engine.getOperations('abc', 'axc');
      expect(result.distance).toBe(1);
      expect(result.operations.some((op) => op.type === 'replace')).toBe(true);
    });

    it('应该返回最小操作序列', () => {
      const result = engine.getOperations('kitten', 'sitting');
      expect(result.distance).toBe(3);
      expect(result.operations.length).toBe(3);
    });
  });

  describe('findMostSimilar', () => {
    it('应该找到最相似的字符串', () => {
      const candidates = ['hello', 'hallo', 'world', 'help'];
      const result = engine.findMostSimilar('hell', candidates);

      expect(result).toBeDefined();
      expect(result!.item).toBe('hello');
    });

    it('应该在空候选列表时返回 undefined', () => {
      const result = engine.findMostSimilar('hello', []);
      expect(result).toBeUndefined();
    });

    it('应该正确处理精确匹配', () => {
      const candidates = ['abc', 'abd', 'xyz'];
      const result = engine.findMostSimilar('abc', candidates);

      expect(result!.item).toBe('abc');
      expect(result!.distance).toBe(0);
      expect(result!.similarity).toBe(1);
    });

    it('应该按相似度排序', () => {
      const candidates = ['test', 'testing', 'tester', 'toast'];
      const result = engine.findMostSimilar('tests', candidates, { limit: 4 });

      expect(result!.item).toBe('test');
    });
  });

  describe('findAllSimilar', () => {
    it('应该返回所有满足阈值的结果', () => {
      const candidates = ['hello', 'hallo', 'world', 'help', 'held'];
      const results = engine.findAllSimilar('hell', candidates, {
        minSimilarity: 0.5,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.similarity).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('应该按相似度降序排序', () => {
      const candidates = ['test', 'testing', 'tester', 'toast', 'best'];
      const results = engine.findAllSimilar('test', candidates, {
        minSimilarity: 0.3,
      });

      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity).toBeLessThanOrEqual(
          results[i - 1].similarity
        );
      }
    });

    it('应该尊重 limit 参数', () => {
      const candidates = Array.from({ length: 100 }, (_, i) => `item${i}`);
      const results = engine.findAllSimilar('item50', candidates, { limit: 5 });

      expect(results.length).toBeLessThanOrEqual(5);
    });
  });
});

describe('createSpellCheckEngine', () => {
  it('应该创建拼写检查引擎', () => {
    const engine = createSpellCheckEngine();
    expect(engine).toBeDefined();
  });

  it('应该提供拼写建议', () => {
    const engine = createSpellCheckEngine();
    const dictionary = [
      'apple',
      'application',
      'apply',
      'banana',
      'orange',
      'grape',
    ];

    const result = engine.findMostSimilar('aple', dictionary);
    expect(result).toBeDefined();
    expect(result!.item).toBe('apple');
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
      const result = quickFindMostSimilar('cats', candidates);

      expect(result).toBeDefined();
      expect(result!.item).toBe('cat');
    });
  });

  describe('quickSpellingSuggestions', () => {
    it('应该提供拼写建议', () => {
      const dictionary = ['hello', 'world', 'help', 'held', 'hero'];
      const suggestions = quickSpellingSuggestions('helo', dictionary, 3);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.length).toBeLessThanOrEqual(3);
      // 第一个建议应该是最相似的
      expect(suggestions[0].item).toBe('hello');
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
    expect(distance).toBe(5);
  });

  it('应该处理 Unicode 字符', () => {
    const distance = engine.distance('🎉🎊', '🎉🎈');
    expect(distance).toBe(1);
  });

  it('应该处理混合字符', () => {
    const distance = engine.distance('hello你好', 'hello世界');
    expect(distance).toBe(2);
  });

  it('应该处理空格和特殊字符', () => {
    const distance = engine.distance('hello world', 'hello\tworld');
    expect(distance).toBe(1);
  });

  it('应该处理大小写差异', () => {
    const distance = engine.distance('Hello', 'hello');
    expect(distance).toBe(1);
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

    // 应该在 1 秒内完成
    expect(duration).toBeLessThan(1000);
  });

  it('应该能批量处理多个比较', () => {
    const engine = createLevenshteinEngine();
    const candidates = Array.from({ length: 1000 }, (_, i) => `word${i}`);

    const start = performance.now();
    engine.findAllSimilar('word500', candidates, { minSimilarity: 0.5 });
    const duration = performance.now() - start;

    // 应该在 500ms 内完成
    expect(duration).toBeLessThan(500);
  });
});
