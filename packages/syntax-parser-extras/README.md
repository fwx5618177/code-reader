# @code-reader/syntax-parser-extras

本包从 [`@code-reader/syntax-parser`](../syntax-parser/README.md) 拆出，桌面端目前没有引用，按需引入。包含以下能力：
- 语言注册表与高亮引擎
- Lezer 增量解析封装与 AST 缓存
- 基于正则的 LaTeX 块扫描器

桌面端不引用这些能力，原因如下：
- **代码高亮**：编辑器高亮由 CodeMirror 的语言包和 `StreamLanguage` 承担，不需要另一套高亮引擎。
- **LaTeX 分块**：由桌面端的 `lib/latex/block-segmenter.ts` 承担。它与按块增量分析、分块渲染共用同一套块边界。本包的块扫描器输出的是结构树，粒度不同。
- **LaTeX 诊断**：直接使用 `syntax-parser` 的手写解析器，不经过语言注册表。

## 安装

```bash
pnpm add @code-reader/syntax-parser @code-reader/syntax-parser-extras
```

## 语言注册表与高亮

```typescript
import { initBuiltinLanguages, getLanguageRegistry, createHighlightEngine } from '@code-reader/syntax-parser-extras';

initBuiltinLanguages(); // 注册内置的 LaTeX（解析器为块扫描器，语言配置来自 syntax-parser）

const registry = getLanguageRegistry();
registry.getLanguageByFilename('paper.tex'); // 'latex'
const parser = registry.createParserForFile('paper.tex')!;
const { ast } = parser.parse(source);

const engine = createHighlightEngine(registry.getHighlightRules('latex'));
const { tokens } = engine.highlight(ast, source);
```

接入其他已有 Lezer 语法的语言，可以用 `createLezerLanguageContribution` 生成语言贡献，再调用 `registerLanguage` 注册。

## Lezer 增量解析与 AST 缓存

```typescript
import { createLezerParser, createASTCache, ASTCache } from '@code-reader/syntax-parser-extras';

const parser = createLezerParser({ parser: someLezerParser, language: 'json', enableFragmentCache: true });
const first = parser.parse(text);

// 编辑后：Lezer 语法树复用未变化的片段（TreeFragment），再整体转换为统一 AST
const next = parser.parseIncremental(newText, { changes: [{ from: 10, to: 15, insert: '新内容' }], oldLength: text.length, newLength: newText.length }, first.ast);
next.fullReparse; // 变更过大或没有旧树时为 true

const cache = createASTCache({ maxEntries: 1000, strategy: 'lru' });
cache.set(ASTCache.generateDocumentKey(newText), next.ast);
```

## LaTeX 块扫描器

```typescript
import { createLatexBlockScanner } from '@code-reader/syntax-parser-extras';

const scanner = createLatexBlockScanner();
const { ast } = scanner.parse(source); // 文档类、宏包、章节、环境、段落等块级节点
```

## 子路径

| 子路径 | 内容 |
|------|------|
| `@code-reader/syntax-parser-extras/language-registry` | `LanguageRegistry`、`HighlightEngine`、适配器、`LATEX_CONTRIBUTION` |
| `@code-reader/syntax-parser-extras/lezer` | `LezerIncrementalParser`、`ASTCache` 与共享类型 |
| `@code-reader/syntax-parser-extras/block-scanner` | `LatexBlockScanner` 与语言表 |

性能基准：`pnpm --filter @code-reader/syntax-parser-extras benchmark`（块扫描器与手写 LaTeX 解析器对比）。

## 许可证

MIT
