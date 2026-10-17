// ================================
// 图谱数据处理：局部图谱裁剪、搜索匹配
// ================================

import type { GraphData } from '../../lib/links';

/**
 * 局部图谱：只保留与 focusId 相距不超过 depth 跳的节点及它们之间的边
 * @returns focusId 不在图中时返回 null
 */
export function localGraph(data: GraphData, focusId: string, depth: number): GraphData | null {
  if (!data.nodes.some((node) => node.id === focusId)) return null;

  const adjacency = new Map<string, string[]>();
  const connect = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const edge of data.edges) {
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }

  const kept = new Set([focusId]);
  let frontier = [focusId];
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (kept.has(neighbor)) continue;
        kept.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  return {
    nodes: data.nodes.filter((node) => kept.has(node.id)),
    edges: data.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
  };
}

/** 搜索词规范化（空串表示不搜索） */
export function normalizeQuery(query: string | undefined): string {
  return (query ?? '').trim().toLowerCase();
}

/** 标题是否匹配已规范化的搜索词 */
export function matchesQuery(title: string, normalizedQuery: string): boolean {
  return normalizedQuery !== '' && title.toLowerCase().includes(normalizedQuery);
}
