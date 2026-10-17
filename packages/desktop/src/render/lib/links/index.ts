// ================================
// 双向链接模块入口
// ================================

import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeItem } from '../../types/knowledge';
import { LinkIndex, type LinkParseCache, type RelatedLink } from './link-index';
import { linkRepository } from './repository';

export {
  LinkIndex,
  normalizeLinkTarget,
  displayTitle,
  type Backlink,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type RelatedLink,
} from './link-index';
export { linkRepository } from './repository';
export {
  createLinkResolver,
  LinkResolverContext,
  useLinkResolver,
  useEmbedResolver,
  type LinkResolver,
} from './embed';
export { planLinkRename, isLinkableTitle } from './rename';

/** 全局共享的解析缓存：未修改的笔记不会被重复解析 */
const sharedCache: LinkParseCache = new Map();

/**
 * 基于条目列表的链接索引（条目列表变化时生成新实例）
 */
export function useLinkIndex(items: KnowledgeItem[]): LinkIndex {
  return useMemo(() => {
    const index = new LinkIndex(sharedCache);
    index.update(items);
    return index;
  }, [items]);
}

/**
 * Agent 发现的语义关联（refreshKey 变化时重新读取）
 */
export function useRelatedLinks(refreshKey: unknown): RelatedLink[] {
  const [related, setRelated] = useState<RelatedLink[]>([]);
  useEffect(() => {
    let cancelled = false;
    linkRepository
      .listRelated()
      .then((links) => {
        if (!cancelled) setRelated(links);
      })
      .catch((error) => console.error('[Links] 读取语义关联失败:', error));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return related;
}
