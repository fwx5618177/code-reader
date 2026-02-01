# @code-reader/auto-complete-algorithm

自动补全核心算法库，提供编辑距离、模糊评分、前缀树等用于智能补全的核心算法实现。

## 特性

- 🚀 **高性能** - 针对性能优化的算法实现
- 📦 **零依赖** - 纯 TypeScript 实现，无外部依赖
- 🔧 **模块化设计** - 按需导入，支持 Tree Shaking
- 📝 **TypeScript 优先** - 完整的类型定义
- 🧪 **测试覆盖** - 完善的单元测试

## 安装

```bash
pnpm add @code-reader/auto-complete-algorithm
```

## 快速开始

```typescript
import {
  // 编辑距离
  levenshteinDistance,
  stringSimilarity,
  // Damerau-Levenshtein
  damerauLevenshteinDistance,
  isSingleTransposition,
  // 模糊评分
  fuzzyScore,
  quickFuzzyScore,
  fuzzyFilter,
  // 前缀树
  RadixTree,
} from '@code-reader/auto-complete-algorithm';

// 计算编辑距离
const distance = levenshteinDistance('kitten', 'sitting');
console.log(distance); // 3

// 计算相似度
const similarity = stringSimilarity('hello', 'hallo');
console.log(similarity); // 0.8

// 模糊匹配
const match = fuzzyScore('btn', 'Button.tsx');
console.log(match); // { matched: true, score: 75, positions: [0, 2, 3] }

// 前缀树自动补全
const tree = new RadixTree();
tree.insert('hello', { id: '1', label: 'Hello', type: 'word' });
tree.insert('help', { id: '2', label: 'Help', type: 'word' });
const results = tree.prefixSearch('hel');
```

## 功能模块

### 1. Levenshtein 编辑距离

计算两个字符串之间的最小编辑操作次数（插入、删除、替换）。

| 特性 | 说明 |
|------|------|
| 时间复杂度 | O(m×n) |
| 空间复杂度 | O(min(m,n)) |
| 使用场景 | 模糊匹配、拼写检查、相似度计算 |

```typescript
import {
  levenshteinDistance,
  levenshteinFull,
  stringSimilarity,
  isWithinDistance,
  batchLevenshtein,
} from '@code-reader/auto-complete-algorithm';

// 计算编辑距离
const distance = levenshteinDistance('kitten', 'sitting'); // 3

// 计算相似度 (0-1)
const similarity = stringSimilarity('hello', 'hallo'); // 0.8

// 检查是否在指定距离内
const within = isWithinDistance('hello', 'helo', 1); // true

// 获取完整结果（含编辑步骤）
const result = levenshteinFull('cat', 'hat', { computeSteps: true });
console.log(result.steps);
// [
//   { operation: 'replace', sourceIndex: 0, targetIndex: 0, char: 'h', replacedChar: 'c' },
//   { operation: 'none', sourceIndex: 1, targetIndex: 1, char: 'a' },
//   { operation: 'none', sourceIndex: 2, targetIndex: 2, char: 't' }
// ]

// 批量计算并排序
const candidates = ['hello', 'hallo', 'help', 'world'];
const sorted = batchLevenshtein('hell', candidates, { limit: 3 });
```

### 2. Damerau-Levenshtein 编辑距离

在标准 Levenshtein 基础上增加相邻字符交换操作，更适合检测打字错误。

| 特性 | 说明 |
|------|------|
| 时间复杂度 | O(m×n) |
| 空间复杂度 | O(m×n) |
| 使用场景 | 拼写纠错、打字错误检测 |

```typescript
import {
  damerauLevenshteinDistance,
  damerauSimilarity,
  isSingleTransposition,
  findClosest,
} from '@code-reader/auto-complete-algorithm';

// 相邻字符交换只计 1 次距离（Levenshtein 会计 2 次）
const distance = damerauLevenshteinDistance('ab', 'ba'); // 1

// 检测是否只差一个相邻交换
const isSwap = isSingleTransposition('teh', 'the'); // true

// 查找最相似的字符串
const candidates = ['apple', 'apply', 'appeal', 'banana'];
const closest = findClosest('appel', candidates); // 'apple'
```

### 3. Fuzzy Score 模糊评分

智能匹配评分，支持连续匹配奖励和边界匹配。

| 特性 | 说明 |
|------|------|
| 时间复杂度 | O(m×n) 最坏情况 |
| 空间复杂度 | O(m) |
| 使用场景 | 智能补全、命令面板、文件搜索 |

```typescript
import {
  fuzzyScore,
  fuzzyMatch,
  quickFuzzyScore,
  fuzzyFilter,
  highlightMatches,
  fuzzySimilarity,
} from '@code-reader/auto-complete-algorithm';

// 详细模糊匹配
const result = fuzzyScore('abc', 'abracadabra');
// { matched: true, score: 75, positions: [0, 1, 4] }

// 快速检查是否匹配
const matched = fuzzyMatch('btn', 'Button.tsx'); // true

// 快速评分（性能更好）
const score = quickFuzzyScore('comp', 'ComponentName'); // 85

// 批量过滤并排序
const items = ['apple', 'banana', 'apricot', 'avocado'];
const filtered = fuzzyFilter('ap', items, (item) => item, { limit: 2 });
// [{ item: 'apple', score: 90 }, { item: 'apricot', score: 85 }]

// 高亮匹配文本
const highlighted = highlightMatches('Button.tsx', [0, 2, 3]);
// '<mark>B</mark>u<mark>tt</mark>on.tsx'
```

### 4. Radix Tree 压缩前缀树

高效的字符串前缀匹配数据结构，适用于自动补全索引。

| 特性 | 说明 |
|------|------|
| 时间复杂度 | O(k) 插入/查找，k 为键长 |
| 空间复杂度 | O(n×k) 压缩存储 |
| 使用场景 | 自动补全、前缀搜索、字典存储 |

```typescript
import { RadixTree } from '@code-reader/auto-complete-algorithm';

// 创建实例
const tree = new RadixTree({
  caseSensitive: false,
  maxResults: 50,
});

// 插入数据
tree.insert('hello', { id: '1', label: 'Hello', type: 'word', priority: 10 });
tree.insert('help', { id: '2', label: 'Help', type: 'word', priority: 20 });
tree.insert('world', { id: '3', label: 'World', type: 'word' });

// 批量插入
tree.insertMany([
  ['apple', { id: '4', label: 'Apple', type: 'fruit' }],
  ['banana', { id: '5', label: 'Banana', type: 'fruit' }],
]);

// 精确查找
const values = tree.find('hello');

// 前缀搜索
const results = tree.prefixSearch('hel', { maxResults: 10 });
// 返回 'hello' 和 'help' 的匹配结果

// 模糊搜索
const fuzzyResults = tree.fuzzySearch('helo', { maxEditDistance: 1 });

// 删除
tree.delete('hello');

// 序列化/反序列化
const json = tree.toJSON();
const restored = RadixTree.fromJSON(json);

// 获取统计
console.log(tree.getSize()); // 节点数量
```

## 算法元数据

```typescript
import { ALGORITHM_REGISTRY, getAlgorithmInfo, printAlgorithmSummary } from '@code-reader/auto-complete-algorithm';

// 获取算法信息
const info = getAlgorithmInfo('levenshtein');
console.log(info);
// {
//   name: '编辑距离',
//   englishName: 'Levenshtein Distance',
//   timeComplexity: 'O(m×n)',
//   spaceComplexity: 'O(min(m,n))',
//   useCases: ['模糊匹配', '拼写检查', '相似度计算', 'DNA序列比对'],
//   description: '计算两个字符串之间的最小编辑距离',
//   file: 'levenshtein.ts'
// }

// 打印所有算法概要
printAlgorithmSummary();
```

## API 参考

### 类型定义

```typescript
// 编辑操作类型
enum EditOperation {
  None = 'none',
  Insert = 'insert',
  Delete = 'delete',
  Replace = 'replace',
}

// Damerau 编辑操作类型
enum DamerauEditOperation {
  None = 'none',
  Insert = 'insert',
  Delete = 'delete',
  Replace = 'replace',
  Transpose = 'transpose',
}

// 模糊匹配结果
interface FuzzyMatch {
  matched: boolean;
  score: number;
  positions: number[];
}

// 搜索结果
interface SearchResult<T> {
  key: string;
  values: T[];
  score: number;
  matchType: 'exact' | 'prefix' | 'fuzzy';
}

// 补全元数据
interface CompletionMeta {
  id: string;
  label: string;
  type: string;
  detail?: string;
  documentation?: string;
  priority?: number;
  data?: unknown;
}
```

## 性能指标

| 算法 | 输入规模 | 平均耗时 |
|------|----------|----------|
| Levenshtein 距离 | 100 字符 | ~0.1ms |
| Damerau-Levenshtein | 100 字符 | ~0.15ms |
| 模糊评分 | 100 字符 | ~0.05ms |
| 快速模糊评分 | 100 字符 | ~0.01ms |
| Radix Tree 前缀搜索 | 10000 条目 | ~1ms |
| Radix Tree 模糊搜索 | 10000 条目 | ~5ms |

## 许可证

MIT