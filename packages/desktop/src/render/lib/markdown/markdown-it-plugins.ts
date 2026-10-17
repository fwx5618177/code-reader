// ================================
// markdown-it 语法扩展
// - 数学公式：行内 $…$、块级 $$…$$
// - 双向链接：[[目标]] / [[目标|别名]]
// - 任务列表：- [ ] / - [x]
// ================================

import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';

const DOLLAR = 0x24; // $
const BACKSLASH = 0x5c; // \
const OPEN_BRACKET = 0x5b; // [

// ================================
// 数学公式
// ================================

/**
 * 行内公式 $…$
 * 规则（与 Pandoc 一致，避免误判金额 "$5 和 $10"）：
 * - 起始 $ 后不能是空白，结束 $ 前不能是空白
 * - 结束 $ 后不能紧跟数字
 * - \$ 为转义，不作为定界符
 * - $$…$$ 出现在段落内部时同样作为行内公式
 */
function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== DOLLAR) return false;

  const isDouble = src.charCodeAt(pos + 1) === DOLLAR;
  const delimiter = isDouble ? '$$' : '$';
  const contentStart = pos + delimiter.length;
  if (contentStart >= posMax || /\s/.test(src[contentStart])) return false;

  let end = contentStart;
  while (end < posMax) {
    const code = src.charCodeAt(end);
    if (code === BACKSLASH) {
      end += 2;
      continue;
    }
    if (code === DOLLAR && src.startsWith(delimiter, end)) {
      const afterClose = end + delimiter.length;
      const prevIsSpace = /\s/.test(src[end - 1]);
      const nextIsDigit = afterClose < posMax && /[0-9]/.test(src[afterClose]);
      if (!prevIsSpace && !nextIsDigit && end > contentStart) break;
    }
    end++;
  }
  if (end >= posMax) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = delimiter;
    token.content = src.slice(contentStart, end);
  }
  state.pos = end + delimiter.length;
  return true;
}

/**
 * 块级公式
 * $$
 * latex
 * $$
 * 也支持单行 $$ latex $$
 */
function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];

  // 缩进超过 3 个空格属于代码块
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (pos + 2 > max || state.src.slice(pos, pos + 2) !== '$$') return false;

  pos += 2;
  let firstLine = state.src.slice(pos, max);
  let nextLine = startLine;
  let found = false;

  // 单行形式 $$ … $$
  if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }

  if (silent) return true;

  const lines: string[] = [];
  if (firstLine.trim()) lines.push(firstLine);

  while (!found) {
    nextLine++;
    if (nextLine >= endLine) break;
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    max = state.eMarks[nextLine];
    // 遇到缩进更少的非空行时，块已经结束（例如列表项内的公式）
    if (pos < max && state.sCount[nextLine] < state.blkIndent) break;
    const line = state.src.slice(pos, max);
    if (line.trimEnd().endsWith('$$')) {
      const before = line.trimEnd().slice(0, -2);
      if (before.trim()) lines.push(before);
      found = true;
      break;
    }
    lines.push(state.src.slice(state.bMarks[nextLine] + Math.min(state.tShift[nextLine], state.blkIndent), max));
  }

  state.line = nextLine + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = lines.join('\n').trim();
  token.markup = '$$';
  token.map = [startLine, state.line];
  return true;
}

// ================================
// 双向链接
// ================================

/**
 * [[目标]] / [[目标|别名]]，目标中不允许出现换行与方括号
 */
function wikiLinkRule(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== OPEN_BRACKET || src.charCodeAt(pos + 1) !== OPEN_BRACKET) {
    return false;
  }
  const close = src.indexOf(']]', pos + 2);
  if (close === -1 || close > posMax) return false;

  const inner = src.slice(pos + 2, close);
  if (!inner.trim() || /[[\]\n]/.test(inner)) return false;

  if (!silent) {
    const separator = inner.indexOf('|');
    const target = (separator === -1 ? inner : inner.slice(0, separator)).trim();
    const alias = separator === -1 ? null : inner.slice(separator + 1).trim() || null;
    if (!target) return false;
    const token = state.push('wiki_link', 'a', 0);
    token.meta = { target, alias };
    token.content = inner;
  }
  state.pos = close + 2;
  return true;
}

// ================================
// 任务列表
// ================================

const TASK_MARKER = /^\[([ xX])\](?:\s+|$)/;

/**
 * 识别列表项开头的 [ ] / [x]，写入 list_item_open 的 data-checked 属性并移除标记文本
 */
function taskListRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (
      inline.type !== 'inline' ||
      tokens[i - 1].type !== 'paragraph_open' ||
      tokens[i - 2].type !== 'list_item_open'
    ) {
      continue;
    }
    const match = TASK_MARKER.exec(inline.content);
    if (!match) continue;

    tokens[i - 2].attrSet('data-checked', match[1] === ' ' ? 'false' : 'true');
    inline.content = inline.content.slice(match[0].length);

    const first = inline.children?.[0];
    if (first && first.type === 'text') {
      const childMatch = TASK_MARKER.exec(first.content);
      if (childMatch) first.content = first.content.slice(childMatch[0].length);
    }
  }
}

// ================================
// 中日韩文字的软换行
// ================================

const CJK_CHAR = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * CommonMark 把段落内的单个换行渲染为空格，这会在中文句子中插入多余空格。
 * 两侧都是中日韩文字时，软换行直接移除。
 */
function cjkSoftbreakRule(state: StateCore): void {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const children = block.children;
    for (let i = 1; i < children.length - 1; i++) {
      if (children[i].type !== 'softbreak') continue;
      const prev = children[i - 1];
      const next = children[i + 1];
      if (
        prev.type === 'text' &&
        next.type === 'text' &&
        CJK_CHAR.test(prev.content.slice(-1)) &&
        CJK_CHAR.test(next.content.charAt(0))
      ) {
        children[i].type = 'text';
        children[i].content = '';
      }
    }
  }
}

// ================================
// 插件入口
// ================================

/**
 * 注册全部扩展语法
 */
export function markdownExtensions(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  md.block.ruler.before('fence', 'math_block', mathBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.inline.ruler.before('link', 'wiki_link', wikiLinkRule);
  md.core.ruler.after('inline', 'task_list', taskListRule);
  md.core.ruler.after('task_list', 'cjk_softbreak', cjkSoftbreakRule);
}
