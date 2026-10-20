// ================================
// 网页剪藏
// 主进程抓取 HTML → Readability 提取正文 → 转换为知识库使用的 Markdown。
// 远程 HTML 只在 DOMParser 创建的惰性文档中处理，不会执行脚本或加载资源。
// ================================

import { Readability } from '@mozilla/readability';
import { DOMParser as PMDOMParser } from 'prosemirror-model';
import { markdownSchema, serializeMarkdown } from '../markdown';

/** 剪藏结果 */
export interface WebClip {
  /** 最终地址（重定向之后） */
  url: string;
  title: string;
  /** 正文 Markdown */
  markdown: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
}

/**
 * 规范化用户输入的网址：缺少协议时补全 https://，只接受 http / https
 */
export function normalizeWebUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('网址格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http 或 https 网址');
  if (!url.hostname) throw new Error('网址格式不正确');
  return url.href;
}

/**
 * 文本是否是单个 http(s) 网址（用于粘贴时自动切换到网址模式）
 */
export function isSingleWebUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** 设置文档基准地址，使 Readability 能把相对链接与图片地址解析为绝对地址 */
function setDocumentBase(doc: Document, pageUrl: string): void {
  const existing = doc.querySelector('base[href]');
  const href = existing ? new URL(existing.getAttribute('href') ?? '', pageUrl).href : pageUrl;
  const base = existing ?? doc.createElement('base');
  base.setAttribute('href', href);
  if (!existing) doc.head.prepend(base);
}

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

/**
 * 从网页 HTML 中提取正文并转换为 Markdown；无法识别正文时抛出错误
 */
export function extractArticle(html: string, pageUrl: string): WebClip {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  setDocumentBase(doc, pageUrl);
  const documentTitle = optionalText(doc.title);
  const article = new Readability(doc).parse();
  if (!article?.content) throw new Error('未能识别网页正文');

  const body = new DOMParser().parseFromString(article.content, 'text/html').body;
  const markdown = serializeMarkdown(PMDOMParser.fromSchema(markdownSchema).parse(body)).trim();
  if (!markdown) throw new Error('未能识别网页正文');

  return {
    url: pageUrl,
    title: optionalText(article.title) ?? documentTitle ?? new URL(pageUrl).hostname,
    markdown,
    excerpt: optionalText(article.excerpt),
    byline: optionalText(article.byline),
    siteName: optionalText(article.siteName),
  };
}

/**
 * 剪藏网页：经主进程抓取后提取正文
 */
export async function clipWebPage(url: string): Promise<WebClip> {
  const page = await window.electron.web.fetchHtml(url);
  return extractArticle(page.html, page.url);
}
