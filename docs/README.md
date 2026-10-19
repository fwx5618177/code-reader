# 文档中心

## 文档索引

| 文档 | 内容 |
|------|------|
| [USER_GUIDE.md](./USER_GUIDE.md) | 使用指南：界面布局与侧栏面板、支持的文件格式与条目类型、Markdown 写作（标签页与两栏编辑、页面设置、版本保留）与公式、知识库与 AI 配置（归类审阅、日历日记）、双向链接与块级引用、图谱与实体关系、阅读模式（扫描版 PDF 识别、跨页高亮）、多知识库与数据位置、快捷键、插件的使用与编写 |
| [PRODUCT.md](./PRODUCT.md) | 产品定位、核心理念、三大模式、不做什么、路线图、产品演进 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术架构、存储与版本、UI 架构、LaTeX 与 Markdown 链路、子包接入对照、关键问题与根因记录 |
| [FORMAT_PARSER_RESEARCH.md](./FORMAT_PARSER_RESEARCH.md) | format-parser 能否替代 markdown-it：CommonMark 规范一致性、性能与增量对比、分阶段方案 |

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
| `desktop` | Electron + React + Vite 桌面应用，主进程（多知识库、SQLite、AI、Agent、OCR 资源、插件目录、托盘）与渲染进程（UI、编辑器、LaTeX 渲染、插件运行时） |
| `diff-algorithm` | 文本/二进制差分、编辑距离、模糊匹配、Histogram 行差分，含差分缓存与 Worker 支持 |
| `diff-algorithm-extras` | desktop 未使用的差分算法：rsync / 滚动哈希、Patience、LCS、VCDIFF / BSDiff、CRDT 接口、流式哈希与差分、独立的 diff-match-patch Worker（与核心库解耦，按需引入） |
| `syntax-parser` | 增量语法解析：手写 Lezer 风格 LaTeX 解析器、LaTeX 块扫描器、语言注册表与高亮引擎、AST 缓存（desktop 用其 LaTeX 解析器做语法诊断、折叠与大纲） |
| `format-parser` | 内容格式解析：自研 CommonMark/GFM Markdown 解析器、LaTeX 解析器（交叉引用索引、文档元数据）、增量编辑解析（desktop 用其 LaTeX 解析器做交叉引用检查） |
| `autocomplete-service` | 通用自动补全服务：补全提供者（Markdown / Emoji / 代码片段）、编辑器适配器（CodeMirror / ProseMirror） |
| `fuzzy-match-algorithm` | 补全与拼写建议的核心算法：Levenshtein / Damerau-Levenshtein 编辑距离、模糊评分、Radix Tree |
| `plugin-system` | 插件基础库：贡献点类型、生命周期编排（版本范围、依赖解析、激活事件）、扩展点注册表（desktop 全部使用，运行时为 `desktop/src/render/lib/plugins` 的 Worker 沙箱） |
| `plugin-system-extras` | desktop 未使用的同进程插件管理器与插件沙箱（按需引入） |
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

# 本地打包（先 pnpm build:libs）：构建 → scripts/stage-app.mjs 整理 .app-stage（只含 dist 与 better-sqlite3）→ electron-builder
pnpm --filter @code-reader/desktop pack           # 只生成未压缩的应用目录，用于自测
pnpm --filter @code-reader/desktop dist:mac       # dmg / zip（x64 + arm64）；dist:win 为 nsis + portable，dist:linux 为 AppImage + deb
```

## 持续集成与发布

- `.github/workflows/ci.yml`：push main 与 PR 时运行类型检查、单元测试与基准测试。
- `.github/workflows/release.yml`：推送 `v*` 标签（如 `git tag v0.2.0 && git push origin v0.2.0`）或在 Actions 页手动触发。先做类型检查与测试，再在 macOS / Windows / Linux 三个运行器上分别打包；标签触发时把全部安装包与 `SHA256SUMS.txt` 上传到 GitHub Release **草稿**，人工确认后发布；手动触发只保留为构建产物（Artifacts）。版本号取自标签。
- 代码签名可选：在仓库 Secrets 中配置 `CSC_LINK` / `CSC_KEY_PASSWORD`（macOS 证书）、`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`（公证）、`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（Windows 证书）；未配置时产出未签名安装包（macOS 首次打开需右键→打开）。
