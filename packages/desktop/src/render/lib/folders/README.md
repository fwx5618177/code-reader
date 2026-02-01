# 文件夹管理模块 (Folders Library)

## 概述

本模块提供文档目录/文件夹的管理功能，支持嵌套结构和树形展示。与 `documents` 模块配合使用，实现文档的组织和分类。

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      UI 层 (React Components)                │
│                      WritingSidebar                          │
├─────────────────────────────────────────────────────────────┤
│                      useFolders Hook                         │
│                  异步操作编排 + 状态管理                       │
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
lib/folders/
├── index.ts          # 统一导出
├── types.ts          # 类型定义 + 树形结构工具函数
├── repository.ts     # 数据库操作
├── service.ts        # 业务逻辑
└── useFolders.ts     # React Hook
```

---

## 核心类型

### Folder - 文件夹实体

```typescript
interface Folder {
  id: string;
  name: string;
  parentId: string | null;  // null 表示根级文件夹
  createdAt: Date;
  updatedAt: Date;
  order: number;            // 同级排序
}
```

### FolderTreeNode - 树形节点

```typescript
interface FolderTreeNode extends Folder {
  children: FolderTreeNode[];
  documentCount: number;     // 该文件夹内的文档数量
}
```

### FlattenedFolderNode - 扁平化节点（用于渲染）

```typescript
interface FlattenedFolderNode {
  folder: FolderTreeNode;
  depth: number;             // 嵌套深度，用于计算缩进
}
```

---

## 使用示例

### 基础用法

```tsx
import { useFolders } from './lib/folders';

function FolderTree() {
  const {
    // 状态
    folderTree,
    loading,
    isInitialized,
    expandedFolderIds,
    
    // 操作
    initialize,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolderExpanded,
  } = useFolders();

  // 初始化
  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  // 创建文件夹
  const handleCreate = async () => {
    await createFolder({ name: '新文件夹', parentId: null });
  };

  // 渲染树
  return (
    <div>
      {folderTree.map(node => (
        <FolderItem
          key={node.id}
          node={node}
          isExpanded={expandedFolderIds.has(node.id)}
          onToggle={() => toggleFolderExpanded(node.id)}
          onRename={(newName) => renameFolder(node.id, newName)}
          onDelete={() => deleteFolder(node.id)}
        />
      ))}
      <button onClick={handleCreate}>新建文件夹</button>
    </div>
  );
}
```

### 使用树形工具函数

```typescript
import { buildFolderTree, flattenFolderTree } from './lib/folders';

// 将扁平列表构建为树形结构
const folders: Folder[] = await repository.getAll();
const documentCounts = await repository.getDocumentCounts();
const tree = buildFolderTree(folders, documentCounts);

// 将树形结构扁平化（用于带缩进的列表渲染）
const flatList = flattenFolderTree(tree);
flatList.forEach(({ folder, depth }) => {
  console.log('  '.repeat(depth) + folder.name);
});
```

---

## API 参考

### useFolders Hook

#### 返回状态

| 属性 | 类型 | 说明 |
|------|------|------|
| `folders` | `FolderListItem[]` | 扁平文件夹列表 |
| `folderTree` | `FolderTreeNode[]` | 树形结构（根级节点） |
| `loading` | `boolean` | 加载状态 |
| `error` | `string \| null` | 错误信息 |
| `isInitialized` | `boolean` | 是否已初始化 |
| `expandedFolderIds` | `Set<string>` | 展开的文件夹 ID 集合 |

#### 返回方法

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `initialize` | - | `Promise<void>` | 初始化模块 |
| `refresh` | - | `Promise<void>` | 刷新数据 |
| `createFolder` | `CreateFolderInput` | `Promise<Folder \| null>` | 创建文件夹 |
| `renameFolder` | `id, newName` | `Promise<boolean>` | 重命名 |
| `moveFolder` | `id, newParentId` | `Promise<boolean>` | 移动到新父级 |
| `deleteFolder` | `id` | `Promise<boolean>` | 删除（文档不删除） |
| `toggleFolderExpanded` | `id` | `void` | 切换展开/折叠 |
| `setFolderExpanded` | `id, expanded` | `void` | 设置展开状态 |
| `expandAll` | - | `void` | 展开所有 |
| `collapseAll` | - | `void` | 折叠所有 |

---

## 数据库表结构

```sql
CREATE TABLE document_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  display_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES document_folders(id) ON DELETE SET NULL
);

CREATE INDEX idx_document_folders_parent
ON document_folders(parent_id) WHERE is_deleted = 0;
```

---

## 设计决策

### 1. 为什么使用软删除？

```typescript
async delete(id: string): Promise<boolean> {
  // 软删除：设置 is_deleted = 1
  await databaseService.run(
    `UPDATE document_folders SET is_deleted = 1, deleted_at = ? WHERE id = ?`,
    [now(), id]
  );
}
```

好处：
- 可恢复误删的文件夹
- 保持历史记录完整性
- 未来可添加"回收站"功能

### 2. 删除文件夹时文档怎么处理？

删除文件夹时，其中的文档不会被删除，而是变为"未分类"（`folder_id = NULL`）：

```typescript
// 先将文档设为未分类
await databaseService.run(
  `UPDATE knowledge_items SET folder_id = NULL WHERE folder_id = ?`,
  [folderId]
);
// 再删除文件夹
await databaseService.run(
  `UPDATE document_folders SET is_deleted = 1 WHERE id = ?`,
  [folderId]
);
```

### 3. 如何防止循环嵌套？

移动文件夹时，检查目标父级是否为自身或其子孙：

```typescript
async move(id: string, newParentId: string | null): Promise<boolean> {
  if (newParentId) {
    const descendants = await this.getAllDescendantIds(id);
    if (descendants.includes(newParentId) || id === newParentId) {
      console.error('Cannot move folder into itself or its descendants');
      return false;
    }
  }
  // ...
}
```

### 4. 树形结构构建算法

使用单次遍历 + Map 构建树：

```typescript
function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  // 1. 创建节点 Map
  const folderMap = new Map<string, FolderTreeNode>();
  for (const folder of folders) {
    folderMap.set(folder.id, { ...folder, children: [] });
  }
  
  // 2. 链接父子关系
  const roots: FolderTreeNode[] = [];
  for (const folder of folders) {
    const node = folderMap.get(folder.id)!;
    if (folder.parentId && folderMap.has(folder.parentId)) {
      folderMap.get(folder.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  
  // 3. 按 order 排序
  sortChildren(roots);
  
  return roots;
}
```

时间复杂度：O(n)，其中 n 为文件夹数量。

---

## 与 documents 模块的集成

### 文档关联文件夹

```typescript
// 创建文档时指定文件夹
await documentService.createDocument({
  title: '新文档',
  content: '',
  folderId: selectedFolderId,  // 关联到当前选中的文件夹
});

// 移动文档到其他文件夹
await documentRepository.update(docId, {
  folderId: newFolderId,
});
```

### 按文件夹筛选文档

```typescript
// 获取指定文件夹的文档（需要在 repository 中添加）
async getByFolderId(folderId: string | null): Promise<DocumentListItem[]> {
  const query = folderId
    ? `SELECT ... WHERE folder_id = ? AND is_deleted = 0`
    : `SELECT ... WHERE folder_id IS NULL AND is_deleted = 0`;
  // ...
}
```

---

## 未来扩展

### 1. 拖拽排序

```typescript
// 在 repository 中已实现 reorder 方法
await folderRepository.reorder(folderId, newOrder);
```

### 2. 文件夹图标/颜色

扩展数据库表：
```sql
ALTER TABLE document_folders ADD COLUMN icon TEXT;
ALTER TABLE document_folders ADD COLUMN color TEXT;
```

### 3. 文件夹权限/共享

添加权限字段：
```sql
ALTER TABLE document_folders ADD COLUMN visibility TEXT DEFAULT 'private';
ALTER TABLE document_folders ADD COLUMN shared_with TEXT; -- JSON array
```

---

## 注意事项

1. **初始化时机**：在使用文件夹功能前必须调用 `initialize()`，这会创建数据库表（如果不存在）。

2. **展开状态持久化**：当前 `expandedFolderIds` 存储在内存中。如需持久化，可以保存到 localStorage。

3. **性能考虑**：对于大量文件夹（>1000），考虑实现虚拟滚动和懒加载子节点。

4. **并发安全**：Hook 内部使用 `initializingRef` 防止并发初始化，但多个操作（如同时创建多个文件夹）可能需要额外处理。