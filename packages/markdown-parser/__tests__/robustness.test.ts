// ================================
// Markdown 解析的健壮性：CommonMark 规范中曾使解析器卡死的输入必须能在有限时间内完成，
// 多行段落后的 setext 下划线解析为标题
// ================================

import { describe, expect, it } from 'vitest';
import { parseCommonMark, BlockType } from '../src';

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
});
