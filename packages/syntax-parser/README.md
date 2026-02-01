# @code-reader/syntax-parser

高性能增量解析库，提供 Lezer 和 Tree-sitter 两种解析器实现。

## 概述

本库专注于**增量语法解析**，提供：

- **Lezer 解析器**（推荐，默认）- 纯 JavaScript，与 CodeMirror 6 深度集成
- **Tree-sitter 适配器**（可选）- C/WASM 实现，性能更强

> **注意**：文本存储功能（Piece Table / Rope / Gap Buffer）已移至 `@code-reader/text-buffer`

## 安装

```bash
pnpm add @code-reader/syntax-parser
```

## 快速开始

### 使用 Lezer 增量解析

```typescript
import { createLezerParser, createASTCache } from '@code-reader/syntax-parser';
import { parser as latexParser } from '@lezer/latex';

// 创建增量解析器
const parser = createLezerParser({
  parser: latexParser,
  language: 'latex',
  enableFragmentCache: true,
});

// 首次解析
const result = parser.parse(latexContent);
console.log(`解析耗时: ${result.parseTime}ms`);
console.log(`错误数: ${result.errors.length}`);

// 增量解析（编辑后）
const changes = {
  changes: [
    { from: 10, to: 15, insert: '新内容' },
  ],
  oldLength: oldContent.length,
  newLength: newContent.length,
};

const incrementalResult = parser.parseIncremental(
  newContent,
  changes,
  result.ast
);

console.log(`增量解析: ${incrementalResult.fullReparse ? '完整' : '增量'}`);
console.log(`重用节点: ${incrementalResult.reusedNodeCount}`);
```

### AST 缓存

```typescript
import { createASTCache, ASTCache } from '@code-reader/syntax-parser';

// 创建缓存
const cache = createASTCache({
  maxEntries: 1000,
  maxSize: 10 * 1024 * 1024, // 10MB
  ttl: 5 * 60 * 1000, // 5分钟
  strategy: 'lru',
  enableNodeCache: true,
});

// 缓存 AST
const key = ASTCache.generateDocumentKey(content);
cache.set(key, ast);

// 获取缓存
const cachedAST = cache.get(key);

// 获取统计
const stats = cache.getStats();
console.log(`命中率: ${(stats.hitRate * 100).toFixed(2)}%`);
```

## Lezer vs Tree-sitter

本库提供两种解析器，根据场景选择：

### 选择 Lezer（推荐，当前默认）

| 优势 | 说明 |
|-----|------|
| 纯 JavaScript | 无需 WASM，开箱即用 |
| CodeMirror 集成 | 原生深度集成，共享类型 |
| 包体积小 | 核心约 20-30KB |
| 初始化快 | 无需加载 WASM |

**适用场景**：
- 纯 Web 应用
- 与 CodeMirror 6 集成
- 包体积敏感
- 中等规模文档（< 1MB）

### 选择 Tree-sitter

| 优势 | 说明 |
|-----|------|
| 更高性能 | C 实现，解析速度更快 |
| 语法一致性 | 与 GitHub/Neovim 使用相同语法 |
| 更多语言支持 | 生态更丰富 |
| 适合大文件 | 处理 1MB+ 文档更高效 |

**适用场景**：
- Electron/Native 应用
- 需要解析超大文件（> 1MB）
- 需要与 GitHub/Neovim 保持语法一致
- 对解析性能有极高要求

### 性能对比

| 场景 | Lezer | Tree-sitter |
|-----|-------|-------------|
| 100KB 增量解析 | < 5ms | < 2ms |
| 1MB 完整解析 | < 100ms | < 30ms |
| 包体积 | ~50KB | ~300KB（含 WASM）|
| 初始化时间 | 即时 | 需加载 WASM |

### 使用 Tree-sitter

```typescript
import { createTreeSitterAdapter, TREE_SITTER_LANGUAGES } from '@code-reader/syntax-parser';

// 创建适配器
const adapter = createTreeSitterAdapter({
  language: TREE_SITTER_LANGUAGES.latex,
  parseTimeoutMs: 5000,
  enableIncremental: true,
  // 需要提供 WASM 初始化函数
  initWasm: async () => {
    const Parser = await import('web-tree-sitter');
    await Parser.init();
    // ... 初始化代码
  },
});

// 初始化（加载 WASM）
await adapter.initialize();

// 解析
const result = adapter.parse(content);

// 增量解析
const incrementalResult = adapter.parseIncremental(newContent, changes, result.ast);

// 清理资源
adapter.dispose();
```

## API 参考

### Lezer 模块

```typescript
// 创建解析器
createLezerParser(config: LezerParserConfig): LezerIncrementalParser

// 创建 AST 缓存
createASTCache(config?: ASTCacheConfig): ASTCache

// 便捷函数
createCachedLezerParser(parserConfig, cacheConfig): { parser, cache }
createLatexLezerParser(): LezerIncrementalParser
createMarkdownLezerParser(): LezerIncrementalParser
createJavaScriptLezerParser(): LezerIncrementalParser
```

### Tree-sitter 模块

```typescript
// 创建适配器
createTreeSitterAdapter(config: TreeSitterAdapterConfig): TreeSitterAdapter

// 语言配置
TREE_SITTER_LANGUAGES: Record<string, TreeSitterLanguageConfig>
getLanguageByExtension(ext: string): TreeSitterLanguageConfig | undefined
getLanguageByName(name: string): TreeSitterLanguageConfig | undefined
```

### 类型定义

```typescript
// AST 节点
interface ASTNode {
  readonly type: string;
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly parent?: string;
  readonly children?: readonly string[];
  readonly hash?: string;
}

// 增量解析结果
interface IncrementalParseResult<T> extends ParseResult<T> {
  readonly affectedNodeIds: readonly string[];
  readonly dirtyNodeIds: readonly string[];
  readonly fullReparse: boolean;
  readonly reusedNodeCount: number;
  readonly newNodeCount: number;
}

// 文本变更
interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly deleted?: string;
}
```

## 与其他模块配合

### 与 @code-reader/text-buffer 配合

```typescript
import { createAutoBuffer } from '@code-reader/text-buffer';
import { createLezerParser } from '@code-reader/syntax-parser';
import { parser as latexParser } from '@lezer/latex';

// 创建文本缓冲区
const buffer = createAutoBuffer(fileContent);

// 创建解析器
const parser = createLezerParser({
  parser: latexParser,
  language: 'latex',
});

// 解析
const result = parser.parse(buffer.toString());

// 编辑
const newBuffer = buffer.insert(100, 'new text');
const changes = {
  changes: [{ from: 100, to: 100, insert: 'new text' }],
  oldLength: buffer.length,
  newLength: newBuffer.length,
};

// 增量解析
const incrementalResult = parser.parseIncremental(
  newBuffer.toString(),
  changes,
  result.ast
);
```

### 与 @code-reader/diff-algorithm 配合

```typescript
import { quickTextDiff } from '@code-reader/diff-algorithm';
import { createLezerParser } from '@code-reader/syntax-parser';

// 使用 diff 算法计算变更
const diffResult = quickTextDiff(oldContent, newContent);

// 转换为解析器需要的变更格式
const changes = {
  changes: diffResult.diffs.map(d => ({
    from: d.start,
    to: d.end,
    insert: d.text,
  })),
  oldLength: oldContent.length,
  newLength: newContent.length,
};

// 增量解析
const result = parser.parseIncremental(newContent, changes, previousAST);
```

## 架构说明

```
@code-reader/syntax-parser
├── lezer/                # Lezer 增量解析
│   ├── lezer-parser.ts   # LezerIncrementalParser
│   ├── ast-cache.ts      # ASTCache (LRU)
│   └── index.ts
├── tree-sitter/          # Tree-sitter 适配器
│   ├── types.ts          # 类型定义
│   ├── tree-sitter-adapter.ts
│   └── index.ts
├── text-buffer/          # [已废弃] 请使用 @code-reader/text-buffer
├── types.ts              # 通用类型定义
└── index.ts              # 主入口
```

## 迁移指南

### 从旧版本迁移

如果你之前使用的是文本缓冲区功能：

```typescript
// 旧版本
import { createTextBuffer, PieceTable } from '@code-reader/syntax-parser';

// 新版本
import { createTextBuffer, PieceTable } from '@code-reader/text-buffer';
```

## 性能指标

| 操作 | 数据大小 | 耗时 |
|-----|---------|-----|
| Lezer 增量解析（小变更） | 100KB 文档 | < 5ms |
| Lezer 增量解析（大变更） | 100KB 文档 | < 20ms |
| Lezer 完整解析 | 100KB 文档 | < 50ms |
| Tree-sitter 增量解析 | 100KB 文档 | < 2ms |
| Tree-sitter 完整解析 | 100KB 文档 | < 20ms |
| 节点缓存查询 | 10000 节点 | < 0.1ms |

## 许可证

MIT