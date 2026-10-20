// ================================
// Markdown 解析/序列化测试
// 核心约束：Markdown → 文档 → Markdown 往返稳定
// ================================

import { describe, expect, it } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';
import {
  extractWikiLinks,
  isLegacyHtml,
  markdownSchema,
  markdownToPlainText,
  parseContent,
  parseMarkdown,
  parsePlainText,
  renderContentToHtml,
  serializeMarkdown,
  serializePlainText,
} from '../index';

/** 往返：解析后再序列化 */
function roundTrip(markdown: string): string {
  return serializeMarkdown(parseMarkdown(markdown));
}

describe('Markdown 往返', () => {
  const samples: Record<string, string> = {
    标题与段落: '# 标题\n\n正文段落\n',
    强调: '**粗体** *斜体* ~~删除~~ `代码`\n',
    链接与图片: '[链接](https://example.com) ![图](a.png)\n',
    无序列表: '- 一\n- 二\n  - 嵌套\n',
    有序列表: '1. 一\n2. 二\n',
    任务列表: '- [ ] 待办\n- [x] 完成\n',
    引用: '> 引用内容\n',
    代码块: '```ts\nconst a = 1;\n```\n',
    分割线: '---\n',
    行内公式: '质能方程 $E = mc^2$ 成立\n',
    块级公式: '$$\n\\int_0^1 x\\,dx\n$$\n',
    双向链接: '参见 [[文档 A]] 和 [[文档 B|别名]]\n',
    表格: '| 名称 | 数量 |\n| :--- | ---: |\n| 苹果 | 3 |\n',
    YAML头部: '---\ntitle: 周报\ntags: [工作, 复盘]\n---\n\n# 正文\n',
  };

  for (const [name, markdown] of Object.entries(samples)) {
    it(name, () => {
      const once = roundTrip(markdown);
      expect(once).toBe(markdown);
      expect(roundTrip(once)).toBe(once);
    });
  }

  it('正文中的 $ 被转义，不会变成公式', () => {
    const doc = markdownSchema.nodes.doc.create(null, [
      markdownSchema.nodes.paragraph.create(null, markdownSchema.text('价格 $5 与 $10')),
    ]);
    const markdown = serializeMarkdown(doc);
    expect(parseMarkdown(markdown).textContent).toBe('价格 $5 与 $10');
  });

  it('相邻的同类列表保持独立', () => {
    const list = (text: string) =>
      markdownSchema.nodes.bullet_list.create(null, [
        markdownSchema.nodes.list_item.create(null, [
          markdownSchema.nodes.paragraph.create(null, markdownSchema.text(text)),
        ]),
      ]);
    const doc = markdownSchema.nodes.doc.create(null, [list('a'), list('b')]);
    const reparsed = parseMarkdown(serializeMarkdown(doc));
    expect(reparsed.childCount).toBe(2);
  });

  it('未修改的块复用缓存结果', () => {
    const doc = parseMarkdown('# A\n\n段落一\n\n段落二\n');
    const first = serializeMarkdown(doc);
    // 只替换最后一个块，前两个块保持同一引用
    const replacement = markdownSchema.nodes.paragraph.create(null, markdownSchema.text('新段落'));
    const changed = doc.replace(
      doc.content.size - doc.lastChild!.nodeSize,
      doc.content.size,
      new Slice(Fragment.from(replacement), 0, 0)
    );
    expect(changed.child(0)).toBe(doc.child(0));
    expect(serializeMarkdown(changed)).toBe(first.replace('段落二', '新段落'));
  });

  it('中文软换行不引入空格', () => {
    expect(parseMarkdown('第一行\n第二行').textContent).toBe('第一行第二行');
    expect(parseMarkdown('first\nsecond').textContent).toBe('first second');
  });

  it('YAML 头部只在文档开头识别，不会变成分割线与标题；未闭合时按普通内容', () => {
    const doc = parseMarkdown('---\na: 1\n---\n正文\n');
    expect(doc.firstChild!.type.name).toBe('front_matter');
    expect(doc.firstChild!.textContent).toBe('a: 1');
    expect(roundTrip('---\na: 1\n---\n正文\n')).toBe('---\na: 1\n---\n\n正文\n');
    expect(parseMarkdown('正文\n\n---\na: 1\n---\n').firstChild!.type.name).toBe('paragraph');
    expect(parseMarkdown('---\na: 1\n').firstChild!.type.name).toBe('horizontal_rule');
    expect(roundTrip('---\n---\n正文\n')).toBe('---\n---\n\n正文\n');
  });
});

describe('格式兼容', () => {
  it('识别并转换旧版 HTML 内容', () => {
    const html = '<h1>标题</h1><p>正文 <strong>粗体</strong></p>';
    expect(isLegacyHtml(html)).toBe(true);
    expect(isLegacyHtml('# 标题')).toBe(false);
    expect(serializeMarkdown(parseContent(html, 'markdown'))).toBe('# 标题\n\n正文 **粗体**\n');
  });

  it('纯文本按行往返，不解释 Markdown', () => {
    const text = '# 不是标题\n\n**不是粗体**';
    const doc = parsePlainText(text);
    expect(doc.childCount).toBe(3);
    expect(serializePlainText(doc)).toBe(text);
  });
});

describe('提取', () => {
  it('提取双向链接并忽略代码中的 [[…]]', () => {
    const links = extractWikiLinks('见 [[A]] 与 [[B|别名]]\n\n```\n[[代码]]\n```\n\n`[[行内]]`');
    expect(links.map((l) => [l.target, l.alias])).toEqual([
      ['A', null],
      ['B', '别名'],
    ]);
    expect(links[0].context).toBe('见 A 与 别名');
  });

  it('纯文本提取去除标记', () => {
    expect(markdownToPlainText('# 标题\n\n**粗** [[链接]]')).toBe('标题\n粗 链接');
  });
});

describe('HTML 渲染', () => {
  it('公式使用自研渲染器、标题带锚点', () => {
    const { html, headings } = renderContentToHtml('# 一\n\n$x^2$\n\n## 二', 'markdown');
    expect(html).toContain('math-root');
    expect(headings).toEqual([
      { id: 'heading-0', level: 1, text: '一' },
      { id: 'heading-1', level: 2, text: '二' },
    ]);
  });

  it('双向链接渲染为可点击元素', () => {
    const { html } = renderContentToHtml('[[目标]]', 'markdown');
    expect(html).toContain('data-wiki-target="目标"');
  });
});
