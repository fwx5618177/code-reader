// ================================
// 内置词典模块
// 提供从文件加载词典的功能
// 不再硬编码词典数据，改为从 assets/dictionaries 目录加载
// ================================

import { SimpleDictionaryProvider } from './dictionary-manager';
import type { DictionaryEntry, DictionaryMetadata, IDictionaryProvider } from './types';
import {
  parseTxtDictionary,
  createBuiltinDictionaryProvider,
  getBuiltinDictionaryLoader,
  type DictionaryParseOptions,
} from './dictionary-loader';

// ================================
// 常量定义
// ================================

/** 内置词典基础路径 */
export const BUILTIN_DICTIONARIES_BASE_PATH = '/assets/dictionaries';

/** 内置词典配置 */
export interface BuiltinDictionaryConfig {
  /** 词典 ID */
  id: string;
  /** 词典名称 */
  name: string;
  /** 语言代码 */
  language: string;
  /** 文件名 */
  filename: string;
  /** 描述 */
  description: string;
  /** 是否默认启用 */
  defaultEnabled: boolean;
  /** 优先级 */
  priority: number;
}

/** 内置词典列表 */
export const BUILTIN_DICTIONARY_CONFIGS: BuiltinDictionaryConfig[] = [
  {
    id: 'en-common',
    name: 'English Common Words',
    language: 'en',
    filename: 'en-common.txt',
    description: '英语常用词词典，包含约 3000 个高频词汇',
    defaultEnabled: true,
    priority: 100,
  },
];

// ================================
// 工具函数
// ================================

/**
 * 将词列表转换为词典条目
 * @param words 词列表
 * @param baseFrequency 基础词频
 */
export function wordsToEntries(words: string[], baseFrequency = 0.5): DictionaryEntry[] {
  return words.map((word, index) => ({
    word,
    // 根据在列表中的位置分配词频（越靠前词频越高）
    frequency: baseFrequency + (1 - baseFrequency) * (1 - index / words.length),
  }));
}

/**
 * 合并多个词条列表
 * @param entriesArrays 多个词条数组
 */
export function mergeEntries(...entriesArrays: DictionaryEntry[][]): DictionaryEntry[] {
  const merged = new Map<string, DictionaryEntry>();

  for (const entries of entriesArrays) {
    for (const entry of entries) {
      const key = entry.word.toLowerCase();
      const existing = merged.get(key);

      if (!existing || entry.frequency > existing.frequency) {
        merged.set(key, entry);
      }
    }
  }

  return Array.from(merged.values());
}

// ================================
// 词典加载函数
// ================================

/**
 * 获取内置词典配置
 */
export function getBuiltinDictionaryConfig(id: string): BuiltinDictionaryConfig | undefined {
  return BUILTIN_DICTIONARY_CONFIGS.find((c) => c.id === id);
}

/**
 * 获取所有内置词典配置
 */
export function getAllBuiltinDictionaryConfigs(): BuiltinDictionaryConfig[] {
  return [...BUILTIN_DICTIONARY_CONFIGS];
}

/**
 * 创建内置英语词典
 * 使用文件加载器异步加载词典数据
 */
export function createBuiltinEnglishDictionary(
  basePath = BUILTIN_DICTIONARIES_BASE_PATH
): IDictionaryProvider {
  return createBuiltinDictionaryProvider('en-common', basePath);
}

/**
 * 创建编程术语词典
 * 包含常见编程相关词汇
 */
export function createProgrammingDictionary(): IDictionaryProvider {
  const metadata: DictionaryMetadata = {
    id: 'programming',
    name: 'Programming Terms',
    language: 'en',
    version: '1.0.0',
    wordCount: 0,
    description: '编程术语词典',
    source: 'builtin',
  };

  // 编程术语直接内置（数量较少，无需外部文件）
  const entries = wordsToEntries(PROGRAMMING_WORDS, 0.7);

  return new SimpleDictionaryProvider(metadata, entries);
}

/**
 * 加载所有启用的内置词典
 */
export async function loadAllBuiltinDictionaries(
  basePath = BUILTIN_DICTIONARIES_BASE_PATH
): Promise<IDictionaryProvider[]> {
  const providers: IDictionaryProvider[] = [];

  for (const config of BUILTIN_DICTIONARY_CONFIGS) {
    if (config.defaultEnabled) {
      try {
        const provider = createBuiltinDictionaryProvider(config.id as 'en-common', basePath);
        await provider.load();
        providers.push(provider);
      } catch (error) {
        console.error(`[BuiltinDictionaries] 加载词典 "${config.id}" 失败:`, error);
      }
    }
  }

  return providers;
}

// ================================
// 兼容性导出
// 为了兼容旧代码，提供一些常用词列表
// 新代码应该使用文件加载器
// ================================

/** 高频词列表（用于快速初始化或备用） */
export const HIGH_FREQUENCY_WORDS: string[] = [
  // 代词
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  // 冠词
  'a',
  'an',
  'the',
  // 常用动词
  'be',
  'have',
  'do',
  'say',
  'get',
  'make',
  'go',
  'know',
  'take',
  'see',
  'come',
  'think',
  'look',
  'want',
  'give',
  'use',
  'find',
  'tell',
  'ask',
  'work',
  // 常用形容词
  'good',
  'new',
  'first',
  'last',
  'long',
  'great',
  'little',
  'own',
  'other',
  'old',
  // 常用副词
  'not',
  'also',
  'very',
  'just',
  'now',
  'only',
  'then',
  'more',
  'here',
  'there',
];

/** 中高频词列表 */
export const MEDIUM_HIGH_FREQUENCY_WORDS: string[] = [
  // 动词
  'keep',
  'let',
  'begin',
  'seem',
  'help',
  'show',
  'hear',
  'play',
  'run',
  'move',
  'live',
  'believe',
  'hold',
  'bring',
  'happen',
  'write',
  'provide',
  'sit',
  'stand',
  // 名词
  'time',
  'year',
  'people',
  'way',
  'day',
  'man',
  'woman',
  'child',
  'world',
  'life',
  'hand',
  'part',
  'place',
  'case',
  'week',
  'company',
  'system',
  'program',
  'question',
  // 形容词
  'different',
  'small',
  'large',
  'next',
  'early',
  'young',
  'important',
  'few',
  'public',
  'bad',
];

/** 编程术语列表 */
export const PROGRAMMING_WORDS: string[] = [
  // 通用编程
  'algorithm',
  'function',
  'variable',
  'constant',
  'parameter',
  'argument',
  'return',
  'callback',
  'promise',
  'async',
  'await',
  'synchronous',
  'asynchronous',
  // 数据结构
  'array',
  'object',
  'string',
  'number',
  'boolean',
  'null',
  'undefined',
  'map',
  'set',
  'list',
  'queue',
  'stack',
  'tree',
  'graph',
  'hash',
  // 类型和类
  'class',
  'interface',
  'type',
  'enum',
  'struct',
  'generic',
  'template',
  'extends',
  'implements',
  'abstract',
  'static',
  'public',
  'private',
  'protected',
  // 控制流
  'if',
  'else',
  'switch',
  'case',
  'for',
  'while',
  'loop',
  'break',
  'continue',
  // 错误处理
  'try',
  'catch',
  'throw',
  'error',
  'exception',
  'finally',
  // 模块化
  'import',
  'export',
  'module',
  'require',
  'package',
  'library',
  'framework',
  // 常用缩写
  'api',
  'url',
  'html',
  'css',
  'json',
  'xml',
  'sql',
  'http',
  'https',
  // 工具和环境
  'npm',
  'yarn',
  'pnpm',
  'node',
  'react',
  'vue',
  'angular',
  'typescript',
  // 数据库
  'database',
  'query',
  'schema',
  'index',
  'table',
  'column',
  'row',
  // 网络
  'request',
  'response',
  'server',
  'client',
  'socket',
  'websocket',
  // Git
  'git',
  'commit',
  'branch',
  'merge',
  'pull',
  'push',
  'clone',
  'repository',
];

// ================================
// 导出
// ================================

export default {
  // 配置
  BUILTIN_DICTIONARIES_BASE_PATH,
  BUILTIN_DICTIONARY_CONFIGS,
  // 工厂函数
  createBuiltinEnglishDictionary,
  createProgrammingDictionary,
  // 加载函数
  loadAllBuiltinDictionaries,
  getBuiltinDictionaryConfig,
  getAllBuiltinDictionaryConfigs,
  // 工具函数
  wordsToEntries,
  mergeEntries,
  // 兼容性词列表
  HIGH_FREQUENCY_WORDS,
  MEDIUM_HIGH_FREQUENCY_WORDS,
  PROGRAMMING_WORDS,
};
