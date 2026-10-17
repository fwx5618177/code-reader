// ================================
// Document Constants
// Single responsibility: Static values and configuration
// ================================

/**
 * Document type in database
 */
export const DOCUMENT_TYPE = 'note';

/**
 * 是否为写作文档（在写作模式中编辑的 Markdown / LaTeX 等笔记）
 * 类型为 document 的 PDF / EPUB 等附件文档不是写作文档
 */
export function isWritingDocument(item: { type: string }): boolean {
  return item.type === DOCUMENT_TYPE;
}

/**
 * Document status in database
 */
export const DOCUMENT_STATUS = 'ready';

/**
 * Welcome document title (used to check if it exists)
 * @deprecated No longer auto-creating welcome document. Use WelcomeGuide component instead.
 */
export const WELCOME_DOCUMENT_TITLE = '欢迎使用';

/**
 * Welcome document content (HTML format for RichEditor)
 * @deprecated No longer auto-creating welcome document. Use WelcomeGuide component instead.
 * Kept for reference and potential future use (e.g., "Create Example Document" feature).
 */
export const WELCOME_DOCUMENT_CONTENT = `<h1>欢迎使用写作模式 ✍️</h1>
<p>这是一个简洁、专注的写作环境，帮助你捕捉灵感、整理思绪。</p>

<h2>快速开始</h2>
<ul>
  <li><strong>新建文档</strong>：点击左侧「新建文档」按钮，或按 <code>⌘N</code></li>
  <li><strong>专注模式</strong>：按 <code>⌘⇧F</code> 进入无干扰写作</li>
  <li><strong>保存文档</strong>：按 <code>⌘S</code> 保存当前内容</li>
</ul>

<h2>编辑技巧</h2>
<p>编辑器支持 Markdown 快捷输入：</p>
<ul>
  <li>输入 <code># </code> 创建一级标题</li>
  <li>输入 <code>## </code> 创建二级标题</li>
  <li>输入 <code>### </code> 创建三级标题</li>
  <li>输入 <code>> </code> 创建引用块</li>
  <li>输入 <code>- </code> 或 <code>* </code> 创建无序列表</li>
  <li>输入 <code>1. </code> 创建有序列表</li>
  <li>输入 <code>\`\`\`</code> 创建代码块</li>
  <li>输入 <code>---</code> 创建分割线</li>
</ul>

<h2>快捷键</h2>
<ul>
  <li><code>⌘B</code> 加粗</li>
  <li><code>⌘I</code> 斜体</li>
  <li><code>⌘E</code> 行内代码</li>
  <li><code>⌘K</code> 插入链接</li>
  <li><code>⌘Z</code> 撤销</li>
  <li><code>⌘⇧Z</code> 重做</li>
  <li><code>⌘S</code> 保存文档</li>
  <li><code>⌘⇧F</code> 进入专注模式</li>
  <li><code>Esc</code> 退出专注模式</li>
</ul>

<h2>专注模式</h2>
<blockquote>
  <p>💡 <strong>小提示</strong>：专注模式下，界面会自动隐藏所有干扰元素，让你沉浸在写作中。按 <code>Esc</code> 键随时退出。</p>
</blockquote>

<hr />

<p>现在，开始你的写作之旅吧！🚀</p>`;

/**
 * Placeholder texts used in UI
 */
export const PLACEHOLDERS = {
  /** Title placeholder */
  TITLE: '无标题',
  /** Content placeholder */
  CONTENT: '开始写作...',
  /** Focus mode content placeholder */
  FOCUS_CONTENT: '静下心来，开始写作...',
} as const;
