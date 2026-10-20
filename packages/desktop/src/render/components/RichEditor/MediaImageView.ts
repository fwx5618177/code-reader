// ================================
// MediaImageView
// 图片语法 ![](地址) 的节点视图：远程地址直接显示 / 播放；本地文件名经知识库解析为附件后读取文件加载，
// 视频与音频的播放器操作交给播放器本身（不被编辑器当作选中节点处理）
// ================================

import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';
import {
  EMBED_MEDIA_MIME_ATTR,
  EMBED_MEDIA_PATH_ATTR,
  MEDIA_SRC_ATTR,
  localMediaTarget,
  type EmbedResolver,
} from '../../lib/markdown';
import { hydrateMediaElement } from '../ReadingWorkspace/embed-media';
import { isMediaControlEvent } from './WikiEmbedView';

class MediaImageView implements NodeView {
  /** 固定的外层元素（ProseMirror 记录的 DOM），重新解析时只替换内部 */
  readonly dom: HTMLElement;
  private local = false;
  private dispose: (() => void) | null = null;

  constructor(
    private node: PMNode,
    private readonly getResolver: () => EmbedResolver | undefined,
    private readonly registry: Set<MediaImageView>
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'markdown-media-node';
    this.dom.contentEditable = 'false';
    this.dom.appendChild(this.render());
    registry.add(this);
  }

  /** 按 Schema 的 toDOM 生成元素；本地媒体解析为附件后加载，找不到时显示提示 */
  private render(): HTMLElement {
    this.dispose?.();
    this.dispose = null;
    const { dom } = DOMSerializer.renderSpec(document, this.node.type.spec.toDOM!(this.node));
    const element = dom as HTMLElement;
    const localSrc = element.hasAttribute('src') ? null : element.getAttribute(MEDIA_SRC_ATTR);
    this.local = localSrc !== null;
    if (localSrc === null) return element;

    const target = localMediaTarget(localSrc);
    const source = target ? this.getResolver()?.(target) : null;
    if (source?.kind !== 'media') {
      const notice = document.createElement('span');
      notice.className = 'wiki-embed-missing';
      notice.textContent = `未找到附件「${target}」`;
      return notice;
    }
    element.setAttribute(EMBED_MEDIA_PATH_ATTR, source.filePath);
    if (source.mimeType) element.setAttribute(EMBED_MEDIA_MIME_ATTR, source.mimeType);
    this.dispose = hydrateMediaElement(element);
    return element;
  }

  /** 知识库条目变化后重新解析本地媒体 */
  refresh(): void {
    if (this.local) this.dom.replaceChildren(this.render());
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || node.attrs.src !== this.node.attrs.src) return false;
    this.node = node;
    return true;
  }

  stopEvent(event: Event): boolean {
    return isMediaControlEvent(event);
  }

  /** 加载媒体时写入 src 等属性，不是文档内容的变化 */
  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.registry.delete(this);
    this.dispose?.();
  }
}

/**
 * 图片 / 媒体节点视图工厂；refresh 在链接解析变化（条目列表更新）时重新解析本地媒体
 */
export function createMediaImageView(getResolver: () => EmbedResolver | undefined) {
  const views = new Set<MediaImageView>();
  return {
    nodeView: (node: PMNode) => new MediaImageView(node, getResolver, views),
    refresh: () => views.forEach((view) => view.refresh()),
  };
}
