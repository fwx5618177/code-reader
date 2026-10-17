// ================================
// 条目打开方式测试：写作文档、文档附件、网页剪藏与其他条目的路由
// ================================

import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '../../../types/knowledge';
import { isReadableItem, itemOpenTarget } from '../open-target';

function item(overrides: Partial<KnowledgeItem>): KnowledgeItem {
  const time = new Date(2026, 9, 17);
  return {
    id: 'x',
    title: '条目',
    type: 'note',
    status: 'ready',
    createdAt: time,
    updatedAt: time,
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
    ...overrides,
  };
}

const pdf = item({ type: 'document', title: '论文.pdf', filePath: '/a/论文.pdf', mimeType: 'application/pdf', content: '提取文本' });
const epub = item({ type: 'document', title: '书.epub', filePath: '/a/书.epub' });
const docx = item({ type: 'document', title: '报告.docx', filePath: '/a/报告.docx' });

describe('itemOpenTarget', () => {
  it('写作文档（Markdown / LaTeX 笔记）进入写作模式', () => {
    expect(itemOpenTarget(item({ type: 'note', title: '笔记.md' }))).toBe('writing');
    expect(itemOpenTarget(item({ type: 'note', title: '论文.tex' }))).toBe('writing');
  });

  it('文档附件（PDF / EPUB / 其他格式）进入阅读模式，不进入写作模式', () => {
    expect(itemOpenTarget(pdf)).toBe('reading');
    expect(itemOpenTarget(epub)).toBe('reading');
    expect(itemOpenTarget(docx)).toBe('reading');
  });

  it('其他类型在知识库中查看', () => {
    expect(itemOpenTarget(item({ type: 'webpage' }))).toBe('knowledge');
    expect(itemOpenTarget(item({ type: 'image' }))).toBe('knowledge');
  });
});

describe('isReadableItem', () => {
  it('PDF / EPUB / 文档与网页剪藏可阅读', () => {
    expect(isReadableItem(pdf)).toBe(true);
    expect(isReadableItem(epub)).toBe(true);
    expect(isReadableItem(docx)).toBe(true);
    expect(isReadableItem(item({ type: 'webpage', content: '' }))).toBe(true);
  });

  it('按文件识别的 PDF 附件（类型为 file）可阅读', () => {
    expect(isReadableItem(item({ type: 'file', filePath: '/a/b.pdf' }))).toBe(true);
  });

  it('有正文的书签等条目可阅读，没有正文的不可阅读', () => {
    expect(isReadableItem(item({ type: 'bookmark', content: '# 正文' }))).toBe(true);
    expect(isReadableItem(item({ type: 'bookmark' }))).toBe(false);
    expect(isReadableItem(item({ type: 'image', filePath: '/a/b.png' }))).toBe(false);
  });

  it('写作文档即使有正文也不算可阅读条目', () => {
    expect(isReadableItem(item({ type: 'note', content: '# 标题' }))).toBe(false);
  });
});
