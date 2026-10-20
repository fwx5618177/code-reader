// ================================
// Markdown 媒体地址：按扩展名区分类型；本地地址解码转义后取文件名
// ================================

import { describe, expect, it } from 'vitest';
import { localMediaTarget, mediaKindOfPath } from '../media';

describe('localMediaTarget', () => {
  it('还原保留字符的转义（%26 %23 %3F）与空格、中文', () => {
    expect(localMediaTarget('a%26b%23c%3Fd.png')).toBe('a&b#c?d.png');
    expect(localMediaTarget('my%20clip.mp4')).toBe('my clip.mp4');
    expect(localMediaTarget('%E5%9B%BE%E7%89%87.png')).toBe('图片.png');
  });

  it('去掉目录部分（正反斜杠），保留文件名', () => {
    expect(localMediaTarget(' assets/sub/clip.mp4 ')).toBe('clip.mp4');
    expect(localMediaTarget('assets\\clip.mp4')).toBe('clip.mp4');
  });

  it('非法转义时按原文处理', () => {
    expect(localMediaTarget('100%.png')).toBe('100%.png');
    expect(localMediaTarget('dir/%E5%9B.png')).toBe('%E5%9B.png');
  });
});

describe('mediaKindOfPath', () => {
  it('按扩展名判断，忽略查询串与锚点，未知时按图片', () => {
    expect(mediaKindOfPath('https://x.com/a.MP4?t=1#x')).toBe('video');
    expect(mediaKindOfPath('song.flac')).toBe('audio');
    expect(mediaKindOfPath('dir.v2/photo')).toBe('image');
  });
});
