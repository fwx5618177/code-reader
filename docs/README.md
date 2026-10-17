# 文档中心

## 文档索引

| 文档 | 内容 |
|------|------|
| [USER_GUIDE.md](./USER_GUIDE.md) | 使用指南：支持的文件格式与条目类型、Markdown 写作与公式、知识库与 AI 配置、双向链接与图谱、阅读模式、快捷键 |
| [PRODUCT.md](./PRODUCT.md) | 产品定位、核心理念、三大模式、不做什么、路线图、产品演进 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术架构、存储与版本、UI 架构、LaTeX 与 Markdown 链路、关键问题与根因记录 |

模块级说明就近放在代码旁：

- 子包说明：`packages/*/README.md`
- 桌面端模块说明：`packages/desktop/src/render/lib/*/README.md`
- 算法总览：`packages/desktop/src/render/lib/ALGORITHMS_README.md`
- 样式规范：`packages/desktop/src/render/styles/DESIGN_SYSTEM.md`

## 产品定位

个人知识库 + 写作编辑器，类似 Obsidian 与印象笔记结合的个人文档工具：

- **知识库**：AI 数据湖。高频写入、低频读取，随手丢入录音、文章、网页、文件，由 AI 自动整理、打标签、按虚拟文件夹归类、转写与总结；原始文件永久保留，总结只作为索引。
- **写作**：ProseMirror + CodeMirror 富文本编辑器，支持 Markdown，重点是在线编写并实时渲染 LaTeX。
- **阅读**：文章、电子书的阅读管理。

应用模式只有三个：knowledge（⌘1）/ writing（⌘2）/ reading（⌘3）。不再做代码阅读器，详见 [PRODUCT.md](./PRODUCT.md)。

## 仓库结构

pnpm workspace monorepo，所有子包位于 `packages/`：

| 子包 | 职责 |
|------|------|
| `desktop` | Electron + React + Vite 桌面应用，主进程（SQLite、AI、Agent、托盘）与渲染进程（UI、编辑器、LaTeX 渲染） |
| `diff-algorithm` | 文本/二进制差分、编辑距离、模糊匹配，含流式哈希、差分缓存与 Worker 支持 |
| `syntax-parser` | 增量语法解析：手写 Lezer 风格 LaTeX 解析器、LaTeX 块扫描器、语言注册表与高亮引擎、AST 缓存 |
| `format-parser` | 内容格式解析：自研 CommonMark/GFM Markdown 解析器、LaTeX 解析器、增量编辑解析 |
| `autocomplete-service` | 通用自动补全服务：补全提供者（Markdown / Emoji / 代码片段）、编辑器适配器（CodeMirror / ProseMirror） |
| `fuzzy-match-algorithm` | 补全与拼写建议的核心算法：Levenshtein / Damerau-Levenshtein 编辑距离、模糊评分、Radix Tree |
| `plugin-system` | 插件系统核心：注册表、生命周期管理、沙箱与权限控制 |
| `search-service` | 全文搜索倒排索引、文件内容搜索、模糊匹配 |
| `text-buffer` | 文本存储数据结构：Piece Table、Rope、Gap Buffer |

## 常用命令

```bash
pnpm install                 # 安装依赖（desktop 的 postinstall 会为 Electron 重编译 better-sqlite3）
pnpm dev:desktop             # 启动桌面端开发模式
pnpm build:desktop           # 构建桌面端
pnpm build:libs              # 构建除 desktop 外的全部子包

pnpm typecheck               # 全部子包类型检查
pnpm test                    # 运行所有带 test 脚本的子包测试
pnpm test:<子包名>            # 单个子包测试，例如 pnpm test:text-buffer
pnpm --filter @code-reader/desktop test:writing   # 写作服务模块测试

pnpm benchmark               # 运行所有带 benchmark 脚本的子包基准测试
pnpm benchmark:diff-algorithm                     # 单独运行差分基准
```
