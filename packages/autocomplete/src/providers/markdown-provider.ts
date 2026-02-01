// ================================
// @code-reader/autocomplete
// Markdown 补全提供者
// 提供 Markdown 语法关键字和结构补全
// ================================

import { BaseProvider } from './base-provider';
import type { CompletionContext, CompletionItem, CompletionSourceType } from '../types';

// ================================
// Markdown 关键字数据
// ================================

/** Markdown 关键字定义 */
interface MarkdownKeyword {
  /** 显示标签 */
  label: string;
  /** 插入文本 */
  insertText: string;
  /** 详细说明 */
  detail: string;
  /** 文档描述 */
  documentation: string;
  /** 基础优先级 */
  priority?: number;
}

/** Markdown 关键字列表 */
const MARKDOWN_KEYWORDS: MarkdownKeyword[] = [
  // 标题
  { label: '# 一级标题', insertText: '# ', detail: '标题', documentation: '创建一级标题', priority: 90 },
  { label: '## 二级标题', insertText: '## ', detail: '标题', documentation: '创建二级标题', priority: 88 },
  { label: '### 三级标题', insertText: '### ', detail: '标题', documentation: '创建三级标题', priority: 86 },
  { label: '#### 四级标题', insertText: '#### ', detail: '标题', documentation: '创建四级标题', priority: 84 },
  { label: '##### 五级标题', insertText: '##### ', detail: '标题', documentation: '创建五级标题', priority: 82 },
  { label: '###### 六级标题', insertText: '###### ', detail: '标题', documentation: '创建六级标题', priority: 80 },

  // 列表
  { label: '- 无序列表', insertText: '- ', detail: '列表', documentation: '创建无序列表项', priority: 85 },
  { label: '* 无序列表', insertText: '* ', detail: '列表', documentation: '创建无序列表项（星号）', priority: 84 },
  { label: '1. 有序列表', insertText: '1. ', detail: '列表', documentation: '创建有序列表项', priority: 83 },
  { label: '- [ ] 任务列表', insertText: '- [ ] ', detail: '任务', documentation: '创建未完成任务项', priority: 82 },
  { label: '- [x] 已完成任务', insertText: '- [x] ', detail: '任务', documentation: '创建已完成任务项', priority: 81 },

  // 格式
  { label: '**粗体**', insertText: '**$1**', detail: '格式', documentation: '粗体文本', priority: 80 },
  { label: '*斜体*', insertText: '*$1*', detail: '格式', documentation: '斜体文本', priority: 79 },
  { label: '~~删除线~~', insertText: '~~$1~~', detail: '格式', documentation: '删除线文本', priority: 78 },
  { label: '`行内代码`', insertText: '`$1`', detail: '代码', documentation: '行内代码', priority: 77 },
  { label: '==高亮==', insertText: '==$1==', detail: '格式', documentation: '高亮文本', priority: 76 },

  // 链接和图片
  { label: '[链接](url)', insertText: '[$1]($2)', detail: '链接', documentation: '插入链接', priority: 85 },
  { label: '![图片](url)', insertText: '![$1]($2)', detail: '图片', documentation: '插入图片', priority: 84 },
  { label: '[[Wiki链接]]', insertText: '[[$1]]', detail: '链接', documentation: '插入 Wiki 链接', priority: 83 },

  // 代码块
  {
    label: '```代码块```',
    insertText: '```$1\n$2\n```',
    detail: '代码块',
    documentation: '插入代码块',
    priority: 88,
  },
  {
    label: '```javascript',
    insertText: '```javascript\n$1\n```',
    detail: '代码块',
    documentation: '插入 JavaScript 代码块',
    priority: 87,
  },
  {
    label: '```typescript',
    insertText: '```typescript\n$1\n```',
    detail: '代码块',
    documentation: '插入 TypeScript 代码块',
    priority: 87,
  },
  {
    label: '```python',
    insertText: '```python\n$1\n```',
    detail: '代码块',
    documentation: '插入 Python 代码块',
    priority: 86,
  },
  {
    label: '```json',
    insertText: '```json\n$1\n```',
    detail: '代码块',
    documentation: '插入 JSON 代码块',
    priority: 85,
  },
  {
    label: '```bash',
    insertText: '```bash\n$1\n```',
    detail: '代码块',
    documentation: '插入 Bash 代码块',
    priority: 84,
  },
  {
    label: '```css',
    insertText: '```css\n$1\n```',
    detail: '代码块',
    documentation: '插入 CSS 代码块',
    priority: 83,
  },
  {
    label: '```html',
    insertText: '```html\n$1\n```',
    detail: '代码块',
    documentation: '插入 HTML 代码块',
    priority: 82,
  },

  // 引用
  { label: '> 引用', insertText: '> ', detail: '引用', documentation: '创建引用块', priority: 80 },
  {
    label: '> [!NOTE]',
    insertText: '> [!NOTE]\n> $1',
    detail: '提示框',
    documentation: '创建注意提示框',
    priority: 79,
  },
  {
    label: '> [!TIP]',
    insertText: '> [!TIP]\n> $1',
    detail: '提示框',
    documentation: '创建提示框',
    priority: 78,
  },
  {
    label: '> [!WARNING]',
    insertText: '> [!WARNING]\n> $1',
    detail: '提示框',
    documentation: '创建警告提示框',
    priority: 77,
  },
  {
    label: '> [!IMPORTANT]',
    insertText: '> [!IMPORTANT]\n> $1',
    detail: '提示框',
    documentation: '创建重要提示框',
    priority: 76,
  },

  // 分隔线
  { label: '---', insertText: '---\n', detail: '分隔线', documentation: '插入水平分隔线', priority: 70 },
  { label: '***', insertText: '***\n', detail: '分隔线', documentation: '插入水平分隔线', priority: 69 },

  // 表格
  {
    label: '| 表格 |',
    insertText: '| $1 | $2 | $3 |\n| --- | --- | --- |\n| $4 | $5 | $6 |',
    detail: '表格',
    documentation: '插入 3 列表格',
    priority: 85,
  },

  // 脚注
  { label: '[^脚注]', insertText: '[^$1]', detail: '脚注', documentation: '插入脚注引用', priority: 75 },
  {
    label: '[^脚注]: 定义',
    insertText: '[^$1]: $2',
    detail: '脚注',
    documentation: '定义脚注内容',
    priority: 74,
  },

  // 数学公式
  { label: '$行内公式$', insertText: '$$1$', detail: '公式', documentation: '插入行内数学公式', priority: 80 },
  {
    label: '$$块级公式$$',
    insertText: '$$\n$1\n$$',
    detail: '公式',
    documentation: '插入块级数学公式',
    priority: 79,
  },

  // Front Matter
  {
    label: '--- YAML Front Matter ---',
    insertText: '---\ntitle: $1\ndate: $2\ntags: [$3]\n---\n',
    detail: 'Front Matter',
    documentation: '插入 YAML 元数据块',
    priority: 95,
  },

  // 目录
  { label: '[[toc]]', insertText: '[[toc]]', detail: '目录', documentation: '插入自动目录', priority: 85 },

  // 折叠块
  {
    label: '<details> 折叠块',
    insertText: '<details>\n<summary>$1</summary>\n\n$2\n\n</details>',
    detail: '折叠',
    documentation: '插入可折叠内容块',
    priority: 75,
  },
];

// ================================
// Markdown 提供者类
// ================================

/**
 * Markdown 补全提供者
 * 提供 Markdown 语法关键字和结构的补全
 */
export class MarkdownProvider extends BaseProvider {
  readonly name = 'markdown';
  readonly type: CompletionSourceType = 'keyword';

  /** 关键字列表 */
  private keywords: MarkdownKeyword[];

  constructor() {
    super(80, ['#', '*', '-', '`', '[', '!', '>', '|', '$', ':', '/']);
    this.keywords = MARKDOWN_KEYWORDS;
  }

  /**
   * 获取补全项
   */
  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query, textBefore } = context;

    // 如果在代码块内，不提供 Markdown 补全
    if (this.isInCodeBlock(context)) {
      return [];
    }

    // 如果在行内代码内，不提供补全
    if (this.isInInlineCode(context)) {
      return [];
    }

    // 收集匹配的关键字
    const items: CompletionItem[] = [];
    const queryLower = query.toLowerCase();

    for (const keyword of this.keywords) {
      const labelLower = keyword.label.toLowerCase();

      // 检查是否匹配
      if (
        labelLower.includes(queryLower) ||
        this.fuzzyMatch(queryLower, labelLower) ||
        this.matchByTrigger(textBefore, keyword)
      ) {
        items.push(
          this.createItem(`markdown-${keyword.label}`, keyword.label, {
            insertText: keyword.insertText,
            detail: keyword.detail,
            documentation: keyword.documentation,
            priority: this.calculatePriority(query, keyword.label, keyword.priority ?? 50),
            icon: this.getIcon(keyword.detail),
          })
        );
      }
    }

    // 排序并限制数量
    return this.filterItems(items, query, { maxResults: 20 });
  }

  /**
   * 是否应该激活
   */
  shouldActivate(context: CompletionContext): boolean {
    const { textBefore, triggerCharacter } = context;

    // 如果在代码块内，不激活
    if (this.isInCodeBlock(context)) {
      return false;
    }

    // 检查触发字符
    if (triggerCharacter && this.triggerCharacters?.includes(triggerCharacter)) {
      return true;
    }

    // 检查是否在行首
    const trimmed = textBefore.trim();
    if (trimmed.length === 0 || textBefore.endsWith('\n')) {
      return true;
    }

    // 检查常见触发模式
    const triggerPatterns = [
      /^#/,        // 标题
      /^[-*+]\s?/, // 列表
      /^\d+\.\s?/, // 有序列表
      /^>/,        // 引用
      /\[$/,       // 链接开始
      /!\[$/,      // 图片开始
      /```$/,      // 代码块
      /\$$/,       // 数学公式
    ];

    const lineText = this.getLineText(textBefore);
    for (const pattern of triggerPatterns) {
      if (pattern.test(lineText)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 添加自定义关键字
   */
  addKeyword(keyword: MarkdownKeyword): void {
    this.keywords.push(keyword);
  }

  /**
   * 添加多个自定义关键字
   */
  addKeywords(keywords: MarkdownKeyword[]): void {
    this.keywords.push(...keywords);
  }

  /**
   * 移除关键字
   */
  removeKeyword(label: string): void {
    const index = this.keywords.findIndex((k) => k.label === label);
    if (index !== -1) {
      this.keywords.splice(index, 1);
    }
  }

  /**
   * 清空所有关键字
   */
  clearKeywords(): void {
    this.keywords = [];
  }

  /**
   * 重置为默认关键字
   */
  resetKeywords(): void {
    this.keywords = [...MARKDOWN_KEYWORDS];
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 检查是否由触发字符触发
   */
  private matchByTrigger(textBefore: string, keyword: MarkdownKeyword): boolean {
    if (textBefore.length === 0) return false;

    const lastChar = textBefore[textBefore.length - 1];
    const keywordStart = keyword.insertText[0];

    // 触发字符匹配
    if (lastChar === keywordStart) {
      return true;
    }

    // 行首触发
    const lineText = this.getLineText(textBefore);
    if (lineText.length === 0 && keyword.insertText.startsWith('#')) {
      return true;
    }

    return false;
  }

  /**
   * 获取当前行文本
   */
  private getLineText(textBefore: string): string {
    const lastNewline = textBefore.lastIndexOf('\n');
    return lastNewline === -1 ? textBefore : textBefore.substring(lastNewline + 1);
  }

  /**
   * 根据详情获取图标
   */
  private getIcon(detail: string): string {
    const iconMap: Record<string, string> = {
      '标题': '📑',
      '列表': '📋',
      '任务': '☑️',
      '格式': '✨',
      '代码': '💻',
      '代码块': '📝',
      '链接': '🔗',
      '图片': '🖼️',
      '引用': '💬',
      '提示框': '💡',
      '分隔线': '➖',
      '表格': '📊',
      '脚注': '📌',
      '公式': '🔢',
      'Front Matter': '📄',
      '目录': '📚',
      '折叠': '📂',
    };

    return iconMap[detail] ?? '📝';
  }
}
