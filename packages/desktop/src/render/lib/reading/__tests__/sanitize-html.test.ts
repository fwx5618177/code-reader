// ================================
// HTML 白名单净化测试
// ================================

import { describe, expect, it } from 'vitest';
import { imageSources, isExternalLink, sanitizeHtml, type SanitizeOptions } from '../sanitize-html';

function body(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body;
}

const options: SanitizeOptions = {
  idPrefix: 'p-',
  resolveImage: (src) => (src.startsWith('ok/') ? `blob:${src}` : null),
  resolveLink: (href) => (isExternalLink(href) ? { href } : null),
};

describe('sanitizeHtml', () => {
  it('丢弃脚本、样式、表单与嵌入内容，去掉自定义标签但保留其文字', () => {
    const html = sanitizeHtml(
      body(
        '<p>a<script>x()</script><custom-tag>b</custom-tag></p><style>p{}</style>' +
          '<form><input value="v"></form><iframe src="https://e"></iframe><object>o</object>'
      ),
      options
    );
    expect(html).toBe('<p>ab</p>');
  });

  it('只保留白名单属性，id 加前缀，事件与样式属性全部移除', () => {
    const html = sanitizeHtml(
      body('<p id="x" class="c" style="color:red" onclick="x()" title="t" dir="rtl" lang="zh">文</p>'),
      options
    );
    expect(html).toBe('<p id="p-x" title="t" lang="zh" dir="rtl">文</p>');
  });

  it('链接与图片经解析器处理，无法解析的链接降级为 span，图片丢弃', () => {
    const html = sanitizeHtml(
      body(
        '<a href="https://a.com" onmouseover="x()">外</a><a id="n" href="javascript:alert(1)">坏</a>' +
          '<img src="ok/1.png" alt="图" onerror="x()"><img src="bad.png">'
      ),
      options
    );
    expect(html).toBe('<a href="https://a.com">外</a><span id="p-n">坏</span><img src="blob:ok/1.png" alt="图">');
  });

  it('表格合并单元格与有序列表起始值只接受数字', () => {
    const html = sanitizeHtml(
      body('<table><tr><td colspan="2" rowspan="x">a</td></tr></table><ol start="3"><li>i</li></ol>'),
      options
    );
    expect(html).toBe('<table><tbody><tr><td colspan="2">a</td></tr></tbody></table><ol start="3"><li>i</li></ol>');
  });

  it('收集 img 与 SVG image 的图片引用', () => {
    const root = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><body>' +
        '<img src="a.png"/><svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="b.jpg"/></svg><img src="a.png"/>' +
        '</body></html>',
      'application/xhtml+xml'
    ).documentElement;
    expect(imageSources(root)).toEqual(['a.png', 'b.jpg']);
  });
});
