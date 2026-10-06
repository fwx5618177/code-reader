# 技术架构与工程记录

本文描述当前代码的真实结构（以代码为准），以及 LaTeX 编辑器开发过程中关键问题的根因与最终方案。产品层面的取舍见 [PRODUCT.md](./PRODUCT.md)。

## 1. 总体分层

```
┌──────────────────────────────────────────────────────────────┐
│ 渲染进程 packages/desktop/src/render（React 18 + Vite）       │
│  components/  UI 组件（每个组件配套 *.module.scss）            │
│  lib/         业务模块：latex / math / writing / documents /  │
│               core / file-system / folders / autocomplete /   │
│               editor / plugins / content-parser / algorithms  │
│  theme/ services/ contexts/ hooks/ types/                     │
├──────────────────────────── IPC（preload 白名单通道）─────────┤
│ 主进程 packages/desktop/src/main（Electron）                   │
│  database/  better-sqlite3、FTS5 搜索、语义搜索、版本历史       │
│  ai/        AI Provider 服务（OpenAI / Anthropic SDK 等）       │
│  agent/     后台 Agent 任务执行器                              │
│  tray/      托盘                                              │
├──────────────────────────────────────────────────────────────┤
│ 可复用子包 packages/*（与 UI 无关的算法与服务）                 │
│  text-buffer  syntax-parser  format-parser  diff-algorithm    │
│  search-service  autocomplete-service  fuzzy-match-algorithm  │
│  plugin-system                                                │
└──────────────────────────────────────────────────────────────┘
```

依赖方向：desktop 依赖子包，子包之间不依赖 desktop。desktop 内部 `lib/autocomplete`、`lib/plugins` 是对 `@code-reader/autocomplete-service`、`@code-reader/plugin-system` 的再导出与本地补充；`lib/core/delta` 是 `@code-reader/diff-algorithm` 的业务封装；`lib/latex` 依赖 `@code-reader/syntax-parser` 与 `@code-reader/text-buffer`。

## 2. 主进程

| 模块 | 文件 | 职责 |
|------|------|------|
| SQLite | `main/database/sqlite.ts` | better-sqlite3，WAL 模式；数据库位于 `app.getPath('userData')/data/knowledge.db` |
| 全文搜索 | `sqlite.ts`、`search-ipc-handlers.ts` | FTS5 虚拟表 `items_fts`，分词器 `unicode61 remove_diacritics 2` |
| 语义搜索 | `semantic-search.ts` | 调用 AI 服务生成查询向量，与 `embeddings` 表比对 |
| 版本历史 | `version-history.ts`、`version-ipc-handlers.ts` | `document_versions` 表；IPC 通道 `version:*` |
| AI 服务 | `main/ai/ai-service.ts` | 多 Provider（openai / anthropic / deepseek / moonshot / zhipu / ollama）：对话、向量、总结、提取标签、转写 |
| Agent 执行器 | `main/agent/agent-executor.ts` | 后台任务：transcribe / summarize / extract-tags / generate-embedding / find-related，结果写回 `knowledge_items` 并推送进度 |
| 窗口 | `main/index.ts` | 主窗口与按模式打开的子窗口（`createChildWindow`） |

主要数据表：`knowledge_items`、`tags`、`item_tags`、`folders`、`projects`、`links`、`agent_tasks`、`app_settings`、`ai_providers`、`embeddings`、`document_versions`、`schema_version`。代码阅读时期的 Git 表与 `git-service.ts` 已删除；已有数据库中残留的 `git_*` 表不再被读写。

## 3. 渲染进程模块

| 模块 | 职责 |
|------|------|
| `components/RichEditor` | 唯一编辑器入口：ProseMirror 文档编辑 + CodeMirror 代码块（`CodeBlockView`）+ 数学节点（`MathNodeView`）；`.tex` 文件切换为 `LatexEditor`（源码 / 渲染 / 分栏） |
| `lib/latex` | LaTeX 文档模型、增量引擎、渲染器、Worker、高度映射与滚动同步（见第 6 节） |
| `lib/math` | 自研数学公式解析与渲染（不依赖 KaTeX / MathJax） |
| `lib/documents` | 文档 CRUD、文件类型（markdown / latex / plain）、`useDocuments`；`versions/` 为版本历史（reducer + service + `useVersions`） |
| `lib/core` | 版本化编辑基础：EditorModel（versionId + contentHash）、拉取式 SaveEngine、撤销重做、IndexedDB 离线存储、操作日志与同步接口（仅类型） |
| `lib/writing` | 写作服务：全文索引、搜索建议、差分（Worker 池）、索引持久化（IndexedDB）、性能监控，以及 SearchBox / DiffViewer 组件 |
| `lib/file-system`、`lib/folders` | 写作文件树模型、拖拽、虚拟文件夹 |
| `lib/autocomplete`、`lib/editor` | 补全服务接入 CodeMirror / ProseMirror，语言注册表，ProseMirror 输入规则 |
| `lib/plugins` | 插件系统再导出与编辑器桥接 |
| `theme/` | ThemeProvider：light / dark / system，强调色，字体，写入 CSS 变量 |

## 4. 存储与版本

| 数据 | 存储方式 |
|------|----------|
| 知识条目、标签、文件夹、Agent 任务、设置 | 主进程 SQLite |
| 文档版本快照 | SQLite `document_versions`；渲染侧 `useDocuments` 每 5 分钟（`VERSION_INTERVAL_MS = 300000`）自动创建一次版本，另可手动创建、预览、恢复、清理 |
| 编辑中文档的离线状态、待同步操作 | 渲染侧 IndexedDB（`lib/core/storage`） |
| 写作搜索索引 | IndexedDB（`lib/writing/index-storage.ts`），变更后自动持久化，启动时加载 |
| LaTeX 编辑中文本 | `@code-reader/text-buffer`：`selectBufferType` 默认 Piece Table，超过 10MB 选 Rope |

设计方向（尚未实现，保留为约束）：

- 文本内容进 SQLite 并做版本历史；录音、图片、PDF 等媒体放文件系统，数据库只存元数据与校验和。大二进制不进 Git、不进数据库。
- 原始文件永久保留，转写与总结作为派生字段和索引。
- 版本保留策略：近期全部保留，更早的按日 / 周 / 月抽样保留。
- 同步：文本用 CRDT 解决冲突，媒体按时间戳保留并重命名冲突文件，标签等元数据取并集。

## 5. UI 架构

| 区域 | 职责 |
|------|------|
| TitleBar | 窗口控制、模式标签（knowledge / writing / reading）、搜索入口、进入专注模式 |
| Ribbon | 左侧图标栏：随当前模式变化的导航按钮、快速操作、设置入口 |
| Sidebar | 当前模式的导航：知识库为虚拟文件夹，写作为 WritingSidebar 文件树（可选文件类型新建），阅读为阅读侧栏 |
| MainContent | 编辑器 / 查看器 |
| EditorFooter | 字数、保存状态、版本历史按钮 |

快捷键（`App.tsx`）：⌘N 快速输入（文本）、⌘⇧R 快速输入（录音）、⌘P 搜索、⌘, 设置、⌘B 侧边栏、⌘S 保存、⌘1/2/3 切换模式、⌘⇧F 专注模式、Esc 退出专注或关闭弹窗。

样式约定（详见 `packages/desktop/src/render/styles/DESIGN_SYSTEM.md`）：

- 组件样式只写在 `*.module.scss`，tsx 中不写样式。
- 颜色、间距、圆角、字号、阴影使用 CSS 变量 `var(--xxx)`，运行时随主题切换；布局尺寸、过渡、字重、z-index 使用 SCSS 变量。
- 浅色主题在 SCSS 编译期固定会导致切换失效，所以颜色禁止直接用 SCSS 变量（这是早期 Light 模式文字不可见的根因）。

## 6. LaTeX 渲染链路

```
CodeMirror 源码编辑（codemirror-latex：高亮）
   │ 变更
   ▼
LatexDocument（latex-document.ts）── 文本存储：@code-reader/text-buffer
   │
   ▼
IncrementalLatexEngine（incremental-engine.ts）
   ├─ 解析器自动选择（parserType: 'auto'）
   │    < 10KB  → 手写 Lezer 风格解析器（syntax-parser/src/lezer/latex）
   │    ≥ 10KB  → “tree-sitter”分支，实际为 syntax-parser 的 LatexBlockScanner
   │             （以 TSTreeSitterParser 别名导出，纯 TS，无 WASM）
   ├─ ASTCacheManager 单例缓存（节点只存偏移量，零拷贝）
   └─ 内存压力监控（chunk-pool.ts 的 MemoryMonitor）
   │
   ▼
LatexRenderer（renderer.ts）→ 块级元素带 data-block-id / data-source-start / data-source-end
   └─ 数学：lib/math 自研渲染；math-worker 在 Worker 中批量渲染
   │
   ▼
预览 DOM ── 测量 → HeightMap / RealHeightMap ── 双向滚动同步
```

LatexEditor 中的关键阈值（`LatexEditor.tsx`）：

| 常量 | 值 | 作用 |
|------|----|------|
| `LARGE_FILE_THRESHOLD` / `HUGE_FILE_THRESHOLD` | 50KB / 200KB | 决定防抖（150 / 300 / 500ms）与渲染超时（10 / 30 / 60s） |
| `VIRTUAL_SCROLL_THRESHOLD` | 100KB | 超过后预览使用虚拟滚动 |
| `SCROLL_SYNC_DELAY_MS` | 50ms | 滚动同步延迟 |
| `SCROLL_LOCK_DURATION_MS` | 200ms | 一侧驱动滚动后锁定另一侧，防止循环 |
| `SCROLL_SYNC_MIN_DELTA` | 0.02 | 滚动比例变化小于该值不触发同步 |
| `RENDER_SCROLL_LOCK_DURATION_MS` | 500ms | 渲染期间锁定滚动同步 |

技术决策：

- **不用“限制”处理大文件**：限制文件大小或降级功能只是绕过问题。采用分块 / 流式解析、帧预算调度（每帧约 8ms）、可见区域优先、Worker 后台任务、内存压力回收。
- **增量更新不用 VCDIFF**：VCDIFF（RFC 3284）面向字节级的存储 / 传输压缩，每次编辑都要算 diff；编辑器本身就知道变更位置。行业做法是分三层：文本存储（Piece Table / Rope）→ 增量解析（Lezer / Tree-sitter 类）→ AST 节点级 diff 与 DOM 局部更新。VS Code、CodeMirror 6、Lapce 都是这个思路。
- **不用 KaTeX**：数学渲染完全自研（`lib/math`）。

## 7. 关键问题与根因记录

提炼自已删除的过程性文档（latex 目录下的 FIX_SUMMARY / SCROLL_RENDER_FIX / PERFORMANCE_GUIDE / CHANGELOG / IMPLEMENTATION_SUMMARY，以及 RichEditor 目录下的 SCROLL_RENDER_FIX_V2）。

| 问题 | 根因 | 最终方案 |
|------|------|----------|
| 大文件编辑 OOM（V8 “Committing semi space failed”，堆约 4GB 时崩溃） | AST 与内容在 IncrementalLatexEngine、LatexEngine、IncrementalLatexParser 中被重复缓存 3 份以上；LRU 过大（1000 节点 + 500 渲染结果）；每个 AST 节点保存完整 `raw` 字符串；分块解析的中间结果没有及时释放 | `ASTCacheManager` 单例统一缓存（最多 3 个 AST、200 个节点），节点只存 `(start, end)` 偏移，按需从源文本切片；不活跃 AST 降级为 WeakRef；引擎本地缓存降为 200 节点 / 100 渲染结果、TTL 1 分钟；按内存压力等级（LOW/MEDIUM/HIGH/CRITICAL）清理缓存 |
| 源码与预览位置映射不准 | Source Map 用“行数 × 24px”估算渲染高度，数学块严重失真；渲染器未输出 `data-block-id`，`measureDOMBlocks()` 找不到元素返回空数组，测量回写实际无效 | 渲染器为段落、章节、数学块、数学环境、列表、环境输出 `data-block-id` 与源码偏移；渲染后 DOM 测量回写 HeightMap / RealHeightMap，ResizeObserver 持续更新；同步优先用已测量块的真实位置 |
| 左侧源码滚动时被自动拉回 | 一：锁定时间太短（50ms），source → preview → source 形成循环。二（真正根因）：渲染更新 `innerHTML` 引起浏览器调整预览滚动位置并触发 `onScroll`，而渲染锁定只在 `handleScroll` 入口检查，`setTimeout` 延迟回调执行时锁定已解除，于是反向驱动了源码滚动 | 锁定时长加到 200ms；渲染期间单独锁定（500ms）；用 ref 保存锁定状态并在延迟回调内部再次检查；滚动比例变化低于阈值时忽略 |
| 矩阵 / 对齐公式显示成带边框的表格 | 自研渲染器用 `<table class="math-matrix-table">` 等实现矩阵、cases、aligned、gathered，而 `.latexPreviewContent` 的通用 `table` 样式没有排除这些类 | 通用表格选择器加 `:not(.math-*-table)` 排除；数学表格强制无边框、透明背景 |
| `align` 多行公式渲染错误 | `\begin{align}...\end{align}` 内容未包装为 `aligned` 处理 | 渲染器自动识别并包装；数学环境检测统一收敛到 `math-env-handler.ts`（align / flalign / alignat / eqnarray / gather / multline / matrix 系列 / cases 系列 / aligned / gathered / split） |
| 数学环境渲染缺属性 | `renderMathEnvironment` 使用了未定义的 `blockAttrs` | 方法内调用 `getBlockAttributes(node)` 生成 |
| 极限下标显示在右下角 | `math-limit-style` 的 CSS 结构与渲染器输出不一致 | 改为纵向 inline-flex，上下标居中排列 |
| 预览中的“黑色方块” | 不是 bug：是 `\blacksquare`（QED 符号）的正确渲染 | 无需修复；空数学块用 `.latex-math-empty` 隐藏 |
| `\lim`、`\frac` 显示为原文 | 数学命令写在数学模式之外（未用 `$...$`、`\[...\]` 或数学环境包裹） | 属于输入问题，非渲染缺陷 |
| 保存 `.tex` 后变成 `.md` | 修改标题时可能丢掉扩展名，导致文件类型改变 | `handleTitleChange` 自动保留原扩展名 |
| 源码视图挡住文件树点击 | 全文源码编辑器层级高于侧边栏 | 源码编辑器与 RichEditor 处于同一层级（`position: relative; z-index: 0`） |
| Light 模式文字不可见 | 组件颜色使用 SCSS 变量，编译期固定为深色值 | 颜色统一改为 CSS 变量 |

### 性能数据

上述过程文档中出现的所有性能数字（例如“50KB 解析 < 100ms”“偏移 < 10px”“100KB 增量解析 < 5ms”）都标注为“预期指标”或目标值，不是实测结果，本文不采用。真实数据以运行基准测试为准：

```bash
pnpm benchmark                # 运行全部子包基准（等价于逐个执行下列命令）
pnpm benchmark:diff-algorithm
pnpm --filter @code-reader/syntax-parser benchmark
pnpm --filter @code-reader/format-parser benchmark
pnpm --filter @code-reader/fuzzy-match-algorithm benchmark
```

渲染进程另有运行时监控：`lib/latex/performance-monitor.ts`、`lib/writing/performance-monitor.ts`，写作服务基准为 `lib/writing/benchmark.ts`（`runQuickBenchmark` / `runFullBenchmark`）。
