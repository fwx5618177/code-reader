// ================================
// AutocompleteService 智能补全服务
// 整合 Radix Tree 实现高性能的智能补全功能
// 支持多种补全源、优先级排序、实时更新
// ================================

import { RadixTree, CompletionMeta, SearchResult } from './radix-tree';

// ================================
// 类型定义
// ================================

/** 补全源类型 */
export type CompletionSourceType =
  | 'keyword' // 关键字
  | 'snippet' // 代码片段
  | 'variable' // 变量
  | 'function' // 函数
  | 'class' // 类
  | 'property' // 属性
  | 'method' // 方法
  | 'constant' // 常量
  | 'module' // 模块
  | 'file' // 文件
  | 'folder' // 文件夹
  | 'tag' // 标签
  | 'heading' // 标题
  | 'reference' // 引用
  | 'emoji' // 表情符号
  | 'custom'; // 自定义

/** 补全项 */
export interface CompletionItem {
  /** 唯一标识 */
  id: string;
  /** 显示标签 */
  label: string;
  /** 插入文本（如果与标签不同） */
  insertText?: string;
  /** 补全类型 */
  type: CompletionSourceType;
  /** 详细信息 */
  detail?: string;
  /** 文档说明 */
  documentation?: string;
  /** 优先级权重（0-100，越高越优先） */
  priority?: number;
  /** 过滤文本（用于匹配） */
  filterText?: string;
  /** 排序文本 */
  sortText?: string;
  /** 图标 */
  icon?: string;
  /** 来源标识 */
  source?: string;
  /** 额外数据 */
  data?: unknown;
}

/** 补全提供者接口 */
export interface CompletionProvider {
  /** 提供者名称 */
  readonly name: string;
  /** 提供者类型 */
  readonly type: CompletionSourceType;
  /** 优先级（用于排序提供者） */
  readonly priority: number;
  /** 触发字符（可选） */
  readonly triggerCharacters?: string[];
  /** 获取补全项 */
  getCompletions(context: CompletionContext): Promise<CompletionItem[]> | CompletionItem[];
  /** 是否应该激活（可选过滤） */
  shouldActivate?(context: CompletionContext): boolean;
}

/** 补全上下文 */
export interface CompletionContext {
  /** 当前输入的查询文本 */
  query: string;
  /** 触发字符（如果有） */
  triggerCharacter?: string;
  /** 光标位置 */
  position: { line: number; column: number };
  /** 当前行文本 */
  lineText: string;
  /** 光标前的文本 */
  textBefore: string;
  /** 光标后的文本 */
  textAfter: string;
  /** 文档 ID（可选） */
  documentId?: string;
  /** 语言（可选） */
  language?: string;
  /** 额外上下文数据 */
  extra?: Record<string, unknown>;
}

/** 补全结果 */
export interface CompletionResult {
  /** 补全项列表 */
  items: CompletionItem[];
  /** 是否还有更多结果 */
  isIncomplete: boolean;
  /** 查询耗时（毫秒） */
  duration: number;
}

/** 服务配置 */
export interface AutocompleteServiceOptions {
  /** 最大返回结果数 */
  maxResults?: number;
  /** 是否启用模糊匹配 */
  fuzzy?: boolean;
  /** 模糊匹配的最大编辑距离 */
  maxEditDistance?: number;
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 最小触发长度 */
  minTriggerLength?: number;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 是否缓存结果 */
  cacheEnabled?: boolean;
  /** 缓存过期时间（毫秒） */
  cacheTTL?: number;
}

/** 缓存条目 */
interface CacheEntry {
  result: CompletionResult;
  timestamp: number;
  query: string;
}

// ================================
// 默认配置
// ================================

const DEFAULT_OPTIONS: Required<AutocompleteServiceOptions> = {
  maxResults: 50,
  fuzzy: true,
  maxEditDistance: 2,
  caseSensitive: false,
  minTriggerLength: 1,
  debounceMs: 100,
  cacheEnabled: true,
  cacheTTL: 30000, // 30 秒
};

// ================================
// AutocompleteService 类
// ================================

export class AutocompleteService {
  private tree: RadixTree<CompletionMeta>;
  private providers: Map<string, CompletionProvider> = new Map();
  private options: Required<AutocompleteServiceOptions>;
  private cache: Map<string, CacheEntry> = new Map();
  private pendingUpdate: ReturnType<typeof setTimeout> | null = null;
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
   * 初始化服务
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // 从所有提供者加载初始数据
    await this.refreshAllProviders();

    this.isInitialized = true;
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    this.clear();
    this.providers.clear();
    this.cache.clear();
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }
    this.isInitialized = false;
  }

  // ================================
  // 提供者管理
  // ================================

  /**
   * 注册补全提供者
   */
  registerProvider(provider: CompletionProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * 注销补全提供者
   */
  unregisterProvider(name: string): void {
    this.providers.delete(name);
  }

  /**
   * 获取所有注册的提供者
   */
  getProviders(): CompletionProvider[] {
    return [...this.providers.values()].sort((a, b) => b.priority - a.priority);
  }

  /**
   * 刷新指定提供者的数据
   */
  async refreshProvider(name: string): Promise<void> {
    const provider = this.providers.get(name);
    if (!provider) return;

    // 创建一个空的上下文来获取所有补全项
    const context: CompletionContext = {
      query: '',
      position: { line: 0, column: 0 },
      lineText: '',
      textBefore: '',
      textAfter: '',
    };

    const items = await provider.getCompletions(context);

    // 将补全项添加到树中
    for (const item of items) {
      const filterText = item.filterText || item.label;
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
          source: provider.name,
          sortText: item.sortText,
          ...((item.data as object) || {}),
        },
      };
      this.tree.insert(filterText, meta);
    }
  }

  /**
   * 刷新所有提供者的数据
   */
  async refreshAllProviders(): Promise<void> {
    // 清空树
    this.tree.clear();
    this.clearCache();

    // 并行刷新所有提供者
    const refreshTasks = [...this.providers.keys()].map((name) => this.refreshProvider(name));
    await Promise.all(refreshTasks);
  }

  // ================================
  // 补全项管理
  // ================================

  /**
   * 添加补全项
   */
  addItem(item: CompletionItem): void {
    const filterText = item.filterText || item.label;
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
        ...((item.data as object) || {}),
      },
    };
    this.tree.insert(filterText, meta);
    this.invalidateCache();
  }

  /**
   * 批量添加补全项
   */
  addItems(items: CompletionItem[]): void {
    for (const item of items) {
      this.addItem(item);
    }
    this.invalidateCache();
  }

  /**
   * 移除补全项
   */
  removeItem(filterText: string): boolean {
    const result = this.tree.delete(filterText);
    if (result) {
      this.invalidateCache();
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

    // 检查缓存
    if (this.options.cacheEnabled) {
      const cached = this.getFromCache(query);
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
      this.addToCache(query, result);
    }

    return result;
  }

  /**
   * 前缀搜索
   */
  private searchPrefix(query: string): CompletionItem[] {
    const results = this.tree.prefixSearch(query, {
      maxResults: this.options.maxResults,
      fuzzy: false,
    });

    return this.convertSearchResults(results);
  }

  /**
   * 模糊搜索
   */
  private searchWithFuzzy(query: string): CompletionItem[] {
    // 先尝试前缀搜索
    let results = this.tree.prefixSearch(query, {
      maxResults: this.options.maxResults,
      fuzzy: false,
    });

    // 如果结果不足，添加模糊搜索结果
    if (results.length < this.options.maxResults / 2) {
      const fuzzyResults = this.tree.fuzzySearch(query, {
        maxResults: this.options.maxResults - results.length,
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
      for (const meta of result.values) {
        const data = meta.data as Record<string, unknown> | undefined;
        items.push({
          id: meta.id,
          label: meta.label,
          type: meta.type as CompletionSourceType,
          detail: meta.detail,
          documentation: meta.documentation,
          priority: meta.priority,
          insertText: data?.insertText as string | undefined,
          icon: data?.icon as string | undefined,
          source: data?.source as string | undefined,
          sortText: data?.sortText as string | undefined,
          filterText: result.key,
          data: data,
        });
      }
    }

    return items;
  }

  /**
   * 获取动态补全（从活跃的提供者）
   */
  private async getDynamicCompletions(context: CompletionContext): Promise<CompletionItem[]> {
    const activeProviders = this.getActiveProviders(context);
    const allItems: CompletionItem[] = [];

    // 并行获取所有提供者的补全
    const results = await Promise.allSettled(
      activeProviders.map((provider) => provider.getCompletions(context))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value);
      }
    }

    return allItems;
  }

  /**
   * 获取活跃的提供者
   */
  private getActiveProviders(context: CompletionContext): CompletionProvider[] {
    return [...this.providers.values()]
      .filter((provider) => {
        // 检查触发字符
        if (provider.triggerCharacters && context.triggerCharacter) {
          if (!provider.triggerCharacters.includes(context.triggerCharacter)) {
            return false;
          }
        }

        // 检查自定义激活条件
        if (provider.shouldActivate) {
          return provider.shouldActivate(context);
        }

        return true;
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * 合并并去重结果
   */
  private mergeResults(
    staticItems: CompletionItem[],
    dynamicItems: CompletionItem[]
  ): CompletionItem[] {
    const seen = new Set<string>();
    const merged: CompletionItem[] = [];

    // 先添加静态结果（已索引的）
    for (const item of staticItems) {
      const key = `${item.type}:${item.label}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }

    // 添加动态结果
    for (const item of dynamicItems) {
      const key = `${item.type}:${item.label}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }

    return merged;
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

      // 3. 优先级
      const aPriority = a.priority ?? 0;
      const bPriority = b.priority ?? 0;
      if (aPriority !== bPriority) return bPriority - aPriority;

      // 4. 排序文本
      if (a.sortText && b.sortText) {
        return a.sortText.localeCompare(b.sortText);
      }

      // 5. 标签字母顺序
      return a.label.localeCompare(b.label);
    });
  }

  // ================================
  // 缓存管理
  // ================================

  /**
   * 从缓存获取结果
   */
  private getFromCache(query: string): CompletionResult | null {
    const entry = this.cache.get(query);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.options.cacheTTL) {
      this.cache.delete(query);
      return null;
    }

    return entry.result;
  }

  /**
   * 添加结果到缓存
   */
  private addToCache(query: string, result: CompletionResult): void {
    this.cache.set(query, {
      result,
      timestamp: Date.now(),
      query,
    });

    // 限制缓存大小
    if (this.cache.size > 100) {
      this.pruneCache();
    }
  }

  /**
   * 清理过期缓存
   */
  private pruneCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.options.cacheTTL) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.cache.delete(key);
    }

    // 如果仍然太大，删除最旧的条目
    if (this.cache.size > 100) {
      const entries = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const deleteCount = this.cache.size - 50;
      for (let i = 0; i < deleteCount; i++) {
        this.cache.delete(entries[i][0]);
      }
    }
  }

  /**
   * 使缓存失效
   */
  private invalidateCache(): void {
    // 延迟清理以避免频繁操作
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
    }
    this.pendingUpdate = setTimeout(() => {
      this.clearCache();
      this.pendingUpdate = null;
    }, 100);
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
  getStats(): {
    treeSize: number;
    providerCount: number;
    cacheSize: number;
    isInitialized: boolean;
  } {
    return {
      treeSize: this.tree.getSize(),
      providerCount: this.providers.size,
      cacheSize: this.cache.size,
      isInitialized: this.isInitialized,
    };
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

// ================================
// 导出
// ================================

export default AutocompleteService;
