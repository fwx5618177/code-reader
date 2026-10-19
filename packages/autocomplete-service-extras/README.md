# @code-reader/autocomplete-service-extras

本包从 [`@code-reader/autocomplete-service`](../autocomplete-service/README.md) 拆出，按需引入。包含以下能力：
- **ProseMirror 补全适配器**：插件、补全面板、键盘导航、事件。
- **补全预设**：注册全部内置提供者的服务，以及 Markdown 编辑器和代码编辑器的 CodeMirror 扩展。

桌面端的 Markdown 编辑器不使用这里的 ProseMirror 适配器，而是用自己的补全插件（`desktop/src/render/lib/editor/prosemirror-autocomplete.ts`）。那个插件支持斜杠菜单、`[[` 双链、结构化插入（表格、公式块），以及按提供者设定的结果上限。Emoji 补全的数据和匹配规则仍来自核心包的 `EmojiProvider`。

## 安装

```bash
pnpm add @code-reader/autocomplete-service @code-reader/autocomplete-service-extras
```

## ProseMirror 集成

```typescript
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createDefaultAutocompleteService, createProseMirrorAdapter } from '@code-reader/autocomplete-service-extras';

const service = await createDefaultAutocompleteService();
const adapter = createProseMirrorAdapter({
  service,
  panelClass: 'my-autocomplete-panel',
  itemClass: 'my-autocomplete-item',
  activeItemClass: 'my-autocomplete-item-active',
  maxHeight: 300,
});

const view = new EditorView(document.getElementById('editor')!, {
  state: EditorState.create({ schema, plugins: [adapter.createPlugin()] }),
});

adapter.addEventListener((event) => {
  // event.type: 'show' | 'hide' | 'select' | 'accept'
});
```

富文本里没有字段跳转，因此接受代码片段时，会用 `snippetPlainText` 去掉占位符，保留默认值。

## 预设

| 函数 | 内容 |
|------|------|
| `createDefaultAutocompleteService(options?)` | 注册 Markdown、Emoji、代码片段三个提供者的服务 |
| `createMarkdownAutocompleteExtension(options?)` | 面向 Markdown 的 CodeMirror 补全扩展（上述三个提供者，常用 Markdown 触发字符） |
| `createCodeAutocompleteExtension(language, options?)` | 指定语言的代码编辑器补全扩展（只有代码片段） |

## 许可证

MIT
