// ================================
// 双向链接索引
// 从笔记的 Markdown 中提取 [[链接]]，解析为条目之间的引用关系：
// - 出链 / 反向链接（含上下文；[[笔记#标题]] 与 ![[嵌入]] 同样计入目标笔记）
// - 未解析链接（目标文档尚不存在）
// - 知识图谱数据（双向链接 + Agent 发现的语义关联）
// - 文档属性（YAML 头部）的 aliases：[[别名]] 解析到该笔记（标题优先）
//
// 每个条目的解析结果按 (id, updatedAt) 缓存，只有修改过的笔记会被重新解析。
// ================================

import type { KnowledgeItem } from '../../types/knowledge';
import { extractWikiLinks, type WikiLinkReference } from '../markdown/extract';
import { documentProperties } from '../markdown/front-matter';
import { blockRefId } from '../markdown/block-ref';

/** 一条反向链接 */
export interface Backlink {
  sourceId: string;
  sourceTitle: string;
  /** 链接所在段落文本 */
  context: string;
  /** 块引用 [[笔记#^id]] 指向的块 ID；引用整篇或标题时为 null */
  blockId: string | null;
}

/** 图谱节点 */
export interface GraphNode {
  id: string;
  title: string;
  type: KnowledgeItem['type'] | 'unresolved' | 'entity';
  /** 连接数（决定节点大小） */
  degree: number;
}

/** 图谱边 */
export interface GraphEdge {
  source: string;
  target: string;
  kind: 'link' | 'related';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Agent 发现的语义关联（links 表中 type='ai-suggested'） */
export interface RelatedLink {
  sourceId: string;
  targetId: string;
}

/** 文本文档扩展名（链接目标中可省略） */
const TEXT_EXTENSION = /\.(md|markdown|mdown|mkd|txt|text|tex|latex|ltx)$/i;

/**
 * 链接目标规范化：去掉 .md 等扩展名、首尾空白，大小写不敏感
 */
export function normalizeLinkTarget(title: string): string {
  return title.trim().replace(TEXT_EXTENSION, '').toLowerCase();
}

/** 条目显示标题（去掉文件扩展名） */
export function displayTitle(title: string): string {
  return title.replace(TEXT_EXTENSION, '');
}

/** 标题中的文本文档扩展名（含点；没有时为空字符串） */
export function textExtension(title: string): string {
  return TEXT_EXTENSION.exec(title.trim())?.[0] ?? '';
}

/** 只有 Markdown 笔记才包含双向链接 */
function hasMarkdownLinks(item: KnowledgeItem): boolean {
  return item.type === 'note' && !!item.content && item.content.includes('[[');
}

/** 文档属性（YAML 头部）中的别名：[[别名]] 同样指向该笔记 */
function noteAliases(item: KnowledgeItem): string[] {
  return item.type === 'note' && item.content?.startsWith('---') ? documentProperties(item.content).aliases : [];
}

interface CacheEntry {
  updatedAt: number;
  links: WikiLinkReference[];
  aliases: string[];
}

/** 解析缓存：条目 ID → 链接（可在多个索引实例间共享） */
export type LinkParseCache = Map<string, CacheEntry>;

export class LinkIndex {
  private items: KnowledgeItem[] = [];
  private byId = new Map<string, KnowledgeItem>();
  private byTitle = new Map<string, KnowledgeItem>();
  private outgoing = new Map<string, WikiLinkReference[]>();
  /** 条目 ID → 规范化后的别名 */
  private aliasKeys = new Map<string, string[]>();
  /** 条目 ID → 别名原文（[[ 补全显示用） */
  private aliasNames = new Map<string, string[]>();

  constructor(private readonly cache: LinkParseCache = new Map()) {}

  /**
   * 用最新的条目列表更新索引（增量解析）。标题优先于别名：别名与其他条目的标题相同时链接指向那个条目
   */
  update(items: KnowledgeItem[]): void {
    this.items = items;
    this.byId = new Map(items.map((item) => [item.id, item]));
    this.byTitle = new Map();
    for (const item of items) {
      const key = normalizeLinkTarget(item.title);
      // 同名时保留最近更新的条目
      const existing = this.byTitle.get(key);
      if (!existing || existing.updatedAt < item.updatedAt) this.byTitle.set(key, item);
    }

    const alive = new Set<string>();
    this.outgoing = new Map();
    this.aliasKeys = new Map();
    this.aliasNames = new Map();
    const byAlias = new Map<string, KnowledgeItem>();
    for (const item of items) {
      alive.add(item.id);
      if (item.type !== 'note' || !item.content) continue;
      const updatedAt = item.updatedAt.getTime();
      let entry = this.cache.get(item.id);
      if (!entry || entry.updatedAt !== updatedAt) {
        // [[#标题]] 指向文档自身，不是条目之间的引用
        const links = hasMarkdownLinks(item) ? extractWikiLinks(item.content).filter((link) => link.target) : [];
        entry = { updatedAt, links, aliases: noteAliases(item) };
        this.cache.set(item.id, entry);
      }
      if (entry.links.length > 0) this.outgoing.set(item.id, entry.links);
      if (entry.aliases.length === 0) continue;
      this.aliasNames.set(item.id, entry.aliases);
      const keys = entry.aliases.map(normalizeLinkTarget).filter(Boolean);
      this.aliasKeys.set(item.id, keys);
      for (const key of keys) {
        const existing = byAlias.get(key);
        if (!existing || existing.updatedAt < item.updatedAt) byAlias.set(key, item);
      }
    }
    for (const [key, item] of byAlias) {
      if (!this.byTitle.has(key)) this.byTitle.set(key, item);
    }
    for (const id of this.cache.keys()) {
      if (!alive.has(id)) this.cache.delete(id);
    }
  }

  /** 按标题或别名解析链接目标（空目标即当前文档，不解析） */
  resolve(target: string): KnowledgeItem | undefined {
    const key = normalizeLinkTarget(target);
    return key ? this.byTitle.get(key) : undefined;
  }

  /** 条目的文档属性别名（规范化后） */
  aliasesOf(itemId: string): readonly string[] {
    return this.aliasKeys.get(itemId) ?? [];
  }

  /** 条目的文档属性别名（原文） */
  aliasNamesOf(itemId: string): readonly string[] {
    return this.aliasNames.get(itemId) ?? [];
  }

  /** 条目的出链 */
  outgoingLinks(itemId: string): WikiLinkReference[] {
    return this.outgoing.get(itemId) ?? [];
  }

  /** 指向条目的反向链接（同一来源的多处引用分别列出；用别名链接的同样计入） */
  backlinks(itemId: string): Backlink[] {
    const target = this.byId.get(itemId);
    if (!target) return [];
    const keys = new Set([normalizeLinkTarget(target.title), ...this.aliasesOf(itemId)]);
    const result: Backlink[] = [];
    for (const [sourceId, links] of this.outgoing) {
      if (sourceId === itemId) continue;
      const source = this.byId.get(sourceId);
      if (!source) continue;
      for (const link of links) {
        if (keys.has(normalizeLinkTarget(link.target))) {
          result.push({
            sourceId,
            sourceTitle: displayTitle(source.title),
            context: link.context,
            blockId: blockRefId(link.heading),
          });
        }
      }
    }
    return result;
  }

  /** 尚未创建目标文档的链接：目标标题 → 引用它的条目 ID */
  unresolvedLinks(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [sourceId, links] of this.outgoing) {
      for (const link of links) {
        if (this.resolve(link.target)) continue;
        const title = link.target.trim();
        const sources = result.get(title) ?? [];
        if (!sources.includes(sourceId)) sources.push(sourceId);
        result.set(title, sources);
      }
    }
    return result;
  }

  /** 解析后的引用关系（去重）：用于写回 links 表 */
  resolvedTargets(itemId: string): string[] {
    const ids = new Set<string>();
    for (const link of this.outgoingLinks(itemId)) {
      const target = this.resolve(link.target);
      if (target && target.id !== itemId) ids.add(target.id);
    }
    return [...ids];
  }

  /**
   * 生成图谱数据
   * @param related Agent 发现的语义关联
   * @param options.includeOrphans 是否包含没有任何连接的条目
   * @param options.includeUnresolved 是否包含未创建的链接目标
   */
  graph(
    related: RelatedLink[],
    options: { includeOrphans: boolean; includeUnresolved: boolean }
  ): GraphData {
    const edges: GraphEdge[] = [];
    const edgeKeys = new Set<string>();
    const addEdge = (source: string, target: string, kind: GraphEdge['kind']) => {
      if (source === target) return;
      const key = source < target ? `${source}|${target}` : `${target}|${source}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ source, target, kind });
    };

    const unresolvedIds = new Map<string, string>();
    for (const [sourceId, links] of this.outgoing) {
      for (const link of links) {
        const target = this.resolve(link.target);
        if (target) {
          addEdge(sourceId, target.id, 'link');
        } else if (options.includeUnresolved) {
          const key = normalizeLinkTarget(link.target);
          if (!unresolvedIds.has(key)) unresolvedIds.set(key, link.target.trim());
          addEdge(sourceId, `unresolved:${key}`, 'link');
        }
      }
    }

    for (const link of related) {
      if (this.byId.has(link.sourceId) && this.byId.has(link.targetId)) {
        addEdge(link.sourceId, link.targetId, 'related');
      }
    }

    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }

    const nodes: GraphNode[] = [];
    for (const item of this.items) {
      const d = degree.get(item.id) ?? 0;
      if (d === 0 && !options.includeOrphans) continue;
      nodes.push({ id: item.id, title: displayTitle(item.title), type: item.type, degree: d });
    }
    for (const [key, title] of unresolvedIds) {
      const id = `unresolved:${key}`;
      nodes.push({ id, title, type: 'unresolved', degree: degree.get(id) ?? 0 });
    }

    return { nodes, edges };
  }
}
