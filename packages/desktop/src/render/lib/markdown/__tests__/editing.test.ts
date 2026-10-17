// ================================
// Typora 风格编辑交互测试
// 在真实 EditorView 中模拟输入，验证输入规则、回车转换与实时预览装饰
// ================================

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { createEditorPlugins } from '../../editor';
import {
  createLivePreviewPlugin,
  createTableKeymap,
  livePreviewKey,
  markdownSchema,
  parseMarkdown,
  serializeMarkdown,
} from '../index';

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
    plugins: [
      ...createEditorPlugins(markdownSchema),
      createTableKeymap(markdownSchema),
      keymap(baseKeymap),
      createLivePreviewPlugin(markdownSchema),
    ],
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

/** 模拟按键 */
function press(editor: EditorView, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key });
  return !!editor.someProp('handleKeyDown', (f) => f(editor, event));
}

function markdown(editor: EditorView): string {
  return serializeMarkdown(editor.state.doc);
}

describe('输入规则', () => {
  it('**粗体** 与 *斜体* 即时转换', () => {
    const editor = createEditor('');
    type(editor, '这是 **重点** 和 *强调*');
    expect(markdown(editor)).toBe('这是 **重点** 和 *强调*\n');
  });

  it('`代码` 与 ~~删除线~~', () => {
    const editor = createEditor('');
    type(editor, '用 `npm` 安装 ~~旧版~~');
    expect(markdown(editor)).toBe('用 `npm` 安装 ~~旧版~~\n');
  });

  it('[文字](链接)', () => {
    const editor = createEditor('');
    type(editor, '见 [官网](https://example.com)');
    expect(markdown(editor)).toBe('见 [官网](https://example.com)\n');
  });

  it('$公式$ 转换为行内公式节点', () => {
    const editor = createEditor('');
    type(editor, '质能 $E=mc^2$');
    let found = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'math_inline') found = node.attrs.latex === 'E=mc^2';
    });
    expect(found).toBe(true);
  });

  it('金额 $5 不会触发公式', () => {
    const editor = createEditor('');
    type(editor, '花了 $5 和 $ 10');
    expect(editor.state.doc.textContent).toBe('花了 $5 和 $ 10');
  });

  it('[[链接]] 转换为双向链接节点', () => {
    const editor = createEditor('');
    type(editor, '参见 [[项目计划|计划]]');
    expect(markdown(editor)).toBe('参见 [[项目计划|计划]]\n');
  });

  it('# 标题 与 - [ ] 任务', () => {
    const editor = createEditor('');
    type(editor, '## 标题');
    expect(editor.state.doc.firstChild!.type.name).toBe('heading');

    const second = createEditor('');
    type(second, '- [ ] 待办');
    expect(markdown(second)).toBe('- [ ] 待办\n');
    second.destroy();
  });
});

describe('回车转换', () => {
  it('$$ 回车生成公式块并选中', () => {
    const editor = createEditor('');
    type(editor, '$$');
    expect(press(editor, 'Enter')).toBe(true);
    expect(editor.state.doc.firstChild!.type.name).toBe('math_block');
    expect(editor.state.selection.from).toBe(0);
  });

  it('| a | b | 回车生成表格，Tab 在单元格间移动并自动追加行', () => {
    const editor = createEditor('');
    type(editor, '| 名称 | 数量 |');
    expect(press(editor, 'Enter')).toBe(true);
    const table = editor.state.doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(2);

    type(editor, '苹果');
    press(editor, 'Tab');
    type(editor, '3');
    press(editor, 'Tab');
    expect(editor.state.doc.firstChild!.childCount).toBe(3);
    expect(markdown(editor)).toBe('| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n|  |  |\n');
  });

  it('```ts 回车生成代码块', () => {
    const editor = createEditor('');
    type(editor, '```ts');
    press(editor, 'Enter');
    const block = editor.state.doc.firstChild!;
    expect(block.type.name).toBe('code_block');
    expect(block.attrs.language).toBe('ts');
  });
});

describe('实时预览', () => {
  it('光标位于粗体内时显示 ** 标记，离开后隐藏', () => {
    const editor = createEditor('前 **粗体** 后');
    const decorationsAt = (pos: number) => {
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
      return livePreviewKey.getState(editor.state)!.find();
    };
    // "前 " 之后进入粗体内部
    expect(decorationsAt(4)).toHaveLength(2);
    expect(decorationsAt(1)).toHaveLength(0);
  });

  it('光标位于标题中时显示 # 标记', () => {
    const editor = createEditor('### 三级标题');
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    const decorations = livePreviewKey.getState(editor.state)!.find();
    expect(decorations).toHaveLength(1);
  });
});
