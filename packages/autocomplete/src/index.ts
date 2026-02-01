// ================================
// @code-reader/autocomplete
// 智能补全系统 - 主入口文件
// 提供通用的自动补全服务、提供者和编辑器适配器
// ================================

// ================================
// 核心类型导出
// ================================

export type {
  // 补全源类型
  CompletionSourceType,
  // 补全项
  CompletionItem,
  // 补全上下文
  CompletionContext,
  CursorPosition,
  // 补全提供者
  CompletionProvider,
  // 补全结果
  CompletionResult,
  // 服务配置
  AutocompleteServiceOptions,
  CacheEntry,
  ServiceStats,
  // 拼写检查
  SpellCheckResult,
  SpellSuggestion,
  DictionaryConfig,
  // 适配器配置
  BaseAdapterOptions,
  IconMap,
  // 事件
  CompletionEventType,
  CompletionEvent,
  CompletionEventListener,
} from './types';

export { DEFAULT_ICON_MAP } from './types';

// ================================
// 服务模块
// ================================

export { AutocompleteService, createAutocompleteService } from './service';

// ================================
// 提供者模块
// ================================

export {
  // 基础提供者
  BaseProvider,
  // 内置提供者
  MarkdownProvider,
  EmojiProvider,
  SnippetProvider,
  SpellCheckProvider,
  // 工厂函数
  createDefaultProviders,
  createMarkdownProviders,
  createCodeProviders,
} from './providers';

// ================================
// 编辑器适配器模块
// ================================

export {
  // CodeMirror 适配器
  CodeMirrorAdapter,
  createCodeMirrorAdapter,
  createCodeMirrorExtension,
  createMarkdownCompletionSource,
  createEmojiCompletionSource,
  createSnippetCompletionSource,
  createSpellCheckCompletionSource,
  createMixedCompletionExtension,
  // ProseMirror 适配器
  ProseMirrorAdapter,
  createProseMirrorAdapter,
  createProseMirrorPlugin,
} from './adapters';

export type { CodeMirrorAdapterOptions, ProseMirrorAdapterOptions } from './adapters';

// ================================
// 拼写检查模块
// ================================

export {
  // 词典管理器
  DictionaryManager,
  createDictionaryManager,

  // 词典提供者
  SimpleDictionaryProvider,
  createSimpleDictionaryProvider,

  // 用户词典
  UserDictionary,

  // 忽略列表
  IgnoreList,

  // 内置词典
  createBuiltinEnglishDictionary,
  createProgrammingDictionary,

  // 工具函数
  wordsToEntries,
  mergeEntries,

  // 默认配置
  DEFAULT_DICTIONARY_MANAGER_CONFIG,
} from './spell-check';

export type {
  // 词典类型
  DictionaryEntry,
  DictionaryMetadata,
  IDictionaryProvider,
  DictionarySourceType,
  DictionarySourceConfig,
  DictionaryManagerConfig,

  // 事件
  DictionaryEvent,
  DictionaryEventType,
  DictionaryEventListener,

  // 用户词典
  UserDictionaryEntry,
  UserDictionaryConfig,
} from './spell-check';

// ================================
// 便捷工厂函数
// ================================

import { AutocompleteService, type AutocompleteServiceOptions } from './service';
import {
  MarkdownProvider,
  EmojiProvider,
  SnippetProvider,
  SpellCheckProvider,
  createDefaultProviders,
} from './providers';
import { CodeMirrorAdapter, type CodeMirrorAdapterOptions } from './adapters';
import type { Extension } from '@codemirror/state';

/**
 * 创建并初始化默认的补全服务
 * 包含 Markdown、Emoji、代码片段等基础提供者
 * @param options 服务配置选项
 */
export async function createDefaultAutocompleteService(
  options?: AutocompleteServiceOptions
): Promise<AutocompleteService> {
  const service = new AutocompleteService(options);

  // 注册默认提供者
  const providers = createDefaultProviders();
  for (const provider of providers) {
    service.registerProvider(provider);
  }

  // 初始化服务
  await service.initialize();

  return service;
}

/**
 * 创建带有拼写检查的补全服务
 * @param options 服务配置选项
 */
export async function createSpellCheckAutocompleteService(
  options?: AutocompleteServiceOptions
): Promise<AutocompleteService> {
  const service = new AutocompleteService(options);

  // 注册默认提供者
  const providers = createDefaultProviders();
  for (const provider of providers) {
    service.registerProvider(provider);
  }

  // 注册拼写检查提供者
  service.registerProvider(new SpellCheckProvider());

  // 初始化服务
  await service.initialize();

  return service;
}

/**
 * 创建 Markdown 编辑器专用的补全扩展
 * @param options 适配器配置选项
 */
export async function createMarkdownAutocompleteExtension(
  options?: Omit<CodeMirrorAdapterOptions, 'service'>
): Promise<Extension[]> {
  // 创建服务
  const service = await createDefaultAutocompleteService();

  // 创建适配器
  const adapter = new CodeMirrorAdapter({
    ...options,
    service,
    triggerCharacters: [':', '#', '@', '/', '*', '_', '[', '!', '`', '>'],
  });

  return adapter.createFullExtension();
}

/**
 * 创建代码编辑器专用的补全扩展
 * @param language 编程语言
 * @param options 适配器配置选项
 */
export async function createCodeAutocompleteExtension(
  language: string,
  options?: Omit<CodeMirrorAdapterOptions, 'service' | 'language'>
): Promise<Extension[]> {
  // 创建服务
  const service = new AutocompleteService(options);

  // 注册代码片段提供者
  const snippetProvider = new SnippetProvider();
  snippetProvider.setLanguage(language);
  service.registerProvider(snippetProvider);

  // 初始化服务
  await service.initialize();

  // 创建适配器
  const adapter = new CodeMirrorAdapter({
    ...options,
    service,
    language,
    triggerCharacters: ['.', '/', '<', ':', '@'],
  });

  return adapter.createFullExtension();
}

/**
 * 创建完整功能的补全扩展
 * 包含 Markdown、Emoji、代码片段、拼写检查
 * @param options 适配器配置选项
 */
export async function createFullAutocompleteExtension(
  options?: Omit<CodeMirrorAdapterOptions, 'service'>
): Promise<Extension[]> {
  // 创建服务
  const service = await createSpellCheckAutocompleteService();

  // 创建适配器
  const adapter = new CodeMirrorAdapter({
    ...options,
    service,
    triggerCharacters: [':', '#', '@', '/', '.', '*', '_', '[', '!', '`', '>'],
  });

  return adapter.createFullExtension();
}
