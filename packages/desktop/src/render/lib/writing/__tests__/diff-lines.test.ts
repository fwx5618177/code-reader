// ================================
// 版本对比的按行差分：先按行对齐（Histogram），再标出行内变化
// ================================

import { describe, expect, it } from 'vitest';
import { lineDiff, type DiffLine } from '../components/diff-lines';

/** 便于断言：每行转成 “符号 + 文本” */
const render = (lines: DiffLine[]) =>
  lines.map((line) => {
    const sign = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
    return sign + line.segments.map((s) => s.text).join('');
  });

describe('lineDiff', () => {
  it('行内修改拆成旧行删除 + 新行插入，只标记变化片段', () => {
    const lines = lineDiff('hello world\nfoo', 'hello there\nfoo');
    expect(render(lines)).toEqual(['-hello world', '+hello there', ' foo']);
    expect(lines[0].segments.filter((s) => s.changed).map((s) => s.text).join('')).toBe('world');
    expect(lines[1].segments.filter((s) => s.changed).map((s) => s.text).join('')).toBe('there');
    expect(lines[2]).toMatchObject({ sourceLineNum: 2, targetLineNum: 2 });
  });

  it('整行删除与插入；最后一行有无换行不影响匹配', () => {
    expect(render(lineDiff('a\nb\nc', 'a\nc'))).toEqual([' a', '-b', ' c']);
    expect(render(lineDiff('a\nc', 'a\nb\nc\n'))).toEqual([' a', '+b', ' c']);
    expect(render(lineDiff('x\ny', 'x'))).toEqual([' x', '-y']);
    expect(render(lineDiff('', 'x'))).toEqual(['+x']);
  });

  it('段落移动与改写不会被拆成交错的碎片', () => {
    const source = '第一段\n\n第二段很长的一段内容\n\n第三段';
    const target = '第二段很长的一段内容\n\n第一段\n\n第三段';
    const lines = lineDiff(source, target);
    // 未移动的段落仍按整行对齐
    expect(lines.filter((line) => line.type === 'equal').map((line) => line.segments[0].text)).toContain('第三段');
    // 每一行都是完整的原文行或新文行
    for (const line of lines) {
      const text = line.segments.map((s) => s.text).join('');
      expect(source.split('\n').includes(text) || target.split('\n').includes(text)).toBe(true);
    }
  });

  it('每侧按行拼回后与原文一致，行号连续', () => {
    const source = '# 标题\n第一段内容\n第二段\n\n结尾';
    const target = '# 新标题\n第一段内容\n插入的一行\n第二段改了\n结尾';
    const lines = lineDiff(source, target);
    const side = (exclude: DiffLine['type']) =>
      lines
        .filter((line) => line.type !== exclude)
        .map((line) => line.segments.map((s) => s.text).join(''))
        .join('\n');
    expect(side('insert')).toBe(source);
    expect(side('delete')).toBe(target);
    const sourceNums = lines.filter((line) => line.type !== 'insert').map((line) => line.sourceLineNum);
    expect(sourceNums).toEqual(sourceNums.map((_, k) => k + 1));
  });
});
