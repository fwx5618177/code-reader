// ================================
// 重命名后更新双向链接
// 把 [[旧名]]、[[旧名|别名]]、[[旧名#标题]]、![[旧名]] 改写为新名，保留别名、标题与嵌入标记。
//
// 直接在源码上按位置替换，不经过 ProseMirror 重新序列化，其余内容逐字节保持不变。
// 链接位置来自与编辑器相同的分词器，代码块、行内代码与公式中的 [[…]] 不会被改动；
// 目标匹配规则与链接解析一致（忽略大小写与 .md 等扩展名）。
// ================================

import type { MarkdownItToken as Token } from '@code-reader/markdown-parser';
import { createTokenizer, type WikiLinkParts } from '../markdown';
import { displayTitle, normalizeLinkTarget, textExtension } from './link-index';

/** 单篇文档的改写结果 */
export interface LinkRewriteResult {
  content: string;
  /** 改写的链接数 */
  count: number;
}

/** 参与改写的文档 */
export interface LinkSource {
  id: string;
  content: string;
}

/** 重命名的改写计划 */
export interface LinkRenamePlan {
  /** 内容发生变化的文档 */
  changes: Array<{ id: string; content: string; count: number }>;
  /** 改写的链接总数 */
  count: number;
}

// 任务列表会截掉行内内容开头的 [ ]，改写时需要与源码一致的行内内容
const tokenizer = createTokenizer({ taskLists: false });

/** 标题能否作为链接目标（# | [ ] 与换行会破坏链接语法） */
export function isLinkableTitle(title: string): boolean {
  return !/[[\]|#\n]/.test(title) && displayTitle(title).trim() !== '';
}

/** 源码按行切分（与分词器的换行规则一致），记录每行起始偏移 */
export function splitLines(markdown: string): { lines: string[]; starts: number[] } {
  const lines: string[] = [];
  const starts: number[] = [];
  const pattern = /\r\n?|\n/g;
  let start = 0;
  for (let match = pattern.exec(markdown); match; match = pattern.exec(markdown)) {
    lines.push(markdown.slice(start, match.index));
    starts.push(start);
    start = match.index + match[0].length;
  }
  lines.push(markdown.slice(start));
  starts.push(start);
  return { lines, starts };
}

/** 一处待替换的源码范围 */
interface Edit {
  from: number;
  to: number;
  text: string;
}

/**
 * 改写单篇文档中指向 oldTitle 的链接
 */
export function rewriteLinksForRename(markdown: string, oldTitle: string, newTitle: string): LinkRewriteResult {
  const oldKey = normalizeLinkTarget(oldTitle);
  const newName = displayTitle(newTitle).trim();
  if (!oldKey || !newName || !markdown.includes('[[')) return { content: markdown, count: 0 };

  const { lines, starts } = splitLines(markdown);
  const edits: Edit[] = [];

  /** 源码 position 处是 [[inner]] 时，生成目标部分的替换 */
  const rewriteAt = (position: number, inner: string, parts: WikiLinkParts): void => {
    if (normalizeLinkTarget(parts.target) !== oldKey) return;
    if (!markdown.startsWith(`[[${inner}]]`, position)) return;
    const from = position + 2 + (inner.length - inner.trimStart().length);
    const to = from + parts.target.length;
    // 原链接带扩展名（[[旧名.md]]）时保留扩展名
    edits.push({ from, to, text: newName + textExtension(parts.target) });
  };

  // 表格单元格的行内 token 没有行号，沿用所在行（tr_open）的行号
  let lastMap: [number, number] | null = null;
  // 同一源码行对应多个单元格：每个单元格都按顺序定位，避免匹配到前面单元格的内容
  const lineCursor = new Map<number, number>();

  /**
   * 行内内容逐行对应源码行：第 k 行对应 startLine + k
   * 在源码行中定位该行内容（容器前缀如 > 、- 与缩进已被分词器去掉），再换算链接位置
   */
  const collectInlineEdits = (inline: Token, startLine: number, inTable: boolean): void => {
    const contentLines = inline.content.split('\n');
    const located = new Map<number, number | null>();
    const locate = (k: number): number | null => {
      const cached = located.get(k);
      if (cached !== undefined) return cached;
      const sourceLine = startLine + k;
      const text = contentLines[k].trimStart();
      const source = lines[sourceLine] ?? '';
      let column: number;
      if (inTable) {
        // 单元格内容中的 | 在源码中写作 \|
        const needle = text.replace(/\|/g, '\\|');
        column = source.indexOf(needle, lineCursor.get(sourceLine) ?? 0);
        if (column !== -1) lineCursor.set(sourceLine, column + needle.length);
      } else {
        // 容器前缀在行首、内容在行尾，取最后一次出现
        column = source.lastIndexOf(text);
      }
      const start = column === -1 ? null : starts[sourceLine] + column;
      located.set(k, start);
      return start;
    };
    if (inTable) locate(0);

    let lineStart = 0;
    let k = 0;
    for (const link of inline.children ?? []) {
      if (link.type !== 'wiki_link') continue;
      const offset = link.meta.offset as number;
      while (k < contentLines.length - 1 && offset >= lineStart + contentLines[k].length + 1) {
        lineStart += contentLines[k].length + 1;
        k++;
      }
      const start = locate(k);
      if (start === null) continue;
      const lineText = contentLines[k];
      const lead = lineText.length - lineText.trimStart().length;
      const before = lineText.slice(lead, offset - lineStart);
      const escapes = inTable ? (before.match(/\|/g)?.length ?? 0) : 0;
      const inner = inTable ? link.content.replace(/\|/g, '\\|') : link.content;
      rewriteAt(start + before.length + escapes, inner, link.meta as WikiLinkParts);
    }
  };

  for (const token of tokenizer.parse(markdown, {})) {
    if (token.map) lastMap = token.map;

    if (token.type === 'wiki_embed' && token.map) {
      const line = token.map[0];
      const column = lines[line].indexOf(`![[${token.content}]]`);
      if (column !== -1) rewriteAt(starts[line] + column + 1, token.content, token.meta as WikiLinkParts);
    } else if (token.type === 'inline' && lastMap) {
      collectInlineEdits(token, lastMap[0], token.map === null);
    }
  }

  if (edits.length === 0) return { content: markdown, count: 0 };
  let content = markdown;
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    content = content.slice(0, edit.from) + edit.text + content.slice(edit.to);
  }
  return { content, count: edits.length };
}

/**
 * 计算重命名需要改写的全部文档
 * 新旧标题指向同一链接目标时无需改写；新标题能否作为链接目标由调用方用 isLinkableTitle 判断
 */
export function planLinkRename(sources: LinkSource[], oldTitle: string, newTitle: string): LinkRenamePlan {
  const plan: LinkRenamePlan = { changes: [], count: 0 };
  if (normalizeLinkTarget(oldTitle) === normalizeLinkTarget(newTitle)) return plan;
  for (const source of sources) {
    const result = rewriteLinksForRename(source.content, oldTitle, newTitle);
    if (result.count === 0) continue;
    plan.changes.push({ id: source.id, content: result.content, count: result.count });
    plan.count += result.count;
  }
  return plan;
}
