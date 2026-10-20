# 文档管理模块 (Document Library)

## 概述

本模块采用清晰的分层架构，实现文档的 CRUD 操作和状态管理。每个文件遵循单一职责原则，易于测试和维护。

本模块使用 `core` 模块的 `DocumentEditorManager` 和 `useManagedEditor` 来实现版本化自动保存，确保正确的实例生命周期管理。

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      UI 层 (React Components)                │
│                      App.tsx, WritingEditor                  │
├─────────────────────────────────────────────────────────────┤
│                    useDocuments Hook                         │
│             （高层编排、列表管理、编辑器集成）                  │
├─────────────────────────────────────────────────────────────┤
│           Reducer                    │        Actions        │
│        纯函数状态转换                 │      Action 定义       │
├─────────────────────────────────────────────────────────────┤
│              Core Module (useManagedEditor)                  │
│                  版本化内容管理 + 拉取式自动保存               │
├─────────────────────────────────────────────────────────────┤
│            DocumentEditorManager (Singleton)                 │
│     单例管理所有 EditorModel + SaveEngine 实例                │
│     引用计数 + 自动清理 + 防止内存泄漏                         │
├─────────────────────────────────────────────────────────────┤
│                      Service 层                              │
│                     业务逻辑封装                              │
├─────────────────────────────────────────────────────────────┤
│                      Repository 层                           │
│                     数据库操作抽象                            │
├─────────────────────────────────────────────────────────────┤
│                      Database 层                             │
│                 SQLite via IPC                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 文件结构

```
lib/documents/
├── index.ts            # 统一导出
├── types.ts            # 类型定义
├── constants.ts        # 常量（条目类型、状态、占位文字）
├── state.ts            # 状态类型和初始值
├── actions.ts          # Action 类型定义
├── reducer.ts          # 纯函数状态转换
├── repository.ts       # 数据库操作
├── service.ts          # 业务逻辑
├── useDocuments.ts     # 高层 React Hook（使用 useManagedEditor）
├── README.md           # 本文档
└── versions/           # 版本历史子模块
    ├── index.ts        # 模块导出
    ├── types.ts        # 版本类型
    ├── repository.ts   # 版本数据操作
    ├── service.ts      # 版本业务逻辑
    ├── state.ts        # 版本状态
    ├── actions.ts      # 版本 Action
    ├── reducer.ts      # 版本状态转换
    ├── useVersions.ts  # 版本 Hook
    └── README.md       # 版本模块文档
```

---

## 生命周期管理

### 已解决的问题

之前的架构存在以下问题，现已解决：

```
[EditorModel] Cannot reset destroyed model
[EditorModel] Cannot update destroyed model
```

这些错误发生的原因：

1. EditorModel 实例在 React Hooks 内部创建
2. 组件卸载时实例被销毁
3. 异步操作完成后尝试使用已销毁的实例
4. 多个组件可能为同一文档创建多个实例

### 解决方案

新架构通过以下方式解决：

1. **单一来源**：`DocumentEditorManager` 是唯一创建实例的地方
2. **引用计数**：实例不会在所有引用释放前被销毁
3. **挂载状态追踪**：`useManagedEditor` 追踪挂载状态，卸载后跳过操作
4. **安全实例访问**：所有操作在执行前检查 `isDestroyed()`

---

## 自动保存设计

### 核心原则

本模块使用 `core` 模块的成熟实现：

1. **Pull-based（拉取式）保存**
   - SaveEngine 在执行保存时从 EditorModel 拉取最新内容
   - 避免闭包过期导致保存旧内容的问题
   - 始终保存用户当前编辑的最新内容

2. **Version-based（版本化）追踪**
   - 每次内容变更，VersionTracker 递增 `versionId`
   - 通过比较版本号判断是否有未保存更改
   - 避免不必要的保存操作

3. **策略模式**
   - `DebouncedSaveStrategy`：防抖 + 最大间隔（默认：1.5s 防抖，30s 最大间隔）
   - `ImmediateSaveStrategy`：立即保存（用于 Cmd+S 手动保存）

### 默认配置

```typescript
{
  debounceMs: 1500,        // 用户停止输入 1.5 秒后保存
  maxIntervalMs: 30000,    // 持续编辑时最多 30 秒必须保存一次
  versionIntervalMs: 300000 // 版本快照间隔 5 分钟
}
```

---

## Hook 使用

### useDocuments（主要 Hook）

管理文档列表、选择、创建、删除等操作。内部使用 `useManagedEditor`。

```tsx
import { useDocuments } from './lib/documents';

function WritingEditor() {
  const {
    // 列表状态
    documents,
    listLoading,
    
    // 编辑器状态
    currentDocument,
    selectedId,
    isDirty,
    
    // 自动保存状态
    isSaving,
    lastSavedAt,
    isAutoSaveEnabled,
    
    // 全局状态
    isInitialized,
    
    // 计算值
    title,
    content,
    wordCount,
    charCount,
    
    // 操作
    initialize,
    selectDocument,
    createDocument,
    updateLocal,
    saveDocument,
    deleteDocument,
    
    // 自动保存控制
    enableAutoSave,
    disableAutoSave,
    
    // 版本历史
    createVersion,
    lastVersionCreatedAt,
  } = useDocuments({
    debounceMs: 1500,
    maxIntervalMs: 30000,
    autoSaveEnabled: true,
    onVersionCreated: (version) => {
      console.log('版本已创建:', version.versionNumber);
    },
  });

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div>
      <RichEditor
        key={selectedId}
        initialContent={content}
        onChange={(html) => updateLocal({ content: html })}
      />
    </div>
  );
}
```

### 直接使用 useManagedEditor（高级用法）

如需更细粒度的控制，可直接使用 `core` 模块的 `useManagedEditor`：

```tsx
import { useManagedEditor, createSuccessResult } from '../core';

function CustomEditor({ documentId }: { documentId: string | null }) {
  const {
    // 实例状态
    isAcquired,
    isReady,
    
    // 内容状态
    title,
    content,
    versionId,
    hasUnsavedChanges,
    isEmpty,
    
    // 内容操作
    updateContent,
    updateTitle,
    update,
    
    // 文档操作
    loadContent,
    switchDocument,
    clear,
    
    // 保存操作
    requestSave,
    saveNow,
    cancelPendingSave,
    isSaving,
    isScheduled,
    lastSavedAt,
    
    // 自动保存控制
    enableAutoSave,
    disableAutoSave,
    isAutoSaveEnabled,
    
    // 底层访问（高级）
    model,
    saveEngine,
  } = useManagedEditor({
    documentId,
    initialTitle: 'Untitled',
    initialContent: '',
    executor: {
      save: async (snapshot) => {
        await documentService.saveDocument(snapshot.documentId, {
          title: snapshot.title,
          content: snapshot.content,
        });
        return createSuccessResult(snapshot.versionId, snapshot.documentId);
      },
    },
    debounceMs: 1500,
    maxIntervalMs: 30000,
    autoSaveEnabled: true,
    onSaveSuccess: (result) => {
      console.log('已保存版本:', result.savedVersionId);
    },
    onSaveError: (result) => {
      console.error('保存失败:', result.error);
    },
  });

  if (!isReady) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <input
        value={title}
        onChange={(e) => updateTitle(e.target.value)}
      />
      <RichEditor
        content={content}
        onChange={updateContent}
      />
      <button onClick={saveNow} disabled={isSaving}>
        {isSaving ? '保存中...' : '保存'}
      </button>
    </div>
  );
}
```

---

## 各层职责

### types.ts - 类型定义

定义所有数据类型，包括：
- `Document` - 完整文档实体
- `DocumentListItem` - 列表项（轻量）
- `CreateDocumentInput` / `UpdateDocumentInput` - 输入类型
- 数据库行类型和转换函数

### state.ts - 状态定义

状态结构清晰分离：
```typescript
interface DocumentState {
  list: {
    items: DocumentListItem[];
    loading: boolean;
    error: string | null;
  };
  editor: {
    documentId: string | null;
    document: Document | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
    dirty: boolean;
    autoSave: AutoSaveState;
    lastSavedAt: Date | null;
    lastVersionAt: Date | null;
  };
  initialized: boolean;
}
```

### actions.ts - Action 定义

所有 Action 类型和创建函数：
- `ListAction` - 列表操作
- `EditorAction` - 编辑器操作（包含自动保存状态同步）
- `GlobalAction` - 全局操作

### reducer.ts - 状态转换

纯函数，无副作用：
- 接收当前状态和 Action
- 返回新状态
- 不包含任何异步逻辑

### service.ts - 业务逻辑

封装业务规则：
- `createDocument(input)` - 创建文档
- `saveDocument(id, input)` - 保存并返回更新后的文档
- `deleteDocument(id)` - 软删除文档

### useDocuments.ts - 主 Hook

基于 `useManagedEditor` 构建：
- 管理文档列表
- 处理文档选择和切换
- 同步编辑器状态到 reducer
- 异步操作安全检查（isMountedRef）

---

## 数据流

### 初始化流程

```
initialize() 
  → dispatch(INIT_START)
  → getDocumentList()
  → getDocument(firstId)
  → dispatch(INIT_SUCCESS)  // 设置 state.editor.documentId
  → useManagedEditor 自动获取实例
```

### 编辑保存流程

写作编辑器的输入不经过 `useDocuments`：分栏的每一栏（`components/SplitEditor/PaneEditor.tsx`）持有自己文档的托管实例并直接写入，
`useDocuments` 从同一实例派生当前文档的标题与内容。`updateLocal` 用于其他入口修改当前文档（如侧栏重命名、专注模式标题栏）。

```
用户输入（任一栏）
  → PaneEditor 微防抖 16ms
  → instance.model.updateContent(markdown)  // EditorModel 版本递增
  → 实例自身调度保存（requestSave）
  → 所有持有该实例的 hook 更新状态；其他打开同一文档的栏把内容作为外部更新同步

保存执行
  → SaveEngine 拉取 EditorModel 最新内容
  → executor.save(snapshot)（各栏与会话共用 useDocuments 的 saveExecutor）
  → documentService.saveDocument(id, data)
  → dispatch(LIST_UPDATE_ITEM)、config.onDocumentSaved（同步 [[ ]] 到 links 表）、按间隔创建版本
  → 实例自身 markAsSaved(versionId, contentHash)
```

### 文档切换流程

```
selectDocument(newId)
  → 如果有未保存更改，先 saveNow()
  → dispatch(EDITOR_LOAD_START)
  → getDocument(newId)
  → editor.switchDocument(id, title, content)
    → DocumentEditorManager.release(oldId)
    → DocumentEditorManager.acquire(newId)  // 已被某一栏持有时沿用内存中的内容
  → dispatch(EDITOR_LOAD_SUCCESS)
```

### 版本创建流程

```
自动保存时（每 5 分钟）
  → SaveEngine 保存成功
  → versionService.createAutoSaveVersion()
  → dispatch(EDITOR_VERSION_CREATED)
  
手动创建
  → createVersion('描述')
  → versionService.createSaveVersion()
  → dispatch(EDITOR_VERSION_CREATED)
```

---

## 版本历史

本模块已集成完整的版本历史功能，支持：

- **时间线版本列表**：按时间倒序展示所有版本
- **版本预览**：查看历史版本的完整内容
- **版本恢复**：一键恢复到任意历史版本
- **自动版本创建**：自动保存时按间隔创建版本快照
- **手动版本创建**：用户可随时创建版本快照

详细文档请参阅 [versions/README.md](./versions/README.md)。

---

## 迁移指南

### 从 useDocumentEditor 迁移

`useDocumentEditor` 已被移除，由 `useManagedEditor` 替代。主要变化：

```typescript
// 之前（已移除）
import { useDocumentEditor } from './lib/documents';

const editor = useDocumentEditor({
  debounceMs: 1500,
  autoSaveEnabled: true,
  onSaveSuccess: (result, document) => { ... },
});

editor.loadDocument(document); // 需要手动加载

// 之后
import { useManagedEditor } from '../core';

const editor = useManagedEditor({
  documentId: document?.id ?? null, // 设置 documentId 自动获取实例
  initialTitle: document?.title,
  initialContent: document?.content,
  executor: {
    save: async (snapshot) => { ... },
  },
  debounceMs: 1500,
  autoSaveEnabled: true,
  onSaveSuccess: (result) => { ... },
});

// 文档切换通过更改 documentId 或使用 switchDocument
editor.switchDocument('new-doc-id', 'New Title', '<p>New content</p>');
```

### 配置变化

```typescript
// 旧版本配置
const {} = useDocuments({
  autoSave: {
    enabled: true,
    debounceMs: 1500,
    maxIntervalMs: 30000,
    createVersionOnSave: true,
    versionIntervalMs: 300000,
  },
  onAutoSaveEvent: (event) => { ... },
});

// 新版本配置
const {} = useDocuments({
  debounceMs: 1500,
  maxIntervalMs: 30000,
  autoSaveEnabled: true,
  onVersionCreated: (version) => { ... },
  debug: false,
});
```

### 移除的导出

以下导出已移除（使用 `core` 模块替代）：
- `useDocumentEditor` - 使用 `useManagedEditor` from `../core`
- `AutoSaveManager` - 使用 `SaveEngine` from `../core`
- `createAutoSaveManager` - 使用 `createSaveEngine` from `../core`

---

## 注意事项

### 编辑器渲染条件

必须确保编辑器只在文档完全加载后才渲染：

```tsx
const canRenderEditor = selectedDocId && currentDocument && !editorLoading;

{editorLoading ? (
  <LoadingSpinner />
) : canRenderEditor ? (
  <RichEditor
    key={`${selectedDocId}-${currentDocument.id}`}
    initialContent={currentDocument.content}
  />
) : (
  <EmptyState />
)}
```

### 非受控编辑器

RichEditor 是非受控组件，`initialContent` 只在组件挂载时使用。使用 `key` 确保文档切换时重新挂载：

```tsx
<RichEditor
  key={`${selectedDocId}-${currentDocument.id}`}
  initialContent={currentDocument.content}
  onChange={handleChange}
/>
```

### 异步安全

所有异步操作后应检查组件是否仍挂载：

```typescript
const isMountedRef = useRef(true);

useEffect(() => {
  isMountedRef.current = true;
  return () => {
    isMountedRef.current = false;
  };
}, []);

const loadData = async () => {
  const data = await fetchData();
  
  // 检查挂载状态
  if (!isMountedRef.current) return;
  
  dispatch(actions.setData(data));
};
```

---

## 调试

启用调试日志：

```typescript
const {} = useDocuments({
  debug: true, // 启用调试日志
});
```

或者启用 DocumentEditorManager 调试：

```typescript
import { DocumentEditorManager } from '../core';

DocumentEditorManager.getInstance({ debug: true });
```

这将输出实例获取/释放、保存操作等详细日志。