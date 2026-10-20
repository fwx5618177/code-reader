# @code-reader/markdown-parser

零依赖的 Markdown 解析库，桌面端编辑器用它替代了 markdown-it。包含：

- **CommonMark / GFM 解析器**：输出语法树，块级与行内节点都带源码中的绝对位置（偏移、行、列）。CommonMark 0.31.2 规范 652 个用例全部通过。
- **markdown-it 兼容的 token 流**：`MarkdownItCompatTokenizer` 输出与 markdown-it 结构相同的 token，可以直接交给 prosemirror-markdown 等工具；规范用例 652/652 与 markdown-it 逐 token 一致。
- **常用扩展语法**：GFM 扩展自动链接、脚注、定义列表、自定义容器、高亮 / 插入 / 上下标、缩写、YAML 头部、排版替换、`{…}` 属性。token 与 markdown-it 对应插件逐个比较一致。
- **语法扩展接口**：行内扩展（触发字符 + 匹配函数）与块级扩展（开始行 + 续行），用于公式、双向链接等自定义语法。
- **HTML 渲染器**：输出与 commonmark.js 一致；默认拒绝不安全链接；支持代码高亮、扩展节点的自定义渲染。
- **语法树级增量解析**：编辑后只重新解析受影响的顶层块，结果与整篇解析逐节点相同。
- **逐行 token 增量解析**：面向超大文件与流式输入（与上面的语法树不是同一模型）。

路线与取舍见 [`docs/FORMAT_PARSER_RESEARCH.md`](../../docs/FORMAT_PARSER_RESEARCH.md)。

## 现状

| 项目 | 情况 |
|------|------|
| CommonMark 0.31.2 规范 | **652/652**，`__tests__/commonmark-spec.test.ts` 逐字比较 HTML，下限 652 |
| 与 markdown-it 的 token 一致性 | 规范用例 **652/652**；脚注、定义列表、容器、高亮 / 插入 / 上下标、缩写、YAML 头部、排版替换与对应的 markdown-it 插件逐 token 一致（`markdown-it-tokens.test.ts`、`markdown-it-plugins.test.ts`），插件语法的 HTML 与 markdown-it 渲染结果逐字一致 |
| GFM 扩展自动链接 | 按 GFM 规范（不是 linkify-it）：规范中的扩展自动链接用例全部通过 |
| 增量解析 | 12 万次随机编辑（40 组文档 × 1500 次 × 2 种选项）与整篇解析逐节点相同，约 87% 只重新解析附近的块；提交的测试每次运行 3000 次 |
| 性能（0.91M 字符，Node 24） | 语法树 83ms；语法树加 token 126ms；markdown-it 74ms |
| 健壮性 | 4 万次随机输入（含全部扩展语法）不抛错，单次不超过 50ms |

## 解析与渲染

```typescript
import { parseCommonMark, renderHtml, BlockType } from '@code-reader/markdown-parser';

const { document, references } = parseCommonMark('# 标题\n\n**粗体** 与 [链接][ref]\n\n[ref]: https://example.com "标题"\n');

document.children![0].type === BlockType.Heading; // true
document.children![1].inline; // 行内节点，每个都有 position: { start, end, startLine, startColumn, endLine, endColumn }
references.get('REF'); // { url: 'https://example.com', title: '标题' }

renderHtml(document);
// <h1>标题</h1>
// <p><strong>粗体</strong> 与 <a href="https://example.com" title="标题">链接</a></p>
```

解析结果：`document`（语法树）、`warnings`、`references`（链接引用定义，标签已规范化）、`abbreviations`（缩写定义）、`duration`。

### 解析选项

| 选项 | 默认值 | 说明 |
|------|------|------|
| `gfm` | `true` | 表格、任务列表项、脚注 |
| `taskLists` / `footnotes` | 同 `gfm` | 单独开关任务列表项、脚注（`[^id]`、`^[行内脚注]`，按第一次引用编号，未定义的 `[^x]` 是文本） |
| `strikethrough` | `true` | `~~删除线~~` |
| `singleTildeStrikethrough` | `true` | 单个 `~` 也是删除线（GFM）；`false` 时与 markdown-it 一样只认 `~~` |
| `html` | `true` | 识别 HTML 块与行内 HTML，关闭时按文本处理 |
| `autolink` | `true` | 尖括号自动链接 `<https://…>`、`<a@b.c>` |
| `linkify` | `false` | 裸写的 `www.…`、`http(s)://…`、`mailto:`、邮箱（GFM 扩展自动链接，处理末尾标点与括号） |
| `smartPunctuation` | `false` | 弯引号、`--` / `---` 连接号与破折号、`...` 省略号（commonmark.js 规则） |
| `replacements` | `false` | `(c)` `(r)` `(tm)` `+-` `..` `?....` `!!!!!` `,,` `--` `---`（markdown-it 的 replacements） |
| `hardBreaks` | `false` | 段落内的普通换行也输出 `<br />` |
| `mark` / `insert` | `false` | `==高亮==` / `++插入++` |
| `subscript` / `superscript` | `false` | `H~2~O` / `2^10^`（内容不能有空白；开启下标后单个 `~` 不再是删除线） |
| `abbreviations` | `false` | `*[HTML]: Hyper Text Markup Language` 定义后，正文中的整词 HTML 成为缩写 |
| `definitionLists` | `false` | 术语一行，下一行（或隔一个空行）以 `:` 或 `~` 开头的说明 |
| `containers` | `false` | `::: 名称 参数` … `:::`；`true` 接受任意名称，数组只接受其中的名称 |
| `frontMatter` | `false` | 文档开头 `---` 与 `---` / `...` 之间的 YAML（必须闭合，未闭合按普通内容） |
| `attributes` | `false` | 标题、段落末尾与链接 / 图片 / 代码 / 强调之后的 `{#id .class key=value}` |
| `maxNestingDepth` | `100` | 引用、列表、脚注、容器的最大嵌套层数，超过时其余部分按文本处理并给出警告 |
| `inlineExtensions` / `blockExtensions` | `[]` | 语法扩展，见下文 |

### HTML 渲染选项

```typescript
renderHtml(document, {
  xhtmlOut: true, // <br /> 还是 <br>
  langPrefix: 'language-', // 代码块 class 前缀
  highlight: (code, language, info) => highlighted, // 返回以 <pre 开头的字符串时整体替换代码块；返回空值按默认转义
  validateLink: (url) => boolean, // 默认 isSafeUrl：拒绝 javascript: vbscript: file: 与非图片的 data:，不安全时地址输出为空
  extensions: { math: (node, { escapeHtml, renderInline }) => html }, // 扩展节点按名称渲染；未提供时输出带 data-extension 的 span / div
});
```

被引用的脚注按 markdown-it-footnote 的结构输出在文末（带回链）；YAML 头部不输出。

## 语法扩展

```typescript
import { MarkdownItCompatTokenizer, type InlineExtension, type BlockExtension } from '@code-reader/markdown-parser';

// 行内：在触发字符处先于内置语法尝试，匹配的文本整体成为一个节点，内部不再解析
const math: InlineExtension = {
  name: 'math_inline',
  trigger: '$',
  match(text, pos) {
    const end = text.indexOf('$', pos + 1);
    return end > pos + 1 ? { length: end - pos + 1, content: text.slice(pos + 1, end) } : null;
  },
};

// 块级：叶子块，可以跨行、可以在引用与列表里；interruptsParagraph 决定能否打断段落
const mathBlock: BlockExtension = {
  name: 'math_block',
  trigger: '$$',
  interruptsParagraph: true,
  open: (line) => ({ closed: false }),
  next: (line) => (line.trim() === '$$' ? { closed: true } : { content: line, closed: false }),
};

const tokens = new MarkdownItCompatTokenizer({ inlineExtensions: [math], blockExtensions: [mathBlock] }).parse(source);
// 扩展 token 的 type 为扩展名，content 为内容，meta 为扩展返回的 data
```

桌面端的公式（`$…$`、`$$…$$`）、双向链接（`[[…]]`）与块级嵌入（`![[…]]`）都是用这两个接口实现的（`packages/desktop/src/render/lib/markdown/syntax-extensions.ts`）。

## markdown-it 兼容的 token 流

```typescript
import { MarkdownParser } from 'prosemirror-markdown';
import { MarkdownItCompatTokenizer } from '@code-reader/markdown-parser';

const tokenizer = new MarkdownItCompatTokenizer({ html: false, singleTildeStrikethrough: false });
const parser = new MarkdownParser(schema, tokenizer as never, tokenSpecs);
```

与 markdown-it 相同的字段：`type`、`tag`、`nesting`、`level`、`map`、`content`、`markup`、`info`、`attrs`、`meta`、`children`、`hidden`。多出的 `position` 是 token 在源码中的绝对位置（行内 token 也有）。只想要 token 时也可以对已有语法树调用 `toMarkdownItTokens(source, document)`。

## 语法树级增量解析

```typescript
import { IncrementalCommonMarkParser } from '@code-reader/markdown-parser';

const parser = new IncrementalCommonMarkParser(options);
parser.parse(text);

const update = parser.update(newText); // 传入完整的新文本
update.result; // 与 parseCommonMark(newText, options) 逐节点相同
update.reparsedLines; // 重新解析的行范围
update.reusedBlocks; // 原样复用的顶层块数
update.fullReparse; // 编辑区出现引用 / 缩写 / 脚注定义、或 YAML 头部可能被闭合时整篇解析
```

做法：从“第一行在编辑之前的最后一个顶层块”开始重新解析，在编辑之后找一个旧顶层块作为拼接点（解析到它的第一行，确认该行在新文本中同样开始一个顶层块），之后的旧块位置整体平移后复用；脚注整篇重新编号。`update` 会复用并修改上一次结果中的节点对象，上一次的结果不应再继续使用。

## 逐行 token 增量解析

面向超大文件与流式输入，产出的是逐行 token，不是上面的语法树：

```typescript
import { IncrementalEditParser, createEditOperation, EditOperationType, parseMarkdownStream } from '@code-reader/markdown-parser';

const parser = new IncrementalEditParser();
parser.parse(text);
const edit = createEditOperation(EditOperationType.Insert, 100, 3, 5, { insertText: '新内容' });
const result = parser.parseIncremental(parser.applyEdit(text, edit), edit);

for await (const token of parseMarkdownStream(chunks)) { /* 逐块读取、每块同步解析 */ }
```

## 与 markdown-it 的差别

- 语法树带每个节点的源码位置；markdown-it 只有块级 `map`（行范围）。
- 自动链接按 GFM 规范而不是 linkify-it：不识别没有 `www.` 的裸域名（如 `example.com`）。
- YAML 头部必须闭合（markdown-it-front-matter 在没有结束行时把整篇当作头部）。
- `{…}` 属性只支持标题、段落末尾与行内元素之后（markdown-it-attrs 还支持列表项、表格等位置）。
- 没有 markdown-it 的插件机制（`md.use`）；自定义语法用上面的语法扩展接口。

## 子路径

| 子路径 | 内容 |
|------|------|
| `@code-reader/markdown-parser/commonmark` | 解析器、节点类型、HTML 渲染、token 流、语法树增量解析 |
| `@code-reader/markdown-parser/incremental` | 逐行 token 增量解析与流式输入 |

## 许可证

MIT
