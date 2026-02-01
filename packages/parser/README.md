# @code-reader/parser

高性能内容解析器，提供 Markdown、LaTeX 等格式的解析功能。

## 特性

- 🚀 **高性能** - 针对性能优化的解析算法
- 📦 **零依赖** - 纯 TypeScript 实现，无外部依赖
- 🔧 **模块化设计** - 按需导入，支持 Tree Shaking
- 📝 **TypeScript 优先** - 完整的类型定义
- 🎯 **完整 AST** - 生成标准化的抽象语法树
- ⚡ **增量解析** - 支持大文件流式处理和局部重解析

## 安装

```bash
pnpm add @code-reader/parser
```

## 快速开始

```typescript
import {
  // Markdown 解析
  parseCommonMark,
  // LaTeX 解析
  parseLaTeX,
  // 增量解析
  parseMarkdown,
  // 自动检测
  autoParse,
} from '@code-reader/parser';

// 解析 Markdown
const mdResult = parseCommonMark('# Hello World\n\nThis is **bold** text.');
console.log(mdResult.document);

// 解析 LaTeX
const texResult = parseLaTeX(`
\\documentclass{article}
\\begin{document}
\\section{Introduction}
Hello, \\LaTeX!
\\end{document}
`);
console.log(texResult.document);

// 自动检测并解析
const result = autoParse(content);
console.log(result.mode, result.duration);
```

## 功能模块

### 1. CommonMark 解析器

完整实现 CommonMark 规范，包含 GFM 扩展。

| 特性 | 说明 |
|------|------|
| 时间复杂度 | O(n) |
| 空间复杂度 | O(AST) |
| 使用场景 | Markdown 渲染、文档预览、格式转换 |

```typescript
import {
  CommonMarkParser,
  parseCommonMark,
  parseInline,
} from '@code-reader/parser/markdown';

// 完整文档解析
const result = parseCommonMark(markdownText, {
  gfm: true,           // 启用 GFM 扩展
  html: true,          // 允许内联 HTML
  strikethrough: true, // 启用删除线
  autolink: true,      // 自动链接
});

console.log(result.document);  // 文档 AST
console.log(result.duration);  // 解析耗时

// 仅解析行内内容
const inlineNodes = parseInline('**bold** and *italic*');
```

#### 支持的 GFM 扩展

- ✅ 表格
- ✅ 任务列表
- ✅ 删除线
- ✅ 自动链接
- ✅ 脚注

### 2. LaTeX 解析器

完整的 LaTeX 文档解析器，生成结构化 AST。

| 特性 | 说明 |
|------|------|
| 时间复杂度 | O(n) |
| 空间复杂度 | O(AST) |
| 使用场景 | LaTeX 预览、公式渲染、文档转换 |

```typescript
import {
  LaTeXParser,
  parseLaTeX,
  parseLaTeXInline,
} from '@code-reader/parser/latex';

// 解析完整文档
const result = parseLaTeX(latexSource, {
  parsePreamble: true,      // 解析导言区
  parseMath: true,          // 解析数学公式
  preserveComments: false,  // 不保留注释
});

console.log(result.document.documentClass);  // 文档类
console.log(result.document.metadata);       // 元数据
console.log(result.document.children);       // 文档内容

// 仅解析行内内容
const nodes = parseLaTeXInline('$E = mc^2$ is \\textbf{famous}');
```

#### 支持的 LaTeX 元素

**块级元素：**
- ✅ 章节（section, subsection 等）
- ✅ 数学环境（equation, align, gather 等）
- ✅ 列表（itemize, enumerate, description）
- ✅ 表格（tabular, table）
- ✅ 图片（figure, includegraphics）
- ✅ 代码块（verbatim, lstlisting, minted）
- ✅ 定理环境（theorem, lemma, proof 等）
- ✅ 引用块（quote, quotation）
- ✅ 参考文献

**行内元素：**
- ✅ 数学公式（$...$）
- ✅ 文本格式（\textbf, \textit, \emph 等）
- ✅ 引用（\cite, \citep, \citet 等）
- ✅ 交叉引用（\ref, \eqref, \pageref 等）
- ✅ 超链接（\href, \url）
- ✅ 脚注（\footnote）
- ✅ 特殊字符转义

### 3. 增量解析器

适用于大文件的流式解析和实时编辑场景。

```typescript
import {
  IncrementalParser,
  IncrementalEditParser,
  createEditOperation,
} from '@code-reader/parser/incremental';

// 增量解析（流式处理）
const parser = new IncrementalParser();
const result = parser.parse(largeDocument);

// 增量编辑解析（局部重解析）
const editParser = new IncrementalEditParser();
const initialResult = editParser.parse(document);

// 编辑后只重解析受影响的区域
const edit = createEditOperation('insert', 100, 'new text');
const updatedResult = editParser.applyEdit(edit);
console.log(updatedResult.affectedRange);  // 受影响的范围
```

### 4. 统一解析接口

自动检测文档类型并选择最佳解析器。

```typescript
import { autoParse, parse, ParseMode } from '@code-reader/parser';

// 自动检测
const result = autoParse(content);
console.log(result.mode);  // 'commonmark' | 'latex' | 'incremental'

// 指定模式
const mdResult = parse(content, { mode: ParseMode.CommonMark });
const texResult = parse(content, { mode: ParseMode.LaTeX });

// 检测文档类型
import { isLaTeXDocument, isMarkdownDocument } from '@code-reader/parser';
console.log(isLaTeXDocument(content));
console.log(isMarkdownDocument(content));
```

## API 参考

### 类型定义

```typescript
// Markdown 节点类型
enum BlockType {
  Document, Paragraph, Heading, CodeBlock,
  BlockQuote, List, ListItem, Table, ...
}

enum InlineType {
  Text, Emphasis, Strong, Code, Link, Image, ...
}

// LaTeX 节点类型
enum LaTeXBlockType {
  Document, Section, Paragraph, MathBlock,
  Environment, List, Table, Figure, ...
}

enum LaTeXInlineType {
  Text, MathInline, Bold, Italic,
  Citation, Reference, Command, ...
}

// 解析结果
interface ParseResult {
  document: BlockNode;
  warnings: ParseWarning[];
  duration: number;
}

interface LaTeXParseResult {
  document: DocumentNode;
  warnings: ParseWarning[];
  duration: number;
}
```

## 性能指标

| 解析器 | 输入规模 | 平均耗时 |
|--------|----------|----------|
| CommonMark | 10KB | ~5ms |
| CommonMark | 100KB | ~30ms |
| LaTeX | 10KB | ~8ms |
| LaTeX | 100KB | ~50ms |
| 增量解析 | 100KB | ~20ms |
| 增量编辑 | 局部修改 | ~2ms |

## 与其他解析器的对比

| 特性 | @code-reader/parser | markdown-it | unified |
|------|---------------------|-------------|---------|
| 零依赖 | ✅ | ❌ | ❌ |
| TypeScript 原生 | ✅ | ❌ | 部分 |
| LaTeX 支持 | ✅ | ❌ | 插件 |
| 增量解析 | ✅ | ❌ | ❌ |
| 完整 AST | ✅ | ✅ | ✅ |
| GFM 支持 | ✅ | 插件 | 插件 |

## 许可证

MIT