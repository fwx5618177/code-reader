# 滚动同步与渲染问题修复总结

## 修复日期: 2024

## 问题概述

用户报告了三个主要问题：

1. **滚动映射位置不正确** - 左侧源码与右侧预览的位置映射有偏差，且在交互时源码会被自动往前滚
2. **实时解析渲染问题** - 部分 LaTeX 内容没有正确实时解析和渲染
3. **渲染样式问题** - 数学公式（如 align 环境）显示为黑色背景的表格形式

---

## 根本原因分析

### 问题 1: 滚动映射问题

**原因:**
1. `Source Map` 使用固定的估算行高 (`estimatedLineHeight = 24px`) 来估算渲染高度，对数学公式（如 align、matrix）严重不准确
2. DOM 测量使用 `requestAnimationFrame` 延迟执行，在测量完成前滚动同步就已经开始工作
3. 滚动锁定时间太短 (50ms)，导致双向滚动形成循环：source → preview → source

### 问题 2: 渲染问题

**原因:**
1. 在 `renderer.ts` 的 `renderMathEnvironment` 方法中，使用了 `blockAttrs` 变量但没有在方法内部定义，导致属性缺失
2. CSS 中 `math-limit-style` 类的 HTML 结构与实际渲染器输出不匹配

### 问题 3: 样式问题

**原因:**
1. `latexPreviewContent` 中的通用 `table` 样式没有排除数学表格类，导致数学表格被应用了边框和背景色
2. CSS 选择器优先级不够高，无法覆盖通用表格样式

---

## 修复内容

### 修复 1: 滚动同步改进 (`LatexEditor.tsx`)

```typescript
// 增加滚动同步延迟
const SCROLL_SYNC_DELAY_MS = 50;  // 从 16ms 改为 50ms

// 新增滚动锁定时间常量
const SCROLL_LOCK_DURATION_MS = 200;  // 防止滚动循环

// 在 handleSourceScroll 和 handlePreviewScroll 中使用更长的锁定时间
setTimeout(() => {
  scrollSyncSourceRef.current = null;
}, SCROLL_LOCK_DURATION_MS);  // 从 50ms 改为 200ms
```

### 修复 2: 渲染器修复 (`renderer.ts`)

在 `renderMathEnvironment` 方法开头添加 `blockAttrs` 定义：

```typescript
private renderMathEnvironment(node: EnvironmentNode): string {
  const envName = node.name;
  const raw = node.raw || '';

  // 生成 data-block-id 和位置属性
  const blockAttrs = this.getBlockAttributes(node);  // ← 新增

  // ... 其余代码
}
```

### 修复 3: CSS 样式修复

#### `math-rendering.scss` - 修复极限式布局

```scss
&.math-limit-style {
  display: inline-flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center;
  vertical-align: middle;
  text-align: center;

  .math-script-base {
    display: block !important;
    order: 1;
    line-height: 1.2;
  }

  .math-sub.math-under {
    display: block !important;
    font-size: 0.7em;
    line-height: 1;
    order: 2;
    margin-top: 0;
    vertical-align: baseline !important;
    position: static !important;
  }
}
```

#### `RichEditor.module.scss` - 修复表格样式

```scss
// 在 .latexPreviewContent 中，排除数学表格
table:not(.math-matrix-table):not(.math-cases-table):not(.math-aligned-table):not(
    .math-gathered-table
  ) {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  // ...
}

// 添加数学表格的透明样式
table.math-matrix-table,
table.math-cases-table,
table.math-aligned-table,
table.math-gathered-table {
  width: auto !important;
  border: none !important;
  background: transparent !important;
  margin: 0 !important;

  th, td, tr, tbody {
    border: none !important;
    background: transparent !important;
  }
}
```

---

## 修改的文件

1. `code-reader/packages/desktop/src/render/components/RichEditor/LatexEditor.tsx`
   - 增加滚动同步延迟和锁定时间

2. `code-reader/packages/desktop/src/render/lib/latex/renderer.ts`
   - 修复 `renderMathEnvironment` 中缺失的 `blockAttrs` 定义

3. `code-reader/packages/desktop/src/render/lib/math/math-rendering.scss`
   - 修复 `math-limit-style` 类的 CSS 布局

4. `code-reader/packages/desktop/src/render/components/RichEditor/RichEditor.module.scss`
   - 修复 `latexPreviewContent` 中的表格样式，排除数学表格

---

## 验证步骤

1. **滚动同步测试:**
   - 打开包含大量数学公式的 LaTeX 文档
   - 在分屏模式下滚动源码，观察预览是否正确跟随
   - 滚动预览，观察源码是否正确跟随
   - 确认不会出现自动往前滚的问题

2. **渲染测试:**
   - 输入 `\lim_{x \to 0} \frac{\sin x}{x}` 验证极限符号正确显示
   - 输入 `\begin{align}` 环境验证多行公式正确渲染
   - 检查矩阵、分段函数等复杂环境的渲染

3. **样式测试:**
   - 验证数学表格无边框和无背景色
   - 验证普通 LaTeX 表格保持正常样式
   - 在深色主题下测试确保无视觉问题

---

## 后续优化建议

1. **滚动同步:**
   - 实现基于块的精确滚动同步，而非比例同步
   - 使用 IntersectionObserver 预测性测量即将进入视口的块

2. **渲染性能:**
   - 将复杂数学公式的渲染迁移到 Web Worker
   - 实现虚拟滚动，只渲染可见区域的内容

3. **缓存策略:**
   - 优化渲染缓存的失效策略
   - 添加持久化缓存支持大文档的快速加载