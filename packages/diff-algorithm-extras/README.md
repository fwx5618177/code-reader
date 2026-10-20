# @code-reader/diff-algorithm-extras

从 `@code-reader/diff-algorithm` 中分出的、桌面端当前没有用到的差分算法。核心库不依赖本包，需要时单独引入：

| 入口 | 内容 |
|------|------|
| `@code-reader/diff-algorithm-extras/algorithms` | 滚动哈希（Adler-32、Rabin）与内容定义分块、rsync 增量同步、Patience Diff、LCS、VCDIFF / BSDiff 适配器、CRDT 协作接口定义 |
| `@code-reader/diff-algorithm-extras/streaming` | 大文件流式哈希、流式差分 |
| `@code-reader/diff-algorithm-extras/dmp-standalone` | 不依赖 `diff-match-patch` 包的完整差分实现（差分、语义 / 效率清理、合并、应用、统计）、FNV-1a / xxHash32 / Adler-32 哈希、Levenshtein 相似度，以及可内联为 Blob Worker 的脚本生成器与 `EnhancedWorkerPool` |
| `@code-reader/diff-algorithm-extras` | 以上全部（`dmp-standalone` 以 `dmpStandalone` 命名空间导出；流式差分的指令类型改名为 `StreamingDeltaInstruction*`，避免与 rsync 重名） |

```typescript
import { quickRsync, quickPatienceDiff } from '@code-reader/diff-algorithm-extras/algorithms';
import { quickStringHash } from '@code-reader/diff-algorithm-extras/streaming';
import { diffMain, diffApply } from '@code-reader/diff-algorithm-extras/dmp-standalone';

const { reconstructed, isValid } = quickRsync(oldBytes, newBytes);
const lines = quickPatienceDiff(oldText, newText);
const patched = diffApply(oldText, diffMain(oldText, newText, true, Date.now() + 1000));
```

测试：`pnpm --filter @code-reader/diff-algorithm-extras test`（每种算法至少一次“差分 → 应用 → 还原”或基本性质验证）。
