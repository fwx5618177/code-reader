import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../parser';
import { topLevelBlockAtLine } from '../extract';

const SOURCE = [
  '# 标题', // 0
  '', // 1
  '第一段', // 2
  '续行', // 3
  '', // 4
  '- 列表一', // 5
  '- 列表二', // 6
  '', // 7
  '```js', // 8
  'code()', // 9
  '```', // 10
  '', // 11
  '| a | b |', // 12
  '| - | - |', // 13
  '| 1 | 2 |', // 14
  '', // 15
  '$$', // 16
  'x^2', // 17
  '$$', // 18
  '', // 19
  '---', // 20
  '', // 21
  '> 引用', // 22
  '', // 23
  '![[其他笔记]]', // 24
  '', // 25
  '末段 ^abc123', // 26
].join('\n');

describe('topLevelBlockAtLine', () => {
  it('源码行对应的顶层块序号与解析出的文档顶层节点一致', () => {
    const doc = parseMarkdown(SOURCE);
    const expected: Array<[number, string]> = [
      [0, 'heading'],
      [3, 'paragraph'],
      [6, 'bullet_list'],
      [9, 'code_block'],
      [14, 'table'],
      [17, 'math_block'],
      [20, 'horizontal_rule'],
      [22, 'blockquote'],
      [24, 'wiki_embed'],
      [26, 'paragraph'],
    ];
    for (const [line, type] of expected) {
      const index = topLevelBlockAtLine(SOURCE, line)!;
      expect(doc.child(index).type.name, `第 ${line} 行`).toBe(type);
    }
    expect(topLevelBlockAtLine(SOURCE, 26)).toBe(doc.childCount - 1);
  });

  it('块之间的空行取下一个块，超出末尾取最后一个块，空文档为 null', () => {
    expect(topLevelBlockAtLine(SOURCE, 1)).toBe(1);
    expect(topLevelBlockAtLine(SOURCE, 999)).toBe(topLevelBlockAtLine(SOURCE, 26));
    expect(topLevelBlockAtLine('', 0)).toBeNull();
  });
});
