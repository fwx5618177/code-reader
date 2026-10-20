# format-parser 能否抽成独立库、替代 markdown-it：调研结论

> 2026-10 调研。所有数字都在本仓库实测得到，测量脚本的做法写在文末，可以复现。

## 0. 更新（调研之后）

Markdown 解析已经拆成独立子包 `@code-reader/markdown-parser`，第 5 节的阶段 0 和阶段 1 已完成：

| 项目 | 调研时 | 现在 |
|------|------|------|
| CommonMark 0.31.2 规范 652 例 | 58.9%（另有 8 例死循环） | **100%**（`__tests__/commonmark-spec.test.ts`，下限 652；markdown-it 作为测试工具自检也是 100%） |
| 算法 | 块级按结构整段消费，行内递归匹配 | 块级为规范的“打开的块”逐行算法，行内为分隔符栈和方括号栈，与 commonmark.js 相同 |
| 链接引用定义 / 字符引用 | 不支持 / 不解码 | 全部支持，内置 HTML5 命名字符引用表（2125 个） |
| HTML 渲染器 | 无 | `renderHtml`，输出格式与 commonmark.js 一致 |
| 88 万字符 | 解析 28ms | 解析 27ms、生成 markdown-it 兼容 token 7ms（markdown-it 为 25ms）。编辑器完整分词（含扩展与后处理）93 万字符 40ms，markdown-it 26ms；常见笔记在 5ms 以内。规范用例与中文笔记混合的 91 万字符：语法树约 79ms、语法树加 token 约 110ms，markdown-it 约 76ms（最初分别为 121ms 与 172ms；最近一轮剖析去掉了行内位置计算的临时对象、整篇行数组与逐字符找换行） |
| 健壮性 | 8 例死循环 | 随机输入 4 万次（含全部扩展语法）无异常，单次不超过 50ms |
| GFM | 以开关硬编码 | 表格、任务列表项、删除线、脚注（可单独开关）、扩展自动链接（`linkify`，规范用例全部通过；`linkifyBareDomains` 按 linkify-it 的顶级域名表识别裸域名）；智能标点、`hardBreaks`、`maxNestingDepth`、仅 `~~` 删除线均已实现 |
| markdown-it 生态插件 | 无 | 脚注（按第一次引用编号、行内脚注、文末回链）、定义列表、自定义容器、高亮 / 插入 / 上下标、缩写、YAML 头部、排版替换：与 markdown-it-footnote / deflist / container / mark / ins / sub / sup / abbr / front-matter 及 markdown-it 的 replacements 逐 token 一致（`markdown-it-plugins.test.ts`）；`{…}` 属性的位置规则（标题、段落、列表项、列表、表格、单元格、围栏代码块、引用、分隔线）与 markdown-it-attrs 逐 token 一致 |
| 链接规范化 | 只做百分号编码 | 与 markdown-it 的 normalizeLink / normalizeLinkText 相同：IDN 主机名转 `xn--`（零依赖 Punycode，与 punycode.js 3000 组随机输入一致），自动链接文字还原 `xn--` 与百分号编码 |
| HTML 渲染选项 | 无 | 默认拒绝不安全链接（与 markdown-it 的 validateLink 相同），`highlight`、`langPrefix`、`xhtmlOut`、扩展节点的自定义渲染 |
| 扩展接口 | 无 | `inlineExtensions`（触发字符 + match）、`blockExtensions`（可跨行的叶子块，可在引用与列表中，可选能否打断段落） |
| 位置信息 | 行内节点相对段落文字 | 块级与行内都是源码中的绝对位置（引用 `>`、列表缩进等前缀已计入），表格的行与单元格各有位置（含 `\|` 的单元格也准确）；markdown-it 只有块级行号 |
| 解析结果 | 只有语法树 | 另外提供链接引用定义（`references`）与缩写定义（`abbreviations`） |
| 编辑器对接 | 无 | `MarkdownItCompatTokenizer` 输出与 markdown-it 相同结构的 token，652 个规范用例逐个 token 对照全部一致（`__tests__/markdown-it-tokens.test.ts`，下限 652）；`preserveSource` 保留脚注定义与缩写定义的原位（编辑器保存不丢内容）；`env.key` 按文档缓存增量解析（大纲、链接同步） |

阶段状态：
- **阶段 2 扩展接口**：已完成。桌面端的公式 `$…$` / `$$…$$`、双向链接 `[[…]]`、块级嵌入 `![[…]]` 都改写为扩展（`desktop/src/render/lib/markdown/syntax-extensions.ts`），任务列表用解析器选项，中文软换行在 token 后处理中合并。
- **阶段 4 编辑器集成**：已完成，编辑器已替换。走的是“输出 markdown-it 兼容 token 流、复用 prosemirror-markdown”这条路，链接改写、块 ID、标题 / 链接提取等用法不变。替换前对照了旧管线：仓库文档、用户笔记与规范用例共 689 篇，688 篇 token 完全一致，另 1 篇只多出公式定界符元数据；桌面端 1326 个测试与真实应用里的渲染、保存状态都已验证。之后又发现 prosemirror-markdown 在模块顶层创建了 markdown-it 实例，渲染包里仍带着 markdown-it；已改为自有的 token→文档构建器与序列化引擎并移除该依赖（规范 652 例与仓库文档的解析、保存结果与原实现逐字节一致），现在 markdown-it 只是 `markdown-parser` 的开发依赖（对照测试）。
- **阶段 3 真正的增量**：已完成。`IncrementalCommonMarkParser` 编辑后只重新解析受影响的顶层块，其余块平移位置后复用；12 万次随机编辑与整篇解析逐节点相同，约 87% 的编辑走增量路径。编辑器输入时不重新解析 Markdown（ProseMirror 持有文档），增量解析供源码模式、外部工具等按文本工作的场景使用。
- **编辑器中的 YAML 头部**：文档开头的 `---…---` 以前会被解析成分割线加二级标题，保存时被改写。现在是独立的“文档属性”块，往返不变；YAML 按语法着色并标出写错的行，`tags` 同步为条目标签，`aliases` 参与 `[[ ]]` 解析（已在真实应用中验证）。
- **编辑器接入扩展语法**：脚注、高亮 / 插入 / 上下标、定义列表、`:::` 提示块、缩写、裸网址都有对应节点或标记、输入规则与斜杠命令，往返不变；在真实应用中验证了显示、输入、保存逐字不变与阅读视图的样式。
- **能否完全替换 markdown-it**：在本项目里已完全替换——编辑器分词、文档构建、保存、大纲、链接同步、预览与阅读渲染都不经过 markdown-it，安装包里也没有它。对外作为通用库时仍有一处不同：markdown-it 的插件（`md.use(...)`、`renderer.rules`、`core.ruler`）不能直接加载，要改写为本库的语法扩展（行内 / 块级扩展与自定义渲染）；常用插件的语法本库已内置。
- **增量解析接入实际流程**：写作大纲与保存后的链接同步按文档 id 走增量解析。真实应用中 1500 个小节的文档逐键输入，每次按键含渲染往返中位数约 26ms，大纲与内容一致。

下文保留调研时的原始结论。

## 1. 结论

1. **能做，但目前差距很大，不建议现在替换编辑器里的 markdown-it。** 用 CommonMark 0.31.2 官方规范的 652 个用例测试，markdown-it 通过 **100%**，format-parser 通过 **58.9%**。调研中还发现 format-parser 会在 8 个规范用例上**死循环**，其中包括 ```` ```foo`` ```` 这种输入过程中很常见的写法。这 8 处已经修复（提交 `b2dd7dc`）。
2. **“markdown-it 没有同步 / 异步之分、不好接视频”不是替换它的理由。** 视频嵌入属于语法扩展和渲染层的问题，本轮已经在现有链路上实现：`![[x.mp4]]` 与 `![](x.mp4)` 都会显示为播放器，Markdown 原文往返不变（提交 `3cdb9ce`）。大文档的解析耗时也不是瓶颈：88 万字符时 markdown-it 只要 24ms。另外，“异步”本身并不能提速，真正需要的是**增量**，也就是改一个字只重新解析受影响的部分。
3. **真正值得做的是增量。** 这一点 format-parser 现在做不到：它的 CommonMark 解析器只能整篇解析；它的“增量解析器”用的是另一套简化的逐行 token 模型，产出的不是 CommonMark AST，也接不进编辑器。依赖树里已有的 `@lezer/markdown`（CodeMirror 6 的 Markdown 解析器）已经是成熟的增量 CommonMark 解析器：88 万字符整篇 48ms，**改一个字后增量解析 1.7ms**。
4. **建议的路线：**
   - 编辑器继续用 markdown-it 加 prosemirror-markdown，这是 ProseMirror 生态的标准组合，往返无损已经验证过。
   - 需要增量的场景（大文档的大纲、链接与块索引、诊断）用 `@lezer/markdown`。
   - format-parser 保留并继续独立维护，定位是“零依赖、带完整位置的 AST 解析库”，其中 LaTeX 部分桌面端正在使用。Markdown 部分先把规范通过率提到 95% 以上，再考虑对外发布。
   - 如果坚持要用 format-parser 替换 markdown-it，第 5 节给出了分阶段方案与工作量估计。

## 2. 现状

| 项目 | format-parser 现状 |
|------|------|
| 规模 | 约 8100 行：CommonMark 解析器 2300 行、增量解析器 2100 行（两套）、LaTeX 解析器 2450 行 |
| 测试 | 24 个（LaTeX 14 个、Markdown 健壮性 10 个，后者为本轮新增），此前没有任何规范一致性测试 |
| 桌面端使用 | 只用到 `parseLaTeX`（交叉引用索引与标题、作者），Markdown 部分没有接入 |
| 输出 | 自定义 AST（`BlockNode` / `InlineNode`，带行列与偏移），没有 HTML 渲染器，也没有 markdown-it 风格的 token 流 |
| 扩展机制 | 无插件接口，GFM、脚注等以选项开关硬编码 |
| 增量 | `IncrementalEditParser` 在逐行 token 模型上局部重解析（50 行以内），与 CommonMark AST 是两套模型 |
| “流式 / 异步” | `parseMarkdownStream` 接受 `AsyncIterable<string>` 分块输入，但每块仍同步解析，只是把输入改成了异步 |

## 3. 对比

| 维度 | markdown-it（编辑器在用） | format-parser（自研） | @lezer/markdown（已在依赖树中） |
|------|------|------|------|
| CommonMark 0.31.2 规范 652 例 | **100%** | **58.9%**（修复前 58.3%，另有 8 例死循环） | 官方声明完整支持 CommonMark（未在此测 HTML 一致性，因为它只输出语法树） |
| 薄弱章节 | — | 链接引用定义 27%、图片 27%、实体与字符引用 29%、链接 38%、列表 42%、反斜杠转义 46%、HTML 块 50%、强调 57% | — |
| 88 万字符整篇解析 | 24 ms（token 流） | 28 ms（AST） | 48 ms（语法树） |
| 改一个字后重新解析 | 整篇，约 24 ms | 整篇，约 28 ms（简化 token 模型可以局部解析，但不是 CommonMark AST） | **增量 1.7 ms**（复用未变化的树片段） |
| 位置信息 | 块级行号（`map`），行内没有 | 块级与行内都有行列和偏移 | 每个节点都有偏移 |
| 扩展方式 | 成熟的插件体系（block / inline / core 规则链），生态里有大量插件 | 无，要改源码 | 扩展接口（`MarkdownConfig`：自定义块与行内解析器） |
| 与 ProseMirror 衔接 | prosemirror-markdown 直接消费 token 流，往返无损已验证 | 需要另写 AST 到文档的构建器与序列化 | 需要另写语法树到文档的构建器 |
| 与 CodeMirror 衔接 | 无 | 无 | 原生（`@codemirror/lang-markdown`） |
| 同步 / 异步 | 同步 | 同步；流式入口接受异步输入 | 同步，并可分段：`startParse` 每次推进一部分，可以切片执行，不阻塞主线程 |
| 依赖 | 零运行时依赖 | 零依赖 | 依赖 `@lezer/common` |
| 视频、双链、公式等扩展语法 | 通过插件和 Schema 实现，本仓库已全部实现 | 需要自己加 | 通过扩展接口实现 |

## 4. 关于“同步 / 异步”和“视频引入”

- **异步不等于更快。** 解析是 CPU 计算，换成异步 API 只是把同样的工作拆开来做。真正决定编辑体验的是两点：改一个字时要重新算多少（增量），以及计算放在哪个线程（Worker）。本仓库的 LaTeX 链路已经按这个思路做了：分块渲染加 Worker，诊断按块增量（本轮提交 `eb574b6`），80 万字符时改一段约 9ms。
- **视频引入不依赖解析器。** `![](x.mp4)` 在任何 CommonMark 解析器里都是图片语法，要不要显示成播放器由渲染层（Schema 的 `toDOM`、节点视图）按扩展名决定。本轮已经实现，并且保持了 Markdown 原文的兼容性。

## 5. 如果要把 format-parser 做成 markdown-it 的替代品

| 阶段 | 内容 | 验收标准 | 估计 |
|------|------|------|------|
| 0. 测试基线 | 把 CommonMark 规范 652 例与 GFM 规范用例接入包内测试（AST 转 HTML 适配层，见本次调研脚本），每次提交都跑 | 测试在 CI 中运行，通过率作为指标逐步提高 | 1 天 |
| 1. 规范达标 | 按章节补齐：链接引用定义、实体与字符引用、链接与图片（尖括号目标、标题、嵌套）、列表（松紧、缩进计算、空项）、强调（分隔符栈算法，即规范附录的 delimiter run 规则）、HTML 块 7 种起止条件、制表符展开 | CommonMark 不低于 99%，GFM 表格、删除线、任务列表、自动链接不低于 95% | 2–3 周 |
| 2. 扩展接口 | 块规则与行内规则可注册（参照 markdown-it 的规则链或 lezer 的 `MarkdownConfig`），公式、双链、嵌入、块 ID、视频改为扩展实现 | 本仓库现有的 6 个 markdown-it 插件全部能用扩展接口重写，行为一致 | 1 周 |
| 3. 真正的增量 | 以块为单位：编辑后从受影响块的前一个“安全边界”（空行且不在容器内）开始重解析，到新旧块序列重新对齐为止；行内解析按块缓存。借鉴 lezer 的 `TreeFragment` 复用思路 | 88 万字符改一个字的重新解析在 2ms 以内，结果与整篇解析逐节点一致（用随机编辑对比测试，做法同本轮 LaTeX 增量分析） | 2 周 |
| 4. 编辑器集成 | AST 到 ProseMirror 文档的构建器与序列化器，替换 prosemirror-markdown；或者输出兼容 markdown-it 的 token 流，直接复用 prosemirror-markdown | 现有 Markdown 往返测试全部通过，覆盖块引用、列表松紧、表格对齐、任务项等 | 1–2 周 |
| 5. 独立发布 | 拆出仓库或独立包名、文档、性能基准、模糊测试（随机输入不崩溃、不卡死） | 模糊测试 10 万次无异常；包体积与零依赖保持不变 | 3–5 天 |

合计约 **7–9 周**。阶段 1 和阶段 3 是主要成本，也是 format-parser 目前离成熟方案最远的地方。

**取舍建议**：如果目标是编辑器体验（大文档流畅、扩展语法），用 `@lezer/markdown` 补上增量，可以立刻得到成熟的结果，而 markdown-it 在编辑器里没有性能问题。如果目标是拥有一个自主可控、带完整位置信息、零依赖的解析库，并对外发布，那么阶段 0、1 应该先做，因为一个对规范例子都给不出正确结果的解析器无法对外承诺。

## 6. 测量方法

- **规范一致性**：下载 `https://spec.commonmark.org/0.31.2/spec.json`（652 例），markdown-it 用 `commonmark` 预设直接渲染 HTML；format-parser 的 AST 由脚本按 CommonMark 的 HTML 约定渲染。两边做同样的空白规范化后与期望 HTML 比较。markdown-it 得到 100%，说明这套比较方法本身没有误判。脚本给每个用例设了 15 秒超时，超时即判定为死循环。
- **性能**：`docs/USER_GUIDE.md` 重复到约 88 万字符，各运行 7 次取中位数（Node 24、Apple Silicon）。此前记录的“markdown-it 约 85ms、format-parser 约 38ms”用的是另一份测试文档（内容结构不同，长行与嵌套更多），两组数字都说明整篇解析在百毫秒以内，不是瓶颈。
- **lezer 增量**：先整篇解析一次，在文档中间插入一个字符，用 `TreeFragment.applyChanges` 复用旧语法树片段后重新解析。
