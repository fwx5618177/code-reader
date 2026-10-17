// ================================
// HTML 净化
// 将外部 HTML（EPUB 章节等）按白名单重建到惰性文档中：
// 只保留排版相关的标签与少量安全属性，脚本、样式、表单、嵌入内容及所有事件属性一律丢弃。
// 输出的 HTML 只包含白名单内容，可直接写入正文容器。
// ================================

/** 保留的标签（小写） */
const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'del',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
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
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
]);

/** 连同内容一起丢弃的标签；不在两个列表中的标签只去掉自身、保留内容 */
const DROPPED_TAGS = new Set([
  'annotation',
  'annotation-xml',
  'audio',
  'button',
  'canvas',
  'embed',
  'form',
  'frame',
  'frameset',
  'head',
  'iframe',
  'input',
  'link',
  'meta',
  'noscript',
  'object',
  'script',
  'select',
  'style',
  'template',
  'textarea',
  'title',
  'video',
]);

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** 链接改写结果：写入 <a> 的属性；null 表示只保留文字 */
export type LinkAttributes = Record<string, string> | null;

export interface SanitizeOptions {
  /** 图片地址解析：返回可直接加载的地址，null 表示丢弃该图片 */
  resolveImage: (src: string) => string | null;
  /** 链接解析 */
  resolveLink: (href: string) => LinkAttributes;
  /** 写入 id 时附加的前缀，避免与应用内元素冲突 */
  idPrefix: string;
}

const NUMERIC = /^\d{1,4}$/;

/** 复制通用属性与各标签允许的属性 */
function copyAttributes(source: Element, target: Element, tag: string, options: SanitizeOptions): void {
  const id = source.getAttribute('id');
  if (id) target.setAttribute('id', `${options.idPrefix}${id}`);
  const title = source.getAttribute('title');
  if (title) target.setAttribute('title', title);
  const lang = source.getAttribute('lang') ?? source.getAttribute('xml:lang');
  if (lang) target.setAttribute('lang', lang);
  const dir = source.getAttribute('dir');
  if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') target.setAttribute('dir', dir);

  if (tag === 'td' || tag === 'th') {
    for (const name of ['colspan', 'rowspan']) {
      const value = source.getAttribute(name);
      if (value && NUMERIC.test(value)) target.setAttribute(name, value);
    }
  }
  if (tag === 'ol') {
    const start = source.getAttribute('start');
    if (start && NUMERIC.test(start)) target.setAttribute('start', start);
  }
}

/** 构建图片元素；地址无法解析时返回 null */
function createImage(doc: Document, src: string | null, alt: string, options: SanitizeOptions): HTMLImageElement | null {
  const resolved = src ? options.resolveImage(src) : null;
  if (!resolved) return null;
  const img = doc.createElement('img');
  img.setAttribute('src', resolved);
  if (alt) img.setAttribute('alt', alt);
  return img;
}

/** SVG <image> 的引用地址（xlink:href 或 href） */
function svgImageHref(image: Element): string | null {
  return image.getAttributeNS(XLINK_NS, 'href') ?? image.getAttribute('href');
}

/** SVG 只保留其中引用的位图（常见于 EPUB 封面），其余图形丢弃 */
function svgImages(svg: Element, doc: Document, options: SanitizeOptions): Node[] {
  return Array.from(svg.getElementsByTagNameNS('*', 'image'))
    .map((image) => createImage(doc, svgImageHref(image), '', options))
    .filter((img): img is HTMLImageElement => img !== null);
}

/**
 * 元素中净化时会保留的图片引用（<img src> 与 SVG <image>），供调用方预先解析地址
 */
export function imageSources(root: Element): string[] {
  const sources = new Set<string>();
  root.querySelectorAll('img').forEach((img) => sources.add(img.getAttribute('src') ?? ''));
  Array.from(root.getElementsByTagNameNS('*', 'image')).forEach((image) => sources.add(svgImageHref(image) ?? ''));
  sources.delete('');
  return Array.from(sources);
}

function sanitizeNode(node: Node, doc: Document, options: SanitizeOptions): Node[] {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    return [doc.createTextNode(node.nodeValue ?? '')];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const element = node as Element;
  const tag = element.localName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) return [];
  if (tag === 'svg') return svgImages(element, doc, options);
  if (tag === 'img') {
    const img = createImage(doc, element.getAttribute('src'), element.getAttribute('alt') ?? '', options);
    if (img) copyAttributes(element, img, tag, options);
    return img ? [img] : [];
  }

  const children = sanitizeChildren(element, doc, options);
  if (!ALLOWED_TAGS.has(tag)) return children;

  // 链接无法解析时降级为 span，保留文字和可能作为锚点的 id
  const linkAttributes = tag === 'a' ? resolveLinkAttributes(element, options) : null;
  const target = doc.createElement(tag === 'a' && !linkAttributes ? 'span' : tag);
  copyAttributes(element, target, tag, options);
  if (linkAttributes) {
    Object.entries(linkAttributes).forEach(([name, value]) => target.setAttribute(name, value));
  }
  children.forEach((child) => target.appendChild(child));
  return [target];
}

function resolveLinkAttributes(element: Element, options: SanitizeOptions): LinkAttributes {
  const href = element.getAttribute('href') ?? element.getAttributeNS(XLINK_NS, 'href');
  return href ? options.resolveLink(href) : null;
}

function sanitizeChildren(element: Element, doc: Document, options: SanitizeOptions): Node[] {
  return Array.from(element.childNodes).flatMap((child) => sanitizeNode(child, doc, options));
}

/**
 * 净化元素的子内容，返回 HTML 字符串
 */
export function sanitizeHtml(source: Element, options: SanitizeOptions): string {
  // 在惰性文档中构建，图片等资源不会在净化过程中被加载
  const doc = document.implementation.createHTMLDocument('');
  const container = doc.createElement('div');
  sanitizeChildren(source, doc, options).forEach((child) => container.appendChild(child));
  return container.innerHTML;
}

/** 允许在系统浏览器中打开的外部链接 */
export function isExternalLink(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}
