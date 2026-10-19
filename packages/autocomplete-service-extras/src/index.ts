// ================================
// @code-reader/autocomplete-service-extras
// ProseMirror 补全适配器与 CodeMirror 补全预设。补全服务、提供者与 CodeMirror 适配器在 @code-reader/autocomplete-service
// ================================

export {
  ProseMirrorAdapter,
  createProseMirrorAdapter,
  createProseMirrorPlugin,
  snippetPlainText,
  type ProseMirrorAdapterOptions,
} from './prosemirror-adapter';

export {
  createDefaultAutocompleteService,
  createMarkdownAutocompleteExtension,
  createCodeAutocompleteExtension,
} from './codemirror-presets';
