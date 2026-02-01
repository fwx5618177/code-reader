# LaTeX 编辑器性能优化指南

## 概述

本文档说明如何使用新增的高性能模块解决以下问题：

1. **Source Map 精度问题**：滚动同步偏移过大
2. **增量解析 OOM 问题**：大文件编辑时内存溢出导致崩溃
3. **矩阵/表格渲染问题**：矩阵被错误渲染为带边框的表格

## 新增核心模块

| 模块 | 文件 | 功能 |
|------|------|------|
| RenderPipeline | `render-pipeline.ts` | 统一的高性能渲染管道，集成 HeightMap 和调度器 |
| StreamingParserV2 | `streaming-parser-v2.ts` | 高性能流式解析器，零拷贝设计，解决 OOM |
| HeightMap | `height-map.ts` | 精确的块高度映射系统 |
| FrameScheduler | `frame-scheduler.ts` | 帧预算调度器 |

---

## 1. Source Map 精度问题解决方案

### 问题根源

原有实现使用 `lineCount * estimatedLineHeight` 进行估算，未考虑实际 DOM 渲染高度，导致滚动同步严重不准确。

### 解决方案：HeightMap 系统

基于 CodeMirror 6 的 HeightMap 设计思路，使用平衡二叉树存储块高度信息，支持真实 DOM 测量回写。

#### 核心类：`HeightMap`

```typescript
import {
  HeightMap,
  createHeightMap,
  createHeightMapFromAST,
  measureDOMBlocks,
  createBlockResizeObserver,
} from '@/render/lib/latex';
```

#### 基本使用

```typescript
// 1. 从 AST 创建 HeightMap（初始使用估算值）
const heightMap = createHeightMapFromAST(ast, sourceContent, {
  defaultLineHeight: 24,
  totalLines: lineCount,
});

// 2. 渲染后进行 DOM 测量并回写真实高度
const container = document.querySelector('.preview-container');
const measurements = measureDOMBlocks({ container });
heightMap.updateBlockPositions(measurements);

// 3. 使用 ResizeObserver 持续监听高度变化
const observer = createBlockResizeObserver(container, heightMap);

// 4. 精确的滚动同步
const previewScrollTop = heightMap.computePreviewScrollPosition(
  sourceScrollTop,
  sourceViewportHeight,
  sourceTotalHeight
);
```

#### 精度提升原理

1. **初始估算**：解析 AST 后，根据行数和默认行高生成初始映射
2. **DOM 测量**：渲染完成后，通过 `getBoundingClientRect()` 测量真实高度
3. **增量更新**：使用 `ResizeObserver` 监听高度变化，实时更新映射
4. **混合权重**：根据测量率动态调整精确位置和比例计算的权重

---

## 2. 增量解析 OOM 问题解决方案

### 问题根源

- 主线程执行大量字符串复制（`string.slice()`）
- 生成过多中间对象导致 GC 压力过大
- 没有帧预算控制，长时间阻塞主线程

### 解决方案：帧预算调度器 + 对象池

#### 核心类：`FrameScheduler`

```typescript
import {
  FrameScheduler,
  createFrameScheduler,
  createHighPerformanceScheduler,
  FrameTaskPriority,
} from '@/render/lib/latex';
```

#### 基本使用

```typescript
// 创建高性能调度器
const scheduler = createHighPerformanceScheduler();

// 调度解析任务（分块执行）
let chunkIndex = 0;
const chunks = splitContentIntoChunks(content);

scheduler.schedule(
  'parse-chunk',
  () => {
    // 每次只解析一个块
    const chunk = chunks[chunkIndex++];
    parseChunk(chunk);
    
    // 返回 true 表示任务完成，false 表示需要继续
    return chunkIndex >= chunks.length;
  },
  {
    priority: FrameTaskPriority.HIGH,
    onComplete: () => {
      console.log('所有块解析完成');
    },
  }
);

// 取消所有任务
scheduler.cancelAll();

// 销毁调度器
scheduler.destroy();
```

#### 配置说明

```typescript
const scheduler = createFrameScheduler({
  maxFrameTime: 8,       // 每帧最大处理时间（毫秒）
  idleThreshold: 4,      // 空闲阈值
  useIdleCallback: true, // 使用 requestIdleCallback
  maxConcurrentTasks: 1, // 最大并发任务数
  batchSize: 3,          // 任务批处理大小
});
```

#### 内存压力响应

调度器内置内存监控，会根据压力等级自动调整策略：

- **LOW**：正常执行
- **MEDIUM**：减少批处理大小
- **HIGH**：进一步降低批处理，增加延迟
- **CRITICAL**：暂停处理，等待内存恢复

---

## 3. 推荐的最佳实践

### 大文件处理流程

```typescript
async function handleLargeFile(content: string) {
  const scheduler = createHighPerformanceScheduler();
  const heightMap = createHeightMap({ defaultLineHeight: 24 });
  
  try {
    // 1. 使用帧调度器分块解析
    const result = await parseWithScheduler(content, scheduler);
    
    // 2. 从 AST 生成初始高度映射
    const blocks = extractBlocks(result.ast, content);
    heightMap.addBlocks(blocks);
    
    // 3. 渲染预览
    renderPreview(result.html);
    
    // 4. DOM 测量回写
    await waitForRender();
    const measurements = measureDOMBlocks({ container });
    heightMap.updateBlockPositions(measurements);
    
    // 5. 设置滚动同步
    setupScrollSync(heightMap);
    
  } finally {
    scheduler.destroy();
  }
}
```

### 虚拟滚动集成

对于超大文件（>200KB），建议结合虚拟滚动：

```typescript
// 只渲染可见区域的块
const visibleBlocks = heightMap.getVisibleBlocks(scrollTop, viewportHeight);

// 设置可见区域优先解析
scheduler.schedule('parse-visible', parseVisible, {
  priority: FrameTaskPriority.HIGH,
});

scheduler.schedule('parse-rest', parseRest, {
  priority: FrameTaskPriority.LOW,
});
```

---

## 4. 矩阵/表格渲染修复

### 问题根源

KaTeX 渲染的矩阵使用 `.mtable` 等类名，被全局的 `table` 样式影响，显示了不应有的边框。

### 解决方案

在 `RichEditor.module.scss` 中添加了针对性的样式修复：

```scss
.latex-math-block {
  .katex {
    // 全局修复：确保矩阵/表格不显示边框
    .mtable,
    .mtr,
    .mtd {
      border: none !important;
      background: transparent;
    }
  }
  
  // matrix 环境特定修复
  &.latex-math-matrix {
    .katex .mtable {
      border: none !important;
      border-collapse: collapse;
      
      .mtd {
        border: none !important;
        padding: 0.15em 0.4em;
        text-align: center;
      }
    }
  }
}
```

---

## 5. 渲染管道 (RenderPipeline)

### 概述

`RenderPipeline` 是一个统一的高性能渲染管道，集成了 HeightMap、FrameScheduler 和流式解析。它解决了以下核心问题：

- 大文件渲染导致主线程阻塞
- 滚动同步不精确
- 可见区域优先渲染

### 基本使用

```typescript
import {
  RenderPipeline,
  createRenderPipeline,
  createHighPerformancePipeline,
} from '@/render/lib/latex';

// 创建管道
const pipeline = createHighPerformancePipeline();

// 设置内容
pipeline.setContent(latexSource);

// 初始化块
await pipeline.initializeBlocks();

// 设置可见范围（滚动时更新）
pipeline.setVisibleRange({
  startLine: 10,
  endLine: 50,
  scrollTop: 200,
  viewportHeight: 600,
});

// 调度渲染（优先渲染可见块）
const result = await pipeline.scheduleRendering(async (content, type) => {
  // 你的解析逻辑
  const html = await parseAndRender(content);
  return { html };
});

// 绑定预览容器（启用 DOM 测量）
pipeline.bindPreviewContainer(previewElement);

// 触发 DOM 测量
pipeline.measureBlocks();

// 滚动同步
const previewScroll = pipeline.computePreviewScroll(
  sourceScrollTop,
  sourceViewportHeight,
  sourceLineHeight
);

// 销毁
pipeline.destroy();
```

### 配置选项

```typescript
interface RenderPipelineConfig {
  defaultLineHeight: number;      // 默认行高估算（px），默认 24
  visibilityPadding: number;      // 可见区域外延（行数），默认 20
  maxConcurrentParse: number;     // 最大并发解析任务，默认 4
  maxFrameTime: number;           // 每帧最大时间（ms），默认 8
  useWorker: boolean;             // 是否使用 Worker，默认 true
  memoryThreshold: number;        // 内存压力阈值（MB），默认 500
  enableDOMMeasurement: boolean;  // 是否启用 DOM 测量，默认 true
  debug: boolean;                 // 调试模式，默认 false
}
```

---

## 6. 流式解析器 V2 (StreamingParserV2)

### 概述

`StreamingParserV2` 是专门解决大文件 OOM 问题的高性能解析器。核心设计原则：

1. **零拷贝**：使用偏移而非子字符串切片
2. **流式处理**：逐块解析，不一次性加载全部 AST
3. **对象池复用**：减少 GC 压力
4. **帧预算控制**：每帧最多处理固定时间
5. **可见优先**：优先解析可见区域

### 基本使用

```typescript
import {
  StreamingParserV2,
  createStreamingParserV2,
  createHighPerformanceParser,
  getGlobalStreamingParser,
} from '@/render/lib/latex';

// 创建解析器
const parser = createHighPerformanceParser();

// 设置内容
parser.setContent(latexSource);

// 设置可见范围（优化优先级）
parser.setVisibleRange(10, 50);

// 初始化块（分割内容）
await parser.initializeChunks();

// 流式解析
const result = await parser.parse();

if (result.success) {
  console.log(`解析完成：${result.parsedCount}/${result.totalCount} 块`);
  console.log(`AST:`, result.ast);
}

// 增量更新（编辑时）
await parser.applyChanges([
  { from: 100, to: 110, insertLength: 20, deleteLength: 10 }
]);

// 获取统计信息
const stats = parser.getStats();
console.log(`块数: ${stats.totalChunks}, 已解析: ${stats.parsedChunks}`);

// 取消解析
parser.cancel();

// 销毁
parser.destroy();
```

### 与传统解析器对比

| 特性 | 传统解析器 | StreamingParserV2 |
|------|-----------|-------------------|
| 内存使用 | 全部加载，线性增长 | 分块处理，可控制 |
| 大文件支持 | OOM 崩溃 | 流式处理，无限制 |
| 主线程阻塞 | 长时间阻塞 | 帧预算控制 |
| 增量更新 | 全量重解析 | 只解析变化块 |
| 可见优先 | 不支持 | 支持优先级调度 |

---

## 7. API 参考

### HeightMap

| 方法 | 说明 |
|------|------|
| `addBlock(block)` | 添加块 |
| `addBlocks(blocks)` | 批量添加块 |
| `updateBlockPosition(id, top, height)` | 更新单个块位置 |
| `updateBlockPositions(updates)` | 批量更新块位置 |
| `getPositionForLine(line)` | 根据行号获取渲染位置 |
| `getLineForPosition(position)` | 根据渲染位置获取行号 |
| `getVisibleBlocks(scrollTop, height)` | 获取可见区域的块 |
| `computePreviewScrollPosition(...)` | 计算预览滚动位置 |
| `computeSourceScrollPosition(...)` | 计算源码滚动位置 |
| `getMeasurementRate()` | 获取测量率（0-1） |

### FrameScheduler

| 方法 | 说明 |
|------|------|
| `schedule(name, execute, options)` | 调度任务 |
| `scheduleBatch(tasks)` | 批量调度任务 |
| `cancel(taskId)` | 取消指定任务 |
| `cancelAll()` | 取消所有任务 |
| `start()` | 启动调度器 |
| `pause()` | 暂停调度器 |
| `resume()` | 恢复调度器 |
| `stop()` | 停止调度器 |
| `destroy()` | 销毁调度器 |
| `getStats()` | 获取统计信息 |
| `getMemoryPressure()` | 获取当前内存压力 |
| `yieldToMain()` | 让出主线程 |

### RenderPipeline

| 方法 | 说明 |
|------|------|
| `setContent(content)` | 设置源码内容 |
| `initializeBlocks()` | 初始化渲染块 |
| `setVisibleRange(range)` | 设置可见范围 |
| `scheduleRendering(parser)` | 调度渲染任务 |
| `bindPreviewContainer(el)` | 绑定预览容器 |
| `measureBlocks()` | 测量 DOM 块 |
| `computePreviewScroll(...)` | 计算预览滚动位置 |
| `computeSourceScroll(...)` | 计算源码滚动位置 |
| `getBlocks()` | 获取所有块 |
| `getVisibleBlocks()` | 获取可见块 |
| `addEventListener(listener)` | 添加事件监听 |
| `getStats()` | 获取统计信息 |
| `destroy()` | 销毁管道 |

### StreamingParserV2

| 方法 | 说明 |
|------|------|
| `setContent(content)` | 设置源码内容 |
| `setVisibleRange(start, end)` | 设置可见行范围 |
| `initializeChunks()` | 初始化分块 |
| `parse()` | 执行流式解析 |
| `applyChanges(changes)` | 增量更新 |
| `getAST()` | 获取 AST |
| `getChunks()` | 获取所有块 |
| `getVisibleChunks()` | 获取可见块 |
| `cancel()` | 取消解析 |
| `destroy()` | 销毁解析器 |
| `getStats()` | 获取统计信息 |

---

## 8. 性能指标

优化后的预期指标：

| 场景 | 原有表现 | 优化后 |
|------|----------|--------|
| 50KB 文件解析 | 200-500ms | < 100ms |
| 200KB 文件解析 | OOM 崩溃 | < 500ms |
| 滚动同步精度 | 偏移 50-200px | 偏移 < 10px |
| 主线程阻塞 | > 100ms | < 16ms |
| 内存峰值 | 无限增长 | 控制在 100MB 以内 |

---

## 9. 后续优化方向

1. **Web Worker 解析**：将解析逻辑完全移到 Worker，主线程只负责调度和渲染
2. **WASM 加速**：使用 Rust + WASM 实现解析器核心，提升解析性能
3. **增量渲染**：只更新变化的 DOM 节点，减少重绘
4. **预测性预加载**：根据滚动速度预测并提前解析/渲染

---

## 更新日志

- **2024-01-XX**：添加 RenderPipeline 统一渲染管道
- **2024-01-XX**：添加 StreamingParserV2 流式解析器
- **2024-01-XX**：添加 HeightMap 系统，解决 Source Map 精度问题
- **2024-01-XX**：添加 FrameScheduler，解决大文件 OOM 问题
- **2024-01-XX**：修复矩阵/表格渲染样式问题（自定义渲染器使用内联样式）
- **2024-01-XX**：更新 LatexEditor 集成 HeightMap 进行 DOM 测量