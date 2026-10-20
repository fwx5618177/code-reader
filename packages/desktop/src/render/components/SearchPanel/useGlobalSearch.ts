// ================================
// 全局检索 hook：写作文档（内存全文索引）+ 知识库条目（混合检索），以及条目正文的精确查找
// 输入防抖；只采用最新一次查询的结果，过期响应直接丢弃
// 供 ⌘P 搜索面板与侧栏搜索共用
// ================================

import { useEffect, useRef, useState } from 'react';
import { InvalidSearchPatternError } from '@code-reader/search-service';
import { useWritingService } from '../../lib/writing';
import { mergeSearchResults, type SearchGroups } from './search-results';
import { exactSearch, type ExactSearchOptions, type ExactSearchResult } from './exact-search';

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

export interface ExactSearchState {
  result: ExactSearchResult;
  isLoading: boolean;
  /** 正则无效等可提示给用户的错误 */
  error: string | null;
}

const EMPTY_EXACT_RESULT: ExactSearchResult = { items: [], truncated: false };

/**
 * 精确查找：输入防抖，新查询发起时取消上一次；enabled 为 false 时不查询
 */
export function useExactSearch(query: string, options: ExactSearchOptions, enabled: boolean): ExactSearchState {
  const [state, setState] = useState<ExactSearchState>({ result: EMPTY_EXACT_RESULT, isLoading: false, error: null });
  const { caseSensitive, wholeWord, useRegex } = options;

  useEffect(() => {
    // 正则中的首尾空白有意义，字面查找去掉首尾空白
    const pattern = useRegex ? query : query.trim();
    if (!enabled || !query.trim()) {
      setState({ result: EMPTY_EXACT_RESULT, isLoading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      exactSearch(pattern, { caseSensitive, wholeWord, useRegex }, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) setState({ result, isLoading: false, error: null });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          if (!(error instanceof InvalidSearchPatternError)) console.error('[Search] 精确查找失败:', error);
          setState({
            result: EMPTY_EXACT_RESULT,
            isLoading: false,
            error: error instanceof InvalidSearchPatternError ? error.message : '查找失败，请稍后重试',
          });
        }
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, caseSensitive, wholeWord, useRegex, enabled]);

  return state;
}
