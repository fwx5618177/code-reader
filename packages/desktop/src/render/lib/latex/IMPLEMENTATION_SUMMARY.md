# LaTeX 编辑器渲染管道重构实现总结

## 概述

本次重构实现了三个核心功能：

1. **完全集成流式解析管道到 LatexEditor**
2. **优化大文件粘贴性能，使用 Web Worker 进行后台解析**
3. **添加更多数学符号支持，验证滚动同步精确**

---

## 一、流式解析管道集成

### 核心文件

#### 1. `pipeline-integration.ts`
完整的流式解析管道集成器，提供统一的解析-渲染-同步接口。

**主要特性：**
- 自动检测文件大小并选择最优解析策略
- 大文件分块解析，避免主线程阻塞
- 增量更新支持，只更新变化的块
- 精确的源码-渲染位置映射

**核心类：**
```typescript
class PipelineIntegration {
  // 设置内容并解析
  async setContent(content: string, options?): Promise<ParseRenderResult>

  // 应用增量编辑
  async applyEdit(edit: EditOperation): Promise<IncrementalUpdateResult>

  // 计算滚动同步位置
  computeScrollSync(request: ScrollSyncRequest): ScrollSyncResult

  // 获取可见块信息
  getVisibleBlocks(scrollTop, viewportHeight, source): VisibleBlockInfo[]

  // 更新块测量
  updateBlockMeasurement(blockId, height, top?): void
}
```

#### 2. `useLatexPipeline.ts` (Hook)
React Hook，封装流式管道功能供组件使用。

**提供的能力：**
- `html` - 渲染后的 HTML
- `ast` - 解析后的 AST
- `blocks` - 解析块列表
- `parseState` - 解析状态（进度、时间、错误等）
- `setContent()` - 设置内容（带防抖）
- `applyChanges()` - 应用变更
- `syncScroll()` - 滚动同步
- `getPositionMapping()` - 获取位置映射

---

## 二、Web Worker 后台解析

### 核心文件

#### 1. `parse-worker.ts`
高性能后台解析 Worker，支持：

- **分块解析**：大文件自动分块，避免主线程阻塞
- **流式响应**：实时返回解析进度和部分结果
- **可取消**：支持取消正在进行的解析任务
- **内存优化**：增量解析缓存，减少重复工作

**消息类型：**
```typescript
// 请求类型
type ParseWorkerRequestType =
  | 'parse'              // 完整解析
  | 'parse_incremental'  // 增量解析
  | 'parse_chunked'      // 分块解析
  | 'render'             // 渲染
  | 'render_blocks'      // 块渲染
  | 'cancel'             // 取消
  | 'clear_cache'        // 清除缓存
  | 'get_stats';         // 获取统计

// 响应类型
type ParseWorkerResponseType =
  | 'parse_result'       // 解析结果
  | 'parse_progress'     // 解析进度
  | 'parse_chunk'        // 分块结果
  | 'render_result'      // 渲染结果
  | 'render_progress'    // 渲染进度
  | 'cancelled'          // 已取消
  | 'error'              // 错误
  | 'stats';             // 统计信息
```

#### 2. `parse-worker-service.ts`
Worker 服务封装，提供：

- **自动策略选择**：根据文件大小自动选择解析策略
- **主线程 Fallback**：Worker 不可用时自动降级
- **超时处理**：超时自动取消并返回错误
- **重试机制**：失败自动重试

**配置选项：**
```typescript
interface ParseWorkerServiceConfig {
  largeFileThreshold: number;     // 大文件阈值（默认 50KB）
  hugeFileThreshold: number;      // 超大文件阈值（默认 500KB）
  defaultChunkSize: number;       // 默认分块大小（32KB）
  largeFileChunkSize: number;     // 大文件分块大小（16KB）
  hugeFileChunkSize: number;      // 超大文件分块大小（8KB）
  defaultTimeout: number;         // 默认超时（30秒）
  maxRetries: number;             // 最大重试次数
  debug: boolean;                 // 调试模式
}
```

**使用示例：**
```typescript
import { parseLatex, renderLatex, parseAndRenderLatex } from './parse-worker-service';

// 解析 LaTeX
const ast = await parseLatex(content, {
  chunked: true,
  onProgress: (progress, info) => {
    console.log(`解析进度: ${progress * 100}%`);
  }
});

// 渲染
const html = await renderLatex(ast);

// 或一步完成
const { ast, html } = await parseAndRenderLatex(content);
```

---

## 三、扩展数学符号支持

### 核心文件

#### `extended-symbols.ts`
大幅扩展的数学符号支持，包含：

**1. 扩展希腊字母（含变体）**
- 完整的小写和大写希腊字母
- 变体形式：`\varepsilon`, `\vartheta`, `\varphi` 等

**2. 扩展关系运算符**
- 基本关系：`=`, `≠`, `<`, `>`, `≤`, `≥`
- 相似和全等：`∼`, `≃`, `≅`, `≈`
- 集合关系：`⊂`, `⊃`, `⊆`, `⊇`, `∈`, `∉`
- 否定关系：`≮`, `≯`, `⊀`, `⊁`

**3. 扩展二元运算符**
- 基本运算：`±`, `∓`, `×`, `÷`, `·`
- 集合运算：`∩`, `∪`, `∖`
- 逻辑运算：`∧`, `∨`, `⊕`, `⊗`

**4. 扩展大型运算符**
- 积分：`∫`, `∬`, `∭`, `∮`, `∯`, `∰`
- 求和/乘积：`∑`, `∏`, `∐`
- 集合：`⋂`, `⋃`, `⨁`, `⨂`

**5. 扩展箭头符号**
- 基本箭头：`←`, `→`, `↑`, `↓`, `↔`, `↕`
- 双线箭头：`⇐`, `⇒`, `⇑`, `⇓`, `⇔`
- 长箭头：`⟵`, `⟶`, `⟷`, `⟸`, `⟹`, `⟺`
- 映射箭头：`↦`, `↤`, `↪`, `↩`

**6. 字体样式支持**
- 黑板粗体：`\mathbb{R}` → `ℝ`, `\mathbb{N}` → `ℕ`
- 花体/手写体：`\mathcal{A}` → `𝒜`
- 哥特体：`\mathfrak{A}` → `𝔄`

**7. 物理符号**
- 普朗克常数：`ℏ`, `ℎ`
- Dirac 符号：`⟨`, `⟩`

**使用示例：**
```typescript
import {
  lookupSymbol,
  isKnownSymbol,
  getBlackboardBold,
  EXTENDED_GREEK_LETTERS,
  EXTENDED_ARROWS
} from './extended-symbols';

// 查找符号
const symbol = lookupSymbol('rightarrow'); // → '→'

// 检查是否已知符号
const known = isKnownSymbol('alpha'); // → true

// 获取黑板粗体
const bb = getBlackboardBold('R'); // → 'ℝ'
```

---

## 四、精确滚动同步

### 核心文件

#### 1. `scroll-sync.ts`
精确滚动同步控制器，支持多种同步模式：

**同步模式：**
- `ratio` - 简单比例同步
- `line` - 基于行号同步（使用 HeightMap）
- `block` - 基于块同步
- `hybrid` - 混合模式（推荐，自动选择最佳策略）

**特性：**
- 双向同步（编辑器 ↔ 预览）
- 锁定机制防止循环触发
- 平滑滚动动画
- 死区处理避免抖动

#### 2. `useScrollSync.ts` (Hook)
React Hook，封装滚动同步功能：

```typescript
import { useScrollSync } from './hooks/useScrollSync';

const {
  isLocked,
  activeSource,
  handleEditorScroll,
  handlePreviewScroll,
  syncToLine,
  syncToBlock,
  setHeightMap,
  setBlocks
} = useScrollSync(
  (target, scrollTop, options) => {
    // 执行滚动
    if (target === 'editor') {
      editorRef.current.scrollTo(scrollTop);
    } else {
      previewRef.current.scrollTo(scrollTop);
    }
  },
  { mode: 'hybrid', smoothScroll: true }
);
```

---

## 五、新增导出

### `latex/index.ts` 新增导出

```typescript
// Worker 服务
export {
  ParseWorkerService,
  getParseWorkerService,
  parseLatex,
  renderLatex,
  parseAndRenderLatex,
} from './parse-worker-service';

// 管道集成
export {
  PipelineIntegration,
  createPipelineIntegration,
  getGlobalPipelineIntegration,
} from './pipeline-integration';

// 滚动同步
export {
  ScrollSyncController,
  createScrollSyncController,
  computeEditorToPreviewPosition,
  computePreviewToEditorPosition,
} from './scroll-sync';
```

### `math/index.ts` 新增导出

```typescript
export {
  EXTENDED_GREEK_LETTERS,
  EXTENDED_RELATIONS,
  EXTENDED_BINARY_OPERATORS,
  EXTENDED_LARGE_OPERATORS,
  EXTENDED_ARROWS,
  BLACKBOARD_BOLD,
  CALLIGRAPHIC,
  FRAKTUR,
  lookupSymbol,
  isKnownSymbol,
  getBlackboardBold,
  getCalligraphic,
  getFraktur,
} from './extended-symbols';
```

### `hooks/index.ts` 新增导出

```typescript
export { useLatexPipeline } from './useLatexPipeline';
export { useScrollSync, useDebouncedScrollHandler, useThrottledScrollHandler } from './useScrollSync';
```

---

## 六、性能优化总结

### 大文件粘贴优化

| 文件大小 | 策略 | 分块大小 | 防抖延迟 |
|---------|------|---------|---------|
| < 50KB | 同步解析 | - | 150ms |
| 50-500KB | Worker + 分块 | 16KB | 300ms |
| > 500KB | Worker + 小分块 | 8KB | 500ms |

### 滚动同步优化

1. **HeightMap 精确测量**
   - 基于实际 DOM 测量而非估算
   - 增量更新，只测量变化的块

2. **混合同步模式**
   - 测量率 > 30% 时使用行同步
   - 否则使用块同步 + 比例同步加权混合

3. **防抖/节流**
   - 滚动事件节流（16ms）
   - 同步延迟（16ms）
   - 锁定持续时间（100ms）

---

## 七、后续优化建议

1. **完全迁移到 Worker**
   - 将数学公式渲染也迁移到 Worker
   - 使用 SharedArrayBuffer 减少数据复制

2. **虚拟滚动优化**
   - 对超大文档使用虚拟滚动渲染
   - 只渲染可见区域的块

3. **缓存优化**
   - 使用 IndexedDB 持久化缓存
   - LRU 缓存策略

4. **增量渲染**
   - 只渲染变化的块
   - 使用 requestIdleCallback 分帧渲染