import { describe, expect, it } from 'vitest';
import { documentFormat, resolveArticle, resolveAttachmentKind, sourceHost } from '../article';
import { applyHighlightMarks, clearHighlightMarks, findHighlightMark, selectedText } from '../highlight-dom';

describe('resolveArticle', () => {
  it('空内容没有正文', () => {
    expect(resolveArticle({ type: 'webpage', title: 'a', content: '  \n' })).toBeNull();
    expect(resolveArticle({ type: 'bookmark', title: 'a' })).toBeNull();
  });

  it('.txt 笔记按纯文本渲染，其余按 Markdown', () => {
    expect(resolveArticle({ type: 'note', title: '日记.TXT', content: 'x' })?.format).toBe('plain');
    expect(resolveArticle({ type: 'note', title: '笔记.md', content: 'x' })?.format).toBe('markdown');
    expect(resolveArticle({ type: 'webpage', title: 'a.txt', content: 'x' })?.format).toBe('markdown');
  });

  it('PDF / EPUB 的提取文本只用于检索，不作为正文', () => {
    expect(
      resolveArticle({ type: 'document', title: 'a', content: '全文', filePath: '/a/x.pdf', mimeType: 'application/pdf' })
    ).toBeNull();
    expect(resolveArticle({ type: 'document', title: 'a', content: '全文', filePath: '/a/book.epub' })).toBeNull();
    expect(resolveArticle({ type: 'document', title: 'a', content: '全文', filePath: '/a/x.docx' })).not.toBeNull();
  });
});

describe('documentFormat', () => {
  it('优先按 MIME，其次按扩展名识别 PDF / EPUB', () => {
    expect(documentFormat({ name: 'x', type: 'application/pdf' })).toBe('pdf');
    expect(documentFormat({ name: 'Book.EPUB', type: '' })).toBe('epub');
    expect(documentFormat({ name: 'a.docx', type: 'application/msword' })).toBeNull();
  });
});

describe('resolveAttachmentKind', () => {
  it('没有文件路径时不是附件', () => {
    expect(resolveAttachmentKind({ type: 'image' })).toBeNull();
  });

  it('依次按 MIME、条目类型、扩展名判断', () => {
    expect(resolveAttachmentKind({ type: 'file', filePath: '/a/x', mimeType: 'video/mp4' })).toBe('video');
    expect(resolveAttachmentKind({ type: 'audio', filePath: '/a/x.bin' })).toBe('audio');
    expect(resolveAttachmentKind({ type: 'file', filePath: '/a/x.PNG' })).toBe('image');
    expect(resolveAttachmentKind({ type: 'document', filePath: '/a/x', mimeType: 'application/pdf' })).toBe('pdf');
    expect(resolveAttachmentKind({ type: 'document', filePath: '/a/book.epub' })).toBe('epub');
    expect(resolveAttachmentKind({ type: 'document', filePath: '/a/x.docx' })).toBe('file');
  });
});

describe('sourceHost', () => {
  it('提取域名，非法 URL 原样返回', () => {
    expect(sourceHost('https://www.example.com/path?q=1')).toBe('www.example.com');
    expect(sourceHost('not a url')).toBe('not a url');
  });
});

describe('highlight-dom', () => {
  function render(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  }

  it('在单个文本节点内包裹首次出现的高亮文本', () => {
    const root = render('<p>阅读让人充实，阅读让人快乐</p>');
    const applied = applyHighlightMarks(root, [{ id: 'h1', text: '阅读' }], 'hl');
    expect(applied).toEqual(new Set(['h1']));
    expect(root.innerHTML).toBe(
      '<p><mark class="hl" data-highlight-id="h1">阅读</mark>让人充实，阅读让人快乐</p>'
    );
    expect(findHighlightMark(root, 'h1')?.textContent).toBe('阅读');
    expect(findHighlightMark(root, 'missing')).toBeNull();
  });

  it('跨越行内元素的高亮拆成多个共享 ID 的标记', () => {
    const root = render('<p>前半<strong>加粗</strong>后半</p>');
    const applied = applyHighlightMarks(root, [{ id: 'h1', text: '半加粗后' }], 'hl');
    expect(applied).toEqual(new Set(['h1']));
    expect(root.innerHTML).toBe(
      '<p>前<mark class="hl" data-highlight-id="h1">半</mark>' +
        '<strong><mark class="hl" data-highlight-id="h1">加粗</mark></strong>' +
        '<mark class="hl" data-highlight-id="h1">后</mark>半</p>'
    );
    expect(findHighlightMark(root, 'h1')?.textContent).toBe('半');
  });

  it('可跨越 em、链接与行内代码', () => {
    const root = render('<p>Use <em>the</em> <a href="#x">fetch</a> <code>API()</code> now</p>');
    applyHighlightMarks(root, [{ id: 'h1', text: 'the fetch API' }], 'hl');
    const marks = Array.from(root.querySelectorAll('mark'));
    expect(marks.map((mark) => mark.textContent)).toEqual(['the', 'fetch', 'API']);
    expect(marks.every((mark) => mark.getAttribute('data-highlight-id') === 'h1')).toBe(true);
    expect(root.querySelector('a mark')?.textContent).toBe('fetch');
    expect(root.querySelector('code')?.textContent).toBe('API()');
  });

  it('选区文本中的换行与段落边界对应，块间空白不包裹', () => {
    const root = render('<p>第一段结尾</p>\n<ul>\n<li>列表开头</li>\n</ul>');
    const applied = applyHighlightMarks(root, [{ id: 'h1', text: '结尾\n\n列表' }], 'hl');
    expect(applied).toEqual(new Set(['h1']));
    expect(Array.from(root.querySelectorAll('mark')).map((mark) => mark.textContent)).toEqual(['结尾', '列表']);
    expect(root.querySelector('ul > mark')).toBeNull();
  });

  it('重叠的高亮形成嵌套标记，清除后恢复原始 DOM', () => {
    const original = '<p>一二<em>三四</em>五六</p>';
    const root = render(original);
    const applied = applyHighlightMarks(
      root,
      [
        { id: 'h1', text: '二三四' },
        { id: 'h2', text: '四五' },
      ],
      'hl'
    );
    expect(applied).toEqual(new Set(['h1', 'h2']));
    expect(root.querySelector('mark[data-highlight-id="h1"] mark[data-highlight-id="h2"]')?.textContent).toBe('四');

    clearHighlightMarks(root);
    expect(root.innerHTML).toBe(original);
    expect(root.querySelector('em')?.childNodes).toHaveLength(1);
  });

  it('文本不存在时跳过', () => {
    const root = render('<p>前半<strong>加粗</strong>后半</p>');
    expect(applyHighlightMarks(root, [{ id: 'h1', text: '不存在' }], 'hl').size).toBe(0);
    expect(root.querySelector('mark')).toBeNull();
  });

  it('不在数学公式内部包裹', () => {
    const root = render('<p><span class="math-inline-wrapper">x</span> 和 x</p>');
    applyHighlightMarks(root, [{ id: 'h1', text: 'x' }], 'hl');
    expect(root.querySelector('.math-inline-wrapper mark')).toBeNull();
    expect(root.querySelector('mark')?.textContent).toBe('x');
  });

  it('清除标记后恢复原始 DOM，可重新应用', () => {
    const original = '<p>一段文字，其中有重点内容。</p>';
    const root = render(original);
    applyHighlightMarks(root, [{ id: 'h1', text: '重点' }, { id: 'h2', text: '一段' }], 'hl');
    expect(root.querySelectorAll('mark')).toHaveLength(2);

    clearHighlightMarks(root);
    expect(root.innerHTML).toBe(original);
    expect(root.querySelector('p')?.childNodes).toHaveLength(1);

    expect(applyHighlightMarks(root, [{ id: 'h3', text: '文字，其中' }], 'hl')).toEqual(new Set(['h3']));
  });

  describe('selectedText', () => {
    /** 与 PDF 文本层相同的结构：绝对定位的文字片段 + 行尾 <br> */
    const TEXT_LAYER = '<span>Hello </span><span>world</span><br role="presentation"><span>next   line</span>';

    function select(root: HTMLElement, start: [number, number], end: [number, number]): Range {
      const range = document.createRange();
      range.setStart(root.children[start[0]].firstChild!, start[1]);
      range.setEnd(root.children[end[0]].firstChild!, end[1]);
      return range;
    }

    it('返回选区覆盖的归一化文本：跨节点拼接，换行与连续空白折叠为空格', () => {
      const root = render(TEXT_LAYER);
      expect(selectedText(root, select(root, [0, 2], [3, 6]))).toBe('llo world next');
    });

    it('返回的文本可以被重新定位为高亮', () => {
      const root = render(TEXT_LAYER);
      const text = selectedText(root, select(root, [1, 0], [3, 4]));
      expect(text).toBe('world next');
      applyHighlightMarks(root, [{ id: 'h1', text }], 'hl');
      expect(Array.from(root.querySelectorAll('mark')).map((mark) => mark.textContent)).toEqual(['world', 'next']);
    });

    it('选区不在 root 中时返回空字符串', () => {
      const root = render(TEXT_LAYER);
      const other = render('<span>其他</span>');
      expect(selectedText(root, select(other, [0, 0], [0, 2]))).toBe('');
    });
  });
});
