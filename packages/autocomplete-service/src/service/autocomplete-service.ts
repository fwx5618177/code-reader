// ================================
// AutocompleteService 智能补全服务
// - 补全提供者按每次查询的上下文（语言、触发字符、光标前文本）实时查询，结果才符合当前语境
// - Radix Tree 只存放宿主用 addItem 加入的静态补全项（如文档中的词、标签），支持前缀与模糊检索
// - 结果按查询上下文缓存
// ================================

import {
  RadixTree,
  type CompletionMeta,
  type SearchResult,
} from '@code-reader/fuzzy-match-algorithm';
import type {
  CompletionItem,
  CompletionProvider,
  CompletionContext,
  CompletionResult,
  AutocompleteServiceOptions,
  CacheEntry,
  ServiceStats,
} from '../types';

// ================================
// 默认配置
// ================================

const DEFAULT_OPTIONS: Required<AutocompleteServiceOptions> = {
  maxResults: 50,
  fuzzy: true,
  maxEditDistance: 2,
  caseSensitive: false,
  minTriggerLength: 1,
  cacheEnabled: true,
  cacheTTL: 30000, // 30 秒
};

/** 查询上下文的缓存键 */
function cacheKeyOf(context: CompletionContext): string {
  return [context.language ?? '', context.triggerCharacter ?? '', context.textBefore, context.query].join('\u0000');
}

// ================================
// AutocompleteService 类
// ================================

/**
 * 智能补全服务
 * 提供高性能的自动补全功能，支持多种补全源
 */
export class AutocompleteService {
  /** Radix Tree 索引 */
  private tree: RadixTree<CompletionMeta>;
  /** 补全提供者映射 */
  private providers: Map<string, CompletionProvider> = new Map();
  /** 服务配置 */
  private options: Required<AutocompleteServiceOptions>;
  /** 结果缓存 */
  private cache: Map<string, CacheEntry> = new Map();
  /** 是否已初始化 */
  private isInitialized: boolean = false;

  constructor(options?: Partial<AutocompleteServiceOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.tree = new RadixTree<CompletionMeta>({
      maxResults: this.options.maxResults,
      fuzzy: this.options.fuzzy,
      maxEditDistance: this.options.maxEditDistance,
      caseSensitive: this.options.caseSensitive,
      minPrefixLength: this.options.minTriggerLength,
    });
  }

  // ================================
  // 初始化和生命周期
  // ================================

  /**
   * 初始化服务。提供者不做预加载：用空上下文预取的结果会丢掉语言与触发条件
   * （例如 Python 代码块里出现 JavaScript 片段、代码里出现 Markdown 标题）
   */
  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    this.clear();
    this.providers.clear();
    this.cache.clear();
    this.isInitialized = false;
  }

  /**
   * 检查服务是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  // ================================
  // 提供者管理
  // ================================

  /**
   * 注册补全提供者
   */
  registerProvider(provider: CompletionProvider): void {
    this.providers.set(provider.name, provider);
    this.clearCache();
  }

  /**
   * 注销补全提供者
   */
  unregisterProvider(name: string): void {
    const provider = this.providers.get(name);
    if (provider?.dispose) {
      provider.dispose();
    }
    this.providers.delete(name);
    this.clearCache();
  }

  /**
   * 获取所有注册的提供者
   */
  getProviders(): CompletionProvider[] {
    return [...this.providers.values()].sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取指定提供者
   */
  getProvider(name: string): CompletionProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * 提供者的数据变化后调用（如片段库更新）：丢弃含该提供者结果的缓存，下次查询重新向它取
   */
  async refreshProvider(name: string): Promise<void> {
    if (!this.providers.has(name)) return;
    for (const [key, entry] of this.cache) {
      if (entry.result.items.some((item) => item.source === name)) this.cache.delete(key);
    }
  }

  /**
   * 所有提供者的数据变化后调用：清空结果缓存（addItem 加入的静态补全项保留）
   */
  async refreshAllProviders(): Promise<void> {
    this.clearCache();
  }

  // ================================
  // 补全项管理
  // ================================

  /**
   * 添加补全项
   */
  addItem(item: CompletionItem): void {
    const filterText = item.filterText ?? item.label;
    const meta: CompletionMeta = {
      id: item.id,
      label: item.label,
      type: item.type,
      detail: item.detail,
      documentation: item.documentation,
      priority: item.priority,
      data: {
        insertText: item.insertText,
        icon: item.icon,
        source: item.source,
        sortText: item.sortText,
        ...((item.data as object) ?? {}),
      },
    };
    this.tree.insert(filterText, meta);
    this.clearCache();
  }

  /**
   * 批量添加补全项
   */
  addItems(items: CompletionItem[]): void {
    for (const item of items) {
      this.addItem(item);
    }
    this.clearCache();
  }

  /**
   * 移除补全项
   */
  removeItem(filterText: string): boolean {
    const result = this.tree.delete(filterText);
    if (result) {
      this.clearCache();
    }
    return result;
  }

  /**
   * 清空所有补全项
   */
  clear(): void {
    this.tree.clear();
    this.clearCache();
  }

  // ================================
  // 补全查询
  // ================================

  /**
   * 获取补全建议
   */
  async getCompletions(context: CompletionContext): Promise<CompletionResult> {
    const startTime = performance.now();
    const { query } = context;

    // 检查最小触发长度
    if (query.length < this.options.minTriggerLength) {
      return {
        items: [],
        isIncomplete: true,
        duration: performance.now() - startTime,
      };
    }

    // 检查缓存：提供者的结果取决于语言、触发字符与光标前文本，缓存键要包含它们
    const cacheKey = cacheKeyOf(context);
    if (this.options.cacheEnabled) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          ...cached,
          duration: performance.now() - startTime,
        };
      }
    }

    // 从树中搜索
    const searchResults = this.options.fuzzy
      ? this.searchWithFuzzy(query)
      : this.searchPrefix(query);

    // 从活跃的提供者获取动态补全
    const dynamicItems = await this.getDynamicCompletions(context);

    // 合并并去重结果
    const mergedItems = this.mergeResults(searchResults, dynamicItems);

    // 排序
    const sortedItems = this.sortItems(mergedItems, query);

    // 限制结果数量
    const limitedItems = sortedItems.slice(0, this.options.maxResults);

    const result: CompletionResult = {
      items: limitedItems,
      isIncomplete: sortedItems.length > this.options.maxResults,
      duration: performance.now() - startTime,
    };

    // 缓存结果
    if (this.options.cacheEnabled) {
      this.addToCache(cacheKey, result);
    }

    return result;
  }

  /**
   * 前缀搜索
   */
  private searchPrefix(query: string): CompletionItem[] {
    // 多取一条，才能判断结果是否被截断（isIncomplete）
    const results = this.tree.prefixSearch(query, {
      maxResults: this.options.maxResults + 1,
      fuzzy: false,
    });
    return this.convertSearchResults(results);
  }

  /**
   * 模糊搜索
   */
  private searchWithFuzzy(query: string): CompletionItem[] {
    // 先尝试前缀匹配
    const limit = this.options.maxResults + 1;
    let results = this.tree.prefixSearch(query, {
      maxResults: limit,
      fuzzy: true,
    });

    // 如果结果不足，添加模糊匹配
    if (results.length < limit) {
      const fuzzyResults = this.tree.fuzzySearch(query, {
        maxResults: limit - results.length,
        maxEditDistance: this.options.maxEditDistance,
      });

      // 去重并合并
      const existingKeys = new Set(results.map((r) => r.key));
      const uniqueFuzzy = fuzzyResults.filter((r) => !existingKeys.has(r.key));
      results = [...results, ...uniqueFuzzy];
    }

    return this.convertSearchResults(results);
  }

  /**
   * 转换搜索结果为补全项
   */
  private convertSearchResults(results: SearchResult<CompletionMeta>[]): CompletionItem[] {
    const items: CompletionItem[] = [];

    for (const result of results) {
      for (const value of result.values) {
        const data = (value.data ?? {}) as Record<string, unknown>;
        items.push({
          id: value.id,
          label: value.label,
          type: value.type as CompletionItem['type'],
          detail: value.detail,
          documentation: value.documentation,
          priority: value.priority,
          insertText: data.insertText as string | undefined,
          icon: data.icon as string | undefined,
          source: data.source as string | undefined,
          sortText: data.sortText as string | undefined,
          filterText: result.key,
          data: data,
        });
      }
    }

    return items;
  }

  /**
   * 从提供者获取动态补全
   */
  private async getDynamicCompletions(context: CompletionContext): Promise<CompletionItem[]> {
    const activeProviders = this.getActiveProviders(context);
    const allItems: CompletionItem[] = [];

    // 并行获取所有提供者的补全
    const results = await Promise.all(
      activeProviders.map((provider) => provider.getCompletions(context))
    );

    for (const items of results) {
      allItems.push(...items);
    }

    return allItems;
  }

  /**
   * 获取当前上下文激活的提供者
   */
  private getActiveProviders(context: CompletionContext): CompletionProvider[] {
    return this.getProviders().filter((provider) => {
      // 检查触发字符
      if (context.triggerCharacter && provider.triggerCharacters) {
        if (!provider.triggerCharacters.includes(context.triggerCharacter)) {
          return false;
        }
      }

      // 检查自定义激活条件
      if (provider.shouldActivate) {
        return provider.shouldActivate(context);
      }

      return true;
    });
  }

  /**
   * 合并并去重结果
   */
  private mergeResults(
    treeResults: CompletionItem[],
    dynamicResults: CompletionItem[]
  ): CompletionItem[] {
    // 使用 Map 去重，以 id 为键
    const seen = new Map<string, CompletionItem>();

    // 先添加树结果
    for (const item of treeResults) {
      const key = item.id || `${item.source}:${item.label}`;
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }

    // 再添加动态结果（可能覆盖）
    for (const item of dynamicResults) {
      const key = item.id || `${item.source}:${item.label}`;
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }

    return [...seen.values()];
  }

  /**
   * 排序补全项
   */
  private sortItems(items: CompletionItem[], query: string): CompletionItem[] {
    const queryLower = query.toLowerCase();

    return items.sort((a, b) => {
      // 1. 精确匹配优先
      const aExact = a.label.toLowerCase() === queryLower;
      const bExact = b.label.toLowerCase() === queryLower;
      if (aExact !== bExact) return aExact ? -1 : 1;

      // 2. 前缀匹配优先
      const aPrefix = a.label.toLowerCase().startsWith(queryLower);
      const bPrefix = b.label.toLowerCase().startsWith(queryLower);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;

      // 3. 优先级排序
      const aPriority = a.priority ?? 50;
      const bPriority = b.priority ?? 50;
      if (aPriority !== bPriority) return bPriority - aPriority;

      // 4. 按排序文本或标签排序
      const aSortText = a.sortText ?? a.label;
      const bSortText = b.sortText ?? b.label;
      return aSortText.localeCompare(bSortText);
    });
  }

  // ================================
  // 缓存管理
  // ================================

  /**
   * 从缓存获取结果
   */
  private getFromCache(key: string): CompletionResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.options.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * 添加结果到缓存
   */
  private addToCache(key: string, result: CompletionResult): void {
    // 定期清理过期缓存
    if (this.cache.size > 100) {
      this.pruneCache();
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      query: key,
    });
  }

  /**
   * 清理过期缓存
   */
  private pruneCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.options.cacheTTL) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.cache.delete(key);
    }

    // 如果还是太大，删除最旧的条目
    if (this.cache.size > 100) {
      const entries = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const deleteCount = this.cache.size - 50;
      for (let i = 0; i < deleteCount; i++) {
        const entry = entries[i];
        if (entry) {
          this.cache.delete(entry[0]);
        }
      }
    }
  }

  /**
   * 清空缓存
   */
  private clearCache(): void {
    this.cache.clear();
  }

  // ================================
  // 统计信息
  // ================================

  /**
   * 获取服务统计信息
   */
  getStats(): ServiceStats {
    return {
      treeSize: this.tree.getSize(),
      providerCount: this.providers.size,
      cacheSize: this.cache.size,
      isInitialized: this.isInitialized,
    };
  }

  /**
   * 获取配置
   */
  getOptions(): Required<AutocompleteServiceOptions> {
    return { ...this.options };
  }

  /**
   * 更新配置
   */
  updateOptions(options: Partial<AutocompleteServiceOptions>): void {
    this.options = { ...this.options, ...options };
    this.clearCache();
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建补全服务实例
 */
export function createAutocompleteService(
  options?: Partial<AutocompleteServiceOptions>
): AutocompleteService {
  return new AutocompleteService(options);
}
