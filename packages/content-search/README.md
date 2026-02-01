# @code-reader/content-search

高性能搜索库，提供全文搜索索引、文件内容搜索、模糊匹配等功能。

## 特性

- **倒排索引全文搜索**：基于 BM25 算法的高效全文搜索
- **批量文件内容搜索**：支持并行文件读取和流式搜索
- **模糊匹配**：支持拼写容错搜索
- **正则表达式搜索**：支持复杂模式匹配
- **中文支持**：内置中文分词和停用词
- **高亮显示**：自动生成匹配高亮片段

## 安装

```bash
pnpm add @code-reader/content-search
```

## 使用示例

### 搜索索引

```typescript
import { createSearchIndex, SearchIndex } from '@code-reader/content-search';

// 创建搜索索引
const index = createSearchIndex({
  minWordLength: 2,
  caseSensitive: false,
});

// 添加文档
index.addDocument({
  id: 'doc-1',
  title: '示例文档',
  content: '这是文档的内容，用于全文搜索测试。',
  path: '/docs/example.md',
});

// 批量添加文档
index.addDocuments([
  { id: 'doc-2', title: '第二个文档', content: '更多内容...' },
  { id: 'doc-3', title: '第三个文档', content: '其他内容...' },
]);

// 搜索
const results = index.search('文档内容', {
  limit: 10,
  fuzzy: true,
  highlight: true,
});

console.log(results);
// [
//   {
//     id: 'doc-1',
//     score: 0.85,
//     highlights: [{ field: 'content', snippet: '这是<mark>文档</mark>的<mark>内容</mark>...' }],
//     document: { ... },
//     matchedFields: ['title', 'content'],
//     matchedTerms: ['文档', '内容'],
//   }
// ]
```

### 中文搜索索引

```typescript
import { createChineseSearchIndex } from '@code-reader/content-search';

// 创建针对中文优化的索引
const zhIndex = createChineseSearchIndex();

zhIndex.addDocument({
  id: 'zh-1',
  title: '中文文档',
  content: '这是一份中文文档，包含各种中文内容。',
});

const results = zhIndex.search('中文');
```

### 代码搜索索引

```typescript
import { createCodeSearchIndex } from '@code-reader/content-search';

// 创建针对代码优化的索引
const codeIndex = createCodeSearchIndex();

codeIndex.addDocument({
  id: 'src-1',
  title: 'main.ts',
  content: 'function calculateSum(a: number, b: number) { return a + b; }',
  path: '/src/main.ts',
});

const results = codeIndex.search('calculateSum');
```

### 文件搜索

```typescript
import { FileSearcher, createFileSearcher, MemoryFileProvider } from '@code-reader/content-search';

// 创建内存文件提供者（用于测试）
const provider = new MemoryFileProvider();
provider.addFile('/src/index.ts', 'export function main() {}');
provider.addFile('/src/utils.ts', 'export function helper() {}');

// 创建文件搜索器
const searcher = createFileSearcher(provider);

// 搜索文件内容
const results = await searcher.search('function', {
  caseSensitive: false,
  wholeWord: false,
  contextLines: 2,
  maxMatchesPerFile: 100,
});

console.log(results);
// {
//   matches: [
//     {
//       path: '/src/index.ts',
//       filename: 'index.ts',
//       matches: [{ lineNumber: 1, lineContent: 'export function main() {}', ... }],
//       matchCount: 1,
//     }
//   ],
//   totalMatches: 2,
//   filesSearched: 2,
//   searchTimeMs: 5,
// }
```

### 便捷函数

```typescript
import { quickContentSearch, quickRegexSearch, highlightMatches } from '@code-reader/content-search';

// 快速内容搜索
const matches = await quickContentSearch(provider, 'export', {
  includePatterns: ['*.ts'],
});

// 正则表达式搜索
const regexMatches = await quickRegexSearch(provider, /function\s+\w+/g);

// 高亮匹配
const highlighted = highlightMatches('Hello World', 'world', {
  caseSensitive: false,
  tag: 'mark',
});
// 'Hello <mark>World</mark>'
```

## API 参考

### SearchIndex

主要的全文搜索索引类。

#### 方法

- `addDocument(doc: SearchDocument): void` - 添加单个文档
- `addDocuments(docs: SearchDocument[]): void` - 批量添加文档
- `removeDocument(id: string): void` - 移除文档
- `updateDocument(doc: SearchDocument): void` - 更新文档
- `search(query: string, options?: SearchOptions): SearchResult[]` - 搜索文档
- `suggest(prefix: string, limit?: number): string[]` - 获取搜索建议
- `getStats(): IndexStats` - 获取索引统计
- `clear(): void` - 清空索引
- `export(): object` - 导出索引数据
- `import(data: object): void` - 导入索引数据

#### 配置选项

```typescript
interface SearchIndexConfig {
  stopWords?: Set<string>;      // 停用词集合
  minWordLength?: number;       // 最小词长
  caseSensitive?: boolean;      // 是否区分大小写
  stemming?: boolean;           // 是否启用词干提取
  language?: 'en' | 'zh';       // 语言
  fieldWeights?: {              // 字段权重
    title?: number;
    content?: number;
    path?: number;
  };
}
```

### FileSearcher

文件内容搜索器。

#### 方法

- `search(query: string, options?: FileSearchOptions): Promise<BatchSearchResult>` - 搜索文件内容
- `searchRegex(pattern: RegExp, options?: FileSearchOptions): Promise<BatchSearchResult>` - 正则搜索
- `getStats(): SearchStats` - 获取搜索统计

#### 搜索选项

```typescript
interface FileSearchOptions {
  caseSensitive?: boolean;      // 区分大小写
  wholeWord?: boolean;          // 全词匹配
  useRegex?: boolean;           // 使用正则
  fuzzy?: boolean;              // 模糊匹配
  fuzzyThreshold?: number;      // 模糊阈值
  maxMatchesPerFile?: number;   // 每文件最大匹配数
  maxFiles?: number;            // 最大文件数
  contextLines?: number;        // 上下文行数
  includePatterns?: string[];   // 包含模式
  excludePatterns?: string[];   // 排除模式
  maxFileSize?: number;         // 最大文件大小
  concurrency?: number;         // 并行度
  onProgress?: Function;        // 进度回调
  onFileMatch?: Function;       // 匹配回调
  abortSignal?: AbortSignal;    // 取消信号
}
```

## 许可证

MIT