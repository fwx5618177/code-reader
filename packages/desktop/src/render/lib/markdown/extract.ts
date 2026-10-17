// ================================
// 从 Markdown 中提取结构化信息
// 基于同一个分词器，代码块与行内代码中的 [[…]] 不会被误识别
// ================================

import type Token from 'markdown-it/lib/token.mjs';
import { markdownTokenizer } from './parser';

/** 文档中的一个双向链接 */
export interface WikiLinkReference {
  /** 链接目标（文档标题） */
  target: string;
  /** 显示别名 */
  alias: string | null;
  /** 链接所在段落的纯文本（用于反向链接上下文） */
  context: string;
}

/** 将行内 token 还原为可读文本 */
function inlineText(tokens: Token[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code_inline') text += token.content;
    else if (token.type === 'wiki_link') text += token.meta.alias || token.meta.target;
    else if (token.type === 'math_inline') text += `$${token.content}$`;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') text += ' ';
  }
  return text.trim();
}

/**
 * 提取所有 [[双向链接]]
 */
export function extractWikiLinks(markdown: string): WikiLinkReference[] {
  const references: WikiLinkReference[] = [];
  for (const token of markdownTokenizer.parse(markdown, {})) {
    if (token.type !== 'inline' || !token.children) continue;
    const links = token.children.filter((child) => child.type === 'wiki_link');
    if (links.length === 0) continue;
    const context = inlineText(token.children);
    for (const link of links) {
      references.push({ target: link.meta.target, alias: link.meta.alias, context });
    }
  }
  return references;
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
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`|]/g, '');
}
