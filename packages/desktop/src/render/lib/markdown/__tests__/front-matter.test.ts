// ================================
// 文档属性（YAML 头部）：标签与别名读取、标签合并规则、YAML 检查、编辑器着色与错误标注、
// 文档第一行 --- 加空格生成头部、别名参与双向链接解析
// ================================

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createEditorPlugins } from '../../editor';
import { LinkIndex } from '../../links/link-index';
import type { KnowledgeItem } from '../../../types/knowledge';
import { frontMatterKey, createFrontMatterPlugin } from '../front-matter-plugin';
import { documentProperties, hasFrontMatterTags, lintFrontMatter, mergeDocumentTags, setFrontMatterTags } from '../front-matter';
import { markdownSchema, parseMarkdown, serializeMarkdown } from '../index';

describe('读取标签与别名', () => {
  it('行内数组、块列表、逗号分隔与单数写法；#标签与层级标签规范化', () => {
    expect(documentProperties('---\ntags: [工作, "#复盘"]\naliases:\n  - 周报\n  - Weekly\n---\n正文\n')).toEqual({
      tags: ['工作', '复盘'],
      aliases: ['周报', 'Weekly'],
    });
    expect(documentProperties('---\ntag: 项目/甲 项目/乙\nalias: 别名\n---\n')).toEqual({ tags: ['项目/甲', '项目/乙'], aliases: ['别名'] });
    expect(documentProperties('正文\n---\ntags: [x]\n---\n')).toEqual({ tags: [], aliases: [] });
    expect(documentProperties('---\ntags: [a, b] # 行尾注释\n---\n').tags).toEqual(['a', 'b']);
    // 跨多行的行内数组；引号内的逗号不拆分
    expect(documentProperties('---\ntags: [a,\n  "b, c",\n  d] # 注释\ntitle: x\n---\n').tags).toEqual(['a', 'b, c', 'd']);
    expect(documentProperties('---\ntags: [\n  a,\n  b,\n]\naliases: [x]\n---\n')).toEqual({ tags: ['a', 'b'], aliases: ['x'] });
  });

  it('合并：加入 YAML 中的标签，只去掉上次同步后从 YAML 删掉的', () => {
    expect(mergeDocumentTags(['界面添加', '旧'], ['旧'], ['新'])).toEqual(['界面添加', '新']);
    expect(mergeDocumentTags(['界面添加'], [], ['a', 'a'])).toEqual(['界面添加', 'a']);
  });
});

describe('标签写回 YAML', () => {
  it('行内数组：保留顺序与行尾注释，新标签追加，需要时加引号', () => {
    const doc = '---\ntitle: 周报\ntags: [工作, 复盘] # 标签\n---\n正文\n';
    expect(setFrontMatterTags(doc, ['复盘', '项目/甲', '工作', 'a: b'])).toBe(
      '---\ntitle: 周报\ntags: [工作, 复盘, 项目/甲, "a: b"] # 标签\n---\n正文\n'
    );
    expect(setFrontMatterTags(doc, ['复盘'])).toBe('---\ntitle: 周报\ntags: [复盘] # 标签\n---\n正文\n');
    expect(setFrontMatterTags(doc, [])).toBe('---\ntitle: 周报\ntags: [] # 标签\n---\n正文\n');
  });

  it('块列表：沿用缩进与前缀；只有键时用默认缩进；全部删掉后保留键', () => {
    const doc = '---\ntags:\n    - 工作\n    - 旧\naliases: [周报]\n---\n';
    expect(setFrontMatterTags(doc, ['工作', '新'])).toBe('---\ntags:\n    - 工作\n    - 新\naliases: [周报]\n---\n');
    expect(setFrontMatterTags('---\ntags:\n---\n', ['a'])).toBe('---\ntags:\n  - a\n---\n');
    expect(setFrontMatterTags(doc, [])).toBe('---\ntags:\naliases: [周报]\n---\n');
  });

  it('分隔符写法：保留逗号或空格与 #；放不下含空格的标签或空列表时改用行内数组', () => {
    expect(setFrontMatterTags('---\ntag: a, b\n---\n', ['a', 'c'])).toBe('---\ntag: a, c\n---\n');
    expect(setFrontMatterTags('---\ntags: #a #b\n---\n', ['b', 'c'])).toBe('---\ntags: #b #c\n---\n');
    expect(setFrontMatterTags('---\ntags: a b\n---\n', ['a', '读 书'])).toBe('---\ntags: [a, 读 书]\n---\n');
    expect(setFrontMatterTags('---\ntags: a\n---\n', [])).toBe('---\ntags: []\n---\n');
  });

  it('标签集合不变、没有 tags 键或没有头部时原样返回；CRLF 换行保留', () => {
    const doc = '---\ntags: [b, a]\n---\n';
    expect(setFrontMatterTags(doc, ['a', ' b '])).toBe(doc);
    expect(setFrontMatterTags('---\ntitle: x\n---\n', ['a'])).toBe('---\ntitle: x\n---\n');
    expect(setFrontMatterTags('正文 tags: [a]', ['b'])).toBe('正文 tags: [a]');
    expect(setFrontMatterTags('---\r\ntags: [a]\r\n---\r\n正文', ['a', 'b'])).toBe('---\r\ntags: [a, b]\r\n---\r\n正文');
  });

  it('hasFrontMatterTags 只认头部里的顶层 tags / tag 键', () => {
    expect(hasFrontMatterTags('---\ntags: []\n---\n')).toBe(true);
    expect(hasFrontMatterTags('---\nmeta:\n  tags: [a]\n---\n')).toBe(false);
    expect(hasFrontMatterTags('正文\n---\ntags: [a]\n---\n')).toBe(false);
  });

  it('跨多行的行内数组：展开写法保留每行一项、缩进、末尾逗号与 ] 所在行；折行写法写成一行', () => {
    const expanded = '---\ntags: [\n    工作,\n    旧,\n  ] # 标签\ntitle: x\n---\n';
    expect(setFrontMatterTags(expanded, ['工作', '新', 'a, b'])).toBe(
      '---\ntags: [\n    工作,\n    新,\n    "a, b",\n  ] # 标签\ntitle: x\n---\n'
    );
    expect(setFrontMatterTags('---\ntags: [\n  a,\n  b]\n---\n', ['b', 'c'])).toBe('---\ntags: [\n  b,\n  c]\n---\n');
    expect(setFrontMatterTags(expanded, [])).toBe('---\ntags: [] # 标签\ntitle: x\n---\n');
    expect(setFrontMatterTags('---\ntags: [a,\n  b]\ntitle: x\n---\n', ['a', 'c'])).toBe('---\ntags: [a, c]\ntitle: x\n---\n');
  });
});

describe('YAML 检查', () => {
  it('合法写法没有问题', () => {
    expect(
      lintFrontMatter('title: "标题: 含冒号"\ntags: [a, b]\nlist:\n  - x\n  - y\nnested:\n  key: v\ntext: |\n  多行\n  - 不是列表\n# 注释\nurl: https://a.b/c # 行尾注释')
    ).toEqual([]);
    // 跨多行的行内数组 / 映射，#标签 的宽松写法
    expect(lintFrontMatter('tags: [a,\n  b] # 注释\nmeta: {x: 1,\n  y: [2,\n    3]}\nlist: [\n  a,\n]\nh: [#a, #b]')).toEqual([]);
  });

  it('跨行的括号没有闭合就开始了下一个键或头部结束：在开始的行报错，之后的行照常检查', () => {
    expect(lintFrontMatter('tags: [a,\n  b\ntags: 1')).toEqual([
      { line: 0, message: '括号未闭合' },
      { line: 2, message: '重复的键「tags」' },
    ]);
    expect(lintFrontMatter('x: 1\ntags: [a,\n  b')).toEqual([{ line: 1, message: '括号未闭合' }]);
    expect(lintFrontMatter('tags: [a,\n  b]]')).toEqual([{ line: 1, message: '括号未闭合' }]);
  });

  it('制表符缩进、缺少冒号、重复的键、引号或括号未闭合、孤立的列表项', () => {
    expect(lintFrontMatter('a: 1\n\tb: 2\n只有文字\na: 3\nq: "未闭合\nr: [x, y\ns: 1\n- 孤立')).toEqual([
      { line: 1, message: 'YAML 不能用制表符缩进，请改用空格' },
      { line: 2, message: '缺少冒号：每一行应为“键: 值”' },
      { line: 3, message: '重复的键「a」' },
      { line: 4, message: '引号未闭合' },
      { line: 5, message: '括号未闭合' },
      { line: 7, message: '列表项不属于任何键：上一行应为“键:”且不写值' },
    ]);
  });
});

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function editor(markdown: string): EditorView {
  const doc = parseMarkdown(markdown);
  view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc, plugins: [...createEditorPlugins(markdownSchema), createFrontMatterPlugin()], selection: TextSelection.atEnd(doc) }),
  });
  return view;
}

describe('编辑器中的文档属性', () => {
  it('YAML 按 Prism 着色，写错的行带错误标注；正文改动不重算', () => {
    const current = editor('---\ntitle: 周报\n坏行\n---\n\n正文\n');
    const state = frontMatterKey.getState(current.state)!;
    const decorations = state.decorations.find();
    const classes = decorations.map((decoration) => (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class);
    expect(classes).toContain('token key atrule');
    expect(classes).toContain('front-matter-error');
    const error = decorations.find((_d, index) => classes[index] === 'front-matter-error')!;
    expect(current.state.doc.textBetween(error.from, error.to)).toBe('坏行');

    current.dispatch(current.state.tr.insertText('字'));
    expect(frontMatterKey.getState(current.state)).toBe(state);
  });

  it('文档第一行输入 --- 加空格生成文档属性；其他位置仍是分割线', () => {
    const current = editor('');
    for (const char of '--- ') {
      const { from, to } = current.state.selection;
      const handled = current.someProp('handleTextInput', (f) => f(current, from, to, char, () => current.state.tr.insertText(char, from, to)));
      if (!handled) current.dispatch(current.state.tr.insertText(char, from, to));
    }
    expect(current.state.doc.firstChild!.type.name).toBe('front_matter');
    expect(current.state.selection.from).toBe(1);
    expect(serializeMarkdown(current.state.doc)).toBe('---\n---\n');
  });
});

describe('别名参与双向链接解析', () => {
  const note = (id: string, title: string, content: string, updatedAt = 1): KnowledgeItem => ({
    id,
    title,
    type: 'note',
    status: 'ready',
    content,
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(updatedAt),
  });

  it('[[别名]] 解析到笔记并计入反向链接；与其他笔记标题相同时标题优先', () => {
    const index = new LinkIndex();
    index.update([
      note('a', '机器学习.md', '---\naliases: [ML, 线性代数]\n---\n正文\n'),
      note('b', '读书笔记.md', '见 [[ml]] 与 [[ML#方法]]'),
      note('c', '线性代数.md', '标题'),
    ]);
    expect(index.resolve('ML')?.id).toBe('a');
    expect(index.resolve('线性代数')?.id).toBe('c');
    expect(index.backlinks('a').map((link) => link.sourceId)).toEqual(['b', 'b']);
    expect(index.resolvedTargets('b')).toEqual(['a']);
    // [[ 补全显示别名原文
    expect(index.aliasNamesOf('a')).toEqual(['ML', '线性代数']);
    expect(index.aliasNamesOf('c')).toEqual([]);
  });
});
