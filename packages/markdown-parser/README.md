# @code-reader/markdown-parser

零依赖的 Markdown 解析库：
- **CommonMark / GFM 解析器**：输出 AST，块级和行内节点都带行列与偏移。
- **逐行 token 增量解析**：用于大文件，支持流式输入和局部重解析。

由 `@code-reader/format-parser` 拆出，目标是成长为可以替代 markdown-it 的解析库。现状与路线见 [`docs/FORMAT_PARSER_RESEARCH.md`](../../docs/FORMAT_PARSER_RESEARCH.md)。

桌面端编辑器仍使用 markdown-it 加 prosemirror-markdown，本包暂不接入编辑器。`@code-reader/format-parser` 的统一入口 `parse` / `autoParse` 用它处理 Markdown 模式。

## 现状

| 项目 | 情况 |
|------|------|
| CommonMark 0.31.2 规范 652 例 | 58.9%（markdown-it 为 100%），薄弱章节见调研文档 |
| 位置信息 | 块级与行内节点都有 `position`（行、列、偏移） |
| 扩展 | 没有插件接口；GFM（表格、任务列表、删除线、自动链接）和脚注以选项开关提供 |
| 增量 | `IncrementalEditParser` 在逐行 token 模型上局部重解析，产出的不是 CommonMark AST |

## 安装

```bash
pnpm add @code-reader/markdown-parser
```

## CommonMark 解析

```typescript
import { parseCommonMark, parseInline, BlockType } from '@code-reader/markdown-parser';

const { document, warnings, duration } = parseCommonMark('# 标题\n\n**粗体** 与 [链接](https://example.com)', {
  gfm: true,
});

document.children[0].type === BlockType.Heading; // true
document.children[0].position; // { start, end, startLine, startColumn, endLine, endColumn }

const inline = parseInline('*斜体* 与 `代码`');
```

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
| `@code-reader/markdown-parser/commonmark` | `parseCommonMark`、`parseInline`、`CommonMarkParser` 与节点类型 |
| `@code-reader/markdown-parser/incremental` | `IncrementalParser`、`IncrementalEditParser`、`parseMarkdown`、`parseMarkdownStream` |

## 许可证

MIT
