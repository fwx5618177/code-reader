// ================================
// 解析选项与 GFM 扩展：渲染结果按 cmark-gfm / commonmark.js 的约定
// ================================

import { describe, expect, it } from 'vitest';
import { BlockType, parseCommonMark, renderHtml } from '../src';

const html = (markdown: string, options = {}) => renderHtml(parseCommonMark(markdown, options).document);

describe('GFM 扩展', () => {
  it('表格：对齐、转义的竖线、行内格式，遇到空行或其他块结束', () => {
    expect(html('| a | b |\n|:-|-:|\n| `x\\|y` | **2** |\n> q\n')).toBe(
      '<table>\n<thead>\n<tr>\n<th align="left">a</th>\n<th align="right">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="left"><code>x|y</code></td>\n<td align="right"><strong>2</strong></td>\n</tr>\n</tbody>\n</table>\n<blockquote>\n<p>q</p>\n</blockquote>\n'
    );
  });

  it('列数不一致时不是表格', () => {
    expect(html('| a | b |\n|-|\n')).toBe('<p>| a | b |\n|-|</p>\n');
  });

  it('任务列表项与删除线', () => {
    const document = parseCommonMark('- [x] 完成 ~~旧~~\n- [ ] 待办\n').document;
    const [list] = document.children!;
    expect(list!.children!.map((item) => [item.type, item.checked])).toEqual([
      [BlockType.TaskListItem, true],
      [BlockType.TaskListItem, false],
    ]);
    expect(renderHtml(document)).toContain('<del>旧</del>');
  });

  it('脚注：按第一次引用编号，定义收集到文末', () => {
    const output = html('正文[^b] 与[^a]\n\n[^a]: 甲\n[^b]: 乙\n');
    expect(output).toContain('<a href="#fn1" id="fnref1">[1]</a>');
    expect(output).toContain('<a href="#fn2" id="fnref2">[2]</a>');
    expect(output).toContain('<li id="fn1" class="footnote-item"><p>乙');
  });
});

describe('解析选项', () => {
  it('smartPunctuation：弯引号、撇号、连接号、破折号、省略号', () => {
    expect(html(`"Hello," she said -- it's 1990---2000...`, { smartPunctuation: true })).toBe(
      '<p>\u201CHello,\u201D she said \u2013 it\u2019s 1990\u20142000\u2026</p>\n'
    );
    expect(html(`"plain" -- ...`)).toBe('<p>&quot;plain&quot; -- ...</p>\n');
  });

  it('hardBreaks：段落内的普通换行输出为 <br />', () => {
    expect(html('a\nb', { hardBreaks: true })).toBe('<p>a<br />\nb</p>\n');
    expect(html('a\nb')).toBe('<p>a\nb</p>\n');
  });

  it('html 与 autolink 可关闭', () => {
    expect(html('<div>x</div>\n\n<b>y</b> <https://a.b>', { html: false, autolink: false })).toBe(
      '<p>&lt;div&gt;x&lt;/div&gt;</p>\n<p>&lt;b&gt;y&lt;/b&gt; &lt;https://a.b&gt;</p>\n'
    );
  });

  it('maxNestingDepth：超过层数的部分按文本处理并给出警告', () => {
    const result = parseCommonMark('> > > > 深', { maxNestingDepth: 3 });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(renderHtml(result.document)).toContain('&gt; 深');
  });

  it('位置信息：行内节点带行列与偏移', () => {
    const [paragraph] = parseCommonMark('第一行\n**粗体** [链接](u)\n').document.children!;
    const [, , bold, , link] = paragraph!.inline!;
    expect(bold!.position).toMatchObject({ startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 });
    expect(link!.position.startLine).toBe(2);
  });
});
