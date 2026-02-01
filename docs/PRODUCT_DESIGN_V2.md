# Code Reader 产品设计优化方案 V2

## 概述

本文档详细描述了 Code Reader 产品的设计优化方案，解决当前存在的架构问题，并扩展产品功能。

---

## 一、当前问题分析

### 1.1 Header/模式选择位置不当

**现状：**
- 模式切换（代码阅读、知识库、日记、专注）放在 TitleBar 中央
- Ribbon 左侧栏仅显示模式相关的导航按钮

**问题：**
- Header 承载了过多功能，概念混淆
- 模式切换属于"工作区"概念，应该有更明确的入口
- 缺少子窗口支持

### 1.2 功能单一

**现状：**
- 主要是代码阅读功能（Monaco Editor）
- RichEditor 只是简单的 textarea + Markdown 渲染

**问题：**
- 无法满足写文章、小说等创作需求
- 富文本编辑能力不足
- 录音 + AI 整理功能未完善

### 1.3 编辑器能力不足

**现状：**
- 使用简单的 textarea
- 只支持基础 Markdown

**问题：**
- 不支持真正的富文本编辑
- 代码块编辑体验差
- 无法实现块编辑（如 Notion）

### 1.4 页面设置缺失

**现状：**
- 编辑器没有页面背景设置

**问题：**
- 无法设置行线、方格线等
- 写作体验不够个性化

---

## 二、优化方案

### 2.1 布局重构

#### 新布局结构

```
┌────────────────────────────────────────────────────────────────┐
│  TitleBar (窗口控制 + 搜索 + 全局状态)                           │
├──────────┬─────────────────────────────────────────────────────┤
│          │                                                     │
│ Workspace│  Sidebar     │      Main Content Area              │
│ Selector │  (FileTree,  │                                     │
│          │   Tags, etc) │                                     │
│ ──────── │              │                                     │
│          │              │                                     │
│ Quick    │              │                                     │
│ Actions  │              │                                     │
│          │              │                                     │
│ ──────── │              │                                     │
│          │              │                                     │
│ Navigation              │                                     │
│          │              │                                     │
│ ──────── │              │                                     │
│ Settings │              │                                     │
│          │              │                                     │
└──────────┴──────────────┴─────────────────────────────────────┘
```

#### 组件职责重新划分

| 组件 | 新职责 |
|------|--------|
| TitleBar | 窗口控制、全局搜索、同步状态、窗口标题 |
| Ribbon | 工作区选择器 + 快捷操作 + 导航 + 设置 |
| Sidebar | 文件树、标签、日历等面板 |
| MainContent | 编辑器、查看器等 |

#### 工作区选择器设计

```tsx
// 工作区列表（Ribbon 顶部）
interface Workspace {
  id: string;
  type: 'code-reader' | 'writing' | 'knowledge' | 'journal';
  name: string;
  icon: ReactNode;
  color: string;
}

// 示例工作区
const workspaces = [
  { id: 'main', type: 'code-reader', name: '代码阅读', icon: <Code2 />, color: '#3b82f6' },
  { id: 'novel', type: 'writing', name: '小说创作', icon: <BookOpen />, color: '#8b5cf6' },
  { id: 'kb', type: 'knowledge', name: '知识库', icon: <Brain />, color: '#10b981' },
];
```

### 2.2 工作区类型扩展

#### 新的工作区类型

```typescript
export type WorkspaceType =
  | 'code-reader'   // 代码阅读 - 浏览项目代码
  | 'writing'       // 创作模式 - 写文章、小说
  | 'knowledge'     // 知识库 - 笔记管理
  | 'journal'       // 日记 - 每日记录
  | 'materials'     // 素材库 - 资源管理
  | 'focus';        // 专注模式 - 沉浸写作
```

#### 各工作区功能矩阵

| 功能 | code-reader | writing | knowledge | journal | materials |
|------|-------------|---------|-----------|---------|-----------|
| Monaco Editor | ✅ | ❌ | ❌ | ❌ | ❌ |
| Rich Editor | ❌ | ✅ | ✅ | ✅ | ❌ |
| 文件树 | ✅ | ✅ | ✅ | ❌ | ✅ |
| Git 集成 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 标签系统 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 日历视图 | ❌ | ❌ | ❌ | ✅ | ❌ |
| 知识图谱 | ❌ | ❌ | ✅ | ❌ | ❌ |
| 素材管理 | ❌ | ✅ | ❌ | ❌ | ✅ |
| AI 助手 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 页面设置 | ❌ | ✅ | ✅ | ✅ | ❌ |

### 2.3 富文本编辑器重构

#### 技术选型

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| ProseMirror | 灵活、可扩展、社区活跃 | 学习曲线陡峭 | ✅ |
| TipTap | 基于 ProseMirror、API 友好 | 依赖较大 | 备选 |
| Slate.js | React 友好 | 性能问题、文档不全 | ❌ |
| Lexical | Facebook 出品、性能好 | 生态不如 ProseMirror | 备选 |

#### 推荐方案：TipTap (基于 ProseMirror)

```typescript
// 编辑器架构
interface EditorConfig {
  // 核心编辑器
  editor: TipTapEditor;
  
  // 代码块使用 CodeMirror 6
  codeBlockExtension: CodeMirrorExtension;
  
  // 扩展
  extensions: [
    StarterKit,           // 基础功能
    Placeholder,          // 占位符
    CodeBlockLowlight,    // 代码高亮（使用 lowlight）
    Image,                // 图片
    Link,                 // 链接
    TaskList,             // 任务列表
    Table,                // 表格
    Highlight,            // 高亮
    Typography,           // 排版优化
    CharacterCount,       // 字数统计
  ];
}
```

#### CodeMirror 6 集成

用于代码块编辑，提供：
- 语法高亮
- 代码补全
- 多语言支持
- 主题切换

```typescript
// CodeMirror 代码块扩展
import { Extension } from '@tiptap/core';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
// ... 其他语言

const CodeBlock = Extension.create({
  name: 'codeBlock',
  addNodeView() {
    return ({ node, getPos, editor }) => {
      // 创建 CodeMirror 实例
      const view = new EditorView({
        doc: node.textContent,
        extensions: [
          getLanguageExtension(node.attrs.language),
          // 主题
          // 键绑定
        ],
      });
      return { dom: view.dom };
    };
  },
});
```

### 2.4 页面设置功能

#### 页面背景类型

```typescript
export type PageBackground =
  | 'none'           // 无背景
  | 'lines'          // 横线（稿纸）
  | 'grid'           // 方格（格子纸）
  | 'dots'           // 点阵
  | 'columns'        // 分栏线
  | 'custom';        // 自定义

export interface PageSettings {
  // 背景
  background: PageBackground;
  backgroundOpacity: number;  // 0-1
  backgroundColor: string;
  
  // 边距
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  
  // 行间距
  lineHeight: number;
  
  // 字体
  fontFamily: string;
  fontSize: number;
  
  // 宽度
  contentWidth: 'narrow' | 'medium' | 'wide' | 'full';
  
  // 特殊模式
  typewriterMode: boolean;     // 打字机模式（当前行居中）
  focusMode: boolean;          // 聚焦模式（高亮当前段落）
}
```

#### 背景实现方案

```scss
// 横线背景
.page-bg-lines {
  background-image: repeating-linear-gradient(
    transparent,
    transparent calc(var(--line-height) - 1px),
    var(--line-color) calc(var(--line-height) - 1px),
    var(--line-color) var(--line-height)
  );
}

// 方格背景
.page-bg-grid {
  background-image: 
    linear-gradient(var(--line-color) 1px, transparent 1px),
    linear-gradient(90deg, var(--line-color) 1px, transparent 1px);
  background-size: var(--grid-size) var(--grid-size);
}

// 点阵背景
.page-bg-dots {
  background-image: radial-gradient(
    circle,
    var(--dot-color) 1px,
    transparent 1px
  );
  background-size: var(--dot-spacing) var(--dot-spacing);
}
```

### 2.5 子窗口支持

#### Electron 多窗口架构

```typescript
// main/window-manager.ts
class WindowManager {
  private windows: Map<string, BrowserWindow> = new Map();
  
  // 创建子窗口
  async createChildWindow(config: ChildWindowConfig): Promise<string> {
    const windowId = uuid();
    
    const win = new BrowserWindow({
      width: config.width || 1200,
      height: config.height || 800,
      parent: config.parentId ? this.windows.get(config.parentId) : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
      },
    });
    
    // 加载时传递工作区配置
    win.loadURL(`${BASE_URL}?workspace=${config.workspaceType}&id=${windowId}`);
    
    this.windows.set(windowId, win);
    return windowId;
  }
  
  // 窗口间通信
  sendToWindow(windowId: string, channel: string, data: any) {
    const win = this.windows.get(windowId);
    win?.webContents.send(channel, data);
  }
}
```

### 2.6 录音 + AI 整理

#### 架构设计

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   录音输入   │ ──> │   语音转写   │ ──> │   AI 整理   │
│  QuickInput │     │  Whisper    │     │  GPT/Claude │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               v
                          ┌─────────────────────────────────┐
                          │  结构化输出                      │
                          │  - 摘要                         │
                          │  - 标签                         │
                          │  - 文件夹建议                    │
                          │  - 关联笔记                      │
                          └─────────────────────────────────┘
```

#### Agent 设计

```typescript
interface VoiceNoteAgent {
  // 转写
  transcribe(audioBuffer: ArrayBuffer): Promise<string>;
  
  // 整理
  organize(transcript: string): Promise<{
    summary: string;
    title: string;
    tags: string[];
    suggestedFolder: string;
    relatedNotes: string[];
    actionItems: string[];
  }>;
  
  // 保存
  save(organized: OrganizedNote): Promise<Note>;
}
```

---

## 三、实现计划

### Phase 1: 布局重构 (Week 1-2)

#### 1.1 Ribbon 改造
- [ ] 添加工作区选择器组件
- [ ] 重构 Ribbon 布局
- [ ] 工作区切换动画

#### 1.2 TitleBar 简化
- [ ] 移除 ModeTabs
- [ ] 保留搜索和窗口控制
- [ ] 添加同步状态指示

#### 1.3 子窗口支持
- [ ] WindowManager 实现
- [ ] 窗口间状态同步
- [ ] 窗口管理 UI

### Phase 2: 富文本编辑器 (Week 3-4)

#### 2.1 TipTap 集成
- [ ] 安装依赖 (@tiptap/react, @tiptap/starter-kit, etc.)
- [ ] 创建基础编辑器组件
- [ ] 实现工具栏

#### 2.2 CodeMirror 集成
- [ ] 安装 @codemirror 相关包
- [ ] 创建代码块扩展
- [ ] 语言支持配置

#### 2.3 块编辑功能
- [ ] 斜杠命令 (/) 
- [ ] 拖拽排序
- [ ] 块操作菜单

### Phase 3: 页面设置 (Week 5)

#### 3.1 背景设置
- [ ] 背景类型选择 UI
- [ ] CSS 背景实现
- [ ] 预览功能

#### 3.2 排版设置
- [ ] 字体选择
- [ ] 边距调整
- [ ] 行间距调整

#### 3.3 特殊模式
- [ ] 打字机模式
- [ ] 聚焦模式
- [ ] 专注模式增强

### Phase 4: 录音 + AI (Week 6-7)

#### 4.1 录音优化
- [ ] 录音质量提升
- [ ] 波形可视化
- [ ] 录音文件管理

#### 4.2 AI 整理
- [ ] Whisper 转写集成
- [ ] GPT/Claude 整理 Agent
- [ ] 结构化输出 UI

#### 4.3 自动化工作流
- [ ] 自动打标签
- [ ] 自动归档
- [ ] 智能关联

---

## 四、技术依赖

### 新增依赖

```json
{
  "dependencies": {
    // 富文本编辑器
    "@tiptap/react": "^2.x",
    "@tiptap/starter-kit": "^2.x",
    "@tiptap/extension-placeholder": "^2.x",
    "@tiptap/extension-code-block-lowlight": "^2.x",
    "@tiptap/extension-image": "^2.x",
    "@tiptap/extension-link": "^2.x",
    "@tiptap/extension-task-list": "^2.x",
    "@tiptap/extension-task-item": "^2.x",
    "@tiptap/extension-table": "^2.x",
    "@tiptap/extension-highlight": "^2.x",
    "@tiptap/extension-typography": "^2.x",
    "@tiptap/extension-character-count": "^2.x",
    
    // 代码编辑
    "@codemirror/view": "^6.x",
    "@codemirror/state": "^6.x",
    "@codemirror/lang-javascript": "^6.x",
    "@codemirror/lang-python": "^6.x",
    "@codemirror/lang-rust": "^6.x",
    "@codemirror/lang-go": "^6.x",
    // ... 更多语言
    
    // 代码高亮
    "lowlight": "^3.x",
    
    // AI
    "openai": "^4.x",
    "@anthropic-ai/sdk": "^0.x"
  }
}
```

---

## 五、UI 设计参考

### 5.1 工作区选择器

```
┌──────────┐
│  📁 代码  │  ← 当前选中
├──────────┤
│  ✏️ 创作  │
├──────────┤
│  🧠 知识  │
├──────────┤
│  📖 日记  │
├──────────┤
│    +     │  ← 新建工作区
└──────────┘
```

### 5.2 页面设置面板

```
┌─────────────────────────────────┐
│  页面设置                        │
├─────────────────────────────────┤
│  背景样式                        │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐       │
│  │无 │ │横线│ │方格│ │点阵│       │
│  └───┘ └───┘ └───┘ └───┘       │
│                                 │
│  内容宽度                        │
│  ○ 窄  ○ 中  ○ 宽  ○ 全宽        │
│                                 │
│  字体                           │
│  [思源宋体          ▼]          │
│                                 │
│  字号: [16] px                  │
│  行高: [1.8]                    │
│                                 │
│  特殊模式                        │
│  [✓] 打字机模式                  │
│  [ ] 聚焦模式                    │
└─────────────────────────────────┘
```

### 5.3 录音 + AI 整理流程

```
┌─────────────────────────────────┐
│  🎙️ 正在录音... 02:34           │
│  ────────────────────────────── │
│  [■■■■■■■■░░░░░░░░░░░░]         │ ← 波形
│                                 │
│  [停止录音]                      │
└─────────────────────────────────┘
          │
          v
┌─────────────────────────────────┐
│  🔄 AI 正在整理...               │
│                                 │
│  ✓ 语音转文字                    │
│  ⏳ 内容整理                     │
│  ○ 生成标签                      │
│  ○ 建议归档                      │
└─────────────────────────────────┘
          │
          v
┌─────────────────────────────────┐
│  ✅ 整理完成                     │
│                                 │
│  标题: 项目进度讨论               │
│  标签: #工作 #项目管理            │
│  归档: /工作笔记/2024/           │
│                                 │
│  摘要:                          │
│  讨论了项目进度，决定下周...       │
│                                 │
│  [查看详情] [直接保存]            │
└─────────────────────────────────┘
```

---

## 六、注意事项

1. **性能优化**: TipTap/ProseMirror 在大文档时可能有性能问题，需要虚拟化渲染
2. **数据迁移**: 现有 Markdown 内容需要兼容新编辑器
3. **离线支持**: AI 功能需要考虑离线降级方案
4. **快捷键冲突**: 新编辑器快捷键需要与现有系统协调
5. **主题适配**: 新组件需要适配现有的明暗主题系统

---

## 七、参考资料

- [TipTap Documentation](https://tiptap.dev/docs)
- [CodeMirror 6](https://codemirror.net/6/)
- [ProseMirror Guide](https://prosemirror.net/docs/guide/)
- [Electron Multi-Window](https://www.electronjs.org/docs/latest/tutorial/windows)
- [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text)