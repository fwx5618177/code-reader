// ================================
// @code-reader/autocomplete-service-extras
// 补全预设：注册了全部内置提供者的服务、Markdown 编辑器（Markdown 语法、Emoji、代码片段）与指定语言的代码编辑器（代码片段）的 CodeMirror 扩展
// ================================

import type { Extension } from '@codemirror/state';
import {
  AutocompleteService,
  CodeMirrorAdapter,
  SnippetProvider,
  createDefaultProviders,
  type AutocompleteServiceOptions,
  type CodeMirrorAdapterOptions,
} from '@code-reader/autocomplete-service';

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
