import { describe, expect, it } from 'vitest';
import { CompletionContext, type Completion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { latexCommandSource, toSnippetTemplate } from '../codemirror-completion';

function complete(doc: string, explicit = false) {
  const state = EditorState.create({ doc });
  return latexCommandSource(new CompletionContext(state, doc.length, explicit));
}

/** 在编辑器里接受补全项，返回文档与光标位置 */
function accept(doc: string, option: Completion) {
  const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.length } }) });
  const result = complete(doc)!;
  if (typeof option.apply === 'function') option.apply(view, option, result.from, doc.length);
  else view.dispatch({ changes: { from: result.from, to: doc.length, insert: option.apply ?? option.label } });
  const out = { text: view.state.doc.toString(), cursor: view.state.selection.main.head };
  view.destroy();
  return out;
}

describe('.tex 源码的命令补全', () => {
  it('\\ 加字母时列出命令，正文命令在前；只有 \\ 时需要手动打开；\\\\ 换行后的字母不触发', () => {
    const result = complete('正文 \\sect')!;
    expect(result.from).toBe(3);
    expect(result.filter).toBe(false);
    expect(result.options[0]).toMatchObject({ label: '\\section{}', detail: '节' });
    expect(complete('a \\')).toBeNull();
    expect(complete('a \\', true)!.options.length).toBeGreaterThan(0);
    expect(complete('a \\\\al')).toBeNull();
    expect(complete('纯文本')).toBeNull();
  });

  it('模板里的 {} [] 变成字段，光标停在第一个字段；原有的 \\{ \\} 保留', () => {
    expect(toSnippetTemplate('\\frac{}{} ')).toBe('\\frac{${}}{${}}');
    expect(toSnippetTemplate('\\left\\{ {} \\right\\}')).toBe('\\left\\\\{ {${}} \\right\\\\}');

    const frac = complete('$\\fra')!.options.find((option) => option.label === '\\frac{}{}')!;
    expect(accept('$\\fra', frac)).toEqual({ text: '$\\frac{}{}', cursor: 7 });

    const brace = complete('$\\left')!.options.find((option) => option.label === '\\left\\{ \\right\\}')!;
    expect(accept('$\\left', brace).text).toBe('$\\left\\{  \\right\\}');

    const alpha = complete('$\\alph')!.options[0]!;
    expect(accept('$\\alph', alpha)).toEqual({ text: '$\\alpha ', cursor: 8 });
  });
});
