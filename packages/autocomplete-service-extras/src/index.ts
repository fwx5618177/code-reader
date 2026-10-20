// ================================
// @code-reader/autocomplete-service-extras
// 编辑器补全：ProseMirror 补全插件与适配器、文本框补全、CodeMirror 补全预设。
// 补全服务、提供者与 CodeMirror 适配器在 @code-reader/autocomplete-service
// ================================

export {
  findTriggerPosition,
  filterAndSortItems,
  isOpenCompletionShortcut,
  collectTriggers,
  resolveQuery,
  collectCompletions,
  snippetPlainText,
  fromServiceItem,
  fromServiceProvider,
  toServiceContext,
  EDITOR_ICON_MAP,
  type EditorCompletionItem,
  type EditorCompletionContext,
  type EditorCompletionProvider,
  type CompletionSourceOptions,
} from './editor-completion';

export { CompletionPanel, type CompletionPanelOptions } from './completion-panel';

export {
  EditorAutocomplete,
  createAutocompletePlugin,
  AUTOCOMPLETE_PLUGIN_KEY,
  type AutocompleteState,
  type AutocompletePluginOptions,
} from './prosemirror-plugin';

export { TextFieldAutocomplete, type TextFieldAutocompleteOptions } from './text-field-autocomplete';

export {
  ProseMirrorAdapter,
  createProseMirrorAdapter,
  createProseMirrorPlugin,
  type ProseMirrorAdapterOptions,
} from './prosemirror-adapter';

export {
  createDefaultAutocompleteService,
  createMarkdownAutocompleteExtension,
  createCodeAutocompleteExtension,
} from './codemirror-presets';
