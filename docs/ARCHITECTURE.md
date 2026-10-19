# 技术架构与工程记录

本文描述当前代码的真实结构（以代码为准），以及 LaTeX 编辑器开发过程中关键问题的根因与最终方案。产品层面的取舍见 [PRODUCT.md](./PRODUCT.md)。

## 1. 总体分层

```
┌──────────────────────────────────────────────────────────────┐
│ 渲染进程 packages/desktop/src/render（React 18 + Vite）       │
│  components/  UI 组件（每个组件配套 *.module.scss）            │
│  lib/         业务模块：latex / math / markdown / writing /    │
│               documents / core / file-system / folders /      │
│               editor / editor-tabs / plugins / spellcheck /   │
│               knowledge / links / reading / agent / entities /│
│               categorization                                  │
│  theme/ services/ hooks/ types/                               │
├──────────────────────────── IPC（preload 白名单通道）─────────┤
│ 主进程 packages/desktop/src/main（Electron）                   │
│  workspace/ 多知识库注册表与切换                            │
│  flush/     切换、关窗、退出前的渲染进程落盘协调            │
│  database/  better-sqlite3、FTS5 搜索、语义搜索、版本历史、实体图谱 │
│  ai/        AI Provider 服务（OpenAI / Anthropic SDK 等）       │
│  agent/     后台 Agent 任务执行器                              │
│  web/       网页与图片抓取（剪藏）                           │
│  spellcheck/ 拼写检查词典与个人词典                         │
│  ocr/       文字识别资源协议、语言数据与识别结果              │
│  plugins/   插件目录管理（列出 / 读取入口 / 卸载）            │
│  tray/      托盘（含最近打开）                               │
├──────────────────────────────────────────────────────────────┤
│ 可复用子包 packages/*（与 UI 无关的算法与服务）              │
│  text-buffer  diff-algorithm  search-service                  │
│  autocomplete-service  fuzzy-match-algorithm                  │
│  syntax-parser  format-parser  markdown-parser  plugin-system │
│  diff-algorithm-extras  plugin-system-extras                  │
│  （*-extras：桌面端暂未使用、保持可用的部分，按需引入）       │
└──────────────────────────────────────────────────────────────┘
```

依赖方向：desktop 依赖子包，子包之间不依赖 desktop。desktop 直接按包接口使用子包，不保留转发入口：代码块补全由 `RichEditor/CodeBlockView.ts` 直接引用 `@code-reader/autocomplete-service`；`lib/core/delta` 只包含历史管理、内容哈希与版本快照，差分直接引用 `@code-reader/diff-algorithm`；LaTeX 渲染链路（`lib/latex/parser.ts` 起）只依赖 `@code-reader/text-buffer`，LaTeX 诊断 / 折叠 / 大纲（`lib/latex/analysis.ts`）使用 `syntax-parser` 与 `format-parser`，按内容识别文档格式用 `format-parser` 的 `isLaTeXDocument`，LaTeX 源码编辑器的注释与自动配对取自 `syntax-parser` 的语言配置；桌面端插件系统 `lib/plugins` 使用 `plugin-system` 的贡献点类型、`lifecycle` 模块与扩展点注册表；命令面板用 `fuzzy-match-algorithm` 排序与高亮。各算法的用途与调用位置见 `packages/desktop/src/render/lib/ALGORITHMS_README.md`。

**子包接入对照**（桌面端的实际导入可用 `packages/desktop/.e2e` 外的脚本统计：遍历 `src` 中来自 `@code-reader/*` 的 import）：

| 子包 | 桌面端用到的能力 → 接入位置 | 未接入部分与处理 |
|------|------|------|
| `syntax-parser` | `LatexLezerParser` 语法诊断与 AST（折叠 / 大纲）→ `lib/latex/analysis.ts`（`LatexAnalyzer` 按块增量调用）；`LATEX_LANGUAGE_CONFIGURATION`（`%` 行注释、自动配对）→ `lib/latex/codemirror-latex.ts` | 语言注册表 / 高亮引擎（编辑器高亮由 CodeMirror StreamLanguage 承担）、`LezerIncrementalParser`（包内 `parseIncremental` 实际整篇重解析）、`ASTCache`（缓存整棵 `ASTRoot` 与节点表；按块增量分析缓存的是每块的分析摘要，改用自己的代际缓存）、正则块扫描器（与 `block-segmenter` 重叠）。保留在包内，与正在用的解析器同属一个模型，尚未拆分 |
| `format-parser` | LaTeX 交叉引用索引与文档元数据 → `analysis.ts`；`isLaTeXDocument`（先去掉代码块、行内代码、公式与注释再判断）→ `lib/documents/file-types.ts` 的 `resolveDocumentType`：文件名有已知扩展名时以扩展名为准，否则按内容决定 RichEditor 用 LaTeX 还是 Markdown 渲染（此前两处各写一套正则，`.md` 笔记里贴了 `\section{` 代码块会被当成 LaTeX） | 统一入口 `parse` / `autoParse` 的 Markdown 模式由 `markdown-parser` 提供 |
| `markdown-parser` | 桌面端不引用（编辑器用 markdown-it + prosemirror-markdown） | 由 `format-parser` 拆出的 CommonMark / GFM 解析器与逐行 token 增量解析，零依赖，目标是成长为 markdown-it 的替代品；规范一致性与路线见 [FORMAT_PARSER_RESEARCH.md](./FORMAT_PARSER_RESEARCH.md) |
| `plugin-system` | 贡献点类型（含主题、语言）、`lifecycle`（版本范围 / 依赖 / 激活事件，含 `onStartupFinished` 与 `matchedActivationEvent`）→ `lib/plugins/*`、`services/pluginService.ts`；`ExtensionRegistry` → `lib/plugins/extension-registry.ts` | 文件类型贡献点未开放。同进程的 `PluginManager` / `PluginSandbox` 已迁到 `plugin-system-extras`（桌面端保留每插件独占 Worker 的隔离） |
| `plugin-system-extras` | 桌面端不引用 | 同进程插件管理器（依赖先激活、循环依赖报错、激活超时）与插件沙箱（按 `allowedAPIs` / `allowCommands` 拒绝未授权 API、带超时执行）。供插件与宿主同线程的场景（命令行工具、测试、服务端）单独引入，有行为测试 |
| `fuzzy-match-algorithm` | `damerauLevenshteinDistance` → 拼写建议；`fuzzyScore` → 命令面板排序与高亮 | `RadixTree` 与 Levenshtein 变体由 `autocomplete-service` 内部使用；全包已有行为测试（前缀搜索丢字符、模糊搜索滤掉拼写错误两处缺陷已修复） |
| `diff-algorithm` | `DiffEngine` / `TextDiff` / `AsyncDiffEngine` / `DiffCache` → 保存引擎、历史管理、写作服务；`quickHistogramDiff`（`./algorithms`）→ 版本对比按行对齐（`lib/writing/components/diff-lines.ts`） | 未使用的算法已迁到 `diff-algorithm-extras`，核心包只留正在使用的能力与其内部依赖（二进制差分、编辑距离、模糊匹配供统一差分引擎使用） |
| `diff-algorithm-extras` | 桌面端不引用 | rsync / 滚动哈希、Patience、LCS、VCDIFF / BSDiff 适配器、CRDT 接口、流式哈希与流式差分、独立的 diff-match-patch Worker（`dmp-standalone`，原桌面端 `lib/writing` 中与核心库重复的实现）。导出保持可用并有行为测试，需要时单独引入 |
| `search-service` | `SearchIndex` → 写作全文搜索 | `FileSearcher`（逐行正则 / 全词 / 大小写，带行号与上下文，经 `IFileProvider` 读内容）：可用于全局搜索的“精确查找”，需要笔记正文的内容来源与搜索面板的模式切换，待做；中文 / 代码预设索引 |
| `autocomplete-service` | `AutocompleteService` + `CodeMirrorAdapter` → 代码块补全 | `ProseMirrorAdapter`（Markdown 编辑器的斜杠菜单与 `[[` 补全是桌面端自己的实现，功能重叠）、Markdown / Emoji / 片段补全源；包内没有测试 |
| `text-buffer` | `createTextBuffer` / `selectBufferType` → LaTeX 文档模型 | `createAutoBuffer`、性能档案与内部配置类型 |

## 2. 主进程

| 模块 | 文件 | 职责 |
|------|------|------|
| 知识库 | `main/workspace/registry.ts`、`workspace-manager.ts`、`ipc-handlers.ts` | 注册表 `userData/config/workspaces.json`（纯函数增删改 + 校验）；每个知识库目录结构一致（`data/knowledge.db`、`attachments/`、`backups/`、`ocr-results/`），默认知识库的根目录就是 `userData`（兼容升级前的数据），其余在 `userData/workspaces/<id>/`。切换：所有窗口落盘 → 关闭并打开新数据库（建表 + 迁移）→ 重新加载所有窗口；打开失败回到原知识库。删除先确认、再删目录、最后改注册表；默认与当前知识库不可删 |
| 多设备同步 | `main/sync/*` | 不是云服务：经用户选择的共享文件夹（iCloud / Dropbox / Syncthing 等）交换数据。文件夹布局 `sync.json`（id、加密参数）、`devices/<设备ID>/device.json` 与 `changes/<序号>.json`（每台设备只写自己的目录）、`blobs/<SHA-256>`（附件按内容去重）。`records.ts` 定义条目 / 文件夹 / 标签（以名称为键，只同步颜色）的规范化数据、键排序 JSON 哈希与裁决：哈希相同跳过；远端 `baseHash` 等于本地已同步版本则快进；否则按 (clock, deviceId) 较大者胜出，两边都有正文的笔记另存冲突副本（ID 由条目 ID 与败者哈希确定，各设备生成同一个并直接记为已同步）。`sync-engine.ts` 只依赖 `LocalStore` 接口：先导出（与 `sync_records` 比较哈希，含墓碑，上传缺失附件，写变更集），再按 文件夹 → 标签 → 条目 与时钟顺序在一个事务中应用其他设备的变更集并推进 `sync_cursors`；附件未到的变更集推迟。`sqlite-store.ts` / `local-store.ts` 为 SQLite 实现（附件哈希缓存 `sync_file_hashes`，写回后读出的数据与远端哈希一致）。`crypto.ts`：scrypt 派生密钥，每个文件 AES-256-GCM（`CRS1` + IV + 标签 + 密文），`sync.json` 存校验密文。`sync-service.ts`：设备身份在 `userData/config/sync-device.json`，设置存知识库 `app_settings` 的 `sync.config`，口令用 safeStorage 加密保存；换文件夹清空同步状态；定时同步；切换知识库、恢复备份前 `halt()`；应用后推送 `sync:applied`，渲染进程 `lib/sync/refresh.ts` 刷新列表并用 `reloadFromStorage` 替换未编辑文档的内容（不触发保存写回） |
| 备份与导入导出 | `main/transfer/backup.ts`、`files.ts` | 备份：SQLite 在线备份到 `backups/*.db`；恢复前校验（必须含 `knowledge_items` 与 `schema_version`，版本不高于当前），`WorkspaceManager.replaceDatabase` 落盘 → 停 Agent → 关库 → 当前库另存 `before-restore-*.db` → 复制备份（清除 -wal/-shm）→ 打开（迁移）→ 重新加载窗口，打开失败放回原库。完整备份 = 数据库 + `attachments/` + `ocr-results/` + `manifest.json`（记录原附件目录），恢复时在临时副本上把附件绝对路径改写到当前附件目录。导入导出：主进程只做选择与文件访问——Notion zip 解压到 `<知识库根>/import-staging/<id>/`（含一层嵌套 zip），目录遍历跳过隐藏目录并读出文本文件；附件复制 / 导出写入都限制在登记过的来源 / 导出目录与当前附件目录之内 |
| 落盘协调 | `main/flush/flush-coordinator.ts`、`window-flush.ts` | 向窗口发 `app:flush-request` 并等待 `app:flush-ack`（超时不阻塞）；切换知识库、关闭窗口（只是隐藏到托盘时不落盘）、`before-quit` 统一走这里，退出时落盘完成后再清理资源 |
| SQLite | `main/database/sqlite.ts` | better-sqlite3，WAL 模式；`open(dbPath)` 由知识库管理器调用，切换知识库时关闭旧连接并走同一条建表 + 迁移路径 |
| 全文搜索 | `sqlite.ts`、`search-ipc-handlers.ts` | FTS5 虚拟表 `items_fts`（title / content / summary / transcript），分词器 `trigram`（支持中文子串）；少于 3 个字符的查询词退化为 LIKE 扫描 |
| 语义搜索 | `semantic-search.ts`、`embedding-vector.ts` | 调用 AI 服务生成查询向量，与 `item_embedding_chunks` 中的分段向量比对，条目得分取最相近的一段（相似条目以源条目各段归一化均值作查询向量）；只为入选的前 N 个条目读取元数据与正文；混合检索在语义不可用时退化为全文 |
| 版本历史 | `version-history.ts`、`version-retention.ts`、`version-ipc-handlers.ts` | `document_versions` 表；IPC 通道 `version:*`。分层保留策略（`keepAllHours` / `dailyDays` / `weeklyWeeks`，更早每月一个，最新版本始终保留）存于 `app_settings.version_retention`，新增版本后清理该文档，`version:prune-all` 清理全库 |
| AI 服务 | `main/ai/ai-service.ts`、`provider-config.ts` | 多 Provider（openai / anthropic / deepseek / moonshot / zhipu / ollama）：对话、向量、总结、提取标签、转写。配置只存主进程 `userData/config/ai-config.json`，渲染进程经 `ai:getConfig` 等 IPC 读写（拿不到明文 Key）；旧版渲染进程配置由 `legacy-config.ts` 启动时迁移 |
| Agent 执行器 | `main/agent/agent-executor.ts` | 后台任务：transcribe / summarize / extract-tags / generate-embedding / find-related / categorize / extract-entities（类型定义在 `task-types.ts`，`agent_tasks.type` 的 CHECK 约束由同一份列表生成）。每个任务分计算与 `commit` 两段，`commit` 与任务完成状态在同一事务中写入。同一条目的任务按优先级串行（转写先于摘要），不同条目并发；`target_item_id` 为空表示整库任务（整库归类）；失败按 `next_attempt_at` 延迟重试；维护条目状态 processing → ready / error；推送 `agent:progress` / `agent:taskCompleted` / `agent:taskFailed` / `agent:itemStatusChanged`。自动归类（`categorize*.ts`）校验模型 JSON 后只生成提议：在任务完成的同一事务中写入 `categorization_proposals`（待审阅），不修改条目、文件夹与标签；审阅（`categorization-review.ts`、`database/categorization-ipc-handlers.ts`）只接受 pending 提议的状态流转，接受后由渲染进程经知识库服务应用。实体抽取（`entities.ts`、`extract-entities-task.ts`）分段抽取实体与实体关系后合并，整体替换条目的实体关联与以该条目为来源的关系（`relation-types.ts` 定义关系类型），并清理孤立实体。长文不截断：摘要 / 标签超过 `LONG_TEXT_CHUNK_CHARS` 时按段落切分做 map-reduce（`long-text.ts`：逐段摘要、必要时多轮归并后汇总；各段标签按规范化名称去重、置信度按段数平均），短文仍是单次请求；语义索引把摘要 + 正文 + 转写切成 `EMBEDDING_CHUNK_CHARS` 的片段（每段前加标题），按 `EMBEDDING_BATCH_SIZE` 分批请求 embedding（`embedding-chunks.ts`），写回时整体替换该条目的分段；`reindexEmbeddings` 为缺失、过期或早于 v6 迁移的索引批量重建；各段进度经 `agent:progress` 推送。定期整理（`organize-schedule.ts`）：设置存于当前知识库 `app_settings` 的 `organize.schedule`，调度器每 30 分钟及启动 / 切换知识库后检查，到期、上次整理后有新条目且 AI 可用时调用 `categorizeLibrary`，完成且窗口不在前台时发系统通知。标签名规范化与层级路径（`父/子`）在 `src/shared/tag-path.ts`，主进程与渲染进程共用 |
| 事务写入 | `main/database/statements.ts`、`ipc-handlers.ts` | `db:transaction` 在一个 better-sqlite3 事务中执行一组语句（校验条数与类型，禁止 BEGIN / COMMIT / ATTACH / VACUUM 等）；标签合并、条目标签更新、文件夹删除与排序使用 |
| 实体图谱 | `main/database/entity-ipc-handlers.ts` | `entities:getGraph` 读取 `entities` / `item_entities` / `entity_relations` 供图谱实体层使用；`entities:getItemRelations` 返回与条目提及的实体相关的关系 |
| 文字识别 | `main/ocr/ipc-handlers.ts` | 自定义协议 `ocr-resource://`（app ready 前注册）向识别 Worker 提供 tesseract 引擎脚本与语言数据（先查 `userData/ocr/languages`，再查内置 `assets/ocr`；`.gz` 由 Worker 解压）；识别结果与扫描页检测结果按“条目 + 页码”原子写入当前知识库的 `ocr-results/<条目ID>/`。引擎与内置语言数据在构建时由 `scripts/ocr-assets.ts`（Vite 插件）从 node_modules 复制，经 `extraResources` 打包；CSP 为此放行 `ocr-resource:` 与 `'wasm-unsafe-eval'` |
| 插件目录、签名与市场 | `main/plugins/ipc-handlers.ts`、`package-files.ts`、`trust.ts`、`market.ts` | 内置插件 `assets/plugins`、用户插件 `userData/plugins`（同 ID 用户优先）；只保证路径安全与大小上限（manifest 64KB、入口 1MB），manifest 由渲染进程校验。签名：`src/shared/plugin-signing.ts`（Ed25519，`signature.json` 覆盖 manifest.json 与入口文件的 SHA-256，载荷含 ID 与版本，与 `scripts/plugin-tools.ts` 共用）；列目录时附带验签结果，加载用户插件入口前按 `userData/config/plugin-trust.json` 的策略（warn / require）与受信任公钥拒绝，签名无效总是拒绝。市场：registry 地址存 `config/plugin-market.json`，`net.fetch` 读取索引（https / file / 本机 http），安装时重新读取条目、校验大小与 SHA-256、解压出 manifest / 入口 / 签名并核对 ID 与版本、按策略验签，写入临时目录后替换 `userData/plugins/<id>` |
| 问答流式生成 | `main/ai/ipc-handlers.ts` | `ai:chatStream` 按 streamId 推送 `ai:chatChunk`；每个 streamId 持有 AbortController，`ai:chatStreamCancel` 中止 OpenAI / Anthropic 请求 |
| 网页剪藏 | `main/web/ipc-handlers.ts` | `net.fetch` 抓取网页 HTML（仅 http/https、超时、只接受 HTML、识别编码，超过上限拒绝而不截断），以及剪藏图片下载（只接受 `image/*`、单张上限、并发 4）；渲染进程 CSP 不允许外部连接，因此由主进程请求 |
| 拼写词典 | `main/spellcheck/ipc-handlers.ts` | 列出 / 读取 / 导入（`.dic`+`.aff` 或 `.oxt`）/ 删除词典，个人词典的读取、添加与删除（串行写入）。Chromium 自带拼写检查保持关闭，由渲染进程的自研引擎检查 |
| 托盘 | `main/tray/tray-manager.ts`、`recent-menu.ts` | 渲染进程经 `tray:setRecent` 发送最近文档（校验、去重、最多 10 条，非 macOS 转义 `&`），点击后发回 `tray:open-document` |
| 窗口 | `main/index.ts` | 主窗口与按模式打开的子窗口（`createChildWindow`）；文件 IPC（含 `read-binary-file`、`rename-path`） |

主要数据表：`knowledge_items`、`tags`（含 `color`）、`item_tags`、`folders`、`projects`、`links`、`agent_tasks`、`app_settings`、`ai_providers`、`item_embedding_chunks`、`entities`、`item_entities`、`entity_relations`、`categorization_proposals`、`document_versions`、`sync_records`、`sync_cursors`、`sync_file_hashes`、`schema_version`。schema v5 重建 `agent_tasks`（CHECK 约束加入 categorize / extract-entities，`target_item_id` 允许为空）并新建实体表（`entities.normalized_name` 唯一，`item_entities` 级联删除）；schema v6 把旧的单向量表 `embeddings` 迁入 `item_embedding_chunks`（主键 `(item_id, chunk_index)`，向量为 Float32 小端 BLOB，条目删除时级联删除），旧向量作为第 0 段保留，条目重新处理后替换为覆盖全文的分段；schema v7 新增 `entity_relations`（来源条目内 `(source, target, type)` 唯一，关系类型 CHECK 由 `relation-types.ts` 生成）与 `categorization_proposals`（待审阅归类提议）；schema v8 新增同步状态表 `sync_records` / `sync_cursors` / `sync_file_hashes`；全新建库与迁移共用同一份建表语句。代码阅读时期的 Git 表与 `git-service.ts` 已删除；已有数据库中残留的 `git_*` 表不再被读写。

## 3. 渲染进程模块

| 模块 | 职责 |
|------|------|
| `components/RichEditor` | 唯一编辑器入口：ProseMirror 文档编辑 + CodeMirror 代码块（`CodeBlockView`）+ 数学节点（`MathNodeView`，展开源码与实时预览）+ 任务项（`ListItemView`）；`.tex` 文件切换为 `LatexEditor`（源码 / 渲染 / 分栏）。`active` 决定是否为插件桥接的活动编辑器；`externalUpdate` 写入外部来的标题 / 正文（事务带标记，不回传 onChange、不进撤销历史） |
| `components/SplitEditor` | 写作分栏：每栏一个 `PaneEditor`，各自持有文档的托管实例并直接写入（写入按文档 ID 路由，与聚焦栏无关）；同一文档两栏共用实例，模型变化不是本栏写入时作为外部更新同步（非聚焦栏合并 300ms）；微防抖 16ms 的编辑在卸载与落盘时先写入模型。专注模式复用 `PaneEditor` |
| `lib/markdown` | Markdown 文档模型（schema）、markdown-it 解析（含 `$` 公式、`[[ ]]` / `[[笔记#标题|别名]]` / `![[ ]]` 嵌入（`wiki-link.ts`）、任务列表、中文软换行扩展）、按顶层块缓存的序列化、Typora 式实时预览插件、斜杠命令与 `[[` / `[[笔记#` / `[[笔记#^` 补全、块级引用（`block-ref.ts`：`^id` 标记、块摘要与定位；`block-id-plugin.ts` 弱化显示标记）、表格行列命令与快捷键（`table-commands.ts`、`table-keymap.ts`）、HTML 渲染（预览 / 阅读共用，嵌入按深度上限与已访问集合防循环，标题与块输出锚点 id） |
| `lib/latex` | LaTeX 文档模型、块分割与块级增量引擎、解析器与渲染器、渲染管线（Worker + 帧调度）、实测高度映射与滚动所有权锁（见第 6 节） |
| `lib/math` | 自研数学公式解析与渲染（不依赖 KaTeX / MathJax）：TeX 原子间距、显示/行内样式、按内容高度伸缩的分隔符、严格模式校验 |
| `lib/knowledge` | 知识库仓储（SQLite `knowledge_items` / `tags` / `item_tags`，标签重命名 / 合并 / 颜色）、快速收集与附件保存、PDF / EPUB 正文提取（`document-text.ts`）、网页剪藏（`web-clip.ts`：Readability 提取正文后经 ProseMirror schema 转 Markdown；`clip-images.ts`：图片下载为图片条目并改写为 `![[ ]]`）、条目打开方式（`open-target.ts`：写作文档 → 写作，文档附件 → 阅读，其余 → 知识库）、提交 Agent 处理、智能文件夹规则、旧版 JSON 数据迁移、删除条目的唯一入口 `removeKnowledgeItem`（软删除并清理文字识别缓存）、`useKnowledgeBase` |
| `lib/transfer` | 批量导入导出：各来源解析为统一的 `ImportPlan`（`obsidian.ts` 最短路径优先解析链接、frontmatter 与行内标签；`notion.ts` 去 ID 后缀、属性块、CSV 表格；`enex.ts` ENML 经 markdownSchema 转 Markdown，`<en-media>` 按资源 MD5（`md5.ts`）对应附件；`json-format.ts` 本应用全量格式），`link-rewrite.ts` 统一把引用改写为按标题解析的 `[[ ]]` / `![[ ]]`；`importer.ts` 与已有标题冲突时改名并改写引用、建「导入 · 来源」文件夹树、保存附件、写标签；`exporter.ts` 写 Markdown 目录（YAML 头部、附件以标题命名）或 JSON。完成后 `lib/knowledge/changes.ts` 通知知识库与写作列表整体重载 |
| `lib/agent` | Agent 事件订阅与条目处理活动（`useAgentActivity`）、整库动作（自动归类、提取全部实体、重建语义索引，`actions.ts`）与变更记录（自动归类生成的待审阅建议摘要）、知识库问答（混合检索 + 引用，经 `ai:chatStream` 流式生成，可经 `ai:chatStreamCancel` 停止） |
| `lib/categorization` | 待审阅归类：提议列表与面板开关（`reviewStore.ts`）、接受时把提议翻译为知识库操作（`acceptance.ts`：移动 / 新建文件夹、追加标签、合并标签，只追加不删除）与执行（`review-actions.ts`） |
| `lib/entities` | 实体图谱数据（实体节点 + 条目节点 + 实体间关系边）、关系类型显示名、`useEntityGraph` / `useItemEntityRelations` |
| `lib/links` | 双向链接索引（按条目更新时间增量解析，标题 / 块引用与嵌入计入目标笔记）、反向链接、未解析链接、图谱数据、Barnes–Hut 力导向布局、嵌入解析（`embed.ts`，可只嵌入一个块）、块 ID 写入（`block-id.ts`）、重命名时改写指向旧名的链接（`rename.ts`）、`links` 表同步 |
| `lib/reading` | 阅读状态（书架、进度、书签、高亮，存于条目 `metadata.reading`；PDF 高亮按页记录片段 `segments`，可跨页）、跨文本节点高亮定位、PDF（pdfjs-dist，按需加载，页面懒渲染 + 文字层 + 书签目录，内容哈希）、扫描页检测与文字识别（`ocr.ts` 结果格式与整理、`ocr-engine.ts` 直接按消息协议驱动 tesseract 的 Worker 脚本，自行持有 Worker 句柄，初始化或识别失败、取消时都会终止 Worker、`ocr-text-layer.ts` 用识别结果生成与 pdf.js 同构的透明文字层）、EPUB（jszip 解析 container / OPF / spine / 目录）、HTML 白名单净化（`sanitize-html.ts`）、排版设置、摘录生成 |
| `lib/documents` | 文档 CRUD、文件类型（markdown / latex / plain，`keepFileExtension` 改标题时保留扩展名）、`useDocuments`（当前文档从托管模型派生；对外提供 `saveExecutor` 与 `onDocumentSaved`）、托盘最近文档选取（`recent.ts`）；`versions/` 为版本历史（reducer + service + `useVersions`，保留策略读写与全库清理，`getVersionBefore` 供“对比上一版”按需读取） |
| `lib/editor-tabs` | 写作标签页与分栏的纯状态逻辑（打开 / 关闭 / 重开 / 排序 / 跨窗格移动 / 清理已删除文档）与 localStorage 持久化；`hooks/useEditorTabs.ts` 让聚焦窗格的活动标签驱动 `useDocuments` 的当前文档（底栏、版本历史、反链、大纲作用于它），两栏编辑器各自写入各自的文档 |
| `lib/spellcheck` | 自研 Hunspell 拼写检查：词缀解析与查词（含复合词与 COMPOUNDRULE，`compound-rule.ts`）、建议、分词跳过规则、Worker 协议，ProseMirror 插件只检查可见且有变化的块；`services/spellcheckService.ts` 管理 Worker、词典热切换与个人词典 |
| `lib/core` | 版本化编辑基础：EditorModel（versionId + contentHash）、拉取式 SaveEngine、`DocumentEditorManager`（按文档 ID 唯一的实例，引用计数 + 缓存；实例自身连接自动保存与保存后标记，`flushAll` 写回全部实例）、`useManagedEditor`（每个持有方各自订阅 / 取消）、撤销重做（`delta/history-manager.ts`，差分直接引用 `@code-reader/diff-algorithm`）、IndexedDB 离线存储、操作日志与同步接口（仅类型） |
| `lib/writing` | 写作服务：全文索引、搜索建议、差分（`@code-reader/diff-algorithm` 的 Worker 与缓存）、索引持久化（IndexedDB）、性能监控，以及 DiffViewer 组件（版本对比：`diff-lines.ts` 先用 Histogram Diff 按行对齐，再对配对行做字符级高亮） |
| `lib/file-system`、`lib/folders` | 写作文件树模型、拖拽、文件夹（知识库与写作共用 `folders` 表；`moveFolder` 校验循环与同名，删除时子文件夹上移一级） |
| `lib/editor` | 语言注册表、ProseMirror 输入规则与块级回车转换、视口懒渲染（`lazy-visibility.ts`）、块拖拽手柄与块菜单（`block-handle.ts`、`block-commands.ts`、`popup-menu.ts`）、页面设置模型（`page-settings.ts`，localStorage `writing-page-settings`）、打字机模式插件（`typewriter.ts`）、定位高亮（`reveal-highlight.ts`，编辑器与阅读视图共用） |
| `lib/plugins` | 桌面端插件系统：manifest 校验（`manifest.ts`）、权限与按权限过滤的上下文（`sandbox.ts`）、每个插件独占的 Worker 运行时（`plugin-runtime.worker.ts`，移除网络 / 持久化 / 动态求值等全局能力）与宿主侧代理（`worker-plugin.ts`、`plugin-protocol.ts`）、加载与生命周期（`plugin-loader.ts`）、宿主扩展点（`extension-registry.ts`：在 `plugin-system` 的 `ExtensionRegistry` 上定义状态栏项、侧栏视图内容两个扩展点及校验；`PluginLoader` 按插件持有贡献句柄，重新设置时替换、停用时整体注销）、快捷键解析与冲突检测（`keybindings.ts`）、偏好 / 配置与存储（`preferences.ts`、`storage.ts`）、编辑器桥接（`editor-bridge.ts`：已注册编辑器按最近活动排列，聚焦栏调用 `activate`；Markdown 编辑器与 LaTeX 源码编辑器都会注册，带 `language`）；`services/pluginService.ts` 组合主进程插件目录与以上模块，并用 `plugin-system/lifecycle` 编排激活：授权 → 依赖解析（依赖先激活，缺失 / 未启用 / 版本不满足 / 循环时拒绝）→ 激活事件（onStartup 在首屏后的第一个空闲时刻、onStartupFinished 在全部启动插件激活后的下一个空闲时刻，`requestIdleCallback` 最长 2 秒 / onLanguage / onView；执行命令时按需激活，激活原因与耗时记在快照里），manifest 声明的命令、快捷键、斜杠菜单、标签栏按钮、侧栏视图从快照的 `contributions` 提供给界面。插件之间经 `commands.execute('<插件>.<命令>')` 调用，沙箱只放行本插件与声明的依赖。声明式贡献（不运行插件代码，启用即生效）：`themes.ts`（只允许覆盖白名单中的颜色变量，值须为颜色字面量；`ThemeProvider` 在内置配色之上应用）与 `languages.ts`（代码块语言注册到 `lib/editor/languages.ts`，复用内置语法，不覆盖内置别名，停用时移除）。主进程市场经 `MarketProvider` 接口取得列表与插件包（当前实现为静态 JSON 索引，官方市场服务器上线后实现同一接口），校验、验签与安装与来源无关 |
| `services/` | `database.ts`（渲染侧 SQL 通道，含 `transaction`）、`settingsService.ts`（`settings.json`）、`aiConfigService.ts`（主进程 AI 配置的客户端）、`spellcheckService.ts`、`workspaceService.ts`（知识库）、`flushRegistry.ts`（渲染进程落盘的唯一入口：持有防抖写入的模块注册回调，响应主进程请求并发执行后 ack）、`pluginService.ts`、`ocrLanguageService.ts` |
| `theme/` | ThemeProvider：light / dark / system，强调色，字体，写入 CSS 变量 |

## 4. 存储与版本

| 数据 | 存储方式 |
|------|----------|
| 知识条目（含写作文档，type=note）、标签、文件夹、链接、Agent 任务、实体与关系、归类提议、版本保留策略 | 当前知识库的 SQLite（`<知识库根>/data/knowledge.db`），知识库 / 写作 / 阅读 / Agent 共用同一份数据。早期的 `knowledge-db.json` 在启动时迁移并改名为 `.legacy.json` |
| 知识库列表 | `userData/config/workspaces.json`（仅主进程读写） |
| 写作文档正文 | `.md` 存标准 Markdown，`.txt` 存原文，`.tex` 存 LaTeX 源码；旧版 HTML 内容读入时兼容、保存时转为 Markdown |
| 双向链接 | 笔记正文中的 `[[ ]]` 是唯一事实来源；渲染进程内存索引计算反链（含未创建的目标），文档保存时把已解析的引用同步到 `links` 表（type=reference）；Agent 的语义关联写入 type=ai-suggested |
| 附件（录音、图片、文件、剪藏图片） | `<知识库根>/attachments/`，数据库只存路径与元数据（录音在 metadata 中记录 `durationMs`）；渲染进程经 `read-binary-file` 转 Blob URL 预览（CSP 不放开 file:） |
| 扫描版 PDF 识别结果 | `<知识库根>/ocr-results/<条目ID>/`：逐页识别结果、写回正文的全文、扫描页检测结果（按 PDF 内容哈希判断是否过期）；删除条目时清理。识别文本同时追加到条目正文，由已有的 FTS 触发器索引 |
| 文字识别语言数据 | 内置 eng / chi_sim 在 `assets/ocr/`（构建时生成，不入库）；用户导入的在 `userData/ocr/languages/`；参与识别的语言选择存在 localStorage（`ocrLanguageService`） |
| 插件 | 内置 `assets/plugins/`，用户插件 `userData/plugins/<id>/`；启用状态、已授予权限与用户修改过的配置在 `settings.json` 的 `plugins`；插件私有存储为 localStorage `plugin-storage:<id>`（有配额） |
| 拼写检查词典 | 内置 en_US（Hunspell `.dic` / `.aff` + LICENSE）在 `packages/desktop/assets/dictionaries/`，经 electron-builder `extraResources` 打包；用户导入的词典与个人词典（`user-words.txt`）在 `userData/spellcheck/` |
| 写作标签页与分栏 | localStorage `writing-editor-tabs` |
| 写作页面设置 | localStorage `writing-page-settings`（写作与专注模式共用） |
| 应用设置 | `userData/settings.json`（`settingsService`） |
| AI 服务商配置 | `userData/config/ai-config.json`（仅主进程读写） |
| 文档版本快照 | SQLite `document_versions`；保存执行器每 5 分钟（`VERSION_INTERVAL_MS = 300000`）自动创建一次版本，另可手动创建、预览、对比（当前 / 上一版）、恢复；每次新增版本后按分层保留策略清理该文档 |
| 编辑中文档的离线状态、待同步操作 | 渲染侧 IndexedDB（`lib/core/storage`） |
| 写作搜索索引 | IndexedDB（`lib/writing/index-storage.ts`），变更后自动持久化，启动时加载 |
| LaTeX 编辑中文本 | `@code-reader/text-buffer`：`selectBufferType` 默认 Piece Table，超过 10MB 选 Rope |

设计方向（尚未实现，保留为约束）：

- 文本内容进 SQLite 并做版本历史；录音、图片、PDF 等媒体放文件系统，数据库只存元数据与校验和。大二进制不进 Git、不进数据库。
- 原始文件永久保留，转写与总结作为派生字段和索引。
- 同步：文本用 CRDT 解决冲突，媒体按时间戳保留并重命名冲突文件，标签等元数据取并集。

## 5. UI 架构

| 区域 | 职责 |
|------|------|
| TitleBar | 窗口控制、知识库选择器（`WorkspaceSelector`：切换 / 新建 / 编辑 / 删除）、模式标签（knowledge / writing / reading）、搜索入口、进入专注模式 |
| Ribbon | 左侧图标栏：快速操作、随当前模式变化的侧栏面板按钮（`MODE_SIDEBAR_PANELS`，受控，每个模式各自记住活动面板）、设置入口 |
| Sidebar | 当前面板（`components/SidebarPanels`）：知识库为文件夹（`VirtualFolders`）/ 搜索 / 标签云 / 录音 / 图谱 / 日历 / 最近，写作为大纲 / 文件（WritingSidebar）/ 参考（反链）/ 标签 / 最近，阅读为章节 / 书签（由阅读视图渲染到挂载点）/ 书库（`ReadingShelf`）/ 搜索 / 最近阅读 |
| MainContent | 知识库 `KnowledgeWorkspace`（条目 / 图谱（笔记链接 / 实体两层）/ 问答 + 详情面板 + 标签管理 + 待审阅归类）；写作 `EditorTabs` + `SplitEditor`（每栏一个 `PaneEditor`）+ `BacklinksPanel`，外层 `PageSurface` 应用页面设置；阅读 `ReadingView`（文章、PDF、EPUB） |
| EditorFooter | 字数、保存状态、反向链接面板开关、版本历史按钮、页面设置浮层 |
| AgentActivity | 右下角浮窗，任意模式下显示 Agent 处理进度与归类建议记录（「去审阅」） |
| PluginHost | 包裹整个应用：初始化插件服务、注册插件界面管理器、授权对话框（`PermissionDialog`）、⌘⇧P 命令面板（显示快捷键）、插件快捷键分发；状态栏项由 Layout 中的 `PluginStatusBar` 显示，标签栏按钮由 `EditorTabs` 中的 `PluginToolbar` 显示，侧栏「插件视图」为 `PluginViews`（Ribbon 只在有插件视图时显示按钮），斜杠菜单经 `SlashCommandProvider` 的外部命令接入 |

App 层的跨模式导航：条目按 `lib/knowledge/open-target.ts` 决定进入的模式（写作文档进写作、文档附件进阅读、其余进知识库），`openWikiTarget` 解析 `[[ ]]`（含标题 / 块片段，目标不存在时新建文档；阅读模式下目标可在阅读视图呈现时留在阅读模式并由阅读视图定位）。编辑器已处理的按键（`defaultPrevented`）不再触发全局快捷键。

快捷键（`App.tsx`）：⌘N 快速输入（文本）、⌘⇧R 快速输入（录音）、⌘P 搜索（写作文档 + 知识条目）、⌘, 设置、⌘B 侧边栏、⌘S 保存、⌘1/2/3 切换模式、⌘⇧F 专注模式、Esc 退出专注、关闭页面设置或弹窗。写作标签页（`useEditorTabs.ts`）：⌘W 关闭、⌘⇧T 重开、⌃Tab / ⌃⇧Tab 切换、⌘\ 分栏。插件命令面板（`PluginHost`）：⌘⇧P；插件快捷键来自 manifest，与以上快捷键冲突的不生效（`lib/plugins/keybindings.ts` 的 `RESERVED_KEYBINDINGS`）。LaTeX 源码：⌘⇧M 诊断面板、F8 下一处诊断、⌘⌥[ / ⌘⌥] 折叠 / 展开。

样式约定（详见 `packages/desktop/src/render/styles/DESIGN_SYSTEM.md`）：

- 组件样式只写在 `*.module.scss`，tsx 中不写样式。
- 颜色、间距、圆角、字号、阴影使用 CSS 变量 `var(--xxx)`，运行时随主题切换；布局尺寸、过渡、字重、z-index 使用 SCSS 变量。
- 浅色主题在 SCSS 编译期固定会导致切换失效，所以颜色禁止直接用 SCSS 变量（这是早期 Light 模式文字不可见的根因）。

## 6. LaTeX 渲染链路

```
CodeMirror 源码编辑（codemirror-latex：高亮）
   │ 事务（事务前坐标的整批变更）
   ▼
LatexDocument（latex-document.ts）── 文本存储：@code-reader/text-buffer（按大小选 Piece Table / Rope）
   │ applyChanges → 同一批变更
   ▼
IncrementalLatexEngine.update（incremental-engine.ts）
   ├─ block-segmenter：前言块 + 正文顶层块（段落 / 环境 / 块级公式 / 章节）
   ├─ 旧块映射到新坐标，未触及且起点对齐的块平移复用（保留 id 与 AST），只解析新块（parser.ts）
   └─ 宏定义变化 → 正文块 renderKey 全变；section 索引变化 → 只影响含 \tableofcontents 的块
   │ 块列表（id、行范围、renderKey）
   ▼
RenderPipeline.applyUpdate（render-pipeline.ts）
   ├─ 结构对账：按块 id 保留未变化块的 DOM，只插入 / 删除变化的块
   ├─ 内容提交：可视区（含 400px 余量）主线程同步渲染、最高优先级；可视区外交给 worker.ts 批量渲染
   │   （每批 64 块，不可用时回退主线程低优先级）；渲染器 renderer.ts 主线程与 Worker 共用，数学走 lib/math
   ├─ 所有 DOM 写入经 FrameScheduler（frame-scheduler.ts，每帧约 8ms，优先级队列，内存压力时缩小预算）
   └─ 每次提交或块尺寸变化（ResizeObserver）后，下一帧 measureDOMBlocks 实测全部块
   ▼
HeightMap（height-map.ts）── 源码行 ↔ 块 ↔ 实测位置；块内按行在实测上下沿间插值，未测量的块不参与查询
   ▼
分栏滚动同步（LatexEditor + scroll-sync.ts 的 ScrollSyncLock）
```

`lib/latex` 不设汇总入口（无 `index.ts`），全部模块都从 `LatexEditor.tsx` 可达：它直接使用 `codemirror-latex`、`codemirror-analysis`、`analysis-client`、`latex-document`、`incremental-engine`、`render-pipeline`、`scroll-sync`；分析客户端在 `analysis.worker` 中用 `LatexAnalyzer` 按块增量分析（与渲染引擎同一套 `block-segmenter` 切块，每块的 `syntax-parser` 语法诊断与结构、`format-parser` 交叉引用按块文本缓存，只重新分析改动的块；有未闭合结构、块内语法错误或 document 标记不止一对时回退整篇，随机编辑对比测试保证与整篇结果一致；80 万字符改一段约 9ms，整篇约 120ms），写作侧栏 `LatexOutline` 共用同一客户端；引擎内部依赖 `block-segmenter`、`parser`、`renderer`（数学环境由 `math-env-handler` 处理；正文命令→Unicode 符号、重音与连字由 `text-symbols` 提供，大纲 / 目录标题的纯文本也用它；未识别的命令连同参数原样保留并以 `latex-unknown-command` 标出）；管线内部依赖 `frame-scheduler`、`height-map`、`worker`；类型统一在 `types.ts`。早期并行的链路（基于内容比较的 `parseAndRender`、`RealHeightMap`、按比例换算的滚动同步、`useLatexPipeline` / `useScrollSync`、`syntax-parser` 解析器选择、AST 缓存管理器与 math-worker 等）已删除。

滚动同步规则（`scroll-sync.ts`）：只有用户真实操作的一侧拥有滚动所有权（时间窗 `SCROLL_OWNER_WINDOW_MS = 150`）。源码滚动（含光标带动）同步预览；预览只有在用户滚轮 / 触摸 / 指针 / 键盘输入后的时间窗内滚动才同步源码；程序设置 `scrollTop` 或内容重排引起的预览滚动一律忽略；预览刷新或测量后只允许“源码 → 预览”。查询返回 `null`（块尚未测量）时等下一次测量再同步。

LatexEditor 中的常量（`LatexEditor.tsx`）：

| 常量 | 值 | 作用 |
|------|----|------|
| `LARGE_FILE_THRESHOLD` / `HUGE_FILE_THRESHOLD` | 50KB / 200KB | 工具栏显示“大文件 / 超大文件”标识 |
| `DEFAULT_DEBOUNCE_MS` | 150ms | 预览刷新防抖（引擎按块增量，文件大小不再改变防抖） |

技术决策：

- **不用“限制”处理大文件**：限制文件大小或降级功能只是绕过问题。采用块级增量解析、帧预算调度（每帧约 8ms）、可视区域优先、Worker 后台渲染、内存压力响应。
- **增量更新不用 VCDIFF**：VCDIFF（RFC 3284）面向字节级的存储 / 传输压缩，每次编辑都要算 diff；编辑器本身就知道变更位置。链路分三层：文本存储（Piece Table / Rope）→ 由编辑器变更驱动的块级增量解析 → 按块 diff 的 DOM 局部更新。
- **位置只用实测值**：滚动同步不做高度估算，以免数学块等变高内容导致失真。
- **不用 KaTeX**：数学渲染完全自研（`lib/math`）。

## 7. Markdown 写作链路

```
存储内容（Markdown / 纯文本 / 旧版 HTML）
   │ parseContent：markdown-it（CommonMark + 表格 + 删除线 + $ 公式 + [[ ]] + 任务列表）
   ▼
ProseMirror 文档（lib/markdown/schema.ts，节点与语法一一对应）
   │ 输入规则（行内标记、公式、双链、任务）、回车转换（``` / $$ / | a | b |）
   │ 实时预览插件：只扫描光标所在文本块，在格式两侧放只读语法标记
   ▼
serializeContent：顶层块为不可变对象 → WeakMap 缓存每块的 Markdown，只重新序列化被改动的块
   │
   ▼
onChange(markdown) → PaneEditor 微防抖 → 该文档的托管实例（EditorModel）→ 实例自动保存 → 保存后同步 [[ ]] 到 links 表
```

分块渲染的三层：

| 层 | 做法 |
|----|------|
| 序列化 | 按顶层块缓存；相邻同类列表自动交替标记符，保证分块拼接与整体序列化等价 |
| 布局 / 绘制 | 顶层块数 ≥ 150 时对每个顶层块启用 `content-visibility: auto` + `contain-intrinsic-size: auto`，视口外的块跳过布局与绘制并记住真实高度；小文档不启用，避免绘制包含裁剪描边 |
| 重型节点 | 代码块先输出未高亮文本（高度一致），共享 IntersectionObserver 在接近视口（800px）时做 Prism 高亮；语言下拉框首次打开时才生成完整选项。公式渲染实测单个约 25µs，不需要懒加载 |

实测（开发机 macOS，Node，`lib/markdown`）：300KB / 10,000 个顶层块的文档，解析 55ms，冷序列化 27ms，修改一个段落后的增量序列化中位数 0.76ms。数学渲染：1000 个中等复杂度公式 25ms。图谱布局：3000 节点 / 6000 边单步约 3.7ms（Barnes–Hut，θ=0.9）。

## 8. 关键问题与根因记录

提炼自已删除的过程性文档（latex 目录下的 FIX_SUMMARY / SCROLL_RENDER_FIX / PERFORMANCE_GUIDE / CHANGELOG / IMPLEMENTATION_SUMMARY，以及 RichEditor 目录下的 SCROLL_RENDER_FIX_V2）。

| 问题 | 根因 | 最终方案 |
|------|------|----------|
| 大文件编辑 OOM（V8 “Committing semi space failed”，堆约 4GB 时崩溃） | AST 与内容在 IncrementalLatexEngine、LatexEngine、IncrementalLatexParser 中被重复缓存 3 份以上；LRU 过大（1000 节点 + 500 渲染结果）；每个 AST 节点保存完整 `raw` 字符串；分块解析的中间结果没有及时释放 | 按需从源文本切片的缓存方案是当时的修复；当前块级增量引擎只保留一份块列表（每块的 AST 与 renderKey），未变化的块直接复用，`ASTCacheManager`、`chunk-pool` 与基础 `LatexEngine` 均已删除，只保留 IncrementalLatexEngine 一条链路 |
| 源码与预览位置映射不准 | Source Map 用“行数 × 24px”估算渲染高度，数学块严重失真；渲染器未输出块标识，`measureDOMBlocks()` 找不到元素返回空数组，测量回写实际无效 | 渲染管线为每个块输出 `data-latex-block`；提交或尺寸变化后实测全部块回写 `HeightMap`，滚动同步只用实测值（块内按行插值），不再估算 |
| 左侧源码滚动时被自动拉回 | 一：锁定时间太短（50ms），source → preview → source 形成循环。二（真正根因）：渲染更新 `innerHTML` 引起浏览器调整预览滚动位置并触发 `onScroll`，而渲染锁定只在 `handleScroll` 入口检查，`setTimeout` 延迟回调执行时锁定已解除，于是反向驱动了源码滚动 | 改为滚动所有权锁（`ScrollSyncLock`）：只有用户真实输入（滚轮 / 触摸 / 指针 / 键盘）的一侧在时间窗内拥有所有权，程序设置或内容重排引起的预览滚动不同步，预览刷新后永远不会反向拉动源码 |
| 矩阵 / 对齐公式显示成带边框的表格 | 自研渲染器用 `<table class="math-matrix-table">` 等实现矩阵、cases、aligned、gathered，而 `.latexPreviewContent` 的通用 `table` 样式没有排除这些类 | 通用表格选择器加 `:not(.math-*-table)` 排除；数学表格强制无边框、透明背景 |
| `align` 多行公式渲染错误 | `\begin{align}...\end{align}` 内容未包装为 `aligned` 处理 | 渲染器自动识别并包装；数学环境检测统一收敛到 `math-env-handler.ts`（align / flalign / alignat / eqnarray / gather / multline / matrix 系列 / cases 系列 / aligned / gathered / split） |
| 数学环境渲染缺属性 | `renderMathEnvironment` 使用了未定义的 `blockAttrs` | 方法内调用 `getBlockAttributes(node)` 生成 |
| 极限下标显示在右下角 | `math-limit-style` 的 CSS 结构与渲染器输出不一致 | 改为纵向 inline-flex，上下标居中排列 |
| 预览中的“黑色方块” | 不是 bug：是 `\blacksquare`（QED 符号）的正确渲染 | 无需修复；空数学块用 `.latex-math-empty` 隐藏 |
| `\lim`、`\frac` 显示为原文 | 数学命令写在数学模式之外（未用 `$...$`、`\[...\]` 或数学环境包裹） | 正文中直接出现的数学命令连同上下标按行内公式渲染（`renderer.ts` 的 `TEXT_MATH_COMMANDS`）；其余没有对应渲染的命令原样保留并标出 |
| 启动插件总在启动后约 2 秒才激活；主线程持续空转 | `diff-algorithm` 与桌面端各有一个 Worker 入口以 `typeof self.postMessage === 'function'` 判断自己在 Worker 中，而主线程的 `self` 就是 `window`，同样有 `postMessage`。两个模块被打包进主线程后各自执行 `self.onmessage = (e) => self.postMessage(...)`，window 消息“收到即回发”，每秒约 6 万次，占满空闲时段，`requestIdleCallback` 永远等到 2 秒超时。定位方法：同一窗口对照 `about:blank`（rIC 立即触发），再注入探针统计任务来源 | 改为 `self instanceof WorkerGlobalScope` 判断，并加回归测试；桌面端的重复 Worker 实现迁到 `diff-algorithm-extras`。启动插件现在约 150–290ms 激活 |
| LaTeX 诊断在输入 `$` 后出现远处的引用误报 | `format-parser` 与 `syntax-parser` 都把未闭合的 `$` 延伸到下一个 `$`：前者跨过空行吞掉后文的 `\label` 与 `\bibitem`，后者的词法 `$` 状态越过分组（`\label{a$b}` 之后的 `$$` 被配错） | 未闭合的公式在空行与关闭外层分组的 `}` 处结束（与 TeX 的 Missing $ 行为一致）。由按块增量分析的随机编辑对比测试发现 |
| 正文空格被吞、`\LaTeX` 后的空行丢失、嵌套列表错乱 | 正文解析循环每轮先跳过全部空白（含换行）；命令后读取参数时跨过空行；环境以第一个 `\end{name}` 结束；列表按所有 `\item` 切分（含子列表与 `\itemsep`） | 只跳过段首空白；参数前至多跨一个换行；同名环境按深度配对；只在本层切分 `\item` |
| 保存 `.tex` 后变成 `.md` | 修改标题时可能丢掉扩展名，导致文件类型改变 | 所有标题编辑入口（各栏编辑器、专注模式标题栏）经 `keepFileExtension` 自动保留原扩展名 |
| 源码视图挡住文件树点击 | 全文源码编辑器层级高于侧边栏 | 源码编辑器与 RichEditor 处于同一层级（`position: relative; z-index: 0`） |
| Light 模式文字不可见 | 组件颜色使用 SCSS 变量，编译期固定为深色值 | 颜色统一改为 CSS 变量 |
| 知识库条目永远不被 AI 处理 | 知识库 UI 写入渲染进程的 `knowledge-db.json`，Agent 只读 SQLite；AI 配置也分为渲染进程与主进程两份 | 知识库改为 SQLite 唯一数据源并迁移旧 JSON；AI 配置只存主进程并迁移旧文件 |
| 全文搜索始终为空 | `items_fts` 声明了 `knowledge_items` 中不存在的 `tags` 列，读取列值报错被吞掉；`unicode61` 无法匹配中文子串 | schema v3 重建 FTS（trigram）与触发器，短查询退化为 LIKE，错误不再吞掉 |
| 音频摘要偶发失败 | 同一条目的转写与摘要并发执行，摘要时还没有转写文字；重试无延迟 | 同条目任务按优先级串行，`next_attempt_at` 延迟重试 |
| 在编辑器里按 ⌘B 加粗会同时收起侧边栏 | App 的全局快捷键不区分事件是否已被编辑器处理 | 全局处理器跳过 `defaultPrevented` 的事件 |
| `x^12`、`\frac12` 渲染错误；公式中的 `]` 截断后续内容 | 自研解析器非花括号参数读取整串数字；顶层表达式遇到 `]` 即停止 | 解析器重写：统一的参数读取（单记号）、表达式终止条件与表格解析，符号表唯一来源 `extended-symbols.ts`，覆盖测试见 `lib/math/__tests__` |

### 性能数据

上述过程文档中出现的所有性能数字（例如“50KB 解析 < 100ms”“偏移 < 10px”“100KB 增量解析 < 5ms”）都标注为“预期指标”或目标值，不是实测结果，本文不采用。真实数据以运行基准测试为准：

```bash
pnpm benchmark                # 运行全部子包基准（等价于逐个执行下列命令）
pnpm benchmark:diff-algorithm
pnpm --filter @code-reader/syntax-parser benchmark
pnpm --filter @code-reader/format-parser benchmark
pnpm --filter @code-reader/fuzzy-match-algorithm benchmark
```

渲染进程另有运行时监控 `lib/writing/performance-monitor.ts`，写作服务基准为 `lib/writing/benchmark.ts`（`runQuickBenchmark` / `runFullBenchmark`）。
