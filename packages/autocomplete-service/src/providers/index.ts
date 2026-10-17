// ================================
// @code-reader/autocomplete-service
// 提供者模块入口
// ================================

export { BaseProvider } from './base-provider';
export { MarkdownProvider } from './markdown-provider';
export { EmojiProvider } from './emoji-provider';
export { SnippetProvider } from './snippet-provider';

// ================================
// 工厂函数
// ================================

import type { CompletionProvider } from '../types';
import { MarkdownProvider } from './markdown-provider';
import { EmojiProvider } from './emoji-provider';
import { SnippetProvider } from './snippet-provider';

/**
 * 创建默认的补全提供者集合
 * 包含 Markdown、Emoji、代码片段等基础提供者
 */
export function createDefaultProviders(): CompletionProvider[] {
  return [
    new MarkdownProvider(),
    new EmojiProvider(),
    new SnippetProvider(),
  ];
}

/**
 * 创建 Markdown 编辑器专用的提供者集合
 */
export function createMarkdownProviders(): CompletionProvider[] {
  return [
    new MarkdownProvider(),
    new EmojiProvider(),
  ];
}

/**
 * 创建代码编辑器专用的提供者集合
 * @param language 编程语言
 */
export function createCodeProviders(language?: string): CompletionProvider[] {
  const snippetProvider = new SnippetProvider();
  if (language) {
    snippetProvider.setLanguage(language);
  }
  return [snippetProvider];
}
