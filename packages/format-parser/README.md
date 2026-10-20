# @code-reader/format-parser

LaTeX 解析（文档结构、元数据、交叉引用索引），以及按内容识别格式、选择解析器的统一入口。零运行时依赖之外只依赖同仓库的 [`@code-reader/markdown-parser`](../markdown-parser/README.md)（统一入口的 Markdown 模式）。

桌面端的用法：
- `parseLaTeX` 的交叉引用索引与标题、作者 → LaTeX 诊断与大纲（`desktop/src/render/lib/latex/analysis.ts`）
- `isLaTeXDocument` → 没有扩展名的文档按内容决定用 LaTeX 还是 Markdown 渲染（`desktop/src/render/lib/documents/file-types.ts` 的 `resolveDocumentType`）

## 安装

```bash
pnpm add @code-reader/format-parser
```

## LaTeX 解析

```typescript
import { parseLaTeX } from '@code-reader/format-parser';
// 或只引入 LaTeX 部分：import { parseLaTeX } from '@code-reader/format-parser/latex';

const result = parseLaTeX(`\\documentclass{article}
\\title{示例}
\\begin{document}
\\section{引言}\\label{sec:intro}
见第 \\ref{sec:intro} 节。
\\end{document}
`);

result.document.documentClass; // { name: 'article', options: [] }
result.document.metadata.title; // '示例'
result.crossReferences; // 标签与引用的索引，用于检查未定义的引用
```

支持的结构：章节、数学环境（equation / align / gather 等）、列表、表格、图片、代码环境（verbatim / lstlisting / minted）、定理类环境、引用块、参考文献；行内的公式、文本格式、`\cite` 系列、`\ref` 系列、超链接、脚注与特殊字符转义。

## 按内容识别格式

```typescript
import { isLaTeXDocument, isMarkdownDocument, autoParse, ParseMode } from '@code-reader/format-parser';

isLaTeXDocument('\\section{引言}\n正文\n'); // true
isLaTeXDocument('# 笔记\n\n```latex\n\\documentclass{article}\n```\n'); // false：代码块里的源码不算

const result = autoParse(content);
result.mode; // ParseMode.LaTeX | ParseMode.CommonMark | ParseMode.Incremental（超过 10 万字符的 Markdown）
```

判断规则：
1. 先去掉围栏代码块、行内代码、`$$…$$` 公式与 `%` 注释。
2. 剩余内容出现 `\documentclass` 或 `\begin{document}`：是 LaTeX。
3. 否则有行首的章节、宏包或常用环境命令，并且没有 Markdown 的块级结构（标题、列表、引用、表格）或行内结构（链接、图片、双链）：是 LaTeX。

## 统一解析

```typescript
import { parse, ParseMode } from '@code-reader/format-parser';

parse(content, { mode: ParseMode.LaTeX }).latex;
parse(content, { mode: ParseMode.CommonMark }).commonmark; // 由 @code-reader/markdown-parser 解析
```

## 许可证

MIT
