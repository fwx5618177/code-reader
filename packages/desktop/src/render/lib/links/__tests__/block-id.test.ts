// ================================
// 为其他文档的块写入 ID 测试
// ================================

import { describe, it, expect } from 'vitest';
import { summarizeBlocks, type BlockIdSlot } from '../../markdown';
import { addBlockIdToMarkdown } from '../block-id';

/** 文本为 text 的块（summarizeBlocks 顺序）的写入位置 */
function slotOf(markdown: string, text: string): BlockIdSlot {
  return summarizeBlocks(markdown).find((block) => block.text === text)!.slot!;
}

const append = (anchorIndex: number): BlockIdSlot => ({ kind: 'append', anchorIndex });

describe('addBlockIdToMarkdown', () => {
  it('段落：写在最后一行末尾，其余源码不变', () => {
    const source = '第一段\n\n多行段落\n第二行  \n\n后文\n';
    expect(addBlockIdToMarkdown(source, slotOf(source, '多行段落第二行'), 'abc')).toBe(
      '第一段\n\n多行段落\n第二行 ^abc  \n\n后文\n'
    );
  });

  it('ATX 标题写在结尾 # 之前；Setext 标题写在文字行', () => {
    expect(addBlockIdToMarkdown('## 标题 ##\n', append(0), 'h')).toBe('## 标题 ^h ##\n');
    expect(addBlockIdToMarkdown('# 标题\n', append(0), 'h')).toBe('# 标题 ^h\n');
    expect(addBlockIdToMarkdown('标题\n===\n', append(0), 's')).toBe('标题 ^s\n===\n');
  });

  it('列表项、引用与嵌套结构', () => {
    const list = '- 一\n- 二\n  - 子项\n';
    expect(addBlockIdToMarkdown(list, slotOf(list, '子项'), 'sub')).toBe('- 一\n- 二\n  - 子项 ^sub\n');
    expect(addBlockIdToMarkdown(list, slotOf(list, '二'), 'two')).toBe('- 一\n- 二 ^two\n  - 子项\n');
    expect(addBlockIdToMarkdown('> 引用\n> 第二行\n', append(0), 'q')).toBe('> 引用\n> 第二行 ^q\n');
  });

  it('写入后可被解析为同一个块', () => {
    const source = '前文\n\n```\n代码\n```\n\n| a |\n| --- |\n| 1 |\n\n目标段落\n';
    const result = addBlockIdToMarkdown(source, slotOf(source, '目标段落'), 'tgt')!;
    expect(summarizeBlocks(result).find((block) => block.id === 'tgt')).toMatchObject({
      text: '目标段落',
      kind: 'paragraph',
    });
  });

  it('表格、代码块：在其后插入独立一段 ^id，前后以空行分隔', () => {
    const source = '前文\n\n| a |\n| --- |\n| 1 |\n\n后文\n';
    const table = addBlockIdToMarkdown(source, slotOf(source, 'a 1'), 'tbl')!;
    expect(table).toBe('前文\n\n| a |\n| --- |\n| 1 |\n\n^tbl\n\n后文\n');
    expect(summarizeBlocks(table).find((block) => block.id === 'tbl')).toMatchObject({ kind: 'table', text: 'a 1' });

    // 代码块紧接段落时补空行，标记不并入后文
    const fenced = '```\nx\n```\n后文\n';
    expect(addBlockIdToMarkdown(fenced, slotOf(fenced, 'x'), 'f')).toBe('```\nx\n```\n\n^f\n\n后文\n');

    // 相邻的两个代码块按序号区分；下一行已是空行时不再补空行
    const code = '```js\none\n```\n\n```\ntwo\n```\n';
    const second = addBlockIdToMarkdown(code, slotOf(code, 'two'), 'c2')!;
    expect(second).toBe('```js\none\n```\n\n```\ntwo\n```\n\n^c2\n');
    const first = addBlockIdToMarkdown(code, slotOf(code, 'one'), 'c1')!;
    expect(first).toBe('```js\none\n```\n\n^c1\n\n```\ntwo\n```\n');
    expect(summarizeBlocks(first).map((block) => [block.id, block.text])).toEqual([
      ['c1', 'one'],
      [null, 'two'],
    ]);
  });

  it('引用、列表中的代码块沿用容器前缀', () => {
    const quoted = '> ```\n> code\n> ```\n';
    expect(addBlockIdToMarkdown(quoted, slotOf(quoted, 'code'), 'q')).toBe('> ```\n> code\n> ```\n>\n> ^q\n');
    const listed = '- 项\n\n  ```\n  code\n  ```\n';
    expect(addBlockIdToMarkdown(listed, slotOf(listed, 'code'), 'l')).toBe('- 项\n\n  ```\n  code\n  ```\n\n  ^l\n');
  });

  it('块不存在或无法安全写入时返回 null', () => {
    expect(addBlockIdToMarkdown('一段\n', append(3), 'x')).toBeNull();
    expect(addBlockIdToMarkdown('', append(0), 'x')).toBeNull();
    expect(addBlockIdToMarkdown('一段\n', { kind: 'after', node: 'table', index: 0 }, 'x')).toBeNull();
    // 缩进代码块之后的缩进行仍属于代码块，写入后校验失败
    expect(addBlockIdToMarkdown('    code\n', { kind: 'after', node: 'code_block', index: 0 }, 'x')).toBeNull();
  });
});
