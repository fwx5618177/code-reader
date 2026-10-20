# @code-reader/autocomplete-service

通用补全服务，包含三部分：
- **补全服务**：提供者按每次查询的上下文实时查询；静态词表用 Radix Tree 做前缀和模糊检索；结果按上下文缓存。
- **内置提供者**：Markdown 语法、Emoji、多语言代码片段。
- **CodeMirror 适配器**：代码片段按 CodeMirror snippet 插入，可用 Tab 在字段间跳转。

桌面端的用法：
- **代码块补全**：`desktop/src/render/components/RichEditor/CodeBlockView.ts` 使用补全服务、`createCodeProviders`（只注册代码片段）和 `CodeMirrorAdapter`，片段按当前代码块的语言过滤。
- **Markdown 编辑器的 `:emoji` 补全**：`RichEditor` 用 extras 包的 `fromServiceProvider(new EmojiProvider(), { trigger: ':' })` 把这里的 `EmojiProvider` 接到 ProseMirror 补全插件上。短代码、别名和中文描述都能匹配，例如 `:smile`、`:+1`、`:微笑`。

ProseMirror 补全插件与适配器、几个预设工厂（`createDefaultAutocompleteService`、Markdown 与代码编辑器的 CodeMirror 扩展）在 [`@code-reader/autocomplete-service-extras`](../autocomplete-service-extras/README.md)。

## 安装

```bash
pnpm add @code-reader/autocomplete-service
```

## 补全服务

```typescript
import { createAutocompleteService, createCodeProviders } from '@code-reader/autocomplete-service';

const service = createAutocompleteService({ maxResults: 50, fuzzy: true });
for (const provider of createCodeProviders()) service.registerProvider(provider);

// 宿主自己的静态词表（如文档中出现过的词）放进 Radix Tree，支持前缀与模糊检索
service.addItems([{ id: 'w1', label: 'algorithm', type: 'text' }]);

const result = await service.getCompletions({
  query: 'def',
  language: 'python', // 片段按语言过滤
  position: { line: 1, column: 4 },
  lineText: 'def',
  textBefore: 'def',
  textAfter: '',
});
result.items; // 合并静态词表与提供者结果，按精确 > 前缀 > 优先级排序
result.isIncomplete; // 结果超过 maxResults 被截断时为 true
```

行为约定：
- **提供者不做预加载。** 每次查询都把语言、触发字符和光标前文本交给提供者，这样 Python 代码块里不会出现 JavaScript 片段，代码里也不会出现 Markdown 标题。`initialize()` 只把服务标记为就绪。
- **缓存键**由语言、触发字符、光标前文本和查询词组成。增删静态补全项或注册、注销提供者时，缓存立即失效。
- **提供者的数据变化后**（例如片段库更新）调用 `refreshProvider(name)`，会丢掉含该提供者结果的缓存。`refreshAllProviders()` 清空全部结果缓存，静态补全项保留。

## 内置提供者

| 提供者 | 触发与匹配 |
|------|------|
| `MarkdownProvider` | 行首、`#`、`-`、`` ` ``、`[`、`$` 等。围栏代码块和行内代码里不提供补全 |
| `EmojiProvider` | `:` 后输入短代码、别名或中文描述，匹配优先级为：精确 > 前缀 > 包含 > 别名 > 描述 > 模糊 |
| `SnippetProvider` | 通用片段，以及 JavaScript、TypeScript、React、Python、Rust、Go 的语言片段。语言别名（`ts`、`py`、`rs` 等）可以匹配 |

工厂函数：
- `createDefaultProviders()`：返回全部三个提供者。
- `createMarkdownProviders()`：返回 Markdown 与 Emoji。
- `createCodeProviders(language?)`：只返回代码片段。

## CodeMirror 集成

```typescript
import { CodeMirrorAdapter } from '@code-reader/autocomplete-service';

const adapter = new CodeMirrorAdapter({ service, language: 'python', triggerCharacters: ['.', ':'] });
const extensions = adapter.createFullExtension(); // 补全扩展与快捷键
adapter.setLanguage('rust'); // 切换语言后按新语言给出片段
```

代码片段使用 VS Code 风格的模板（`$1`、`${1:默认值}`、`${1|a,b|}`、`$0`），由 `toCodeMirrorSnippet` 转成 CodeMirror 的 snippet 语法后插入，可用 Tab 在字段间跳转，`$0` 是最后一个字段。

只需要某一类补全源时，可以用 `createMarkdownCompletionSource`、`createEmojiCompletionSource`、`createSnippetCompletionSource` 或 `createMixedCompletionExtension`。

## 自定义提供者

```typescript
import { BaseProvider, type CompletionContext, type CompletionItem, type CompletionSourceType } from '@code-reader/autocomplete-service';

class MentionProvider extends BaseProvider {
  readonly name = 'mention';
  readonly type: CompletionSourceType = 'custom';

  constructor() {
    super(60, ['@']); // 优先级 60，触发字符 @
  }

  getCompletions(context: CompletionContext): CompletionItem[] {
    return [this.createItem('u1', '@alice', { insertText: '@alice', detail: '提及用户' })];
  }
}

service.registerProvider(new MentionProvider());
```

## 许可证

MIT
