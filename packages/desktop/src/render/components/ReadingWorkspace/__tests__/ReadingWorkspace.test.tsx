// ================================
// 阅读工作区组件测试：书架筛选排序、正文渲染、高亮还原、阅读状态写回
// ================================

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { KnowledgeItem } from '../../../types/knowledge';
import { buildEpub } from '../../../lib/reading/__tests__/epub-fixture';
import { ReadingShelf, ReadingView } from '..';

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 'item-1',
    title: '文章.md',
    type: 'webpage',
    status: 'ready',
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ReadingShelf', () => {
  const items = [
    makeItem({ id: 'a', title: '未读文章', updatedAt: new Date('2026-09-01') }),
    makeItem({
      id: 'b',
      title: '在读文章',
      metadata: { reading: { progress: 0.4, lastReadAt: '2026-10-01T00:00:00.000Z' } },
    }),
  ];

  it('最近阅读在前，按状态与关键词筛选', () => {
    const onSelect = vi.fn();
    render(<ReadingShelf items={items} onSelect={onSelect} />);

    const titles = () => screen.queryAllByRole('button', { name: /文章/ }).map((row) => row.title);
    expect(titles()).toEqual(['在读文章', '未读文章']);

    fireEvent.click(screen.getByRole('tab', { name: /未开始/ }));
    expect(titles()).toEqual(['未读文章']);

    fireEvent.click(screen.getByRole('tab', { name: /全部/ }));
    fireEvent.change(screen.getByPlaceholderText('搜索标题或链接'), { target: { value: '在读' } });
    expect(titles()).toEqual(['在读文章']);

    fireEvent.click(screen.getByTitle('在读文章'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});

describe('ReadingView', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const handlers = () => ({
    onUpdateItem: vi.fn().mockResolvedValue(undefined),
    onCreateExcerpt: vi.fn().mockResolvedValue('excerpt-1'),
    onWikiLinkClick: vi.fn(),
  });

  it('未选择条目时显示引导', () => {
    render(<ReadingView item={null} {...handlers()} />);
    expect(screen.getByText(/网页剪藏、书签和文档会自动出现在书架上/)).toBeTruthy();
  });

  it('渲染正文与目录，还原已保存的高亮，点击双向链接', () => {
    const props = handlers();
    const item = makeItem({
      content: '# 第一章\n\n重要的一句话，见 [[另一篇]]。\n\n## 第二节\n\n结尾',
      metadata: {
        source: 'clipper',
        reading: {
          highlights: [{ id: 'h1', text: '重要的一句话', createdAt: '2026-10-01T00:00:00.000Z' }],
        },
      },
    });
    const { container } = render(<ReadingView item={item} {...props} />);

    expect(screen.getByRole('button', { name: '第一章' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '第二节' })).toBeTruthy();
    expect(container.querySelector('mark[data-highlight-id="h1"]')?.textContent).toBe('重要的一句话');

    fireEvent.click(container.querySelector('.wiki-link')!);
    expect(props.onWikiLinkClick).toHaveBeenCalledWith('另一篇');
  });

  it('标题链接回传 目标#标题，[[#标题]] 在正文内跳转，![[嵌入]] 展开为引用内容', () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });
    const props = handlers();
    const item = makeItem({
      content: '# 开头\n\n见 [[另一篇#第二节|第二节]] 与 [[#结尾]]\n\n![[不存在]]\n\n## 结尾\n\n完',
    });
    const { container } = render(<ReadingView item={item} {...props} />);

    const [heading, local] = container.querySelectorAll<HTMLElement>('.wiki-link');
    fireEvent.click(heading);
    expect(props.onWikiLinkClick).toHaveBeenCalledWith('另一篇#第二节');

    fireEvent.click(local);
    expect(props.onWikiLinkClick).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.instances[0] as unknown as HTMLElement).textContent).toBe('结尾');

    // 未提供链接解析时嵌入显示为未找到
    expect(container.querySelector('.wiki-embed-missing')?.textContent).toBe('未找到「不存在」');
  });

  it('删除高亮与标记已读时只替换 reading 元数据', () => {
    const props = handlers();
    const item = makeItem({
      content: '正文内容',
      metadata: {
        source: 'clipper',
        reading: {
          progress: 0.3,
          highlights: [{ id: 'h1', text: '正文', createdAt: '2026-10-01T00:00:00.000Z' }],
        },
      },
    });
    const { container } = render(<ReadingView item={item} {...props} />);

    fireEvent.click(screen.getByRole('tab', { name: /高亮/ }));
    fireEvent.click(screen.getByLabelText('删除高亮'));
    expect(props.onUpdateItem).toHaveBeenLastCalledWith('item-1', {
      metadata: { source: 'clipper', reading: { progress: 0.3 } },
    });
    expect(container.querySelector('mark')).toBeNull();

    fireEvent.click(screen.getByTitle('标记为已读'));
    const [, input] = props.onUpdateItem.mock.calls.at(-1)!;
    expect(input.metadata.source).toBe('clipper');
    expect(input.metadata.reading).toMatchObject({ progress: 1 });
    expect(input.metadata.reading.finishedAt).toEqual(expect.any(String));
    expect(screen.getByTitle('标记为未读')).toBeTruthy();
  });

  it('无正文的书签显示链接卡片', () => {
    render(
      <ReadingView
        item={makeItem({ type: 'bookmark', sourceUrl: 'https://example.com/post' })}
        {...handlers()}
      />
    );
    expect(screen.getByText('https://example.com/post')).toBeTruthy();
    expect(screen.getByRole('button', { name: '在浏览器中打开' })).toBeTruthy();
  });

  it('EPUB 按章节阅读：目录跳转、章节切换与书内链接', async () => {
    const invoke = vi.fn().mockResolvedValue(await buildEpub());
    vi.stubGlobal('electron', { ipcRenderer: { invoke } });
    // jsdom 未实现 scrollIntoView
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });
    const item = makeItem({
      type: 'document',
      title: 'book.epub',
      content: '提取的全文只用于检索',
      filePath: '/library/book.epub',
      mimeType: 'application/epub+zip',
    });
    const { container } = render(<ReadingView item={item} {...handlers()} />);

    expect(await screen.findByText('第 1 / 2 章')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('read-binary-file', '/library/book.epub');
    expect(container.querySelector('#epub-top')?.textContent).toBe('第二章');
    expect(screen.queryByText('提取的全文只用于检索')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '第一章' }));
    expect(await screen.findByText('第 2 / 2 章')).toBeTruthy();
    expect(container.querySelector('#epub-start')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /上一章/ }));
    expect(await screen.findByText('第 1 / 2 章')).toBeTruthy();

    fireEvent.click(screen.getByText('去第一章'));
    expect(await screen.findByText('第 2 / 2 章')).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
