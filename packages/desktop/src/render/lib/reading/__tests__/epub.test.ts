// ================================
// EPUB 解析测试：container → OPF → 书脊、导航文档 / NCX 目录、全文提取、章节净化渲染
// ================================

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bookProgress,
  chapterPosition,
  EPUB_TARGET_ATTR,
  EpubRenderer,
  extractEpubText,
  openEpub,
  parseContainer,
  parseNcx,
  parseOpf,
  resolveEpubPath,
} from '../epub';
import { buildEpub, CONTAINER, NCX, OPF } from './epub-fixture';

describe('resolveEpubPath', () => {
  it('按基准文件解析相对路径并解码，保留片段', () => {
    expect(resolveEpubPath('OEBPS/text/a.xhtml', '../images/b.png')).toBe('OEBPS/images/b.png');
    expect(resolveEpubPath('OEBPS/content.opf', 'text/chapter%201.xhtml')).toBe('OEBPS/text/chapter 1.xhtml');
    expect(resolveEpubPath('OEBPS/text/a.xhtml', '#note')).toBe('OEBPS/text/a.xhtml#note');
    expect(resolveEpubPath('OEBPS/text/a.xhtml', './b.xhtml#x')).toBe('OEBPS/text/b.xhtml#x');
    expect(resolveEpubPath('content.opf', 'a.xhtml')).toBe('a.xhtml');
  });
});

describe('container 与 OPF', () => {
  it('解析 OPF 路径，缺失时报错', () => {
    expect(parseContainer(CONTAINER)).toBe('OEBPS/content.opf');
    expect(() => parseContainer('<container/>')).toThrow();
  });

  it('解析标题、清单与书脊顺序（只保留 XHTML 章节）', () => {
    const pkg = parseOpf(OPF, 'OEBPS/content.opf');
    expect(pkg.title).toBe('测试之书');
    expect(pkg.spine).toEqual(['OEBPS/text/ch2.xhtml', 'OEBPS/text/chapter 1.xhtml']);
    expect(pkg.navPath).toBe('OEBPS/nav.xhtml');
    expect(pkg.ncxPath).toBe('OEBPS/toc.ncx');
    expect(pkg.manifest.get('OEBPS/images/pic.png')?.mediaType).toBe('image/png');
  });

  it('解析 NCX 目录层级', () => {
    expect(parseNcx(NCX, 'OEBPS/toc.ncx')).toEqual([
      { label: '开篇', target: 'OEBPS/text/ch2.xhtml', depth: 0 },
      { label: '细节', target: 'OEBPS/text/ch2.xhtml#sec', depth: 1 },
    ]);
  });
});

describe('openEpub', () => {
  it('优先使用导航文档中的 toc 目录', async () => {
    const book = await openEpub(await buildEpub());
    expect(book.toc).toEqual([
      { label: '第二章', target: 'OEBPS/text/ch2.xhtml', depth: 0 },
      { label: '小节', target: 'OEBPS/text/ch2.xhtml#sec', depth: 1 },
      { label: '第一章', target: 'OEBPS/text/chapter 1.xhtml', depth: 0 },
    ]);
  });

  it('缺少 container.xml 时报错', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'x');
    await expect(openEpub(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('container.xml');
  });

  it('按书脊顺序提取全书文本，不含脚本与样式', async () => {
    const { title, text } = await extractEpubText(await buildEpub());
    expect(title).toBe('测试之书');
    expect(text.indexOf('第二章')).toBeLessThan(text.indexOf('第一章'));
    expect(text).toContain('正文强调内容。');
    expect(text).toContain('甲\n乙');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color');
  });
});

describe('EpubRenderer', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:pic');
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

  beforeEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = original.createObjectURL;
    URL.revokeObjectURL = original.revokeObjectURL;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it('净化章节：去除脚本、事件与样式，图片转为 Blob URL，改写链接', async () => {
    const renderer = new EpubRenderer(await openEpub(await buildEpub()));
    expect(renderer.chapterCount).toBe(2);
    expect(renderer.chapterIndexOf('OEBPS/text/chapter 1.xhtml#start')).toBe(1);

    const container = document.createElement('div');
    container.innerHTML = await renderer.renderChapter(0);

    expect(container.querySelector('script, style, iframe, svg')).toBeNull();
    const heading = container.querySelector('h1');
    expect(heading?.id).toBe('epub-top');
    expect(heading?.hasAttribute('onclick')).toBe(false);
    expect(heading?.hasAttribute('style')).toBe(false);
    expect(heading?.hasAttribute('class')).toBe(false);

    const images = Array.from(container.querySelectorAll('img'));
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['blob:pic', 'blob:pic']);
    expect(images[0].getAttribute('alt')).toBe('插图');
    expect(images[0].hasAttribute('onerror')).toBe(false);
    // 同一图片只读取一次
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    const links = Array.from(container.querySelectorAll('a'));
    expect(links[0].getAttribute(EPUB_TARGET_ATTR)).toBe('OEBPS/text/chapter 1.xhtml#start');
    expect(links[1].getAttribute('href')).toBe('https://example.com/');
    expect(links).toHaveLength(2);
    expect(container.textContent).toContain('恶意');

    renderer.dispose();
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:pic'));
  });

  it('不合规 XHTML 回退为 HTML 解析', async () => {
    const renderer = new EpubRenderer(await openEpub(await buildEpub()));
    const html = await renderer.renderChapter(1);
    expect(html).toContain('id="epub-start"');
    expect(html).toContain('第一章&nbsp;开始');
  });
});

describe('阅读进度换算', () => {
  it('章节序号与章节内比例 ⇄ 整本书进度', () => {
    expect(bookProgress(0, 4, 0)).toBe(0);
    expect(bookProgress(1, 4, 0.5)).toBe(0.375);
    expect(bookProgress(3, 4, 1)).toBe(1);
    expect(chapterPosition(0.375, 4)).toEqual({ chapterIndex: 1, ratio: 0.5 });
    expect(chapterPosition(1, 4)).toEqual({ chapterIndex: 3, ratio: 1 });
    expect(chapterPosition(0.5, 0)).toEqual({ chapterIndex: 0, ratio: 0 });
  });
});
