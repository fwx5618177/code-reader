// ================================
// Markdown 扩展语法（@code-reader/markdown-parser 的语法扩展）
// - 数学公式：行内 $…$、块级 $$…$$
// - 双向链接：[[目标]] / [[目标#标题|别名]]；独占一行的 ![[目标#标题]] 为块级嵌入
// - 中日韩文字之间的软换行不产生空格
// 任务列表 - [ ] / - [x] 由解析器的 taskLists 选项识别（list_item_open 的 meta.checked）；
// 文档开头的 YAML 头部由 frontMatter 选项识别（front_matter token 的 meta 为 YAML 文本）
// ================================

import type { BlockExtension, InlineExtension, MarkdownItToken } from '@code-reader/markdown-parser';
import { parseWikiLinkInner } from './wiki-link';

const DOLLAR = 0x24; // $
const BACKSLASH = 0x5c; // \

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
const mathInline: InlineExtension = {
  name: 'math_inline',
  trigger: '$',
  match(src, pos) {
    const posMax = src.length;
    const isDouble = src.charCodeAt(pos + 1) === DOLLAR;
    const delimiter = isDouble ? '$$' : '$';
    const contentStart = pos + delimiter.length;
    if (contentStart >= posMax || /\s/.test(src[contentStart])) return null;

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
    if (end >= posMax) return null;
    return { length: end + delimiter.length - pos, content: src.slice(contentStart, end), data: { delimiter } };
  },
};

/**
 * 块级公式
 * $$
 * latex
 * $$
 * 也支持单行 $$ latex $$；可以打断段落。块内容在 finalizeTokens 中去掉首尾空白
 */
const mathBlock: BlockExtension = {
  name: 'math_block',
  trigger: '$$',
  interruptsParagraph: true,
  open(line) {
    const first = line.slice(2);
    const trimmed = first.trim();
    if (trimmed.endsWith('$$') && trimmed.length > 2) return { content: trimmed.slice(0, -2), closed: true };
    return { content: trimmed ? first : undefined, closed: false };
  },
  next(line) {
    const trimmed = line.trimEnd();
    if (trimmed.endsWith('$$')) {
      const before = trimmed.slice(0, -2);
      return { content: before.trim() ? before : undefined, closed: true };
    }
    return { content: line, closed: false };
  },
};

// ================================
// 双向链接
// ================================

/**
 * [[目标]] / [[目标#标题]] / [[目标|别名]]，内部不允许出现换行与方括号
 * data.offset 记录 [[ 在行内内容中的位置（重命名时据此定位源码）
 */
const wikiLink: InlineExtension = {
  name: 'wiki_link',
  trigger: '[',
  match(src, pos) {
    if (src[pos + 1] !== '[') return null;
    const close = src.indexOf(']]', pos + 2);
    if (close === -1) return null;
    const inner = src.slice(pos + 2, close);
    const parts = parseWikiLinkInner(inner);
    if (!parts) return null;
    return { length: close + 2 - pos, content: inner, data: { ...parts, offset: pos } };
  },
};

const EMBED_LINE = /^!\[\[([^[\]\n]+)\]\]\s*$/;

/**
 * 独占一行的 ![[目标#标题]]：块级嵌入
 * 不打断段落（段落中间的 ![[…]] 仍是普通文本 + 链接）；列表项必须以段落开头，此时也交给段落
 */
const wikiEmbed: BlockExtension = {
  name: 'wiki_embed',
  trigger: '![[',
  open(line, { firstInListItem }) {
    if (firstInListItem) return null;
    const match = EMBED_LINE.exec(line);
    const parts = match && parseWikiLinkInner(match[1]);
    return parts ? { content: match[1], closed: true, data: { ...parts } } : null;
  },
};

export const markdownInlineExtensions: readonly InlineExtension[] = [mathInline, wikiLink];
export const markdownBlockExtensions: readonly BlockExtension[] = [mathBlock, wikiEmbed];

// ================================
// token 后处理
// ================================

const CJK_CHAR = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * CommonMark 把段落内的单个换行渲染为空格，这会在中文句子中插入多余空格。
 * 两侧都是中日韩文字时，软换行直接移除，前后两段文本合并为一个文本 token
 */
function removeCjkSoftbreaks(children: MarkdownItToken[]): void {
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
      prev.content += next.content;
      children.splice(i, 2);
      i--;
    }
  }
}

/**
 * 解析后的统一处理：块级公式去掉首尾空白，中日韩文字之间的软换行不产生空格；
 * YAML 头部的文本放入 content（prosemirror-markdown 从 content 创建文本节点）
 */
export function finalizeTokens(tokens: MarkdownItToken[]): MarkdownItToken[] {
  for (const token of tokens) {
    if (token.type === 'math_block') token.content = token.content.trim();
    else if (token.type === 'front_matter') token.content = token.meta as string;
    else if (token.type === 'inline' && token.children) removeCjkSoftbreaks(token.children);
  }
  return tokens;
}
