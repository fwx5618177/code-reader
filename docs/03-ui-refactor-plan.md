# UI 重构计划 - 参考 Obsidian 风格

## 📋 概述

当前 UI 比较简陋，需要参考 Obsidian 的设计语言进行重构，打造一个优雅、现代、高效的知识管理界面。

---

## 🎨 Obsidian 设计特点分析

### 视觉风格
- **色彩**: 柔和的深色主题，避免纯黑，使用 `#1e1e1e` ~ `#2d2d2d` 的层次
- **对比度**: 适度的对比度，不刺眼
- **阴影**: 细腻的阴影增加层次感
- **圆角**: 适度的圆角 (4px-8px)，不过度圆滑
- **边框**: 细微的边框线，颜色接近背景色

### 布局结构
```
┌─────────────────────────────────────────────────────────┐
│  [☰] 标题栏 / 拖拽区域                    [─] [□] [×]   │
├───────┬─────────────────────────────────────────────────┤
│ Ribbon│                                                 │
│ (图标) │                 主内容区                        │
│       │                                                 │
│  📁   ├──────────┬──────────────────────────────────────┤
│  🔍   │ 侧边栏    │     编辑器/阅读器                    │
│  📊   │ (可折叠)  │                                     │
│  ⚙️   │          │                                     │
│       │  文件树   │     [标签页]                        │
│       │  搜索     │     内容区域                        │
│       │  标签     │                                     │
├───────┴──────────┴──────────────────────────────────────┤
│  状态栏: 字数统计 | 当前路径 | 同步状态                   │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 重构任务清单

### Phase 1: 基础架构

- [ ] **安装图标库**
  - 使用 `lucide-react` 图标库
  - 统一图标风格

- [ ] **设计系统建立**
  - 创建 CSS 变量文件 (`variables.scss`)
  - 定义颜色、间距、字体等设计 token
  - 支持浅色/深色主题切换

- [ ] **组件库规划**
  - Button 组件
  - Input 组件
  - Tooltip 组件
  - Modal 组件
  - Dropdown 组件

### Phase 2: 布局重构

- [ ] **Ribbon 侧边栏** (最左侧图标条)
  - 固定宽度 48px
  - 垂直图标排列
  - 底部设置入口
  - 悬浮提示

- [ ] **左侧边栏优化**
  - 可折叠/展开
  - 拖拽调整宽度
  - 多面板支持 (文件/搜索/标签/图谱)
  - 面板标题栏

- [ ] **标签页系统**
  - 多文件同时打开
  - 标签拖拽排序
  - 关闭/固定标签
  - 标签溢出处理

- [ ] **状态栏**
  - 底部固定
  - 显示统计信息
  - 显示同步状态

### Phase 3: 组件升级

- [ ] **文件树优化**
  - 文件图标 (根据类型)
  - 缩进引导线
  - 拖拽排序
  - 右键菜单
  - 新建/重命名/删除
  - 搜索过滤

- [ ] **代码/内容查看器**
  - 语法高亮 (使用 Prism 或 Shiki)
  - 行号显示
  - 代码折叠
  - Markdown 渲染
  - 分屏预览

- [ ] **搜索面板**
  - 全局搜索框
  - 实时搜索结果
  - 结果高亮
  - 搜索历史

### Phase 4: 交互优化

- [ ] **快捷键系统**
  - Command Palette (Cmd+P)
  - 快速打开文件 (Cmd+O)
  - 全局搜索 (Cmd+Shift+F)

- [ ] **动画效果**
  - 面板展开/折叠动画
  - 悬浮状态过渡
  - 加载状态

- [ ] **拖拽功能**
  - 面板宽度调整
  - 文件拖拽移动
  - 标签拖拽排序

---

## 🎨 设计规范

### 颜色系统 (深色主题)

```scss
// 背景色层级
$bg-primary: #1e1e1e;      // 主背景
$bg-secondary: #252526;     // 次级背景 (侧边栏)
$bg-tertiary: #2d2d2d;      // 三级背景 (header)
$bg-hover: #3d3d3d;         // 悬浮状态
$bg-active: #094771;        // 激活状态 (蓝色)

// 边框色
$border-primary: #3d3d3d;
$border-secondary: #4d4d4d;

// 文字色
$text-primary: #e0e0e0;
$text-secondary: #a0a0a0;
$text-muted: #6a6a6a;

// 强调色
$accent-primary: #7c3aed;   // 紫色 (类似 Obsidian)
$accent-secondary: #a78bfa;
$accent-success: #22c55e;
$accent-warning: #f59e0b;
$accent-danger: #ef4444;
```

### 间距系统

```scss
$spacing-xs: 4px;
$spacing-sm: 8px;
$spacing-md: 12px;
$spacing-lg: 16px;
$spacing-xl: 24px;
$spacing-2xl: 32px;
```

### 字体系统

```scss
$font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
$font-mono: 'Fira Code', 'JetBrains Mono', 'Menlo', monospace;

$font-size-xs: 11px;
$font-size-sm: 12px;
$font-size-md: 14px;
$font-size-lg: 16px;
$font-size-xl: 18px;
```

---

## 📦 需要安装的依赖

```bash
# 图标库
pnpm add lucide-react

# 语法高亮
pnpm add prismjs @types/prismjs
# 或者使用 shiki
pnpm add shiki

# Markdown 渲染
pnpm add react-markdown remark-gfm

# 拖拽功能
pnpm add @dnd-kit/core @dnd-kit/sortable

# 虚拟滚动 (大文件优化)
pnpm add @tanstack/react-virtual

# 快捷键
pnpm add hotkeys-js
```

---

## 📁 建议的文件结构

```
packages/desktop/src/render/
├── components/
│   ├── common/           # 通用组件
│   │   ├── Button/
│   │   ├── Input/
│   │   ├── Tooltip/
│   │   ├── Modal/
│   │   └── Dropdown/
│   ├── layout/           # 布局组件
│   │   ├── Ribbon/
│   │   ├── Sidebar/
│   │   ├── TabBar/
│   │   ├── StatusBar/
│   │   └── Resizer/
│   ├── file/             # 文件相关
│   │   ├── FileTree/
│   │   ├── FileIcon/
│   │   └── FileBreadcrumb/
│   ├── editor/           # 编辑器相关
│   │   ├── CodeViewer/
│   │   ├── MarkdownViewer/
│   │   └── LineNumbers/
│   └── search/           # 搜索相关
│       ├── SearchPanel/
│       ├── SearchResult/
│       └── CommandPalette/
├── styles/
│   ├── variables.scss    # CSS 变量
│   ├── reset.scss        # 样式重置
│   ├── global.scss       # 全局样式
│   ├── themes/
│   │   ├── dark.scss
│   │   └── light.scss
│   └── mixins.scss       # SCSS mixins
├── hooks/                # 自定义 hooks
│   ├── useHotkeys.ts
│   ├── useTheme.ts
│   └── useResize.ts
├── store/                # 状态管理
│   ├── fileStore.ts
│   ├── tabStore.ts
│   └── settingsStore.ts
└── utils/
    ├── fileIcons.ts
    └── shortcuts.ts
```

---

## ⏱️ 时间估算

| Phase | 任务 | 预计时间 |
|-------|------|----------|
| 1 | 基础架构 + 设计系统 | 2-3 天 |
| 2 | 布局重构 | 3-4 天 |
| 3 | 组件升级 | 4-5 天 |
| 4 | 交互优化 | 2-3 天 |
| - | **总计** | **11-15 天** |

---

## 🎯 优先级

1. **P0 - 必须做**
   - 设计系统建立
   - Ribbon + 侧边栏重构
   - 文件树优化
   - 代码查看器语法高亮

2. **P1 - 应该做**
   - 标签页系统
   - 状态栏
   - 搜索面板
   - 快捷键系统

3. **P2 - 可以做**
   - 动画效果
   - 拖拽功能
   - 主题切换
   - Command Palette