// ================================
// 全局检索 hook：写作文档（内存全文索引）+ 知识库条目（混合检索）
// 输入防抖；只采用最新一次查询的结果，过期响应直接丢弃
// 供 ⌘P 搜索面板与侧栏搜索共用
// ================================

import { useEffect, useRef, useState } from 'react';
import { useWritingService } from '../../lib/writing';
import { mergeSearchResults, type SearchGroups } from './search-results';

/** 输入停顿多久后发起搜索（毫秒） */
const SEARCH_DEBOUNCE_MS = 300;
/** 每一路搜索的结果上限 */
const RESULT_LIMIT = 30;

export const EMPTY_SEARCH_GROUPS: SearchGroups = { documents: [], knowledge: [] };

export interface GlobalSearchState {
  groups: SearchGroups;
  isLoading: boolean;
}

export function useGlobalSearch(query: string): GlobalSearchState {
  const [groups, setGroups] = useState<SearchGroups>(EMPTY_SEARCH_GROUPS);
  const [isLoading, setIsLoading] = useState(false);
  // 每次查询递增，响应返回时与最新值比较以丢弃过期结果
  const requestSeqRef = useRef(0);
  const { search: searchDocuments } = useWritingService();

  useEffect(() => {
    const seq = ++requestSeqRef.current;
    const trimmed = query.trim();
    if (!trimmed) {
      setGroups(EMPTY_SEARCH_GROUPS);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(() => {
      void Promise.allSettled([
        searchDocuments(trimmed, { limit: RESULT_LIMIT, fuzzy: true, highlight: true }),
        window.electron.search.hybrid(trimmed, { limit: RESULT_LIMIT }),
      ]).then(([writing, hybrid]) => {
        if (seq !== requestSeqRef.current) return;
        if (writing.status === 'rejected') console.error('[Search] 写作文档搜索失败:', writing.reason);
        if (hybrid.status === 'rejected') console.error('[Search] 知识库搜索失败:', hybrid.reason);
        setGroups(
          mergeSearchResults(
            writing.status === 'fulfilled' ? writing.value : [],
            hybrid.status === 'fulfilled' ? hybrid.value : []
          )
        );
        setIsLoading(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, searchDocuments]);

  return { groups, isLoading };
}
