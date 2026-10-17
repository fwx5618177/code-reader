# @code-reader/diff-algorithm

高性能差分算法库，提供文本差分、二进制差分、编辑距离、模糊匹配等功能。

## 特性

- 🚀 **高性能** - 针对性能优化的算法实现
- 📦 **零外部依赖运行时** - 仅依赖 diff-match-patch 和 fossil-delta
- 🔧 **模块化设计** - 按需导入，支持 Tree Shaking
- 📝 **TypeScript 优先** - 完整的类型定义
- 🧪 **测试覆盖** - 完善的单元测试
- 📊 **基准测试** - 内置性能基准测试

## 安装

```bash
pnpm add @code-reader/diff-algorithm
```

## 快速开始

```typescript
import {
  // 文本差分
  quickTextDiff,
  quickApplyTextDiff,
  // 二进制差分
  quickBinaryDiff,
  quickApplyBinaryDiff,
  // 编辑距离
  quickLevenshteinDistance,
  quickSimilarity,
  // 模糊匹配
  quickFuzzySearch,
  quickFuzzyMatch,
} from '@code-reader/diff-algorithm';

// 文本差分
const diffResult = quickTextDiff('hello world', 'hello universe');
const applied = quickApplyTextDiff('hello world', diffResult.diffs);
console.log(applied); // 'hello universe'

// 编辑距离
const distance = quickLevenshteinDistance('kitten', 'sitting');
console.log(distance); // 3

// 相似度计算
const similarity = quickSimilarity('hello', 'hallo');
console.log(similarity); // 0.8

// 模糊搜索
const files = ['Button.tsx', 'Input.tsx', 'Modal.tsx', 'Tooltip.tsx'];
const results = quickFuzzySearch('btn', files);
console.log(results[0].item); // 'Button.tsx'
```

## 功能模块

### 文本差分 (Text Diff)

基于 diff-match-patch 算法，提供高效的文本差分计算。

```typescript
import {
  createTextDiffEngine,
  quickTextDiff,
  quickLineDiff,
  quickDiffStats,
} from '@code-reader/diff-algorithm';

// 创建引擎实例
const engine = createTextDiffEngine();

// 计算差分
const result = engine.diff(source, target);

// 应用差分
const rebuilt = engine.apply(source, result.diffs);

// 反转差分
const reversed = engine.reverse(result.diffs);

// 获取统计信息
const stats = engine.getStats(result.diffs);
console.log(stats.inserted, stats.deleted, stats.changeRatio);
```

### 二进制差分 (Binary Diff)

基于 fossil-delta 算法，适用于二进制文件的增量更新。

```typescript
import {
  createBinaryDiffEngine,
  quickBinaryDiff,
  quickApplyBinaryDiff,
  quickShouldUseIncremental,
} from '@code-reader/diff-algorithm';

// 计算二进制差分
const delta = quickBinaryDiff(sourceData, targetData);

// 应用差分
const rebuilt = quickApplyBinaryDiff(sourceData, delta);

// 判断是否适合增量更新
const decision = quickShouldUseIncremental(sourceData, targetData);
if (decision.useIncremental) {
  console.log('建议使用增量更新');
}
```

### 编辑距离 (Levenshtein)

计算两个字符串之间的编辑距离和相似度。

```typescript
import {
  createLevenshteinEngine,
  quickLevenshteinDistance,
  quickSimilarity,
  quickFindMostSimilar,
  quickSpellingSuggestions,
} from '@code-reader/diff-algorithm';

// 计算编辑距离
const distance = quickLevenshteinDistance('hello', 'hallo');

// 计算相似度 (0-1)
const similarity = quickSimilarity('hello', 'hallo');

// 找最相似的项
const candidates = ['hello', 'hallo', 'help', 'world'];
const mostSimilar = quickFindMostSimilar('hell', candidates);

// 拼写建议
const suggestions = quickSpellingSuggestions('helo', dictionary, 5);
```

### 模糊匹配 (Fuzzy Match)

高性能模糊搜索，适用于文件搜索、命令面板等场景。

```typescript
import {
  createFuzzyMatchEngine,
  createFileSearchEngine,
  createCommandSearchEngine,
  quickFuzzyMatch,
  quickFuzzySearch,
  quickHighlight,
} from '@code-reader/diff-algorithm';

// 模糊匹配
const match = quickFuzzyMatch('btn', 'Button.tsx');
if (match) {
  console.log(match.score, match.positions);
}

// 模糊搜索
const results = quickFuzzySearch('comp', files, { limit: 10 });

// 高亮匹配
const highlighted = quickHighlight('btn', 'Button.tsx');
console.log(highlighted.html); // '<mark>B</mark>u<mark>t</mark>to<mark>n</mark>.tsx'

// 文件搜索引擎（优化路径匹配）
const fileEngine = createFileSearchEngine();
const fileResults = fileEngine.search('src/btn', filePaths);

// 命令搜索引擎
const commandEngine = createCommandSearchEngine();
const commands = [
  { id: 'save', label: 'Save File', shortcut: 'Cmd+S' },
  { id: 'open', label: 'Open File', shortcut: 'Cmd+O' },
];
const cmdResults = commandEngine.search('save', commands, { keys: ['label', 'id'] });
```

### 统一差分引擎 (Unified Engine)

自动选择最佳算法的统一接口。

```typescript
import {
  createDiffEngine,
  createCodeDiffEngine,
  quickDiff,
} from '@code-reader/diff-algorithm';

const engine = createDiffEngine();

// 自动选择文本或二进制差分
const result = engine.diff(source, target, {
  isBinary: false,
  isCode: true,
});

// 判断是否使用增量保存
const shouldIncremental = engine.shouldUseIncremental(oldContent, newContent);
```

### 高级算法

#### Rsync 同步

```typescript
import { createRsyncEngine, quickRsync } from '@code-reader/diff-algorithm';

const engine = createRsyncEngine({ blockSize: 4096 });

// 生成签名
const signature = engine.generateSignature(sourceData);

// 计算增量
const delta = engine.computeDelta(targetData, signature);

// 应用增量
const reconstructed = engine.applyDelta(sourceData, delta);
```

#### Patience Diff

```typescript
import { createPatienceDiffEngine, quickPatienceDiff } from '@code-reader/diff-algorithm';

const result = quickPatienceDiff(oldCode, newCode);

// 输出 unified diff 格式
const unified = engine.formatUnified(result, 3);

// 输出 HTML 格式
const html = engine.formatHtml(result);
```

#### Histogram Diff

```typescript
import { createHistogramDiffEngine, quickHistogramDiff } from '@code-reader/diff-algorithm';

// Git 默认使用的算法
const engine = createHistogramDiffEngine();
const result = engine.diff(oldCode, newCode);

// 获取行级变更
const changes = engine.getLineChanges(result);
```

### 缓存层

```typescript
import {
  LRUCache,
  createLRUCache,
  DiffCache,
  createDiffCache,
  cachedTextDiff,
} from '@code-reader/diff-algorithm/cache';

// LRU 缓存
const cache = createLRUCache<string>({ maxSize: 1000 });
cache.set('key', 'value');
const value = cache.get('key');

// Diff 结果缓存
const diffCache = createDiffCache({ maxSize: 100, ttl: 60000 });
const cached = cachedTextDiff(source, target, diffCache);
```

### 流式处理

```typescript
import {
  createStreamingHasher,
  createStreamingDiffEngine,
  quickFileHash,
} from '@code-reader/diff-algorithm/streaming';

// 流式哈希（适用于大文件）
const hash = await quickFileHash(filePath);

// 流式差分
const streamingEngine = createStreamingDiffEngine({ chunkSize: 64 * 1024 });
const result = await streamingEngine.diff(sourceStream, targetStream);
```

### Worker 支持

```typescript
import {
  createWorkerPool,
  createAsyncDiffEngine,
  quickAsyncDiff,
} from '@code-reader/diff-algorithm/worker';

// 异步差分引擎（使用 Worker 线程）
const asyncEngine = createAsyncDiffEngine({ workerThreshold: 100 * 1024 });
const result = await asyncEngine.diff(largeSource, largeTarget);

// 便捷函数
const quickResult = await quickAsyncDiff(source, target);
```

## 基准测试

运行基准测试：

```bash
# 快速测试
pnpm benchmark --quick

# 完整测试
pnpm benchmark

# 输出 JSON 格式
pnpm benchmark --json
```

## API 参考

### 类型定义

```typescript
// 差分操作类型
type DiffOpType = -1 | 0 | 1; // DELETE | EQUAL | INSERT

// 文本差分结果
interface TextDiffResult {
  diffs: TextDiff[];
  source: string;
  target: string;
}

// 差分统计
interface DiffStats {
  inserted: number;
  deleted: number;
  unchanged: number;
  totalChanges: number;
  changeRatio: number;
}

// 模糊匹配结果
interface MatchResult {
  matched: boolean;
  score: number;
  positions: number[];
}

// 搜索结果项
interface SearchResultItem<T> {
  item: T;
  score: number;
  positions: number[];
}
```

## 性能指标

| 操作 | 数据大小 | 平均耗时 |
|------|----------|----------|
| 文本差分 | 10KB | ~2ms |
| 文本差分 | 100KB | ~15ms |
| 二进制差分 | 10KB | ~1ms |
| 编辑距离 | 100字符 | ~0.1ms |
| 模糊搜索 | 1000项 | ~5ms |

## 许可证

MIT