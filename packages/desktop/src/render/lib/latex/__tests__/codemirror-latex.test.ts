import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { insertNewlineAndIndent, toggleComment } from '@codemirror/commands';
import { ensureSyntaxTree, getIndentation, IndentContext } from '@codemirror/language';
import { closeBrackets, insertBracket } from '@codemirror/autocomplete';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
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

describe('LaTeX 语法着色', () => {
  /** 每段着色文本及其类别 */
  const highlighter = tagHighlighter([
    { tag: t.variableName, class: 'math-variable' },
    { tag: t.function(t.variableName), class: 'math-variable math-command' },
    { tag: t.escape, class: 'escape' },
    { tag: t.comment, class: 'comment' },
  ]);
  function highlight(doc: string): Array<[string, string]> {
    const state = createState(doc);
    const tree = ensureSyntaxTree(state, doc.length, 5000)!;
    const spans: Array<[string, string]> = [];
    highlightTree(tree, highlighter, (from, to, classes) => spans.push([doc.slice(from, to), classes]));
    return spans;
  }
  /** 公式内容的类别：变量与数学命令 */
  const isMath = (classes: string) => classes.includes('math-variable');
  const mathText = (doc: string) => highlight(doc).filter(([, c]) => isMath(c)).map(([text]) => text);

  it('数学环境在 \\end{同名} 处退出，之后的正文不再按公式着色', () => {
    const doc = '\\begin{equation}\nx = y\n\\end{equation}\nplain text and words';
    expect(mathText(doc)).toEqual(['x', 'y']);
  });

  it('公式内嵌套的同名 / 异名环境不会提前退出', () => {
    const doc = '\\begin{align}\\begin{pmatrix}a\\end{pmatrix} b\\end{align} after';
    expect(mathText(doc)).toEqual(['a', 'b']);
    const nested = '\\begin{matrix}\\begin{matrix}a\\end{matrix} b\\end{matrix} after';
    expect(mathText(nested)).toEqual(['a', 'b']);
  });

  it('\\[ \\] 与 $ $ 正确开合；数学命令着色为函数', () => {
    expect(mathText('\\[ \\alpha + x \\] word $y$ word')).toEqual(['\\alpha', 'x', 'y']);
    expect(highlight('$\\alpha$').find(([text]) => text === '\\alpha')?.[1]).toContain('math-command');
  });

  it('未闭合的 $ 在空行（段落结束）处结束，不会染色后文', () => {
    expect(mathText('cost $5 here\n\nnext paragraph')).toEqual(['here']);
  });

  it('\\% 是转义而不是注释；% 之后才是注释', () => {
    const spans = highlight('50\\% rate % note');
    expect(spans.find(([text]) => text === '\\%')?.[1]).toBe('escape');
    expect(spans.find(([, c]) => c === 'comment')?.[0]).toBe('% note');
  });

  it('\\verb 与 verbatim 环境内的内容原样显示，不进入公式', () => {
    expect(mathText('\\verb|$x$| text $y$')).toEqual(['y']);
    expect(mathText('\\begin{verbatim}\n$x$ \\end{equation}\n\\end{verbatim}\n$y$')).toEqual(['y']);
  });

  it('subequations 是文本级容器，其中的文字不按公式着色', () => {
    const doc = '\\begin{subequations}\nintro\n\\begin{equation}a\\end{equation}\n\\end{subequations}';
    expect(mathText(doc)).toEqual(['a']);
  });
});

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
