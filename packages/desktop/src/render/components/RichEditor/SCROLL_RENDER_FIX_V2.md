# LaTeX 编辑器滚动与渲染问题修复文档 V2

## 问题概述

用户报告了以下问题：
1. **滚动往前滚动** - 渲染过程不应该影响源码的滚动位置
2. **白色/黑色方块** - 预览区域出现方块图标
3. **实时没有渲染** - 某些 LaTeX 代码显示为原始文本而不是渲染结果
4. **表格渲染问题** - 数学公式显示为黑色背景/边框的表格

---

## 根本原因分析

### 1. 滚动问题 - 真正的根本原因

**问题链**：
1. `setRenderedHtml(render.html)` 更新预览 HTML
2. React 重新渲染 `RenderPreview` 组件
3. `dangerouslySetInnerHTML` 更新 DOM
4. DOM 变化导致浏览器自动调整滚动位置
5. `onScroll` 事件触发 `handleScroll`
6. `handleScroll` 中的 `setTimeout` 延迟执行回调
7. 回调执行时，渲染锁定可能已经解除
8. `handlePreviewScroll` 被调用，更新源码滚动位置

**关键发现**：
- 渲染锁定的检查时机不对
- `handleScroll` 使用了 `setTimeout` 延迟调用，但锁定检查在延迟回调执行时才进行
- 需要在延迟回调内部检查锁定状态，而不是在 `handleScroll` 开始时

### 2. 白色/黑色方块

**分析结果**：
- 截图中的黑色方块（■）是 LaTeX 中的 `\blacksquare` 符号
- 这是 QED 证明结束符号，是正确的渲染结果
- 不是 bug，而是正常的数学符号渲染

### 3. 未渲染的 LaTeX 代码

**根本原因**：
- LaTeX 数学命令（如 `\lim`, `\frac` 等）必须在数学模式中使用
- 如果这些命令出现在普通文本中（没有被 `$...$`、`\[...\]` 或数学环境包围），解析器会将其当作普通命令处理
- 渲染器会将未知命令输出为原始文本或忽略

**正确用法**：
- 行内公式：`$\lim_{x \to 0} \frac{\sin x}{x}$`
- 块级公式：`\[\lim_{x \to 0} \frac{\sin x}{x}\]` 或 `$$\lim_{x \to 0} \frac{\sin x}{x}$$`

### 4. 表格黑色背景/边框

**根本原因**：
- CSS 选择器优先级不够高
- 某些浏览器默认样式覆盖了自定义样式
- 数学表格的边框/背景样式需要使用更强的 `!important` 规则

---

## 修复方案

### 修复1：渲染期间滚动锁定（核心修复）

**文件**：`LatexEditor.tsx`

**改动**：
1. 为 `RenderPreview` 添加 `isRenderingLocked` prop
2. 在 `RenderPreview` 内部使用 ref 跟踪锁定状态（避免闭包问题）
3. 将锁定检查移到 `setTimeout` 回调内部
4. 添加滚动比例变化阈值检查（避免微小变化触发同步）

```typescript
// RenderPreview 内部
const isRenderingLockedRef = useRef(isRenderingLocked);
isRenderingLockedRef.current = isRenderingLocked;

const lastScrollRatioRef = useRef<number | null>(null);

const handleScroll = useCallback(() => {
  if (isScrollingRef.current) return;
  
  // ... 计算 scrollRatio ...
  
  scrollTimeoutRef.current = setTimeout(() => {
    // 在延迟回调中检查渲染锁定状态
    if (isRenderingLockedRef.current) return;
    
    // 检查滚动比例是否有显著变化
    const lastRatio = lastScrollRatioRef.current;
    if (lastRatio !== null && Math.abs(scrollRatio - lastRatio) < 0.01) {
      return;
    }
    lastScrollRatioRef.current = scrollRatio;
    
    onScrollRef.current?.(scrollRatio);
  }, SCROLL_SYNC_DELAY_MS);
}, []);
```

### 修复2：极限式运算符 CSS 样式

**文件**：
- `math-rendering.scss`
- `RichEditor.module.scss`

**改动**：
为 `.math-script.math-subsup.math-limit-style` 添加正确的嵌套样式：

```scss
&.math-limit-style {
  display: inline-flex !important;
  flex-direction: column !important;
  align-items: center !important;

  &.math-subsup {
    .math-scripts {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      order: 2;
      margin-left: 0 !important;
      font-size: 1em !important;

      .math-sup.math-over { /* 上标样式 */ }
      .math-sub.math-under { /* 下标样式 */ }
    }
  }
}
```

### 修复3：隐藏空数学块

**文件**：`RichEditor.module.scss`

```scss
.latexPreviewContent {
  .latex-math-empty {
    display: none !important;
  }
}
```

### 修复4：数学表格强制无边框

**文件**：`RichEditor.module.scss`

```scss
// 数学表格统一样式 - 无边框（使用最高优先级）
table.math-matrix-table,
table.math-cases-table,
table.math-aligned-table,
table.math-gathered-table,
.math-matrix table,
.math-cases table,
.math-aligned table,
.math-gathered table {
  border: none !important;
  border-collapse: collapse !important;
  background: transparent !important;
  
  &, & * {
    border: none !important;
    border-width: 0 !important;
    border-style: none !important;
    border-color: transparent !important;
  }
  
  tbody, tr, th, td {
    border: none !important;
    background: transparent !important;
    outline: none !important;
    box-shadow: none !important;
  }
}
```

### 修复5：加载指示器绝对定位

**文件**：`RichEditor.module.scss`

```scss
.latexPreviewLoading {
  position: absolute;
  bottom: var(--spacing-4);
  right: var(--spacing-4);
  z-index: 10;
  pointer-events: none;
  background-color: var(--bg-secondary);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
```

---

## 验证步骤

1. **滚动同步验证**：
   - 打开大型 LaTeX 文档
   - 在分栏模式下滚动源码
   - 触发渲染（编辑内容）
   - 确认源码滚动位置不会因渲染而跳动

2. **渲染验证**：
   - 确认 `$\lim_{x \to 0} \frac{\sin x}{x}$`（带美元符号）正确渲染
   - 确认极限下标显示在正下方而不是右下角

3. **样式验证**：
   - 确认数学矩阵/cases/aligned 没有黑色背景或边框
   - 确认加载指示器显示在右下角，不影响内容布局

---

## 技术说明

### 为什么滚动锁定检查要放在 setTimeout 回调内？

```
时间线：
t0: 渲染开始，isRenderingLocked = true
t1: setRenderedHtml() 执行
t2: DOM 更新，触发 scroll 事件
t3: handleScroll 被调用，设置 setTimeout(callback, 50ms)
t4: 渲染完成
t5: t3 + 50ms，callback 执行

如果在 t3 检查锁定状态：锁定生效，不会触发滚动同步 ✓
如果锁定在 t4 后解除，callback 在 t5 执行时：
  - 旧方案：callback 立即执行，触发滚动同步 ✗
  - 新方案：callback 执行时再次检查锁定状态 ✓
```

### 滚动比例阈值的作用

DOM 更新可能导致微小的滚动位置变化（< 1%），这些变化不应该触发滚动同步。添加 0.01（1%）的阈值可以过滤掉这些噪音。

---

## 修改的文件列表

1. `LatexEditor.tsx` - 添加渲染期间滚动锁定机制，优化锁定检查时机
2. `math-rendering.scss` - 修复极限式运算符样式
3. `RichEditor.module.scss` - 添加极限式样式、隐藏空数学块、修复加载指示器定位、强化数学表格无边框规则