// ================================
// 智能补全模块入口
// 从 @code-reader/autocomplete-service 包重新导出
// 保持向后兼容性
// ================================

// ================================
// 从 @code-reader/autocomplete-service 包重新导出所有内容
// ================================

export {
  // 核心类型
  type CompletionSourceType,
  type CompletionItem,
  type CompletionContext,
  type CursorPosition,
  type CompletionProvider,
  type CompletionResult,
  type AutocompleteServiceOptions,
  type CacheEntry,
  type ServiceStats,
  type SpellCheckResult,
  type SpellSuggestion,
  type DictionaryConfig,
  type BaseAdapterOptions,
  type IconMap,
  type CompletionEventType,
  type CompletionEvent,
  type CompletionEventListener,
  DEFAULT_ICON_MAP,

  // 服务
  AutocompleteService,
  createAutocompleteService,

  // 提供者
  BaseProvider,
  MarkdownProvider,
  EmojiProvider,
  SnippetProvider,
  SpellCheckProvider,
  createDefaultProviders,
  createMarkdownProviders,
  createCodeProviders,

  // CodeMirror 适配器
  CodeMirrorAdapter,
  createCodeMirrorAdapter,
  createCodeMirrorExtension,
  createMarkdownCompletionSource,
  createEmojiCompletionSource,
  createSnippetCompletionSource,
  createSpellCheckCompletionSource,
  createMixedCompletionExtension,
  type CodeMirrorAdapterOptions,

  // ProseMirror 适配器
  ProseMirrorAdapter,
  createProseMirrorAdapter,
  createProseMirrorPlugin,
  type ProseMirrorAdapterOptions,

  // 便捷工厂函数
  createDefaultAutocompleteService,
  createSpellCheckAutocompleteService,
  createMarkdownAutocompleteExtension,
  createCodeAutocompleteExtension,
  createFullAutocompleteExtension,
} from '@code-reader/autocomplete-service';

// ================================
// 本地扩展提供者（保持向后兼容）
// ================================

export {
  FilePathProvider,
  DocumentTitleProvider,
  HistoryProvider,
  SymbolProvider,
  PersistentIndexManager,
  createExtendedProviders,
  createPersistentIndexManager,
} from './extended-providers';

export type {
  FilePathInfo,
  DocumentInfo,
  HistoryItem,
  PersistentIndexConfig,
} from './extended-providers';

// ================================
// 兼容性别名
// ================================

// CodeMirrorAutocompleteAdapter 别名（旧名称兼容）
export { CodeMirrorAdapter as CodeMirrorAutocompleteAdapter } from '@code-reader/autocomplete-service';

// 本地 RadixTree（如有特殊需求可使用）
export { RadixTree } from './radix-tree';
export type {
  RadixNode,
  CompletionMeta,
  SearchResult,
  SearchOptions,
  NodeType,
} from './radix-tree';

// ================================
// 本地提供者（补充 @code-reader/autocomplete-service 包）
// ================================

export {
  MarkdownKeywordProvider,
  TagProvider,
  MARKDOWN_KEYWORDS,
  COMMON_EMOJIS,
  CODE_SNIPPETS,
} from './providers';

// ================================
// 本地 codemirror-adapter（补充功能）
// ================================

export {
  createAutocompleteExtension,
  createMixedAutocompleteExtension,
} from './codemirror-adapter';
