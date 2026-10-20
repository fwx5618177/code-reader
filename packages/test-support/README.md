# @code-reader/test-support

各包测试共用的工具，只在测试中使用（`devDependencies` 引用 `workspace:*`）。Vitest 直接加载 TypeScript 源码，所以这个包没有构建步骤。

## perfBudget：性能断言的耗时预算

```typescript
import { perfBudget } from '@code-reader/test-support';

expect(median(times)).toBeLessThan(perfBudget(60)); // 开发机上 60ms
```

- 测试里只写开发机（Apple Silicon，单独运行）上的预算，用来发现数量级的退化，例如算法从线性退化成指数。
- CI 运行器更慢，而且多个包的测试并行运行，绝对耗时不可比。工作流里设置 `PERF_BUDGET_SCALE`（目前为 10），所有预算按这个倍数统一放宽，与 Node.js 测试套件的 `common.platformTimeout` 是同一做法。
- 未设置时倍数为 1；设置成非正数或非数字时直接报错，避免悄悄放过所有性能断言。
- 新写的耗时断言都要经过 `perfBudget`，不要直接写毫秒数。
