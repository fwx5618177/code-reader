// ================================
// .tex 源码编辑器的命令补全（CodeMirror）
// 输入 \ 加字母时列出命令：数据与排序和 Markdown 编辑器的 LaTeX 补全相同（lib/editor/latex-completion，document 范围：
// 正文命令、环境、文本符号与公式命令）。模板里的 {} [] 变成可用 Tab 依次跳转的字段。
// 手动打开：Ctrl+空格，macOS 另有 Option+`（CodeMirror 补全的默认快捷键）
// ================================

import {
  autocompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { filterAndSortItems } from '@code-reader/autocomplete-service-extras';
import { matchLatexCommands } from '../editor/latex-completion';

/** 显示条数上限（与 Markdown 编辑器的补全一致取前若干条，避免一次构建上千个选项） */
const MAX_OPTIONS = 50;

/**
 * 插入文本 → CodeMirror 片段模板：空的 {} [] 变成字段（光标停在第一个字段，Tab 跳到下一个）；
 * 原有的 \{ \} 按片段语法转义；结尾空格去掉（字段里填完内容再继续输入）
 */
export function toSnippetTemplate(insertText: string): string {
  return insertText
    .replace(/\\([{}])/g, '\\\\$1')
    .replace(/\{\}/g, '{${}}')
    .replace(/\[\]/g, '[${}]')
    .replace(/ $/, '');
}

function toCompletion(label: string, insertText: string, detail: string | undefined): Completion {
  const hasField = /\{\}|\[\]/.test(insertText);
  return { label, detail, type: 'keyword', apply: hasField ? snippet(toSnippetTemplate(insertText)) : insertText };
}

/** \ 加字母（不是 \\ 换行之后的字母） */
export function latexCommandSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\\[a-zA-Z]*/);
  if (!word) return null;
  if (word.from > 0 && context.state.sliceDoc(word.from - 1, word.from) === '\\') return null;
  const query = word.text.slice(1);
  if (!query && !context.explicit) return null;

  const matched = matchLatexCommands('document', query);
  const items = filterAndSortItems(matched, query, MAX_OPTIONS, new Set(matched));
  if (items.length === 0) return null;
  return {
    from: word.from,
    // 已按匹配程度与常用程度排好序，不再由 CodeMirror 模糊过滤；每次输入重新查询
    filter: false,
    options: items.map((item) => toCompletion(item.label, item.insertText, item.detail)),
  };
}

/** .tex 源码的命令补全扩展 */
export function latexCompletion(): Extension {
  return autocompletion({ override: [latexCommandSource], icons: false });
}
