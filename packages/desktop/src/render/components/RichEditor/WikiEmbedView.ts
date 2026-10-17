// ================================
// WikiEmbedView
// 块级嵌入 ![[笔记#标题]] 的节点视图：只读渲染被引用的笔记/章节或图片，
// 点击嵌入的标题打开原文（由编辑器的链接点击插件处理），点击正文选中整个嵌入
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView as PMEditorView, NodeView } from 'prosemirror-view';
import { renderWikiEmbed, type EmbedHost, type WikiLinkParts } from '../../lib/markdown';
import { hydrateEmbedImages } from '../ReadingWorkspace/embed-images';

/** 嵌入渲染所需的上下文（每次渲染时读取最新值） */
export type EmbedHostProvider = (view: PMEditorView) => EmbedHost;

class WikiEmbedView implements NodeView {
  readonly dom: HTMLElement;
  private node: PMNode;
  /** 上次渲染的 HTML：结果不变时保留现有 DOM，图片不会重新加载 */
  private html = '';
  private disposeImages: (() => void) | null = null;

  constructor(
    node: PMNode,
    private readonly view: PMEditorView,
    private readonly getHost: EmbedHostProvider,
    private readonly registry: Set<WikiEmbedView>
  ) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'wiki-embed-node';
    this.dom.contentEditable = 'false';
    registry.add(this);
    this.render();
  }

  render(): void {
    const element = renderWikiEmbed(this.node.attrs as WikiLinkParts, this.getHost(this.view));
    const html = element.outerHTML;
    if (html === this.html) return;
    this.html = html;
    this.disposeImages?.();
    this.dom.replaceChildren(element);
    this.disposeImages = hydrateEmbedImages(element);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = !node.sameMarkup(this.node);
    this.node = node;
    if (changed) this.render();
    return true;
  }

  destroy(): void {
    this.registry.delete(this);
    this.disposeImages?.();
  }
}

/**
 * 嵌入节点视图工厂
 * refresh：链接目标的内容可能已变化（条目列表更新）时重新渲染全部嵌入
 */
export function createWikiEmbedView(getHost: EmbedHostProvider) {
  const views = new Set<WikiEmbedView>();
  return {
    nodeView: (node: PMNode, view: PMEditorView) => new WikiEmbedView(node, view, getHost, views),
    refresh: () => views.forEach((view) => view.render()),
  };
}
