// ================================
// Search 模块 - 统一导出
//
// 提供全文搜索和文件搜索功能：
// - 倒排索引全文搜索
// - 批量文件内容搜索
// - 模糊匹配
// - 正则表达式搜索
// ================================

// ================================
// 搜索索引
// ================================

export {
  // 核心类
  SearchIndex,
  // 工厂函数
  createSearchIndex,
  createChineseSearchIndex,
  createCodeSearchIndex,
  // 默认实例
  getDefaultSearchIndex,
  resetDefaultSearchIndex,
} from './search-index';

export type {
  SearchDocument,
  SearchResult,
  SearchHighlight,
  SearchOptions,
  SearchIndexConfig,
  IndexStats,
} from './search-index';

// ================================
// 文件搜索
// ================================

export {
  // 核心类
  FileSearcher,
  MemoryFileProvider,
  // 工厂函数
  createFileSearcher,
  createMemoryFileSearcher,
  // 便捷函数
  quickContentSearch,
  quickRegexSearch,
  highlightMatches,
} from './file-searcher';

export type {
  FileMatch,
  LineMatch,
  MatchPosition,
  FileSearchOptions,
  SearchStats,
  BatchSearchResult,
  IFileProvider,
} from './file-searcher';
