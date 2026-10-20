// ================================
// Markdown → HTML（预览与阅读模式）
// 与编辑器共用解析器和 Schema，保证所见即所得
// ![[嵌入]] 展开为被引用文档/章节的内容，以深度上限与已访问集合防止循环嵌入
// ================================

import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { renderMath } from '../math';
import { collectAbbreviations, wrapAbbreviations } from './abbreviations';
import { numberFootnotes } from './footnotes';
import { blockRefId, collectDocBlocks, extractBlock, findBlockInDoc, stripBlockMarker } from './block-ref';
import { extractHeadings, extractSection } from './extract';
import { parseContent, type ContentFormat } from './parser';
import { markdownSchema } from './schema';
import { embedKey, findHeadingIndex, wikiLinkRef, wikiLinkRefOf, type WikiLinkParts } from './wiki-link';
import { MEDIA_SRC_ATTR, localMediaTarget, type MediaKind } from './media';

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

/** 可嵌入的媒体附件：图片、视频、音频（文件由组件层读取后填入 src） */
export interface MediaEmbedSource {
  kind: 'media';
  media: MediaKind;
  title: string;
  filePath: string;
  mimeType?: string;
}

export type EmbedSource = NoteEmbedSource | MediaEmbedSource;

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

/** 媒体嵌入（图片 / 视频 / 音频）的文件路径与 MIME 类型属性；组件层据此读取文件 */
export const EMBED_MEDIA_PATH_ATTR = 'data-embed-path';
export const EMBED_MEDIA_MIME_ATTR = 'data-embed-mime';

/** 带块 ID 的元素属性（顶层文档中同时获得 block-<id> 锚点） */
const BLOCK_ID_ATTR = 'data-block-id';

/** 块锚点 id（标题块沿用 heading-序号） */
function blockAnchorId(id: string): string {
  return `block-${id}`;
}

interface EmbedContext {
  resolve: EmbedResolver | undefined;
  self: NoteEmbedSource;
  depth: number;
  visited: ReadonlySet<string>;
}

/** 文档节点 → DOM，公式节点替换为自研渲染器的输出，块 ID 标记转为块元素上的属性 */
function renderNodes(doc: PMNode): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(markdownSchema).serializeFragment(doc.content));
  // 段落与标题元素按文档顺序对应块的 anchorIndex（在公式替换前收集）
  const anchors = container.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6');

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

  applyBlockMarkers(doc, anchors);
  wrapAbbreviations(container, collectAbbreviations(doc));
  numberFootnoteElements(container, doc);
  describeFootnoteRefs(container);
  return container;
}

/** 脚注按第一次引用的顺序编号：引用显示编号，行内脚注与被引用的定义带上编号属性（样式显示在前面） */
function numberFootnoteElements(container: HTMLElement, doc: PMNode): void {
  const { at, byLabel } = numberFootnotes(doc);
  if (at.size === 0) return;
  const numbers = [...at.values()];
  container.querySelectorAll<HTMLElement>('[data-footnote-ref], [data-footnote-inline]').forEach((element, index) => {
    const number = numbers[index];
    if (number === undefined) return;
    element.dataset.footnoteNumber = String(number);
    if (element.hasAttribute('data-footnote-ref')) element.textContent = String(number);
  });
  container.querySelectorAll<HTMLElement>('[data-footnote-def]').forEach((definition) => {
    const number = byLabel.get(definition.getAttribute('data-footnote-def') ?? '');
    if (number !== undefined) definition.dataset.footnoteNumber = String(number);
  });
}

/** 脚注引用悬停时显示脚注内容 */
function describeFootnoteRefs(container: HTMLElement): void {
  const definitions = new Map<string, string>();
  container.querySelectorAll<HTMLElement>('[data-footnote-def]').forEach((definition) => {
    const label = definition.getAttribute('data-footnote-def') ?? '';
    if (!definitions.has(label)) definitions.set(label, definition.textContent?.trim() ?? '');
  });
  container.querySelectorAll<HTMLElement>('[data-footnote-ref]').forEach((ref) => {
    const text = definitions.get(ref.getAttribute('data-footnote-ref') ?? '');
    if (text) ref.title = text;
  });
}

/**
 * 去掉渲染结果中的 ^id 标记，并把 ID 记在对应的块元素上：
 * 段尾标记从文本中删除，独占一段的标记整段删除并作用于前一个元素，列表项首段的标记作用于 li
 */
function applyBlockMarkers(doc: PMNode, anchors: NodeListOf<HTMLElement>): void {
  for (const block of collectDocBlocks(doc)) {
    const anchor = block.marker ? anchors[block.marker.anchorIndex] : undefined;
    if (!block.id || !block.marker || !anchor) continue;
    let element: Element | null = anchor;
    if (block.marker.standalone) {
      element = anchor.previousElementSibling;
      anchor.remove();
    } else if (anchor.lastChild?.nodeType === Node.TEXT_NODE) {
      const text = anchor.lastChild as Text;
      text.data = stripBlockMarker(text.data);
      if (!text.data) text.remove();
    }
    if (block.relation === 'list-item') element = element?.parentElement ?? null;
    element?.setAttribute(BLOCK_ID_ATTR, block.id);
  }
}

/** 嵌入内容无法展开时的提示 */
function embedNotice(text: string): HTMLElement {
  const notice = document.createElement('div');
  notice.className = 'wiki-embed-missing';
  notice.textContent = text;
  return notice;
}

/** 媒体附件 → 播放 / 显示元素（src 由组件层按文件路径填入） */
export function createMediaElement(source: MediaEmbedSource, label: string): HTMLElement {
  const element = document.createElement(source.media === 'image' ? 'img' : source.media);
  if (element instanceof HTMLImageElement) {
    element.alt = label;
  } else {
    element.setAttribute('controls', '');
    element.setAttribute('preload', 'metadata');
    element.setAttribute('aria-label', label);
  }
  element.setAttribute(EMBED_MEDIA_PATH_ATTR, source.filePath);
  if (source.mimeType) element.setAttribute(EMBED_MEDIA_MIME_ATTR, source.mimeType);
  return element;
}

/**
 * 正文中 ![](本地文件) 的媒体：按文件名在知识库中查找附件，找到后记下文件路径供组件层加载，找不到时显示提示
 */
function resolveLocalMedia(container: HTMLElement, resolve: EmbedResolver | undefined): void {
  container.querySelectorAll<HTMLElement>(`[${MEDIA_SRC_ATTR}]:not([src])`).forEach((element) => {
    const target = localMediaTarget(element.getAttribute(MEDIA_SRC_ATTR) ?? '');
    const source = target ? resolve?.(target) : null;
    if (source?.kind === 'media') {
      element.setAttribute(EMBED_MEDIA_PATH_ATTR, source.filePath);
      if (source.mimeType) element.setAttribute(EMBED_MEDIA_MIME_ATTR, source.mimeType);
    } else {
      element.replaceWith(embedNotice(`未找到附件「${target}」`));
    }
  });
}

/** 渲染一个嵌入：标题链接 + 只读内容 */
function renderEmbed(parts: WikiLinkParts, ctx: EmbedContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'wiki-embed';
  const ref = wikiLinkRef(parts.target, parts.heading);
  const source = parts.target ? (ctx.resolve?.(parts.target) ?? null) : ctx.self;

  if (source?.kind === 'media') {
    const media = createMediaElement(source, parts.alias || source.title);
    media.className = `wiki-embed-media wiki-embed-${source.media}`;
    media.dataset.wikiTarget = parts.target;
    wrapper.appendChild(media);
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

  const blockId = blockRefId(parts.heading);
  const content = parts.heading
    ? source.format === 'markdown'
      ? blockId
        ? extractBlock(source.content, blockId)
        : extractSection(source.content, parts.heading)
      : null
    : source.content;
  if (content === null) {
    wrapper.appendChild(
      embedNotice(blockId ? `块「^${blockId}」不存在` : `未找到标题「${parts.heading}」`)
    );
    return wrapper;
  }

  const body = renderNodes(parseContent(content, source.format));
  resolveLocalMedia(body, ctx.resolve);
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
    const embed = renderEmbed(parts, ctx);
    // 独立标记为嵌入命名时，块 ID 与锚点转移到展开后的元素
    for (const name of [BLOCK_ID_ATTR, 'id']) {
      const value = el.getAttribute(name);
      if (value !== null) embed.setAttribute(name, value);
    }
    el.replaceWith(embed);
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
 * - 标题添加锚点 id，供目录跳转（嵌入内容中的标题不计入目录）；其余带 ID 的块添加 block-<id> 锚点
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
  container.querySelectorAll<HTMLElement>(`[${BLOCK_ID_ATTR}]:not([id])`).forEach((el) => {
    el.id = blockAnchorId(el.getAttribute(BLOCK_ID_ATTR)!);
  });

  resolveLocalMedia(container, host.resolveEmbed);
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
 * 锚点按标题序号对应 heading-序号，标题文本的匹配规则与编辑器、补全一致；
 * [[#^id]] 对应 block-<id>（块本身是标题时为该标题的锚点）
 */
export function wikiLinkClickTarget(
  link: HTMLElement,
  content: string,
  format: ContentFormat
): WikiLinkClickTarget {
  const target = link.dataset.wikiTarget || '';
  const heading = link.dataset.wikiHeading || null;
  if (target || !heading) return { kind: 'open', ref: wikiLinkRefOf(link) };
  return { kind: 'anchor', id: linkAnchorId(content, format, heading) };
}

/**
 * 链接 #… 部分在 renderContentToHtml 结果中的锚点 id；找不到时返回 null
 * #^id 为块，其余为标题（occurrence 为同名标题序号），匹配规则与编辑器、补全一致
 */
export function linkAnchorId(
  content: string,
  format: ContentFormat,
  subpath: string,
  occurrence = 0
): string | null {
  if (format !== 'markdown') return null;
  const blockId = blockRefId(subpath);
  if (blockId) return blockAnchorTarget(parseContent(content, format), blockId);
  const index = findHeadingIndex(extractHeadings(content), subpath, occurrence);
  return index === -1 ? null : `heading-${index}`;
}

/** 块在渲染结果中的锚点 id */
function blockAnchorTarget(doc: PMNode, blockId: string): string | null {
  const block = findBlockInDoc(doc, blockId);
  if (!block) return null;
  if (block.node.type !== markdownSchema.nodes.heading) return blockAnchorId(blockId);
  let index = 0;
  doc.nodesBetween(0, block.pos, (node) => {
    if (node.type === markdownSchema.nodes.heading) index++;
    return !node.isTextblock;
  });
  return `heading-${index}`;
}
