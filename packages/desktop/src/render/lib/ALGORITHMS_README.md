# 渲染进程算法说明

记录 desktop 渲染进程中实际在用的算法：名称、用途、调用位置与实现状态。通用算法放在独立子包，desktop 直接通过包接口使用，不保留本地副本或转发入口。

## 1. 子包算法（直接按包接口使用）

| 算法 | 包与函数 | 用途 | 调用位置 |
|------|----------|------|----------|
| Damerau-Levenshtein 距离 | `@code-reader/fuzzy-match-algorithm` `damerauLevenshteinDistance` | 拼写建议排序（相邻字符交换只计 1 次，适合打字错误） | `lib/spellcheck/suggest.ts` |
| 文本差分（Myers 等，按内容自动选择） | `@code-reader/diff-algorithm` `createDiffEngine`、`quickDiff` | 版本对比、增量保存、撤销重做快照 | `lib/writing`（`writing-service.ts`、`DiffViewer`）、`lib/core/delta/history-manager.ts`、`lib/core/save-engine`、`lib/documents/writing-integration.ts` |
| 全文索引与搜索 | `@code-reader/search-service` | 写作文档全文搜索与建议 | `lib/writing` |
| 补全服务 | `@code-reader/autocomplete-service` | CodeMirror 代码块补全（Markdown / Emoji / 代码片段 provider） | `components/RichEditor/CodeBlockView.ts` |
| 文本存储（Piece Table / Rope） | `@code-reader/text-buffer` | LaTeX 编辑缓冲区，按规模选择结构 | `lib/latex` |
| 增量语法解析 | `@code-reader/syntax-parser` | LaTeX 增量解析 | `lib/latex` |

## 2. desktop 内的业务算法

| 算法 | 文件 | 用途 | 说明 |
|------|------|------|------|
| Hunspell 词缀展开与查词 | `lib/spellcheck/affix.ts`、`hunspell.ts` | 拼写检查 | 解析 `.aff` 的 PFX/SFX（条件、剥离、交叉组合、链式后缀）、四种 FLAG 格式与别名、简单复合词、大小写规则；词典为独立资源文件（`assets/dictionaries/`，用户导入的在 `userData/spellcheck/`），在 Worker 中加载与查询 |
| 拼写建议生成 | `lib/spellcheck/suggest.ts` | 右键菜单建议 | 候选：`.aff` 中 REP 常见错误替换、基于 TRY 字符的一次编辑、拆成两个词、大小写修正、同首字母词形中编辑距离 ≤ 2 的词；按 Damerau-Levenshtein 距离排序，并参考 REP 命中、首字母、键盘相邻 |
| 分词与跳过规则 | `lib/spellcheck/tokenize.ts` | 拼写检查范围 | 只检查拉丁字母单词；跳过 CJK、代码、链接、公式、URL、邮箱、路径、含数字或下划线的词、全大写缩写、驼峰标识符 |
| Barnes–Hut 力导向布局 | `lib/links/force-layout.ts` | 知识图谱布局 | 四叉树近似斥力，O(n log n) |
| 链接重命名改写 | `lib/links/rename.ts` | 重命名笔记时更新 `[[ ]]` | 只替换链接目标名，保留别名、标题片段与原文其余字节；跳过代码与公式 |
| 嵌入展开 | `lib/links/embed.ts` | `![[ ]]` 嵌入 | 深度上限 + 已访问集合防止循环 |
| 跨文本节点定位 | `lib/reading/highlight-dom.ts` | 阅读高亮 | TreeWalker 拼接文本节点，全局偏移映射回 (节点, 偏移)，逐节点包裹 `<mark>` |
| 行级差分重建 | `lib/writing/components/diff-lines.ts` | 版本对比视图 | 把字符级差分重建为“旧行 + 新行”，行内只高亮变化部分 |

Markdown 解析与序列化由 `lib/markdown`（markdown-it + ProseMirror）负责；增量解析器与 CommonMark 解析器在子包 `packages/format-parser`。数学公式使用自研解析与渲染（`lib/math`），不依赖 KaTeX / MathJax。
