// ================================
// 录音时长：条目 metadata 中没有记录时长时（导入的音频、旧录音），列表行可见时读取音频元数据获得，
// 按文件路径缓存，滚动回来或重新打开面板时不再重复读取文件
// ================================

import { useEffect, useState } from 'react';
import { useBlobUrl } from '../ReadingWorkspace/hooks';

const durationCache = new Map<string, number | null>();

/**
 * 读取音频时长（秒）；无法解析时为 null。
 * MediaRecorder 录制的 WebM 没有写入时长，元数据中为 Infinity：
 * 跳到末尾促使浏览器扫描整个文件后再读取
 */
function probeDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const finish = (value: number | null) => {
      audio.onloadedmetadata = null;
      audio.ontimeupdate = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      resolve(value);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) {
        finish(audio.duration);
        return;
      }
      audio.ontimeupdate = () => finish(Number.isFinite(audio.duration) ? audio.duration : null);
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    };
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

/** 录音时长；读取中或读取失败时为 null */
export function useAudioDuration(filePath: string | undefined, mimeType: string | undefined): number | null {
  const cached = filePath ? durationCache.get(filePath) : null;
  const [duration, setDuration] = useState<number | null>(cached ?? null);
  const known = !filePath || durationCache.has(filePath);
  const { url } = useBlobUrl(known ? undefined : filePath, mimeType);

  useEffect(() => {
    if (!url || !filePath) return;
    let cancelled = false;
    void probeDuration(url).then((value) => {
      durationCache.set(filePath, value);
      if (!cancelled) setDuration(value);
    });
    return () => {
      cancelled = true;
    };
  }, [url, filePath]);

  return known ? (cached ?? null) : duration;
}
