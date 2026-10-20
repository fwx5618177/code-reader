import { describe, expect, it } from 'vitest';
import { findPageContaining, findTextBlock, findTextElements, plainTextOfSourceLine } from '../text-locate';

describe('按文字定位', () => {
  it('在渲染后的正文中找到命中行所在的块：忽略空白与换行、跨越行内元素', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h1>标题</h1><p>第一段</p><ul><li>列表 <strong>重点</strong>\n  内容 TODO</li></ul>';
    const block = findTextBlock(root, plainTextOfSourceLine('- 列表 **重点** 内容 TODO'));
    expect(block?.tagName).toBe('LI');
    expect(findTextBlock(root, '不存在的文字')).toBeNull();
    expect(findTextBlock(root, '   ')).toBeNull();
  });

  it('源码行去掉 Markdown 标记；去不掉时用原文', () => {
    expect(plainTextOfSourceLine('## [链接](http://a) 与 `代码`')).toBe('链接 与 代码');
    expect(plainTextOfSourceLine('---')).toBe('---');
  });

  it('PDF 按页文本找到包含命中行的第一页（页码从 1 计，忽略空白）', () => {
    const pages = ['封面', '第二页 内容\n关键 字', '关键字 再次出现'];
    expect(findPageContaining(pages, '关键字')).toBe(2);
    expect(findPageContaining(pages, '没有')).toBeNull();
  });

  it('PDF 文本层中命中文字跨越的全部片段（用于页内高亮）', () => {
    const layer = document.createElement('div');
    layer.innerHTML = '<span>第一行 开头</span><br><span>关键</span><span>字 在</span><span>这里</span><span>其他</span>';
    expect(findTextElements(layer, '关键字在这里').map((element) => element.textContent)).toEqual(['关键', '字 在', '这里']);
    expect(findTextElements(layer, '不存在')).toEqual([]);
  });
});
