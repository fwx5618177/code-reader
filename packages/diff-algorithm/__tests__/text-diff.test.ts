// ================================
// 文本差分算法测试
// ================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TextDiffEngine,
  createTextDiffEngine,
  createFastTextDiffEngine,
  quickTextDiff,
  quickLineDiff,
  quickApplyTextDiff,
  quickDiffStats,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from '../src';

describe('TextDiffEngine', () => {
  let engine: TextDiffEngine;

  beforeEach(() => {
    engine = createTextDiffEngine();
  });

  describe('diff', () => {
    it('应该正确处理相同文本', () => {
      const text = '这是一段测试文本';
      const result = engine.diff(text, text);

      expect(result.diffs).toHaveLength(1);
      expect(result.diffs[0][0]).toBe(DIFF_EQUAL);
      expect(result.diffs[0][1]).toBe(text);
    });

    it('应该正确处理完全不同的文本', () => {
      const source = 'aaa';
      const target = 'bbb';
      const result = engine.diff(source, target);

      expect(result.diffs.length).toBeGreaterThan(0);
      // 应该包含删除和插入操作
      const hasDelete = result.diffs.some((d) => d[0] === DIFF_DELETE);
      const hasInsert = result.diffs.some((d) => d[0] === DIFF_INSERT);
      expect(hasDelete).toBe(true);
      expect(hasInsert).toBe(true);
    });

    it('应该正确处理文本插入', () => {
      const source = 'hello';
      const target = 'hello world';
      const result = engine.diff(source, target);

      // 应该有等于部分和插入部分
      const equalPart = result.diffs.find(
        (d) => d[0] === DIFF_EQUAL && d[1].includes('hello')
      );
      const insertPart = result.diffs.find(
        (d) => d[0] === DIFF_INSERT && d[1].includes('world')
      );

      expect(equalPart).toBeDefined();
      expect(insertPart).toBeDefined();
    });

    it('应该正确处理文本删除', () => {
      const source = 'hello world';
      const target = 'hello';
      const result = engine.diff(source, target);

      // 应该有删除部分
      const deletePart = result.diffs.find(
        (d) => d[0] === DIFF_DELETE && d[1].includes('world')
      );

      expect(deletePart).toBeDefined();
    });

    it('应该正确处理空文本', () => {
      const result1 = engine.diff('', 'text');
      expect(result1.diffs).toHaveLength(1);
      expect(result1.diffs[0][0]).toBe(DIFF_INSERT);

      const result2 = engine.diff('text', '');
      expect(result2.diffs).toHaveLength(1);
      expect(result2.diffs[0][0]).toBe(DIFF_DELETE);

      const result3 = engine.diff('', '');
      expect(result3.diffs).toHaveLength(0);
    });

    it('应该正确处理中文文本', () => {
      const source = '你好世界';
      const target = '你好中国';
      const result = engine.diff(source, target);

      expect(result.diffs.length).toBeGreaterThan(0);
      // 重建目标文本
      const rebuilt = result.diffs
        .filter((d) => d[0] !== DIFF_DELETE)
        .map((d) => d[1])
        .join('');
      expect(rebuilt).toBe(target);
    });

    it('应该正确处理多行文本', () => {
      const source = 'line1\nline2\nline3';
      const target = 'line1\nmodified\nline3';
      const result = engine.diff(source, target);

      expect(result.diffs.length).toBeGreaterThan(0);
      // 验证可以重建目标
      const rebuilt = result.diffs
        .filter((d) => d[0] !== DIFF_DELETE)
        .map((d) => d[1])
        .join('');
      expect(rebuilt).toBe(target);
    });
  });

  describe('lineDiff', () => {
    it('应该按行进行差分', () => {
      const source = 'line1\nline2\nline3';
      const target = 'line1\nmodified\nline3';
      const result = engine.lineDiff(source, target);

      expect(result.diffs.length).toBeGreaterThan(0);
    });

    it('应该正确处理添加新行', () => {
      const source = 'line1\nline2';
      const target = 'line1\nline2\nline3';
      const result = engine.lineDiff(source, target);

      const insertParts = result.diffs.filter((d) => d[0] === DIFF_INSERT);
      expect(insertParts.length).toBeGreaterThan(0);
    });
  });

  describe('applyDiff', () => {
    it('应该正确应用差分', () => {
      const source = 'hello world';
      const target = 'hello universe';

      const result = engine.diff(source, target);
      const applied = engine.applyDiff(source, result.diffs);

      expect(applied).toBe(target);
    });

    it('应该正确应用复杂差分', () => {
      const source =
        'function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}';
      const target =
        'function foo() {\n  return 42;\n}\n\nfunction baz() {\n  return 3;\n}';

      const result = engine.diff(source, target);
      const applied = engine.applyDiff(source, result.diffs);

      expect(applied).toBe(target);
    });

    it('应该正确处理空差分', () => {
      const source = 'unchanged text';
      const result = engine.diff(source, source);
      const applied = engine.applyDiff(source, result.diffs);

      expect(applied).toBe(source);
    });
  });

  describe('reverseDiff', () => {
    it('应该正确反转差分', () => {
      const source = 'hello';
      const target = 'world';

      const result = engine.diff(source, target);
      const reversed = engine.reverseDiff(result.diffs);

      // 反转后应用到 target 应该得到 source
      const applied = engine.applyDiff(target, reversed);
      expect(applied).toBe(source);
    });
  });

  describe('getStats', () => {
    it('应该正确计算统计信息', () => {
      const source = 'hello world';
      const target = 'hello universe';

      const result = engine.diff(source, target);
      const stats = engine.getStats(result.diffs);

      expect(stats.insertions).toBeGreaterThan(0);
      expect(stats.deletions).toBeGreaterThan(0);
      expect(stats.unchanged).toBeGreaterThan(0);
      expect(stats.totalChars).toBe(stats.insertions + stats.deletions + stats.unchanged);
      // 插入 + 未变 = 目标长度，删除 + 未变 = 源长度
      expect(stats.insertions + stats.unchanged).toBe(target.length);
      expect(stats.deletions + stats.unchanged).toBe(source.length);
      expect(stats.changeRatio).toBeGreaterThan(0);
      expect(stats.changeRatio).toBeLessThan(1);
      expect(stats.levenshtein).toBeGreaterThan(0);
    });

    it('应该正确处理无变化的情况', () => {
      const text = 'no changes';
      const result = engine.diff(text, text);
      const stats = engine.getStats(result.diffs);

      expect(stats.insertions).toBe(0);
      expect(stats.deletions).toBe(0);
      expect(stats.unchanged).toBe(text.length);
      expect(stats.changeRatio).toBe(0);
      expect(stats.levenshtein).toBe(0);
    });
  });
});

describe('createFastTextDiffEngine', () => {
  it('应该创建快速差分引擎', () => {
    const engine = createFastTextDiffEngine();
    expect(engine).toBeDefined();

    const result = engine.diff('abc', 'abd');
    expect(result.diffs.length).toBeGreaterThan(0);
  });
});

describe('便捷函数', () => {
  describe('quickTextDiff', () => {
    it('应该正确计算文本差分', () => {
      const result = quickTextDiff('hello', 'hello world');

      expect(result.diffs.length).toBeGreaterThan(0);
    });
  });

  describe('quickLineDiff', () => {
    it('应该正确计算行差分', () => {
      const result = quickLineDiff('a\nb\nc', 'a\nx\nc');

      expect(result.diffs.length).toBeGreaterThan(0);
    });
  });

  describe('quickApplyTextDiff', () => {
    it('应该正确应用差分', () => {
      const source = 'original text';
      const target = 'modified text';

      const diffResult = quickTextDiff(source, target);
      const applied = quickApplyTextDiff(source, diffResult.diffs);

      expect(applied).toBe(target);
    });
  });

  describe('quickDiffStats', () => {
    it('应该正确计算统计信息', () => {
      const stats = quickDiffStats(quickTextDiff('hello', 'world').diffs);

      expect(stats.insertions).toBeGreaterThan(0);
      expect(stats.deletions).toBeGreaterThan(0);
      expect(stats.changeRatio).toBeGreaterThan(0);
    });
  });
});

describe('边界情况', () => {
  let engine: TextDiffEngine;

  beforeEach(() => {
    engine = createTextDiffEngine();
  });

  it('应该处理超长文本', () => {
    const longText = 'a'.repeat(10000);
    const modifiedText = longText.slice(0, 5000) + 'b' + longText.slice(5001);

    const result = engine.diff(longText, modifiedText);
    const applied = engine.applyDiff(longText, result.diffs);

    expect(applied).toBe(modifiedText);
  });

  it('应该处理特殊字符', () => {
    const source = 'hello\t\n\r world';
    const target = 'hello\t\n\r universe';

    const result = engine.diff(source, target);
    const applied = engine.applyDiff(source, result.diffs);

    expect(applied).toBe(target);
  });

  it('应该处理 Unicode 字符', () => {
    const source = '你好 🌍 世界';
    const target = '你好 🌏 世界';

    const result = engine.diff(source, target);
    const applied = engine.applyDiff(source, result.diffs);

    expect(applied).toBe(target);
  });

  it('应该处理重复模式', () => {
    const source = 'ababababab';
    const target = 'ababcababab';

    const result = engine.diff(source, target);
    const applied = engine.applyDiff(source, result.diffs);

    expect(applied).toBe(target);
  });
});
