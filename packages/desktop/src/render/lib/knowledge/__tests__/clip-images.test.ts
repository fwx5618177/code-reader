// ================================
// 剪藏图片本地化测试：远程图片改写为图片条目嵌入、下载失败保留原图、
// 只处理能放置块级嵌入的段落图片（IPC 以 mock 代替）
// ================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBED_MEDIA_PATH_ATTR, renderContentToHtml } from '../../markdown';
import { localizeClipImages } from '../clip-images';

const DIR = '/data/attachments';

type DownloadResult =
  | { url: string; filePath: string; mimeType: string; size: number }
  | { url: string; error: string };

/** 模拟主进程下载：地址包含 fail 的图片失败，其余保存为 png */
function stubDownload() {
  const downloadImages = vi.fn(
    async (urls: string[], directory: string): Promise<DownloadResult[]> =>
      urls.map((url, index) =>
        url.includes('fail')
          ? { url, error: '服务器返回 404' }
          : { url, filePath: `${directory}/x-${index}-pic.png`, mimeType: 'image/png', size: 100 + index }
      )
  );
  vi.stubGlobal('electron', { web: { downloadImages } });
  return downloadImages;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('localizeClipImages', () => {
  it('远程图片改写为图片条目的块级嵌入，替代文本作为别名', async () => {
    const download = stubDownload();
    const markdown = '第一段\n\n![插图 [1]](https://example.com/a.png)\n\n第二段';

    const result = await localizeClipImages(markdown, '示例: 文章|标题', DIR);

    expect(download).toHaveBeenCalledWith(['https://example.com/a.png'], DIR);
    expect(result.failed).toBe(0);
    expect(result.images).toHaveLength(1);
    const [image] = result.images;
    expect(image).toMatchObject({
      url: 'https://example.com/a.png',
      filePath: `${DIR}/x-0-pic.png`,
      mimeType: 'image/png',
      size: 100,
    });
    expect(image.title).toMatch(/^示例 文章 标题-图1-[0-9a-z]+\.png$/);
    expect(result.markdown).toBe(`第一段\n\n![[${image.title}|插图 1]]\n\n第二段`);
  });

  it('改写后的正文渲染为读取本地文件的嵌入图片', async () => {
    stubDownload();
    const result = await localizeClipImages('![插图](https://example.com/a.png)', '文章', DIR);
    const [image] = result.images;

    const { html } = renderContentToHtml(result.markdown, 'markdown', {
      resolveEmbed: (target) =>
        target === image.title
          ? { kind: 'media', media: 'image', title: image.title, filePath: image.filePath, mimeType: image.mimeType }
          : null,
    });
    const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');

    expect(img?.getAttribute(EMBED_MEDIA_PATH_ATTR)).toBe(image.filePath);
    expect(img?.getAttribute('alt')).toBe('插图');
    expect(html).not.toContain('https://example.com/a.png');
  });

  it('下载失败的图片保留远程地址并计数', async () => {
    stubDownload();
    const markdown = '![](https://example.com/fail.png)\n\n![好图](https://example.com/ok.png)';

    const result = await localizeClipImages(markdown, '文章', DIR);

    expect(result.failed).toBe(1);
    expect(result.images.map((image) => image.url)).toEqual(['https://example.com/ok.png']);
    expect(result.markdown).toBe(
      `![](https://example.com/fail.png)\n\n![[${result.images[0].title}|好图]]`
    );
  });

  it('全部失败时返回原正文', async () => {
    stubDownload();
    const markdown = '文字 ![](https://example.com/fail-1.png)';

    const result = await localizeClipImages(markdown, '文章', DIR);

    expect(result).toEqual({ markdown, images: [], failed: 1 });
  });

  it('IPC 调用失败时所有图片计为失败，正文不变', async () => {
    const downloadImages = vi.fn().mockRejectedValue(new Error('保存目录无效'));
    vi.stubGlobal('electron', { web: { downloadImages } });
    const markdown = '![](https://example.com/a.png)\n\n![](https://example.com/b.png)';

    const result = await localizeClipImages(markdown, '文章', DIR);

    expect(result).toEqual({ markdown, images: [], failed: 2 });
  });

  it('同一地址只下载一次，所有引用都改写', async () => {
    const download = stubDownload();
    const markdown = '![](https://example.com/a.png)\n\n中间\n\n![再次](https://example.com/a.png)';

    const result = await localizeClipImages(markdown, '文章', DIR);

    expect(download).toHaveBeenCalledWith(['https://example.com/a.png'], DIR);
    expect(result.images).toHaveLength(1);
    const { title } = result.images[0];
    expect(result.markdown).toBe(`![[${title}]]\n\n中间\n\n![[${title}|再次]]`);
  });

  it('段落中的图片把段落拆分为前后两段', async () => {
    stubDownload();
    const markdown = '前面的文字 ![图](https://example.com/a.png) 后面的文字';

    const result = await localizeClipImages(markdown, '文章', DIR);

    expect(result.markdown).toBe(`前面的文字\n\n![[${result.images[0].title}|图]]\n\n后面的文字`);
  });

  it('标题、表格与列表项首段中的图片无法放置嵌入，保留远程地址且不下载', async () => {
    const download = stubDownload();
    const markdown = [
      '# 标题 ![](https://example.com/h.png)',
      '',
      '| 列 |',
      '| --- |',
      '| ![](https://example.com/t.png) |',
      '',
      '- ![](https://example.com/l.png)',
    ].join('\n');

    const result = await localizeClipImages(markdown, '文章', DIR);

    expect(download).not.toHaveBeenCalled();
    expect(result).toEqual({ markdown, images: [], failed: 0 });
  });

  it('列表项后续段落中的图片可以改写', async () => {
    stubDownload();
    const markdown = '- 说明\n\n  ![](https://example.com/a.png)';

    const result = await localizeClipImages(markdown, '文章', DIR);

    expect(result.markdown).toBe(`- 说明\n\n  ![[${result.images[0].title}]]`);
  });

  it('没有远程图片时不调用下载', async () => {
    const download = stubDownload();
    const markdown = '正文 ![本地](data:image/png;base64,AAAA)';

    const result = await localizeClipImages(markdown, '文章', DIR);

    expect(download).not.toHaveBeenCalled();
    expect(result).toEqual({ markdown, images: [], failed: 0 });
  });
});
