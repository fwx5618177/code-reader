// ================================
// 模糊匹配算法测试
// ================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FuzzyMatchEngine,
  createFuzzyMatchEngine,
  createFileSearchEngine,
  createCommandSearchEngine,
  quickFuzzyMatch,
  quickFuzzySearch,
  quickSearchStrings,
  quickHighlight,
} from '../src';

describe('FuzzyMatchEngine', () => {
  let engine: FuzzyMatchEngine;

  beforeEach(() => {
    engine = createFuzzyMatchEngine();
  });

  describe('match', () => {
    it('应该正确匹配完全相同的字符串', () => {
      const result = engine.match('hello', 'hello');

      expect(result).not.toBeNull();
      expect(result!.score).toBe(1);
      expect(result!.matched).toBe(true);
    });

    it('应该正确匹配包含模式的字符串', () => {
      const result = engine.match('hlo', 'hello');

      expect(result).not.toBeNull();
      expect(result!.matched).toBe(true);
      expect(result!.score).toBeGreaterThan(0);
    });

    it('应该返回 null 当模式不匹配时', () => {
      const result = engine.match('xyz', 'hello');

      expect(result).toBeNull();
    });

    it('应该正确处理空模式', () => {
      const result = engine.match('', 'hello');

      expect(result).not.toBeNull();
      expect(result!.matched).toBe(true);
    });

    it('应该正确处理空目标', () => {
      const result = engine.match('hello', '');

      expect(result).toBeNull();
    });

    it('应该正确匹配大小写不敏感', () => {
      const result = engine.match('HELLO', 'hello');

      expect(result).not.toBeNull();
      expect(result!.matched).toBe(true);
    });

    it('应该正确匹配中文', () => {
      const result = engine.match('你好', '你好世界');

      expect(result).not.toBeNull();
      expect(result!.matched).toBe(true);
    });

    it('应该返回匹配位置', () => {
      const result = engine.match('hlo', 'hello');

      expect(result).not.toBeNull();
      expect(result!.positions).toBeDefined();
      expect(result!.positions.length).toBe(3);
    });

    it('应该为连续匹配给予更高分数', () => {
      const consecutive = engine.match('hel', 'hello');
      const scattered = engine.match('hlo', 'hello');

      expect(consecutive).not.toBeNull();
      expect(scattered).not.toBeNull();
      expect(consecutive!.score).toBeGreaterThan(scattered!.score);
    });

    it('应该为开头匹配给予更高分数', () => {
      const startMatch = engine.match('hel', 'hello world');
      const middleMatch = engine.match('wor', 'hello world');

      expect(startMatch).not.toBeNull();
      expect(middleMatch).not.toBeNull();
      expect(startMatch!.score).toBeGreaterThan(middleMatch!.score);
    });
  });

  describe('search', () => {
    const items = [
      'src/components/Button.tsx',
      'src/components/Input.tsx',
      'src/utils/helpers.ts',
      'src/hooks/useAuth.ts',
      'package.json',
      'tsconfig.json',
      'README.md',
    ];

    it('应该返回匹配的结果', () => {
      const results = engine.search('btn', items);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.item.includes('Button'))).toBe(true);
    });

    it('应该按分数排序结果', () => {
      const results = engine.search('com', items);

      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it('应该尊重 limit 参数', () => {
      const results = engine.search('s', items, { limit: 3 });

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('应该正确处理空查询', () => {
      const results = engine.search('', items);

      expect(results.length).toBe(items.length);
    });

    it('应该正确处理空列表', () => {
      const results = engine.search('test', []);

      expect(results.length).toBe(0);
    });

    it('应该正确处理无匹配的查询', () => {
      const results = engine.search('xyz123', items);

      expect(results.length).toBe(0);
    });

    it('应该支持自定义键提取', () => {
      const objects = [
        { name: 'Button', path: 'src/Button.tsx' },
        { name: 'Input', path: 'src/Input.tsx' },
      ];

      const results = engine.search('btn', objects, {
        keys: ['name'],
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('highlight', () => {
    it('应该正确高亮匹配的字符', () => {
      const result = engine.highlight('hlo', 'hello');

      expect(result).toBeDefined();
      expect(result.highlights.length).toBe(3);
    });

    it('应该返回正确的高亮范围', () => {
      const result = engine.highlight('hel', 'hello');

      expect(result.highlights.length).toBe(3);
      // 检查连续的位置
      expect(result.highlights[0].start).toBe(0);
      expect(result.highlights[0].end).toBe(1);
    });

    it('应该处理无匹配的情况', () => {
      const result = engine.highlight('xyz', 'hello');

      expect(result.highlights.length).toBe(0);
    });

    it('应该生成高亮 HTML', () => {
      const result = engine.highlight('hel', 'hello', {
        highlightTag: 'mark',
      });

      expect(result.html).toContain('<mark>');
      expect(result.html).toContain('</mark>');
    });
  });
});

describe('createFileSearchEngine', () => {
  it('应该创建文件搜索引擎', () => {
    const engine = createFileSearchEngine();
    expect(engine).toBeDefined();
  });

  it('应该优先匹配文件名', () => {
    const engine = createFileSearchEngine();
    const files = [
      'src/utils/button.ts',
      'src/components/Button.tsx',
      'docs/button-guide.md',
    ];

    const results = engine.search('button', files);

    expect(results.length).toBeGreaterThan(0);
    // Button.tsx 应该排在前面因为文件名完全匹配
    expect(results[0].item).toContain('Button');
  });

  it('应该正确处理路径分隔符', () => {
    const engine = createFileSearchEngine();
    const files = ['src/components/ui/Button.tsx', 'src/Button.tsx'];

    const results = engine.search('src/btn', files);

    expect(results.length).toBeGreaterThan(0);
  });
});

describe('createCommandSearchEngine', () => {
  it('应该创建命令搜索引擎', () => {
    const engine = createCommandSearchEngine();
    expect(engine).toBeDefined();
  });

  it('应该匹配命令名称', () => {
    const engine = createCommandSearchEngine();
    const commands = [
      { id: 'save', label: 'Save File' },
      { id: 'open', label: 'Open File' },
      { id: 'close', label: 'Close File' },
    ];

    const results = engine.search('save', commands, {
      keys: ['label', 'id'],
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.id).toBe('save');
  });
});

describe('便捷函数', () => {
  describe('quickFuzzyMatch', () => {
    it('应该正确执行模糊匹配', () => {
      const result = quickFuzzyMatch('hlo', 'hello');

      expect(result).not.toBeNull();
      expect(result!.matched).toBe(true);
    });
  });

  describe('quickFuzzySearch', () => {
    it('应该正确执行模糊搜索', () => {
      const items = ['apple', 'banana', 'orange', 'grape'];
      const results = quickFuzzySearch('apl', items);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item).toBe('apple');
    });

    it('应该支持 limit 选项', () => {
      const items = Array.from({ length: 100 }, (_, i) => `item${i}`);
      const results = quickFuzzySearch('item', items, { limit: 5 });

      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('quickSearchStrings', () => {
    it('应该返回匹配的字符串列表', () => {
      const items = ['hello', 'world', 'help', 'hero'];
      const results = quickSearchStrings('hel', items);

      expect(results.length).toBeGreaterThan(0);
      expect(results.includes('hello')).toBe(true);
      expect(results.includes('help')).toBe(true);
    });
  });

  describe('quickHighlight', () => {
    it('应该返回高亮结果', () => {
      const result = quickHighlight('hlo', 'hello');

      expect(result.highlights.length).toBe(3);
      expect(result.html).toBeDefined();
    });
  });
});

describe('边界情况', () => {
  let engine: FuzzyMatchEngine;

  beforeEach(() => {
    engine = createFuzzyMatchEngine();
  });

  it('应该处理超长字符串', () => {
    const longString = 'a'.repeat(10000);
    const result = engine.match('aaa', longString);

    expect(result).not.toBeNull();
    expect(result!.matched).toBe(true);
  });

  it('应该处理特殊字符', () => {
    const result = engine.match('$.', 'file.$.txt');

    expect(result).not.toBeNull();
  });

  it('应该处理 Unicode 字符', () => {
    const result = engine.match('🎉', 'hello 🎉 world');

    expect(result).not.toBeNull();
    expect(result!.matched).toBe(true);
  });

  it('应该处理空格', () => {
    const result = engine.match('hello world', 'hello beautiful world');

    expect(result).not.toBeNull();
  });

  it('应该处理数字', () => {
    const result = engine.match('123', 'abc123def');

    expect(result).not.toBeNull();
    expect(result!.matched).toBe(true);
  });

  it('应该处理混合大小写查询', () => {
    const result = engine.match('HeLLo', 'hello');

    expect(result).not.toBeNull();
  });
});

describe('性能验证', () => {
  it('应该在合理时间内搜索大量项目', () => {
    const engine = createFuzzyMatchEngine();
    const items = Array.from({ length: 10000 }, (_, i) => `item-${i}-${Math.random().toString(36)}`);

    const start = performance.now();
    engine.search('item-5000', items, { limit: 10 });
    const duration = performance.now() - start;

    // 应该在 500ms 内完成
    expect(duration).toBeLessThan(500);
  });

  it('应该高效处理长查询', () => {
    const engine = createFuzzyMatchEngine();
    const items = Array.from({ length: 1000 }, (_, i) => `file-${i}.tsx`);
    const query = 'file-500';

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      engine.search(query, items, { limit: 10 });
    }
    const duration = performance.now() - start;

    // 100 次搜索应该在 1 秒内完成
    expect(duration).toBeLessThan(1000);
  });
});

describe('评分一致性', () => {
  let engine: FuzzyMatchEngine;

  beforeEach(() => {
    engine = createFuzzyMatchEngine();
  });

  it('完全匹配应该得到最高分', () => {
    const items = ['button', 'buttons', 'button-primary', 'my-button'];
    const results = engine.search('button', items);

    expect(results[0].item).toBe('button');
    expect(results[0].score).toBe(1);
  });

  it('前缀匹配应该优于后缀匹配', () => {
    const items = ['button', 'mybutton'];
    const results = engine.search('butt', items);

    expect(results[0].item).toBe('button');
  });

  it('连续匹配应该优于分散匹配', () => {
    const items = ['abcdef', 'aXbXcXdXeXf'];
    const results = engine.search('abcdef', items);

    expect(results[0].item).toBe('abcdef');
  });

  it('短目标应该优于长目标（同等匹配时）', () => {
    const items = ['Button.tsx', 'ButtonComponent.tsx'];
    const results = engine.search('btn', items);

    // 两者都匹配 btn，但较短的应该排在前面
    expect(results[0].item).toBe('Button.tsx');
  });
});
