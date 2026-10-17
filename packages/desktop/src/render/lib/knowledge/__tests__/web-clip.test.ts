// ================================
// 网页剪藏测试：网址规范化、Readability 正文提取与 Markdown 转换
// ================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipWebPage, extractArticle, isSingleWebUrl, normalizeWebUrl } from '../web-clip';

const PARAGRAPH =
  '这是一段足够长的正文内容，用于让正文提取算法识别出文章主体。'.repeat(6) +
  'Readability scores paragraphs by length and punctuation, so the text needs some substance, too.';

const PAGE = `<!DOCTYPE html>
<html>
<head>
  <title>示例文章 - 示例站点</title>
  <meta property="og:site_name" content="示例站点">
  <meta property="og:title" content="示例文章">
  <meta name="description" content="一篇用于测试的文章">
  <script>window.evil = true</script>
</head>
<body>
  <nav><a href="/">首页</a> <a href="/about">关于</a></nav>
  <article>
    <h1>示例文章</h1>
    <p>${PARAGRAPH}</p>
    <h2>小标题</h2>
    <p>${PARAGRAPH} 这里有<em>强调</em>与<strong>加粗</strong>，以及<a href="next">相对链接</a>。</p>
    <p><img src="img/pic.png" alt="插图"></p>
    <ul><li>第一项</li><li>第二项</li></ul>
    <p>${PARAGRAPH}</p>
  </article>
  <footer>版权所有</footer>
</body>
</html>`;

describe('normalizeWebUrl', () => {
  it('补全协议，只接受 http / https', () => {
    expect(normalizeWebUrl('  example.com/a ')).toBe('https://example.com/a');
    expect(normalizeWebUrl('http://example.com')).toBe('http://example.com/');
    expect(() => normalizeWebUrl('ftp://example.com')).toThrow('http');
    expect(() => normalizeWebUrl('file:///etc/passwd')).toThrow();
    expect(() => normalizeWebUrl('not a url')).toThrow();
  });

  it('识别单个网址', () => {
    expect(isSingleWebUrl(' https://example.com/a?b=1 ')).toBe(true);
    expect(isSingleWebUrl('看看 https://example.com')).toBe(false);
    expect(isSingleWebUrl('example.com')).toBe(false);
  });
});

describe('extractArticle', () => {
  it('提取标题、摘要与站点名，正文转换为 Markdown 并解析相对地址', () => {
    const clip = extractArticle(PAGE, 'https://example.com/posts/1');
    expect(clip.title).toBe('示例文章');
    expect(clip.siteName).toBe('示例站点');
    expect(clip.excerpt).toBe('一篇用于测试的文章');
    expect(clip.url).toBe('https://example.com/posts/1');

    expect(clip.markdown).toContain('## 小标题');
    expect(clip.markdown).toMatch(/[*_]强调[*_]/);
    expect(clip.markdown).toContain('**加粗**');
    expect(clip.markdown).toContain('[相对链接](https://example.com/posts/next)');
    expect(clip.markdown).toContain('![插图](https://example.com/posts/img/pic.png)');
    expect(clip.markdown).toMatch(/[-*] 第一项/);
    expect(clip.markdown).not.toContain('window.evil');
    expect(clip.markdown).not.toContain('版权所有');
  });

  it('没有可识别的正文时报错', () => {
    expect(() => extractArticle('<html><body></body></html>', 'https://example.com/')).toThrow('正文');
  });
});

describe('clipWebPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('经主进程抓取并以重定向后的地址解析', async () => {
    const fetchHtml = vi.fn().mockResolvedValue({ url: 'https://example.com/final/', html: PAGE });
    vi.stubGlobal('electron', { web: { fetchHtml } });

    const clip = await clipWebPage('https://example.com/short');
    expect(fetchHtml).toHaveBeenCalledWith('https://example.com/short');
    expect(clip.url).toBe('https://example.com/final/');
    expect(clip.markdown).toContain('https://example.com/final/next');
  });
});
