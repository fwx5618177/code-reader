// ================================
// Markdown 中的媒体：按文件扩展名区分图片 / 视频 / 音频
// ![](clip.mp4)、![[clip.mp4]] 渲染为播放器；本地文件名经知识库解析为附件，远程地址直接播放
// ================================

export type MediaKind = 'image' | 'video' | 'audio';

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac']);

/** 地址或文件名的扩展名（忽略查询串与锚点） */
function extensionOf(src: string): string {
  const path = src.split(/[?#]/)[0] ?? '';
  const dot = path.lastIndexOf('.');
  return dot === -1 || dot < path.lastIndexOf('/') ? '' : path.slice(dot + 1).toLowerCase();
}

/** 按扩展名判断媒体类型；无法判断时按图片处理（与 Markdown 图片语法一致） */
export function mediaKindOfPath(src: string): MediaKind {
  const extension = extensionOf(src);
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return 'image';
}

/** 尚未解析的本地媒体地址（![](本地文件)）；渲染层经知识库解析后填入文件路径并加载 */
export const MEDIA_SRC_ATTR = 'data-media-src';

/** 可以直接加载的地址（远程、data:、blob:）；其余视为本地文件名，需经知识库解析 */
export function isDirectMediaUrl(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src.trim());
}

/**
 * 本地媒体地址 → 知识库链接目标：解码 URL 转义、去掉目录部分（附件以文件名为标题）
 */
export function localMediaTarget(src: string): string {
  let path = src.trim();
  try {
    path = decodeURI(path);
  } catch {
    // 保留原样
  }
  return path.split(/[\\/]/).pop() ?? path;
}
