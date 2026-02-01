# 📚 Code Reader 文档中心

> 从代码阅读器到智能知识库的演进之路

---

## 📁 文档结构

| 文档 | 描述 |
|------|------|
| [01-project-analysis.md](./01-project-analysis.md) | 当前项目分析报告，包括技术栈、模块状态和现有问题 |
| [02-requirements-todo.md](./02-requirements-todo.md) | 新需求分析与 TODO 清单，智能知识库的完整规划 |
| [03-ui-refactor-plan.md](./03-ui-refactor-plan.md) | UI 重构计划，参考 Obsidian 的设计规范 |

---

## 🎯 项目愿景

### 原始目标：代码阅读器
- 分析代码依赖关系
- 生成依赖图和流程图
- 支持代码笔记

### 新目标：智能知识库（Second Brain）
- **无脑输入** - 直接往里塞信息，不需要整理
- **AI 整理** - 自动打标签、分类、建文件夹
- **智能检索** - 语义搜索、RAG 问答
- **多端打通** - 桌面、移动、眼镜等设备

---

## 💡 核心理念

```
┌─────────────────────────────────────────────────────────┐
│                    Data Lake 模式                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   📥 输入（高频）          🤖 AI 处理          📤 输出（低频）│
│   ──────────────        ──────────        ──────────── │
│   • 录音                 • 转写            • 搜索查询    │
│   • 文章                 • 总结            • 智能问答    │
│   • 笔记碎片             • 打标签          • 知识图谱    │
│   • 网页剪藏             • 分类整理        • 关联推荐    │
│                                                         │
│   ✅ 保留原始数据          ✅ 总结只是索引                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 开发路线图

### Phase 1: 基础 ✅ 进行中
- [x] 项目架构搭建 (monorepo)
- [x] 基础 UI 框架 (Electron + React)
- [x] 文件树浏览
- [x] 代码查看器
- [ ] **UI 样式重构** (Obsidian 风格) ← 当前

### Phase 2: 知识库基础
- [ ] 数据存储层设计
- [ ] 快速输入入口
- [ ] 虚拟文件系统
- [ ] 全文搜索

### Phase 3: AI Agent
- [ ] Agent 框架
- [ ] 语音转写 Agent
- [ ] 自动标签 Agent
- [ ] 内容总结 Agent

### Phase 4: 高级功能
- [ ] 语义搜索
- [ ] RAG 问答
- [ ] 知识图谱
- [ ] 多端同步

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Electron + React 18 |
| 语言 | TypeScript |
| 构建 | Vite |
| 样式 | SCSS + Design System |
| 包管理 | pnpm workspace (monorepo) |
| 图标 | lucide-react |
| 代码高亮 | Prism.js |

---

## 📋 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev:desktop

# 构建
pnpm build:desktop
```

---

## 📝 贡献指南

1. 阅读 [项目分析报告](./01-project-analysis.md) 了解现状
2. 查看 [TODO 清单](./02-requirements-todo.md) 选择任务
3. 参考 [UI 设计规范](./03-ui-refactor-plan.md) 保持风格统一

---

## 🔗 相关资源

- [Obsidian](https://obsidian.md/) - UI 设计参考
- [Electron](https://www.electronjs.org/) - 桌面应用框架
- [lucide](https://lucide.dev/) - 图标库