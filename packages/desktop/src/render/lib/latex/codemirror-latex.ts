// ================================
// LaTeX 语法高亮扩展
//
// 为 CodeMirror 6 提供 LaTeX 语言支持
// 特性：
// 1. 完整的 LaTeX 语法高亮
// 2. 命令、环境、数学公式识别
// 3. 注释、字符串、特殊字符处理
// 4. 与主题系统集成
// ================================

import {
  HighlightStyle,
  StreamLanguage,
  indentOnInput,
  indentService,
  syntaxHighlighting,
  type IndentContext,
  type StringStream,
  type StreamParser,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import {
  LATEX_LANGUAGE_CONFIGURATION,
  MATH_ENVIRONMENTS,
  SECTION_COMMANDS,
  VERBATIM_ENVIRONMENTS,
} from '@code-reader/syntax-parser';

const { indentationRules } = LATEX_LANGUAGE_CONFIGURATION;
/** 使下一行缩进一级的标记（\begin{…}，document 除外） */
const INDENT_INCREASE = new RegExp(indentationRules?.increaseIndentPattern ?? '(?!)', 'g');
/** 使本行回退一级的标记（\end{…}，document 除外） */
const INDENT_DECREASE = new RegExp(indentationRules?.decreaseIndentPattern ?? '(?!)', 'g');
/** 行首是回退标记 */
const DECREASE_AT_LINE_START = new RegExp(`^\\s*(?:${INDENT_DECREASE.source})`);

/**
 * 编辑行为来自 syntax-parser 的 LaTeX 语言配置：
 * - 行注释 % （⌘/ / Ctrl+/ 切换注释）
 * - 自动配对 { [ ( $；LaTeX 的引号是 ``…'' ，不配对 ' 与 "。
 *   \( \[ 等多字符配对 CodeMirror 不支持，由补全片段提供
 * - 缩进规则：输入完 \end{…} 时按 indentOnInput 重新缩进本行
 */
const LATEX_LANGUAGE_DATA = {
  indentOnInput: new RegExp(`${DECREASE_AT_LINE_START.source}\\s*$`),
  commentTokens: { line: LATEX_LANGUAGE_CONFIGURATION.lineComment },
  closeBrackets: {
    brackets: (LATEX_LANGUAGE_CONFIGURATION.autoClosingPairs ?? [])
      .filter((pair) => pair.open.length === 1)
      .map((pair) => pair.open),
  },
};

// ================================
// LaTeX 词法状态机（只用于着色，语法诊断由 analysis.ts 负责）
//
// 环境与命令名单来自 syntax-parser，与诊断用的解析器一致。
// 数学模式的退出条件与 TeX 一致：对应的结束分隔符、同名的 \end{环境}；
// $ / $$ / \[ / \( 公式不能跨段落，遇到空行即退出，未闭合的公式不会把后文整篇染成公式色
// ================================

/** 公式的结束标记：分隔符公式为结束分隔符，环境公式为环境名 */
type MathClose = { kind: 'delimiter'; close: '$' | '$$' | '\\]' | '\\)' } | { kind: 'environment'; name: string };

interface LatexState {
  /** 当前所在公式；null 为文本模式 */
  math: MathClose | null;
  /** 环境公式内同名环境的嵌套深度（\begin{matrix} 里再套 matrix） */
  mathEnvDepth: number;
  /** 已读到 \begin / \end，等待环境名参数 */
  pendingEnv: 'begin' | 'end' | null;
  /** 原样输出环境名（verbatim 等） */
  verbatimEnv: string | null;
}

function createInitialState(): LatexState {
  return { math: null, mathEnvDepth: 0, pendingEnv: null, verbatimEnv: null };
}

function copyState(state: LatexState): LatexState {
  return { ...state };
}

const SECTION_COMMAND_SET = new Set(Object.keys(SECTION_COMMANDS));
const MATH_ENVIRONMENT_SET = new Set<string>(MATH_ENVIRONMENTS);
const VERBATIM_ENVIRONMENT_SET = new Set<string>(VERBATIM_ENVIRONMENTS);

/** 前言与文档结构命令 */
const DOCUMENT_COMMANDS = new Set([
  'documentclass',
  'usepackage',
  'newcommand',
  'renewcommand',
  'providecommand',
  'newenvironment',
  'renewenvironment',
  'DeclareMathOperator',
  'title',
  'author',
  'date',
  'maketitle',
  'tableofcontents',
]);

const latexStreamParser: StreamParser<LatexState> = {
  name: 'latex',
  languageData: LATEX_LANGUAGE_DATA,
  startState: createInitialState,
  copyState,

  token(stream: StringStream, state: LatexState): string | null {
    if (state.verbatimEnv) return tokenVerbatim(stream, state);

    if (state.pendingEnv) {
      const env = tokenEnvironmentName(stream, state);
      if (env !== undefined) return env;
    }

    if (stream.peek() === '%') {
      stream.skipToEnd();
      return 'comment';
    }

    return state.math ? tokenMath(stream, state) : tokenText(stream, state);
  },

  /** 空行（段落结束）：分隔符公式在 TeX 中不能跨段落，在此结束 */
  blankLine(state: LatexState) {
    if (state.math?.kind === 'delimiter') state.math = null;
    state.pendingEnv = null;
  },

  indent: () => null,
};

/** 原样输出环境：直到 \end{同名} 为止不做任何解释 */
function tokenVerbatim(stream: StringStream, state: LatexState): string | null {
  const end = `\\end{${state.verbatimEnv}}`;
  if (stream.match(end)) {
    state.verbatimEnv = null;
    return 'keyword';
  }
  const index = stream.string.indexOf(end, stream.pos);
  if (index === -1) stream.skipToEnd();
  else stream.pos = index;
  return 'string';
}

/**
 * \begin / \end 之后的环境名参数 {name}：切换数学 / 原样输出模式。
 * 不是环境名参数时返回 undefined，由常规流程继续处理
 */
function tokenEnvironmentName(stream: StringStream, state: LatexState): string | null | undefined {
  if (stream.eatSpace()) return null;
  const command = state.pendingEnv;
  state.pendingEnv = null;
  const match = stream.match(/^\{([^{}]*)\}/);
  if (!match || typeof match === 'boolean') return undefined;
  const name = match[1].trim();

  const math = state.math;
  if (math?.kind === 'environment') {
    if (name === math.name) {
      if (command === 'begin') state.mathEnvDepth++;
      else if (state.mathEnvDepth > 0) state.mathEnvDepth--;
      else state.math = null;
    }
  } else if (command === 'begin' && !math) {
    if (VERBATIM_ENVIRONMENT_SET.has(name)) state.verbatimEnv = name;
    else if (MATH_ENVIRONMENT_SET.has(name)) state.math = { kind: 'environment', name };
  }
  return 'typeName';
}

/** 反斜杠开头的命令（文本与数学模式共用）：返回命令名；单个符号的转义（\%  \,  \\）返回空串 */
function readCommand(stream: StringStream): string {
  stream.next();
  const name = stream.match(/^[a-zA-Z@]+\*?/);
  if (name && typeof name !== 'boolean') return name[0];
  stream.next();
  return '';
}

/** \verb|…| 的参数在同一行内原样读取 */
function readVerbArgument(stream: StringStream): void {
  const delimiter = stream.next();
  if (!delimiter) return;
  const end = stream.string.indexOf(delimiter, stream.pos);
  if (end === -1) stream.skipToEnd();
  else stream.pos = end + 1;
}

function tokenText(stream: StringStream, state: LatexState): string | null {
  const ch = stream.peek();

  if (ch === '$') {
    stream.next();
    state.math = { kind: 'delimiter', close: stream.eat('$') ? '$$' : '$' };
    return 'keyword';
  }

  if (ch === '\\') {
    if (stream.match('\\[') || stream.match('\\(')) {
      state.math = { kind: 'delimiter', close: stream.current() === '\\[' ? '\\]' : '\\)' };
      return 'keyword';
    }
    const command = readCommand(stream);
    if (!command) return 'escape';
    if (command === 'begin' || command === 'end') {
      state.pendingEnv = command;
      return 'keyword';
    }
    if (command === 'verb' || command === 'verb*') {
      readVerbArgument(stream);
      return 'string';
    }
    if (SECTION_COMMAND_SET.has(command.replace('*', ''))) return 'heading';
    if (DOCUMENT_COMMANDS.has(command)) return 'meta';
    return 'keyword';
  }

  if (ch === '{' || ch === '}' || ch === '[' || ch === ']') {
    stream.next();
    return 'bracket';
  }

  stream.match(/^[^\\{}[\]$%]+/);
  return null;
}

function tokenMath(stream: StringStream, state: LatexState): string | null {
  const math = state.math!;
  if (math.kind === 'delimiter' && stream.match(math.close)) {
    state.math = null;
    return 'keyword';
  }

  const ch = stream.peek();
  if (ch === '\\') {
    const command = readCommand(stream);
    if (command === 'begin' || command === 'end') {
      state.pendingEnv = command;
      return 'keyword';
    }
    return command ? 'variableName.function' : 'escape';
  }

  if (stream.match(/^[0-9]+(?:\.[0-9]+)?/)) return 'number';
  if (stream.match(/^[+\-*/=<>!^_&|',.;:]+/)) return 'operator';
  if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '[' || ch === ']') {
    stream.next();
    return 'bracket';
  }
  if (stream.match(/^[a-zA-Z]+/)) return 'variableName';
  // 其他字符（空白、公式中的汉字等）不着色
  stream.next();
  stream.match(/^[^\\{}()[\]$%+\-*/=<>!^_&|',.;:a-zA-Z0-9]+/);
  return null;
}

// ================================
// 导出语言支持
// ================================

/** LaTeX 语言定义 */
const latexLanguage = StreamLanguage.define(latexStreamParser);

/**
 * LaTeX 高亮样式（颜色取自主题 CSS 变量）。
 * 公式内容与转义符不使用 --code-variable / --code-regex：两者在主题中是红色，
 * 成片的公式会被误认为错误提示；错误只由诊断的波浪线表达
 */
const latexHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: t.heading, color: 'var(--code-function)', fontWeight: 'bold' },
  { tag: t.meta, color: 'var(--code-tag)' },
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--code-string)' },
  { tag: t.escape, color: 'var(--code-string)' },
  { tag: t.number, color: 'var(--code-number)' },
  { tag: t.variableName, color: 'var(--code-property)' },
  { tag: t.function(t.variableName), color: 'var(--code-function)' },
  { tag: t.typeName, color: 'var(--code-class-name)' },
  { tag: t.operator, color: 'var(--code-operator)' },
  { tag: t.bracket, color: 'var(--code-punctuation)' },
]);

/** 去掉行内 % 注释（\% 是转义的百分号，不是注释） */
function stripLineComment(text: string): string {
  const match = /(^|[^\\])%/.exec(text);
  return match ? text.slice(0, match.index + match[1].length) : text;
}

/** 一行中缩进标记的净增量：\begin 数减 \end 数 */
function indentBalance(text: string): number {
  const code = stripLineComment(text);
  return (code.match(INDENT_INCREASE)?.length ?? 0) - (code.match(INDENT_DECREASE)?.length ?? 0);
}

/**
 * 环境缩进（规则取自语言配置的 indentationRules）：
 * 以上一个非空行的缩进为基准，该行打开了环境则加一级；本行以 \end{…} 开头则减一级。
 * 用 IndentContext.lineAt 读取行，回车时模拟断行的位置也能正确计算
 */
export function latexIndentation(context: IndentContext, pos: number): number {
  const current = context.lineAt(pos, 1);
  let previous = current.from > 0 ? context.lineAt(current.from - 1, -1) : null;
  while (previous && !previous.text.trim() && previous.from > 0) {
    previous = context.lineAt(previous.from - 1, -1);
  }
  if (!previous || !previous.text.trim()) return 0;

  let indent = context.lineIndent(previous.from, -1);
  if (indentBalance(previous.text) > 0) indent += context.unit;
  if (DECREASE_AT_LINE_START.test(current.text)) indent -= context.unit;
  return Math.max(0, indent);
}

/** 获取 LaTeX 语言扩展：语法高亮、环境缩进 */
export function latex() {
  return [
    latexLanguage,
    syntaxHighlighting(latexHighlightStyle),
    indentService.of(latexIndentation),
    indentOnInput(),
  ];
}
