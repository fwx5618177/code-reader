// ================================
// @code-reader/autocomplete-service-extras
// ProseMirror 补全插件与适配器、CodeMirror 补全预设。补全服务、提供者与 CodeMirror 适配器在 @code-reader/autocomplete-service
// ================================

export {
  EditorAutocomplete,
  createAutocompletePlugin,
  AUTOCOMPLETE_PLUGIN_KEY,
  findTriggerPosition,
  filterAndSortItems,
  snippetPlainText,
  fromServiceItem,
  fromServiceProvider,
  toServiceContext,
  type EditorCompletionItem,
  type EditorCompletionContext,
  type EditorCompletionProvider,
  type AutocompleteState,
  type AutocompletePluginOptions,
} from './prosemirror-plugin';

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
