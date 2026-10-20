// ================================
// @code-reader/autocomplete-service
// 智能补全系统 - 主入口文件
// 提供通用的自动补全服务、提供者和 CodeMirror 适配器；ProseMirror 适配器在 @code-reader/autocomplete-service-extras
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
  createMixedCompletionExtension,
  toCodeMirrorSnippet,
} from './adapters';

export type { CodeMirrorAdapterOptions } from './adapters';
