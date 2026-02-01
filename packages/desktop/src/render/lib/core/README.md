# Core 模块

版本化编辑和自动保存的基础架构，支持 versionId + contentHash 双处理、增量保存和生产级撤销/重做。

## 概述

本模块提供成熟的、生产就绪的抽象：

- **版本化内容追踪**（VS Code 风格）
- **拉取式自动保存引擎**
- **versionId + contentHash 双处理**（精确变更检测）
- **统一差分算法库**（文本差分、二进制差分、编辑距离、模糊匹配）
- **生产级撤销/重做**（事务支持、选区状态、智能合并）
- **离线存储支持**（IndexedDB）
- **操作日志**（为未来协同做准备）
- **CRDT 兼容接口**（预留协同编辑接口）
- **单例实例管理**（DocumentEditorManager）
- **React Hooks 封装**（useManagedEditor）

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         UI 层 (React)                                │
│              RichEditor, TitleInput, WritingSidebar                  │
├─────────────────────────────────────────────────────────────────────┤
│                      React Hooks 层                                  │
│                    useManagedEditor (主推荐)                         │
│            useEditorModel, useSaveEngine (底层)                      │
├─────────────────────────────────────────────────────────────────────┤
│                  DocumentEditorManager (单例)                        │
│  - 引用计数生命周期管理                                              │
│  - 每个文档单实例跨组件共享                                          │
│  - 自动清理未使用实例                                                │
├─────────────────────────────────────────────────────────────────────┤
│                        Core 模块                                     │
│  ┌──────────────────────────────┐ ┌──────────────────────────────┐  │
│  │        EditorModel           │ │        SaveEngine            │  │
│  │                              │ │                              │  │
│  │ - 版本追踪 (versionId)       │ │ - 拉取式保存                 │  │
│  │ - 内容哈希 (contentHash)     │ │ - 策略模式                   │  │
│  │ - 变更事件                   │ │ - 增量保存支持               │  │
│  └──────────────────────────────┘ └──────────────────────────────┘  │
│  ┌──────────────────────────────┐ ┌──────────────────────────────┐  │
│  │          Delta               │ │        Storage               │  │
│  │  (使用 lib/diff 底层库)      │ │                              │  │
│  │ - ContentHasher (xxHash)     │ │ - IndexedDB 离线存储         │  │
│  │ - HistoryManager             │ │ - 待同步操作队列             │  │
│  │ - VersionedSnapshot          │ │ - 快照持久化                 │  │
│  └──────────────────────────────┘ └──────────────────────────────┘  │
│  ┌──────────────────────────────┐ ┌──────────────────────────────┐  │
│  │        Operations            │ │          Sync                │  │
│  │                              │ │                              │  │
│  │ - OperationLog 实现          │ │ - Sync 接口 (仅类型)         │  │
│  │ - CRDT/OT 类型定义           │ │ - 冲突解决类型               │  │
│  └──────────────────────────────┘ └──────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                        lib/diff (底层算法库)                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │  TextDiff    │ │  BinaryDiff  │ │ Levenshtein  │ │ FuzzyMatch  │ │
│  │  (dmp/Myers) │ │(fossil-delta)│ │  (编辑距离)  │ │  (模糊搜索) │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └─────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                     DiffEngine (统一接口)                       ││
│  │  - 自动算法选择  - 补丁创建/应用  - 差分统计  - 拼写检查       ││
│  └─────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│                       服务层                                         │
│               documentService, versionService                        │
├─────────────────────────────────────────────────────────────────────┤
│                       数据库 (SQLite)                                │
└─────────────────────────────────────────────────────────────────────┘
```

## 算法库 (lib/diff)

底层差分算法已抽象到 `lib/diff` 目录，提供高内聚、低耦合的算法实现：

| 模块 | 算法 | npm 包 | 用途 |
|------|------|--------|------|
| **TextDiff** | diff-match-patch + Myers | `diff-match-patch` | 文本差分、代码对比 |
| **BinaryDiff** | fossil-delta | `fossil-delta` | 二进制差分、大文件同步 |
| **Levenshtein** | Wagner-Fischer + Damerau | 自研实现 | 编辑距离、拼写检查 |
| **FuzzyMatch** | 子序列匹配 | 自研实现 | 模糊搜索、命令面板 |

详细文档参见：`lib/diff/increment-diff-algorithm.md`

## 核心特性

### 1. versionId + contentHash 双处理

**为什么需要双处理？**

| 问题场景 | 仅 versionId | versionId + contentHash |
|----------|--------------|-------------------------|
| 检测内容是否真的变化 | ❌ 无法判断 | ✅ 哈希比较 |
| 分布式版本冲突 | ❌ 可能冲突 | ✅ 哈希验证 |
| 重复编辑检测 | ❌ 版本递增但内容相同 | ✅ 哈希相同则跳过 |
| 协同冲突检测 | ❌ 需要额外逻辑 | ✅ 哈希不匹配即冲突 |

```typescript
interface VersionedContent {
  versionId: number;     // 单调递增，用于排序
  contentHash: string;   // xxHash，用于精确检测
  title: string;
  content: string;
  timestamp: number;
}
```

### 2. 增量保存支持

对于大文档（>1KB），自动使用增量保存：

```typescript
// SaveEngine 自动判断
if (shouldUseIncremental(delta, 0.5)) {
  // 增量保存：只传输 delta
  await executor.saveIncremental(incrementalData);
} else {
  // 全量保存
  await executor.save(snapshot);
}
```

**算法**：基于 Myers 差分算法，时间复杂度 O(n*d)

### 3. 离线存储

使用 IndexedDB 存储：
- **快照**：文档的版本化快照
- **待同步操作**：断网时的操作队列

```typescript
const storage = new IndexedDBStorage();
await storage.open();

// 存储快照
await storage.storeSnapshot(snapshot);

// 添加待同步操作
await storage.addPendingOperation(operation);

// 获取待同步操作
const pending = await storage.getPendingOperations('doc-123');
```

### 4. 操作日志

记录所有编辑操作，支持：
- 操作重放
- 撤销/重做
- 协同同步（未来）

```typescript
const log = new OperationLog();

// 记录操作
log.createInsert(0, 'Hello');
log.createDelete(5, 1);

// 获取未确认操作
const pending = log.getUnacknowledged();

// 确认操作
log.acknowledge(['op-1', 'op-2']);
```

### 5. 统一差分引擎 (DiffEngine)

基于成熟 npm 包的统一差分引擎，整合多种算法：

| 算法 | npm 包 | 时间复杂度 | 特点 | 适用场景 |
|------|--------|-----------|------|---------|
| **diff-match-patch** | `diff-match-patch` | O(nd) | 字符级差分+语义清理+Patch | 实时协同编辑、通用文本 |
| Myers Diff (行级) | `diff-match-patch` | O(nd) | 行级差分 | 代码差分、代码审查 |
| **fossil-delta** | `fossil-delta` | O(n) | 二进制差分 | 二进制文件、图片、大文件 |

```typescript
import {
  DiffEngine,
  createDiffEngine,
  createCodeDiffEngine,
  quickDiff,
  quickApplyDiff,
  quickBinaryDiff,
  quickApplyBinaryDiff,
  DIFF_INSERT,
  DIFF_DELETE,
  DIFF_EQUAL,
} from './lib/core';

// 创建差分引擎
const engine = createDiffEngine();

// 计算文本差分
const result = engine.diff('Hello World', 'Hello TypeScript World');
// result.diffs: [[0, 'Hello '], [1, 'TypeScript '], [0, 'World']]

// 应用差分
const applied = engine.applyDiff('Hello World', result.diffs);
console.log(applied); // "Hello TypeScript World"

// 反转差分（用于撤销）
const reversed = engine.reverseDiff(result.diffs);

// 差分统计
const stats = engine.getDiffStats(result.diffs);
console.log(`插入: ${stats.insertions}, 删除: ${stats.deletions}, 变化率: ${stats.changeRatio}`);

// 行级差分（适合代码）
const codeEngine = createCodeDiffEngine();
const lineDiff = codeEngine.lineDiff(oldCode, newCode);

// 二进制差分（适合图片、二进制文件）
const binaryDelta = engine.binaryDiff(sourceBuffer, targetBuffer);
const restored = engine.applyBinaryDiff(sourceBuffer, binaryDelta.delta);

// 快捷函数（使用默认引擎）
const diffs = quickDiff('old', 'new');
const text = quickApplyDiff('old', diffs.diffs);

// 补丁操作
const patches = engine.createPatch('Hello', 'Hello World');
const patchResult = engine.applyPatch('Hello', patches);
console.log(patchResult.text); // "Hello World"

// 自动选择算法
const autoDiff = engine.autoDiff(source, target, { isCode: true });
```

### 6. 生产级撤销/重做

基于 **HistoryManager** 的生产级撤销/重做实现：

**核心特性：**
- 基于 diff-match-patch 算法计算差分
- **事务支持**：将多个操作合并为一个撤销单元
- **选区状态保存**：撤销/重做时恢复光标位置
- **智能合并**：基于时间窗口和操作类型自动合并
- **CRDT 兼容接口**：预留协同编辑接口
- 可配置的栈深度限制

```typescript
import { UndoableEditorModel, createUndoableEditorModel } from './lib/core';

// 创建带撤销功能的编辑器模型
const model = createUndoableEditorModel({
  documentId: 'doc-123',
  initialTitle: '我的文档',
  initialContent: '<p>Hello</p>',
  historyConfig: {
    maxDepth: 100,            // 最大撤销栈深度
    enableMerging: true,      // 启用智能合并
    mergeWindowMs: 500,       // 合并时间窗口
    mergeCharThreshold: 20,   // 合并字符阈值
    preserveSelection: true,  // 保存选区状态
  },
});

// 设置选区状态（下次变更时会保存）
model.setSelection(5, 10);

// 更新内容（自动记录到撤销历史）
model.updateContent('<p>Hello World</p>');

// 撤销（包含选区恢复）
const undoResult = model.undo();
if (undoResult.success) {
  console.log('撤销成功，内容:', undoResult.content);
  console.log('恢复选区:', undoResult.selection);
}

// 重做
const redoResult = model.redo();

// 事务模式（多个操作合并为一个撤销单元）
model.beginTransaction('批量格式化');
model.updateContent('内容1');
model.updateContent('内容2');
model.updateContent('内容3');
model.commitTransaction();
// 上述 3 次更新在撤销时作为一个操作

// 取消事务（恢复到事务开始时的状态）
model.beginTransaction('尝试编辑');
model.updateContent('临时内容');
model.cancelTransaction(); // 内容恢复

// 获取撤销/重做状态
const state = model.getUndoRedoState();
console.log(`可撤销: ${state.undoCount}, 可重做: ${state.redoCount}`);
console.log(`有活动事务: ${state.hasActiveTransaction}`);

// 导出/导入历史（用于持久化）
const historyData = model.exportHistory();
localStorage.setItem('history', JSON.stringify(historyData));
// 恢复
model.importHistory(JSON.parse(localStorage.getItem('history')));
```

**独立使用 HistoryManager：**

```typescript
import {
  HistoryManager,
  createHistoryManager,
  createEditorState,
  createSelection,
} from './lib/core';

const history = createHistoryManager({
  maxDepth: 100,
  debug: true,
});

// 创建编辑器状态
const beforeState = createEditorState('Hello', createSelection(5));
const afterState = createEditorState('Hello World', createSelection(11));

// 推入历史
history.push(beforeState, afterState, { label: '插入 World' });

// 撤销
const result = history.undo(afterState);
if (result.success) {
  console.log('恢复内容:', result.state.content);
  console.log('恢复选区:', result.state.selection);
}

// 事务模式
const tx = history.beginTransaction(currentState, '复杂操作');
// ... 多次编辑 ...
history.commit(tx, finalState);
```

## 使用指南

### 1. useManagedEditor (推荐)

```typescript
import { useManagedEditor } from './lib/core';

function DocumentEditor({ documentId }: { documentId: string }) {
  const editor = useManagedEditor({
    documentId,
    initialTitle: '我的文档',
    initialContent: '<p>Hello</p>',
    executor: {
      save: async (snapshot) => {
        await documentService.save(snapshot);
        return createSuccessResult(
          snapshot.versionId,
          snapshot.contentHash,
          snapshot.documentId
        );
      },
      // 可选：支持增量保存
      saveIncremental: async (data) => {
        await documentService.saveIncremental(data);
        return createSuccessResult(
          data.targetVersionId,
          data.targetContentHash,
          data.documentId,
          true
        );
      },
      supportsIncremental: () => true,
    },
    debounceMs: 1500,
    autoSaveEnabled: true,
    onSaveSuccess: (result) => console.log('保存成功', result),
    onSaveError: (result) => console.error('保存失败', result),
  });

  return (
    <div>
      <input
        value={editor.title}
        onChange={(e) => editor.updateTitle(e.target.value)}
      />
      <RichEditor
        content={editor.content}
        onChange={editor.updateContent}
      />
      <span>
        {editor.isSaving ? '保存中...' : editor.hasUnsavedChanges ? '未保存' : '已保存'}
      </span>
    </div>
  );
}
```

### 2. DocumentEditorManager (底层)

```typescript
import { DocumentEditorManager, createSuccessResult } from './lib/core';

const manager = DocumentEditorManager.getInstance();

// 获取实例
const { instance, isNew } = manager.acquire('doc-123', {
  initialTitle: '我的文档',
  executor: {
    save: async (snapshot) => {
      await db.save(snapshot);
      return createSuccessResult(
        snapshot.versionId,
        snapshot.contentHash,
        snapshot.documentId
      );
    },
  },
});

// 使用
instance.model.updateContent('<p>Hello World</p>');
instance.saveEngine.requestSave();

// 释放
manager.release('doc-123');
```

### 3. 增量差分

```typescript
import {
  DeltaCompressor,
  computeDelta,
  applyDelta,
  shouldUseIncremental,
} from './lib/core';

const compressor = new DeltaCompressor();

// 计算差分
const delta = compressor.diff('Hello World', 'Hello TypeScript World');
console.log(delta.operations);
// [{ type: 'retain', value: 6 }, { type: 'insert', value: 'TypeScript ' }, { type: 'retain', value: 5 }]

// 应用差分
const result = compressor.patch('Hello World', delta.operations);
console.log(result.content); // "Hello TypeScript World"

// 判断是否值得增量保存
if (shouldUseIncremental(delta, 0.5)) {
  // 使用增量保存
}
```

### 4. 内容哈希

```typescript
import {
  ContentHasher,
  createFastHasher,
  hashContent,
  compareContent,
} from './lib/core';

// 快速哈希
const hash = hashContent('Hello World');
console.log(hash); // "a1b2c3d4e5f6..."

// 比较内容
const isSame = compareContent(content1, content2);

// 自定义哈希器
const hasher = new ContentHasher({ algorithm: 'sha256' });
const result = await hasher.hashAsync('Hello World');
```

### 5. 离线存储

```typescript
import { IndexedDBStorage, createIndexedDBStorage } from './lib/core';

const storage = createIndexedDBStorage({
  dbName: 'my-app-offline',
  maxSnapshotsPerDocument: 10,
});

await storage.open();

// 存储快照
await storage.storeSnapshot(snapshot);

// 获取最新快照
const latest = await storage.getLatestSnapshot('doc-123');

// 添加待同步操作
await storage.addPendingOperation({
  id: 'op-1',
  documentId: 'doc-123',
  baseVersionId: 1,
  baseContentHash: 'abc123',
  operations: delta.operations,
  timestamp: Date.now(),
});

// 获取待同步操作
const pending = await storage.getPendingOperations('doc-123');

// 确认操作
await storage.acknowledgeOperations(['op-1']);

await storage.close();
```

## 文件结构

```
core/
├── index.ts                    # 主导出
├── README.md                   # 本文档
├── editor-model/
│   ├── index.ts               # 模块导出
│   ├── types.ts               # 类型定义
│   ├── version-tracker.ts     # 版本追踪器
│   ├── editor-model.ts        # 编辑器模型
│   ├── editor-manager.ts      # 单例管理器
│   ├── useEditorModel.ts      # React Hook (底层)
│   └── useManagedEditor.ts    # React Hook (推荐)
├── save-engine/
│   ├── index.ts               # 模块导出
│   ├── types.ts               # 类型定义
│   ├── save-engine.ts         # 保存引擎
│   ├── useSaveEngine.ts       # React Hook
│   └── strategies/
│       ├── index.ts           # 策略导出
│       ├── debounced.ts       # 防抖策略
│       └── immediate.ts       # 立即策略
├── delta/
│   ├── index.ts               # 模块导出
│   ├── diff-engine.ts         # 统一差分引擎 (diff-match-patch/fossil-delta)
│   ├── content-hasher.ts      # 内容哈希 (xxHash/SHA-256)
│   ├── history-manager.ts     # 撤销/重做管理器
│   └── versioned-snapshot.ts  # 版本化快照
├── storage/
│   ├── index.ts               # 模块导出
│   └── indexed-db-storage.ts  # IndexedDB 离线存储
├── operations/
│   ├── index.ts               # 模块导出
│   ├── types.ts               # CRDT/OT 类型定义
│   └── operation-log.ts       # 操作日志实现
└── sync/
    ├── index.ts               # 模块导出
    └── types.ts               # 同步类型定义
```

## API 参考

### EditorModel

| 方法 | 说明 |
|------|------|
| `getVersionedContent()` | 获取版本化内容（含 hash） |
| `getSnapshot()` | 获取完整快照 |
| `getVersionId()` | 获取当前版本号 |
| `getContentHash()` | 获取当前内容哈希 |
| `updateContent(content)` | 更新内容 |
| `updateTitle(title)` | 更新标题 |
| `markAsSaved(versionId, contentHash)` | 标记已保存 |
| `hasUnsavedChanges()` | 检查未保存更改 |
| `canUseIncrementalSave()` | 检查是否可增量保存 |
| `getParentVersion()` | 获取父版本信息 |

### SaveEngine

| 方法 | 说明 |
|------|------|
| `requestSave()` | 请求保存（使用策略） |
| `saveNow()` | 立即保存 |
| `getLastSavedVersionId()` | 获取最后保存版本 |
| `getLastSavedContentHash()` | 获取最后保存哈希 |
| `hasUnsavedChanges()` | 检查未保存更改 |
| `setPreferIncremental(prefer)` | 设置增量保存优先 |

### ContentHasher

| 方法 | 说明 |
|------|------|
| `hash(content)` | 同步计算哈希 |
| `hashAsync(content)` | 异步计算哈希 |
| `compare(a, b)` | 比较两个内容 |
| `shortHash(content)` | 获取短哈希（8字符） |
| `verify(content, hash)` | 验证哈希 |

### DeltaCompressor

| 方法 | 说明 |
|------|------|
| `diff(old, new)` | 计算差分 |
| `patch(original, ops)` | 应用差分 |
| `reverse(ops, original)` | 生成反向差分 |
| `compose(a, b)` | 组合两个差分 |
| `transform(a, b)` | OT 变换 |
| `serialize(ops)` | 序列化差分 |
| `deserialize(str)` | 反序列化差分 |

### IndexedDBStorage

| 方法 | 说明 |
|------|------|
| `open()` | 打开数据库 |
| `close()` | 关闭数据库 |
| `storeSnapshot(snapshot)` | 存储快照 |
| `getLatestSnapshot(docId)` | 获取最新快照 |
| `addPendingOperation(op)` | 添加待同步操作 |
| `getPendingOperations(docId)` | 获取待同步操作 |
| `acknowledgeOperations(ids)` | 确认操作 |
| `getStats(docId?)` | 获取统计信息 |

## 性能指标

| 操作 | 10KB 文档 | 100KB 文档 | 1MB 文档 |
|------|-----------|------------|----------|
| xxHash 哈希 | ~0.1ms | ~0.5ms | ~3ms |
| Myers 差分 | ~1ms | ~10ms | ~100ms |
| 增量压缩率 | 5-20% | 1-10% | 0.5-5% |

## 迁移指南

### 从 useDocumentEditor 迁移到 useManagedEditor

**旧代码：**
```typescript
const editor = useDocumentEditor({
  debounceMs: 1500,
  autoSaveEnabled: true,
  onSaveSuccess: () => {},
});
```

**新代码：**
```typescript
const editor = useManagedEditor({
  documentId: 'doc-123',  // 新增：必需
  initialTitle: '',
  initialContent: '',
  executor: {
    save: async (snapshot) => {
      // 实现保存逻辑
      return createSuccessResult(
        snapshot.versionId,
        snapshot.contentHash,  // 新增
        snapshot.documentId
      );
    },
  },
  debounceMs: 1500,
  autoSaveEnabled: true,
  onSaveSuccess: (result) => {},  // result 包含 contentHash
});
```

**主要变化：**
1. `documentId` 现在是必需参数
2. `executor.save` 返回的 `SaveResult` 需要包含 `savedContentHash`
3. `markAsSaved` 需要同时传入 `versionId` 和 `contentHash`
4. 可以使用 `executor.saveIncremental` 支持增量保存

## 增量差分算法对比

| 算法 | npm 包 | 时间复杂度 | 空间复杂度 | 特点 | 状态 |
|------|--------|-----------|-----------|------|------|
| **diff-match-patch** | `diff-match-patch` | O(nd) | O(n) | 字符级差分+语义清理+Patch | ✅ 已集成 |
| **Myers Diff (行级)** | `diff-match-patch` | O(nd) | O(n) | 行级差分，适合代码 | ✅ 已集成 |
| **fossil-delta** | `fossil-delta` | O(n) | O(n) | 二进制差分，高压缩率 | ✅ 已集成 |
| Patience Diff | - | O(n log n) | O(n) | 更可读的 diff | 🔮 未来 |
| Histogram Diff | - | O(n log n) | O(n) | Git 默认算法 | 🔮 未来 |

### 算法选择指南

```typescript
import { DiffEngine, createDiffEngine } from './lib/core';

const engine = createDiffEngine();

// 自动选择算法
const algorithm = engine.selectAlgorithm(source, target, { isCode: true, isBinary: false });
// 返回: 'dmp' | 'myers' | 'binary'

// 或直接使用 autoDiff
const result = engine.autoDiff(source, target, { isCode: true });
```

- **文本/文档**: 使用 `diff()` (diff-match-patch)
- **代码文件**: 使用 `lineDiff()` (Myers 行级)
- **二进制/图片**: 使用 `binaryDiff()` (fossil-delta)

## 未来计划

- [x] 撤销/重做功能（HistoryManager）
- [x] 生产级文本差分（diff-match-patch）
- [x] 二进制差分（fossil-delta）
- [x] 统一差分引擎（DiffEngine）
- [x] 事务支持
- [x] 选区状态保存
- [x] CRDT 兼容接口
- [ ] 集成 Yjs CRDT 库用于实时协作
- [ ] 实现 WebSocket 同步传输
- [ ] 添加冲突解决 UI
- [ ] 支持多人协作 presence
- [ ] 离线队列自动重连同步
- [ ] Patience Diff / Histogram Diff 支持