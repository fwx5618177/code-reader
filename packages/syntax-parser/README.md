# @code-reader/syntax-parser

零依赖的 LaTeX 语法解析：
- **手写 LaTeX 解析器**：词法分析加递归下降，带错误恢复，输出带位置的 AST 和诊断。
- **LaTeX 语言配置**：注释、括号、自动配对、缩进与折叠标记、单词定义，格式参照 VS Code 的 `language-configuration.json`。

桌面端的用法：
- **`LatexLezerParser`**：用于 LaTeX 语法诊断，以及环境和章节的折叠与大纲。`desktop/src/render/lib/latex/analysis.ts` 中的 `LatexAnalyzer` 按块增量调用它。
- **`LATEX_LANGUAGE_CONFIGURATION`**：LaTeX 源码编辑器的 `%` 注释切换、`{ [ ( $` 自动配对，以及环境缩进（`\begin{…}` 后换行缩进一级，输入 `\end{…}` 时回退一级，`document` 环境除外）都来自这份配置，见 `desktop/src/render/lib/latex/codemirror-latex.ts`。

语言注册表、高亮引擎、Lezer 增量解析封装、AST 缓存和正则块扫描器已移到 [`@code-reader/syntax-parser-extras`](../syntax-parser-extras/README.md)。

## 安装

```bash
pnpm add @code-reader/syntax-parser
```

## 解析与诊断

```typescript
import { LatexLezerParser, LatexNodeType } from '@code-reader/syntax-parser';

const result = new LatexLezerParser().parse('\\section{引言}\n\\begin{itemize}\n\\item 第一项\n');

result.success; // false：itemize 没有 \end
result.errors; // [{ message, from, to, line, column, severity }]
result.root; // 根节点；children 中的 Section、Environment 等节点都带 from / to
result.nodeMap; // 节点 ID → 节点

for (const node of result.root.children ?? []) {
  if (node.type === LatexNodeType.Section) {
    // 用于大纲与折叠
  }
}
```

只需要词法分析时，可以用 `tokenizeLatex(source)`。

## 语言配置

```typescript
import { LATEX_LANGUAGE_CONFIGURATION } from '@code-reader/syntax-parser';

LATEX_LANGUAGE_CONFIGURATION.lineComment; // '%'
LATEX_LANGUAGE_CONFIGURATION.autoClosingPairs; // { [ ( $ \( \[
LATEX_LANGUAGE_CONFIGURATION.indentationRules; // \begin{…} / \end{…}，不含 document
```

## 子路径

| 子路径 | 内容 |
|------|------|
| `@code-reader/syntax-parser` | LaTeX 解析器（带 `Latex` 前缀的导出名）与语言配置 |
| `@code-reader/syntax-parser/latex` | LaTeX 解析器模块本身（`NodeType`、`TokenType` 等不带前缀的导出名） |

## 许可证

MIT
