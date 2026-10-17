// ================================
// 剪藏图片本地化
// 网页剪藏的正文图片经主进程下载到附件目录，每张图片保存为一个图片条目，
// 正文中的远程图片改写为 ![[图片条目标题|替代文本]] 块级嵌入——
// 这是阅读视图、详情面板与写作编辑器共同支持的本地图片引用方式
// （渲染进程 CSP 不允许 file: 图片，图片文件经 read-binary-file 读取后以 Blob URL 显示）。
//
// 只处理段落中的图片：段落在图片处拆分，图片成为独立的嵌入块；
// 标题、表格单元格等只能容纳行内内容的位置无法放置块级嵌入，图片保留远程地址且不下载。
// 下载失败的图片同样保留远程地址。
// ================================

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { markdownSchema, parseMarkdown, serializeMarkdown } from '../markdown';

/** 已保存到本地的剪藏图片 */
export interface ClipImage {
  /** 原始远程地址 */
  url: string;
  /** 图片条目标题（嵌入目标） */
  title: string;
  filePath: string;
  mimeType: string;
  size: number;
}

export interface LocalizedClip {
  markdown: string;
  /** 已下载、需要创建为图片条目的图片 */
  images: ClipImage[];
  /** 下载失败的图片数（按不同地址计） */
  failed: number;
}

/** 远程图片地址 → 本地图片条目标题；null 表示保留远程图片 */
type ImageTarget = (src: string) => string | null;

const { paragraph, image, hard_break: hardBreak, wiki_embed: wikiEmbed } = markdownSchema.nodes;

/** 图片条目标题中保留的剪藏标题长度 */
const TITLE_BASE_LENGTH = 40;

function remoteImageSrc(node: PMNode): string | null {
  const src = node.type === image ? (node.attrs.src as string | null) : null;
  return src && /^https?:\/\//i.test(src) ? src : null;
}

/** 可以去掉的空白行内节点：换行与纯空白文本 */
function isBlankInline(node: PMNode): boolean {
  return node.type === hardBreak || (node.isText && !node.text?.trim());
}

/** 嵌入别名不能包含 [ ] | 与换行 */
function embedAlias(alt: unknown): string | null {
  return typeof alt === 'string' ? alt.replace(/[[\]|\s]+/g, ' ').trim() || null : null;
}

/** 去掉文本节点一端的空白（保留标记） */
function trimText(node: PMNode, side: 'start' | 'end'): PMNode {
  if (!node.isText || !node.text) return node;
  const text = side === 'start' ? node.text.trimStart() : node.text.trimEnd();
  return text === node.text ? node : markdownSchema.text(text, node.marks);
}

/**
 * 段落在可本地化的图片处拆分为「段落 / 嵌入 / 段落」；没有可本地化的图片时返回 null
 */
function splitParagraph(node: PMNode, target: ImageTarget, used: Set<string>): PMNode[] | null {
  const parts: PMNode[] = [];
  const srcs: string[] = [];
  let run: PMNode[] = [];
  const flushRun = () => {
    let start = 0;
    let end = run.length;
    while (start < end && isBlankInline(run[start])) start++;
    while (end > start && isBlankInline(run[end - 1])) end--;
    if (end > start) {
      // 拆分处的空白不再有意义：拆出的段落首尾不留空格
      const content = run.slice(start, end);
      content[0] = trimText(content[0], 'start');
      content[content.length - 1] = trimText(content[content.length - 1], 'end');
      parts.push(paragraph.create(node.attrs, content));
    }
    run = [];
  };

  node.forEach((child) => {
    const src = remoteImageSrc(child);
    const title = src ? target(src) : null;
    if (!src || title === null) {
      run.push(child);
      return;
    }
    flushRun();
    srcs.push(src);
    parts.push(wikiEmbed.create({ target: title, heading: null, alias: embedAlias(child.attrs.alt) }));
  });
  if (srcs.length === 0) return null;
  flushRun();
  srcs.forEach((src) => used.add(src));
  return parts;
}

/** 递归改写块级容器；拆分结果不符合容器内容规则时（如列表项必须以段落开头）保持原段落 */
function localizeBlock(node: PMNode, target: ImageTarget, used: Set<string>): PMNode {
  let changed = false;
  const children: PMNode[] = [];
  node.forEach((child, _offset, index) => {
    if (child.type === paragraph) {
      const pending = new Set<string>();
      const parts = splitParagraph(child, target, pending);
      if (parts && node.canReplace(index, index + 1, Fragment.from(parts))) {
        pending.forEach((src) => used.add(src));
        children.push(...parts);
        changed = true;
        return;
      }
    } else if (!child.isTextblock && !child.isLeaf) {
      const next = localizeBlock(child, target, used);
      changed ||= next !== child;
      children.push(next);
      return;
    }
    children.push(child);
  });
  return changed ? node.copy(Fragment.from(children)) : node;
}

/**
 * 按 target 改写文档中的段落图片，返回新文档与实际改写的图片地址
 */
function localizeDocument(doc: PMNode, target: ImageTarget): { doc: PMNode; used: Set<string> } {
  const used = new Set<string>();
  return { doc: localizeBlock(doc, target, used), used };
}

/** 图片条目标题的前缀：剪藏标题去掉链接语法与文件名不允许的字符 */
function titleBase(clipTitle: string): string {
  const base = clipTitle
    .replace(/[[\]|#^\\/:*?"<>\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_BASE_LENGTH)
    .trim();
  return base || '网页图片';
}

function extensionOf(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/**
 * 下载剪藏正文中的图片到 directory，并把正文中的远程图片改写为本地图片条目的嵌入。
 * 下载全部失败（包括 IPC 调用失败）时返回原正文。
 */
export async function localizeClipImages(
  markdown: string,
  clipTitle: string,
  directory: string
): Promise<LocalizedClip> {
  const doc = parseMarkdown(markdown);
  const candidates = [...localizeDocument(doc, () => '').used];
  if (candidates.length === 0) return { markdown, images: [], failed: 0 };

  let results: Awaited<ReturnType<typeof window.electron.web.downloadImages>>;
  try {
    results = await window.electron.web.downloadImages(candidates, directory);
  } catch (error) {
    console.error('[Knowledge] 下载剪藏图片失败:', error);
    return { markdown, images: [], failed: candidates.length };
  }

  const base = titleBase(clipTitle);
  const stamp = Date.now().toString(36);
  const bySrc = new Map<string, ClipImage>();
  let failed = 0;
  results.forEach((result, index) => {
    if ('error' in result) {
      console.warn(`[Knowledge] 剪藏图片下载失败 ${result.url}:`, result.error);
      failed++;
      return;
    }
    const title = `${base}-图${bySrc.size + 1}-${stamp}${extensionOf(result.filePath)}`;
    bySrc.set(candidates[index], { ...result, url: candidates[index], title });
  });
  if (bySrc.size === 0) return { markdown, images: [], failed };

  const localized = localizeDocument(doc, (src) => bySrc.get(src)?.title ?? null);
  return {
    markdown: serializeMarkdown(localized.doc).trim(),
    images: [...bySrc.values()],
    failed,
  };
}
