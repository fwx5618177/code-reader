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

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import {
  StreamLanguage,
  type StringStream,
  type StreamParser,
} from '@codemirror/language';

// ================================
// LaTeX 语法定义
// ================================

/** LaTeX 解析状态 */
interface LatexState {
  /** 当前模式 */
  mode: 'text' | 'math' | 'command' | 'comment' | 'verbatim';
  /** 数学模式类型 */
  mathDelimiter: string | null;
  /** 嵌套深度 */
  braceDepth: number;
  /** 方括号深度 */
  bracketDepth: number;
  /** verbatim 环境名称 */
  verbatimEnv: string | null;
  /** 当前命令名 */
  currentCommand: string | null;
}

/** 创建初始状态 */
function createInitialState(): LatexState {
  return {
    mode: 'text',
    mathDelimiter: null,
    braceDepth: 0,
    bracketDepth: 0,
    verbatimEnv: null,
    currentCommand: null,
  };
}

/** 复制状态 */
function copyState(state: LatexState): LatexState {
  return { ...state };
}

/** LaTeX 命令列表 */
const SECTION_COMMANDS = [
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
];

const FORMAT_COMMANDS = [
  'textbf',
  'textit',
  'texttt',
  'textrm',
  'textsf',
  'textsc',
  'emph',
  'underline',
];

const DOCUMENT_COMMANDS = [
  'documentclass',
  'usepackage',
  'newcommand',
  'renewcommand',
  'newenvironment',
  'title',
  'author',
  'date',
  'maketitle',
  'tableofcontents',
];

const MATH_ENVIRONMENTS = [
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'eqnarray',
  'eqnarray*',
  'split',
  'cases',
  'array',
  'matrix',
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Vmatrix',
];

const VERBATIM_ENVIRONMENTS = ['verbatim', 'lstlisting', 'minted', 'alltt'];

/** LaTeX 流解析器 */
const latexStreamParser: StreamParser<LatexState> = {
  name: 'latex',

  startState: createInitialState,

  copyState: copyState,

  token(stream: StringStream, state: LatexState): string | null {
    // 处理 verbatim 模式
    if (state.verbatimEnv) {
      const endPattern = new RegExp(`\\\\end\\{${state.verbatimEnv}\\}`);
      const endMatch = stream.match(endPattern);
      if (endMatch) {
        state.verbatimEnv = null;
        state.mode = 'text';
        return 'keyword';
      }
      stream.next();
      return 'string';
    }

    // 处理注释
    if (stream.peek() === '%') {
      stream.skipToEnd();
      return 'comment';
    }

    // 处理数学模式
    if (state.mode === 'math') {
      return tokenMath(stream, state);
    }

    // 处理命令模式
    if (state.mode === 'command') {
      return tokenCommand(stream, state);
    }

    // 文本模式
    return tokenText(stream, state);
  },

  indent: () => null,
};

/** 处理文本模式 */
function tokenText(stream: StringStream, state: LatexState): string | null {
  const ch = stream.peek();

  // 检查数学模式开始
  if (ch === '$') {
    stream.next();
    if (stream.peek() === '$') {
      stream.next();
      state.mode = 'math';
      state.mathDelimiter = '$$';
      return 'keyword';
    }
    state.mode = 'math';
    state.mathDelimiter = '$';
    return 'keyword';
  }

  // 检查 \[ 数学模式
  if (ch === '\\' && stream.match(/^\\\[/, false)) {
    stream.next();
    stream.next();
    state.mode = 'math';
    state.mathDelimiter = '\\[';
    return 'keyword';
  }

  // 检查 \( 数学模式
  if (ch === '\\' && stream.match(/^\\\(/, false)) {
    stream.next();
    stream.next();
    state.mode = 'math';
    state.mathDelimiter = '\\(';
    return 'keyword';
  }

  // 处理命令
  if (ch === '\\') {
    stream.next();
    // 检查特殊字符
    if (stream.match(/^[%$&_{}#~^\\]/, true)) {
      return 'escape';
    }
    // 匹配命令名
    if (stream.match(/^[a-zA-Z@]+\*?/, true)) {
      const cmd = stream.current().slice(1).replace('*', '');
      state.currentCommand = cmd;

      // 检查 begin/end 环境
      if (cmd === 'begin' || cmd === 'end') {
        state.mode = 'command';
        return 'keyword';
      }

      // 检查章节命令
      if (SECTION_COMMANDS.includes(cmd)) {
        return 'heading';
      }

      // 检查格式命令
      if (FORMAT_COMMANDS.includes(cmd)) {
        return 'keyword';
      }

      // 检查文档命令
      if (DOCUMENT_COMMANDS.includes(cmd)) {
        return 'meta';
      }

      return 'keyword';
    }
    return 'keyword';
  }

  // 处理花括号
  if (ch === '{') {
    stream.next();
    state.braceDepth++;
    return 'bracket';
  }

  if (ch === '}') {
    stream.next();
    state.braceDepth = Math.max(0, state.braceDepth - 1);
    return 'bracket';
  }

  // 处理方括号
  if (ch === '[') {
    stream.next();
    state.bracketDepth++;
    return 'bracket';
  }

  if (ch === ']') {
    stream.next();
    state.bracketDepth = Math.max(0, state.bracketDepth - 1);
    return 'bracket';
  }

  // 处理普通文本
  stream.match(/^[^\\{}[\]$%]+/);
  return null;
}

/** 处理数学模式 */
function tokenMath(stream: StringStream, state: LatexState): string | null {
  const ch = stream.peek();

  // 检查数学模式结束
  if (state.mathDelimiter === '$' && ch === '$') {
    stream.next();
    state.mode = 'text';
    state.mathDelimiter = null;
    return 'keyword';
  }

  if (state.mathDelimiter === '$$') {
    if (ch === '$' && stream.match(/^\$\$/, false)) {
      stream.next();
      stream.next();
      state.mode = 'text';
      state.mathDelimiter = null;
      return 'keyword';
    }
  }

  if (state.mathDelimiter === '\\[' && ch === '\\' && stream.match(/^\\\]/, false)) {
    stream.next();
    stream.next();
    state.mode = 'text';
    state.mathDelimiter = null;
    return 'keyword';
  }

  if (state.mathDelimiter === '\\(' && ch === '\\' && stream.match(/^\\\)/, false)) {
    stream.next();
    stream.next();
    state.mode = 'text';
    state.mathDelimiter = null;
    return 'keyword';
  }

  // 数学命令
  if (ch === '\\') {
    stream.next();
    if (stream.match(/^[a-zA-Z]+/, true)) {
      return 'variableName';
    }
    return 'operator';
  }

  // 数字
  if (stream.match(/^[0-9]+\.?[0-9]*/, true)) {
    return 'number';
  }

  // 运算符
  if (stream.match(/^[+\-*/=<>!^_&|]+/, true)) {
    return 'operator';
  }

  // 括号
  if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '[' || ch === ']') {
    stream.next();
    return 'bracket';
  }

  // 希腊字母和其他变量
  if (stream.match(/^[a-zA-Z]+/, true)) {
    return 'variableName';
  }

  stream.next();
  return 'variableName';
}

/** 处理命令模式（环境名称等） */
function tokenCommand(stream: StringStream, state: LatexState): string | null {
  const ch = stream.peek();

  // 跳过空白
  if (stream.eatSpace()) {
    return null;
  }

  // 处理环境名称
  if (ch === '{') {
    stream.next();
    const envMatch = stream.match(/^([a-zA-Z*]+)\}/, true);
    if (envMatch) {
      const envName = envMatch[1];

      // 检查是否为数学环境
      if (MATH_ENVIRONMENTS.includes(envName)) {
        if (state.currentCommand === 'begin') {
          state.mode = 'math';
          state.mathDelimiter = envName;
        } else {
          state.mode = 'text';
          state.mathDelimiter = null;
        }
        return 'typeName';
      }

      // 检查是否为 verbatim 环境
      if (VERBATIM_ENVIRONMENTS.includes(envName)) {
        if (state.currentCommand === 'begin') {
          state.verbatimEnv = envName;
        }
        state.mode = 'text';
        return 'typeName';
      }

      state.mode = 'text';
      return 'typeName';
    }
    return 'bracket';
  }

  // 退出命令模式
  state.mode = 'text';
  return tokenText(stream, state);
}

// ================================
// 导出语言支持
// ================================

/** LaTeX 语言定义 */
export const latexLanguage = StreamLanguage.define(latexStreamParser);

/** LaTeX 高亮样式（深色主题） */
export const latexDarkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-keyword, #569cd6)' },
  { tag: t.heading, color: 'var(--code-function, #dcdcaa)', fontWeight: 'bold' },
  { tag: t.meta, color: 'var(--code-tag, #4ec9b0)' },
  { tag: t.comment, color: 'var(--code-comment, #6a9955)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--code-string, #ce9178)' },
  { tag: t.number, color: 'var(--code-number, #b5cea8)' },
  { tag: t.variableName, color: 'var(--code-variable, #9cdcfe)' },
  { tag: t.typeName, color: 'var(--code-class-name, #4ec9b0)' },
  { tag: t.operator, color: 'var(--code-operator, #d4d4d4)' },
  { tag: t.bracket, color: 'var(--code-punctuation, #808080)' },
  { tag: t.escape, color: 'var(--code-regex, #d16969)' },
]);

/** LaTeX 高亮样式（浅色主题） */
export const latexLightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-keyword, #0000ff)' },
  { tag: t.heading, color: 'var(--code-function, #795e26)', fontWeight: 'bold' },
  { tag: t.meta, color: 'var(--code-tag, #267f99)' },
  { tag: t.comment, color: 'var(--code-comment, #008000)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--code-string, #a31515)' },
  { tag: t.number, color: 'var(--code-number, #098658)' },
  { tag: t.variableName, color: 'var(--code-variable, #0451a5)' },
  { tag: t.typeName, color: 'var(--code-class-name, #267f99)' },
  { tag: t.operator, color: 'var(--code-operator, #393a34)' },
  { tag: t.bracket, color: 'var(--code-punctuation, #393a34)' },
  { tag: t.escape, color: 'var(--code-regex, #ee0000)' },
]);

/** 获取 LaTeX 语法高亮扩展 */
export function latex() {
  return [latexLanguage, syntaxHighlighting(latexDarkHighlightStyle)];
}

/** 获取带自定义主题的 LaTeX 语法高亮扩展 */
export function latexWithTheme(isDark: boolean = true) {
  const highlightStyle = isDark ? latexDarkHighlightStyle : latexLightHighlightStyle;
  return [latexLanguage, syntaxHighlighting(highlightStyle)];
}

// ================================
// 默认导出
// ================================

export default {
  latexLanguage,
  latexDarkHighlightStyle,
  latexLightHighlightStyle,
  latex,
  latexWithTheme,
};
