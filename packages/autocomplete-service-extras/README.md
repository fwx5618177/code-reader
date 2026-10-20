# @code-reader/autocomplete-service-extras

本包从 [`@code-reader/autocomplete-service`](../autocomplete-service/README.md) 拆出，按需引入。包含以下能力：
- **ProseMirror 补全插件**：多个提供者按触发符（`/`、`[[`、`:`、`\` 等）或光标前的单词触发；面板随插件状态渲染，支持键盘导航、点击、结构化插入（补全项自带 `apply`）和按提供者设定的结果上限。桌面端 Markdown 编辑器的斜杠菜单、`[[` 双链、Emoji、LaTeX 补全都跑在这个插件上。
- **文本框补全**：同一套提供者接到 `<textarea>` / `<input>` 上（桌面端公式节点的 LaTeX 源码框）。
- **ProseMirror 补全适配器**：把整个 `AutocompleteService` 当作一个提供者接到上述插件，按单词查询，并提供事件。
- **补全预设**：注册全部内置提供者的服务，以及 Markdown 编辑器和代码编辑器的 CodeMirror 扩展。

插件与文本框共用触发位置（`findTriggerPosition`、`resolveQuery`）、收集与排序（`collectCompletions`、`filterAndSortItems`）和面板（`CompletionPanel`）。

## 安装

```bash
pnpm add @code-reader/autocomplete-service @code-reader/autocomplete-service-extras
```

## ProseMirror 补全插件

```typescript
import { EmojiProvider } from '@code-reader/autocomplete-service';
import { createAutocompletePlugin, fromServiceProvider, type EditorCompletionProvider } from '@code-reader/autocomplete-service-extras';

const slash: EditorCompletionProvider = {
  name: 'slash',
  triggerCharacters: ['/'],
  maxResults: Infinity, // 命令全部列出
  shouldActivate: (context) => context.trigger === '/',
  getCompletions: () => [
    // apply 拿到含触发符的文档区间 [from, to)，自行替换成节点
    { id: 'hr', label: '分隔线', insertText: '', type: 'command', apply: (view, from, to) => { /* … */ } },
  ],
};

const plugin = createAutocompletePlugin({
  providers: [slash, fromServiceProvider(new EmojiProvider(), { trigger: ':' })],
  maxResults: 10,
  minTriggerLength: 0,
});
```

| 配置 | 说明 |
|------|------|
| `providers` | 提供者：`triggerCharacters`（单字符触发符须在行首或空白后，多字符任意位置）、`triggersAnywhere`（单字符触发符也可紧跟在其他字符后，如 `x+\al`，场合由 `shouldActivate` 判断）、`shouldActivate`、`getCompletions`、`maxResults`、`filtersOwnResults`（自己匹配，插件不再按文本过滤） |
| `wordPattern` | 没有触发符时用光标前匹配的单词作查询（触发符为空串） |
| `maxResults` / `minTriggerLength` / `debounceMs` | 默认 10 / 1 / 100 |
| `activateOnTyping` | 输入时自动打开，默认 true；`Ctrl+空格` 总能手动打开（macOS 上该键常被输入法占用，另有 `Option+反引号`，与 CodeMirror 相同） |
| `classPrefix` | 面板类名前缀，默认 `pm-autocomplete`（`-panel`、`-item`、`-item-active`、`-icon`、`-icon-<类型>`、`-label`、`-detail`） |
| `container` / `iconMap` / `showDetail` / `closeOnBlur` | 面板容器（默认编辑器父节点）、图标映射、是否显示详情、失焦关闭 |
| `onOpen` / `onSelect` / `onClose` | 显示结果、接受补全项、未接受而关闭 |

需要命令式控制（手动打开、上下选择、接受）时用 `new EditorAutocomplete(options)`，它的 `createPlugin()`、`openCompletion(view)`、`moveSelection(view, ±1)`、`acceptCompletion(view)`、`close(view)` 与插件共用状态。

输入后到防抖刷新之前，面板保留上一次的结果（不闪烁），但回车、Tab 交还编辑器，避免按旧位置替换。行内原子节点（图片、公式）在文本里占一个字符，替换区间与文档位置始终对齐。

## 文本框补全

```typescript
import { TextFieldAutocomplete } from '@code-reader/autocomplete-service-extras';

const completion = new TextFieldAutocomplete(textarea, { providers: [latexProvider], container: editorContainer });
// …
completion.detach();
```

上下文按光标所在行计算；接受时用 `setRangeText` 替换并派发 `input` 事件，文本框自己的输入监听（预览、自动伸缩）照常运行。按键监听在捕获阶段：面板打开时方向键、回车、Tab、Esc 先由补全处理，不会触发文本框自己的快捷键（如回车结束编辑）。面板显示在文本框下方，样式类名与 ProseMirror 插件相同。补全项的 `apply`（ProseMirror 结构化插入）不适用，只用 `insertText`。

## ProseMirror 补全适配器

```typescript
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createDefaultAutocompleteService, createProseMirrorAdapter } from '@code-reader/autocomplete-service-extras';

const service = await createDefaultAutocompleteService();
const adapter = createProseMirrorAdapter({ service, classPrefix: 'my-autocomplete' });

const view = new EditorView(document.getElementById('editor')!, {
  state: EditorState.create({ schema, plugins: [adapter.createPlugin()] }),
});

adapter.addEventListener((event) => {
  // event.type: 'show' | 'hide' | 'accept'
});
```

查询是光标前的单词（字母数字、中文、连字符，加上 `triggerCharacters`，默认 `: # @ / .`），整个交给服务匹配。富文本里没有字段跳转，因此接受代码片段时，会用 `snippetPlainText` 去掉占位符，保留默认值。

## 预设

| 函数 | 内容 |
|------|------|
| `createDefaultAutocompleteService(options?)` | 注册 Markdown、Emoji、代码片段三个提供者的服务 |
| `createMarkdownAutocompleteExtension(options?)` | 面向 Markdown 的 CodeMirror 补全扩展（上述三个提供者，常用 Markdown 触发字符） |
| `createCodeAutocompleteExtension(language, options?)` | 指定语言的代码编辑器补全扩展（只有代码片段） |

## 许可证

MIT
