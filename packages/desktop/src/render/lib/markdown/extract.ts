// ================================
// 从 Markdown 中提取结构化信息
// 基于同一个分词器，代码块与行内代码中的 [[…]] 不会被误识别
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import type Token from 'markdown-it/lib/token.mjs';
import { blockRefId, findBlockInDoc, stripBlockMarker } from './block-ref';
import { markdownTokenizer } from './parser';
import { serializeMarkdown } from './serializer';
import { findHeadingIndex, wikiLinkRef } from './wiki-link';

/** 文档中的一个双向链接（含 ![[嵌入]]） */
export interface WikiLinkReference {
  /** 链接目标（文档标题；空字符串表示当前文档） */
  target: string;
  /** 目标文档内的标题 */
  heading: string | null;
  /** 显示别名 */
  alias: string | null;
  /** 链接所在段落的纯文本（用于反向链接上下文） */
  context: string;
}

/** Markdown 中的一个标题 */
export interface MarkdownHeading {
  level: number;
  text: string;
  /** 所在源码行（从 0 开始） */
  line: number;
}

/** 将行内 token 还原为可读文本 */
function inlineText(tokens: Token[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code_inline') text += token.content;
    else if (token.type === 'wiki_link') text += token.meta.alias || wikiLinkRef(token.meta.target, token.meta.heading);
    else if (token.type === 'math_inline') text += `$${token.content}$`;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') text += ' ';
  }
  return text.trim();
}

/**
 * 提取所有 [[双向链接]] 与 ![[嵌入]]
 */
export function extractWikiLinks(markdown: string): WikiLinkReference[] {
  const references: WikiLinkReference[] = [];
  for (const token of markdownTokenizer.parse(markdown, {})) {
    if (token.type === 'wiki_embed') {
      const { target, heading, alias } = token.meta;
      references.push({ target, heading, alias, context: `![[${token.content}]]` });
      continue;
    }
    if (token.type !== 'inline' || !token.children) continue;
    const links = token.children.filter((child) => child.type === 'wiki_link');
    if (links.length === 0) continue;
    const context = stripBlockMarker(inlineText(token.children));
    for (const link of links) {
      const { target, heading, alias } = link.meta;
      references.push({ target, heading, alias, context });
    }
  }
  return references;
}

/**
 * 提取全部标题（含引用块、列表中的标题），按文档顺序
 * 标题末尾的块 ID 标记不属于标题文本
 */
export function extractHeadings(markdown: string): MarkdownHeading[] {
  const tokens = markdownTokenizer.parse(markdown, {});
  const headings: MarkdownHeading[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return;
    headings.push({
      level: Number(token.tag.slice(1)),
      text: stripBlockMarker(inlineText(tokens[index + 1]?.children ?? [])),
      line: token.map?.[0] ?? 0,
    });
  });
  return headings;
}

/**
 * 截取标题所在章节的源码：从该标题到下一个同级或更高级标题之前
 * 找不到标题时返回 null
 */
export function extractSection(markdown: string, heading: string): string | null {
  const headings = extractHeadings(markdown);
  const index = findHeadingIndex(headings, heading);
  if (index === -1) return null;
  const { level, line } = headings[index];
  const next = headings.slice(index + 1).find((h) => h.level <= level);
  // 与 markdown-it 的行切分规则一致
  const lines = markdown.split(/\r\n?|\n/);
  return lines.slice(line, next ? next.line : lines.length).join('\n');
}

/**
 * 文档节点中链接标题的位置（用于滚动定位）；找不到时返回 null
 * 标题文本与 extractHeadings 的规则一致，保证编辑器、阅读视图与补全的匹配结果相同
 * occurrence 指定同名标题中的第几个（从 0 计）
 */
export function findHeadingInDoc(doc: PMNode, heading: string, occurrence = 0): number | null {
  const index = findHeadingIndex(extractHeadings(serializeMarkdown(doc)), heading, occurrence);
  if (index === -1) return null;
  let count = 0;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== 'heading') return true;
    if (count++ === index) found = pos;
    return false;
  });
  return found;
}

/**
 * 链接 #… 部分在文档节点中的位置：#^id 为块，其余为标题（occurrence 为同名标题序号）；找不到时返回 null
 */
export function findLinkTargetInDoc(doc: PMNode, subpath: string, occurrence = 0): number | null {
  const id = blockRefId(subpath);
  if (id) return findBlockInDoc(doc, id)?.pos ?? null;
  return findHeadingInDoc(doc, subpath, occurrence);
}

/** 源码中的位置：行号（从 1 计）与解析后文档的顶层块序号（从 0 计） */
export interface SourceLocation {
  line: number;
  block: number;
}

/**
 * 编辑器定位请求：有 location 时定位源码位置（全局精确查找），否则定位标题或块
 * （heading 为 ^id 时是块；occurrence 为同名标题中的第几个，从 0 计）。每个请求对象只执行一次
 */
export interface RevealRequest {
  heading: string;
  occurrence?: number;
  location?: SourceLocation;
}

/**
 * 源码第 line 行（从 0 计）所在的顶层块序号（从 0 计），即解析后文档的第几个顶层节点。
 * 依据 markdown-it 顶层块 token 的行范围（map）；落在块之间的空行时取下一个块，超出末尾时取最后一个块。
 * 没有任何块时返回 null
 */
export function topLevelBlockAtLine(markdown: string, line: number): number | null {
  let index = -1;
  for (const token of markdownTokenizer.parse(markdown, {})) {
    // 顶层的开标签或自闭合块（围栏代码、分隔线、公式块等）各对应一个顶层节点
    if (token.level !== 0 || token.nesting === -1 || !token.map) continue;
    index++;
    if (line < token.map[1]) return index;
  }
  return index >= 0 ? index : null;
}

/**
 * 提取可读纯文本（完整解析 Markdown，结果准确；用于搜索索引等非逐键场景）
 */
export function markdownToPlainText(markdown: string): string {
  const lines: string[] = [];
  for (const token of markdownTokenizer.parse(markdown, {})) {
    if (token.type === 'inline' && token.children) {
      lines.push(inlineText(token.children));
    } else if (token.type === 'fence' || token.type === 'code_block' || token.type === 'math_block') {
      lines.push(token.content.trim());
    }
  }
  return lines.filter(Boolean).join('\n');
}

/**
 * 快速去除标记：旧版 HTML 标签与 Markdown 语法符号
 * 线性时间、不做完整解析，适合每次输入都要运行的字数统计；极少数边界写法可能残留符号
 */
export function stripMarkup(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/^\s{0,3}(#{1,6}\s|>\s?|[-*+]\s(\[[ xX]\]\s)?|\d+[.)]\s|```.*$|\$\$\s*$)/gm, '')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`|]/g, '');
}
