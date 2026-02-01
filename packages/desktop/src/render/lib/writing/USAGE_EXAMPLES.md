# Writing Module 使用示例

本文档展示如何在写作模块中使用搜索、差分、建议等功能。

## 目录

1. [快速开始](#1-快速开始)
2. [文档搜索](#2-文档搜索)
3. [搜索建议](#3-搜索建议)
4. [差分计算](#4-差分计算)
5. [React Hook 集成](#5-react-hook-集成)
6. [Worker 后台计算](#6-worker-后台计算)
7. [索引持久化](#7-索引持久化)
8. [完整示例](#8-完整示例)

---

## 1. 快速开始

### 基本使用

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

  // 等待初始化完成
  if (!isInitialized) {
    return <div>加载中...</div>;
  }

  return <div>编辑器内容</div>;
}
```

### 使用全局单例

```tsx
import { getDefaultWritingService } from '../lib/writing';

async function initApp() {
  // 获取全局单例（自动初始化）
  const service = await getDefaultWritingService();
  
  // 索引文档
  await service.indexDocument({
    id: 'doc-1',
    title: '我的第一篇文档',
    content: '这是文档内容...',
  });
  
  // 搜索
  const results = await service.search('文档');
  console.log('搜索结果:', results);
}
```

---

## 2. 文档搜索

### 基础搜索

```typescript
import { useWritingService } from '../lib/writing';

function SearchPanel() {
  const { search, isInitialized } = useWritingService();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const handleSearch = async () => {
    if (!isInitialized || !query.trim()) return;
    
    const searchResults = await search(query, {
      limit: 20,
      highlight: true,
      snippetLength: 150,
    });
    
    setResults(searchResults);
  };

  return (
    <div>
      <input 
        value={query} 
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
      />
      <ul>
        {results.map((result) => (
          <li key={result.documentId}>
            <strong>{result.document?.title}</strong>
            <p dangerouslySetInnerHTML={{ __html: result.snippet }} />
            <small>分数: {result.score.toFixed(2)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### 模糊搜索

```typescript
const results = await search('文档', {
  fuzzy: true,
  fuzzyThreshold: 0.7, // 相似度阈值
  limit: 10,
});
```

### 字段过滤

```typescript
// 只搜索标题
const titleResults = await search('关键词', {
  fields: ['title'],
});

// 搜索标题和内容
const fullResults = await search('关键词', {
  fields: ['title', 'content'],
});
```

---

## 3. 搜索建议

### 基础建议

```typescript
import { useWritingService } from '../lib/writing';

function SearchInput() {
  const { suggest } = useWritingService();
  const [prefix, setPrefix] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  const handleInput = async (value: string) => {
    setPrefix(value);
    
    if (value.length < 2) {
      setSuggestions([]);
      return;
    }
    
    const results = await suggest(value, {
      limit: 10,
      includeHistory: true,
      includeDocuments: true,
    });
    
    setSuggestions(results);
  };

  return (
    <div>
      <input 
        value={prefix} 
        onChange={(e) => handleInput(e.target.value)}
      />
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((s, i) => (
            <li key={i} onClick={() => setPrefix(s.text)}>
              <span className={`type-${s.type}`}>{s.type}</span>
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### 使用 useDocumentSearch Hook

```typescript
import { useDocumentSearch } from '../lib/writing';

function QuickSearch() {
  const { 
    query, 
    setQuery, 
    results, 
    suggestions, 
    isSearching 
  } = useDocumentSearch({
    limit: 10,
    fuzzy: true,
  });

  return (
    <div>
      <input 
        value={query} 
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索文档..."
      />
      
      {isSearching && <span>搜索中...</span>}
      
      {/* 建议列表 */}
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((s) => (
            <li key={s.text}>{s.text}</li>
          ))}
        </ul>
      )}
      
      {/* 搜索结果 */}
      {results.map((r) => (
        <div key={r.documentId}>{r.document?.title}</div>
      ))}
    </div>
  );
}
```

---

## 4. 差分计算

### 基础差分

```typescript
import { useWritingService } from '../lib/writing';

function DiffViewer() {
  const { computeDiff, computeDiffStats } = useWritingService();

  const showDiff = async () => {
    const source = '原始文本内容';
    const target = '修改后的文本内容';
    
    const result = await computeDiff(source, target, {
      useCache: true,      // 使用缓存
      useWorker: true,     // 使用 Worker 后台计算
      semanticCleanup: true, // 语义清理
    });
    
    console.log('差分结果:', result.diffs);
    // [[-1, "原始"], [1, "修改后的"], [0, "文本内容"]]
    
    const stats = await computeDiffStats(source, target);
    console.log('变化率:', stats.changeRatio);
  };

  return <button onClick={showDiff}>计算差分</button>;
}
```

### 判断是否使用增量保存

```typescript
const { shouldUseIncremental } = useWritingService();

async function saveDocument(oldContent: string, newContent: string) {
  const useIncremental = await shouldUseIncremental(oldContent, newContent);
  
  if (useIncremental) {
    // 变化较小，使用增量保存
    const diff = await computeDiff(oldContent, newContent);
    await saveIncrementalToServer(diff);
  } else {
    // 变化较大，使用全量保存
    await saveFullContentToServer(newContent);
  }
}
```

### 使用 useContentDiff Hook

```typescript
import { useContentDiff } from '../lib/writing';

function ContentCompare() {
  const { 
    compare, 
    lastDiff, 
    lastStats, 
    isComputing 
  } = useContentDiff();

  const handleCompare = async () => {
    const result = await compare('旧内容', '新内容');
    
    if (result) {
      console.log('差分:', result.diff);
      console.log('统计:', result.stats);
    }
  };

  return (
    <div>
      <button onClick={handleCompare} disabled={isComputing}>
        比较
      </button>
      
      {lastStats && (
        <div>
          <p>插入: {lastStats.insertions} 字符</p>
          <p>删除: {lastStats.deletions} 字符</p>
          <p>变化率: {(lastStats.changeRatio * 100).toFixed(1)}%</p>
        </div>
      )}
    </div>
  );
}
```

---

## 5. React Hook 集成

### 完整的 Hook 使用

```typescript
import { useWritingService } from '../lib/writing';

function WritingApp() {
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
  } = useWritingService({
    useGlobal: true, // 使用全局单例
    debug: true,     // 启用调试日志
    onEvent: (event) => {
      console.log('Writing Service Event:', event);
    },
  });

  // 初始化时索引现有文档
  useEffect(() => {
    if (isInitialized) {
      loadExistingDocuments().then((docs) => {
        indexDocuments(docs);
      });
    }
  }, [isInitialized]);

  if (isLoading) return <div>加载中...</div>;
  if (error) return <div>错误: {error}</div>;

  return (
    <div>
      <p>已索引 {state.indexedDocumentCount} 篇文档</p>
      <p>缓存命中: {state.cacheHits} 次</p>
      {/* 编辑器内容 */}
    </div>
  );
}
```

### 带初始文档的 Hook

```typescript
const documents = [
  { id: 'doc-1', title: '文档1', content: '内容1' },
  { id: 'doc-2', title: '文档2', content: '内容2' },
];

function App() {
  const { search, isInitialized } = useWritingService({
    initialDocuments: documents,
  });

  // 初始化完成后，文档已被索引
}
```

---

## 6. Worker 后台计算

### 使用 EnhancedWorkerPool

```typescript
import { 
  createEnhancedWorkerPool, 
  getDefaultEnhancedWorkerPool 
} from '../lib/writing';

// 获取默认池
const pool = await getDefaultEnhancedWorkerPool();

// 计算大文本差分（在 Worker 中执行）
const result = await pool.textDiff(
  largeSourceText,
  largeTargetText,
  {
    timeout: 5,
    semanticCleanup: true,
    efficiencyCleanup: false,
  }
);

console.log('差分结果:', result.diffs);
console.log('统计信息:', result.stats);

// 计算哈希
const hash = await pool.computeHash(content, 'xxhash');
console.log('哈希值:', hash.hash);

// 计算相似度
const similarity = await pool.computeSimilarity('hello', 'hallo');
console.log('相似度:', similarity.similarity);

// 查看池状态
const stats = pool.getStats();
console.log('Worker 池状态:', stats);
```

### 批量任务

```typescript
const pool = await getDefaultEnhancedWorkerPool();

const results = await pool.batch([
  { type: 'TEXT_DIFF', payload: { source: 'a', target: 'b' } },
  { type: 'COMPUTE_HASH', payload: { data: 'hello', algorithm: 'fnv1a' } },
  { type: 'COMPUTE_SIMILARITY', payload: { source: 'hello', target: 'world' } },
]);
```

### 自定义 Worker 池

```typescript
import { createEnhancedWorkerPool } from '../lib/writing';

const pool = createEnhancedWorkerPool({
  minWorkers: 2,
  maxWorkers: 8,
  taskTimeout: 60000,
  idleTimeout: 120000,
  debug: true,
});

await pool.initialize();

// 使用池...

// 清理
pool.terminate();
```

---

## 7. 索引持久化

### 自动持久化

WritingService 默认启用自动持久化，索引变更后会自动保存到 IndexedDB。

```typescript
const service = await getDefaultWritingService();

// 索引文档（自动触发持久化）
await service.indexDocument({
  id: 'doc-1',
  title: '测试文档',
  content: '文档内容',
});

// 下次启动时，索引会自动加载
```

### 手动持久化

```typescript
const { persistIndex, loadIndex } = useWritingService();

// 立即持久化
await persistIndex();

// 手动加载索引
const success = await loadIndex();
console.log('索引加载:', success ? '成功' : '失败');
```

### 自定义存储

```typescript
import { 
  createIndexStorage, 
  createMemoryIndexStorage 
} from '../lib/writing';

// IndexedDB 存储
const idbStorage = createIndexStorage({
  dbName: 'my-custom-index-db',
  debug: true,
});

// 内存存储（用于测试）
const memoryStorage = createMemoryIndexStorage();

// 使用存储
await idbStorage.save('my-index', indexData);
const loaded = await idbStorage.load('my-index');
```

---

## 8. 完整示例

### 集成到文档编辑器

```tsx
import React, { useEffect, useCallback, useRef } from 'react';
import { useWritingService, useDocumentSearch } from '../lib/writing';

interface Document {
  id: string;
  title: string;
  content: string;
}

function DocumentEditor() {
  const {
    indexDocument,
    updateDocument,
    removeDocument,
    computeDiff,
    shouldUseIncremental,
    isInitialized,
  } = useWritingService();

  const lastSavedContentRef = useRef<string>('');
  const [document, setDocument] = useState<Document | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 文档保存
  const saveDocument = useCallback(async () => {
    if (!document || isSaving) return;
    
    setIsSaving(true);
    
    try {
      const useIncremental = await shouldUseIncremental(
        lastSavedContentRef.current,
        document.content
      );
      
      if (useIncremental) {
        // 增量保存
        const diff = await computeDiff(
          lastSavedContentRef.current,
          document.content
        );
        await api.saveIncremental(document.id, diff);
      } else {
        // 全量保存
        await api.saveFull(document.id, document);
      }
      
      lastSavedContentRef.current = document.content;
      
      // 更新索引
      await updateDocument({
        id: document.id,
        title: document.title,
        content: document.content,
      });
    } finally {
      setIsSaving(false);
    }
  }, [document, isSaving, computeDiff, shouldUseIncremental, updateDocument]);

  // 加载文档
  const loadDocument = useCallback(async (id: string) => {
    const doc = await api.getDocument(id);
    setDocument(doc);
    lastSavedContentRef.current = doc.content;
    
    // 索引文档
    await indexDocument({
      id: doc.id,
      title: doc.title,
      content: doc.content,
    });
  }, [indexDocument]);

  // 删除文档
  const deleteDocument = useCallback(async () => {
    if (!document) return;
    
    await api.deleteDocument(document.id);
    await removeDocument(document.id);
    setDocument(null);
  }, [document, removeDocument]);

  return (
    <div className="editor">
      {/* 搜索面板 */}
      <SearchPanel onSelect={loadDocument} />
      
      {/* 编辑区域 */}
      {document && (
        <div className="editor-content">
          <input
            value={document.title}
            onChange={(e) => setDocument({ ...document, title: e.target.value })}
          />
          <textarea
            value={document.content}
            onChange={(e) => setDocument({ ...document, content: e.target.value })}
          />
          <button onClick={saveDocument} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      )}
    </div>
  );
}

function SearchPanel({ onSelect }: { onSelect: (id: string) => void }) {
  const { query, setQuery, results, isSearching } = useDocumentSearch({
    limit: 10,
    highlight: true,
  });

  return (
    <div className="search-panel">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索文档..."
      />
      
      {isSearching && <div className="loading">搜索中...</div>}
      
      <ul className="results">
        {results.map((result) => (
          <li 
            key={result.documentId} 
            onClick={() => onSelect(result.documentId)}
          >
            <strong>{result.document?.title}</strong>
            <p dangerouslySetInnerHTML={{ __html: result.snippet }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### 版本对比功能

```tsx
import { useContentDiff } from '../lib/writing';

function VersionCompare({ oldVersion, newVersion }: { 
  oldVersion: string; 
  newVersion: string;
}) {
  const { compare, lastDiff, lastStats, isComputing } = useContentDiff();
  
  useEffect(() => {
    compare(oldVersion, newVersion);
  }, [oldVersion, newVersion, compare]);

  if (isComputing) {
    return <div>计算差异中...</div>;
  }

  if (!lastDiff) {
    return <div>无差异数据</div>;
  }

  return (
    <div className="diff-view">
      <div className="stats">
        <span className="insertions">+{lastStats?.insertions}</span>
        <span className="deletions">-{lastStats?.deletions}</span>
        <span className="change-ratio">
          变化率: {((lastStats?.changeRatio || 0) * 100).toFixed(1)}%
        </span>
      </div>
      
      <div className="diff-content">
        {lastDiff.diffs.map(([op, text], index) => {
          const className = op === 1 ? 'insert' : op === -1 ? 'delete' : 'equal';
          return (
            <span key={index} className={className}>
              {text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
```

---

## 性能建议

### 何时使用 Worker

- 文本长度超过 50KB
- 需要计算大量差分
- 不希望阻塞 UI

### 何时使用缓存

- 同一内容可能多次比较
- 用户频繁编辑同一文档
- 自动保存场景

### 何时使用持久化

- 需要跨会话保持索引
- 文档数量较多
- 启动时间敏感

---

## 清理资源

```typescript
import { 
  resetDefaultWritingService, 
  closeDefaultEnhancedWorkerPool 
} from '../lib/writing';

// 应用退出时清理
window.addEventListener('beforeunload', () => {
  resetDefaultWritingService();
  closeDefaultEnhancedWorkerPool();
});
```
