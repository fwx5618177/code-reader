// ================================
// 媒体嵌入的加载：![[图片 / 视频 / 音频]] 与 ![](本地文件)
// 渲染结果中只记录文件路径，这里经主进程读取文件后填入 Blob URL，卸载时释放
// ================================

import { useEffect, type RefObject } from 'react';
import { EMBED_MEDIA_MIME_ATTR, EMBED_MEDIA_PATH_ATTR } from '../../lib/markdown';
import { readBinaryFile } from './system';

/** 读取失败时的提示文字 */
function failureText(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const noun = tag === 'video' ? '视频' : tag === 'audio' ? '音频' : '图片';
  return `无法读取${noun}，文件可能已被移动或删除`;
}

/**
 * 加载单个媒体元素；返回清理函数（释放 Blob URL，并忽略尚未完成的读取）
 */
export function hydrateMediaElement(element: HTMLElement): () => void {
  const filePath = element.getAttribute(EMBED_MEDIA_PATH_ATTR);
  if (!filePath) return () => {};
  let disposed = false;
  let url: string | null = null;
  readBinaryFile(filePath)
    .then((data) => {
      if (disposed) return;
      url = URL.createObjectURL(new Blob([data], { type: element.getAttribute(EMBED_MEDIA_MIME_ATTR) ?? '' }));
      element.setAttribute('src', url);
    })
    .catch((error) => {
      if (disposed) return;
      console.error('[Embed] 读取媒体文件失败:', error);
      const notice = document.createElement('div');
      notice.className = 'wiki-embed-missing';
      notice.textContent = failureText(element);
      element.replaceWith(notice);
    });
  return () => {
    disposed = true;
    if (url) URL.revokeObjectURL(url);
  };
}

/**
 * 加载容器内全部媒体嵌入；返回清理函数
 */
export function hydrateEmbedMedia(root: HTMLElement): () => void {
  const disposers = [...root.querySelectorAll<HTMLElement>(`[${EMBED_MEDIA_PATH_ATTR}]`)].map(hydrateMediaElement);
  return () => disposers.forEach((dispose) => dispose());
}

/**
 * 以 HTML 字符串渲染的容器：内容变化后加载其中的媒体嵌入
 */
export function useEmbedMedia(ref: RefObject<HTMLElement>, html: string | null): void {
  useEffect(() => {
    if (!ref.current || !html) return;
    return hydrateEmbedMedia(ref.current);
  }, [ref, html]);
}
