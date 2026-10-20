// ================================
// 扩展语法与 HTML 渲染：GFM 扩展自动链接（用例取自 GFM 规范）、排版替换、{…} 属性、YAML 头部、
// 表格单元格位置、引用定义、脚注编号；渲染选项（安全链接、代码高亮、扩展节点）；
// 扩展语法的 HTML 与 fixtures/reference.json 中冻结的参照输出逐字比较
// ================================

import { describe, expect, it } from 'vitest';
import {
  BlockType,
  domainToAscii,
  domainToUnicode,
  InlineType,
  TokenStreamTokenizer,
  parseCommonMark,
  renderHtml,
  type CommonMarkOptions,
  type HtmlRenderOptions,
  type InlineExtension,
  type TableNode,
} from '../src';
import { referenceHtml, referenceTokens } from './helpers/reference';
import { shape } from './helpers/token-shape';

const html = (markdown: string, options: CommonMarkOptions = {}, render: HtmlRenderOptions = {}) =>
  renderHtml(parseCommonMark(markdown, options).document, render);

describe('GFM 扩展自动链接（linkify）', () => {
  const linkify = (markdown: string) => html(markdown, { linkify: true });

  it.each([
    ['www.commonmark.org', '<p><a href="http://www.commonmark.org">www.commonmark.org</a></p>\n'],
    [
      'Visit www.commonmark.org/help for more information.',
      '<p>Visit <a href="http://www.commonmark.org/help">www.commonmark.org/help</a> for more information.</p>\n',
    ],
    [
      'Visit www.commonmark.org.\n\nVisit www.commonmark.org/a.b.',
      '<p>Visit <a href="http://www.commonmark.org">www.commonmark.org</a>.</p>\n<p>Visit <a href="http://www.commonmark.org/a.b">www.commonmark.org/a.b</a>.</p>\n',
    ],
    [
      'www.google.com/search?q=Markup+(business)\n\nwww.google.com/search?q=Markup+(business)))\n\n(www.google.com/search?q=Markup+(business))\n\n(www.google.com/search?q=Markup+(business)',
      '<p><a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a></p>\n' +
        '<p><a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a>))</p>\n' +
        '<p>(<a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a>)</p>\n' +
        '<p>(<a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a></p>\n',
    ],
    [
      'www.google.com/search?q=(business))+ok',
      '<p><a href="http://www.google.com/search?q=(business))+ok">www.google.com/search?q=(business))+ok</a></p>\n',
    ],
    [
      'www.google.com/search?q=commonmark&hl=en\n\nwww.google.com/search?q=commonmark&hl;',
      '<p><a href="http://www.google.com/search?q=commonmark&amp;hl=en">www.google.com/search?q=commonmark&amp;hl=en</a></p>\n' +
        '<p><a href="http://www.google.com/search?q=commonmark">www.google.com/search?q=commonmark</a>&amp;hl;</p>\n',
    ],
    ['www.commonmark.org/he<lp', '<p><a href="http://www.commonmark.org/he">www.commonmark.org/he</a>&lt;lp</p>\n'],
    [
      'http://commonmark.org\n\n(Visit https://encrypted.google.com/search?q=Markup+(business))',
      '<p><a href="http://commonmark.org">http://commonmark.org</a></p>\n' +
        '<p>(Visit <a href="https://encrypted.google.com/search?q=Markup+(business)">https://encrypted.google.com/search?q=Markup+(business)</a>)</p>\n',
    ],
    ['foo@bar.baz', '<p><a href="mailto:foo@bar.baz">foo@bar.baz</a></p>\n'],
    [
      "hello@mail+xyz.example isn't valid, but hello+xyz@mail.example is.",
      "<p>hello@mail+xyz.example isn't valid, but <a href=\"mailto:hello+xyz@mail.example\">hello+xyz@mail.example</a> is.</p>\n",
    ],
    [
      'a.b-c_d@a.b\n\na.b-c_d@a.b.\n\na.b-c_d@a.b-\n\na.b-c_d@a.b_',
      '<p><a href="mailto:a.b-c_d@a.b">a.b-c_d@a.b</a></p>\n<p><a href="mailto:a.b-c_d@a.b">a.b-c_d@a.b</a>.</p>\n<p>a.b-c_d@a.b-</p>\n<p>a.b-c_d@a.b_</p>\n',
    ],
    [
      'mailto:foo@bar.baz\n\nmailto:a.b-c_d@a.b.',
      '<p><a href="mailto:foo@bar.baz">mailto:foo@bar.baz</a></p>\n<p><a href="mailto:a.b-c_d@a.b">mailto:a.b-c_d@a.b</a>.</p>\n',
    ],
  ])('%j', (markdown, expected) => {
    expect(linkify(markdown)).toBe(expected);
  });

  it('链接文字与代码中不识别；前面必须是行首、空白或 * _ ~ (；默认关闭', () => {
    expect(linkify('[www.x.com](http://y) `www.x.com` *www.x.com* xwww.x.com')).toBe(
      '<p><a href="http://y">www.x.com</a> <code>www.x.com</code> <em><a href="http://www.x.com">www.x.com</a></em> xwww.x.com</p>\n'
    );
    expect(html('www.x.com')).toBe('<p>www.x.com</p>\n');
  });

  it('token 结构：markup 为 linkify，info 为 auto', () => {
    const tokens = new TokenStreamTokenizer({ linkify: true }).parse('见 https://a.b/c。');
    expect(tokens[1]!.children!.map((token) => [token.type, token.markup, token.info, token.content])).toEqual([
      ['text', '', '', '见 '],
      ['link_open', 'linkify', 'auto', ''],
      ['text', '', '', 'https://a.b/c。'],
      ['link_close', 'linkify', 'auto', ''],
    ]);
  });

  // 裸域名识别：逐 token 与参照输出比较
  it.each([
    'see example.com now',
    'example.com/path?q=1#x.',
    'foo.bar.org:8080/a, end',
    'README.md 与 a.js',
    '（example.com）括号',
    'x@example.com 邮箱',
    'http://a.com 与 b.net',
    'a.b.c 与 example.comx 与 example.com-',
    'sub.example.co.uk',
    '中文example.com',
    'xn--80ak6aa92e.com',
    '[文本 example.com](u) `example.com`',
    'example.com.',
  ])('裸域名（linkifyBareDomains）：%j', (markdown) => {
    const ours = new TokenStreamTokenizer({ gfm: false, strikethrough: false, linkify: true, linkifyBareDomains: true });
    expect(ours.parse(markdown).map(shape)).toEqual(referenceTokens('linkify', markdown));
  });

  it('裸域名默认不识别（README.md 这类文件名也会被当成域名）', () => {
    expect(html('example.com', { linkify: true })).toBe('<p>example.com</p>\n');
  });
});

describe('链接地址规范化（IDN 主机名转 Punycode、百分号编码；链接文字反向解码）', () => {
  it.each([
    '<http://a.com/%E4%B8%AD?x=%25>',
    '<http://xn--fiq228c.com/a>',
    '<http://中文.com/路径>',
    '[a](http://中文.com/路径 "t")',
    '![i](https://例子.测试/图.png)',
    'https://例子.cn/a%20b',
    'www.中文.com/x',
    '<mailto:用户@例子.cn>',
    '<user@xn--fiq228c.com>',
    '[r](/相对/路径) [r](//中文.com/a) [r](HTTP://中文.COM/A) [r](ftp://中文.com/a)',
    '<http://a.com/%C3%28%E4%B8>',
  ])('IDN 主机名与百分号解码：%j', (markdown) => {
    const ours = new TokenStreamTokenizer({ gfm: false, strikethrough: false, linkify: true });
    expect(ours.parse(markdown).map(shape)).toEqual(referenceTokens('linkify', markdown));
    expect(html(markdown, { gfm: false, linkify: true })).toBe(referenceHtml('linkify', markdown));
  });

  it('Punycode（RFC 3492 的示例）', () => {
    expect(domainToAscii('他们为什么不说中文')).toBe('xn--ihqwcrb4cv8a8dqg056pqjye');
    expect(domainToAscii('ليهمابتكلموشعربي؟')).toBe('xn--egbpdaj6bu4bxfgehfvwxn');
    expect(domainToAscii('bücher.de。例子')).toBe('xn--bcher-kva.de.xn--fsqu00a');
    expect(domainToUnicode('xn--ihqwcrb4cv8a8dqg056pqjye.XN--FSQU00A')).toBe('他们为什么不说中文.例子');
    expect(() => domainToUnicode('xn--中')).toThrow();
  });
});

describe('排版替换（replacements）', () => {
  const ours = new TokenStreamTokenizer({ replacements: true, gfm: false, strikethrough: false });

  it.each(['(c) (C) (r) (tm) (TM) +- a -- b --- c ... ?..... !!!!! ????? ,, x..y', '-- 开头与结尾 --', '`(c)` 代码中不替换 [(c)](u)'])(
    '%j',
    (markdown) => {
      expect(ours.parse(markdown).map(shape)).toEqual(referenceTokens('replacements', markdown));
    }
  );
});

describe('{…} 属性（attributes）', () => {
  it('标题、段落末尾与行内元素之后', () => {
    expect(html('# 标题 {#intro .lead}', { attributes: true })).toBe('<h1 id="intro" class="lead">标题</h1>\n');
    expect(html('段落 *强调*{.red} 与 [链接](u){target=_blank data-x="a b"} 文字 {data-p=1}', { attributes: true })).toBe(
      '<p data-p="1">段落 <em class="red">强调</em> 与 <a href="u" target="_blank" data-x="a b">链接</a> 文字</p>\n'
    );
  });

  it('不合法的 {…} 保留为文本；关闭时不处理', () => {
    expect(html('文字 {不是 属性}', { attributes: true })).toBe('<p>文字 {不是 属性}</p>\n');
    expect(html('# 标题 {#x}')).toBe('<h1>标题 {#x}</h1>\n');
  });

  it('属性进入 token 的 attrs', () => {
    const tokens = new TokenStreamTokenizer({ attributes: true }).parse('# T {#t}\n\n`c`{.k}');
    expect(tokens[0]!.attrs).toEqual([['id', 't']]);
    expect(tokens[4]!.children![0]!.attrs).toEqual([['class', 'k']]);
  });
});

describe('YAML 头部（frontMatter）', () => {
  it('文档开头闭合的 --- 块成为头部节点，渲染时不输出', () => {
    const { document } = parseCommonMark('---\ntitle: 周报\ntags: [a]\n---\n# 正文\n', { frontMatter: true });
    const [header, heading] = document.children!;
    expect(header).toMatchObject({ type: BlockType.FrontMatter, content: 'title: 周报\ntags: [a]' });
    expect(header!.position).toMatchObject({ startLine: 1, endLine: 4, start: 0 });
    expect(heading!.type).toBe(BlockType.Heading);
    expect(renderHtml(document)).toBe('<h1>正文</h1>\n');
  });

  it('未闭合、不在开头或选项关闭时按普通内容解析；... 也可以结束头部', () => {
    expect(html('---\ntitle: a\n', { frontMatter: true })).toBe('<hr />\n<p>title: a</p>\n');
    expect(html('正文\n\n---\na: 1\n---\n', { frontMatter: true })).toBe('<p>正文</p>\n<hr />\n<h2>a: 1</h2>\n');
    expect(html('---\na: 1\n---\n')).toBe('<hr />\n<h2>a: 1</h2>\n');
    expect(parseCommonMark('---\na: 1\n...\nb', { frontMatter: true }).document.children![0]!.type).toBe(BlockType.FrontMatter);
  });
});

describe('位置与解析结果', () => {
  it('表格的行与单元格有各自的位置，含 \\| 的单元格内行内节点位置也准确', () => {
    const source = '| a | b \\| c |\n|---|---|\n| `x\\|y` | **2** |\n';
    const table = parseCommonMark(source).document.children![0] as TableNode;
    const slice = (position: { start: number; end: number }) => source.slice(position.start, position.end);
    expect(table.header.cells.map((cell) => slice(cell.position))).toEqual(['a', 'b \\| c']);
    expect(table.header.cells[1]!.content).toBe('b | c');
    expect(slice(table.rows[0]!.position)).toBe('| `x\\|y` | **2** |');
    const [code] = table.rows[0]!.cells[0]!.inline!;
    expect(code).toMatchObject({ type: InlineType.Code, content: 'x|y' });
    expect(slice(code!.position)).toBe('`x\\|y`');
    expect(slice(table.rows[0]!.cells[1]!.inline![0]!.position)).toBe('**2**');
    expect(table.rows[0]!.cells[1]!.position).toMatchObject({ startLine: 3, startColumn: 12 });
  });

  it('解析结果包含引用定义与缩写定义（同名以第一个为准）', () => {
    const result = parseCommonMark('[Foo]: /a "t"\n[foo]: /b\n*[HTML]: Hyper\n', { abbreviations: true });
    expect([...result.references]).toEqual([['FOO', { url: '/a', title: 't' }]]);
    expect([...result.abbreviations]).toEqual([['HTML', 'Hyper']]);
  });

  it('文档节点覆盖整个输入', () => {
    const { document } = parseCommonMark('```\ncode\n```   \n');
    expect(document.position).toMatchObject({ start: 0, end: 16, endLine: 3 });
  });
});

describe('脚注', () => {
  it('按第一次引用编号；同一脚注多次引用有各自的回链；未定义的 [^x] 是文本', () => {
    const output = html('正文[^b] 与[^a] 再[^b] 和[^x]\n\n[^a]: 甲\n[^b]: 乙\n');
    expect(output).toContain('<a href="#fn1" id="fnref1">[1]</a>');
    expect(output).toContain('<a href="#fn2" id="fnref2">[2]</a>');
    expect(output).toContain('<a href="#fn1" id="fnref1:1">[1:1]</a>');
    expect(output).toContain('和[^x]');
    expect(output).toContain(
      '<li id="fn1" class="footnote-item"><p>乙 <a href="#fnref1" class="footnote-backref">\u21a9\uFE0E</a> <a href="#fnref1:1" class="footnote-backref">\u21a9\uFE0E</a></p>\n</li>'
    );
  });
});

describe('扩展语法的 HTML', () => {
  const options: CommonMarkOptions = {
    html: false,
    gfm: false,
    strikethrough: false,
    footnotes: true,
    definitionLists: true,
    containers: ['note'],
    mark: true,
    insert: true,
    subscript: true,
    superscript: true,
    abbreviations: true,
  };

  it.each([
    'a[^1] b^[行内 *脚注*] c[^1]\n\n[^1]: one\n\n    two\n',
    'Term\n: def\n\nTerm 2\n\n: def 2a\n: def 2b\n',
    '::: note 标题\n*here*\n\n- a\n:::\n',
    '==mark== ++ins++ H~2~O 2^10^',
    '*[HTML]: Hyper Text\nThe HTML spec.',
  ])('%j', (markdown) => {
    expect(html(markdown, options)).toBe(referenceHtml('plugins', markdown));
  });
});

describe('HTML 渲染选项', () => {
  it('默认拒绝 javascript: 等不安全地址（图片允许常见格式的 data:）；validateLink 可替换', () => {
    expect(html('[a](javascript:alert(1)) ![i](data:image/png;base64,AA)')).toBe(
      '<p><a href="">a</a> <img src="data:image/png;base64,AA" alt="i" /></p>\n'
    );
    expect(html('[a](javascript:x)', {}, { validateLink: () => true })).toBe('<p><a href="javascript:x">a</a></p>\n');
  });

  it('代码高亮、语言前缀与 xhtmlOut', () => {
    const highlight = (code: string, language: string) => (language === 'ts' ? `<b>${code.trim()}</b>` : null);
    expect(html('```ts\nlet a\n```\n\n```js\nx\n```', {}, { highlight, langPrefix: 'lang-' })).toBe(
      '<pre><code class="lang-ts"><b>let a</b></code></pre>\n<pre><code class="lang-js">x\n</code></pre>\n'
    );
    expect(html('```\nx\n```', {}, { highlight: () => '<pre class="own">x</pre>' })).toBe('<pre class="own">x</pre>\n');
    expect(html('a  \nb\n\n---', {}, { xhtmlOut: false })).toBe('<p>a<br>\nb</p>\n<hr>\n');
  });

  it('扩展节点：默认输出带 data-extension 的元素，可按名称自定义', () => {
    const math: InlineExtension = {
      name: 'math',
      trigger: '$',
      match: (text, pos) => {
        const end = text.indexOf('$', pos + 1);
        return end > pos ? { length: end - pos + 1, content: text.slice(pos + 1, end) } : null;
      },
    };
    const markdown = '面积 $a<b$';
    expect(html(markdown, { inlineExtensions: [math] })).toBe('<p>面积 <span data-extension="math">a&lt;b</span></p>\n');
    expect(
      html(markdown, { inlineExtensions: [math] }, { extensions: { math: (node, { escapeHtml }) => `<m>${escapeHtml(node.content ?? '')}</m>` } })
    ).toBe('<p>面积 <m>a&lt;b</m></p>\n');
  });
});
