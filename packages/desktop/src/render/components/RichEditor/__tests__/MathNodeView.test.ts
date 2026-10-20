// ================================
// 公式节点的源码框：\ 加字母时补全 LaTeX 命令；面板打开时回车接受补全而不是结束编辑，Esc 只关闭面板
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, NodeSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { markdownSchema } from '../../../lib/markdown';
import { createMathInlineView } from '../MathNodeView';

function mountFormula(latex: string) {
  const host = document.body.appendChild(document.createElement('div'));
  const { doc, paragraph, math_inline } = markdownSchema.nodes;
  const state = EditorState.create({
    doc: doc.create(null, paragraph.create(null, [markdownSchema.text('a '), math_inline.create({ latex })])),
  });
  const view = new EditorView(host, { state, nodeViews: { math_inline: createMathInlineView() } });
  // 选中公式节点：展开源码框
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 3)));
  const input = host.querySelector<HTMLTextAreaElement>('.math-node-input')!;
  return { view, host, input };
}

function typeInto(input: HTMLTextAreaElement, text: string) {
  input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const press = (input: HTMLTextAreaElement, key: string) =>
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('MathNodeView 的 LaTeX 补全', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('紧跟在运算符后的 \\ 也能补全；回车接受补全并留在源码框，再按回车才结束编辑', async () => {
    const { view, host, input } = mountFormula('x+');
    expect(document.activeElement).toBe(input);
    typeInto(input, '\\alph');
    await vi.advanceTimersByTimeAsync(100);
    expect(host.querySelector('.pm-autocomplete-item-active')?.textContent).toContain('\\alpha');

    press(input, 'Enter');
    expect(input.value).toBe('x+\\alpha ');
    expect(host.querySelector('.math-node-edit')!.hasAttribute('hidden')).toBe(false);
    // 接受补全后实时预览随之更新
    expect(host.querySelector('.math-node-live-preview')!.textContent).toContain('α');

    press(input, 'Enter');
    expect(view.state.doc.child(0).child(1).attrs.latex).toBe('x+\\alpha');
    view.destroy();
    expect(host.querySelector('.pm-autocomplete-panel')).toBeNull();
  });

  it('Esc 先关闭补全面板，再按 Esc 才离开公式', async () => {
    const { view, host, input } = mountFormula('');
    typeInto(input, '\\fra');
    await vi.advanceTimersByTimeAsync(100);
    expect(host.querySelector('.pm-autocomplete-panel')).not.toBeNull();

    press(input, 'Escape');
    expect(host.querySelector('.pm-autocomplete-panel')).toBeNull();
    expect(host.querySelector('.math-node-edit')!.hasAttribute('hidden')).toBe(false);

    press(input, 'Escape');
    expect(view.state.doc.child(0).child(1).attrs.latex).toBe('\\fra');
    view.destroy();
  });
});
