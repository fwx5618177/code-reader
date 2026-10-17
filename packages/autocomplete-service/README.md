# @code-reader/autocomplete-service

智能补全系统 - 提供通用的自动补全服务、提供者和编辑器适配器。

## 特性

- 🚀 **高性能** - 基于 Radix Tree 的快速前缀匹配和模糊搜索
- 🔌 **可扩展** - 插件化的提供者架构，易于扩展
- 🎯 **多编辑器支持** - 内置 CodeMirror 和 ProseMirror 适配器
- 📝 **丰富的内置提供者** - Markdown、Emoji、代码片段
- 🎨 **可定制** - 灵活的配置选项和样式定制
- 📦 **TypeScript 优先** - 完整的类型定义

## 安装

```bash
pnpm add @code-reader/autocomplete-service
```

## 快速开始

### 基础用法

```typescript
import {
  AutocompleteService,
  createDefaultProviders,
} from '@code-reader/autocomplete-service';

// 创建补全服务
const service = new AutocompleteService({
  maxResults: 50,
  fuzzy: true,
});

// 注册内置提供者
const providers = createDefaultProviders();
for (const provider of providers) {
  service.registerProvider(provider);
}

// 初始化服务
await service.initialize();

// 获取补全结果
const result = await service.getCompletions({
  query: 'hel',
  position: { line: 1, column: 5 },
  lineText: 'hel',
  textBefore: 'hel',
  textAfter: '',
});

console.log(result.items); // 补全项列表
```

### 使用便捷工厂函数

```typescript
import { createDefaultAutocompleteService } from '@code-reader/autocomplete-service';

// 创建带有默认提供者的服务
const service = await createDefaultAutocompleteService();
```

## CodeMirror 集成

### 基础集成

```typescript
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  CodeMirrorAdapter,
  createDefaultAutocompleteService,
} from '@code-reader/autocomplete-service';

// 创建服务
const service = await createDefaultAutocompleteService();

// 创建适配器
const adapter = new CodeMirrorAdapter({
  service,
  fuzzy: true,
  maxResults: 30,
  activateOnTyping: true,
  triggerCharacters: [':', '.', '/'],
});

// 创建编辑器
const view = new EditorView({
  state: EditorState.create({
    extensions: [
      ...adapter.createFullExtension(),
    ],
  }),
  parent: document.getElementById('editor'),
});
```

### 使用便捷函数

```typescript
import {
  createMarkdownAutocompleteExtension,
  createCodeAutocompleteExtension,
} from '@code-reader/autocomplete-service';

// Markdown 编辑器扩展
const markdownExtensions = await createMarkdownAutocompleteExtension();

// 代码编辑器扩展（指定语言）
const codeExtensions = await createCodeAutocompleteExtension('typescript');
```

## ProseMirror 集成

```typescript
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  ProseMirrorAdapter,
  createDefaultAutocompleteService,
} from '@code-reader/autocomplete-service';

// 创建服务
const service = await createDefaultAutocompleteService();

// 创建适配器
const adapter = new ProseMirrorAdapter({
  service,
  panelClass: 'my-autocomplete-panel',
  itemClass: 'my-autocomplete-item',
  activeItemClass: 'my-autocomplete-item-active',
  maxHeight: 300,
});

// 创建编辑器
const state = EditorState.create({
  plugins: [
    adapter.createPlugin(),
  ],
});

const view = new EditorView(document.getElementById('editor'), {
  state,
});
```

## 内置提供者

### MarkdownProvider

提供 Markdown 语法补全：

```typescript
import { MarkdownProvider } from '@code-reader/autocomplete-service';

const provider = new MarkdownProvider();
service.registerProvider(provider);
```

支持的补全类型：
- 标题 (`#`, `##`, `###` 等)
- 列表 (`-`, `*`, `1.`)
- 任务列表 (`- [ ]`, `- [x]`)
- 格式化 (`**粗体**`, `*斜体*`, `` `代码` ``)
- 链接和图片
- 代码块
- 引用
- 表格

### EmojiProvider

提供 Emoji 补全（`:emoji:` 语法）：

```typescript
import { EmojiProvider } from '@code-reader/autocomplete-service';

const provider = new EmojiProvider();
service.registerProvider(provider);

// 输入 `:smile` 触发 Emoji 补全
```

### SnippetProvider

提供多语言代码片段补全：

```typescript
import { SnippetProvider } from '@code-reader/autocomplete-service';

const provider = new SnippetProvider();
provider.setLanguage('typescript');
service.registerProvider(provider);
```

支持的语言：
- JavaScript / TypeScript
- React (JSX/TSX)
- Python
- Rust
- Go

## 自定义提供者

创建自定义补全提供者：

```typescript
import {
  BaseProvider,
  type CompletionContext,
  type CompletionItem,
  type CompletionSourceType,
} from '@code-reader/autocomplete-service';

class MyCustomProvider extends BaseProvider {
  readonly name = 'my-custom';
  readonly type: CompletionSourceType = 'custom';

  constructor() {
    super(60, ['@']); // 优先级 60，触发字符 @
  }

  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query } = context;

    // 返回补全项
    return [
      this.createItem('item-1', '@user', {
        insertText: '@username',
        detail: '提及用户',
        documentation: '在文档中提及用户',
        priority: 80,
        icon: '👤',
      }),
    ];
  }

  shouldActivate(context: CompletionContext): boolean {
    // 自定义激活条件
    return context.textBefore.includes('@');
  }
}

// 注册提供者
service.registerProvider(new MyCustomProvider());
```

## 配置选项

### AutocompleteServiceOptions

```typescript
interface AutocompleteServiceOptions {
  /** 最大返回结果数 */
  maxResults?: number; // 默认 50

  /** 是否启用模糊匹配 */
  fuzzy?: boolean; // 默认 true

  /** 模糊匹配的最大编辑距离 */
  maxEditDistance?: number; // 默认 2

  /** 是否区分大小写 */
  caseSensitive?: boolean; // 默认 false

  /** 最小触发长度 */
  minTriggerLength?: number; // 默认 1

  /** 防抖延迟（毫秒） */
  debounceMs?: number; // 默认 100

  /** 是否缓存结果 */
  cacheEnabled?: boolean; // 默认 true

  /** 缓存过期时间（毫秒） */
  cacheTTL?: number; // 默认 30000
}
```

### CodeMirrorAdapterOptions

```typescript
interface CodeMirrorAdapterOptions {
  /** AutocompleteService 实例 */
  service?: AutocompleteService;

  /** 是否启用模糊匹配 */
  fuzzy?: boolean;

  /** 最大结果数 */
  maxResults?: number;

  /** 触发补全的最小字符数 */
  minTriggerLength?: number;

  /** 防抖延迟（毫秒） */
  debounceMs?: number;

  /** 是否在输入时自动触发 */
  activateOnTyping?: boolean;

  /** 触发字符列表 */
  triggerCharacters?: string[];

  /** 当前语言 */
  language?: string;

  /** 是否显示补全详情 */
  showDetail?: boolean;

  /** 是否显示补全文档 */
  showDocumentation?: boolean;
}
```

### ProseMirrorAdapterOptions

```typescript
interface ProseMirrorAdapterOptions {
  /** AutocompleteService 实例 */
  service?: AutocompleteService;

  /** 补全面板的 CSS 类名 */
  panelClass?: string;

  /** 补全项的 CSS 类名 */
  itemClass?: string;

  /** 激活项的 CSS 类名 */
  activeItemClass?: string;

  /** 补全面板最大高度 */
  maxHeight?: number;

  /** 是否在编辑器失焦时关闭补全 */
  closeOnBlur?: boolean;
}
```

## 事件监听

```typescript
const adapter = new ProseMirrorAdapter({ service });

// 添加事件监听
adapter.addEventListener((event) => {
  switch (event.type) {
    case 'show':
      console.log('补全面板显示');
      break;
    case 'hide':
      console.log('补全面板隐藏');
      break;
    case 'accept':
      console.log('接受补全:', event.item);
      break;
    case 'select':
      console.log('选择补全项:', event.item);
      break;
  }
});
```

## API 参考

### AutocompleteService

| 方法 | 描述 |
|------|------|
| `registerProvider(provider)` | 注册补全提供者 |
| `unregisterProvider(name)` | 注销补全提供者 |
| `getProviders()` | 获取所有注册的提供者 |
| `getCompletions(context)` | 获取补全结果 |
| `addItem(item)` | 添加补全项到索引 |
| `removeItem(filterText)` | 从索引移除补全项 |
| `clear()` | 清空所有补全项 |
| `initialize()` | 初始化服务 |
| `destroy()` | 销毁服务 |
| `getStats()` | 获取统计信息 |

### CodeMirrorAdapter

| 方法 | 描述 |
|------|------|
| `getService()` | 获取服务实例 |
| `setLanguage(language)` | 设置当前语言 |
| `createExtension()` | 创建 CodeMirror 扩展 |
| `createKeymap()` | 创建快捷键绑定 |
| `createFullExtension()` | 创建完整扩展配置 |
| `destroy()` | 销毁适配器 |

### ProseMirrorAdapter

| 方法 | 描述 |
|------|------|
| `getService()` | 获取服务实例 |
| `getPluginKey()` | 获取插件 Key |
| `setLanguage(language)` | 设置当前语言 |
| `createPlugin()` | 创建 ProseMirror 插件 |
| `addEventListener(listener)` | 添加事件监听器 |
| `removeEventListener(listener)` | 移除事件监听器 |
| `destroy()` | 销毁适配器 |

## 依赖

- `@code-reader/fuzzy-match-algorithm` - 核心算法库
- `@codemirror/autocomplete` - CodeMirror 补全支持（可选）
- `prosemirror-state` / `prosemirror-view` - ProseMirror 支持（可选）

## 许可证

MIT