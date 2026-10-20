// ================================
// EPUB 解析与渲染
// META-INF/container.xml → OPF（元数据、清单、书脊顺序）→ 章节 XHTML；
// 目录优先取 EPUB 3 导航文档，其次取 EPUB 2 的 NCX。
// 章节经白名单净化后呈现，包内图片转为 Blob URL，内部链接改写为 data-epub-target。
// ================================

import JSZip from 'jszip';
import { isTextBoundary } from './html-blocks';
import { imageSources, isExternalLink, sanitizeHtml, type LinkAttributes } from './sanitize-html';

/** 章节内元素 id 的前缀（与应用内其他元素区分） */
export const EPUB_ID_PREFIX = 'epub-';
/** 内部链接目标（包内完整路径，可带 #片段）所在属性 */
export const EPUB_TARGET_ATTR = 'data-epub-target';

const CHAPTER_MEDIA_TYPES = new Set(['application/xhtml+xml', 'text/html']);
const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml';
const OPS_NS = 'http://www.idpf.org/2007/ops';

export interface EpubManifestItem {
  id: string;
  /** 包内完整路径 */
  path: string;
  mediaType: string;
  properties: string[];
}

export interface EpubPackage {
  title: string;
  /** 书脊顺序的章节路径 */
  spine: string[];
  /** 按路径索引的清单 */
  manifest: Map<string, EpubManifestItem>;
  navPath?: string;
  ncxPath?: string;
}

export interface EpubTocEntry {
  label: string;
  /** 包内完整路径，可带 #片段 */
  target: string;
  /** 层级，从 0 开始 */
  depth: number;
}

export interface EpubBook {
  zip: JSZip;
  pkg: EpubPackage;
  toc: EpubTocEntry[];
}

// ---------- 路径 ----------

/** 拆分路径与 #片段 */
export function splitEpubTarget(target: string): { path: string; fragment: string } {
  const index = target.indexOf('#');
  return index < 0
    ? { path: target, fragment: '' }
    : { path: target.slice(0, index), fragment: target.slice(index + 1) };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 以包内文件 base 为基准解析相对引用，返回包内完整路径（保留 #片段）。
 * 引用中的百分号编码会被解码，以便与 zip 中的文件名对应。
 */
export function resolveEpubPath(base: string, href: string): string {
  const { path, fragment } = splitEpubTarget(href.trim());
  let resolved = base;
  if (path) {
    const segments = path.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const segment of safeDecode(path).split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') segments.pop();
      else segments.push(segment);
    }
    resolved = segments.join('/');
  }
  return fragment ? `${resolved}#${fragment}` : resolved;
}

// ---------- XML ----------

function parseXml(text: string, label: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(`EPUB ${label} 格式错误`);
  return doc;
}

/** 章节文档：优先按 XHTML 严格解析，不合规（如使用 HTML 实体）时按 HTML 宽松解析 */
function parseChapter(text: string): Document {
  const xhtml = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (xhtml.getElementsByTagName('parsererror').length === 0) return xhtml;
  return new DOMParser().parseFromString(text, 'text/html');
}

/** 忽略命名空间按本地名查找 */
function elementsByName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName));
}

function childrenByName(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === localName);
}

function collapsedText(element: Element | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 解析 META-INF/container.xml，返回 OPF 文件路径
 */
export function parseContainer(xml: string): string {
  const rootfile = elementsByName(parseXml(xml, 'container.xml'), 'rootfile').find((element) =>
    element.getAttribute('full-path')
  );
  const path = rootfile?.getAttribute('full-path');
  if (!path) throw new Error('EPUB 缺少 OPF 文件声明');
  return path;
}

/**
 * 解析 OPF：标题、清单、书脊（只保留 XHTML 章节）、导航文档与 NCX
 */
export function parseOpf(xml: string, opfPath: string): EpubPackage {
  const doc = parseXml(xml, 'OPF');
  const manifest = new Map<string, EpubManifestItem>();
  const byId = new Map<string, EpubManifestItem>();
  for (const element of elementsByName(doc, 'item')) {
    const id = element.getAttribute('id');
    const href = element.getAttribute('href');
    if (!id || !href) continue;
    const item: EpubManifestItem = {
      id,
      path: resolveEpubPath(opfPath, href),
      mediaType: element.getAttribute('media-type') ?? '',
      properties: (element.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
    };
    manifest.set(item.path, item);
    byId.set(id, item);
  }

  const spine = elementsByName(doc, 'itemref')
    .map((element) => byId.get(element.getAttribute('idref') ?? ''))
    .filter((item): item is EpubManifestItem => !!item && CHAPTER_MEDIA_TYPES.has(item.mediaType))
    .map((item) => item.path);

  const items = Array.from(byId.values());
  const spineElement = elementsByName(doc, 'spine')[0];
  const ncx =
    byId.get(spineElement?.getAttribute('toc') ?? '') ?? items.find((item) => item.mediaType === NCX_MEDIA_TYPE);

  return {
    title: collapsedText(elementsByName(doc, 'title')[0]),
    spine,
    manifest,
    navPath: items.find((item) => item.properties.includes('nav'))?.path,
    ncxPath: ncx?.path,
  };
}

/**
 * 解析 EPUB 3 导航文档中的目录（epub:type="toc"，缺省时取第一个 nav）
 */
export function parseNav(text: string, navPath: string): EpubTocEntry[] {
  const doc = parseChapter(text);
  const navs = elementsByName(doc, 'nav');
  const nav =
    navs.find((element) =>
      (element.getAttributeNS(OPS_NS, 'type') ?? element.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc')
    ) ?? navs[0];
  if (!nav) return [];

  const entries: EpubTocEntry[] = [];
  const walk = (list: Element, depth: number) => {
    for (const li of childrenByName(list, 'li')) {
      const link = childrenByName(li, 'a')[0];
      const href = link?.getAttribute('href');
      const label = collapsedText(link ?? childrenByName(li, 'span')[0]);
      if (href && label) entries.push({ label, target: resolveEpubPath(navPath, href), depth });
      childrenByName(li, 'ol').forEach((nested) => walk(nested, depth + 1));
    }
  };
  childrenByName(nav, 'ol').forEach((list) => walk(list, 0));
  return entries;
}

/**
 * 解析 EPUB 2 的 NCX 目录
 */
export function parseNcx(xml: string, ncxPath: string): EpubTocEntry[] {
  const navMap = elementsByName(parseXml(xml, 'NCX'), 'navMap')[0];
  if (!navMap) return [];

  const entries: EpubTocEntry[] = [];
  const walk = (parent: Element, depth: number) => {
    for (const point of childrenByName(parent, 'navPoint')) {
      const label = collapsedText(childrenByName(point, 'navLabel')[0]);
      const src = childrenByName(point, 'content')[0]?.getAttribute('src');
      if (label && src) entries.push({ label, target: resolveEpubPath(ncxPath, src), depth });
      walk(point, depth + 1);
    }
  };
  walk(navMap, 0);
  return entries;
}

// ---------- 打开与全文 ----------

async function readText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`EPUB 缺少文件：${path}`);
  return file.async('string');
}

/**
 * 打开 EPUB：解析包结构与目录
 */
export async function openEpub(data: Uint8Array | ArrayBuffer): Promise<EpubBook> {
  const zip = await JSZip.loadAsync(data);
  const opfPath = parseContainer(await readText(zip, 'META-INF/container.xml'));
  const pkg = parseOpf(await readText(zip, opfPath), opfPath);
  if (pkg.spine.length === 0) throw new Error('EPUB 没有可阅读的章节');

  let toc: EpubTocEntry[] = [];
  if (pkg.navPath) toc = parseNav(await readText(zip, pkg.navPath), pkg.navPath);
  if (toc.length === 0 && pkg.ncxPath) toc = parseNcx(await readText(zip, pkg.ncxPath), pkg.ncxPath);
  return { zip, pkg, toc };
}

/** 元素的可读文本：块级边界换行，其余空白折叠 */
function readableText(root: Element): string {
  let text = '';
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      text += (node.nodeValue ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    const boundary = isTextBoundary(element);
    if (boundary) text += '\n';
    element.childNodes.forEach(visit);
    if (boundary) text += '\n';
  };
  visit(root);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 提取全书文本（按书脊顺序，章节之间空行分隔），用于全文检索
 */
export async function extractEpubText(data: Uint8Array | ArrayBuffer): Promise<{ title: string; text: string }> {
  const { zip, pkg } = await openEpub(data);
  const chapters: string[] = [];
  for (const path of pkg.spine) {
    const doc = parseChapter(await readText(zip, path));
    const body = elementsByName(doc, 'body')[0];
    const text = body ? readableText(body) : '';
    if (text) chapters.push(text);
  }
  return { title: pkg.title, text: chapters.join('\n\n') };
}

// ---------- 阅读进度 ----------

/** 整本书的阅读进度：已读章节数加当前章节内的比例 */
export function bookProgress(chapterIndex: number, chapterCount: number, ratio: number): number {
  if (chapterCount <= 0) return 0;
  return Math.min(1, Math.max(0, (chapterIndex + Math.min(1, Math.max(0, ratio))) / chapterCount));
}

/** 由整本书进度还原章节与章节内比例 */
export function chapterPosition(progress: number, chapterCount: number): { chapterIndex: number; ratio: number } {
  if (chapterCount <= 0) return { chapterIndex: 0, ratio: 0 };
  const scaled = Math.min(1, Math.max(0, progress)) * chapterCount;
  const chapterIndex = Math.min(Math.floor(scaled), chapterCount - 1);
  return { chapterIndex, ratio: Math.min(1, scaled - chapterIndex) };
}

// ---------- 章节渲染 ----------

/**
 * 章节渲染器：缓存已渲染章节，包内图片转为 Blob URL，dispose 时统一释放
 */
export class EpubRenderer {
  private readonly chapters = new Map<number, Promise<string>>();
  private readonly imageUrls = new Map<string, Promise<string | null>>();
  private disposed = false;

  constructor(private readonly book: EpubBook) {}

  get chapterCount(): number {
    return this.book.pkg.spine.length;
  }

  /** 路径（不含片段）对应的章节序号，不在书脊中时返回 -1 */
  chapterIndexOf(path: string): number {
    return this.book.pkg.spine.indexOf(splitEpubTarget(path).path);
  }

  /** 渲染章节为净化后的 HTML */
  renderChapter(index: number): Promise<string> {
    let chapter = this.chapters.get(index);
    if (!chapter) {
      chapter = this.buildChapter(index);
      this.chapters.set(index, chapter);
      // 失败的结果不缓存，允许重试
      chapter.catch(() => this.chapters.delete(index));
    }
    return chapter;
  }

  /** 释放图片 Blob URL */
  dispose(): void {
    this.disposed = true;
    this.imageUrls.forEach((url) =>
      url.then((value) => value && URL.revokeObjectURL(value)).catch(() => undefined)
    );
    this.imageUrls.clear();
    this.chapters.clear();
  }

  private async buildChapter(index: number): Promise<string> {
    const path = this.book.pkg.spine[index];
    if (path === undefined) throw new Error(`章节不存在：${index + 1}`);
    const doc = parseChapter(await readText(this.book.zip, path));
    const body = elementsByName(doc, 'body')[0];
    if (!body) return '';

    // 先异步准备好全部图片地址，净化时同步查表
    const resolved = new Map<string, string | null>();
    await Promise.all(
      imageSources(body).map(async (src) => resolved.set(src, await this.imageUrl(path, src)))
    );

    return sanitizeHtml(body, {
      idPrefix: EPUB_ID_PREFIX,
      resolveImage: (src) => resolved.get(src) ?? null,
      resolveLink: (href): LinkAttributes => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return isExternalLink(href) ? { href } : null;
        return { href: '#', [EPUB_TARGET_ATTR]: resolveEpubPath(path, href) };
      },
    });
  }

  private imageUrl(chapterPath: string, src: string): Promise<string | null> {
    // 远程图片与内联图片受 CSP img-src 约束直接使用，包内图片读出为 Blob
    if (/^(https:|data:image\/)/i.test(src)) return Promise.resolve(src);
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return Promise.resolve(null);
    const path = splitEpubTarget(resolveEpubPath(chapterPath, src)).path;
    let url = this.imageUrls.get(path);
    if (!url) {
      url = this.loadImage(path);
      this.imageUrls.set(path, url);
    }
    return url;
  }

  private async loadImage(path: string): Promise<string | null> {
    const file = this.book.zip.file(path);
    if (!file) return null;
    const data = await file.async('arraybuffer');
    if (this.disposed) return null;
    const type = this.book.pkg.manifest.get(path)?.mediaType ?? '';
    return URL.createObjectURL(new Blob([data], { type }));
  }
}
