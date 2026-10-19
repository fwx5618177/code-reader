# @code-reader/markdown-parser

零依赖的 Markdown 解析库，包含三部分：
- **CommonMark / GFM 解析器**：输出 AST，块级和行内节点都带行列与偏移。CommonMark 0.31.2 规范 652 个用例全部通过。
- **HTML 渲染器**：输出格式与参考实现 commonmark.js 一致。
- **逐行 token 增量解析**：用于大文件，支持流式输入和局部重解析。

由 `@code-reader/format-parser` 拆出，目标是替代 markdown-it。路线和取舍见 [`docs/FORMAT_PARSER_RESEARCH.md`](../../docs/FORMAT_PARSER_RESEARCH.md)。桌面端编辑器仍使用 markdown-it 加 prosemirror-markdown；`@code-reader/format-parser` 的统一入口 `parse` / `autoParse` 用本包处理 Markdown 模式。

## 现状

| 项目 | 情况 |
|------|------|
| CommonMark 0.31.2 规范 652 例 | **652/652（100%）**。由 `__tests__/commonmark-spec.test.ts` 逐字比较 HTML，下限设为 652，任何回退都会失败；markdown-it 在同一套测试中也是 100%，用作测试工具自检 |
| 算法 | 块级：逐行维护“打开的块”树（`block-parser.ts`）。行内：分隔符栈处理强调，方括号栈处理链接（`inline-parser.ts`）。两者都与规范附录及 commonmark.js 一致 |
| 位置信息 | 块级与行内节点都有 `position`（行、列、偏移） |
| GFM | 表格、任务列表项、删除线、脚注（`gfm` 与 `strikethrough` 选项） |
| 性能 | 88 万字符：解析 42ms，解析加渲染 54ms（markdown-it 分别为 25ms 和 30ms）。随机输入 2 万次无异常，单次不超过 50ms |
| 扩展 | 还没有插件接口 |
| 增量 | `IncrementalEditParser` 在逐行 token 模型上局部重解析，产出的不是 CommonMark AST |

## 安装

```bash
pnpm add @code-reader/markdown-parser
```

## 解析与渲染

```typescript
import { parseCommonMark, renderHtml, BlockType } from '@code-reader/markdown-parser';

const { document, warnings } = parseCommonMark('# 标题\n\n**粗体** 与 [链接][ref]\n\n[ref]: https://example.com "标题"\n');

document.children[0].type === BlockType.Heading; // true
document.children[1].inline; // 行内节点，每个都有 position: { start, end, startLine, startColumn, endLine, endColumn }

renderHtml(document);
// <h1>标题</h1>
// <p><strong>粗体</strong> 与 <a href="https://example.com" title="标题">链接</a></p>
```

### 选项

| 选项 | 默认值 | 说明 |
|------|------|------|
| `gfm` | `true` | 表格、任务列表项、脚注定义与引用 |
| `strikethrough` | `true` | `~text~` / `~~text~~` 删除线 |
| `html` | `true` | 识别 HTML 块与行内 HTML，关闭时按文本处理 |
| `autolink` | `true` | 尖括号自动链接 `<https://…>`、`<a@b.c>` |
| `smartPunctuation` | `false` | 直引号变为弯引号，`--` / `---` 变为连接号和破折号，`...` 变为省略号 |
| `hardBreaks` | `false` | 段落内的普通换行也输出 `<br />` |
| `maxNestingDepth` | `100` | 引用、列表、脚注的最大嵌套层数。超过时其余部分按文本处理，并在 `warnings` 中报告 |

严格按 CommonMark 解析：`parseCommonMark(text, { gfm: false, strikethrough: false })`。

## 增量解析

```typescript
import { IncrementalEditParser, createEditOperation, EditOperationType } from '@code-reader/markdown-parser';

const parser = new IncrementalEditParser();
parser.parse(text);

// 在偏移 100（第 3 行第 5 列）插入文字：先得到新内容，再只重新解析受影响的行
const edit = createEditOperation(EditOperationType.Insert, 100, 3, 5, { insertText: '新内容' });
const next = parser.applyEdit(text, edit);
const result = parser.parseIncremental(next, edit);
result.affectedRange; // 受影响的范围
result.fullReparse; // 受影响行数超过阈值或没有缓存时为 true
```

流式输入：`parseMarkdownStream(asyncIterable)` 逐块读取输入，每块同步解析。

## 子路径

| 子路径 | 内容 |
|------|------|
| `@code-reader/markdown-parser/commonmark` | `parseCommonMark`、`parseInline`、`renderHtml`、`CommonMarkParser` 与节点类型 |
| `@code-reader/markdown-parser/incremental` | `IncrementalParser`、`IncrementalEditParser`、`parseMarkdown`、`parseMarkdownStream` |

## 许可证

MIT
