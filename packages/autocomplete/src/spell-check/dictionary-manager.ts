// ================================
// 拼写检查词典管理器
// 支持多词典热插拔、缓存、用户词典
// ================================

import {
  damerauLevenshteinDistance,
  damerauSimilarity,
} from '@code-reader/auto-complete-algorithm';
import type {
  IDictionaryProvider,
  DictionaryEntry,
  DictionaryMetadata,
  DictionarySourceConfig,
  DictionaryManagerConfig,
  SpellCheckResult,
  SpellSuggestion,
  DictionaryEvent,
  DictionaryEventType,
  DictionaryEventListener,
  UserDictionaryEntry,
  UserDictionaryConfig,
} from './types';
import { DEFAULT_DICTIONARY_MANAGER_CONFIG } from './types';

// ================================
// 缓存条目
// ================================

interface CacheEntry {
  result: SpellCheckResult;
  timestamp: number;
}

// ================================
// 基础词典提供者
// ================================

/** 基于 Map 的简单词典提供者 */
export class SimpleDictionaryProvider implements IDictionaryProvider {
  private metadata: DictionaryMetadata;
  private words: Map<string, DictionaryEntry> = new Map();
  private loaded = false;
  private loadFn?: () => Promise<DictionaryEntry[]>;

  constructor(
    metadata: DictionaryMetadata,
    entries?: DictionaryEntry[],
    loadFn?: () => Promise<DictionaryEntry[]>
  ) {
    this.metadata = metadata;
    this.loadFn = loadFn;

    if (entries) {
      this.setEntries(entries);
      this.loaded = true;
    }
  }

  private setEntries(entries: DictionaryEntry[]): void {
    this.words.clear();
    for (const entry of entries) {
      this.words.set(entry.word.toLowerCase(), entry);
    }
    this.metadata.wordCount = this.words.size;
  }

  getMetadata(): DictionaryMetadata {
    return { ...this.metadata };
  }

  hasWord(word: string): boolean {
    return this.words.has(word.toLowerCase());
  }

  getEntry(word: string): DictionaryEntry | null {
    return this.words.get(word.toLowerCase()) || null;
  }

  findSimilar(word: string, maxResults = 5): DictionaryEntry[] {
    const wordLower = word.toLowerCase();
    const results: Array<{ entry: DictionaryEntry; distance: number }> = [];

    for (const entry of this.words.values()) {
      // 跳过长度差异过大的词
      const lengthDiff = Math.abs(entry.word.length - word.length);
      if (lengthDiff > 3) continue;

      const distance = damerauLevenshteinDistance(wordLower, entry.word.toLowerCase(), {
        caseSensitive: false,
      });

      if (distance <= 2) {
        results.push({ entry, distance });
      }
    }

    // 按距离和词频排序
    results.sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      return b.entry.frequency - a.entry.frequency;
    });

    return results.slice(0, maxResults).map((r) => r.entry);
  }

  searchByPrefix(prefix: string, maxResults = 10): DictionaryEntry[] {
    const prefixLower = prefix.toLowerCase();
    const results: DictionaryEntry[] = [];

    for (const entry of this.words.values()) {
      if (entry.word.toLowerCase().startsWith(prefixLower)) {
        results.push(entry);
        if (results.length >= maxResults) break;
      }
    }

    // 按词频排序
    results.sort((a, b) => b.frequency - a.frequency);
    return results;
  }

  getAllWords(): string[] {
    return Array.from(this.words.keys());
  }

  size(): number {
    return this.words.size;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    if (this.loadFn) {
      const entries = await this.loadFn();
      this.setEntries(entries);
    }

    this.loaded = true;
  }

  unload(): void {
    this.words.clear();
    this.loaded = false;
  }

  dispose(): void {
    this.unload();
  }

  /** 添加词条 */
  addEntry(entry: DictionaryEntry): void {
    this.words.set(entry.word.toLowerCase(), entry);
    this.metadata.wordCount = this.words.size;
  }

  /** 批量添加词条 */
  addEntries(entries: DictionaryEntry[]): void {
    for (const entry of entries) {
      this.words.set(entry.word.toLowerCase(), entry);
    }
    this.metadata.wordCount = this.words.size;
  }

  /** 移除词条 */
  removeEntry(word: string): boolean {
    const removed = this.words.delete(word.toLowerCase());
    if (removed) {
      this.metadata.wordCount = this.words.size;
    }
    return removed;
  }
}

// ================================
// 用户词典
// ================================

/** 用户自定义词典 */
export class UserDictionary {
  private entries: Map<string, UserDictionaryEntry> = new Map();
  private config: Required<UserDictionaryConfig>;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: UserDictionaryConfig) {
    this.config = {
      storageKey: config?.storageKey ?? 'user-dictionary',
      maxEntries: config?.maxEntries ?? 10000,
      autoPersist: config?.autoPersist ?? true,
    };
  }

  /** 加载用户词典 */
  load(): void {
    try {
      const stored = localStorage.getItem(this.config.storageKey);
      if (stored) {
        const data = JSON.parse(stored) as UserDictionaryEntry[];
        for (const entry of data) {
          this.entries.set(entry.word.toLowerCase(), entry);
        }
      }
    } catch (error) {
      console.error('[UserDictionary] 加载失败:', error);
    }
  }

  /** 保存用户词典 */
  save(): void {
    try {
      const data = Array.from(this.entries.values());
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('[UserDictionary] 保存失败:', error);
    }
  }

  /** 延迟保存 */
  private scheduleSave(): void {
    if (!this.config.autoPersist) return;

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.save();
      this.persistTimer = null;
    }, 1000);
  }

  /** 检查单词是否存在 */
  hasWord(word: string): boolean {
    return this.entries.has(word.toLowerCase());
  }

  /** 添加单词 */
  addWord(word: string): void {
    const wordLower = word.toLowerCase();

    if (this.entries.has(wordLower)) {
      // 增加使用次数
      const entry = this.entries.get(wordLower)!;
      entry.useCount++;
      return;
    }

    // 检查容量
    if (this.entries.size >= this.config.maxEntries) {
      // 移除使用次数最少的条目
      this.removeLowestUsage();
    }

    this.entries.set(wordLower, {
      word: word,
      addedAt: Date.now(),
      useCount: 1,
    });

    this.scheduleSave();
  }

  /** 批量添加单词 */
  addWords(words: string[]): void {
    for (const word of words) {
      this.addWord(word);
    }
  }

  /** 移除单词 */
  removeWord(word: string): boolean {
    const removed = this.entries.delete(word.toLowerCase());
    if (removed) {
      this.scheduleSave();
    }
    return removed;
  }

  /** 获取所有单词 */
  getAllWords(): string[] {
    return Array.from(this.entries.values()).map((e) => e.word);
  }

  /** 获取大小 */
  size(): number {
    return this.entries.size;
  }

  /** 清空 */
  clear(): void {
    this.entries.clear();
    this.scheduleSave();
  }

  /** 移除使用次数最少的条目 */
  private removeLowestUsage(): void {
    let minEntry: UserDictionaryEntry | null = null;
    let minKey: string | null = null;

    for (const [key, entry] of this.entries) {
      if (!minEntry || entry.useCount < minEntry.useCount) {
        minEntry = entry;
        minKey = key;
      }
    }

    if (minKey) {
      this.entries.delete(minKey);
    }
  }

  /** 销毁 */
  dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.save();
  }
}

// ================================
// 忽略词列表
// ================================

/** 忽略词列表 */
export class IgnoreList {
  private words: Set<string> = new Set();
  private storageKey: string;

  constructor(storageKey = 'spell-ignore-list') {
    this.storageKey = storageKey;
  }

  /** 加载 */
  load(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored) as string[];
        this.words = new Set(data.map((w) => w.toLowerCase()));
      }
    } catch (error) {
      console.error('[IgnoreList] 加载失败:', error);
    }
  }

  /** 保存 */
  save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Array.from(this.words)));
    } catch (error) {
      console.error('[IgnoreList] 保存失败:', error);
    }
  }

  /** 检查是否被忽略 */
  isIgnored(word: string): boolean {
    return this.words.has(word.toLowerCase());
  }

  /** 添加到忽略列表 */
  ignore(word: string): void {
    this.words.add(word.toLowerCase());
    this.save();
  }

  /** 批量添加 */
  ignoreAll(words: string[]): void {
    for (const word of words) {
      this.words.add(word.toLowerCase());
    }
    this.save();
  }

  /** 取消忽略 */
  unignore(word: string): boolean {
    const removed = this.words.delete(word.toLowerCase());
    if (removed) {
      this.save();
    }
    return removed;
  }

  /** 清空 */
  clear(): void {
    this.words.clear();
    this.save();
  }

  /** 获取所有忽略词 */
  getAll(): string[] {
    return Array.from(this.words);
  }

  /** 大小 */
  size(): number {
    return this.words.size;
  }
}

// ================================
// 词典管理器
// ================================

/** 词典管理器 */
export class DictionaryManager {
  private config: Required<DictionaryManagerConfig>;
  private providers: Map<string, IDictionaryProvider> = new Map();
  private userDictionary: UserDictionary | null = null;
  private ignoreList: IgnoreList | null = null;
  private cache: Map<string, CacheEntry> = new Map();
  private listeners: Set<DictionaryEventListener> = new Set();

  constructor(config?: DictionaryManagerConfig) {
    this.config = { ...DEFAULT_DICTIONARY_MANAGER_CONFIG, ...config };

    // 初始化用户词典
    if (this.config.enableUserDictionary) {
      this.userDictionary = new UserDictionary();
      this.userDictionary.load();
    }

    // 初始化忽略列表
    if (this.config.enableIgnoreList) {
      this.ignoreList = new IgnoreList();
      this.ignoreList.load();
    }
  }

  // ================================
  // 词典管理
  // ================================

  /** 注册词典提供者 */
  registerProvider(provider: IDictionaryProvider): void {
    const metadata = provider.getMetadata();
    this.providers.set(metadata.id, provider);
    this.emitEvent('added', metadata.id);
  }

  /** 注销词典提供者 */
  unregisterProvider(dictionaryId: string): boolean {
    const provider = this.providers.get(dictionaryId);
    if (!provider) return false;

    provider.dispose();
    this.providers.delete(dictionaryId);
    this.clearCache();
    this.emitEvent('removed', dictionaryId);
    return true;
  }

  /** 获取词典提供者 */
  getProvider(dictionaryId: string): IDictionaryProvider | null {
    return this.providers.get(dictionaryId) || null;
  }

  /** 获取所有词典元数据 */
  getAllMetadata(): DictionaryMetadata[] {
    return Array.from(this.providers.values()).map((p) => p.getMetadata());
  }

  /** 加载词典 */
  async loadDictionary(dictionaryId: string): Promise<void> {
    const provider = this.providers.get(dictionaryId);
    if (!provider) {
      throw new Error(`词典不存在: ${dictionaryId}`);
    }

    try {
      await provider.load();
      this.emitEvent('loaded', dictionaryId);
    } catch (error) {
      this.emitEvent('error', dictionaryId, error as Error);
      throw error;
    }
  }

  /** 卸载词典 */
  unloadDictionary(dictionaryId: string): void {
    const provider = this.providers.get(dictionaryId);
    if (provider) {
      provider.unload();
      this.clearCache();
      this.emitEvent('unloaded', dictionaryId);
    }
  }

  /** 从配置创建并注册词典 */
  async registerFromConfig(config: DictionarySourceConfig): Promise<IDictionaryProvider> {
    let provider: IDictionaryProvider;

    const metadata: DictionaryMetadata = {
      id: config.id,
      name: config.id,
      language: config.language,
      version: '1.0.0',
      wordCount: 0,
    };

    switch (config.type) {
      case 'custom':
        if (!config.loader) {
          throw new Error('自定义词典需要提供 loader 函数');
        }
        provider = new SimpleDictionaryProvider(metadata, undefined, config.loader);
        break;

      case 'builtin':
      case 'file':
      case 'url':
      default:
        // 暂时创建空词典，等待后续加载
        provider = new SimpleDictionaryProvider(metadata);
        break;
    }

    this.registerProvider(provider);

    // 非延迟加载时立即加载
    if (!config.lazyLoad) {
      await this.loadDictionary(config.id);
    }

    return provider;
  }

  // ================================
  // 拼写检查
  // ================================

  /** 检查单词拼写 */
  checkSpelling(word: string): SpellCheckResult {
    // 检查缓存
    const cacheKey = word.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
      return cached.result;
    }

    // 检查忽略列表
    if (this.ignoreList?.isIgnored(word)) {
      const result: SpellCheckResult = { word, correct: true, suggestions: [] };
      this.addToCache(cacheKey, result);
      return result;
    }

    // 检查用户词典
    if (this.userDictionary?.hasWord(word)) {
      const result: SpellCheckResult = { word, correct: true, suggestions: [] };
      this.addToCache(cacheKey, result);
      return result;
    }

    // 检查所有词典
    for (const [dictionaryId, provider] of this.providers) {
      if (!provider.isLoaded()) continue;

      if (provider.hasWord(word)) {
        const result: SpellCheckResult = {
          word,
          correct: true,
          suggestions: [],
          dictionaryId,
        };
        this.addToCache(cacheKey, result);
        return result;
      }
    }

    // 单词不正确，生成建议
    const suggestions = this.generateSuggestions(word);
    const result: SpellCheckResult = {
      word,
      correct: false,
      suggestions,
    };
    this.addToCache(cacheKey, result);
    return result;
  }

  /** 批量检查 */
  checkSpellingBatch(words: string[]): SpellCheckResult[] {
    return words.map((word) => this.checkSpelling(word));
  }

  /** 生成拼写建议 */
  private generateSuggestions(word: string): SpellSuggestion[] {
    const suggestions: SpellSuggestion[] = [];
    const seen = new Set<string>();

    for (const [dictionaryId, provider] of this.providers) {
      if (!provider.isLoaded()) continue;

      const similar = provider.findSimilar(word, this.config.maxSuggestions);

      for (const entry of similar) {
        const wordLower = entry.word.toLowerCase();
        if (seen.has(wordLower)) continue;
        seen.add(wordLower);

        const distance = damerauLevenshteinDistance(word.toLowerCase(), wordLower, {
          caseSensitive: false,
        });

        if (distance > this.config.maxEditDistance) continue;

        const similarity = damerauSimilarity(word, entry.word, false);
        const confidence = similarity * (0.5 + entry.frequency * 0.5);

        suggestions.push({
          word: entry.word,
          confidence,
          distance,
          dictionaryId,
        });
      }
    }

    // 按置信度排序
    suggestions.sort((a, b) => b.confidence - a.confidence);
    return suggestions.slice(0, this.config.maxSuggestions);
  }

  // ================================
  // 用户词典操作
  // ================================

  /** 添加到用户词典 */
  addToUserDictionary(word: string): void {
    this.userDictionary?.addWord(word);
    this.clearCacheEntry(word);
  }

  /** 批量添加到用户词典 */
  addToUserDictionaryBatch(words: string[]): void {
    this.userDictionary?.addWords(words);
    for (const word of words) {
      this.clearCacheEntry(word);
    }
  }

  /** 从用户词典移除 */
  removeFromUserDictionary(word: string): boolean {
    const removed = this.userDictionary?.removeWord(word) ?? false;
    if (removed) {
      this.clearCacheEntry(word);
    }
    return removed;
  }

  /** 获取用户词典所有单词 */
  getUserDictionaryWords(): string[] {
    return this.userDictionary?.getAllWords() ?? [];
  }

  /** 清空用户词典 */
  clearUserDictionary(): void {
    this.userDictionary?.clear();
    this.clearCache();
  }

  // ================================
  // 忽略列表操作
  // ================================

  /** 忽略单词 */
  ignoreWord(word: string): void {
    this.ignoreList?.ignore(word);
    this.clearCacheEntry(word);
  }

  /** 批量忽略 */
  ignoreWords(words: string[]): void {
    this.ignoreList?.ignoreAll(words);
    for (const word of words) {
      this.clearCacheEntry(word);
    }
  }

  /** 取消忽略 */
  unignoreWord(word: string): boolean {
    const removed = this.ignoreList?.unignore(word) ?? false;
    if (removed) {
      this.clearCacheEntry(word);
    }
    return removed;
  }

  /** 获取所有忽略词 */
  getIgnoredWords(): string[] {
    return this.ignoreList?.getAll() ?? [];
  }

  /** 清空忽略列表 */
  clearIgnoreList(): void {
    this.ignoreList?.clear();
    this.clearCache();
  }

  // ================================
  // 缓存管理
  // ================================

  /** 添加到缓存 */
  private addToCache(key: string, result: SpellCheckResult): void {
    // 检查缓存大小
    if (this.cache.size >= this.config.cacheSize) {
      // 移除最旧的条目
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  /** 清除单个缓存条目 */
  private clearCacheEntry(word: string): void {
    this.cache.delete(word.toLowerCase());
  }

  /** 清空缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  /** 获取缓存统计 */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.cacheSize,
    };
  }

  // ================================
  // 事件系统
  // ================================

  /** 添加事件监听器 */
  addEventListener(listener: DictionaryEventListener): void {
    this.listeners.add(listener);
  }

  /** 移除事件监听器 */
  removeEventListener(listener: DictionaryEventListener): void {
    this.listeners.delete(listener);
  }

  /** 发送事件 */
  private emitEvent(type: DictionaryEventType, dictionaryId: string, error?: Error): void {
    const event: DictionaryEvent = {
      type,
      dictionaryId,
      timestamp: Date.now(),
      error,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[DictionaryManager] 事件监听器错误:', e);
      }
    }
  }

  // ================================
  // 工具方法
  // ================================

  /** 获取配置 */
  getConfig(): Required<DictionaryManagerConfig> {
    return { ...this.config };
  }

  /** 更新配置 */
  updateConfig(config: Partial<DictionaryManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 获取统计信息 */
  getStats(): {
    dictionaryCount: number;
    totalWords: number;
    userDictionarySize: number;
    ignoreListSize: number;
    cacheSize: number;
  } {
    let totalWords = 0;
    for (const provider of this.providers.values()) {
      if (provider.isLoaded()) {
        totalWords += provider.size();
      }
    }

    return {
      dictionaryCount: this.providers.size,
      totalWords,
      userDictionarySize: this.userDictionary?.size() ?? 0,
      ignoreListSize: this.ignoreList?.size() ?? 0,
      cacheSize: this.cache.size,
    };
  }

  /** 销毁 */
  dispose(): void {
    // 销毁所有提供者
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();

    // 保存并销毁用户词典
    this.userDictionary?.dispose();

    // 清理
    this.cache.clear();
    this.listeners.clear();
  }
}

// ================================
// 工厂函数
// ================================

/** 创建词典管理器 */
export function createDictionaryManager(config?: DictionaryManagerConfig): DictionaryManager {
  return new DictionaryManager(config);
}

/** 创建简单词典提供者 */
export function createSimpleDictionaryProvider(
  id: string,
  language: string,
  entries: DictionaryEntry[]
): SimpleDictionaryProvider {
  return new SimpleDictionaryProvider(
    {
      id,
      name: id,
      language,
      version: '1.0.0',
      wordCount: entries.length,
    },
    entries
  );
}

// ================================
// 默认导出
// ================================

export default DictionaryManager;
