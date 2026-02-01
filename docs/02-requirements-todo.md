# 智能知识库 - 需求分析与 TODO

> 核心理念：无脑输入，AI 整理，智能检索

**最后更新**: Phase 1 大部分完成，Phase 2 开始中

## 🎯 项目愿景

将原本的"代码阅读器"升级为**智能知识库（Second Brain）**系统。用户只需要往里面"喂"各种原始信息（录音、文章、笔记碎片等），系统自动帮助整理、打标签、分类，并提供智能问答能力。

---

## 📊 核心设计原则

| 原则 | 说明 |
|------|------|
| **高频写入，低频读取** | 类似日志系统，写入多、读取少 |
| **冷热数据分离** | 大部分是冷数据，少部分热数据，读取时短期集中频繁读 |
| **原始数据保留** | 总结只是索引，原始文件必须保留 |
| **虚拟文件夹** | 文件夹结构可以是动态生成的，不需要真实目录 |
| **AI 驱动** | 整理、打标签、分类全部由 AI Agent 完成 |

---

## 🚀 Phase 1: 基础设施

### 1.1 数据存储层（DataLake 模式）
- [x] 设计统一的数据模型（Note/Document/Media）✅ 已完成
  - 创建 `types/knowledge.ts` 包含完整的类型定义
  - `KnowledgeItem` - 核心数据单元
  - `Tag`, `Folder`, `Project` - 组织结构
  - `AgentTask` - AI 任务队列
  - `AppSettings` - 应用设置
- [x] 实现本地存储引擎（JSON 文件系统）✅ 已完成
  - 创建 `services/knowledgeStorage.ts`
  - 支持 CRUD 操作
  - 自动保存和加载
- [x] 迁移到 SQLite 提升性能 ✅ 架构完成
  - 创建 `services/database.ts` - SQLite 服务层
  - 完整的表结构设计（knowledge_items, tags, folders, projects, links, agent_tasks）
  - FTS5 全文搜索支持
  - 索引优化
  - 需要在 main process 实现 better-sqlite3 绑定
- [ ] 支持多种格式导入：
  - [x] Markdown / 文本 ✅
  - [ ] 音频文件（mp3, m4a, wav）
  - [x] 图片 ✅
  - [ ] PDF
  - [ ] 网页剪藏
- [x] 元数据管理（创建时间、来源、类型等）✅
- [ ] 版本控制/历史记录

### 1.2 虚拟文件系统
- [x] 设计虚拟文件夹数据结构 ✅ 已完成
  - `VirtualFolders` 组件（`components/VirtualFolders/`）
  - 支持 manual / smart / auto 三种类型
  - FilterRule 规则定义
- [x] 支持动态分组视图 ✅ 已完成
  - [x] 按标签分组
  - [x] 按时间分组
  - [x] 按类型分组
  - [x] 按项目/主题分组
  - [x] 自定义分组
- [x] 支持多维度筛选 ✅ 基础实现
- [x] 智能文件夹（自动规则匹配）✅ 架构完成
  - 预设智能文件夹：全部、最近、收藏、未标签
  - 自定义规则编辑器（待完善）

### 1.3 快速输入系统
- [x] 全局快捷键唤起 ✅ `Cmd/Ctrl + N`
- [x] 快速笔记输入框 ✅ 已完成 `QuickInput` 组件
- [x] 拖拽导入文件 ✅
- [x] 剪贴板自动捕获 ✅ 支持粘贴图片
- [x] 录音按钮（直接录音导入）✅ 支持 WebRTC 录音
- [x] 标签输入 ✅
- [x] 多种输入类型切换（文字/语音/图片/文件/网址）✅

---

## 🤖 Phase 2: AI Agent 系统

### 2.1 Agent 框架
- [x] 设计 Agent 基础架构 ✅ 已完成
  - 创建 `types/ai-providers.ts` - 完整的 AI Provider 类型定义
  - 创建 `services/aiConfigService.ts` - AI 配置管理服务
  - 支持多 Provider 切换（OpenAI, Anthropic, DeepSeek, Moonshot, 智谱, Ollama）
- [x] Agent 任务队列 ✅ 数据结构完成
  - AgentTask 类型定义
  - 优先级和重试机制
  - 状态追踪（pending, processing, completed, failed）
- [ ] Agent 状态管理（待实现执行器）
- [ ] 后台处理机制（待实现 worker）

### 2.2 语音转写 Agent
- [x] 集成语音识别 API 架构 ✅ 已完成
  - 支持多 Provider：OpenAI Whisper, Azure Speech, 讯飞, 火山引擎, Local Whisper
  - `TranscriptionProviderConfig` 配置类型
  - 预设模板（`TRANSCRIPTION_PROVIDER_PRESETS`）
- [ ] 自动检测音频文件并转写
- [ ] 生成带时间戳的文本
- [ ] 支持多语言

### 2.3 内容总结 Agent
- [x] API 调用接口定义 ✅
  - `SummarizeRequest` / `SummarizeResponse` 类型
- [ ] 长文本自动摘要实现
- [ ] 关键信息提取
- [ ] 生成结构化大纲
- [ ] 保留原始内容关联

### 2.4 自动标签 Agent
- [x] API 调用接口定义 ✅
  - `ExtractTagsRequest` / `ExtractTagsResponse` 类型
- [ ] 智能分析内容主题
- [ ] 自动生成标签建议
- [ ] 标签合并/同义词处理
- [ ] 标签层级管理

### 2.5 分类整理 Agent
- [ ] 自动推荐文件夹归属
- [ ] 相似内容聚类
- [ ] 知识点关联发现
- [ ] 定期整理建议

---

## 🔍 Phase 3: 知识检索

### 3.1 全文搜索
- [x] 建立全文索引 ✅ 已完成
  - SQLite FTS5 全文搜索表
  - 自动同步触发器
  - 创建 `SearchPanel` 组件
- [x] 支持中文分词 ✅ 使用 unicode61 tokenizer
- [x] 高亮匹配结果 ✅ SearchResult 支持 highlights
- [x] 搜索历史 ✅ 本地存储最近搜索
- [x] 搜索 UI ✅ 完成
  - 全局快捷键 `⌘P` 唤起
  - 类型筛选、时间范围筛选
  - 键盘导航支持

### 3.2 语义搜索
- [ ] 内容向量化（Embedding）
- [ ] 相似内容推荐
- [ ] 自然语言查询

### 3.3 智能问答
- [ ] 基于知识库的 RAG 问答
- [ ] 上下文感知对话
- [ ] 引用溯源
- [ ] 多轮对话

### 3.4 知识图谱
- [ ] 自动提取实体关系
- [ ] 可视化知识网络
- [ ] 反向链接
- [ ] 关联推荐

---

## 🎨 Phase 4: UI/UX 优化

### 4.1 Obsidian 风格界面
- [x] 重新设计整体布局 ✅
  - 自定义标题栏（无边框窗口）
  - Ribbon 侧边栏（图标导航）
  - 可折叠侧边栏
  - 状态栏
- [x] 优雅的深色主题 ✅
  - 创建 `variables.scss` 设计系统
  - 统一颜色、间距、字体、阴影
- [x] 模式切换 ✅ 新增
  - `ModeSwitch` 组件 - 下拉式模式选择器
  - `ModeTabs` 组件 - 标签页式模式选择
  - 四种模式：代码阅读、知识库、日记、专注
  - 快捷键：⌘1/2/3 切换模式，⌘⇧F 专注模式
- [x] 专注模式 ✅ 新增
  - 隐藏所有 UI 元素的沉浸式写作环境
  - Esc 退出
- [ ] 浅色主题（待实现）- Settings 面板已有 UI
- [x] 可折叠面板 ✅ 完成
- [ ] 标签页系统
- [ ] 分割视图

### 4.2 侧边栏优化
- [x] 文件树美化 ✅
  - lucide 图标
  - 文件类型颜色
  - 展开/折叠动画
  - 空状态提示
- [x] 搜索框 ✅ 通过 SearchPanel 实现
- [x] 虚拟文件夹 ✅ `VirtualFolders` 组件
- [ ] 标签云
- [x] 最近文件 ✅ 智能文件夹中实现
- [x] 收藏夹 ✅ 智能文件夹中实现

### 4.3 编辑器升级
- [ ] Markdown 实时预览
- [x] 代码高亮 ✅ Prism.js
- [x] 行号显示 ✅
- [x] 文件信息显示 ✅
- [x] 复制/全屏功能 ✅
- [ ] 双向链接 `[[]]`
- [ ] 嵌入预览

### 4.4 状态与反馈
- [x] 底部状态栏 ✅ 已完成
- [ ] Agent 处理进度
- [ ] 同步状态
- [ ] 快捷操作

### 4.5 设置面板 ✅ 新增
- [x] `SettingsPanel` 组件
- [x] AI 服务配置
  - 添加/编辑/删除 LLM Provider
  - 测试连接功能
  - API Key 安全存储（混淆）
- [x] 语音转写服务配置
- [x] 外观设置（主题、强调色、字体）
- [x] 快捷键查看
- [x] 通用设置（数据目录、快速输入配置）

---

## 🔌 Phase 5: 扩展与集成

### 5.1 设备打通
- [ ] 移动端 App
- [ ] 智能眼镜集成
- [ ] 浏览器插件
- [ ] 微信/Telegram Bot

### 5.2 数据同步
- [ ] 多设备同步
- [ ] 冲突解决
- [ ] 离线支持

### 5.3 导入导出
- [ ] 批量导入已有笔记（Notion/Obsidian/印象笔记）
- [ ] 标准格式导出
- [ ] 备份与恢复

---

## 📋 优先级排序

### 🔴 P0 - 立即开始
1. ~~UI 样式重构（Obsidian 风格）~~ ✅ 已完成
2. ~~快速输入入口~~ ✅ 已完成
3. ~~基础数据模型设计~~ ✅ 已完成
4. ~~模式切换（代码阅读/知识库/日记/专注）~~ ✅ 已完成
5. ~~AI API 插件系统~~ ✅ 已完成
6. ~~全文搜索~~ ✅ 已完成
7. ~~虚拟文件夹~~ ✅ 已完成
8. ~~SQLite 数据库架构~~ ✅ 已完成

### 🟠 P1 - 核心功能（进行中）
9. 实现 main process SQLite 绑定（better-sqlite3）
10. 连接 AI API 实际调用
11. 自动标签 Agent 执行器
12. 语音转写 Agent 执行器

### 🟡 P2 - 增强功能
13. 内容总结 Agent
14. 语义搜索（向量嵌入）
15. 知识图谱可视化
16. 浅色主题

### 🟢 P3 - 长期规划
17. 设备打通
18. 多端同步
19. 插件系统

---

## 📝 备注

- **类比**: 这个系统类似一个 "Data Lake"，往里面扔"原始数据"，系统帮你整理成有价值的信息
- **关键洞察**: 笔记的本质是"高频写入，低频读取"，所以写入要够快够无脑
- **设计哲学**: 用户不需要花时间整理，整理是 AI 的事

---

## 📁 新增文件清单

### 类型定义
- `types/ai-providers.ts` - AI Provider 配置类型、预设模板
- `types/app-modes.ts` - 应用模式类型、状态管理

### 服务
- `services/aiConfigService.ts` - AI 配置管理服务
- `services/database.ts` - SQLite 数据库服务

### 上下文
- `contexts/AppContext.tsx` - 全局状态 Context

### 组件
- `components/SearchPanel/` - 全文搜索面板
- `components/SettingsPanel/` - 设置面板
- `components/ModeSwitch/` - 模式切换组件
- `components/VirtualFolders/` - 虚拟文件夹组件

---

## 🎹 快捷键一览

| 快捷键 | 功能 |
|--------|------|
| `⌘ N` | 快速输入 |
| `⌘ O` | 打开文件夹 |
| `⌘ P` | 全局搜索 |
| `⌘ ,` | 设置 |
| `⌘ B` | 切换侧边栏 |
| `⌘ 1` | 代码阅读模式 |
| `⌘ 2` | 知识库模式 |
| `⌘ 3` | 日记模式 |
| `⌘ ⇧ F` | 专注模式 |
| `Esc` | 退出专注模式/关闭弹窗 |