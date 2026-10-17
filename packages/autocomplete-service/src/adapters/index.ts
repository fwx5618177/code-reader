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
} from './codemirror-adapter';

export type { CodeMirrorAdapterOptions } from './codemirror-adapter';

// ================================
// ProseMirror 适配器
// ================================

export {
  ProseMirrorAdapter,
  createProseMirrorAdapter,
  createProseMirrorPlugin,
} from './prosemirror-adapter';

export type { ProseMirrorAdapterOptions } from './prosemirror-adapter';
