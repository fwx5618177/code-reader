// ================================
// 全局搜索测试：结果合并分组、摘要高亮拆分、过期响应丢弃、精确查找
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { HybridSearchResult } from '../../../types/electron';
import type { DocumentSearchResult } from '../../../lib/writing';
import { mergeSearchResults, splitHighlights } from '../search-results';
import { lineSegments } from '../exact-search';
import { DocumentEditorManager, getEditorManager } from '../../../lib/core/editor-model/editor-manager';
import SearchPanel from '..';

const searchDocuments = vi.fn();
vi.mock('../../../lib/writing', () => ({ useWritingService: () => ({ search: searchDocuments }) }));

const databaseAll = vi.fn();
vi.mock('../../../services/database', () => ({ databaseService: { all: (...args: unknown[]) => databaseAll(...args) } }));

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
      onOpenItem: vi.fn(),
    };
    render(<SearchPanel {...props} />);
    return props;
  }

  it('防抖后同时搜索两路，分组展示，打开时交由调用方按条目类型路由', async () => {
    searchDocuments.mockResolvedValue([doc('d1', '写作文档A')]);
    hybrid.mockResolvedValue([hit('w1', 'webpage', '网页B'), hit('p1', 'document', '论文C')]);
    const props = renderPanel();

    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: 'react' } });
    expect(hybrid).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(searchDocuments).toHaveBeenCalledTimes(1);
    expect(hybrid).toHaveBeenCalledWith('react', { limit: 30 });

    expect(screen.getByRole('group', { name: '写作文档' }).textContent).toContain('写作文档A');
    // PDF 等文档附件不是写作文档
    expect(screen.getByRole('group', { name: '写作文档' }).textContent).not.toContain('论文C');
    expect(screen.getByRole('group', { name: '知识条目' }).textContent).toContain('网页B');

    fireEvent.click(screen.getByText('网页B'));
    expect(props.onOpenItem).toHaveBeenCalledWith('w1', undefined);
    expect(props.onClose).toHaveBeenCalled();

    // 键盘：第一项为写作文档
    fireEvent.keyDown(screen.getByLabelText('搜索'), { key: 'Enter' });
    expect(props.onOpenItem).toHaveBeenLastCalledWith('d1', undefined);
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

  describe('精确查找', () => {
    const ROWS = [
      { id: 'n1', title: '笔记.md', type: 'note', content: '# 标题\n\nTODO: 第一处\n\n```js\nconst todo = 1;\n```' },
      { id: 'w1', title: '剪藏', type: 'webpage', content: '网页正文 TODO' },
      { id: 't1', title: '记录.txt', type: 'note', content: '一\n二 TODO' },
    ];

    async function exactSearchFor(query: string) {
      fireEvent.click(screen.getByRole('tab', { name: '精确' }));
      fireEvent.change(screen.getByLabelText('搜索'), { target: { value: query } });
      await act(async () => vi.advanceTimersByTimeAsync(300));
    }

    it('逐行列出命中，打开时带上源码行与顶层块；全文检索不运行', async () => {
      databaseAll.mockResolvedValue(ROWS);
      const props = renderPanel();
      await exactSearchFor('todo');

      expect(hybrid).not.toHaveBeenCalled();
      const note = screen.getByRole('group', { name: '笔记' });
      expect(note.querySelectorAll('[role="option"]')).toHaveLength(2);
      expect(note.querySelector('mark')?.textContent).toBe('TODO');

      fireEvent.click(screen.getByText('const', { exact: false }));
      expect(props.onOpenItem).toHaveBeenCalledWith('n1', { line: 6, block: 2 });

      // 纯文本笔记一行一段；键盘回车打开第一行命中
      fireEvent.keyDown(screen.getByLabelText('搜索'), { key: 'Enter' });
      expect(props.onOpenItem).toHaveBeenLastCalledWith('n1', { line: 3, block: 1 });
      expect(screen.getByRole('group', { name: '记录' }).textContent).toContain('二 TODO');
    });

    it('区分大小写开关生效；无效正则显示错误提示', async () => {
      databaseAll.mockResolvedValue(ROWS);
      renderPanel();
      await exactSearchFor('todo');
      fireEvent.click(screen.getByRole('button', { name: '区分大小写' }));
      await act(async () => vi.advanceTimersByTimeAsync(300));
      expect(screen.getAllByRole('option')).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: '正则表达式' }));
      fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '(todo' } });
      await act(async () => vi.advanceTimersByTimeAsync(300));
      expect(screen.getByRole('alert').textContent).toContain('无效的正则表达式');
    });

    it('编辑中尚未保存的内容参与查找：覆盖数据库中的旧正文，数据库正文为空的条目也能找到', async () => {
      const executor = { save: vi.fn(async () => ({ success: true }) as never) };
      const manager = getEditorManager();
      manager.acquire('n1', { initialTitle: '笔记.md', initialContent: ROWS[0].content, executor, autoSaveEnabled: false }).instance.model.updateContent('已改写为 UNSAVED');
      manager.acquire('e1', { initialTitle: '新建.md', initialContent: '', executor, autoSaveEnabled: false }).instance.model.updateContent('草稿 UNSAVED');
      databaseAll.mockImplementation(async (sql: string) =>
        sql.includes('id IN') ? [{ id: 'e1', title: '新建.md', type: 'note' }] : ROWS
      );
      try {
        renderPanel();
        await exactSearchFor('unsaved');
        expect(screen.getByRole('group', { name: '笔记' }).textContent).toContain('已改写为 UNSAVED');
        expect(screen.getByRole('group', { name: '新建' }).textContent).toContain('草稿 UNSAVED');
        expect(screen.queryByText('第一处', { exact: false })).toBeNull();
      } finally {
        DocumentEditorManager.resetInstance();
      }
    });

    it('lineSegments：长行截取命中附近，命中部分高亮', () => {
      const text = 'x'.repeat(300) + 'HIT' + 'y'.repeat(300);
      const segments = lineSegments(text, [{ start: 300, end: 303, matchedText: 'HIT' }], 100);
      expect(segments[0]).toEqual({ text: '…', highlight: false });
      expect(segments.find((segment) => segment.highlight)?.text).toBe('HIT');
      expect(segments.at(-1)).toEqual({ text: '…', highlight: false });
    });
  });
});
