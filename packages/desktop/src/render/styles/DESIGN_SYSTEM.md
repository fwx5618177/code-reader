# Design System 设计系统

本项目使用统一的设计系统来管理所有颜色、间距、字体等样式变量。

## 核心原则

1. **所有主题相关的样式使用 CSS 自定义属性（CSS Variables）**
2. **布局和过渡等非主题相关的样式使用 SCSS 变量**
3. **组件样式不使用硬编码值**
4. **使用 mixins 保持代码 DRY**

## 文件结构

```
src/render/styles/
├── variables.scss    # 所有变量定义（唯一的变量来源）
├── global.scss       # 全局样式
└── DESIGN_SYSTEM.md  # 本文档
```

## 变量使用规范

### CSS 变量 vs SCSS 变量

| 类型 | 使用方式 | 说明 |
|------|----------|------|
| **颜色** | `var(--xxx)` | 主题相关，运行时切换 |
| **间距** | `var(--spacing-x)` | 主题相关，运行时可调 |
| **圆角** | `var(--radius-x)` | 主题相关 |
| **字体大小** | `var(--font-size-x)` | 主题相关 |
| **阴影** | `var(--shadow-x)` | 主题相关 |
| **布局尺寸** | `$ribbon-width` 等 | 固定布局，编译时确定 |
| **过渡时间** | `$transition-x` | 固定值 |
| **字重** | `$font-weight-x` | 固定值 |
| **z-index** | `$z-xxx` | 固定层级 |
| **行高** | `$line-height-x` | 固定值 |

### ✅ 正确用法

```scss
@use '../../styles/variables' as *;

.component {
  // 主题相关 - 使用 CSS 变量
  background-color: var(--bg-primary);
  color: var(--text-primary);
  padding: var(--spacing-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  box-shadow: var(--shadow-md);
  
  // 非主题相关 - 使用 SCSS 变量
  width: $sidebar-width;
  transition: $transition-colors;
  font-weight: $font-weight-medium;
  z-index: $z-dropdown;
  line-height: $line-height-normal;
  
  // 使用 mixins
  @include scrollbar;
  @include truncate;
}
```

### ❌ 错误用法

```scss
// ❌ 硬编码颜色
.component {
  background-color: #1e1e1e;
  color: #e0e0e0;
}

// ❌ 主题相关值用 SCSS 变量
.component {
  background-color: $bg-primary;  // 不支持运行时主题切换
  padding: $spacing-4;            // 应使用 var(--spacing-4)
}

// ❌ 不需要的 fallback
.component {
  background-color: var(--bg-primary, #{$bg-primary});  // 冗余
}
```

## 可用的 CSS 变量

### 颜色 - 背景

| 变量 | 用途 |
|------|------|
| `--bg-primary` | 主背景（编辑区域） |
| `--bg-secondary` | 次级背景（侧边栏、面板） |
| `--bg-tertiary` | 第三级背景（头部、卡片） |
| `--bg-quaternary` | 第四级背景（模态框、下拉菜单） |
| `--bg-hover` | 悬停状态 |
| `--bg-active` | 激活/按下状态 |
| `--bg-selected` | 选中状态 |
| `--bg-highlight` | 高亮状态 |
| `--overlay-bg` | 遮罩层背景 |

### 颜色 - 文字

| 变量 | 用途 |
|------|------|
| `--text-primary` | 主要文字 |
| `--text-secondary` | 次要文字 |
| `--text-muted` | 弱化文字 |
| `--text-faint` | 极弱化文字 |
| `--text-accent` | 强调文字（链接等） |
| `--text-on-accent` | 强调色背景上的文字 |

### 颜色 - 边框

| 变量 | 用途 |
|------|------|
| `--border-primary` | 主要边框 |
| `--border-secondary` | 次要边框 |
| `--border-subtle` | 细微边框 |
| `--border-focus` | 焦点边框 |

### 颜色 - 强调色

| 变量 | 用途 |
|------|------|
| `--accent-primary` | 主强调色（按钮、链接） |
| `--accent-primary-hover` | 主强调色悬停 |
| `--accent-primary-active` | 主强调色激活 |
| `--accent-secondary` | 次级强调色 |

### 颜色 - 语义色

| 变量 | 用途 |
|------|------|
| `--color-success` | 成功 |
| `--color-success-bg` | 成功背景 |
| `--color-warning` | 警告 |
| `--color-warning-bg` | 警告背景 |
| `--color-error` | 错误 |
| `--color-error-bg` | 错误背景 |
| `--color-info` | 信息 |
| `--color-info-bg` | 信息背景 |

### 间距

| 变量 | 值 |
|------|-----|
| `--spacing-0` | 0 |
| `--spacing-1` | 4px |
| `--spacing-2` | 8px |
| `--spacing-3` | 12px |
| `--spacing-4` | 16px |
| `--spacing-5` | 20px |
| `--spacing-6` | 24px |
| `--spacing-8` | 32px |
| `--spacing-10` | 40px |
| `--spacing-12` | 48px |
| `--spacing-16` | 64px |

### 字体

| 变量 | 用途 |
|------|------|
| `--font-sans` | 无衬线字体栈 |
| `--font-mono` | 等宽字体栈 |
| `--font-size-xs` | 11px |
| `--font-size-sm` | 12px |
| `--font-size-md` | 14px |
| `--font-size-lg` | 16px |
| `--font-size-xl` | 18px |
| `--font-size-2xl` | 20px |
| `--font-size-3xl` | 24px |

### 圆角

| 变量 | 值 |
|------|-----|
| `--radius-sm` | 4px |
| `--radius-md` | 6px |
| `--radius-lg` | 8px |
| `--radius-xl` | 12px |
| `--radius-full` | 9999px |

### 阴影

| 变量 | 用途 |
|------|------|
| `--shadow-sm` | 小阴影 |
| `--shadow-md` | 中阴影 |
| `--shadow-lg` | 大阴影 |
| `--shadow-xl` | 超大阴影 |

### 代码高亮

| 变量 | 用途 |
|------|------|
| `--code-comment` | 注释 |
| `--code-punctuation` | 标点符号 |
| `--code-property` | 属性名 |
| `--code-number` | 数字 |
| `--code-string` | 字符串 |
| `--code-operator` | 运算符 |
| `--code-keyword` | 关键字 |
| `--code-function` | 函数名 |
| `--code-variable` | 变量 |
| `--code-tag` | HTML/XML 标签 |

## 可用的 SCSS 变量（非主题相关）

### 布局

| 变量 | 值 | 用途 |
|------|-----|------|
| `$ribbon-width` | 48px | 左侧图标栏宽度 |
| `$sidebar-width` | 280px | 侧边栏宽度 |
| `$sidebar-min-width` | 180px | 侧边栏最小宽度 |
| `$sidebar-max-width` | 480px | 侧边栏最大宽度 |
| `$titlebar-height` | 38px | 标题栏高度 |
| `$header-height` | 48px | 主头部高度 |
| `$tab-height` | 36px | 标签栏高度 |
| `$statusbar-height` | 24px | 状态栏高度 |
| `$scrollbar-width` | 10px | 滚动条宽度 |

### 过渡

| 变量 | 值 |
|------|-----|
| `$transition-fast` | 100ms ease |
| `$transition-normal` | 200ms ease |
| `$transition-slow` | 300ms ease |
| `$transition-colors` | color, background-color, border-color 200ms ease |

### 字重

| 变量 | 值 |
|------|-----|
| `$font-weight-normal` | 400 |
| `$font-weight-medium` | 500 |
| `$font-weight-semibold` | 600 |
| `$font-weight-bold` | 700 |

### 行高

| 变量 | 值 |
|------|-----|
| `$line-height-tight` | 1.25 |
| `$line-height-normal` | 1.5 |
| `$line-height-relaxed` | 1.75 |

### Z-Index

| 变量 | 值 | 用途 |
|------|-----|------|
| `$z-base` | 0 | 基础层 |
| `$z-dropdown` | 100 | 下拉菜单 |
| `$z-sticky` | 200 | 固定元素 |
| `$z-overlay` | 300 | 遮罩层 |
| `$z-modal` | 400 | 模态框 |
| `$z-popover` | 500 | 弹出框 |
| `$z-tooltip` | 600 | 提示框 |
| `$z-toast` | 700 | Toast 通知 |

## Mixins

`variables.scss` 中提供了常用的 mixins：

```scss
// 滚动条样式
@include scrollbar;

// 焦点环
@include focus-ring;

// 文本截断
@include truncate;

// Flex 居中
@include flex-center;

// Flex 两端对齐
@include flex-between;

// 可点击元素
@include clickable;

// 重置按钮样式
@include button-reset;

// 面板样式
@include panel;

// 遮罩层
@include overlay;

// 卡片样式
@include card;

// 输入框基础样式
@include input-base;
```

## 主题切换

主题切换通过 `ThemeProvider` 组件实现：

1. 在 `<html>` 元素上设置 `data-theme` 属性（`light` 或 `dark`）
2. CSS 变量会根据 `[data-theme='light']` 选择器自动切换值

**组件不需要关心当前主题**，只需使用 CSS 变量，颜色会自动适配。

### 不需要的样式

```scss
// ❌ 不需要这种覆盖 - CSS 变量已经处理了
[data-theme='light'] {
  .component {
    background-color: var(--bg-primary);  // 值已自动切换
  }
}

// ✅ 只在需要不同行为时才用
[data-theme='light'] {
  .component {
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);  // light 主题用不同阴影
  }
}
```

## 添加新变量

如果需要添加新的变量：

1. 在 `variables.scss` 中定义 SCSS 变量（dark 和 light 两个版本）
2. 在 `:root` 中添加对应的 CSS 变量（dark 主题值）
3. 在 `[data-theme='light']` 中添加 light 主题的覆盖值
4. 更新本文档

## 快速检查清单

在写组件样式时，检查：

- [ ] 颜色使用 `var(--xxx)` 格式
- [ ] 间距使用 `var(--spacing-x)` 格式
- [ ] 圆角使用 `var(--radius-x)` 格式
- [ ] 字体大小使用 `var(--font-size-x)` 格式
- [ ] 布局尺寸使用 `$xxx` SCSS 变量
- [ ] 过渡使用 `$transition-x` SCSS 变量
- [ ] 没有硬编码的颜色值
- [ ] 使用 mixins 避免重复代码