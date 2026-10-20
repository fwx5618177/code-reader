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
