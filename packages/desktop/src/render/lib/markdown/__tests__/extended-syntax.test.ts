// ================================
// 扩展语法：高亮 / 插入 / 上下标、裸网址、脚注、定义列表、::: 提示块、缩写
// 解析为对应节点、序列化往返不变；输入规则、回车转换与斜杠命令；缩写装饰与预览渲染；
// 正文中容易被误认成语法的文字只在必要时转义
// ================================

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { createEditorPlugins } from '../../editor';
import { abbreviationKey, createAbbreviationPlugin } from '../abbreviations';
import {
  extractHeadings,
  extractWikiLinks,
  markdownSchema,
  parseMarkdown,
  renderContentToHtml,
  serializeMarkdown,
  SlashCommandProvider,
} from '../index';

const roundTrip = (markdown: string) => serializeMarkdown(parseMarkdown(markdown));

/** 文档中所有节点与标记的类型名 */
function typesIn(doc: PMNode): Set<string> {
  const names = new Set<string>();
  doc.descendants((node) => {
    names.add(node.type.name);
    for (const mark of node.marks) names.add(mark.type.name);
  });
  return names;
}

describe('解析与往返', () => {
  const samples: Record<string, [markdown: string, types: string[]]> = {
    高亮插入上下标: ['==高亮== ++插入++ H~2~O 2^10^\n', ['highlight', 'insert', 'subscript', 'superscript']],
    上下标中的空格转义: ['a~b\\ c~ 与 x^y\\ z^\n', ['subscript', 'superscript']],
    裸网址与邮箱: ['见 https://example.com/a?b=1 与 www.example.org 与 me@example.com\n', ['link']],
    尖括号自动链接: ['<https://example.com>\n', ['link']],
    脚注: ['正文[^1] 与 [^note]\n\n[^1]: 第一条\n\n[^note]: 第一段\n\n    第二段\n', ['footnote_ref', 'footnote_def']],
    行内脚注: ['正文^[行内 **脚注** 内容]结束\n', ['footnote_inline']],
    未被引用的脚注定义: ['正文\n\n[^x]: 没有引用也保留\n', ['footnote_def']],
    紧凑定义列表: ['术语\n: 说明一\n: 说明二\n\n术语二\n: 说明\n', ['definition_list', 'definition_term', 'definition_description']],
    松散定义列表: ['术语\n\n: 第一段\n\n  第二段\n', ['definition_list']],
    提示块: ['::: warning 注意事项\n内容 **粗体**\n:::\n', ['container']],
    嵌套提示块: [':::: note\n外层\n\n::: tip\n内层\n:::\n::::\n', ['container']],
    缩写: ['*[HTML]: Hyper Text Markup Language\n\nHTML 文档\n', ['abbreviation_def']],
  };

  for (const [name, [markdown, types]] of Object.entries(samples)) {
    it(name, () => {
      const doc = parseMarkdown(markdown);
      for (const type of types) expect(typesIn(doc)).toContain(type);
      const once = serializeMarkdown(doc);
      expect(once).toBe(markdown);
      expect(roundTrip(once)).toBe(once);
    });
  }

  it('节点属性：脚注标签与内容、提示块名称与参数、链接的 linkify', () => {
    const doc = parseMarkdown('a[^n] b^[注] https://x.com\n\n[^n]: 定义\n\n::: tip 小贴士\n内容\n:::\n');
    const found: Record<string, unknown> = {};
    doc.descendants((node) => {
      if (node.type.name === 'footnote_ref') found.ref = node.attrs.label;
      if (node.type.name === 'footnote_inline') found.inline = node.attrs.content;
      if (node.type.name === 'footnote_def') found.def = node.attrs.label;
      if (node.type.name === 'container') found.container = [node.attrs.name, node.attrs.info];
      const link = node.marks.find((mark) => mark.type.name === 'link');
      if (link) found.link = [link.attrs.href, link.attrs.linkify];
    });
    expect(found).toEqual({
      ref: 'n',
      inline: '注',
      def: 'n',
      container: ['tip', ' tip 小贴士'],
      link: ['https://x.com', true],
    });
  });

  it('改动链接文字后，裸网址按 [文字](地址) 保存', () => {
    const doc = parseMarkdown('https://x.com\n');
    const paragraph = doc.firstChild!;
    const link = paragraph.firstChild!.marks[0]!;
    const edited = markdownSchema.nodes.doc.create(null, markdownSchema.nodes.paragraph.create(null, markdownSchema.text('官网', [link])));
    expect(serializeMarkdown(edited)).toBe('[官网](https://x.com)\n');
    expect(paragraph.childCount).toBe(1);
  });
});

describe('转义：只在会改变内容时转义', () => {
  const plain = (text: string) =>
    markdownSchema.nodes.doc.create(null, markdownSchema.nodes.paragraph.create(null, markdownSchema.text(text)));

  it('常见写法保持原样', () => {
    for (const text of ['C++ 与 a == b', '2^10 与 1+1=2', '约 ~5 分钟']) {
      const markdown = serializeMarkdown(plain(text));
      expect(parseMarkdown(markdown).textContent).toBe(text);
    }
    expect(serializeMarkdown(plain('C++ 与 a == b'))).toBe('C++ 与 a == b\n');
    expect(serializeMarkdown(plain('2^10 与 1+1=2'))).toBe('2^10 与 1+1=2\n');
  });

  it('会被解析成高亮、插入、上标的文字被转义，重新打开仍是原文', () => {
    for (const text of ['==不是高亮==', '++不是插入++', '2^10^ 不是上标', '[^1] 不是脚注', '*[X]: 不是缩写']) {
      const doc = parseMarkdown(serializeMarkdown(plain(text)));
      expect(doc.textContent).toBe(text);
      expect(typesIn(doc)).not.toContain('highlight');
      expect(typesIn(doc)).not.toContain('superscript');
      expect(typesIn(doc)).not.toContain('footnote_ref');
    }
  });

  it('段首的 : 与 ::: 不会变成定义列表或提示块', () => {
    const doc = markdownSchema.nodes.doc.create(null, [
      markdownSchema.nodes.paragraph.create(null, markdownSchema.text('术语')),
      markdownSchema.nodes.paragraph.create(null, markdownSchema.text(': 不是说明')),
      markdownSchema.nodes.paragraph.create(null, markdownSchema.text('::: note 不是提示块')),
    ]);
    const reparsed = parseMarkdown(serializeMarkdown(doc));
    expect(reparsed.childCount).toBe(3);
    expect(typesIn(reparsed)).not.toContain('definition_list');
    expect(typesIn(reparsed)).not.toContain('container');
  });
});

// ================================
// 编辑交互
// ================================

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function createEditor(markdown: string): EditorView {
  const doc = parseMarkdown(markdown);
  const state = EditorState.create({
    doc,
    plugins: [...createEditorPlugins(markdownSchema), keymap(baseKeymap), createAbbreviationPlugin()],
    selection: TextSelection.atEnd(doc),
  });
  view = new EditorView(document.createElement('div'), { state });
  return view;
}

function type(editor: EditorView, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.someProp('handleTextInput', (f) => f(editor, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

function press(editor: EditorView, key: string): boolean {
  return !!editor.someProp('handleKeyDown', (f) => f(editor, new KeyboardEvent('keydown', { key })));
}

describe('输入规则与回车转换', () => {
  it('==高亮== ++插入++ H~2~O 2^10^', () => {
    const editor = createEditor('');
    type(editor, '==亮== ++增++ H~2~O 2^10^');
    expect(serializeMarkdown(editor.state.doc)).toBe('==亮== ++增++ H~2~O 2^10^\n');
    expect([...typesIn(editor.state.doc)]).toEqual(expect.arrayContaining(['highlight', 'insert', 'subscript', 'superscript']));
  });

  it('~~删除线~~ 不被下标规则截获', () => {
    const editor = createEditor('');
    type(editor, '~~删~~');
    expect(typesIn(editor.state.doc)).toContain('strike');
    expect(typesIn(editor.state.doc)).not.toContain('subscript');
  });

  it('脚注：正文中的 [^1] 是引用，段首 [^1]: 是定义，^[…] 是行内脚注', () => {
    const editor = createEditor('');
    type(editor, '正文[^1] 与^[行内]');
    press(editor, 'Enter');
    type(editor, '[^1]: 定义内容');
    expect(serializeMarkdown(editor.state.doc)).toBe('正文[^1] 与^[行内]\n\n[^1]: 定义内容\n');
  });

  it('术语段落之后输入 ": " 变成定义列表；之后再输入一条说明', () => {
    const editor = createEditor('术语');
    press(editor, 'Enter');
    type(editor, ': 说明');
    expect(serializeMarkdown(editor.state.doc)).toBe('术语\n: 说明\n');
    press(editor, 'Enter');
    type(editor, ': 第二条');
    expect(serializeMarkdown(editor.state.doc)).toBe('术语\n: 说明\n: 第二条\n');
  });

  it('::: 名称 回车变成提示块；*[缩写]: 全称 回车变成缩写定义', () => {
    const editor = createEditor('');
    type(editor, '::: warning 小心');
    press(editor, 'Enter');
    type(editor, '内容');
    expect(serializeMarkdown(editor.state.doc)).toBe('::: warning 小心\n内容\n:::\n');

    const second = createEditor('');
    type(second, '*[HTML]: Hyper Text');
    press(second, 'Enter');
    type(second, 'HTML');
    expect(serializeMarkdown(second.state.doc)).toBe('*[HTML]: Hyper Text\n\nHTML\n');
  });

  it('网址后输入空格自动成为链接，保存时仍是裸网址', () => {
    const editor = createEditor('');
    type(editor, '见 https://example.com/a. 后文');
    const marks: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'link')) marks.push(node.text!);
    });
    expect(marks).toEqual(['https://example.com/a']);
    expect(serializeMarkdown(editor.state.doc)).toBe('见 https://example.com/a. 后文\n');
  });
});

describe('斜杠命令', () => {
  const run = (markdown: string, id: string) => {
    const editor = createEditor(markdown);
    const item = new SlashCommandProvider(markdownSchema).getCompletions().find((completion) => completion.id === id)!;
    const end = editor.state.selection.from;
    item.apply!(editor, end, end);
    return editor;
  };

  it('脚注：插入下一个编号的引用，在文末加上定义并把光标放进定义', () => {
    const editor = run('[^1]: 一\n\n已有[^1]\n', 'footnote');
    type(editor, '二');
    expect(serializeMarkdown(editor.state.doc)).toBe('[^1]: 一\n\n已有[^1][^2]\n\n[^2]: 二\n');
  });

  it('定义列表、提示块、缩写定义', () => {
    expect(serializeMarkdown(run('', 'definition-list').state.doc)).toBe('术语\n: \n');
    expect(serializeMarkdown(run('', 'container-tip').state.doc)).toContain('::: tip\n');
    expect(serializeMarkdown(run('', 'abbreviation').state.doc)).toBe('*[缩写]: 全称\n');
  });
});

describe('缩写', () => {
  const titles = (editor: EditorView) =>
    abbreviationKey
      .getState(editor.state)!
      .decorations.find()
      .map((decoration) => [editor.state.doc.textBetween(decoration.from, decoration.to), (decoration as unknown as { type: { attrs: { title: string } } }).type.attrs.title]);

  it('正文中的整词缩写带有全称；编辑正文只重扫改动的段落，修改定义后全部更新', () => {
    const editor = createEditor('*[HTML]: Hyper Text\n\nHTML 与 XHTML 与 (HTML)\n\n另一段 HTML\n');
    expect(titles(editor)).toEqual([
      ['HTML', 'Hyper Text'],
      ['HTML', 'Hyper Text'],
      ['HTML', 'Hyper Text'],
    ]);
    type(editor, ' HTML');
    expect(titles(editor)).toHaveLength(4);
    // 修改定义中的全称
    const definitionEnd = 1 + '*[HTML]: Hyper Text'.length;
    editor.dispatch(editor.state.tr.insertText(' Markup', definitionEnd));
    expect(titles(editor).every(([, title]) => title === 'Hyper Text Markup')).toBe(true);
  });

  it('预览中包成 <abbr>，代码中的不处理；脚注引用悬停显示内容', () => {
    const { html } = renderContentToHtml('*[API]: 应用程序接口\n\n调用 API 与 `API`[^1]\n\n[^1]: 脚注内容\n', 'markdown');
    expect(html).toContain('<abbr class="abbreviation" title="应用程序接口">API</abbr>');
    expect(html).toContain('<code>API</code>');
    expect(html).toMatch(/<sup class="footnote-ref" data-footnote-ref="1" title="脚注内容">1<\/sup>/);
  });
});

describe('增量提取', () => {
  it('带文档标识的连续提取与整篇解析结果相同', () => {
    let text = Array.from({ length: 50 }, (_, i) => `## 第 ${i} 节\n\n正文 [[链接 ${i}]] ==高亮==\n`).join('\n');
    for (let step = 0; step < 30; step++) {
      const at = (step * 997) % text.length;
      text = text.slice(0, at) + (step % 3 === 0 ? '\n## 新\n' : '字') + text.slice(at);
      expect(extractHeadings(text, 'doc-1')).toEqual(extractHeadings(text));
      expect(extractWikiLinks(text, 'doc-1')).toEqual(extractWikiLinks(text));
    }
  });
});
