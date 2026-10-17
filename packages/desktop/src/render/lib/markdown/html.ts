// ================================
// Markdown → HTML（预览与阅读模式）
// 与编辑器共用解析器和 Schema，保证所见即所得
// ![[嵌入]] 展开为被引用文档/章节的内容，以深度上限与已访问集合防止循环嵌入
// ================================

import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { renderMath } from '../math';
import { extractHeadings, extractSection } from './extract';
import { parseContent, type ContentFormat } from './parser';
import { markdownSchema } from './schema';
import { embedKey, findHeadingIndex, wikiLinkRef, wikiLinkRefOf, type WikiLinkParts } from './wiki-link';

/** 渲染后的标题（用于目录） */
export interface RenderedHeading {
  /** 锚点 id */
  id: string;
  level: number;
  text: string;
}

/** HTML 渲染结果 */
export interface RenderedDocument {
  html: string;
  headings: RenderedHeading[];
}

/** 可嵌入的文档内容 */
export interface NoteEmbedSource {
  kind: 'note';
  /** 条目标题（循环检测以此为键） */
  title: string;
  content: string;
  format: ContentFormat;
}

/** 可嵌入的图片附件（文件由组件层读取后填入 src） */
export interface ImageEmbedSource {
  kind: 'image';
  title: string;
  filePath: string;
  mimeType?: string;
}

export type EmbedSource = NoteEmbedSource | ImageEmbedSource;

/** 按链接目标查找嵌入内容；目标不存在时返回 null */
export type EmbedResolver = (target: string) => EmbedSource | null;

/** 嵌入渲染的宿主上下文 */
export interface EmbedHost {
  resolveEmbed?: EmbedResolver;
  /** 宿主文档：![[#标题]] 指向它，并作为循环检测的起点 */
  self: NoteEmbedSource;
}

/** 渲染选项 */
export interface RenderOptions {
  resolveEmbed?: EmbedResolver;
  /** 当前文档标题（用于循环检测） */
  title?: string;
}

/** 嵌入最大嵌套层数 */
export const MAX_EMBED_DEPTH = 4;

/** 图片嵌入的文件路径与 MIME 类型属性 */
export const EMBED_IMAGE_PATH_ATTR = 'data-embed-path';
export const EMBED_IMAGE_MIME_ATTR = 'data-embed-mime';

interface EmbedContext {
  resolve: EmbedResolver | undefined;
  self: NoteEmbedSource;
  depth: number;
  visited: ReadonlySet<string>;
}

/** 文档节点 → DOM，公式节点替换为自研渲染器的输出 */
function renderNodes(doc: PMNode): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(markdownSchema).serializeFragment(doc.content));

  container.querySelectorAll<HTMLElement>('[data-math-inline]').forEach((el) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'math-inline-wrapper';
    wrapper.innerHTML = renderMath(el.getAttribute('data-math-inline') || '', {
      displayMode: false,
    }).html;
    el.replaceWith(wrapper);
  });

  container.querySelectorAll<HTMLElement>('[data-math-block]').forEach((el) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'math-block-wrapper';
    wrapper.innerHTML = renderMath(el.getAttribute('data-math-block') || '', {
      displayMode: true,
    }).html;
    el.replaceWith(wrapper);
  });

  return container;
}

/** 嵌入内容无法展开时的提示 */
function embedNotice(text: string): HTMLElement {
  const notice = document.createElement('div');
  notice.className = 'wiki-embed-missing';
  notice.textContent = text;
  return notice;
}

/** 渲染一个嵌入：标题链接 + 只读内容 */
function renderEmbed(parts: WikiLinkParts, ctx: EmbedContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'wiki-embed';
  const ref = wikiLinkRef(parts.target, parts.heading);
  const source = parts.target ? (ctx.resolve?.(parts.target) ?? null) : ctx.self;

  if (source?.kind === 'image') {
    const image = document.createElement('img');
    image.className = 'wiki-embed-image';
    image.alt = parts.alias || source.title;
    image.setAttribute(EMBED_IMAGE_PATH_ATTR, source.filePath);
    if (source.mimeType) image.setAttribute(EMBED_IMAGE_MIME_ATTR, source.mimeType);
    image.dataset.wikiTarget = parts.target;
    wrapper.appendChild(image);
    return wrapper;
  }

  const title = document.createElement('a');
  title.className = 'wiki-embed-title';
  title.dataset.wikiTarget = parts.target;
  if (parts.heading) title.dataset.wikiHeading = parts.heading;
  title.textContent = parts.alias || ref;
  wrapper.appendChild(title);

  if (!source) {
    wrapper.appendChild(embedNotice(`未找到「${parts.target}」`));
    return wrapper;
  }
  const key = embedKey(source.title, parts.heading);
  if (ctx.visited.has(key)) {
    wrapper.appendChild(embedNotice('循环嵌入，已停止展开'));
    return wrapper;
  }
  if (ctx.depth >= MAX_EMBED_DEPTH) {
    wrapper.appendChild(embedNotice('嵌套层级过深，已停止展开'));
    return wrapper;
  }

  const content = parts.heading
    ? source.format === 'markdown'
      ? extractSection(source.content, parts.heading)
      : null
    : source.content;
  if (content === null) {
    wrapper.appendChild(embedNotice(`未找到标题「${parts.heading}」`));
    return wrapper;
  }

  const body = renderNodes(parseContent(content, source.format));
  expandEmbeds(body, {
    resolve: ctx.resolve,
    self: source,
    depth: ctx.depth + 1,
    visited: new Set([...ctx.visited, key]),
  });
  // 嵌入内容中的 [[#标题]] 指向被嵌入的文档，而不是宿主
  if (source.title) {
    body.querySelectorAll('[data-wiki-target=""]').forEach((el) => el.setAttribute('data-wiki-target', source.title));
  }
  body.className = 'wiki-embed-content';
  wrapper.appendChild(body.childNodes.length > 0 ? body : embedNotice('没有可显示的内容'));
  return wrapper;
}

/** 将容器中的嵌入占位替换为被引用的内容 */
function expandEmbeds(container: HTMLElement, ctx: EmbedContext): void {
  container.querySelectorAll<HTMLElement>('[data-wiki-embed]').forEach((el) => {
    const parts: WikiLinkParts = {
      target: el.getAttribute('data-wiki-embed') || '',
      heading: el.getAttribute('data-wiki-heading'),
      alias: el.getAttribute('data-wiki-alias'),
    };
    el.replaceWith(renderEmbed(parts, ctx));
  });
}

/** 宿主文档的顶层嵌入上下文：宿主整篇已在展开链上 */
function rootContext(host: EmbedHost): EmbedContext {
  return {
    resolve: host.resolveEmbed,
    self: host.self,
    depth: 0,
    visited: new Set([embedKey(host.self.title, null)]),
  };
}

/**
 * 渲染单个嵌入（编辑器节点视图使用）
 */
export function renderWikiEmbed(parts: WikiLinkParts, host: EmbedHost): HTMLElement {
  return renderEmbed(parts, rootContext(host));
}

/**
 * 将文档节点渲染为 HTML 容器
 * - 数学公式节点替换为自研渲染器的输出
 * - 标题添加锚点 id，供目录跳转（嵌入内容中的标题不计入目录）
 * - 展开 ![[嵌入]]
 */
function renderDocToElement(
  doc: PMNode,
  host: EmbedHost
): { element: HTMLElement; headings: RenderedHeading[] } {
  const container = renderNodes(doc);

  const headings: RenderedHeading[] = [];
  container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((el, index) => {
    const id = `heading-${index}`;
    el.id = id;
    headings.push({ id, level: Number(el.tagName.slice(1)), text: el.textContent || '' });
  });

  expandEmbeds(container, rootContext(host));
  return { element: container, headings };
}

/**
 * 将存储内容渲染为 HTML
 */
export function renderContentToHtml(
  content: string,
  format: ContentFormat,
  options: RenderOptions = {}
): RenderedDocument {
  const { element, headings } = renderDocToElement(parseContent(content, format), {
    resolveEmbed: options.resolveEmbed,
    self: { kind: 'note', title: options.title ?? '', content, format },
  });
  return { html: element.innerHTML, headings };
}

/** 渲染结果中双向链接的点击去向 */
export type WikiLinkClickTarget =
  /** [[#标题]]：当前文档内的锚点（找不到标题时为 null） */
  | { kind: 'anchor'; id: string | null }
  /** 其他链接：交给上层打开（目标#标题 形式） */
  | { kind: 'open'; ref: string };

/**
 * 解析 renderContentToHtml 结果中被点击的双向链接
 * 锚点按标题序号对应 heading-序号，标题文本的匹配规则与编辑器、补全一致
 */
export function wikiLinkClickTarget(
  link: HTMLElement,
  content: string,
  format: ContentFormat
): WikiLinkClickTarget {
  const target = link.dataset.wikiTarget || '';
  const heading = link.dataset.wikiHeading || null;
  if (target || !heading) return { kind: 'open', ref: wikiLinkRefOf(link) };
  if (format !== 'markdown') return { kind: 'anchor', id: null };
  const index = findHeadingIndex(extractHeadings(content), heading);
  return { kind: 'anchor', id: index === -1 ? null : `heading-${index}` };
}
