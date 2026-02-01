// ================================
// @code-reader/autocomplete-service
// 拼写检查提供者
// 提供单词拼写检查和纠正建议
// ================================

import { BaseProvider } from './base-provider';
import type {
  CompletionContext,
  CompletionItem,
  CompletionSourceType,
  SpellCheckResult,
  SpellSuggestion,
} from '../types';
import {
  damerauLevenshteinDistance,
  damerauSimilarity,
} from '@code-reader/fuzzy-match-algorithm';

// ================================
// 词典类型定义
// ================================

/** 词典条目 */
interface DictionaryEntry {
  /** 单词 */
  word: string;
  /** 词频（用于排序） */
  frequency: number;
  /** 词性（可选） */
  partOfSpeech?: string;
}

/** 词典配置 */
interface DictionaryConfig {
  /** 语言代码 */
  language: string;
  /** 词典名称 */
  name: string;
  /** 最大编辑距离 */
  maxEditDistance: number;
  /** 最大建议数量 */
  maxSuggestions: number;
}

// ================================
// 内置基础词典（英语常用词）
// ================================

/** 英语常用词词典 */
const ENGLISH_COMMON_WORDS: DictionaryEntry[] = [
  // 高频词
  { word: 'the', frequency: 100 },
  { word: 'be', frequency: 99 },
  { word: 'to', frequency: 98 },
  { word: 'of', frequency: 97 },
  { word: 'and', frequency: 96 },
  { word: 'a', frequency: 95 },
  { word: 'in', frequency: 94 },
  { word: 'that', frequency: 93 },
  { word: 'have', frequency: 92 },
  { word: 'it', frequency: 91 },
  { word: 'for', frequency: 90 },
  { word: 'not', frequency: 89 },
  { word: 'on', frequency: 88 },
  { word: 'with', frequency: 87 },
  { word: 'he', frequency: 86 },
  { word: 'as', frequency: 85 },
  { word: 'you', frequency: 84 },
  { word: 'do', frequency: 83 },
  { word: 'at', frequency: 82 },
  { word: 'this', frequency: 81 },
  { word: 'but', frequency: 80 },
  { word: 'his', frequency: 79 },
  { word: 'by', frequency: 78 },
  { word: 'from', frequency: 77 },
  { word: 'they', frequency: 76 },
  { word: 'we', frequency: 75 },
  { word: 'say', frequency: 74 },
  { word: 'her', frequency: 73 },
  { word: 'she', frequency: 72 },
  { word: 'or', frequency: 71 },
  { word: 'an', frequency: 70 },
  { word: 'will', frequency: 69 },
  { word: 'my', frequency: 68 },
  { word: 'one', frequency: 67 },
  { word: 'all', frequency: 66 },
  { word: 'would', frequency: 65 },
  { word: 'there', frequency: 64 },
  { word: 'their', frequency: 63 },
  { word: 'what', frequency: 62 },
  { word: 'so', frequency: 61 },
  { word: 'up', frequency: 60 },
  { word: 'out', frequency: 59 },
  { word: 'if', frequency: 58 },
  { word: 'about', frequency: 57 },
  { word: 'who', frequency: 56 },
  { word: 'get', frequency: 55 },
  { word: 'which', frequency: 54 },
  { word: 'go', frequency: 53 },
  { word: 'me', frequency: 52 },
  { word: 'when', frequency: 51 },

  // 常用动词
  { word: 'make', frequency: 50 },
  { word: 'can', frequency: 49 },
  { word: 'like', frequency: 48 },
  { word: 'time', frequency: 47 },
  { word: 'no', frequency: 46 },
  { word: 'just', frequency: 45 },
  { word: 'him', frequency: 44 },
  { word: 'know', frequency: 43 },
  { word: 'take', frequency: 42 },
  { word: 'people', frequency: 41 },
  { word: 'into', frequency: 40 },
  { word: 'year', frequency: 39 },
  { word: 'your', frequency: 38 },
  { word: 'good', frequency: 37 },
  { word: 'some', frequency: 36 },
  { word: 'could', frequency: 35 },
  { word: 'them', frequency: 34 },
  { word: 'see', frequency: 33 },
  { word: 'other', frequency: 32 },
  { word: 'than', frequency: 31 },
  { word: 'then', frequency: 30 },
  { word: 'now', frequency: 29 },
  { word: 'look', frequency: 28 },
  { word: 'only', frequency: 27 },
  { word: 'come', frequency: 26 },
  { word: 'its', frequency: 25 },
  { word: 'over', frequency: 24 },
  { word: 'think', frequency: 23 },
  { word: 'also', frequency: 22 },
  { word: 'back', frequency: 21 },
  { word: 'after', frequency: 20 },
  { word: 'use', frequency: 19 },
  { word: 'two', frequency: 18 },
  { word: 'how', frequency: 17 },
  { word: 'our', frequency: 16 },
  { word: 'work', frequency: 15 },
  { word: 'first', frequency: 14 },
  { word: 'well', frequency: 13 },
  { word: 'way', frequency: 12 },
  { word: 'even', frequency: 11 },
  { word: 'new', frequency: 10 },
  { word: 'want', frequency: 9 },
  { word: 'because', frequency: 8 },
  { word: 'any', frequency: 7 },
  { word: 'these', frequency: 6 },
  { word: 'give', frequency: 5 },
  { word: 'day', frequency: 4 },
  { word: 'most', frequency: 3 },
  { word: 'us', frequency: 2 },

  // 编程相关词汇
  { word: 'function', frequency: 50 },
  { word: 'variable', frequency: 49 },
  { word: 'constant', frequency: 48 },
  { word: 'class', frequency: 47 },
  { word: 'interface', frequency: 46 },
  { word: 'object', frequency: 45 },
  { word: 'array', frequency: 44 },
  { word: 'string', frequency: 43 },
  { word: 'number', frequency: 42 },
  { word: 'boolean', frequency: 41 },
  { word: 'import', frequency: 40 },
  { word: 'export', frequency: 39 },
  { word: 'default', frequency: 38 },
  { word: 'return', frequency: 37 },
  { word: 'async', frequency: 36 },
  { word: 'await', frequency: 35 },
  { word: 'promise', frequency: 34 },
  { word: 'callback', frequency: 33 },
  { word: 'parameter', frequency: 32 },
  { word: 'argument', frequency: 31 },
  { word: 'property', frequency: 30 },
  { word: 'method', frequency: 29 },
  { word: 'constructor', frequency: 28 },
  { word: 'instance', frequency: 27 },
  { word: 'prototype', frequency: 26 },
  { word: 'inherit', frequency: 25 },
  { word: 'extend', frequency: 24 },
  { word: 'implement', frequency: 23 },
  { word: 'abstract', frequency: 22 },
  { word: 'static', frequency: 21 },
  { word: 'public', frequency: 20 },
  { word: 'private', frequency: 19 },
  { word: 'protected', frequency: 18 },
  { word: 'readonly', frequency: 17 },
  { word: 'module', frequency: 16 },
  { word: 'package', frequency: 15 },
  { word: 'library', frequency: 14 },
  { word: 'framework', frequency: 13 },
  { word: 'component', frequency: 12 },
  { word: 'element', frequency: 11 },
  { word: 'attribute', frequency: 10 },
  { word: 'value', frequency: 9 },
  { word: 'type', frequency: 8 },
  { word: 'generic', frequency: 7 },
  { word: 'template', frequency: 6 },
  { word: 'iterator', frequency: 5 },
  { word: 'generator', frequency: 4 },
  { word: 'decorator', frequency: 3 },
  { word: 'annotation', frequency: 2 },
  { word: 'configuration', frequency: 1 },
];

// ================================
// 拼写检查提供者类
// ================================

/**
 * 拼写检查提供者
 * 提供单词拼写检查和纠正建议
 */
export class SpellCheckProvider extends BaseProvider {
  readonly name = 'spell-check';
  readonly type: CompletionSourceType = 'spell';

  /** 词典配置 */
  private config: DictionaryConfig;

  /** 主词典 */
  private dictionary: Map<string, DictionaryEntry>;

  /** 用户自定义词典 */
  private userDictionary: Set<string>;

  /** 忽略的单词 */
  private ignoredWords: Set<string>;

  /** 缓存的检查结果 */
  private cache: Map<string, SpellCheckResult>;

  /** 缓存大小限制 */
  private readonly maxCacheSize = 1000;

  constructor(config?: Partial<DictionaryConfig>) {
    super(40);

    this.config = {
      language: 'en',
      name: 'English',
      maxEditDistance: 2,
      maxSuggestions: 5,
      ...config,
    };

    this.dictionary = new Map();
    this.userDictionary = new Set();
    this.ignoredWords = new Set();
    this.cache = new Map();

    // 初始化默认词典
    this.loadDefaultDictionary();
  }

  /**
   * 加载默认词典
   */
  private loadDefaultDictionary(): void {
    for (const entry of ENGLISH_COMMON_WORDS) {
      this.dictionary.set(entry.word.toLowerCase(), entry);
    }
  }

  /**
   * 获取补全项（拼写建议）
   */
  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query, textBefore } = context;

    // 提取当前正在输入的单词
    const wordMatch = textBefore.match(/[a-zA-Z]+$/);
    if (!wordMatch) {
      return [];
    }

    const word = wordMatch[0];

    // 检查拼写
    const result = this.checkSpelling(word);

    // 如果拼写正确，不提供建议
    if (result.correct) {
      return [];
    }

    // 将建议转换为补全项
    const items: CompletionItem[] = result.suggestions.map((suggestion, index) => {
      return this.createItem(`spell-${suggestion.word}`, suggestion.word, {
        insertText: suggestion.word,
        detail: `拼写建议 (相似度: ${suggestion.confidence}%)`,
        documentation: `将 "${word}" 替换为 "${suggestion.word}"`,
        priority: 90 - index * 10,
        icon: '✏️',
      });
    });

    return items;
  }

  /**
   * 是否应该激活
   */
  shouldActivate(context: CompletionContext): boolean {
    const { textBefore } = context;

    // 检查是否在输入单词
    const wordMatch = textBefore.match(/[a-zA-Z]{2,}$/);
    if (!wordMatch) {
      return false;
    }

    // 如果在代码块内，不激活
    if (this.isInCodeBlock(context)) {
      return false;
    }

    // 如果在行内代码内，不激活
    if (this.isInInlineCode(context)) {
      return false;
    }

    return true;
  }

  /**
   * 检查单词拼写
   */
  checkSpelling(word: string): SpellCheckResult {
    const wordLower = word.toLowerCase();

    // 检查缓存
    const cached = this.cache.get(wordLower);
    if (cached) {
      return cached;
    }

    // 检查是否在忽略列表
    if (this.ignoredWords.has(wordLower)) {
      const result: SpellCheckResult = {
        correct: true,
        suggestions: [],
        word,
      };
      this.addToCache(wordLower, result);
      return result;
    }

    // 检查是否在用户词典
    if (this.userDictionary.has(wordLower)) {
      const result: SpellCheckResult = {
        correct: true,
        suggestions: [],
        word,
      };
      this.addToCache(wordLower, result);
      return result;
    }

    // 检查是否在主词典
    if (this.dictionary.has(wordLower)) {
      const result: SpellCheckResult = {
        correct: true,
        suggestions: [],
        word,
      };
      this.addToCache(wordLower, result);
      return result;
    }

    // 单词不在词典中，生成建议
    const suggestions = this.generateSuggestions(wordLower);

    const result: SpellCheckResult = {
      correct: false,
      suggestions,
      word,
    };

    this.addToCache(wordLower, result);
    return result;
  }

  /**
   * 生成拼写建议
   */
  private generateSuggestions(word: string): SpellSuggestion[] {
    const suggestions: SpellSuggestion[] = [];

    // 遍历词典查找相似词
    for (const [dictWord, entry] of this.dictionary.entries()) {
      // 快速过滤：长度差异过大的跳过
      const lengthDiff = Math.abs(dictWord.length - word.length);
      if (lengthDiff > this.config.maxEditDistance) {
        continue;
      }

      // 计算编辑距离
      const distance = damerauLevenshteinDistance(word, dictWord);

      // 过滤超过最大编辑距离的词
      if (distance > this.config.maxEditDistance) {
        continue;
      }

      // 计算相似度
      const similarity = damerauSimilarity(word, dictWord);
      const confidence = Math.round(similarity * 100);

      // 综合评分：考虑相似度和词频
      const score = confidence + entry.frequency * 0.1;

      suggestions.push({
        word: dictWord,
        confidence,
        distance,
      });
    }

    // 遍历用户词典
    for (const userWord of this.userDictionary) {
      const lengthDiff = Math.abs(userWord.length - word.length);
      if (lengthDiff > this.config.maxEditDistance) {
        continue;
      }

      const distance = damerauLevenshteinDistance(word, userWord);
      if (distance > this.config.maxEditDistance) {
        continue;
      }

      const similarity = damerauSimilarity(word, userWord);
      const confidence = Math.round(similarity * 100);

      suggestions.push({
        word: userWord,
        confidence,
        distance,
      });
    }

    // 按置信度排序
    suggestions.sort((a, b) => {
      // 首先按编辑距离
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      // 然后按置信度
      return b.confidence - a.confidence;
    });

    // 返回前 N 个建议
    return suggestions.slice(0, this.config.maxSuggestions);
  }

  /**
   * 添加结果到缓存
   */
  private addToCache(word: string, result: SpellCheckResult): void {
    // 如果缓存已满，清理一半
    if (this.cache.size >= this.maxCacheSize) {
      const keys = [...this.cache.keys()];
      const deleteCount = Math.floor(this.maxCacheSize / 2);
      for (let i = 0; i < deleteCount; i++) {
        const key = keys[i];
        if (key) {
          this.cache.delete(key);
        }
      }
    }

    this.cache.set(word, result);
  }

  // ================================
  // 词典管理方法
  // ================================

  /**
   * 添加单词到用户词典
   */
  addToUserDictionary(word: string): void {
    this.userDictionary.add(word.toLowerCase());
    this.cache.delete(word.toLowerCase());
  }

  /**
   * 批量添加单词到用户词典
   */
  addWordsToUserDictionary(words: string[]): void {
    for (const word of words) {
      this.userDictionary.add(word.toLowerCase());
      this.cache.delete(word.toLowerCase());
    }
  }

  /**
   * 从用户词典移除单词
   */
  removeFromUserDictionary(word: string): void {
    this.userDictionary.delete(word.toLowerCase());
    this.cache.delete(word.toLowerCase());
  }

  /**
   * 清空用户词典
   */
  clearUserDictionary(): void {
    this.userDictionary.clear();
    this.cache.clear();
  }

  /**
   * 获取用户词典
   */
  getUserDictionary(): string[] {
    return [...this.userDictionary];
  }

  /**
   * 添加单词到忽略列表
   */
  ignoreWord(word: string): void {
    this.ignoredWords.add(word.toLowerCase());
    this.cache.delete(word.toLowerCase());
  }

  /**
   * 批量忽略单词
   */
  ignoreWords(words: string[]): void {
    for (const word of words) {
      this.ignoredWords.add(word.toLowerCase());
      this.cache.delete(word.toLowerCase());
    }
  }

  /**
   * 取消忽略单词
   */
  unignoreWord(word: string): void {
    this.ignoredWords.delete(word.toLowerCase());
    this.cache.delete(word.toLowerCase());
  }

  /**
   * 获取忽略列表
   */
  getIgnoredWords(): string[] {
    return [...this.ignoredWords];
  }

  /**
   * 清空忽略列表
   */
  clearIgnoredWords(): void {
    this.ignoredWords.clear();
    this.cache.clear();
  }

  /**
   * 添加单词到主词典
   */
  addToDictionary(entry: DictionaryEntry): void {
    this.dictionary.set(entry.word.toLowerCase(), entry);
    this.cache.delete(entry.word.toLowerCase());
  }

  /**
   * 批量添加到主词典
   */
  addWordsToDictionary(entries: DictionaryEntry[]): void {
    for (const entry of entries) {
      this.dictionary.set(entry.word.toLowerCase(), entry);
      this.cache.delete(entry.word.toLowerCase());
    }
  }

  /**
   * 加载外部词典
   * @param words 单词列表
   * @param baseFrequency 基础词频
   */
  loadDictionary(words: string[], baseFrequency: number = 50): void {
    for (const word of words) {
      this.dictionary.set(word.toLowerCase(), {
        word: word.toLowerCase(),
        frequency: baseFrequency,
      });
    }
    this.cache.clear();
  }

  /**
   * 清空主词典
   */
  clearDictionary(): void {
    this.dictionary.clear();
    this.cache.clear();
  }

  /**
   * 重置为默认词典
   */
  resetDictionary(): void {
    this.dictionary.clear();
    this.loadDefaultDictionary();
    this.cache.clear();
  }

  /**
   * 获取词典大小
   */
  getDictionarySize(): number {
    return this.dictionary.size;
  }

  // ================================
  // 配置方法
  // ================================

  /**
   * 更新配置
   */
  updateConfig(config: Partial<DictionaryConfig>): void {
    this.config = { ...this.config, ...config };
    this.cache.clear();
  }

  /**
   * 获取配置
   */
  getConfig(): DictionaryConfig {
    return { ...this.config };
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * 销毁提供者
   */
  dispose(): void {
    this.dictionary.clear();
    this.userDictionary.clear();
    this.ignoredWords.clear();
    this.cache.clear();
  }
}
