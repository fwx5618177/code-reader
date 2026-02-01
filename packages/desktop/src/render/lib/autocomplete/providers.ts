// ================================
// 内置补全提供者
// 提供 Markdown 关键字、Emoji、代码片段等补全功能
// ================================

import type {
  CompletionProvider,
  CompletionContext,
  CompletionItem,
  CompletionSourceType,
} from './autocomplete-service';

// ================================
// Markdown 关键字提供者
// ================================

/** Markdown 语法关键字 */
const MARKDOWN_KEYWORDS: Array<{
  label: string;
  insertText: string;
  detail: string;
  documentation: string;
}> = [
  // 标题
  { label: '# 一级标题', insertText: '# ', detail: '标题', documentation: '插入一级标题' },
  { label: '## 二级标题', insertText: '## ', detail: '标题', documentation: '插入二级标题' },
  { label: '### 三级标题', insertText: '### ', detail: '标题', documentation: '插入三级标题' },
  { label: '#### 四级标题', insertText: '#### ', detail: '标题', documentation: '插入四级标题' },
  { label: '##### 五级标题', insertText: '##### ', detail: '标题', documentation: '插入五级标题' },
  {
    label: '###### 六级标题',
    insertText: '###### ',
    detail: '标题',
    documentation: '插入六级标题',
  },

  // 格式化
  { label: '**粗体**', insertText: '**$1**', detail: '格式', documentation: '粗体文本' },
  { label: '*斜体*', insertText: '*$1*', detail: '格式', documentation: '斜体文本' },
  { label: '~~删除线~~', insertText: '~~$1~~', detail: '格式', documentation: '删除线文本' },
  { label: '`行内代码`', insertText: '`$1`', detail: '格式', documentation: '行内代码' },

  // 列表
  { label: '- 无序列表', insertText: '- ', detail: '列表', documentation: '无序列表项' },
  { label: '1. 有序列表', insertText: '1. ', detail: '列表', documentation: '有序列表项' },
  { label: '- [ ] 任务列表', insertText: '- [ ] ', detail: '列表', documentation: '未完成的任务' },
  { label: '- [x] 完成任务', insertText: '- [x] ', detail: '列表', documentation: '已完成的任务' },

  // 引用和分隔
  { label: '> 引用', insertText: '> ', detail: '块', documentation: '块引用' },
  { label: '---', insertText: '---\n', detail: '分隔', documentation: '水平分隔线' },

  // 代码块
  {
    label: '```代码块```',
    insertText: '```$1\n$2\n```',
    detail: '代码',
    documentation: '代码块，可指定语言',
  },
  {
    label: '```javascript',
    insertText: '```javascript\n$1\n```',
    detail: '代码',
    documentation: 'JavaScript 代码块',
  },
  {
    label: '```typescript',
    insertText: '```typescript\n$1\n```',
    detail: '代码',
    documentation: 'TypeScript 代码块',
  },
  {
    label: '```python',
    insertText: '```python\n$1\n```',
    detail: '代码',
    documentation: 'Python 代码块',
  },
  { label: '```rust', insertText: '```rust\n$1\n```', detail: '代码', documentation: 'Rust 代码块' },
  { label: '```go', insertText: '```go\n$1\n```', detail: '代码', documentation: 'Go 代码块' },
  { label: '```sql', insertText: '```sql\n$1\n```', detail: '代码', documentation: 'SQL 代码块' },
  { label: '```json', insertText: '```json\n$1\n```', detail: '代码', documentation: 'JSON 代码块' },
  { label: '```yaml', insertText: '```yaml\n$1\n```', detail: '代码', documentation: 'YAML 代码块' },
  { label: '```html', insertText: '```html\n$1\n```', detail: '代码', documentation: 'HTML 代码块' },
  { label: '```css', insertText: '```css\n$1\n```', detail: '代码', documentation: 'CSS 代码块' },
  {
    label: '```shell',
    insertText: '```shell\n$1\n```',
    detail: '代码',
    documentation: 'Shell 代码块',
  },
  {
    label: '```markdown',
    insertText: '```markdown\n$1\n```',
    detail: '代码',
    documentation: 'Markdown 代码块',
  },

  // 链接和图片
  { label: '[链接](url)', insertText: '[$1]($2)', detail: '链接', documentation: '插入链接' },
  { label: '![图片](url)', insertText: '![$1]($2)', detail: '图片', documentation: '插入图片' },

  // 表格
  {
    label: '| 表格 |',
    insertText: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |',
    detail: '表格',
    documentation: '插入表格',
  },

  // 脚注
  { label: '[^脚注]', insertText: '[^$1]', detail: '脚注', documentation: '脚注引用' },

  // 数学公式（如果支持）
  { label: '$公式$', insertText: '$$1$', detail: '公式', documentation: '行内数学公式' },
  { label: '$$公式块$$', insertText: '$$\n$1\n$$', detail: '公式', documentation: '数学公式块' },
];

/**
 * Markdown 关键字补全提供者
 */
export class MarkdownKeywordProvider implements CompletionProvider {
  readonly name = 'markdown-keywords';
  readonly type: CompletionSourceType = 'keyword';
  readonly priority = 50;
  readonly triggerCharacters = ['#', '`', '-', '*', '>', '[', '!', '$', '|'];

  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query, lineText } = context;

    // 如果行首是特定字符，提供相关补全
    const items: CompletionItem[] = [];

    for (const keyword of MARKDOWN_KEYWORDS) {
      // 简单的前缀匹配
      const matchQuery = query.toLowerCase();
      const matchLabel = keyword.label.toLowerCase();

      if (matchLabel.includes(matchQuery) || matchQuery.length === 0) {
        items.push({
          id: `md-${keyword.label}`,
          label: keyword.label,
          insertText: keyword.insertText,
          type: this.type,
          detail: keyword.detail,
          documentation: keyword.documentation,
          priority: this.calculatePriority(keyword.label, query, lineText),
          source: this.name,
        });
      }
    }

    return items;
  }

  shouldActivate(context: CompletionContext): boolean {
    // 在行首或特定触发字符后激活
    const { textBefore, triggerCharacter } = context;

    if (triggerCharacter && this.triggerCharacters?.includes(triggerCharacter)) {
      return true;
    }

    // 行首或只有空格
    return textBefore.trim().length === 0 || textBefore.endsWith(' ');
  }

  private calculatePriority(label: string, query: string, lineText: string): number {
    let priority = 50;

    // 精确前缀匹配加分
    if (label.toLowerCase().startsWith(query.toLowerCase())) {
      priority += 20;
    }

    // 行首触发加分
    if (lineText.trim().length === 0) {
      priority += 10;
    }

    // 常用语法加分
    if (label.startsWith('#') || label.startsWith('```') || label.startsWith('-')) {
      priority += 5;
    }

    return priority;
  }
}

// ================================
// Emoji 提供者
// ================================

/** 常用 Emoji 列表 */
const COMMON_EMOJIS: Array<{
  shortcode: string;
  emoji: string;
  description: string;
  category: string;
}> = [
  // 表情
  { shortcode: ':smile:', emoji: '😄', description: '笑脸', category: '表情' },
  { shortcode: ':laughing:', emoji: '😆', description: '大笑', category: '表情' },
  { shortcode: ':blush:', emoji: '😊', description: '微笑', category: '表情' },
  { shortcode: ':heart_eyes:', emoji: '😍', description: '爱心眼', category: '表情' },
  { shortcode: ':wink:', emoji: '😉', description: '眨眼', category: '表情' },
  { shortcode: ':thinking:', emoji: '🤔', description: '思考', category: '表情' },
  { shortcode: ':cry:', emoji: '😢', description: '哭泣', category: '表情' },
  { shortcode: ':joy:', emoji: '😂', description: '喜极而泣', category: '表情' },
  { shortcode: ':sunglasses:', emoji: '😎', description: '墨镜', category: '表情' },
  { shortcode: ':worried:', emoji: '😟', description: '担心', category: '表情' },
  { shortcode: ':confused:', emoji: '😕', description: '困惑', category: '表情' },
  { shortcode: ':neutral_face:', emoji: '😐', description: '无表情', category: '表情' },

  // 手势
  { shortcode: ':thumbsup:', emoji: '👍', description: '点赞', category: '手势' },
  { shortcode: ':thumbsdown:', emoji: '👎', description: '踩', category: '手势' },
  { shortcode: ':clap:', emoji: '👏', description: '鼓掌', category: '手势' },
  { shortcode: ':wave:', emoji: '👋', description: '挥手', category: '手势' },
  { shortcode: ':ok_hand:', emoji: '👌', description: 'OK', category: '手势' },
  { shortcode: ':raised_hands:', emoji: '🙌', description: '举手', category: '手势' },
  { shortcode: ':pray:', emoji: '🙏', description: '祈祷', category: '手势' },
  { shortcode: ':muscle:', emoji: '💪', description: '肌肉', category: '手势' },
  { shortcode: ':point_right:', emoji: '👉', description: '右指', category: '手势' },
  { shortcode: ':point_left:', emoji: '👈', description: '左指', category: '手势' },
  { shortcode: ':point_up:', emoji: '☝️', description: '上指', category: '手势' },
  { shortcode: ':point_down:', emoji: '👇', description: '下指', category: '手势' },

  // 符号
  { shortcode: ':heart:', emoji: '❤️', description: '红心', category: '符号' },
  { shortcode: ':star:', emoji: '⭐', description: '星星', category: '符号' },
  { shortcode: ':fire:', emoji: '🔥', description: '火焰', category: '符号' },
  { shortcode: ':sparkles:', emoji: '✨', description: '闪烁', category: '符号' },
  { shortcode: ':zap:', emoji: '⚡', description: '闪电', category: '符号' },
  { shortcode: ':100:', emoji: '💯', description: '100分', category: '符号' },
  { shortcode: ':checkmark:', emoji: '✅', description: '勾选', category: '符号' },
  { shortcode: ':x:', emoji: '❌', description: '叉号', category: '符号' },
  { shortcode: ':warning:', emoji: '⚠️', description: '警告', category: '符号' },
  { shortcode: ':question:', emoji: '❓', description: '问号', category: '符号' },
  { shortcode: ':exclamation:', emoji: '❗', description: '感叹号', category: '符号' },
  { shortcode: ':bulb:', emoji: '💡', description: '灯泡', category: '符号' },

  // 物品
  { shortcode: ':rocket:', emoji: '🚀', description: '火箭', category: '物品' },
  { shortcode: ':computer:', emoji: '💻', description: '电脑', category: '物品' },
  { shortcode: ':phone:', emoji: '📱', description: '手机', category: '物品' },
  { shortcode: ':book:', emoji: '📖', description: '书本', category: '物品' },
  { shortcode: ':memo:', emoji: '📝', description: '备忘录', category: '物品' },
  { shortcode: ':clipboard:', emoji: '📋', description: '剪贴板', category: '物品' },
  { shortcode: ':calendar:', emoji: '📅', description: '日历', category: '物品' },
  { shortcode: ':clock:', emoji: '🕐', description: '时钟', category: '物品' },
  { shortcode: ':gift:', emoji: '🎁', description: '礼物', category: '物品' },
  { shortcode: ':trophy:', emoji: '🏆', description: '奖杯', category: '物品' },
  { shortcode: ':key:', emoji: '🔑', description: '钥匙', category: '物品' },
  { shortcode: ':lock:', emoji: '🔒', description: '锁', category: '物品' },
  { shortcode: ':gear:', emoji: '⚙️', description: '齿轮', category: '物品' },
  { shortcode: ':wrench:', emoji: '🔧', description: '扳手', category: '物品' },
  { shortcode: ':hammer:', emoji: '🔨', description: '锤子', category: '物品' },

  // 自然
  { shortcode: ':sun:', emoji: '☀️', description: '太阳', category: '自然' },
  { shortcode: ':moon:', emoji: '🌙', description: '月亮', category: '自然' },
  { shortcode: ':cloud:', emoji: '☁️', description: '云', category: '自然' },
  { shortcode: ':rainbow:', emoji: '🌈', description: '彩虹', category: '自然' },
  { shortcode: ':umbrella:', emoji: '☔', description: '雨伞', category: '自然' },
  { shortcode: ':snowflake:', emoji: '❄️', description: '雪花', category: '自然' },
  { shortcode: ':leaves:', emoji: '🍃', description: '树叶', category: '自然' },
  { shortcode: ':flower:', emoji: '🌸', description: '花', category: '自然' },
  { shortcode: ':seedling:', emoji: '🌱', description: '幼苗', category: '自然' },
  { shortcode: ':tree:', emoji: '🌳', description: '树', category: '自然' },

  // 食物
  { shortcode: ':coffee:', emoji: '☕', description: '咖啡', category: '食物' },
  { shortcode: ':pizza:', emoji: '🍕', description: '披萨', category: '食物' },
  { shortcode: ':hamburger:', emoji: '🍔', description: '汉堡', category: '食物' },
  { shortcode: ':cake:', emoji: '🍰', description: '蛋糕', category: '食物' },
  { shortcode: ':apple:', emoji: '🍎', description: '苹果', category: '食物' },

  // 动物
  { shortcode: ':dog:', emoji: '🐕', description: '狗', category: '动物' },
  { shortcode: ':cat:', emoji: '🐈', description: '猫', category: '动物' },
  { shortcode: ':bird:', emoji: '🐦', description: '鸟', category: '动物' },
  { shortcode: ':butterfly:', emoji: '🦋', description: '蝴蝶', category: '动物' },
  { shortcode: ':bug:', emoji: '🐛', description: '虫子', category: '动物' },

  // 开发相关
  { shortcode: ':bug_fix:', emoji: '🐛', description: 'Bug修复', category: '开发' },
  { shortcode: ':feature:', emoji: '✨', description: '新功能', category: '开发' },
  { shortcode: ':docs:', emoji: '📚', description: '文档', category: '开发' },
  { shortcode: ':refactor:', emoji: '♻️', description: '重构', category: '开发' },
  { shortcode: ':test:', emoji: '🧪', description: '测试', category: '开发' },
  { shortcode: ':perf:', emoji: '⚡', description: '性能', category: '开发' },
  { shortcode: ':security:', emoji: '🔒', description: '安全', category: '开发' },
  { shortcode: ':ci:', emoji: '👷', description: 'CI/CD', category: '开发' },
  { shortcode: ':build:', emoji: '🏗️', description: '构建', category: '开发' },
  { shortcode: ':deploy:', emoji: '🚀', description: '部署', category: '开发' },
  { shortcode: ':wip:', emoji: '🚧', description: '进行中', category: '开发' },
  { shortcode: ':breaking:', emoji: '💥', description: '破坏性变更', category: '开发' },
];

/**
 * Emoji 补全提供者
 */
export class EmojiProvider implements CompletionProvider {
  readonly name = 'emoji';
  readonly type: CompletionSourceType = 'emoji';
  readonly priority = 40;
  readonly triggerCharacters = [':'];

  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query } = context;

    // 只在 : 后触发
    if (!query.startsWith(':')) {
      return [];
    }

    const searchTerm = query.slice(1).toLowerCase();
    const items: CompletionItem[] = [];

    for (const emoji of COMMON_EMOJIS) {
      const shortcodeLower = emoji.shortcode.toLowerCase();
      const descLower = emoji.description.toLowerCase();

      // 匹配 shortcode 或描述
      if (
        searchTerm.length === 0 ||
        shortcodeLower.includes(searchTerm) ||
        descLower.includes(searchTerm)
      ) {
        items.push({
          id: `emoji-${emoji.shortcode}`,
          label: `${emoji.emoji} ${emoji.shortcode}`,
          insertText: emoji.emoji,
          type: this.type,
          detail: emoji.description,
          documentation: `分类: ${emoji.category}`,
          priority: this.calculatePriority(emoji, searchTerm),
          filterText: emoji.shortcode,
          source: this.name,
        });
      }
    }

    return items;
  }

  shouldActivate(context: CompletionContext): boolean {
    // 在 : 后激活
    return context.triggerCharacter === ':' || context.textBefore.includes(':');
  }

  private calculatePriority(
    emoji: { shortcode: string; description: string; category: string },
    searchTerm: string
  ): number {
    let priority = 40;

    // 精确前缀匹配加分
    if (emoji.shortcode.toLowerCase().startsWith(':' + searchTerm)) {
      priority += 30;
    }

    // 描述匹配
    if (emoji.description.toLowerCase().startsWith(searchTerm)) {
      priority += 15;
    }

    // 常用分类加分
    if (emoji.category === '表情' || emoji.category === '符号') {
      priority += 5;
    }

    return priority;
  }
}

// ================================
// 代码片段提供者
// ================================

/** 代码片段定义 */
const CODE_SNIPPETS: Array<{
  prefix: string;
  label: string;
  body: string;
  description: string;
  language?: string;
}> = [
  // 通用代码结构
  {
    prefix: 'if',
    label: 'if 语句',
    body: 'if ($1) {\n\t$2\n}',
    description: '条件判断语句',
  },
  {
    prefix: 'ife',
    label: 'if-else 语句',
    body: 'if ($1) {\n\t$2\n} else {\n\t$3\n}',
    description: '条件判断带 else',
  },
  {
    prefix: 'for',
    label: 'for 循环',
    body: 'for (let i = 0; i < $1; i++) {\n\t$2\n}',
    description: 'for 循环语句',
    language: 'javascript',
  },
  {
    prefix: 'foreach',
    label: 'forEach 循环',
    body: '$1.forEach(($2) => {\n\t$3\n});',
    description: 'forEach 数组遍历',
    language: 'javascript',
  },
  {
    prefix: 'map',
    label: 'map 映射',
    body: '$1.map(($2) => {\n\treturn $3;\n})',
    description: 'map 数组映射',
    language: 'javascript',
  },
  {
    prefix: 'filter',
    label: 'filter 过滤',
    body: '$1.filter(($2) => {\n\treturn $3;\n})',
    description: 'filter 数组过滤',
    language: 'javascript',
  },
  {
    prefix: 'reduce',
    label: 'reduce 归约',
    body: '$1.reduce((acc, $2) => {\n\treturn $3;\n}, $4)',
    description: 'reduce 数组归约',
    language: 'javascript',
  },

  // 函数定义
  {
    prefix: 'fn',
    label: '函数声明',
    body: 'function $1($2) {\n\t$3\n}',
    description: '函数声明',
    language: 'javascript',
  },
  {
    prefix: 'afn',
    label: '箭头函数',
    body: 'const $1 = ($2) => {\n\t$3\n};',
    description: '箭头函数',
    language: 'javascript',
  },
  {
    prefix: 'async',
    label: '异步函数',
    body: 'async function $1($2) {\n\t$3\n}',
    description: '异步函数声明',
    language: 'javascript',
  },
  {
    prefix: 'aafn',
    label: '异步箭头函数',
    body: 'const $1 = async ($2) => {\n\t$3\n};',
    description: '异步箭头函数',
    language: 'javascript',
  },

  // Try-Catch
  {
    prefix: 'try',
    label: 'try-catch',
    body: 'try {\n\t$1\n} catch (error) {\n\t$2\n}',
    description: '错误捕获',
  },
  {
    prefix: 'tryf',
    label: 'try-catch-finally',
    body: 'try {\n\t$1\n} catch (error) {\n\t$2\n} finally {\n\t$3\n}',
    description: '错误捕获带 finally',
  },

  // 类和对象
  {
    prefix: 'class',
    label: '类定义',
    body: 'class $1 {\n\tconstructor($2) {\n\t\t$3\n\t}\n}',
    description: '类定义',
    language: 'javascript',
  },
  {
    prefix: 'classex',
    label: '类继承',
    body: 'class $1 extends $2 {\n\tconstructor($3) {\n\t\tsuper($4);\n\t\t$5\n\t}\n}',
    description: '类继承',
    language: 'javascript',
  },

  // React 相关
  {
    prefix: 'rfc',
    label: 'React 函数组件',
    body:
      "import React from 'react';\n\nconst $1: React.FC = () => {\n\treturn (\n\t\t<div>\n\t\t\t$2\n\t\t</div>\n\t);\n};\n\nexport default $1;",
    description: 'React 函数组件',
    language: 'typescriptreact',
  },
  {
    prefix: 'useState',
    label: 'useState Hook',
    body: 'const [$1, set$2] = useState($3);',
    description: 'React useState Hook',
    language: 'typescriptreact',
  },
  {
    prefix: 'useEffect',
    label: 'useEffect Hook',
    body: 'useEffect(() => {\n\t$1\n\treturn () => {\n\t\t$2\n\t};\n}, [$3]);',
    description: 'React useEffect Hook',
    language: 'typescriptreact',
  },
  {
    prefix: 'useCallback',
    label: 'useCallback Hook',
    body: 'const $1 = useCallback(($2) => {\n\t$3\n}, [$4]);',
    description: 'React useCallback Hook',
    language: 'typescriptreact',
  },
  {
    prefix: 'useMemo',
    label: 'useMemo Hook',
    body: 'const $1 = useMemo(() => {\n\treturn $2;\n}, [$3]);',
    description: 'React useMemo Hook',
    language: 'typescriptreact',
  },

  // TypeScript
  {
    prefix: 'interface',
    label: '接口定义',
    body: 'interface $1 {\n\t$2: $3;\n}',
    description: 'TypeScript 接口',
    language: 'typescript',
  },
  {
    prefix: 'type',
    label: '类型别名',
    body: 'type $1 = $2;',
    description: 'TypeScript 类型别名',
    language: 'typescript',
  },
  {
    prefix: 'enum',
    label: '枚举定义',
    body: 'enum $1 {\n\t$2 = $3,\n}',
    description: 'TypeScript 枚举',
    language: 'typescript',
  },

  // 导入导出
  {
    prefix: 'imp',
    label: 'import 语句',
    body: "import { $1 } from '$2';",
    description: '命名导入',
    language: 'javascript',
  },
  {
    prefix: 'impd',
    label: '默认导入',
    body: "import $1 from '$2';",
    description: '默认导入',
    language: 'javascript',
  },
  {
    prefix: 'exp',
    label: '导出语句',
    body: 'export { $1 };',
    description: '命名导出',
    language: 'javascript',
  },
  {
    prefix: 'expd',
    label: '默认导出',
    body: 'export default $1;',
    description: '默认导出',
    language: 'javascript',
  },

  // 控制台
  {
    prefix: 'cl',
    label: 'console.log',
    body: "console.log('$1', $2);",
    description: '打印日志',
    language: 'javascript',
  },
  {
    prefix: 'ce',
    label: 'console.error',
    body: "console.error('$1', $2);",
    description: '打印错误',
    language: 'javascript',
  },
  {
    prefix: 'cw',
    label: 'console.warn',
    body: "console.warn('$1', $2);",
    description: '打印警告',
    language: 'javascript',
  },
];

/**
 * 代码片段补全提供者
 */
export class SnippetProvider implements CompletionProvider {
  readonly name = 'snippets';
  readonly type: CompletionSourceType = 'snippet';
  readonly priority = 60;

  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query, language } = context;
    const queryLower = query.toLowerCase();
    const items: CompletionItem[] = [];

    for (const snippet of CODE_SNIPPETS) {
      // 语言过滤
      if (snippet.language && language && snippet.language !== language) {
        continue;
      }

      // 匹配前缀
      if (
        snippet.prefix.toLowerCase().includes(queryLower) ||
        snippet.label.toLowerCase().includes(queryLower)
      ) {
        items.push({
          id: `snippet-${snippet.prefix}`,
          label: snippet.label,
          insertText: snippet.body,
          type: this.type,
          detail: snippet.prefix,
          documentation: snippet.description,
          priority: this.calculatePriority(snippet.prefix, query),
          filterText: snippet.prefix,
          source: this.name,
        });
      }
    }

    return items;
  }

  private calculatePriority(prefix: string, query: string): number {
    let priority = 60;

    // 精确匹配加分
    if (prefix.toLowerCase() === query.toLowerCase()) {
      priority += 30;
    }
    // 前缀匹配加分
    else if (prefix.toLowerCase().startsWith(query.toLowerCase())) {
      priority += 15;
    }

    return priority;
  }
}

// ================================
// 标签提供者（用于标签系统）
// ================================

/**
 * 标签补全提供者
 */
export class TagProvider implements CompletionProvider {
  readonly name = 'tags';
  readonly type: CompletionSourceType = 'tag';
  readonly priority = 45;
  readonly triggerCharacters = ['#', '@'];

  private tags: Set<string> = new Set();

  /**
   * 添加标签
   */
  addTag(tag: string): void {
    this.tags.add(tag.toLowerCase());
  }

  /**
   * 添加多个标签
   */
  addTags(tags: string[]): void {
    for (const tag of tags) {
      this.tags.add(tag.toLowerCase());
    }
  }

  /**
   * 移除标签
   */
  removeTag(tag: string): void {
    this.tags.delete(tag.toLowerCase());
  }

  /**
   * 清空标签
   */
  clearTags(): void {
    this.tags.clear();
  }

  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query } = context;

    // 检测触发字符
    let searchTerm = query;
    let prefix = '';
    if (query.startsWith('#')) {
      searchTerm = query.slice(1);
      prefix = '#';
    } else if (query.startsWith('@')) {
      searchTerm = query.slice(1);
      prefix = '@';
    }

    const searchLower = searchTerm.toLowerCase();
    const items: CompletionItem[] = [];

    for (const tag of this.tags) {
      if (searchLower.length === 0 || tag.includes(searchLower)) {
        items.push({
          id: `tag-${tag}`,
          label: `${prefix}${tag}`,
          insertText: `${prefix}${tag}`,
          type: this.type,
          detail: '标签',
          priority: this.calculatePriority(tag, searchLower),
          source: this.name,
        });
      }
    }

    return items;
  }

  shouldActivate(context: CompletionContext): boolean {
    return context.triggerCharacter === '#' || context.triggerCharacter === '@';
  }

  private calculatePriority(tag: string, searchTerm: string): number {
    let priority = 45;

    if (tag.startsWith(searchTerm)) {
      priority += 20;
    }

    return priority;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建默认的补全提供者集合
 */
export function createDefaultProviders(): CompletionProvider[] {
  return [
    new MarkdownKeywordProvider(),
    new EmojiProvider(),
    new SnippetProvider(),
    new TagProvider(),
  ];
}

// ================================
// 导出
// ================================

export {
  MARKDOWN_KEYWORDS,
  COMMON_EMOJIS,
  CODE_SNIPPETS,
};
