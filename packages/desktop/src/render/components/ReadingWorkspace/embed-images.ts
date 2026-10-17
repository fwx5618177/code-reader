// ================================
// ![[图片]] 嵌入的加载
// 渲染结果中只记录图片文件路径，这里经主进程读取文件后填入 Blob URL，卸载时释放
// ================================

import { useEffect, type RefObject } from 'react';
import { EMBED_IMAGE_MIME_ATTR, EMBED_IMAGE_PATH_ATTR } from '../../lib/markdown';
import { readBinaryFile } from './system';

/**
 * 加载容器内全部图片嵌入；返回清理函数（释放 Blob URL，并忽略尚未完成的读取）
 */
export function hydrateEmbedImages(root: HTMLElement): () => void {
  const urls: string[] = [];
  let disposed = false;
  root.querySelectorAll<HTMLImageElement>(`img[${EMBED_IMAGE_PATH_ATTR}]`).forEach((image) => {
    const filePath = image.getAttribute(EMBED_IMAGE_PATH_ATTR) ?? '';
    readBinaryFile(filePath)
      .then((data) => {
        if (disposed) return;
        const url = URL.createObjectURL(
          new Blob([data], { type: image.getAttribute(EMBED_IMAGE_MIME_ATTR) ?? '' })
        );
        urls.push(url);
        image.src = url;
      })
      .catch((error) => {
        if (disposed) return;
        console.error('[Embed] 读取图片失败:', error);
        const notice = document.createElement('div');
        notice.className = 'wiki-embed-missing';
        notice.textContent = '无法读取图片，文件可能已被移动或删除';
        image.replaceWith(notice);
      });
  });
  return () => {
    disposed = true;
    urls.forEach((url) => URL.revokeObjectURL(url));
  };
}

/**
 * 以 HTML 字符串渲染的容器：内容变化后加载其中的图片嵌入
 */
export function useEmbedImages(ref: RefObject<HTMLElement>, html: string | null): void {
  useEffect(() => {
    if (!ref.current || !html) return;
    return hydrateEmbedImages(ref.current);
  }, [ref, html]);
}
