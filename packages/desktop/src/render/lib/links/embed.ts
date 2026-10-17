// ================================
// 链接解析上下文
// 把知识库条目转换为嵌入内容（![[笔记]] / ![[图片]]）与标题列表（[[笔记# 补全），
// 供编辑器、预览、阅读视图与详情面板共用
// ================================

import { createContext, useContext } from 'react';
import type { KnowledgeItem } from '../../types/knowledge';
import { extractHeadings, type EmbedResolver, type EmbedSource, type MarkdownHeading } from '../markdown';
import { resolveArticle, resolveAttachmentKind } from '../reading/article';
import type { LinkIndex } from './link-index';

export interface LinkResolver {
  /** 按链接目标查找嵌入内容 */
  resolveEmbed(target: string): EmbedSource | null;
  /** 链接目标文档中的标题（目标不存在或不是 Markdown 时为空） */
  headings(target: string): MarkdownHeading[];
}

interface HeadingCacheEntry {
  updatedAt: number;
  headings: MarkdownHeading[];
}

/** 标题缓存：条目 ID → 标题（按 updatedAt 失效，跨索引实例共享） */
const headingCache = new Map<string, HeadingCacheEntry>();

/** 条目 → 嵌入内容：图片附件按文件嵌入，其余条目嵌入正文 */
function embedSourceOf(item: KnowledgeItem): EmbedSource {
  if (item.filePath && resolveAttachmentKind(item) === 'image') {
    return { kind: 'image', title: item.title, filePath: item.filePath, mimeType: item.mimeType };
  }
  const article = resolveArticle(item);
  return {
    kind: 'note',
    title: item.title,
    content: article?.content ?? '',
    format: article?.format ?? 'markdown',
  };
}

function headingsOf(item: KnowledgeItem): MarkdownHeading[] {
  const article = resolveArticle(item);
  if (!article || article.format !== 'markdown') return [];
  const updatedAt = item.updatedAt.getTime();
  const cached = headingCache.get(item.id);
  if (cached && cached.updatedAt === updatedAt) return cached.headings;
  const headings = extractHeadings(article.content);
  headingCache.set(item.id, { updatedAt, headings });
  return headings;
}

/**
 * 基于链接索引创建解析器
 */
export function createLinkResolver(index: LinkIndex): LinkResolver {
  return {
    resolveEmbed(target) {
      const item = index.resolve(target);
      return item ? embedSourceOf(item) : null;
    },
    headings(target) {
      const item = index.resolve(target);
      return item ? headingsOf(item) : [];
    },
  };
}

/** 应用级链接解析上下文（未提供时嵌入显示为“未找到”） */
export const LinkResolverContext = createContext<LinkResolver | null>(null);

/**
 * 渲染正文使用的嵌入解析：只有包含 ![[嵌入]] 的内容才需要，
 * 其余内容返回 undefined，条目列表变化时不必重新渲染
 */
export function useEmbedResolver(content: string | null | undefined): EmbedResolver | undefined {
  const resolver = useContext(LinkResolverContext);
  return content?.includes('![[') ? resolver?.resolveEmbed : undefined;
}

export function useLinkResolver(): LinkResolver | null {
  return useContext(LinkResolverContext);
}
