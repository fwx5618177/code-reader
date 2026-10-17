import { describe, expect, it } from 'vitest';
import { resolveArticle, resolveAttachmentKind, sourceHost } from '../article';
import { applyHighlightMarks, clearHighlightMarks, findHighlightMark } from '../highlight-dom';

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
});

describe('resolveAttachmentKind', () => {
  it('没有文件路径时不是附件', () => {
    expect(resolveAttachmentKind({ type: 'image' })).toBeNull();
  });

  it('依次按 MIME、条目类型、扩展名判断', () => {
    expect(resolveAttachmentKind({ type: 'file', filePath: '/a/x', mimeType: 'video/mp4' })).toBe('video');
    expect(resolveAttachmentKind({ type: 'audio', filePath: '/a/x.bin' })).toBe('audio');
    expect(resolveAttachmentKind({ type: 'file', filePath: '/a/x.PNG' })).toBe('image');
    expect(resolveAttachmentKind({ type: 'document', filePath: '/a/x.pdf', mimeType: 'application/pdf' })).toBe(
      'file'
    );
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

  it('跨节点的文本无法定位，跳过', () => {
    const root = render('<p>前半<strong>加粗</strong>后半</p>');
    const applied = applyHighlightMarks(root, [{ id: 'h1', text: '前半加粗' }], 'hl');
    expect(applied.size).toBe(0);
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
});
