// ================================
// 全局搜索测试：结果合并分组、摘要高亮拆分、过期响应丢弃
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { HybridSearchResult } from '../../../types/electron';
import type { DocumentSearchResult } from '../../../lib/writing';
import { mergeSearchResults, splitHighlights } from '../search-results';
import SearchPanel from '..';

const searchDocuments = vi.fn();
vi.mock('../../../lib/writing', () => ({ useWritingService: () => ({ search: searchDocuments }) }));

const doc = (id: string, title: string, snippet = ''): DocumentSearchResult => ({
  id,
  documentId: id,
  title,
  snippet,
  highlights: [],
  score: 1,
});

const hit = (itemId: string, type: string, title = itemId, snippet?: string): HybridSearchResult => ({
  itemId,
  type,
  title,
  snippet,
  similarity: 0,
  combinedScore: 1,
  createdAt: '',
});

describe('mergeSearchResults', () => {
  it('写作结果在前，混合检索中的笔记补入文档组并去重，其余类型归入知识条目', () => {
    const groups = mergeSearchResults(
      [doc('d1', '写作一', '<mark>关键</mark>词')],
      [hit('d1', 'note'), hit('n2', 'note', '另一篇'), hit('w1', 'webpage', '剪藏', '摘要'), hit('a1', 'audio')]
    );
    expect(groups.documents.map((h) => h.id)).toEqual(['d1', 'n2']);
    expect(groups.documents[0]).toMatchObject({ title: '写作一', type: 'note', group: 'documents' });
    expect(groups.knowledge).toEqual([
      { id: 'w1', title: '剪藏', type: 'webpage', snippet: '摘要', group: 'knowledge' },
      { id: 'a1', title: 'a1', type: 'audio', snippet: '', group: 'knowledge' },
    ]);
  });

  it('空标题显示为“无标题”，未知类型按文件展示', () => {
    const groups = mergeSearchResults([doc('d1', '')], [hit('x', 'unknown', '')]);
    expect(groups.documents[0].title).toBe('无标题');
    expect(groups.knowledge[0]).toMatchObject({ title: '无标题', type: 'file' });
  });
});

describe('splitHighlights', () => {
  it('按 <mark> 拆分为高亮与普通片段', () => {
    expect(splitHighlights('前<mark>命中</mark>后<mark>再次</mark>')).toEqual([
      { text: '前', highlight: false },
      { text: '命中', highlight: true },
      { text: '后', highlight: false },
      { text: '再次', highlight: true },
    ]);
  });

  it('去掉 <mark> 以外的标签，不产生可执行 HTML', () => {
    const segments = splitHighlights('<p>段落<img src=x onerror=alert(1)></p><mark>词</mark>');
    expect(segments.map((s) => s.text).join('')).toBe('段落 词');
    expect(segments.some((s) => s.text.includes('<'))).toBe(false);
  });
});

describe('SearchPanel', () => {
  const hybrid = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, 'electron', { configurable: true, value: { search: { hybrid } } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPanel() {
    const props = {
      isOpen: true,
      onClose: vi.fn(),
      onOpenDocument: vi.fn(),
      onOpenKnowledgeItem: vi.fn(),
    };
    render(<SearchPanel {...props} />);
    return props;
  }

  it('防抖后同时搜索两路，分组展示并按分组打开', async () => {
    searchDocuments.mockResolvedValue([doc('d1', '写作文档A')]);
    hybrid.mockResolvedValue([hit('w1', 'webpage', '网页B')]);
    const props = renderPanel();

    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: 'react' } });
    expect(hybrid).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(searchDocuments).toHaveBeenCalledTimes(1);
    expect(hybrid).toHaveBeenCalledWith('react', { limit: 30 });

    expect(screen.getByRole('group', { name: '写作文档' }).textContent).toContain('写作文档A');
    expect(screen.getByRole('group', { name: '知识条目' }).textContent).toContain('网页B');

    fireEvent.click(screen.getByText('网页B'));
    expect(props.onOpenKnowledgeItem).toHaveBeenCalledWith('w1');
    expect(props.onClose).toHaveBeenCalled();

    // 键盘：第一项为写作文档
    fireEvent.keyDown(screen.getByLabelText('搜索'), { key: 'Enter' });
    expect(props.onOpenDocument).toHaveBeenCalledWith('d1');
  });

  it('知识库搜索失败时仍展示写作文档结果', async () => {
    searchDocuments.mockResolvedValue([doc('d1', '写作文档A')]);
    hybrid.mockRejectedValue(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel();

    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: 'x' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByText('写作文档A')).toBeTruthy();
  });

  it('丢弃过期响应：先发出的慢请求不会覆盖新查询的结果', async () => {
    searchDocuments.mockResolvedValue([]);
    let resolveSlow: (value: HybridSearchResult[]) => void = () => {};
    hybrid
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)))
      .mockResolvedValueOnce([hit('new', 'webpage', '新结果')]);
    renderPanel();

    const input = screen.getByLabelText('搜索');
    fireEvent.change(input, { target: { value: 'old' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    fireEvent.change(input, { target: { value: 'new' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByText('新结果')).toBeTruthy();

    await act(async () => resolveSlow([hit('old', 'webpage', '旧结果')]));
    expect(screen.queryByText('旧结果')).toBeNull();
    expect(screen.getByText('新结果')).toBeTruthy();
  });
});
