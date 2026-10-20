// ================================
// 标题引用、块级嵌入测试
// ================================

import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createEditorPlugins } from '../../editor';
import type { EditorCompletionContext } from '@code-reader/autocomplete-service-extras';
import {
  extractHeadings,
  extractSection,
  extractWikiLinks,
  findHeadingInDoc,
  formatWikiLink,
  headingOccurrence,
  markdownSchema,
  MAX_EMBED_DEPTH,
  parseMarkdown,
  parseWikiLinkInner,
  renderContentToHtml,
  serializeMarkdown,
  WikiLinkCompletionProvider,
  type EmbedSource,
} from '..';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

/** 以给定 Markdown 创建编辑器，光标放在文档末尾 */
function createEditor(markdown: string): EditorView {
  const doc = parseMarkdown(markdown);
  const state = EditorState.create({
    doc,
    plugins: createEditorPlugins(markdownSchema),
    selection: TextSelection.atEnd(doc),
  });
  view = new EditorView(document.createElement('div'), { state });
  return view;
}

/** 模拟逐字输入（触发输入规则） */
function type(editor: EditorView, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.someProp('handleTextInput', (f) =>
      f(editor, from, to, char, () => editor.state.tr.insertText(char, from, to))
    );
    if (!handled) editor.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

/** Markdown → 文档 → Markdown */
function roundTrip(markdown: string): string {
  return serializeMarkdown(parseMarkdown(markdown));
}

/** 渲染结果放入 DOM 便于查询 */
function renderToDom(markdown: string, notes: Record<string, string>, title = '根'): HTMLElement {
  const resolveEmbed = (target: string): EmbedSource | null =>
    target in notes ? { kind: 'note', title: target, content: notes[target], format: 'markdown' } : null;
  const container = document.createElement('div');
  container.innerHTML = renderContentToHtml(markdown, 'markdown', { resolveEmbed, title }).html;
  return container;
}

describe('双向链接语法', () => {
  it('拆分目标、标题与别名', () => {
    expect(parseWikiLinkInner('笔记#第一节|别名')).toEqual({ target: '笔记', heading: '第一节', alias: '别名' });
    expect(parseWikiLinkInner('#本文标题')).toEqual({ target: '', heading: '本文标题', alias: null });
    expect(parseWikiLinkInner('笔记#父#子')).toEqual({ target: '笔记', heading: '父#子', alias: null });
    // # 后为空时整体作为目标
    expect(parseWikiLinkInner('C#')).toEqual({ target: 'C#', heading: null, alias: null });
    expect(parseWikiLinkInner('|别名')).toBeNull();
    expect(parseWikiLinkInner('  ')).toBeNull();
    expect(parseWikiLinkInner('a]b')).toBeNull();
  });

  it('格式化与解析互逆', () => {
    for (const inner of ['a', 'a#h', 'a#h|x', '#h', '#h|x', 'C#', 'a|x']) {
      const parts = parseWikiLinkInner(inner)!;
      expect(formatWikiLink(parts)).toBe(`[[${inner}]]`);
      expect(formatWikiLink(parts, true)).toBe(`![[${inner}]]`);
    }
  });

  it('标题链接解析为带 heading 的节点', () => {
    const link = parseMarkdown('见 [[笔记#第一节|别名]]').firstChild!.child(1);
    expect(link.type.name).toBe('wiki_link');
    expect(link.attrs).toEqual({ target: '笔记', heading: '第一节', alias: '别名' });
  });

  it('独占一行的 ![[…]] 解析为块级嵌入', () => {
    const doc = parseMarkdown('前文\n\n![[笔记#第一节]]\n\n后文');
    expect(doc.child(1).type.name).toBe('wiki_embed');
    expect(doc.child(1).attrs).toEqual({ target: '笔记', heading: '第一节', alias: null });
  });

  it('段落中的 ![[…]] 与列表项首行保持为行内链接', () => {
    const inline = parseMarkdown('文字 ![[笔记]] 文字').firstChild!;
    expect(inline.type.name).toBe('paragraph');
    expect(inline.child(1).type.name).toBe('wiki_link');

    const list = parseMarkdown('- ![[笔记]]\n\n  ![[其他]]').firstChild!;
    const item = list.firstChild!;
    expect(item.firstChild!.type.name).toBe('paragraph');
    expect(item.child(1).type.name).toBe('wiki_embed');
  });

  it.each([
    '[[笔记#第一节]]\n',
    '见 [[笔记#第一节|别名]] 与 [[#本文]]\n',
    '![[笔记]]\n',
    '![[笔记#第一节|别名]]\n',
    '![[#本文标题]]\n',
    '前文\n\n![[图片.png]]\n\n后文\n',
    '> ![[引用中的嵌入]]\n',
    '- 列表\n\n  ![[列表中的嵌入]]\n',
    '[[C#]] 与 ![[C#]] 文字\n',
    '| 列 |\n| --- |\n| [[a#h\\|x]] |\n',
  ])('往返无损：%j', (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('提取链接包含标题与嵌入', () => {
    const links = extractWikiLinks('见 [[A#h|x]]\n\n![[B#k]]\n\n`![[代码]]`');
    expect(links.map((l) => [l.target, l.heading, l.alias])).toEqual([
      ['A', 'h', 'x'],
      ['B', 'k', null],
    ]);
  });
});

describe('标题提取与章节', () => {
  const note = '# 标题\n\n引言\n\n## 第一节\n\n内容一\n\n### 小节\n\n细节\n\n## 第二节\n\n内容二\n';

  it('提取标题的级别、文本与行号', () => {
    expect(extractHeadings(note)).toEqual([
      { level: 1, text: '标题', line: 0 },
      { level: 2, text: '第一节', line: 4 },
      { level: 3, text: '小节', line: 8 },
      { level: 2, text: '第二节', line: 12 },
    ]);
  });

  it('章节截止到下一个同级或更高级标题，标题匹配忽略大小写与空白', () => {
    expect(extractSection(note, '第一节')).toBe('## 第一节\n\n内容一\n\n### 小节\n\n细节\n');
    expect(extractSection(note, '  第二节 ')).toBe('## 第二节\n\n内容二\n');
    expect(extractSection('# Intro  Part\ntext', 'intro part')).toBe('# Intro  Part\ntext');
    expect(extractSection(note, '第一节#小节')).toBe('### 小节\n\n细节\n');
    expect(extractSection(note, '不存在')).toBeNull();
  });

  it('在文档节点中定位标题', () => {
    const doc = parseMarkdown('段落\n\n> ## 引用标题\n\n## 第二个');
    const pos = findHeadingInDoc(doc, '第二个')!;
    expect(doc.nodeAt(pos)!.textContent).toBe('第二个');
    expect(doc.nodeAt(findHeadingInDoc(doc, '引用标题')!)!.type).toBe(markdownSchema.nodes.heading);
    expect(findHeadingInDoc(doc, '没有')).toBeNull();
  });

  it('同名标题按序号定位，序号与匹配规则（忽略大小写与空白）一致', () => {
    const markdown = '## Intro\n\n段落\n\n## 其他\n\n## intro\n\n> ## INTRO\n';
    const headings = extractHeadings(markdown);
    expect(headings.map((_, index) => headingOccurrence(headings, index))).toEqual([0, 0, 1, 2]);
    const doc = parseMarkdown(markdown);
    const headingPositions: number[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === 'heading') headingPositions.push(pos);
      return true;
    });
    expect(findHeadingInDoc(doc, 'Intro')).toBe(headingPositions[0]);
    expect(findHeadingInDoc(doc, 'Intro', 1)).toBe(headingPositions[2]);
    expect(findHeadingInDoc(doc, 'Intro', 2)).toBe(headingPositions[3]);
    expect(findHeadingInDoc(doc, 'Intro', 3)).toBeNull();
  });
});

describe('嵌入渲染', () => {
  it('嵌入整篇笔记与指定章节', () => {
    const dom = renderToDom('![[A]]\n\n![[B#二]]', {
      A: '甲的**正文**',
      B: '# 一\n\n不要\n\n# 二\n\n要这段',
    });
    const embeds = dom.querySelectorAll('.wiki-embed');
    expect(embeds).toHaveLength(2);
    expect(embeds[0].querySelector('.wiki-embed-title')!.getAttribute('data-wiki-target')).toBe('A');
    expect(embeds[0].querySelector('.wiki-embed-content strong')!.textContent).toBe('正文');
    expect(embeds[1].textContent).toContain('要这段');
    expect(embeds[1].textContent).not.toContain('不要');
    expect(embeds[1].querySelector('.wiki-embed-title')!.getAttribute('data-wiki-heading')).toBe('二');
  });

  it('嵌入内容中的标题不计入目录', () => {
    const { headings } = renderContentToHtml('# 自己\n\n![[A]]', 'markdown', {
      resolveEmbed: () => ({ kind: 'note', title: 'A', content: '# 别人', format: 'markdown' }),
    });
    expect(headings.map((h) => h.text)).toEqual(['自己']);
  });

  it('互相嵌入的笔记在形成循环处停止', () => {
    const dom = renderToDom('![[A]]', { A: 'A 正文\n\n![[B]]', B: 'B 正文\n\n![[A]]' }, '根');
    expect(dom.textContent).toContain('A 正文');
    expect(dom.textContent).toContain('B 正文');
    const missing = dom.querySelectorAll('.wiki-embed-missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].textContent).toContain('循环');
  });

  it('嵌入自身与自身章节内的自嵌入被阻止', () => {
    const self = renderToDom('正文\n\n![[根]]', { 根: '正文\n\n![[根]]' }, '根');
    expect(self.querySelector('.wiki-embed-missing')!.textContent).toContain('循环');

    const section = renderToDom('# 一\n\n内容\n\n![[#一]]', {}, '根');
    expect(section.querySelectorAll('.wiki-embed')).toHaveLength(2);
    expect(section.querySelector('.wiki-embed-content')!.textContent).toContain('内容');
    expect(section.querySelector('.wiki-embed-missing')!.textContent).toContain('循环');
  });

  it('超过深度上限时停止展开', () => {
    const notes: Record<string, string> = {};
    for (let i = 0; i < 10; i++) notes[`N${i}`] = `第 ${i} 层\n\n![[N${i + 1}]]`;
    const dom = renderToDom('![[N0]]', notes);
    expect(dom.textContent).toContain(`第 ${MAX_EMBED_DEPTH - 1} 层`);
    expect(dom.textContent).not.toContain(`第 ${MAX_EMBED_DEPTH} 层`);
    expect(dom.querySelector('.wiki-embed-missing')!.textContent).toContain('层级');
  });

  it('目标或标题不存在时显示提示', () => {
    const dom = renderToDom('![[无此笔记]]\n\n![[A#无此标题]]', { A: '# 有' });
    const missing = [...dom.querySelectorAll('.wiki-embed-missing')].map((el) => el.textContent);
    expect(missing).toEqual(['未找到「无此笔记」', '未找到标题「无此标题」']);
  });

  it('图片嵌入输出待加载的图片元素', () => {
    const container = document.createElement('div');
    container.innerHTML = renderContentToHtml('![[photo.png]]', 'markdown', {
      resolveEmbed: () => ({ kind: 'media', media: 'image', title: 'photo.png', filePath: '/tmp/photo.png' }),
    }).html;
    const image = container.querySelector<HTMLImageElement>('img.wiki-embed-media')!;
    expect(image.getAttribute('data-embed-path')).toBe('/tmp/photo.png');
    expect(image.getAttribute('src')).toBeNull();
  });

  it('视频、音频嵌入输出带控件的播放器', () => {
    const container = document.createElement('div');
    container.innerHTML = renderContentToHtml('![[clip.mp4|演示]]\n\n![[talk.mp3]]', 'markdown', {
      resolveEmbed: (target) =>
        target === 'clip.mp4'
          ? { kind: 'media', media: 'video', title: 'clip.mp4', filePath: '/tmp/clip.mp4', mimeType: 'video/mp4' }
          : { kind: 'media', media: 'audio', title: 'talk.mp3', filePath: '/tmp/talk.mp3' },
    }).html;
    const video = container.querySelector('video.wiki-embed-media')!;
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('aria-label')).toBe('演示');
    expect(video.getAttribute('data-embed-mime')).toBe('video/mp4');
    expect(container.querySelector('audio.wiki-embed-media')!.getAttribute('data-embed-path')).toBe('/tmp/talk.mp3');
  });

  it('![](视频) 渲染为播放器：远程地址直接播放，本地文件经知识库解析，找不到时提示', () => {
    const container = document.createElement('div');
    container.innerHTML = renderContentToHtml(
      '![远程](https://example.com/a.webm) ![](media/clip.mp4) ![](lost.mov) ![图](https://example.com/p.png)',
      'markdown',
      {
        resolveEmbed: (target) =>
          target === 'clip.mp4' ? { kind: 'media', media: 'video', title: 'clip.mp4', filePath: '/tmp/clip.mp4' } : null,
      }
    ).html;
    const [remote, local] = container.querySelectorAll('video');
    expect(remote.getAttribute('src')).toBe('https://example.com/a.webm');
    expect(remote.getAttribute('aria-label')).toBe('远程');
    expect(local.getAttribute('src')).toBeNull();
    expect(local.getAttribute('data-embed-path')).toBe('/tmp/clip.mp4');
    expect(container.querySelector('.wiki-embed-missing')!.textContent).toBe('未找到附件「lost.mov」');
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://example.com/p.png');
  });

  it('![](视频) 往返无损', () => {
    const source = '![演示](media/clip.mp4 "标题")\n';
    expect(serializeMarkdown(parseMarkdown(source))).toBe(source);
  });

  it('嵌入内容中的 [[#标题]] 指向被嵌入的文档', () => {
    const dom = renderToDom('![[A]]', { A: '见 [[#小节]]' });
    expect(dom.querySelector('.wiki-embed-content .wiki-link')!.getAttribute('data-wiki-target')).toBe('A');
  });
});

describe('编辑器输入', () => {
  it('输入 ![替代文字](地址) 转换为图片节点，视频地址保持原样序列化', () => {
    const editor = createEditor('');
    type(editor, '看 ![演示](media/clip.mp4 "片段")');
    const node = editor.state.doc.firstChild!.lastChild!;
    expect(node.type.name).toBe('image');
    expect(node.attrs).toEqual({ src: 'media/clip.mp4', alt: '演示', title: '片段' });
    expect(serializeMarkdown(editor.state.doc)).toBe('看 ![演示](media/clip.mp4 "片段")\n');
  });
  it('输入 [[文档#标题|别名]] 转换为标题链接', () => {
    const editor = createEditor('');
    type(editor, '见 [[笔记#第一节|一]] 与 [[#本文]]');
    expect(serializeMarkdown(editor.state.doc)).toBe('见 [[笔记#第一节|一]] 与 [[#本文]]\n');
    expect(editor.state.doc.firstChild!.child(1).attrs).toEqual({ target: '笔记', heading: '第一节', alias: '一' });
  });

  it('独占一段的 ![[…]] 转换为块级嵌入，段落中间的保持为链接', () => {
    const editor = createEditor('');
    type(editor, '![[笔记#第一节]]');
    expect(editor.state.doc.firstChild!.type.name).toBe('wiki_embed');
    expect(serializeMarkdown(editor.state.doc)).toBe('![[笔记#第一节]]\n');

    const inline = createEditor('');
    type(inline, '文字 ![[笔记]]');
    expect(inline.state.doc.firstChild!.type.name).toBe('paragraph');
    expect(serializeMarkdown(inline.state.doc)).toBe('文字 ![[笔记]]\n');
  });

  it('列表项首段中的 ![[…]] 不替换段落', () => {
    const { nodes } = markdownSchema;
    const doc = nodes.doc.create(null, nodes.bullet_list.create(null, nodes.list_item.create(null, nodes.paragraph.create())));
    const state = EditorState.create({
      doc,
      plugins: createEditorPlugins(markdownSchema),
      selection: TextSelection.create(doc, 3),
    });
    view = new EditorView(document.createElement('div'), { state });
    type(view, '![[笔记]]');
    expect(view.state.doc.firstChild!.firstChild!.firstChild!.child(1).type.name).toBe('wiki_link');
  });
});

describe('[[文档# 标题补全', () => {
  const headings: Record<string, { level: number; text: string }[]> = {
    笔记: [
      { level: 1, text: '概述' },
      { level: 2, text: '安装' },
    ],
    '': [{ level: 2, text: '本文标题' }],
  };
  const provider = new WikiLinkCompletionProvider(
    markdownSchema,
    () => [{ title: '笔记', aliases: [] }],
    (target) => headings[target] ?? []
  );
  const complete = (query: string) =>
    provider.getCompletions({ trigger: '[[', query } as EditorCompletionContext);

  it('输入 # 后列出目标文档的标题，过滤文本包含已输入的前缀', () => {
    const items = complete('笔记#');
    expect(items.map((item) => [item.label, item.filterText])).toEqual([
      ['概述', '笔记#概述'],
      ['安装', '笔记#安装'],
    ]);
    expect(complete('#').map((item) => item.label)).toEqual(['本文标题']);
    expect(complete('笔记#不存在').map((item) => item.label)).toContain('笔记#不存在');
  });

  it('选择标题插入标题链接；独占一段的 ![[ 插入嵌入', () => {
    const editor = createEditor('见 [[笔记#');
    const install = complete('笔记#').find((item) => item.label === '安装')!;
    install.apply!(editor, 3, editor.state.doc.firstChild!.nodeSize - 1);
    expect(serializeMarkdown(editor.state.doc)).toBe('见 [[笔记#安装]]\n');

    const embed = createEditor('![[笔记#');
    install.apply!(embed, 2, embed.state.doc.firstChild!.nodeSize - 1);
    expect(embed.state.doc.firstChild!.type.name).toBe('wiki_embed');
    expect(serializeMarkdown(embed.state.doc)).toBe('![[笔记#安装]]\n');
  });
});

describe('[[ 别名补全', () => {
  const provider = new WikiLinkCompletionProvider(
    markdownSchema,
    () => [{ title: '周报 2026', aliases: ['Weekly', '周报'] }],
    () => []
  );
  const complete = (query: string) =>
    provider.getCompletions({ trigger: '[[', query } as EditorCompletionContext);

  it('别名作为候选列出，说明指向哪篇笔记；输入的正好是别名时不再提示新建', () => {
    const items = complete('Weekly');
    expect(items.find((item) => item.label === 'Weekly')).toMatchObject({ detail: '别名 · 周报 2026', filterText: 'Weekly' });
    expect(items.some((item) => item.detail?.startsWith('新建'))).toBe(false);
  });

  it('选择别名插入 [[标题|别名]]', () => {
    const editor = createEditor('见 [[Week');
    complete('Week').find((item) => item.label === 'Weekly')!.apply!(editor, 3, editor.state.doc.firstChild!.nodeSize - 1);
    expect(serializeMarkdown(editor.state.doc)).toBe('见 [[周报 2026|Weekly]]\n');
  });
});
