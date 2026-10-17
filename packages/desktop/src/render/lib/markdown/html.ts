// ================================
// Markdown → HTML（预览与阅读模式）
// 与编辑器共用解析器和 Schema，保证所见即所得
// ================================

import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { renderMath } from '../math';
import { parseContent, type ContentFormat } from './parser';
import { markdownSchema } from './schema';

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

/**
 * 将文档节点渲染为 HTML 容器
 * - 数学公式节点替换为自研渲染器的输出
 * - 标题添加锚点 id，供目录跳转
 */
export function renderDocToElement(doc: PMNode): { element: HTMLElement; headings: RenderedHeading[] } {
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

  const headings: RenderedHeading[] = [];
  container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((el, index) => {
    const id = `heading-${index}`;
    el.id = id;
    headings.push({ id, level: Number(el.tagName.slice(1)), text: el.textContent || '' });
  });

  return { element: container, headings };
}

/**
 * 将存储内容渲染为 HTML
 */
export function renderContentToHtml(content: string, format: ContentFormat): RenderedDocument {
  const { element, headings } = renderDocToElement(parseContent(content, format));
  return { html: element.innerHTML, headings };
}
