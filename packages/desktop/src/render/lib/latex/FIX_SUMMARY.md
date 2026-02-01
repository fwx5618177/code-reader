# LaTeX 编辑器 OOM 和滚动同步修复总结

## 问题概述

### 问题 1：源码与渲染位置映射不准确

**症状**：在分栏模式下，滚动源码编辑器时，预览窗口的滚动位置完全偏离预期。

**根本原因**：

1. `SourceMapGenerator.fromAST()` 使用固定的 `行数 × 24px` 估算渲染高度，完全忽略了实际 DOM 测量结果
2. 渲染器 (`renderer.ts`) 没有输出 `data-block-id` 属性，导致 DOM 测量无法找到目标元素
3. `measureDOMBlocks()` 返回空数组，HeightMap 更新无效

### 问题 2：每次处理都 OOM（V8 JavaScript 内存溢出）

**症状**：处理大文件时，V8 报告 "Committing semi space failed" 错误。

**根本原因**：

1. AST 和内容被重复缓存 3+ 次（IncrementalLatexEngine、LatexEngine、IncrementalLatexParser）
2. LRU 缓存配置过大（1000 节点 + 500 渲染结果）
3. 每个 AST 节点存储完整的 `raw` 字符串，导致大量字符串拷贝
4. 分块解析没有及时释放中间结果
5. 缓存清理策略不够激进

---

## 修复方案

### 修复 1：真实高度测量系统 (`real-height-map.ts`)

创建了全新的 `RealHeightMap` 类，完全基于 DOM 实测值：

```typescript
// 核心思想：禁止估算，只使用真实测量
export class RealHeightMap {
  // 更新块的真实测量值（从 DOM 获取）
  updateBlockMeasurement(id: string, top: number, height: number): boolean;

  // 批量更新测量值
  updateMeasurements(measurements: MeasurementResult[]): number;

  // 基于真实高度计算滚动位置
  computePreviewScrollPosition(
    sourceScrollTop: number,
    sourceViewportHeight: number,
    sourceContentHeight: number
  ): number;
}
```

**特性**：

- 所有块初始为"未测量"状态，使用估算值作为占位
- 一旦 DOM 测量完成，立即更新为真实值
- 滚动同步计算时，优先使用已测量块的真实位置
- 支持 `ResizeObserver` 监听块尺寸变化并自动更新
- 提供测量进度统计（测量率、置信度）

### 修复 2：渲染器添加 `data-block-id` 属性

修改 `renderer.ts`，为所有块级元素添加数据属性：

```typescript
private getBlockAttributes(node: LatexNode): string {
  const attrs: string[] = [];
  if (node.id) attrs.push(`data-block-id="${node.id}"`);
  if (node.type) attrs.push(`data-block-type="${node.type}"`);
  if (typeof node.start === 'number') attrs.push(`data-source-start="${node.start}"`);
  if (typeof node.end === 'number') attrs.push(`data-source-end="${node.end}"`);
  return attrs.join(' ');
}
```

**影响的渲染方法**：

- `renderParagraph()` - 段落
- `renderSection()` - 章节标题
- `renderMathBlock()` - 块级数学公式
- `renderMathEnvironment()` - 数学环境
- `renderList()` - 列表
- `renderEnvironment()` - 通用环境

### 修复 3：统一 AST 缓存管理器 (`ast-cache-manager.ts`)

创建单例缓存管理器，消除重复缓存：

```typescript
// 获取全局唯一实例
const cacheManager = getASTCacheManager({
  maxASTCount: 3,           // 最多缓存 3 个 AST
  maxNodeCount: 200,        // 最多 200 个节点
  maxMemoryBytes: 10 * 1024 * 1024, // 10MB 上限
  useWeakRefs: true,        // 启用弱引用
  useZeroCopy: true,        // 启用零拷贝
});
```

**核心特性**：

1. **单例模式**：全局唯一缓存实例，消除重复缓存
2. **零拷贝字符串引用**：AST 节点不存储 `raw` 字符串，只存储 `(start, end)` 偏移量
3. **弱引用支持**：不活跃的 AST 自动降级为 `WeakRef`，允许 GC 回收
4. **流式处理**：支持分块处理，及时释放中间结果
5. **内存压力感知**：根据内存压力自动调整缓存策略

**零拷贝实现**：

```typescript
// 轻量级节点，不存储 raw
interface LightweightNode {
  type: string;
  id: string;
  slice: { start: number; end: number }; // 引用源文档
  hash: string;
  childIds?: string[];
}

// 获取 raw 内容时从源文档切片（零拷贝）
getNodeRaw(node: LatexNode): string {
  return this.sourceManager.getSlice({ start: node.start, end: node.end });
}
```

### 修复 4：IncrementalEngine 集成统一缓存

修改 `incremental-engine.ts`，移除本地重复缓存：

```typescript
// 之前（有问题）
private cachedAST: RootNode | null = null;
private cachedContent: string = '';
private readonly nodeCache: LRUCache<string, NodeCacheEntry>;

// 之后（修复）
private readonly cacheManager: ASTCacheManager; // 使用统一缓存
private currentContentHash: string = '';
```

**配置优化**：

```typescript
const DEFAULT_CONFIG = {
  nodeCacheMaxSize: 200,    // 从 1000 降低到 200
  renderCacheMaxSize: 100,  // 从 500 降低到 100
  cacheTTL: 60 * 1000,      // 从 2 分钟降低到 1 分钟
};
```

### 修复 5：LatexEditor 使用真实高度同步

更新 `LatexEditor.tsx` 的滚动同步逻辑：

```typescript
// 处理源码编辑器滚动 - 使用真实高度映射
const handleSourceScroll = useCallback((scrollRatio: number) => {
  const heightMap = realHeightMapRef.current;

  if (heightMap && previewContainer && sourceEditor) {
    // 基于真实 DOM 测量计算目标滚动位置
    const targetScrollTop = heightMap.computePreviewScrollPosition(
      sourceScrollTop,
      sourceViewportHeight,
      sourceContentHeight
    );
    // ...
  }
}, [viewMode]);
```

---

## 文件变更清单

| 文件 | 变更类型 | 描述 |
|------|---------|------|
| `ast-cache-manager.ts` | 新增 | 统一 AST 缓存管理器 |
| `real-height-map.ts` | 新增 | 真实高度测量系统 |
| `renderer.ts` | 修改 | 添加 `data-block-id` 等属性 |
| `incremental-engine.ts` | 修改 | 集成统一缓存管理器 |
| `LatexEditor.tsx` | 修改 | 使用真实高度同步 |
| `index.ts` | 修改 | 导出新模块 |

---

## 测试验证

### 验证滚动同步

1. 打开一个包含大量数学公式的 LaTeX 文件
2. 切换到分栏模式
3. 滚动源码编辑器，观察预览是否同步滚动到对应位置
4. 检查控制台，确认有 "DOM 测量完成" 日志，且测量率接近 100%

### 验证内存使用

1. 打开一个大文件（>100KB）
2. 多次编辑和保存
3. 监控内存使用（DevTools -> Memory）
4. 确认没有 OOM 错误，内存使用稳定

### 验证缓存统计

```typescript
const engine = getIncrementalEngine();
const stats = engine.getCacheStats();
console.log('缓存统计:', {
  nodeCacheSize: stats.nodeCacheSize,
  hitRate: stats.hitRate,
  estimatedMemory: `${(stats.estimatedMemory / 1024 / 1024).toFixed(1)}MB`,
  weakRefCollected: stats.weakRefCollected,
});
```

---

## 后续优化建议

1. **虚拟滚动优化**：对于超大文件，只渲染可见区域的块
2. **Worker 渲染**：将数学公式渲染移动到 Web Worker
3. **增量 DOM 更新**：只更新变化的 DOM 节点，而非全量替换
4. **预测性测量**：在用户滚动时，提前测量即将可见的块