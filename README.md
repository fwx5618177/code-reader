# Code Reader

个人知识库 + 写作编辑器：随手收集想法、录音、网页与文件，由 AI 整理；用 Typora 式所见即所得的 Markdown 和实时渲染的 LaTeX 写长文；在应用里阅读网页、PDF、EPUB 并摘录。所有数据只保存在本机。

## 从这里开始

**第一次使用，请读 [使用指南 · 第 1 节「从这里开始」](docs/USER_GUIDE.md#1-从这里开始)**：安装与启动、认识界面、跟着做一遍，以及“我想做某件事该看哪一节”。应用里随时按 **F1**（或点左侧竖排按钮最下方的书本图标、菜单栏 **帮助 → 使用指南**）也能打开同一份指南。

从源码运行（需要 Git 与 Node.js 22）：

```bash
git clone https://github.com/fwx5618177/code-reader.git
cd code-reader
corepack enable        # 启用仓库指定的 pnpm 版本
pnpm install
pnpm build:libs        # 构建内部子包
pnpm start:desktop     # 构建并启动应用
```

## 三种模式

| 模式 | 用来做什么 |
|------|-----------|
| 知识库（⌘1） | 收集一切：想法、录音、截图、文件、网页。AI 自动转写、写摘要、打标签、找关联，支持问答 |
| 写作（⌘2） | Markdown 笔记（输入即渲染、`[[ ]]` 双向链接、公式、表格）与 LaTeX 论文（源码 + 实时渲染） |
| 阅读（⌘3） | 网页剪藏、PDF、EPUB 的阅读、高亮与摘录 |

## 文档

| 文档 | 给谁看 |
|------|--------|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 使用者：全部功能的用法、支持的文件格式、快捷键、常见问题、插件、导入导出与同步 |
| [docs/README.md](docs/README.md) | 开发者：仓库结构、常用命令、持续集成与发布 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 开发者：技术架构与关键问题的根因记录 |
| [docs/PRODUCT.md](docs/PRODUCT.md) | 产品定位与路线图 |
