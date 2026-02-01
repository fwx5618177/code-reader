# Writing Module

写作模块服务层 - 整合搜索、差分、持久化功能。

## 概述

Writing Module 提供写作应用所需的核心功能：

- **全文搜索索引** - 基于倒排索引的高效搜索
- **差分计算** - 完整的 diff-match-patch 实现
- **搜索建议** - 自动补全和历史记录
- **Worker 后台计算** - 大文件不阻塞 UI
- **索引持久化** - 自动保存到 IndexedDB
- **React Hooks** - 简化的 React 集成

## 设计原则

- **高内聚** - 所有写作相关功能集中管理
- **低耦合** - 通过接口与其他模块交互
- **单一职责** - 每个组件只负责一个功能
- **无临时方案** - 生产级实现

## 安装

模块已包含在项目中，无需额外安装。

## 快速开始

### React Hook 方式

```tsx
import { useWritingService } from '../lib/writing';

function MyEditor() {
  const { 
    search, 
    suggest, 
    computeDiff, 
    indexDocument,
    isInitialized 
  } = useWritingService();

  // 索引文档
  const handleDocumentLoad = async (doc) => {
    await indexDocument({
      id: doc.id,
      title: doc.title,
      content: doc.content,
    });
  };

  // 搜索
  const handleSearch = async (query) => {
    const results = await search(query, { limit: 10, fuzzy: true });
    return results;
  };

  // 计算差分
  const handleSave = async (oldContent, newContent) => {
    const diff = await computeDiff(oldContent, newContent);
    console.log('变化率:', diff.stats.changeRatio);
  };

  if (!isInitialized) return <div>加载中...</div>;

  return <div>编辑器内容</div>;
}
```

### 直接使用服务

```typescript
import { getDefaultWritingService } from '../lib/writing';

async function main() {
  const service = await getDefaultWritingService();

  // 索引文档
  await service.indexDocuments([
    { id: '1', title: '文档1', content: '内容...' },
    { id: '2', title: '文档2', content: '内容...' },
  ]);

  // 搜索
  const results = await service.search('关键词');
  
  // 获取建议
  const suggestions = await service.suggest('关');
  
  // 计算差分
  const diff = await service.computeDiff('旧内容', '新内容');
}
```

## 模块结构

```
lib/writing/
├── index.ts                    # 统一导出
├── types.ts                    # 类型定义
├── writing-service.ts          # 核心服务
├── useWritingService.ts        # React Hook
├── index-storage.ts            # IndexedDB 持久化
├── enhanced-worker-pool.ts     # Worker 池
├── diff-worker-complete.ts     # 完整 diff 实现
├── worker-script-generator.ts  # Worker 脚本生成
├── README.md                   # 本文档
└── USAGE_EXAMPLES.md           # 详细使用示例
```

## API 参考

### WritingService

核心服务类，整合所有功能。

#### 配置选项

```typescript
interface WritingServiceConfig {
  enableSearchIndex?: boolean;      // 启用搜索索引
  enableDiffCache?: boolean;        // 启用差分缓存
  enableWorker?: boolean;           // 启用 Worker
  enableIndexPersistence?: boolean; // 启用索引持久化
  indexDbName?: string;             // 数据库名称
  diffCacheMaxSize?: number;        // 缓存最大条目
  diffCacheTTL?: number;            // 缓存 TTL
  workerThreshold?: number;         // Worker 阈值
  debug?: boolean;                  // 调试日志
}
```

#### 方法

| 方法 | 描述 |
|------|------|
| `initialize()` | 初始化服务 |
| `destroy()` | 销毁服务 |
| `indexDocument(doc)` | 索引单个文档 |
| `indexDocuments(docs)` | 批量索引文档 |
| `removeDocument(id)` | 移除文档 |
| `updateDocument(doc)` | 更新文档 |
| `clearIndex()` | 清空索引 |
| `search(query, options)` | 搜索文档 |
| `suggest(prefix, options)` | 获取建议 |
| `computeDiff(source, target)` | 计算差分 |
| `computeDiffStats(source, target)` | 计算差分统计 |
| `shouldUseIncremental(source, target)` | 判断是否使用增量 |
| `persistIndex()` | 持久化索引 |
| `loadIndex()` | 加载索引 |
| `clearDiffCache()` | 清空差分缓存 |

### useWritingService Hook

React Hook，自动管理生命周期。

```typescript
const {
  // 状态
  state,
  isInitialized,
  isLoading,
  error,

  // 索引操作
  indexDocument,
  indexDocuments,
  removeDocument,
  updateDocument,
  clearIndex,

  // 搜索
  search,
  suggest,

  // 差分
  computeDiff,
  computeDiffStats,
  shouldUseIncremental,

  // 持久化
  persistIndex,
  loadIndex,

  // 缓存
  clearDiffCache,
  getDiffCacheStats,
} = useWritingService(config);
```

### useDocumentSearch Hook

简化的搜索 Hook。

```typescript
const {
  query,
  setQuery,
  results,
  suggestions,
  isSearching,
} = useDocumentSearch(options);
```

### useContentDiff Hook

简化的差分 Hook。

```typescript
const {
  compare,
  lastDiff,
  lastStats,
  isComputing,
} = useContentDiff();
```

### EnhancedWorkerPool

使用完整 diff-match-patch 的 Worker 池。

```typescript
const pool = await getDefaultEnhancedWorkerPool();

// 文本差分
const result = await pool.textDiff(source, target, options);

// 计算哈希
const hash = await pool.computeHash(data, 'xxhash');

// 计算相似度
const similarity = await pool.computeSimilarity(a, b);

// 批量任务
const results = await pool.batch([
  { type: 'TEXT_DIFF', payload: { source, target } },
  { type: 'COMPUTE_HASH', payload: { data } },
]);

// 查看状态
const stats = pool.getStats();
```

## Worker 完整实现

本模块包含完整的 diff-match-patch 算法实现，在 Worker 中运行：

- **Myers 差分算法** - O(ND) 复杂度
- **语义清理** - 使差异更易于人类理解
- **效率清理** - 减少差异数量
- **行模式优化** - 大文本加速
- **半匹配优化** - 检测共同子串

支持的操作：

| 类型 | 描述 |
|------|------|
| `TEXT_DIFF` | 计算文本差分 |
| `APPLY_TEXT_DIFF` | 应用差分 |
| `SEMANTIC_CLEANUP` | 语义清理 |
| `EFFICIENCY_CLEANUP` | 效率清理 |
| `COMPUTE_HASH` | 计算哈希 (fnv1a/xxhash/adler32) |
| `COMPUTE_SIMILARITY` | 计算 Levenshtein 相似度 |

## 索引持久化

索引自动保存到 IndexedDB：

- 文档变更后 5 秒自动持久化
- 应用启动时自动加载
- 支持导入/导出

```typescript
// 手动持久化
await service.persistIndex();

// 手动加载
const success = await service.loadIndex();

// 自定义存储
const storage = createIndexStorage({
  dbName: 'my-index-db',
});
```

## 性能

### 基准测试

| 操作 | 数据大小 | 时间 |
|------|----------|------|
| 索引 1000 文档 | 平均 1KB | ~200ms |
| 搜索 | 10000 文档 | ~10ms |
| 差分 (主线程) | 10KB | ~5ms |
| 差分 (Worker) | 100KB | ~50ms |
| 哈希 (Worker) | 1MB | ~20ms |

### 优化建议

1. **使用 Worker** - 超过 50KB 的文本
2. **启用缓存** - 重复比较场景
3. **批量索引** - 大量文档时
4. **模糊搜索** - 仅在需要时启用

## 与现有模块集成

### 与 useDocuments 集成

```typescript
// 在 useDocuments 中使用
const { indexDocument, search } = useWritingService();

// 文档加载时索引
useEffect(() => {
  if (currentDocument) {
    indexDocument({
      id: currentDocument.id,
      title: currentDocument.title,
      content: currentDocument.content,
    });
  }
}, [currentDocument]);
```

### 与 SaveEngine 集成

```typescript
// 保存时使用差分
const { computeDiff, shouldUseIncremental } = useWritingService();

const saveExecutor = {
  save: async (snapshot) => {
    const useIncremental = await shouldUseIncremental(
      lastContent,
      snapshot.content
    );
    
    if (useIncremental) {
      const diff = await computeDiff(lastContent, snapshot.content);
      // 增量保存...
    } else {
      // 全量保存...
    }
  },
};
```

## 清理

应用退出时释放资源：

```typescript
import { 
  resetDefaultWritingService, 
  closeDefaultEnhancedWorkerPool,
  closeDefaultIndexStorage,
} from '../lib/writing';

// 清理所有资源
resetDefaultWritingService();
closeDefaultEnhancedWorkerPool();
closeDefaultIndexStorage();
```

## 更多示例

详细使用示例请参见 [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md)。