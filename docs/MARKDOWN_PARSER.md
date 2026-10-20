# Markdown 解析：设计与验证

编辑器、大纲、链接同步、预览与阅读视图、HTML 导出用的都是仓库自己的 `@code-reader/markdown-parser`，它是零依赖的独立子包。本文说明它的设计、它在编辑器里的用法，以及怎样验证它。API 用法见 [包的 README](../packages/markdown-parser/README.md)。

## 1. 现状

| 项目 | 情况 |
|------|------|
| CommonMark 0.31.2 规范 | **652/652**（`__tests__/commonmark-spec.test.ts` 逐字比较 HTML，下限 652） |
| 算法 | 块级用规范里“打开的块”的逐行算法，行内用分隔符栈与方括号栈（规范附录的做法，与参考实现 commonmark.js 相同） |
| 链接引用定义 / 字符引用 | 全部支持，内置 HTML5 命名字符引用表（2125 个） |
| GFM | 表格、任务列表项、删除线（可只认 `~~`）、扩展自动链接（规范用例全部通过；可选识别 `example.com` 这类裸域名） |
| 扩展语法 | 脚注（按第一次引用编号、行内脚注、文末回链）、定义列表、`:::` 自定义容器、高亮 / 插入 / 上下标、缩写、YAML 头部、排版替换、智能标点、`{…}` 属性 |
| 链接规范化 | IDN 主机名转 `xn--`（RFC 3492 Punycode，零依赖），其余百分号编码；自动链接的显示文字反向还原 |
| HTML 渲染 | `renderHtml`：默认拒绝不安全链接，支持代码高亮回调、`langPrefix`、`xhtmlOut`、扩展节点自定义渲染 |
| 扩展接口 | `inlineExtensions`（触发字符 + 匹配函数）、`blockExtensions`（可跨行的叶子块，可在引用与列表中，可选能否打断段落） |
| 位置信息 | 块级与行内都是源码中的绝对位置（引用 `>`、列表缩进等前缀已计入），表格的行与单元格各有位置 |
| token 流 | `TokenStreamTokenizer` 输出扁平 token（`*_open` / `*_close` 成对，行内 token 在 `children`），每个 token 带源码位置 |
| 增量解析 | `IncrementalCommonMarkParser` 只重新解析受影响的顶层块，其余块平移位置后复用 |
| 健壮性 | 4 万次随机输入（含全部扩展语法）不抛错，单次不超过 50ms |
| 性能 | 规范用例与中文笔记混合的 91 万字符：语法树约 79ms，语法树加 token 约 110ms；编辑器完整分词（含扩展与后处理）93 万字符约 40ms；常见笔记在 5ms 以内（Node 24、Apple Silicon） |

## 2. 在编辑器里的管线

```
Markdown 原文
  │  TokenStreamTokenizer（preserveSource：脚注定义、缩写定义留在原位，保存不丢内容）
  │  + 桌面端扩展：公式 $…$ / $$…$$、双向链接 [[…]]、块级嵌入 ![[…]]（lib/markdown/syntax-extensions.ts）
  ▼
token 流 ──► TokenDocumentBuilder（按规则表建 ProseMirror 文档，lib/markdown/token-document-builder.ts）
                │
                ▼
          编辑器文档 ──► MarkdownSerializer（每个顶层块的 Markdown 用 WeakMap 缓存，只重新序列化改动的块）──► 保存
```

- **输入时不重新解析**：ProseMirror 持有文档，按键只改文档；Markdown 只在打开、切换视图、保存时与文档互转。
- **增量解析用在按文本工作的地方**：写作大纲与保存后的链接同步按文档 id（`env.key`）走语法树级增量解析。真实应用中 1500 个小节的文档逐键输入，每次按键含渲染往返的中位数约 26ms，大纲与内容一致。
- **YAML 头部**：文档开头的 `---…---` 是独立的“文档属性”块，往返不变；YAML 按语法着色并标出写错的行，`tags` 同步为条目标签，`aliases` 参与 `[[ ]]` 解析。
- **扩展语法都有编辑入口**：脚注、高亮 / 插入 / 上下标、定义列表、`:::` 提示块、缩写、裸网址都有对应的节点或标记、输入规则与斜杠命令，保存时逐字不变。
- **视频**：`![[x.mp4]]` 与 `![](x.mp4)` 在语法上都是嵌入 / 图片，由渲染层按扩展名显示为播放器，原文不变。

## 3. 增量解析的做法

从“第一行在编辑之前的最后一个顶层块”开始重新解析；在编辑之后找一个旧顶层块作为拼接点（解析到它的第一行，确认该行在新文本中同样开始一个顶层块），之后的旧块整体平移位置后复用；脚注整篇重新编号。编辑区出现链接引用、缩写、脚注定义，或 YAML 头部可能被闭合时，改为整篇解析。

验证：12 万次随机编辑（40 组文档 × 1500 次 × 2 种选项）与整篇解析逐节点相同，约 87% 的编辑只重新解析附近的块；提交的测试每次运行 3000 次。

## 4. 回归基准与测量方法

- **规范一致性**：`__tests__/fixtures/commonmark-0.31.2.json`（官方 spec.json，652 例），解析后用 `renderHtml` 输出，与期望 HTML 逐字比较。
- **token 流与扩展语法**：规范 652 例与全部扩展语法用例的 token 与 HTML，和冻结的参照输出 `__tests__/fixtures/reference.json` 逐项比较（`token-stream.test.ts`、`syntax-extension-tokens.test.ts`）。改动解析器后如果这里不一致，要先判断是修正还是回归，确认是修正后再更新参照输出。
- **编辑器往返**：桌面端 `lib/markdown/__tests__`（`markdown.test.ts`、`extended-syntax.test.ts`、`front-matter.test.ts`、`footnotes.test.ts` 等）把 Markdown 解析成编辑器文档再保存，覆盖列表松紧、表格对齐、任务项、块引用、YAML 头部与全部扩展语法，保存结果必须与原文相同。
- **性能**：把测试文档重复到约 90 万字符，各运行 7 次取中位数。
- **增量**：随机位置插入、删除、替换，每次都与整篇解析的结果逐节点比较。

## 5. 逐行 token 增量解析

`IncrementalEditParser` 与 `parseMarkdownStream` 面向超大文件与流式输入，产出逐行 token，与上面的语法树是两套模型；`parseMarkdownStream` 接受 `AsyncIterable<string>` 分块输入，每块同步解析。编辑器不使用它们。
