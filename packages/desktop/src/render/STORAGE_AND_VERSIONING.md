# 存储与版本管理架构

## 概述

本文档描述了 Code Reader 桌面应用的存储策略和版本管理架构，针对不同类型的数据采用不同的存储和版本控制方案。

---

## 1. 版本管理策略

### 1.1 Git 适用场景

Git 适合用于：
- ✅ 代码文件（源代码、配置文件）
- ✅ 纯文本文档（Markdown、JSON、YAML）
- ✅ 小型文本文件（< 1MB）
- ✅ 需要精确历史记录和分支管理的内容

Git **不适合**用于：
- ❌ 大型二进制文件（音频、视频、图片）
- ❌ 频繁变化的大型文件
- ❌ 用户生成的媒体内容（录音、截图）

### 1.2 推荐的混合方案

```
┌─────────────────────────────────────────────────────────────┐
│                    数据类型分类                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │   文本内容        │    │   媒体内容        │               │
│  │                  │    │                  │               │
│  │  • 笔记          │    │  • 录音文件       │               │
│  │  • 日记          │    │  • 图片/截图      │               │
│  │  • 代码片段       │    │  • 视频          │               │
│  │  • Markdown      │    │  • PDF           │               │
│  │                  │    │                  │               │
│  └────────┬─────────┘    └────────┬─────────┘               │
│           │                       │                          │
│           ▼                       ▼                          │
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │  SQLite + Git    │    │  文件系统 + 元数据 │               │
│  │  版本历史        │    │  存储             │               │
│  └──────────────────┘    └──────────────────┘               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 存储架构

### 2.1 目录结构

```
~/.code-reader/
├── data/
│   ├── database.sqlite        # 主数据库（元数据、索引、设置）
│   ├── knowledge/             # 知识库内容
│   │   ├── documents/         # 文档文件
│   │   └── versions/          # 版本快照
│   ├── media/                 # 媒体文件
│   │   ├── audio/             # 录音
│   │   ├── images/            # 图片
│   │   └── attachments/       # 附件
│   ├── cache/                 # 缓存
│   │   ├── embeddings/        # 向量嵌入缓存
│   │   └── thumbnails/        # 缩略图
│   └── exports/               # 导出文件
├── config/
│   ├── settings.json          # 应用设置
│   └── themes/                # 自定义主题
└── logs/
    └── app.log                # 应用日志
```

### 2.2 数据库表设计

#### 2.2.1 文档版本表 (document_versions)

```sql
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_type TEXT NOT NULL,      -- 'knowledge' | 'journal' | 'note'
  version_number INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  diff_from_previous TEXT,          -- JSON diff
  metadata TEXT,                    -- JSON 元数据
  
  FOREIGN KEY (document_id) REFERENCES knowledge_items(id)
);

CREATE INDEX idx_document_versions_doc ON document_versions(document_id);
CREATE INDEX idx_document_versions_created ON document_versions(created_at);
```

#### 2.2.2 媒体文件表 (media_files)

```sql
CREATE TABLE media_files (
  id TEXT PRIMARY KEY,
  document_id TEXT,                 -- 关联的文档（可选）
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,          -- 相对路径
  file_type TEXT NOT NULL,          -- 'audio' | 'image' | 'video' | 'attachment'
  mime_type TEXT,
  file_size INTEGER,
  duration INTEGER,                 -- 音视频时长（秒）
  checksum TEXT,                    -- SHA-256
  transcription TEXT,               -- 语音转文字结果
  created_at TEXT NOT NULL,
  updated_at TEXT,
  metadata TEXT                     -- JSON 元数据
);

CREATE INDEX idx_media_files_doc ON media_files(document_id);
CREATE INDEX idx_media_files_type ON media_files(file_type);
```

---

## 3. 版本历史实现

### 3.1 自动保存策略

```typescript
interface AutoSaveConfig {
  enabled: boolean;
  intervalMs: number;        // 默认 30000 (30秒)
  minChangeThreshold: number; // 最小变更字符数
  maxVersionsPerDoc: number;  // 每文档最大版本数
}

const DEFAULT_AUTO_SAVE_CONFIG: AutoSaveConfig = {
  enabled: true,
  intervalMs: 30000,
  minChangeThreshold: 50,
  maxVersionsPerDoc: 100,
};
```

### 3.2 版本保存时机

1. **自动保存**
   - 编辑器失去焦点时
   - 定时间隔（可配置，默认30秒）
   - 累计变更达到阈值

2. **手动保存**
   - 用户按 ⌘S / Ctrl+S
   - 点击保存按钮
   - 关闭编辑器时

3. **智能保存**
   - 检测到重要操作（如添加标签、引用）
   - 长时间编辑后的暂停点

### 3.3 版本清理策略

```typescript
interface RetentionPolicy {
  // 保留所有最近的版本
  recentVersionsToKeep: number;      // 默认 10
  
  // 每天保留一个版本
  dailyVersionsToKeep: number;       // 默认 7 天
  
  // 每周保留一个版本
  weeklyVersionsToKeep: number;      // 默认 4 周
  
  // 每月保留一个版本
  monthlyVersionsToKeep: number;     // 默认 12 月
  
  // 完全删除的时间
  deleteAfterDays: number;           // 默认 365 天
}
```

---

## 4. 媒体文件管理

### 4.1 存储策略

```typescript
interface MediaStorageConfig {
  maxFileSizeMB: number;             // 单文件最大大小
  allowedAudioFormats: string[];     // ['mp3', 'wav', 'm4a', 'ogg']
  allowedImageFormats: string[];     // ['jpg', 'png', 'gif', 'webp']
  compressionEnabled: boolean;       // 是否压缩
  generateThumbnails: boolean;       // 是否生成缩略图
}
```

### 4.2 媒体文件处理流程

```
用户上传媒体 → 验证格式/大小 → 生成唯一ID → 复制到媒体目录
                                    ↓
                              计算校验和
                                    ↓
                              存储元数据到数据库
                                    ↓
                   ┌────────────────┼────────────────┐
                   ↓                ↓                ↓
              生成缩略图        语音转文字        提取EXIF
              (图片/视频)       (音频)           (图片)
```

### 4.3 媒体引用

文档中通过特殊语法引用媒体：

```markdown
<!-- 音频 -->
!audio[录音标题](media://audio/abc123.mp3)

<!-- 图片 -->
![图片描述](media://images/def456.png)

<!-- 附件 -->
[文件名](media://attachments/ghi789.pdf)
```

---

## 5. 数据同步（未来功能）

### 5.1 同步架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   设备 A    │     │  云端存储   │     │   设备 B    │
│             │     │             │     │             │
│  ┌───────┐  │     │  ┌───────┐  │     │  ┌───────┐  │
│  │SQLite │◄─┼─────┼─►│ 同步  │◄─┼─────┼─►│SQLite │  │
│  └───────┘  │     │  │ 服务  │  │     │  └───────┘  │
│             │     │  └───────┘  │     │             │
│  ┌───────┐  │     │  ┌───────┐  │     │  ┌───────┐  │
│  │ 媒体  │◄─┼─────┼─►│  S3   │◄─┼─────┼─►│ 媒体  │  │
│  │ 文件  │  │     │  │ 存储  │  │     │  │ 文件  │  │
│  └───────┘  │     │  └───────┘  │     │  └───────┘  │
└─────────────┘     └─────────────┘     └─────────────┘
```

### 5.2 冲突解决策略

- **文本内容**：使用 CRDT (Conflict-free Replicated Data Types)
- **媒体文件**：按时间戳保留最新，冲突文件自动重命名
- **元数据**：合并策略（如标签取并集）

---

## 6. 备份与恢复

### 6.1 自动备份

```typescript
interface BackupConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  maxBackups: number;
  backupPath: string;
  includeMedia: boolean;
}
```

### 6.2 导出格式

支持的导出格式：
- **Markdown 打包**：所有文档 + 媒体文件
- **JSON 数据导出**：结构化数据
- **SQLite 备份**：完整数据库副本
- **Obsidian 格式**：兼容 Obsidian vault

---

## 7. 性能优化建议

### 7.1 数据库优化

1. **索引优化**
   - 为常用查询字段创建索引
   - 定期执行 `VACUUM` 和 `ANALYZE`

2. **查询优化**
   - 使用分页查询避免大结果集
   - 延迟加载媒体内容

3. **内存管理**
   - 使用 WAL 模式提高并发性能
   - 合理设置缓存大小

### 7.2 媒体文件优化

1. **懒加载**：仅在需要时加载媒体
2. **缩略图**：使用缩略图预览
3. **流式传输**：大文件使用流式读取
4. **缓存策略**：LRU 缓存常用媒体

---

## 8. 实施路线图

### Phase 1：基础版本历史 ✅
- [x] 数据库表设计
- [x] 版本历史服务
- [x] IPC 接口
- [x] 基础 UI 组件

### Phase 2：媒体管理（进行中）
- [ ] 媒体文件存储服务
- [ ] 录音文件处理
- [ ] 图片压缩和缩略图
- [ ] 媒体引用解析

### Phase 3：高级功能
- [ ] 版本对比（可视化 diff）
- [ ] 版本分支和合并
- [ ] 自动清理策略
- [ ] 批量导出

### Phase 4：云同步
- [ ] 同步服务架构
- [ ] 冲突解决
- [ ] 增量同步
- [ ] 端对端加密

---

## 9. 配置示例

```typescript
// src/main/config/storage-config.ts

export const StorageConfig = {
  database: {
    path: '~/.code-reader/data/database.sqlite',
    walMode: true,
    cacheSize: 10000,
  },
  
  versioning: {
    enabled: true,
    autoSaveInterval: 30000,
    maxVersionsPerDocument: 100,
    retentionDays: 365,
  },
  
  media: {
    basePath: '~/.code-reader/data/media',
    maxFileSizeMB: 100,
    generateThumbnails: true,
    compressionQuality: 0.8,
  },
  
  backup: {
    enabled: true,
    frequency: 'daily',
    maxBackups: 7,
    includeMedia: true,
  },
};
```

---

## 结论

采用混合存储策略是处理多种数据类型的最佳方案：

1. **文本内容**使用 SQLite + 内置版本历史
2. **媒体文件**使用文件系统存储 + 数据库元数据
3. **代码仓库**使用 Git 进行版本控制（仅用于代码阅读功能）

这种方案平衡了：
- ⚡ 性能（SQLite 快速查询）
- 📦 存储效率（大文件不进数据库）
- 🔄 版本控制（灵活的历史记录）
- 🔒 数据安全（独立备份策略）