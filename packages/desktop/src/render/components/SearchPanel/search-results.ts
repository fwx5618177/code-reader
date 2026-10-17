// ================================
// 全局搜索结果合并：写作文档（内存索引）+ 知识库（混合检索）
// 写作文档即类型为 note 的知识条目，两路结果按 id 去重后分为两组
// ================================

import type { KnowledgeItemType } from '../../types/knowledge';
import type { HybridSearchResult } from '../../types/electron';
import type { DocumentSearchResult } from '../../lib/writing';
import { DOCUMENT_TYPE, isWritingDocument } from '../../lib/documents/constants';
import { displayTitle } from '../../lib/links/link-index';
import { ITEM_TYPE_LABELS } from '../ReadingWorkspace/item-type';

export type SearchGroupKey = 'documents' | 'knowledge';

export interface SearchHit {
  id: string;
  title: string;
  type: KnowledgeItemType;
  /** 匹配摘要，命中词以 <mark> 包裹 */
  snippet: string;
  group: SearchGroupKey;
}

export interface SearchGroups {
  documents: SearchHit[];
  knowledge: SearchHit[];
}

/** 结果分组的展示顺序与标题 */
export const SEARCH_GROUPS: ReadonlyArray<{ key: SearchGroupKey; label: string }> = [
  { key: 'documents', label: '写作文档' },
  { key: 'knowledge', label: '知识条目' },
];

export interface SnippetSegment {
  text: string;
  highlight: boolean;
}

/** 数据库中的类型字段为自由文本，未知类型按普通文件展示 */
function toItemType(type: string): KnowledgeItemType {
  return type in ITEM_TYPE_LABELS ? (type as KnowledgeItemType) : 'file';
}

/**
 * 合并两路搜索结果
 * 写作索引在进入写作模式后才建立，因此混合检索中的笔记也计入写作文档组（已出现的不重复）
 */
export function mergeSearchResults(
  writing: readonly DocumentSearchResult[],
  hybrid: readonly HybridSearchResult[]
): SearchGroups {
  const documents: SearchHit[] = writing.map((result) => ({
    id: result.id,
    title: displayTitle(result.title) || '无标题',
    type: DOCUMENT_TYPE,
    snippet: result.snippet,
    group: 'documents',
  }));
  const seen = new Set(documents.map((hit) => hit.id));
  const knowledge: SearchHit[] = [];

  for (const result of hybrid) {
    if (seen.has(result.itemId)) continue;
    seen.add(result.itemId);
    const type = toItemType(result.type);
    const group: SearchGroupKey = isWritingDocument({ type }) ? 'documents' : 'knowledge';
    (group === 'documents' ? documents : knowledge).push({
      id: result.itemId,
      title: displayTitle(result.title) || '无标题',
      type,
      snippet: result.snippet ?? '',
      group,
    });
  }

  return { documents, knowledge };
}

/** <mark> 以外的 HTML 标签 */
const NON_MARK_TAG = /<(?!\/?mark>)\/?[a-z][^>]*>/gi;

/**
 * 把摘要拆成普通文本与高亮片段，以 React 文本节点渲染（不使用 innerHTML）
 * <mark> 以外的标签（如富文本正文中的段落标签）直接去掉
 */
export function splitHighlights(snippet: string): SnippetSegment[] {
  return snippet
    .replace(NON_MARK_TAG, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/<mark>([\s\S]*?)<\/mark>/i)
    .map((text, index) => ({
      text,
      // split 的捕获组位于奇数位
      highlight: index % 2 === 1,
    }))
    .filter((segment) => segment.text.length > 0);
}
