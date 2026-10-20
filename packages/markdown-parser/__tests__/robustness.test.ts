// ================================
// Markdown 解析的健壮性：CommonMark 规范中曾使解析器卡死的输入必须能在有限时间内完成，
// 多行段落后的 setext 下划线解析为标题
// ================================

import { describe, expect, it } from 'vitest';
import { parseCommonMark, renderHtml, BlockType } from '../src';

/** CommonMark 0.31.2 规范用例 81、82、93、138、145、215、278、347 */
const FORMERLY_HANGING = [
  'Foo *bar\nbaz*\n====\n',
  '  Foo *bar\nbaz*\t\n====\n',
  '> foo\nbar\n===\n',
  '``` ```\naaa\n',
  '``` aa ```\nfoo\n',
  '[foo]: /url\nbar\n===\n[foo]\n',
  '-\n  foo\n-\n  ```\n  bar\n  ```\n-\n      baz\n',
  '```foo``\n',
];

describe('Markdown 解析健壮性', () => {
  it.each(FORMERLY_HANGING)('不会卡死：%j', (input) => {
    const started = performance.now();
    const result = parseCommonMark(input);
    expect(result.document.children?.length ?? 0).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('多行段落后的 setext 下划线：整段成为标题', () => {
    const [heading] = parseCommonMark('Foo\nbar\n---\nbaz\n').document.children!;
    expect(heading).toMatchObject({ type: BlockType.Heading, level: 2, content: 'Foo\nbar' });
  });

  it('信息串含反引号的“围栏”按段落文本处理', () => {
    const [paragraph] = parseCommonMark('``` aa ```\nfoo\n').document.children!;
    expect(paragraph?.type).toBe(BlockType.Paragraph);
  });

  it('随机输入 2 万次（含全部扩展语法）：不抛错，没有稳定超过 50ms 的输入', () => {
    let seed = 1;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pieces = ['*', '_', '[', ']', '(', ')', '`', '<', '>', '\n', ' ', '-', '#', '|', '!', '\\', '&amp;', 'a', '1.', '    ', '~', '"', "'", '\t', ':', '[^1]', '=', '+', '^', '{', '}', '{.c}', 'www.a.b', 'a@b.c', 'x.com/p', '中文.cn', '*[a]: b', ':::', ': ', '---'];
    const options = {
      smartPunctuation: true,
      linkify: true,
      linkifyBareDomains: true,
      replacements: true,
      mark: true,
      insert: true,
      subscript: true,
      superscript: true,
      abbreviations: true,
      definitionLists: true,
      containers: true,
      frontMatter: true,
      attributes: true,
    };
    const LIMIT = 50;
    const run = (text: string, i: number) => {
      const started = performance.now();
      renderHtml(parseCommonMark(text, i % 2 === 0 ? options : { smartPunctuation: true }).document);
      return performance.now() - started;
    };
    const slow: string[] = [];
    for (let i = 0; i < 20000; i++) {
      const text = Array.from({ length: 1 + Math.floor(random() * 60) }, () => pieces[Math.floor(random() * pieces.length)]).join('');
      // 超时的输入重测 5 次取最快：病态输入每次都慢，并行跑测试时的调度与 GC 停顿不会每次出现
      if (run(text, i) >= LIMIT && Math.min(...Array.from({ length: 5 }, () => run(text, i))) >= LIMIT) slow.push(text);
    }
    expect(slow).toEqual([]);
  });
});
