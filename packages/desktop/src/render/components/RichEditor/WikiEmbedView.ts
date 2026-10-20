// ================================
// WikiEmbedView
// 块级嵌入 ![[笔记#标题]] 的节点视图：只读渲染被引用的笔记/章节，或显示图片、播放视频与音频，
// 点击嵌入的标题打开原文（由编辑器的链接点击插件处理），点击正文选中整个嵌入；
// 播放器上的操作交给播放器本身
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView as PMEditorView, NodeView } from 'prosemirror-view';
import { renderWikiEmbed, type EmbedHost, type WikiLinkParts } from '../../lib/markdown';
import { hydrateEmbedMedia } from '../ReadingWorkspace/embed-media';

/** 嵌入渲染所需的上下文（每次渲染时读取最新值） */
export type EmbedHostProvider = (view: PMEditorView) => EmbedHost;

/** 事件发生在音视频播放器上（播放、拖动进度、音量） */
export function isMediaControlEvent(event: Event): boolean {
  return event.target instanceof Element && event.target.closest('video, audio') !== null;
}

class WikiEmbedView implements NodeView {
  readonly dom: HTMLElement;
  private node: PMNode;
  /** 上次渲染的 HTML：结果不变时保留现有 DOM，媒体不会重新加载 */
  private html = '';
  private disposeMedia: (() => void) | null = null;

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
    this.disposeMedia?.();
    this.dom.replaceChildren(element);
    this.disposeMedia = hydrateEmbedMedia(element);
  }

  stopEvent(event: Event): boolean {
    return isMediaControlEvent(event);
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
    this.disposeMedia?.();
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
