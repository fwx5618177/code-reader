// ================================
// EPUB 测试夹具：在内存中构建一本两章的小书（含导航文档、NCX、图片与不合规 XHTML 章节）
// ================================

import JSZip from 'jszip';

export const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

export const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>  测试之书 </dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="text/chapter%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="images/pic.png" media-type="image/png"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c2"/>
    <itemref idref="css"/>
    <itemref idref="c1"/>
  </spine>
</package>`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="landmarks"><ol><li><a href="text/ch2.xhtml">封面</a></li></ol></nav>
  <nav epub:type="toc">
    <ol>
      <li><a href="text/ch2.xhtml">第二章</a>
        <ol><li><a href="text/ch2.xhtml#sec">小节</a></li></ol>
      </li>
      <li><a href="text/chapter%201.xhtml">第一章</a></li>
    </ol>
  </nav>
</body>
</html>`;

export const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="p1"><navLabel><text>开篇</text></navLabel><content src="text/ch2.xhtml"/>
      <navPoint id="p2"><navLabel><text>细节</text></navLabel><content src="text/ch2.xhtml#sec"/></navPoint>
    </navPoint>
  </navMap>
</ncx>`;

const CHAPTER_2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">
<head><title>ch2</title><style>p { color: red }</style><script>alert(1)</script></head>
<body>
  <h1 id="top" onclick="alert(2)" style="color:red" class="x">第二章</h1>
  <p>正文<em>强调</em>内容。<script>alert(3)</script></p>
  <p id="sec"><a href="chapter%201.xhtml#start">去第一章</a> <a href="https://example.com/">外链</a>
    <a href="javascript:alert(4)">恶意</a></p>
  <img src="../images/pic.png" alt="插图" onerror="alert(5)"/>
  <svg><image xlink:href="../images/pic.png"/></svg>
  <iframe src="https://evil.example"></iframe>
</body>
</html>`;

// 含 HTML 实体，严格 XML 解析失败时应回退到 HTML 解析
const CHAPTER_1 = `<html><body><p id="start">第一章&nbsp;开始</p><ul><li>甲</li><li>乙</li></ul></body></html>`;

export async function buildEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/content.opf', OPF);
  zip.file('OEBPS/nav.xhtml', NAV);
  zip.file('OEBPS/toc.ncx', NCX);
  zip.file('OEBPS/text/ch2.xhtml', CHAPTER_2);
  zip.file('OEBPS/text/chapter 1.xhtml', CHAPTER_1);
  zip.file('OEBPS/images/pic.png', new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({ type: 'uint8array' });
}
