// ================================
// HTML 块级元素
// 用于在拼接文本时识别段落边界（高亮定位、EPUB 全文提取）
// ================================

/** 块级元素标签（小写） */
export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

/** 元素是否会在文本流中形成换行边界 */
export function isTextBoundary(element: Element): boolean {
  const tag = element.localName.toLowerCase();
  return tag === 'br' || BLOCK_TAGS.has(tag);
}
