// ================================
// 重命名改写链接测试
// ================================

import { describe, it, expect } from 'vitest';
import { isLinkableTitle, planLinkRename, rewriteLinksForRename } from '../rename';

/** 只关心改写后的内容 */
function rewrite(markdown: string, oldTitle = 'Old', newTitle = 'New'): string {
  return rewriteLinksForRename(markdown, oldTitle, newTitle).content;
}

describe('重命名改写链接', () => {
  it('保留别名、标题与嵌入标记', () => {
    const source = '见 [[Old]]、[[Old|别名]]、[[Old#第一节]]、[[Old#第一节|别名]]\n\n![[Old]]\n\n![[Old#h|x]]\n';
    const result = rewriteLinksForRename(source, 'Old', 'New');
    expect(result.content).toBe(
      '见 [[New]]、[[New|别名]]、[[New#第一节]]、[[New#第一节|别名]]\n\n![[New]]\n\n![[New#h|x]]\n'
    );
    expect(result.count).toBe(6);
  });

  it('与链接解析一致：忽略大小写、空白与扩展名', () => {
    expect(rewrite('[[old]] [[ OLD ]] [[Old.md]]', 'Old.md', 'New.md')).toBe('[[New]] [[ New ]] [[New.md]]');
  });

  it('不改动其他链接与同名前缀', () => {
    const source = '[[Older]] [[Old note]] [[#Old]] [[Other#Old]] [[Other|Old]]';
    expect(rewriteLinksForRename(source, 'Old', 'New')).toEqual({ content: source, count: 0 });
  });

  it('跳过代码块、行内代码与公式中的链接', () => {
    const source = [
      '`[[Old]]` 与 ``[[Old]]`` 外 [[Old]]',
      '',
      '```',
      '[[Old]]',
      '![[Old]]',
      '```',
      '',
      '    [[Old]] 缩进代码',
      '',
      '$[[Old]]$',
      '',
      '$$',
      '[[Old]]',
      '$$',
      '',
    ].join('\n');
    const result = rewriteLinksForRename(source, 'Old', 'New');
    expect(result.count).toBe(1);
    expect(result.content).toBe(source.replace('外 [[Old]]', '外 [[New]]'));
  });

  it('处理引用、列表、任务、标题与多行段落', () => {
    const source = [
      '# 关于 [[Old]] #',
      '',
      '> 引用 [[Old]]',
      '> 第二行 [[Old|o]]',
      '',
      '- [ ] 任务 [[Old]]',
      '- [x] [[Old#h]]',
      '  1. 嵌套 [[Old]]',
      '',
      '段落第一行',
      '   缩进的续行 [[Old]] 和 [[Old]]',
    ].join('\n');
    const result = rewriteLinksForRename(source, 'Old', 'New');
    expect(result.count).toBe(8);
    expect(result.content).toBe(source.replace(/\[\[Old/g, '[[New'));
  });

  it('块级嵌入出现在引用与列表中', () => {
    const source = '> ![[Old]]\n\n- 项\n\n  ![[Old#h]]\n\n- ![[Old]]\n';
    expect(rewrite(source)).toBe(source.replace(/\[\[Old/g, '[[New'));
  });

  it('表格中的链接（含转义的别名分隔符）按单元格定位', () => {
    const source = [
      '| `[[Old]]` | [[Old\\|别名]] |',
      '| --- | --- |',
      '| [[Old]] | x [[Old#h]] |',
    ].join('\n');
    const result = rewriteLinksForRename(source, 'Old', 'New');
    expect(result.count).toBe(3);
    expect(result.content).toBe(
      ['| `[[Old]]` | [[New\\|别名]] |', '| --- | --- |', '| [[New]] | x [[New#h]] |'].join('\n')
    );
  });

  it('保留 CRLF 换行', () => {
    const source = '第一行\r\n[[Old]]\r\n\r\n> [[Old]]\r\n';
    expect(rewrite(source)).toBe('第一行\r\n[[New]]\r\n\r\n> [[New]]\r\n');
  });

  it('多字节字符与同一行多个链接', () => {
    expect(rewrite('😀[[旧笔记]]中文[[旧笔记|别名]]😀', '旧笔记.md', '新笔记.md')).toBe(
      '😀[[新笔记]]中文[[新笔记|别名]]😀'
    );
  });

  it('判断标题能否作为链接目标', () => {
    expect(isLinkableTitle('a#b')).toBe(false);
    expect(isLinkableTitle('a|b')).toBe(false);
    expect(isLinkableTitle('[a]')).toBe(false);
    expect(isLinkableTitle('.md')).toBe(false);
    expect(isLinkableTitle('正常标题.md')).toBe(true);
  });

  it('计划只包含发生变化的文档并汇总数量', () => {
    const plan = planLinkRename(
      [
        { id: '1', content: '[[Old]] [[Old#h]]' },
        { id: '2', content: '无关' },
        { id: '3', content: '![[old]]' },
      ],
      'Old.md',
      'New.md'
    );
    expect(plan.count).toBe(3);
    expect(plan.changes).toEqual([
      { id: '1', content: '[[New]] [[New#h]]', count: 2 },
      { id: '3', content: '![[New]]', count: 1 },
    ]);
  });

  it('仅大小写变化时链接仍可解析，不改写', () => {
    expect(planLinkRename([{ id: '1', content: '[[Old]]' }], 'Old', 'old').count).toBe(0);
  });
});
