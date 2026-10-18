// ================================
// 编辑器中的 ![](媒体)：本地文件经知识库解析并加载，找不到时提示，播放器操作不被编辑器拦截
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownSchema, type EmbedResolver } from '../../../lib/markdown';
import { createMediaImageView } from '../MediaImageView';

vi.mock('../../ReadingWorkspace/system', () => ({
  readBinaryFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

const image = (src: string, alt: string | null = null) => markdownSchema.nodes.image.create({ src, alt });

describe('MediaImageView', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:media'), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('本地视频经知识库解析后读取文件，以 Blob URL 播放', async () => {
    const resolver: EmbedResolver = (target) =>
      target === 'clip.mp4' ? { kind: 'media', media: 'video', title: 'clip.mp4', filePath: '/kb/clip.mp4', mimeType: 'video/mp4' } : null;
    const view = createMediaImageView(() => resolver).nodeView(image('media/clip.mp4', '演示'));
    const video = view.dom.querySelector('video')!;
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('data-embed-path')).toBe('/kb/clip.mp4');
    await vi.waitFor(() => expect(video.getAttribute('src')).toBe('blob:media'));
    view.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media');
  });

  it('远程地址直接加载；找不到的本地附件显示提示，条目更新后重新解析', () => {
    let resolver: EmbedResolver = () => null;
    const factory = createMediaImageView(() => resolver);
    expect(factory.nodeView(image('https://example.com/a.webm')).dom.querySelector('video')!.getAttribute('src')).toBe(
      'https://example.com/a.webm'
    );

    const view = factory.nodeView(image('talk.mp3'));
    expect(view.dom.textContent).toBe('未找到附件「talk.mp3」');
    resolver = () => ({ kind: 'media', media: 'audio', title: 'talk.mp3', filePath: '/kb/talk.mp3' });
    factory.refresh();
    expect(view.dom.querySelector('audio')!.getAttribute('data-embed-path')).toBe('/kb/talk.mp3');
  });

  it('播放器上的事件交给播放器，其余事件仍由编辑器处理', () => {
    const view = createMediaImageView(() => undefined).nodeView(image('https://example.com/a.mp4'));
    const video = view.dom.querySelector('video')!;
    const onVideo = new MouseEvent('mousedown');
    Object.defineProperty(onVideo, 'target', { value: video });
    const onWrapper = new MouseEvent('mousedown');
    Object.defineProperty(onWrapper, 'target', { value: view.dom });
    expect(view.stopEvent(onVideo)).toBe(true);
    expect(view.stopEvent(onWrapper)).toBe(false);
  });
});
