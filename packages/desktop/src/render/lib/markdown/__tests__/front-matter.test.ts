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
import { documentProperties, lintFrontMatter, mergeDocumentTags } from '../front-matter';
import { markdownSchema, parseMarkdown, serializeMarkdown } from '../index';

describe('读取标签与别名', () => {
  it('行内数组、块列表、逗号分隔与单数写法；#标签与层级标签规范化', () => {
    expect(documentProperties('---\ntags: [工作, "#复盘"]\naliases:\n  - 周报\n  - Weekly\n---\n正文\n')).toEqual({
      tags: ['工作', '复盘'],
      aliases: ['周报', 'Weekly'],
    });
    expect(documentProperties('---\ntag: 项目/甲 项目/乙\nalias: 别名\n---\n')).toEqual({ tags: ['项目/甲', '项目/乙'], aliases: ['别名'] });
    expect(documentProperties('正文\n---\ntags: [x]\n---\n')).toEqual({ tags: [], aliases: [] });
  });

  it('合并：加入 YAML 中的标签，只去掉上次同步后从 YAML 删掉的', () => {
    expect(mergeDocumentTags(['界面添加', '旧'], ['旧'], ['新'])).toEqual(['界面添加', '新']);
    expect(mergeDocumentTags(['界面添加'], [], ['a', 'a'])).toEqual(['界面添加', 'a']);
  });
});

describe('YAML 检查', () => {
  it('合法写法没有问题', () => {
    expect(
      lintFrontMatter('title: "标题: 含冒号"\ntags: [a, b]\nlist:\n  - x\n  - y\nnested:\n  key: v\ntext: |\n  多行\n  - 不是列表\n# 注释\nurl: https://a.b/c # 行尾注释')
    ).toEqual([]);
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
  });
});
