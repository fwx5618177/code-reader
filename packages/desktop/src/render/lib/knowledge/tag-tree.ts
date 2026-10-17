// ================================
// 标签树与筛选范围：按“父/子”命名把扁平的标签表组织成树，
// 并给出按父标签筛选时包含的全部子孙标签
// ================================

import type { Tag } from '../../types/knowledge';
import { ancestorTagPaths, isTagPathWithin, tagLeafName } from '../../../shared/tag-path';

export interface TagTreeNode {
  /** 完整路径（即标签名） */
  path: string;
  /** 末级名称 */
  label: string;
  /** 对应的标签；父标签不存在时（旧数据）为 null，只作为分组显示 */
  tag: Tag | null;
  children: TagTreeNode[];
  /** 自身及全部子孙标签的使用次数之和 */
  totalUsage: number;
}

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 构建标签树：同级按名称排序 */
export function buildTagTree(tags: readonly Tag[]): TagTreeNode[] {
  const nodes = new Map<string, TagTreeNode>();
  const nodeOf = (path: string): TagTreeNode => {
    let node = nodes.get(path);
    if (!node) {
      node = { path, label: tagLeafName(path), tag: null, children: [], totalUsage: 0 };
      nodes.set(path, node);
    }
    return node;
  };
  for (const tag of tags) {
    nodeOf(tag.name).tag = tag;
    for (const ancestor of ancestorTagPaths(tag.name)) nodeOf(ancestor);
  }

  const roots: TagTreeNode[] = [];
  for (const node of nodes.values()) {
    const [parent] = ancestorTagPaths(node.path);
    if (parent) nodes.get(parent)!.children.push(node);
    else roots.push(node);
  }
  const finish = (list: TagTreeNode[]): number => {
    list.sort((a, b) => nameCollator.compare(a.label, b.label));
    let sum = 0;
    for (const node of list) {
      node.totalUsage = (node.tag?.usageCount ?? 0) + finish(node.children);
      sum += node.totalUsage;
    }
    return sum;
  };
  finish(roots);
  return roots;
}

/** 打平后的树行 */
export interface TagTreeRow {
  node: TagTreeNode;
  depth: number;
}

/** 深度优先打平为显示行；折叠的节点不展开其子孙 */
export function flattenTagTree(nodes: readonly TagTreeNode[], collapsed: ReadonlySet<string> = new Set()): TagTreeRow[] {
  const rows: TagTreeRow[] = [];
  const visit = (list: readonly TagTreeNode[], depth: number) => {
    for (const node of list) {
      rows.push({ node, depth });
      if (!collapsed.has(node.path)) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return rows;
}

/** 选中某个标签时实际匹配的标签 ID：自身及全部子孙 */
export function tagScopeIds(tagId: string, tags: readonly Tag[]): Set<string> {
  const tag = tags.find((candidate) => candidate.id === tagId);
  if (!tag) return new Set([tagId]);
  return new Set(tags.filter((candidate) => isTagPathWithin(candidate.name, tag.name)).map((candidate) => candidate.id));
}

/** 标签 ID → 自身及存在的祖先标签 ID（统计“追加该标签后的结果数”时子标签计入父标签） */
export function tagLineageIds(tags: readonly Tag[]): Map<string, string[]> {
  const idByName = new Map(tags.map((tag) => [tag.name, tag.id]));
  return new Map(
    tags.map((tag) => [
      tag.id,
      [tag.id, ...ancestorTagPaths(tag.name).flatMap((path) => idByName.get(path) ?? [])],
    ])
  );
}
