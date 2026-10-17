// ================================
// 字符级差分按行展示测试
// ================================

import { describe, expect, it } from 'vitest';
import { quickDiff } from '@code-reader/diff-algorithm';
import { diffsToLines, type Diff, type DiffLine } from '../components/diff-lines';

/** 便于断言：每行转成 “符号 + 文本” */
const render = (lines: DiffLine[]) =>
  lines.map((line) => {
    const sign = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
    return sign + line.segments.map((s) => s.text).join('');
  });

describe('diffsToLines', () => {
  it('行内修改拆成旧行删除 + 新行插入，只标记变化片段', () => {
    const diffs: Diff[] = [
      [0, 'hello '],
      [-1, 'world'],
      [1, 'there'],
      [0, '\nfoo'],
    ];
    const lines = diffsToLines(diffs);
    expect(render(lines)).toEqual(['-hello world', '+hello there', ' foo']);
    expect(lines[0].segments).toEqual([
      { text: 'hello ', changed: false },
      { text: 'world', changed: true },
    ]);
    expect(lines[2]).toMatchObject({ sourceLineNum: 2, targetLineNum: 2 });
  });

  it('整行删除与插入', () => {
    expect(render(diffsToLines([[0, 'a\n'], [-1, 'b\n'], [0, 'c']]))).toEqual([' a', '-b', ' c']);
    expect(render(diffsToLines([[0, 'a\n'], [1, 'b\n'], [0, 'c']]))).toEqual([' a', '+b', ' c']);
  });

  it('删除换行导致两行合并', () => {
    expect(render(diffsToLines([[0, 'a'], [-1, 'b\n'], [0, 'cd']]))).toEqual(['-ab', '-cd', '+acd']);
  });

  it('末尾换行不产生多余空行，从空内容新增只有插入行', () => {
    expect(render(diffsToLines([[0, 'a\n']]))).toEqual([' a']);
    expect(render(diffsToLines([[0, 'a\n'], [1, 'b']]))).toEqual([' a', '+b']);
    expect(render(diffsToLines([[1, 'x']]))).toEqual(['+x']);
  });

  it('真实差分结果：每侧按行拼回后与原文一致', () => {
    const source = '# 标题\n第一段内容\n第二段\n\n结尾';
    const target = '# 新标题\n第一段内容\n插入的一行\n第二段改了\n结尾';
    const lines = diffsToLines(quickDiff(source, target).diffs as readonly Diff[]);
    const side = (type: DiffLine['type']) =>
      lines
        .filter((line) => line.type !== type)
        .map((line) => line.segments.map((s) => s.text).join(''))
        .join('\n');
    expect(side('insert')).toBe(source);
    expect(side('delete')).toBe(target);
  });
});
