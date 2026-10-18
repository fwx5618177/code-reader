import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { toggleComment } from '@codemirror/commands';
import { closeBrackets, insertBracket } from '@codemirror/autocomplete';
import { latex } from '../codemirror-latex';

function createState(doc: string, cursor = doc.length) {
  return EditorState.create({ doc, selection: { anchor: cursor }, extensions: [latex(), closeBrackets()] });
}

/** 模拟输入一个字符：可自动配对时返回配对后的文本 */
function typeChar(state: EditorState, ch: string): string {
  const tr = insertBracket(state, ch);
  return tr ? tr.state.doc.toString() : state.doc.toString() + ch;
}

describe('LaTeX 编辑行为（syntax-parser 语言配置）', () => {
  it('切换注释使用 %', () => {
    let state = createState('\\section{引言}', 0);
    toggleComment({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe('% \\section{引言}');
  });

  it('自动配对 { [ ( $，不配对 LaTeX 中作为引号使用的 \' 与 "', () => {
    expect(typeChar(createState('\\textbf'), '{')).toBe('\\textbf{}');
    expect(typeChar(createState('x '), '$')).toBe('x $$');
    expect(typeChar(createState('x '), '[')).toBe('x []');
    expect(typeChar(createState("``quote"), "'")).toBe("``quote'");
    expect(typeChar(createState('a '), '"')).toBe('a "');
  });
});
