import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { insertNewlineAndIndent, toggleComment } from '@codemirror/commands';
import { getIndentation, IndentContext } from '@codemirror/language';
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

/** 在光标处按回车（换行并缩进），返回新文档 */
function pressEnter(doc: string, cursor = doc.length): string {
  let state = createState(doc, cursor);
  insertNewlineAndIndent({ state, dispatch: (tr) => (state = tr.state) });
  return state.doc.toString();
}

describe('LaTeX 环境缩进（syntax-parser 语言配置的 indentationRules）', () => {
  it('\\begin{…} 后换行缩进一级，document 环境不缩进', () => {
    expect(pressEnter('\\begin{itemize}')).toBe('\\begin{itemize}\n  ');
    expect(pressEnter('\\begin{document}')).toBe('\\begin{document}\n');
  });

  it('沿用上一个非空行的缩进；同一行开合的环境不改变缩进', () => {
    expect(pressEnter('\\begin{itemize}\n  \\item a')).toBe('\\begin{itemize}\n  \\item a\n  ');
    expect(pressEnter('  \\begin{x}y\\end{x}')).toBe('  \\begin{x}y\\end{x}\n  ');
    expect(pressEnter('\\begin{a}\n\n')).toBe('\\begin{a}\n\n\n  ');
  });

  it('注释里的 \\begin 不算，转义的 \\% 不是注释', () => {
    expect(pressEnter('% \\begin{itemize}')).toBe('% \\begin{itemize}\n');
    expect(pressEnter('50\\% \\begin{center}')).toBe('50\\% \\begin{center}\n  ');
  });

  it('以 \\end{…} 开头的行回退一级', () => {
    const state = createState('\\begin{itemize}\n  \\item a\n  \\end{itemize}');
    const lastLine = state.doc.line(3);
    expect(getIndentation(new IndentContext(state), lastLine.from)).toBe(0);
  });

  it('输入完 \\end{…} 时触发重新缩进', () => {
    const indentOnInput = createState('').languageDataAt<RegExp>('indentOnInput', 0)[0];
    expect(indentOnInput.test('    \\end{itemize}')).toBe(true);
    expect(indentOnInput.test('    \\end{document}')).toBe(false);
    expect(indentOnInput.test('    \\end{item')).toBe(false);
  });
});
