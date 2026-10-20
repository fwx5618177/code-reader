// ================================
// 脚注编号：按第一次引用的顺序，同一标签共用编号，行内脚注各占一个编号；
// 编辑器装饰与节点视图、改动时重新编号；预览中的编号
// ================================

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createFootnoteNumberPlugin, createFootnoteRefView, footnoteNumberKey, numberFootnotes } from '../footnotes';
import { parseMarkdown, renderContentToHtml } from '../index';

const SOURCE = '正文[^b] 与 ^[行内] 再[^a] 又见[^b]\n\n[^a]: 甲\n\n[^b]: 乙\n\n[^c]: 未被引用\n';

describe('numberFootnotes', () => {
  it('按第一次引用的顺序编号：同一标签共用，行内脚注占号，未引用的定义不编号', () => {
    const { at, byLabel } = numberFootnotes(parseMarkdown(SOURCE));
    expect([...at.values()]).toEqual([1, 2, 3, 1]);
    expect([...byLabel]).toEqual([
      ['b', 1],
      ['a', 3],
    ]);
  });
});

describe('预览中的脚注编号', () => {
  it('引用显示编号，行内脚注与被引用的定义带编号属性', () => {
    const container = document.createElement('div');
    container.innerHTML = renderContentToHtml(SOURCE, 'markdown').html;
    expect([...container.querySelectorAll('[data-footnote-ref]')].map((ref) => ref.textContent)).toEqual(['1', '3', '1']);
    expect(container.querySelector('[data-footnote-inline]')!.getAttribute('data-footnote-number')).toBe('2');
    const definitions = [...container.querySelectorAll('[data-footnote-def]')].map((def) => [
      def.getAttribute('data-footnote-def'),
      def.getAttribute('data-footnote-number'),
    ]);
    expect(definitions).toEqual([
      ['a', '3'],
      ['b', '1'],
      ['c', null],
    ]);
  });
});

describe('编辑器中的脚注编号', () => {
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  function mount(markdown: string): EditorView {
    view = new EditorView(document.body.appendChild(document.createElement('div')), {
      state: EditorState.create({ doc: parseMarkdown(markdown), plugins: [createFootnoteNumberPlugin()] }),
      nodeViews: { footnote_ref: (node, _view, _getPos, decorations) => createFootnoteRefView(node, decorations) },
    });
    return view;
  }
  const shown = (editor: EditorView) =>
    [...editor.dom.querySelectorAll('.footnote-ref, .footnote-inline')].map((el) =>
      el.classList.contains('footnote-ref') ? el.textContent : `行内${el.getAttribute('data-footnote-number')}`
    );

  it('引用显示编号、悬停显示标签；行内脚注带编号属性', () => {
    const editor = mount(SOURCE);
    expect(shown(editor)).toEqual(['1', '行内2', '3', '1']);
    expect(editor.dom.querySelector<HTMLElement>('.footnote-ref')!.title).toBe('[^b]');
  });

  it('在前面插入或删除引用后重新编号；只改正文时平移原有编号', () => {
    const editor = mount(SOURCE);
    const ref = editor.state.schema.nodes.footnote_ref;
    editor.dispatch(editor.state.tr.insert(1, ref.create({ label: 'a' })));
    expect(shown(editor)).toEqual(['1', '2', '行内3', '1', '2']);

    editor.dispatch(editor.state.tr.delete(1, 2));
    expect(shown(editor)).toEqual(['1', '行内2', '3', '1']);

    const before = footnoteNumberKey.getState(editor.state)!;
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)).insertText('字'));
    const after = footnoteNumberKey.getState(editor.state)!;
    expect(after).not.toBe(before);
    expect(after.find().map((deco) => deco.from)).toEqual(before.find().map((deco) => deco.from + 1));
    expect(shown(editor)).toEqual(['1', '行内2', '3', '1']);
  });

  it('没有脚注的文档不产生装饰', () => {
    const editor = mount('普通正文\n');
    editor.dispatch(editor.state.tr.insertText('字', 1));
    expect(footnoteNumberKey.getState(editor.state)!.find()).toEqual([]);
  });
});
