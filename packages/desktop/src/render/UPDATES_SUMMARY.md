# 更新摘要 - 版本历史功能实现

## 更新日期: 2024

## 概述

本次更新实现了完整的文档版本历史功能，采用 reducer/dispatch 模式进行状态管理，遵循高内聚、低耦合、单一职责原则。

---

## 新增功能

### 1. 版本历史模块 (`lib/documents/versions/`)

完整的版本历史管理，支持：

- **版本时间线**：按时间倒序展示所有版本
- **版本预览**：查看历史版本完整内容
- **版本恢复**：一键恢复到任意历史版本
- **自动版本创建**：与 AutoSaveManager 集成，按间隔自动创建版本
- **手动版本创建**：用户可随时创建版本快照
- **版本清理**：自动清理过旧版本

### 2. 模块架构

```
lib/documents/versions/
├── types.ts        # 类型定义和辅助函数
├── repository.ts   # IPC 数据库操作
├── service.ts      # 业务逻辑层
├── state.ts        # 状态类型和初始值
├── actions.ts      # Action 类型和创建函数
├── reducer.ts      # 纯状态转换函数
├── useVersions.ts  # React Hook
├── index.ts        # 模块导出
└── README.md       # 详细文档
```

---

## 技术实现

### 1. 状态管理

使用 useReducer 模式管理版本历史状态：

```typescript
interface VersionState {
  documentId: string | null;
  isOpen: boolean;
  list: VersionListState;
  preview: VersionPreviewState;
  restore: VersionRestoreState;
  compare: VersionCompareState;
  lastCreatedVersion: DocumentVersion | null;
  lastVersionCreatedAt: Date | null;
}
```

### 2. Action 类型

- `VERSION_LIST_LOAD_*` - 列表加载
- `VERSION_PREVIEW_*` - 预览操作
- `VERSION_RESTORE_*` - 恢复操作
- `VERSION_PANEL_*` - 面板控制
- `VERSION_CREATED` - 版本创建通知

### 3. 与 useDocuments 集成

在 `useDocuments` hook 中集成了版本创建回调：

```typescript
const {
  lastVersionCreatedAt,
  createVersion,
} = useDocuments({
  onVersionCreated: (version) => {
    console.log('版本已创建:', version.versionNumber);
  },
});
```

### 4. AutoSaveManager 集成

版本创建已与自动保存管理器集成：

- `setCreateVersionCallback` 在自动保存时调用
- 默认每 5 分钟创建一个版本
- 避免频繁创建导致存储膨胀

---

## UI 更新

### 1. EditorFooter 组件

- 新增 `children` prop 支持自定义按钮
- 添加 `.actions` 样式区域

### 2. VersionHistory 组件

- 更新为使用 `useVersions` hook
- 从 `lib/documents/versions` 导入类型和函数
- 改进加载和恢复状态显示

### 3. App.tsx 集成

- 添加版本历史面板状态 (`showVersionHistory`)
- 写作模式 EditorFooter 添加历史按钮
- 专注模式 EditorFooter 添加历史按钮
- 添加 VersionHistory 组件渲染

---

## 向后兼容

旧的 `services/versionService.ts` 已改为重新导出新模块：

```typescript
// DEPRECATED: 请直接从 lib/documents/versions 导入
export { versionService, formatVersionDate, ... } from '../lib/documents/versions';
```

---

## 使用示例

### 打开版本历史面板

```tsx
import { useVersions } from '../../lib/documents/versions';

const {
  versions,
  listLoading,
  openPanel,
  loadVersions,
  restoreVersion,
} = useVersions({ documentId });

// 打开面板并加载版本
openPanel(documentId);
await loadVersions();

// 恢复到特定版本
await restoreVersion(versionId);
```

### 手动创建版本

```tsx
const { createVersion } = useDocuments();

// 创建版本快照
await createVersion('重要更新说明');
```

---

## 后端支持

后端服务已完整实现：

- `main/database/version-history.ts` - 版本历史服务
- `main/database/version-ipc-handlers.ts` - IPC 处理器
- `document_versions` 数据库表（已在 schema 中定义）

IPC 通道：
- `version:create`
- `version:get-history`
- `version:get`
- `version:restore`
- `version:prune`
- `version:auto-save`

---

## 文件变更列表

### 新增文件
- `lib/documents/versions/types.ts`
- `lib/documents/versions/repository.ts`
- `lib/documents/versions/service.ts`
- `lib/documents/versions/state.ts`
- `lib/documents/versions/actions.ts`
- `lib/documents/versions/reducer.ts`
- `lib/documents/versions/useVersions.ts`
- `lib/documents/versions/index.ts`
- `lib/documents/versions/README.md`

### 修改文件
- `lib/documents/index.ts` - 添加 versions 模块导出
- `lib/documents/useDocuments.ts` - 集成版本创建
- `lib/documents/README.md` - 添加版本历史文档
- `components/VersionHistory/index.tsx` - 使用新 hook
- `components/EditorFooter/index.tsx` - 支持 children
- `components/EditorFooter/EditorFooter.module.scss` - 添加 actions 样式
- `services/versionService.ts` - 改为重新导出
- `App.tsx` - 集成版本历史面板

---

## 后续优化建议

1. **版本对比**：实现两个版本的 diff 对比视图
2. **版本搜索**：按时间范围或内容搜索版本
3. **版本标签**：允许用户为重要版本添加标签
4. **版本导出**：导出特定版本为独立文件
5. **性能优化**：大量版本时的虚拟滚动