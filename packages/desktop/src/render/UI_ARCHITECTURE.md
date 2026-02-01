# UI 架构设计文档

## 问题总结

当前存在的设计问题：

1. **功能入口重复** - 搜索、设置等功能在多个地方都有入口
2. **按钮功能不明确** - + 和录音按钮行为相同
3. **主题系统分散** - CSS 变量虽然使用了，但没有统一的管理
4. **版本管理未实现** - Git 集成或文档历史功能缺失

---

## UI 区域职责划分

### 1. TitleBar (顶部标题栏)

**职责**: 窗口控制 + 全局导航

**包含元素**:
- macOS 红绿灯区域（窗口控制）
- 模式切换 Tabs（代码阅读/知识库/日记/专注）
- 全局搜索入口（⌘P）
- 窗口控制按钮（Windows/Linux）

**不应包含**:
- ~~设置按钮~~ → 移到 Ribbon
- ~~打开文件夹~~ → 移到 Ribbon 或 Sidebar

### 2. Ribbon (左侧图标栏)

**职责**: 当前模式的操作和面板切换

**包含元素**:
- 快速操作区
  - 新建笔记 (+) - 打开 QuickInput，默认文本模式
  - 录音 (🎤) - 打开 QuickInput，自动开始录音
- 面板切换区（根据当前模式变化）
  - 代码阅读模式: 文件树、搜索、Git
  - 知识库模式: 文件夹、搜索、标签、图谱
  - 日记模式: 日历、搜索、标签
- 底部固定区
  - 设置 (⚙️)

**不应包含**:
- ~~模式切换~~ → 已移到 TitleBar
- ~~帮助~~ → 移到设置面板内

### 3. Sidebar (侧边栏)

**职责**: 内容导航和文件管理

**包含元素**:
- 当前面板的内容（文件树/文件夹/标签/日历等）
- 面板特定的操作按钮

### 4. MainContent (主内容区)

**职责**: 显示和编辑内容

---

## 快速输入 (QuickInput) 设计

### 入口方式

| 入口 | 行为 |
|------|------|
| + 按钮 | 打开 QuickInput，焦点在文本输入 |
| 🎤 按钮 | 打开 QuickInput，自动开始录音 |
| ⌘N 快捷键 | 同 + 按钮 |
| ⌘⇧R 快捷键 | 同 🎤 按钮 |

### QuickInput 模式

```
┌─────────────────────────────────────────┐
│ 📝 笔记  🎤 录音  📷 图片  🔗 链接     │
├─────────────────────────────────────────┤
│                                         │
│  [输入内容区域]                         │
│                                         │
├─────────────────────────────────────────┤
│ 📁 收件箱  🏷️ 添加标签    [保存] [取消] │
└─────────────────────────────────────────┘
```

---

## 主题系统设计

### 架构

```
ThemeProvider (Context)
    │
    ├── ThemeService (逻辑)
    │   ├── 主题切换
    │   ├── 系统主题监听
    │   └── 持久化存储
    │
    └── CSS Variables (样式)
        ├── :root (默认暗色)
        └── [data-theme="light"] (亮色)
```

### 主题配置结构

```typescript
interface Theme {
  id: string;
  name: string;
  type: 'light' | 'dark';
  colors: {
    // 背景色
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    bgQuaternary: string;
    
    // 交互状态
    bgHover: string;
    bgActive: string;
    bgSelected: string;
    
    // 边框
    borderPrimary: string;
    borderSecondary: string;
    
    // 文字
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    
    // 强调色
    accentPrimary: string;
    accentSecondary: string;
  };
}
```

### 内置主题

1. **Obsidian Dark** (默认) - 深色主题，灵感来自 Obsidian
2. **Obsidian Light** - 浅色主题
3. **System** - 跟随系统设置

### 强调色 (Accent Color)

用户可自定义强调色，影响：
- 按钮、链接
- 选中状态
- 焦点环
- 活跃指示器

---

## 版本管理设计

### 两种版本管理

#### 1. Git 集成 (代码阅读模式)

- 显示当前分支
- 显示文件修改状态
- 查看提交历史
- 切换分支

#### 2. 文档历史 (知识库/日记模式)

- 自动保存版本快照
- 查看历史版本
- 恢复到历史版本
- 版本对比

### UI 位置

- Git 状态：Ribbon 面板切换 + Sidebar 显示
- 文档历史：编辑器工具栏 / 右键菜单

---

## 实施计划

### Phase 1: 清理重复入口
- [ ] 移除 TitleBar 中的设置按钮
- [ ] 移除 TitleBar 中的打开文件夹按钮
- [ ] 统一搜索入口（只保留 TitleBar 的搜索）
- [ ] Ribbon 搜索按钮改为打开全局搜索

### Phase 2: 区分快速输入入口
- [ ] + 按钮打开 QuickInput 文本模式
- [ ] 🎤 按钮打开 QuickInput 录音模式
- [ ] QuickInput 组件支持初始模式参数

### Phase 3: 统一主题系统
- [ ] 创建 ThemeProvider 组件
- [ ] 创建主题配置文件
- [ ] 重构 CSS 变量生成逻辑
- [ ] 设置面板集成主题选择

### Phase 4: 版本管理
- [ ] 设计数据库 schema（版本历史表）
- [ ] 实现自动保存版本
- [ ] 实现版本历史 UI
- [ ] Git 集成（可选）

---

## 文件结构

```
src/render/
├── theme/
│   ├── ThemeProvider.tsx      # 主题上下文
│   ├── ThemeService.ts        # 主题逻辑
│   ├── themes/
│   │   ├── index.ts           # 主题导出
│   │   ├── obsidian-dark.ts   # 暗色主题
│   │   └── obsidian-light.ts  # 亮色主题
│   └── generateCssVars.ts     # CSS 变量生成
├── components/
│   ├── TitleBar/              # 简化后的标题栏
│   ├── Ribbon/                # 重构后的侧边栏
│   ├── QuickInput/            # 支持多模式的快速输入
│   └── ...
└── styles/
    └── variables.scss         # 简化，主要定义在 theme 中
```
