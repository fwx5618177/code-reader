// ================================
// @code-reader/autocomplete-service
// 编辑器适配器模块入口
// ================================

// ================================
// CodeMirror 适配器
// ================================

export {
  CodeMirrorAdapter,
  createCodeMirrorAdapter,
  createCodeMirrorExtension,
  createMarkdownCompletionSource,
  createEmojiCompletionSource,
  createSnippetCompletionSource,
  createMixedCompletionExtension,
  toCodeMirrorSnippet,
} from './codemirror-adapter';

export type { CodeMirrorAdapterOptions } from './codemirror-adapter';
