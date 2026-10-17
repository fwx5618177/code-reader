# 写作模块高性能算法文档

本文档详细记录了写作模块中使用的所有高性能算法、实现状态和使用范围。

## 📊 算法概览表

| 算法名称 | 英文名 | 时间复杂度 | 空间复杂度 | 实现状态 | 使用范围 | 文件位置 |
|---------|--------|-----------|-----------|---------|---------|---------|
| 编辑距离 | Levenshtein Distance | O(m×n) | O(min(m,n)) | ✅ 已实现 | 模糊匹配、拼写检查 | `algorithms/levenshtein.ts` |
| Damerau-Levenshtein | Damerau-Levenshtein Distance | O(m×n) | O(m×n) | ✅ 已实现 | 打字错误检测、相邻字符交换 | `algorithms/damerau-levenshtein.ts` |
| 模糊评分 | Fuzzy Score | O(m×n) 最坏 | O(m) | ✅ 已实现 | 智能补全排序 | `algorithms/fuzzy-score.ts` |
| 快速模糊评分 | Quick Fuzzy Score | O(n) | O(1) | ✅ 已实现 | 实时搜索过滤 | `algorithms/fuzzy-score.ts` |
| 压缩前缀树 | Radix Tree / Patricia Trie | O(k) 插入/查找 | O(n×k) 压缩存储 | ✅ 已实现 | 补全索引、前缀搜索 | `algorithms/radix-tree.ts` |

> 增量解析器、增量编辑解析器与 CommonMark 解析器已迁移到独立子包 `packages/format-parser`（`src/incremental/`、`src/markdown/`）。写作模块的 Markdown 解析与序列化由 `lib/markdown`（基于 markdown-it）负责。

## 📁 文件结构

```
lib/
├── algorithms/                    # 独立算法模块（未来: @code-reader/algorithms）
│   ├── index.ts                   # 算法模块入口，导出所有算法
│   ├── levenshtein.ts             # Levenshtein 编辑距离算法
│   ├── damerau-levenshtein.ts     # Damerau-Levenshtein 距离算法（独立文件）
│   ├── fuzzy-score.ts             # 模糊评分算法
│   └── radix-tree.ts              # Radix Tree 压缩前缀树（从 autocomplete 移入）
│
├── autocomplete/                  # 智能补全模块
│   ├── index.ts                   # 补全模块入口
│   ├── radix-tree.ts              # 重导出（向后兼容，指向 algorithms/radix-tree.ts）
│   ├── autocomplete-service.ts    # 补全服务核心
│   ├── providers.ts               # 内置补全提供者
│   ├── extended-providers.ts      # 扩展补全提供者
│   └── codemirror-adapter.ts      # CodeMirror 集成适配器
│
├── markdown/                      # Markdown 解析/序列化/实时预览（markdown-it + ProseMirror）
│
├── plugins/                       # 插件系统
│   ├── index.ts                   # 插件模块入口
│   ├── sandbox.ts                 # 插件沙箱（权限控制）
│   ├── editor-bridge.ts           # 编辑器桥接
│   ├── plugin-loader.ts           # 插件加载器
│   └── types.ts                   # 类型定义
│
└── editor/                        # 编辑器核心
    ├── index.ts                   # 编辑器模块入口
    ├── languages.ts               # 语言支持注册
    └── prosemirror-rules.ts       # ProseMirror 规则
```

## 🔧 算法详细说明

### 1. Levenshtein 编辑距离 (`levenshtein.ts`)

**用途**: 计算两个字符串之间的最小编辑操作次数（插入、删除、替换）

**特点**:
- 空间优化版本，只使用 O(min(m,n)) 空间
- 支持早期终止优化（通过 `maxDistance` 参数）
- 可配置操作代价（插入、删除、替换）
- 支持计算完整编辑步骤序列

**导出函数**:
- `levenshteinDistance()` - 计算编辑距离
- `levenshteinFull()` - 计算完整结果（含相似度和编辑步骤）
- `stringSimilarity()` - 计算相似度（0-1）
- `isWithinDistance()` - 检查是否在指定距离内
- `batchLevenshtein()` - 批量计算并排序

**使用位置**:
- `RadixTree.fuzzySearch()` - 模糊搜索时计算相似度
- `AutocompleteService` - 补全项排序

### 2. Damerau-Levenshtein 距离 (`damerau-levenshtein.ts`)

**用途**: 在标准 Levenshtein 基础上增加相邻字符交换操作，更适合检测打字错误

**特点**:
- 支持四种操作：插入、删除、替换、交换
- 相邻字符交换只计 1 次距离（而非 Levenshtein 的 2 次）
- 支持早期终止优化
- 可配置各种操作代价

**导出函数**:
- `damerauLevenshteinDistance()` - 计算距离
- `damerauLevenshteinFull()` - 计算完整结果
- `damerauSimilarity()` - 计算相似度
- `isWithinDamerauDistance()` - 检查是否在指定距离内
- `isSingleTransposition()` - 检测是否只差一个相邻交换
- `batchDamerauLevenshtein()` - 批量计算并排序
- `findClosest()` - 查找最相似的字符串

**使用位置**:
- 拼写检查
- 打字错误自动纠正

### 3. 模糊评分 (`fuzzy-score.ts`)

**用途**: 智能匹配评分，支持连续匹配奖励和边界匹配

**特点**:
- 连续字符匹配获得更高分数
- 首字符和边界匹配加分
- 支持驼峰/下划线边界识别
- 包含快速版本 `quickFuzzyScore`（O(n) 时间复杂度）

**导出函数**:
- `fuzzyScore()` - 计算详细的模糊匹配分数
- `fuzzyMatch()` - 简化版模糊匹配（只返回是否匹配）
- `quickFuzzyScore()` - 快速模糊评分（性能更好，精度略低）
- `fuzzyFilter()` - 批量模糊匹配并排序
- `highlightMatches()` - 高亮匹配文本
- `fuzzySimilarity()` - 计算模糊相似度
- `isSubsequence()` - 子序列匹配检查
- `getAllMatchPositions()` - 获取所有可能的匹配位置

**使用位置**:
- 补全项排序
- 文件搜索结果排序
- 命令面板匹配

### 4. Radix Tree 压缩前缀树 (`radix-tree.ts`)

**用途**: 高效的字符串前缀匹配，用于自动补全索引

**特点**:
- 压缩单子节点路径，节省内存
- 支持前缀搜索、模糊搜索
- O(k) 时间复杂度的插入和查找
- 依赖 `levenshtein.ts` 和 `fuzzy-score.ts`

**导出类**:
- `RadixTree` - 压缩前缀树主类

**方法**:
- `insert()` / `insertMany()` - 插入
- `find()` - 精确查找
- `delete()` - 删除
- `prefixSearch()` - 前缀搜索
- `fuzzySearch()` - 模糊搜索
- `getAllKeys()` / `getAllValues()` - 获取所有内容
- `toJSON()` / `fromJSON()` - 序列化/反序列化

**使用位置**:
- `AutocompleteService` - 存储和检索补全项
- `FilePathProvider` - 文件路径补全
- `DocumentTitleProvider` - 文档标题补全
- `HistoryProvider` - 历史记录补全
- `SymbolProvider` - 符号补全


## 🚀 性能优化策略

### 1. 空间优化
- Levenshtein 使用单行数组代替完整矩阵
- Radix Tree 压缩单子节点路径


### 2. 时间优化
- 早期终止：编辑距离超过阈值立即返回
- 缓存：补全结果缓存

### 3. 内存管理
- 共享 AutocompleteService 单例
- 定期清理过期缓存
- 使用 WeakMap 避免内存泄漏

## 📋 检查清单

### 算法模块组织 ✅
- [x] Levenshtein 算法独立文件
- [x] Damerau-Levenshtein 算法独立文件
- [x] Fuzzy Score 算法独立文件
- [x] Radix Tree 移入 algorithms 目录
- [x] 统一导出入口 `algorithms/index.ts`
- [x] 算法元数据注册表

### CSS Modules 迁移 ✅
- [x] 所有组件迁移到 `*.module.scss`
- [x] 删除旧的 `styles.scss` 文件
- [x] 使用主题变量保持样式一致


### 智能补全 ✅
- [x] AutocompleteService 核心服务
- [x] CodeMirror 适配器集成
- [x] CodeBlockView 补全支持
- [x] 扩展 providers（文件路径、文档标题、历史、符号）
- [x] PersistentIndexManager 持久化

### 插件沙箱 ✅
- [x] PermissionManager 权限管理
- [x] ResourceMonitor 资源监控
- [x] SecureProxyFactory 安全代理
- [x] PluginSandbox 沙箱隔离
- [x] 权限确认 UI（PermissionDialog）

### 编辑器桥接 ✅
- [x] EditorBridge 单例实现
- [x] EditorAPI 创建
- [x] UIAPI 创建
- [x] RichEditor 注册到 EditorBridge
- [x] PluginLoader 集成沙箱

## 🔮 未来规划

### 短期（建议优先完成）
1. 添加单元测试覆盖核心算法
2. 性能基准测试

### 中期
1. 将计算密集任务移到 Web Worker
2. 将持久化索引从 localStorage 升级到 IndexedDB
3. 更多补全 Provider（代码符号、函数签名）

### 长期
1. 抽取算法模块为独立包 `@code-reader/algorithms`
2. 支持更多格式（AsciiDoc 等）

## 📚 API 使用示例

### Levenshtein 编辑距离

```typescript
import { levenshteinDistance, stringSimilarity } from '../algorithms';

// 计算编辑距离
const distance = levenshteinDistance('kitten', 'sitting'); // 3

// 计算相似度
const similarity = stringSimilarity('hello', 'hallo'); // 0.8
```

### Damerau-Levenshtein 距离

```typescript
import { damerauLevenshteinDistance, isSingleTransposition } from '../algorithms';

// 计算距离（相邻交换只计 1 次）
const distance = damerauLevenshteinDistance('ab', 'ba'); // 1

// 检测是否为单次交换
const isSwap = isSingleTransposition('teh', 'the'); // true
```

### 模糊搜索

```typescript
import { fuzzyScore, fuzzyFilter } from '../algorithms';

// 单个匹配
const result = fuzzyScore('abc', 'abracadabra');
// { matched: true, score: 75, positions: [0, 1, 4] }

// 批量过滤
const items = ['apple', 'banana', 'apricot', 'avocado'];
const filtered = fuzzyFilter('ap', items, (item) => item, { limit: 2 });
// [{ item: 'apple', score: 90 }, { item: 'apricot', score: 85 }]
```

### Radix Tree

```typescript
import { RadixTree } from '../algorithms';

const tree = new RadixTree();

// 插入
tree.insert('hello', { id: '1', label: 'Hello', type: 'word' });
tree.insert('help', { id: '2', label: 'Help', type: 'word' });

// 前缀搜索
const results = tree.prefixSearch('hel');
// 返回 'hello' 和 'help' 的匹配结果

// 模糊搜索
const fuzzyResults = tree.fuzzySearch('helo', { maxEditDistance: 1 });
```

### 补全服务

```typescript
import { createExtendedAutocompleteService } from '../autocomplete';

// 创建带有扩展提供者的补全服务
const { service, providers } = await createExtendedAutocompleteService();

// 添加文件
providers.filePath.addFile({
  path: '/src/index.ts',
  name: 'index.ts',
  isDirectory: false,
});

// 获取补全
const result = await service.getCompletions({
  query: 'ind',
  position: { line: 1, column: 4 },
  lineText: 'ind',
  textBefore: 'ind',
  textAfter: '',
});
```

---

*文档最后更新: 2025年*