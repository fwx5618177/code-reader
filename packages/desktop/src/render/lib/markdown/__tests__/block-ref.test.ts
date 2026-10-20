// ================================
// 块级引用测试：块 ID 解析、块提取、往返、渲染、补全
// ================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { EditorCompletionContext } from '@code-reader/autocomplete-service-extras';
import {
  blockRefId,
  collectDocBlocks,
  createBlockIdPlugin,
  extractBlock,
  extractHeadings,
  extractWikiLinks,
  findLinkTargetInDoc,
  generateBlockId,
  isBlockId,
  linkAnchorId,
  markdownSchema,
  parseMarkdown,
  renderContentToHtml,
  serializeMarkdown,
  stripBlockMarker,
  summarizeBlocks,
  summarizeDocBlocks,
  wikiLinkClickTarget,
  WikiLinkCompletionProvider,
  type CompletionBlockSource,
  type EmbedSource,
} from '..';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

function roundTrip(markdown: string): string {
  return serializeMarkdown(parseMarkdown(markdown));
}

function render(markdown: string, notes: Record<string, string> = {}): HTMLElement {
  const resolveEmbed = (target: string): EmbedSource | null =>
    target in notes ? { kind: 'note', title: target, content: notes[target], format: 'markdown' } : null;
  const container = document.createElement('div');
  container.innerHTML = renderContentToHtml(markdown, 'markdown', { resolveEmbed, title: '当前' }).html;
  return container;
}

describe('块 ID 语法', () => {
  it('块 ID 由字母、数字与 - 组成；链接的 #^id 解析为块 ID', () => {
    expect(isBlockId('abc-123')).toBe(true);
    expect(isBlockId('a_b')).toBe(false);
    expect(isBlockId('')).toBe(false);
    expect(blockRefId('^abc-1')).toBe('abc-1');
    expect(blockRefId('标题')).toBeNull();
    expect(blockRefId('^含中文')).toBeNull();
    expect(blockRefId(null)).toBeNull();
  });

  it('去掉文本末尾的标记', () => {
    expect(stripBlockMarker('一段话 ^abc')).toBe('一段话');
    expect(stripBlockMarker('^abc')).toBe('');
    expect(stripBlockMarker('x^abc')).toBe('x^abc');
    expect(stripBlockMarker('中间 ^abc 不是')).toBe('中间 ^abc 不是');
  });

  it('[[笔记#^id]] 与 ![[笔记#^id]] 作为标题字段保存', () => {
    expect(extractWikiLinks('见 [[笔记#^abc|别名]]\n\n![[笔记#^def]]').map((l) => [l.target, l.heading, l.alias])).toEqual([
      ['笔记', '^abc', '别名'],
      ['笔记', '^def', null],
    ]);
  });
});

describe('Markdown 往返无损', () => {
  it.each([
    ['段落尾', '一段话 ^para-1\n'],
    ['标题尾', '# 标题 ^h1\n'],
    ['列表项', '- 第一项 ^li1\n- 第二项\n'],
    ['有序列表', '1. 一\n2. 二 ^n2\n'],
    ['引用', '> 引用内容 ^q1\n'],
    ['表格后的独立标记', '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n^tbl\n'],
    ['代码块后的独立标记', '```js\nconst a = 1;\n```\n\n^code-1\n'],
    ['块引用与嵌入', '见 [[笔记#^abc]]\n\n![[笔记#^def]]\n'],
    ['嵌入后的独立标记', '![[笔记#第一节]]\n\n^emb\n'],
  ])('%s', (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe('collectDocBlocks', () => {
  it('识别段落、标题、列表项与独立标记指向的块', () => {
    const doc = parseMarkdown(
      [
        '# 标题 ^h',
        '',
        '普通段落',
        '',
        '带 ID 的段落 ^p',
        '',
        '- 列表项 ^li',
        '- 无 ID 项',
        '',
        '| a |',
        '| --- |',
        '| 1 |',
        '',
        '^tbl',
      ].join('\n')
    );
    const blocks = collectDocBlocks(doc);
    expect(blocks.map((b) => [b.id, b.relation, b.node.type.name, b.text])).toEqual([
      ['h', 'self', 'heading', '标题'],
      [null, 'self', 'paragraph', '普通段落'],
      ['p', 'self', 'paragraph', '带 ID 的段落'],
      ['li', 'list-item', 'list_item', '列表项'],
      [null, 'list-item', 'list_item', '无 ID 项'],
      ['tbl', 'previous', 'table', 'a 1'],
    ]);
    // 已有 ID 的块记录承载标记的段落序号，没有 ID 的块记录写入位置
    expect(blocks.map((b) => b.marker?.anchorIndex ?? b.slot)).toEqual([
      0,
      { kind: 'append', anchorIndex: 1 },
      2,
      3,
      { kind: 'append', anchorIndex: 4 },
      5,
    ]);
    expect(blocks.filter((b) => b.id).every((b) => b.slot === null)).toBe(true);
  });

  it('没有 ID 的表格、代码块可引用，写入位置按同类块序号（含空代码块）编号', () => {
    const blocks = collectDocBlocks(
      parseMarkdown(['```', '```', '', '```js', 'const a = 1;', '```', '', '| a |', '| --- |', '| 1 |', '', '> ```', '> b', '> ```'].join('\n'))
    );
    expect(blocks.map((b) => [b.id, b.relation, b.node.type.name, b.text, b.slot])).toEqual([
      [null, 'previous', 'code_block', 'const a = 1;', { kind: 'after', node: 'code_block', index: 1 }],
      [null, 'previous', 'table', 'a 1', { kind: 'after', node: 'table', index: 0 }],
      [null, 'previous', 'code_block', 'b', { kind: 'after', node: 'code_block', index: 2 }],
    ]);
  });

  it('独立标记指向嵌入', () => {
    const [block] = collectDocBlocks(parseMarkdown('![[笔记]]\n\n^emb\n'));
    expect(block).toMatchObject({ id: 'emb', relation: 'previous', slot: null });
    expect(block.node.type.name).toBe('wiki_embed');
  });

  it('独立标记为前一个没有 ID 的段落命名', () => {
    const blocks = collectDocBlocks(parseMarkdown('前一段\n\n^prev\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: 'prev', text: '前一段', slot: null });
    expect(blocks[0].marker).toMatchObject({ standalone: true, anchorIndex: 1 });
  });

  it('紧贴文字、行内代码中的 ^id 不是标记；硬换行后的一行可以是标记', () => {
    expect(collectDocBlocks(parseMarkdown('文字^abc\n'))[0].id).toBeNull();
    expect(collectDocBlocks(parseMarkdown('文字 `^abc`\n'))[0].id).toBeNull();
    expect(collectDocBlocks(parseMarkdown('[[x]]^abc\n'))[0].id).toBeNull();
    expect(collectDocBlocks(parseMarkdown('第一行\\\n^abc\n'))[0]).toMatchObject({ id: 'abc', text: '第一行' });
    // 标记写在段落的下一行（软换行）同样有效
    expect(collectDocBlocks(parseMarkdown('中文段落\n^abc\n'))[0]).toMatchObject({ id: 'abc', text: '中文段落' });
  });

  it('空段落不可引用；摘要与文档块一致', () => {
    const markdown = '一\n\n二 ^b\n';
    expect(summarizeBlocks(markdown)).toEqual(summarizeDocBlocks(parseMarkdown(markdown)));
    expect(summarizeBlocks(markdown)).toEqual([
      { id: null, kind: 'paragraph', text: '一', slot: { kind: 'append', anchorIndex: 0 } },
      { id: 'b', kind: 'paragraph', text: '二', slot: null },
    ]);
  });
});

describe('extractBlock', () => {
  const source = [
    '# 标题 ^h',
    '',
    '段落 **加粗** ^p',
    '',
    '3. 三',
    '4. 四 ^four',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '^tbl',
    '',
    '> 引用 ^q',
  ].join('\n');

  it('按 ID 提取块源码（不含标记）', () => {
    expect(extractBlock(source, 'h')).toBe('# 标题\n');
    expect(extractBlock(source, 'p')).toBe('段落 **加粗**\n');
    expect(extractBlock(source, 'four')).toBe('4. 四\n');
    expect(extractBlock(source, 'tbl')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(extractBlock(source, 'q')).toBe('引用\n');
  });

  it('找不到块时返回 null', () => {
    expect(extractBlock(source, 'missing')).toBeNull();
    expect(extractBlock('', 'x')).toBeNull();
  });
});

describe('标题与定位', () => {
  it('标题文本不含块标记，[[笔记#标题]] 仍能匹配', () => {
    expect(extractHeadings('## 安装 ^install\n').map((h) => h.text)).toEqual(['安装']);
  });

  it('findLinkTargetInDoc 定位块或标题', () => {
    const doc = parseMarkdown('# 一\n\n段落 ^p\n\n- 项 ^li\n');
    expect(findLinkTargetInDoc(doc, '一')).toBe(0);
    expect(doc.nodeAt(findLinkTargetInDoc(doc, '^p')!)!.type.name).toBe('paragraph');
    expect(doc.nodeAt(findLinkTargetInDoc(doc, '^li')!)!.type.name).toBe('list_item');
    expect(findLinkTargetInDoc(doc, '^none')).toBeNull();
  });
});

describe('渲染', () => {
  it('标记从正文中去掉，块元素带锚点', () => {
    const container = render('# 标题 ^h\n\n段落 ^p\n\n- 项 ^li\n\n```\ncode\n```\n\n^c\n');
    expect(container.textContent).not.toContain('^');
    expect(container.querySelector('h1')!.id).toBe('heading-0');
    expect(container.querySelector('h1')!.dataset.blockId).toBe('h');
    expect(container.querySelector('#block-p')!.tagName).toBe('P');
    expect(container.querySelector('#block-li')!.tagName).toBe('LI');
    expect(container.querySelector('#block-c')!.tagName).toBe('PRE');
  });

  it('![[笔记#^id]] 嵌入块内容，找不到块时显示“块不存在”', () => {
    const notes = { 笔记: '前文\n\n被引用的段落 ^abc\n\n后文\n' };
    const embed = render('![[笔记#^abc]]\n', notes).querySelector('.wiki-embed')!;
    expect(embed.querySelector('.wiki-embed-content')!.textContent).toBe('被引用的段落');
    expect(embed.querySelector('.wiki-embed-title')!.textContent).toBe('笔记#^abc');

    const missing = render('![[笔记#^nope]]\n', notes).querySelector('.wiki-embed-missing')!;
    expect(missing.textContent).toBe('块「^nope」不存在');
  });

  it('[[#^id]] 点击定位到块锚点（标题块使用标题锚点）', () => {
    const content = '# 标题 ^h\n\n段落 ^p\n\n见 [[#^p]] [[#^h]] [[#^none]]\n';
    const container = render(content);
    const [toParagraph, toHeading, toMissing] = container.querySelectorAll<HTMLElement>('.wiki-link');
    expect(wikiLinkClickTarget(toParagraph, content, 'markdown')).toEqual({ kind: 'anchor', id: 'block-p' });
    expect(wikiLinkClickTarget(toHeading, content, 'markdown')).toEqual({ kind: 'anchor', id: 'heading-0' });
    expect(wikiLinkClickTarget(toMissing, content, 'markdown')).toEqual({ kind: 'anchor', id: null });
  });

  it('独立标记跟在 ![[嵌入]] 后：展开后的嵌入保留块锚点', () => {
    const content = '前文\n\n![[笔记]]\n\n^emb\n\n见 [[#^emb]]\n';
    const container = render(content, { 笔记: '被嵌入的内容\n' });
    const embed = container.querySelector<HTMLElement>('#block-emb')!;
    expect(embed.classList.contains('wiki-embed')).toBe(true);
    expect(embed.dataset.blockId).toBe('emb');
    expect(embed.querySelector('.wiki-embed-content')!.textContent).toBe('被嵌入的内容');
    const paragraphs = [...container.children].filter((el) => el.tagName === 'P');
    expect(paragraphs.map((p) => p.textContent)).toEqual(['前文', '见 #^emb']);
    const link = container.querySelector<HTMLElement>('.wiki-link')!;
    expect(wikiLinkClickTarget(link, content, 'markdown')).toEqual({ kind: 'anchor', id: 'block-emb' });
  });

  it('linkAnchorId：同名标题按 occurrence 定位，块定位到块锚点', () => {
    const content = '# 小结\n\n## 小结\n\n| a |\n| --- |\n| 1 |\n\n^tbl\n';
    expect(linkAnchorId(content, 'markdown', '小结')).toBe('heading-0');
    expect(linkAnchorId(content, 'markdown', '小结', 1)).toBe('heading-1');
    expect(linkAnchorId(content, 'markdown', '小结', 2)).toBeNull();
    expect(linkAnchorId(content, 'markdown', '^tbl')).toBe('block-tbl');
    expect(render(content).querySelector('#block-tbl')!.tagName).toBe('TABLE');
    expect(linkAnchorId(content, 'plain', '小结')).toBeNull();
  });
});

describe('generateBlockId', () => {
  it('生成 6 位 ID，避开已有 ID', () => {
    const sequence = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const random = vi.fn(() => sequence.shift()!);
    const id = generateBlockId(new Set(['000000']), random);
    expect(id).toBe('iiiiii');
    expect(isBlockId(generateBlockId(new Set()))).toBe(true);
    expect(generateBlockId(new Set())).toHaveLength(6);
  });
});

describe('块 ID 标记的编辑器装饰', () => {
  it('弱化显示 ^id，编辑后增量更新', () => {
    const doc = parseMarkdown('段落 ^abc\n\n普通段落\n');
    const state = EditorState.create({
      doc,
      plugins: [createBlockIdPlugin('marker')],
      selection: TextSelection.atEnd(doc),
    });
    view = new EditorView(document.createElement('div'), { state });
    const markers = () => [...view!.dom.querySelectorAll('.marker')].map((el) => el.textContent);
    expect(markers()).toEqual(['^abc']);

    view.dispatch(view.state.tr.insertText(' ^new', view.state.selection.from));
    expect(markers()).toEqual(['^abc', '^new']);
    // 序列化保留标记
    expect(serializeMarkdown(view.state.doc)).toBe('段落 ^abc\n\n普通段落 ^new\n');
  });
});

describe('[[文档#^ 块补全', () => {
  const otherBlocks = summarizeBlocks('第一段 ^one\n\n第二段没有 ID\n');

  function createProvider(currentDoc: () => EditorView | null, assignId = vi.fn()) {
    const source: CompletionBlockSource = {
      isCurrent: (target) => !target,
      blocks: (target) => (target ? otherBlocks : summarizeDocBlocks(currentDoc()!.state.doc)),
      assignId,
    };
    return {
      assignId,
      provider: new WikiLinkCompletionProvider(markdownSchema, () => ['笔记'], () => [], source),
    };
  }

  function createEditor(markdown: string): EditorView {
    const doc = parseMarkdown(markdown);
    view = new EditorView(document.createElement('div'), {
      state: EditorState.create({ doc, selection: TextSelection.atEnd(doc) }),
    });
    return view;
  }

  const complete = (provider: WikiLinkCompletionProvider, query: string) =>
    provider.getCompletions({ trigger: '[[', query } as EditorCompletionContext);

  it('列出目标文档的块，可按 ID 或文本过滤', () => {
    const { provider } = createProvider(() => null);
    const items = complete(provider, '笔记#^');
    expect(items.map((item) => item.label)).toEqual(['第一段', '第二段没有 ID']);
    expect(items[0].detail).toContain('^one');
    expect(items[1].detail).toContain('选中后生成块 ID');
    expect(items[0].filterText).toContain('笔记#^one');
    expect(items[1].filterText).toContain('笔记#^第二段');
  });

  it('选中已有 ID 的块插入块链接', () => {
    const { provider, assignId } = createProvider(() => null);
    const editor = createEditor('见 [[笔记#^');
    complete(provider, '笔记#^')[0].apply!(editor, 3, editor.state.doc.firstChild!.nodeSize - 1);
    expect(serializeMarkdown(editor.state.doc)).toBe('见 [[笔记#^one]]\n');
    expect(assignId).not.toHaveBeenCalled();
  });

  it('其他文档中没有 ID 的块：插入链接并请求写回 ID', () => {
    const { provider, assignId } = createProvider(() => null);
    const editor = createEditor('见 [[笔记#^');
    complete(provider, '笔记#^')[1].apply!(editor, 3, editor.state.doc.firstChild!.nodeSize - 1);
    const id = assignId.mock.calls[0][2] as string;
    expect(assignId).toHaveBeenCalledWith('笔记', { kind: 'append', anchorIndex: 1 }, id);
    expect(isBlockId(id)).toBe(true);
    expect(serializeMarkdown(editor.state.doc)).toBe(`见 [[笔记#^${id}]]\n`);
  });

  it('当前文档中没有 ID 的块：直接写入标记并插入链接', () => {
    const editor = createEditor('目标段落\n\n见 [[#^');
    const { provider } = createProvider(() => editor);
    const item = complete(provider, '#^').find((i) => i.label === '目标段落')!;
    const paragraph = editor.state.doc.child(1);
    const from = editor.state.doc.child(0).nodeSize + 1 + 2;
    item.apply!(editor, from, from + paragraph.nodeSize - 2 - 2);
    const markdown = serializeMarkdown(editor.state.doc);
    const id = /目标段落 \^([a-z0-9]+)\n/.exec(markdown)![1];
    expect(markdown).toBe(`目标段落 ^${id}\n\n见 [[#^${id}]]\n`);
  });

  it('当前段落即目标块时，标记写在链接之后', () => {
    const editor = createEditor('本段 [[#^');
    const { provider } = createProvider(() => editor);
    const item = complete(provider, '#^')[0];
    item.apply!(editor, 4, editor.state.doc.firstChild!.nodeSize - 1);
    const markdown = serializeMarkdown(editor.state.doc);
    expect(markdown).toMatch(/^本段 \[\[#\^([a-z0-9]+)\]\] \^\1\n$/);
  });

  it('当前文档中没有 ID 的表格：在其后插入独立一段 ^id，往返后仍指向表格', () => {
    const editor = createEditor('| a |\n| --- |\n| 1 |\n\n见 [[#^');
    const { provider } = createProvider(() => editor);
    const item = complete(provider, '#^').find((i) => i.label === 'a 1')!;
    expect(item.detail).toContain('表格');
    const paragraphPos = editor.state.doc.child(0).nodeSize;
    const paragraph = editor.state.doc.child(1);
    item.apply!(editor, paragraphPos + 1 + 2, paragraphPos + paragraph.nodeSize - 1);
    const markdown = serializeMarkdown(editor.state.doc);
    const id = /\n\n\^([a-z0-9]+)\n\n/.exec(markdown)![1];
    expect(markdown).toBe(`| a |\n| --- |\n| 1 |\n\n^${id}\n\n见 [[#^${id}]]\n`);
    expect(roundTrip(markdown)).toBe(markdown);
    expect(extractBlock(markdown, id)).toBe('| a |\n| --- |\n| 1 |\n');
  });

  it('其他文档中没有 ID 的代码块：请求在其后写回 ID', () => {
    const blocks = summarizeBlocks('```js\nconst a = 1;\n```\n');
    const assignId = vi.fn();
    const provider = new WikiLinkCompletionProvider(markdownSchema, () => ['代码'], () => [], {
      isCurrent: () => false,
      blocks: () => blocks,
      assignId,
    });
    const editor = createEditor('见 [[代码#^');
    const [item] = complete(provider, '代码#^');
    expect(item.label).toBe('const a = 1;');
    expect(item.detail).toContain('代码块');
    item.apply!(editor, 3, editor.state.doc.firstChild!.nodeSize - 1);
    const id = assignId.mock.calls[0][2] as string;
    expect(assignId).toHaveBeenCalledWith('代码', { kind: 'after', node: 'code_block', index: 0 }, id);
    expect(serializeMarkdown(editor.state.doc)).toBe(`见 [[代码#^${id}]]\n`);
  });
});
